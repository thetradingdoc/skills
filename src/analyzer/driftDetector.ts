import { ArchGraph, ArchEdge } from "../types";
import { readContextFile } from "./contextReader";
import { readArchRules } from "./archRulesReader";
import * as path from "path";

/** Heuristic redaction for secrets (exported for retriever/config use). */
export function redactSecrets(raw: string): string {
  if (!raw) return raw;
  let out = raw;
  // .env-style KEY=VALUE lines where KEY hints at secret
  out = out.replace(
    /^([A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD|PWD)[A-Z0-9_]*\s*=\s*)(.+)$/gim,
    "$1[REDACTED]"
  );
  // Common JSON/YAML style: "apiKey": "....", password: "...."
  out = out.replace(
    /(["']?(apiKey|api_key|secret|token|password|pwd)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi,
    "$1[REDACTED]$4"
  );
  // Long high-entropy tokens (base64-ish or hex) of length >= 32
  out = out.replace(
    /\b([A-Za-z0-9+/_-]{32,}|[A-Fa-f0-9]{40,})\b/g,
    "[REDACTED]"
  );
  return out;
}

function matchesPattern(moduleId: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"
    );
    return regex.test(moduleId);
  }
  return moduleId.includes(pattern) || path.basename(moduleId) === pattern;
}

export function detectDrift(graph: ArchGraph): ArchGraph {
  const archRules = readArchRules(graph.projectRoot);

  const updatedEdges: ArchEdge[] = graph.edges.map((edge) => {
    const sourceModulePath = path.join(graph.projectRoot, edge.source);
    const context = readContextFile(sourceModulePath);

    if (context?.mustNotDependOn) {
      const targetName = path.basename(edge.target);
      const violation = context.mustNotDependOn.find(
        (forbidden) =>
          edge.target.includes(forbidden) || targetName === forbidden
      );
      if (violation) {
        return {
          ...edge,
          isDrift: true,
          driftReason: `"${path.basename(edge.source)}" must not depend on "${violation}"`,
        };
      }
    }

    for (const rule of archRules) {
      if (
        matchesPattern(edge.source, rule.sourcePattern) &&
        matchesPattern(edge.target, rule.mustNotImportPattern)
      ) {
        return {
          ...edge,
          isDrift: true,
          driftReason: rule.description,
        };
      }
    }

    return edge;
  });

  const updatedNodes = graph.nodes.map((node) => {
    const modulePath = path.join(graph.projectRoot, node.id);
    const context = readContextFile(modulePath);
    const updates: Partial<typeof node> = {};
    if (context?.isDeprecated) updates.status = "deprecated";
    if (context?.role) updates.role = context.role;
    if (context?.rawContent) {
      updates.contextRawContent = redactSecrets(context.rawContent);
    }
    return { ...node, ...updates };
  });

  const nodesWithDrift = new Set(
    updatedEdges.filter((e) => e.isDrift).flatMap((e) => [e.source, e.target])
  );
  const finalNodes = updatedNodes.map((node) => ({
    ...node,
    isDrift: nodesWithDrift.has(node.id),
  }));

  return {
    ...graph,
    nodes: finalNodes,
    edges: updatedEdges,
  };
}
