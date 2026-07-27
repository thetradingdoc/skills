/**
 * SystemModel builder: derives enriched SystemModel from ArchGraph.
 * Implements domain inference (169), runtime role inference (170), tier inference (171).
 */

import type { ArchGraph, ArchNode, ArchEdge, SystemModel, SystemModelNode } from "../../../src/types.js";
import type { NodeTier, RuntimeRole } from "../../../src/types.js";

/** Known domain keywords for inference (auth, payments, users, analytics, notifications, etc.). */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  auth: ["auth", "login", "logout", "session", "token", "oauth", "jwt", "identity"],
  payments: ["payment", "billing", "invoice", "stripe", "checkout", "subscription"],
  users: ["user", "account", "profile", "member", "customer"],
  analytics: ["analytics", "metrics", "tracking", "events", "logging"],
  notifications: ["notification", "email", "push", "sms", "alert"],
  api: ["api", "rest", "graphql", "rpc"],
  admin: ["admin", "dashboard", "management"],
  shared: ["shared", "common", "lib", "utils"],
  root: ["root"],
};

function inferDomain(node: ArchNode): string {
  const path = (node.path ?? node.id ?? "").replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase();
  const label = (node.suggestedLabel ?? node.label ?? "").toLowerCase();
  const tags = (node.tags ?? []).map((t) => String(t).toLowerCase());
  const combined = `${path} ${label} ${tags.join(" ")}`;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (domain === "root") continue;
    for (const kw of keywords) {
      if (combined.includes(kw)) return domain;
    }
  }

  // Path-based fallback: first 2 path segments (e.g. src/auth → auth, lib/utils → lib/utils)
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, 2).join("/");
}

function inferRuntimeRoles(node: ArchNode): RuntimeRole[] {
  const roles: RuntimeRole[] = [];
  const label = (node.suggestedLabel ?? node.label ?? "").toLowerCase();
  const path = (node.path ?? node.id ?? "").toLowerCase();
  const layer = (node.layer ?? "").toLowerCase();
  const tags = (node.tags ?? []).map((t) => String(t).toLowerCase());
  const role = (node.role ?? "").toLowerCase();
  const combined = `${label} ${path} ${layer} ${tags.join(" ")} ${role}`;
  const exports = (node.semanticSignals?.exports ?? []).map((e) => e.toLowerCase()).join(" ");

  const patterns: Array<{ role: RuntimeRole; patterns: string[] }> = [
    { role: "controller", patterns: ["controller", "route", "handler", "endpoint", "api"] },
    { role: "service", patterns: ["service", "manager", "processor", "workflow", "logic", "business"] },
    { role: "repository", patterns: ["repository", "repo", "dao", "data access", "storage"] },
    { role: "worker", patterns: ["worker", "job", "task", "consumer", "processor"] },
    { role: "scheduler", patterns: ["scheduler", "cron", "queue", "job runner"] },
    { role: "event-consumer", patterns: ["event consumer", "listener", "subscriber", "handler"] },
    { role: "gateway", patterns: ["gateway", "proxy", "bff"] },
    { role: "client", patterns: ["client", "sdk", "adapter"] },
  ];

  for (const { role: r, patterns: pats } of patterns) {
    for (const p of pats) {
      if ((combined.includes(p) || exports.includes(p)) && !roles.includes(r)) {
        roles.push(r);
        break;
      }
    }
  }

  if (layer.includes("data") && !roles.includes("repository")) roles.push("repository");
  if (layer.includes("orchestration") && !roles.includes("service")) roles.push("service");

  return roles.length > 0 ? roles : (["service"] as RuntimeRole[]);
}

function inferTier(
  node: ArchNode,
  nodeById: Map<string, ArchNode>,
  edges: ArchEdge[],
  domain: string
): NodeTier {
  const inDegree = edges.filter((e) => e.target === node.id).length;
  const outDegree = edges.filter((e) => e.source === node.id).length;
  const totalDegree = inDegree + outDegree;

  const isInAuthOrPayments = ["auth", "payments"].includes(domain);
  const isEntryPoint = !!node.isEntryPoint;

  // Critical infra: DB, queue, external - nodes that others heavily depend on
  const criticalInfraLayers = ["memory", "data access", "external services", "infrastructure"];
  const isCriticalInfra = criticalInfraLayers.some(
    (l) => (node.layer ?? "").toLowerCase().includes(l.toLowerCase())
  );
  const fanOutToCritical = edges
    .filter((e) => e.source === node.id)
    .some((e) => {
      const tgt = nodeById.get(e.target);
      return tgt && criticalInfraLayers.some((l) => (tgt.layer ?? "").toLowerCase().includes(l.toLowerCase()));
    });

  if (isEntryPoint || (isInAuthOrPayments && totalDegree >= 2) || (isCriticalInfra && inDegree >= 2)) {
    return "core";
  }
  if (fanOutToCritical || totalDegree >= 4 || isInAuthOrPayments) {
    return "supporting";
  }
  return "peripheral";
}

/**
 * Build SystemModel from ArchGraph. Runs domain, runtime role, and tier inference.
 */
export function buildSystemModel(graph: ArchGraph, options?: { graphId?: string }): SystemModel {
  const nodeById = new Map<string, ArchNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const nodes: SystemModelNode[] = graph.nodes.map((node) => {
    const domain = inferDomain(node);
    const runtimeRoles = inferRuntimeRoles(node);
    const tier = inferTier(node, nodeById, graph.edges, domain);
    return {
      ...node,
      domain,
      runtimeRoles,
      tier,
    };
  });

  const domains = [...new Set(nodes.map((n) => n.domain))].sort();

  return {
    nodes,
    edges: graph.edges,
    domains,
    generatedAt: graph.generatedAt,
    projectRoot: graph.projectRoot ?? "",
    projectName: graph.projectName,
    graphId: options?.graphId,
  };
}
