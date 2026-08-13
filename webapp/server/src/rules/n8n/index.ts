/**
 * Minimal n8n workflow rule engine (pure).
 * P0 rules: no_error_handling, hardcoded_secret, batch_without_wait.
 */

import { createHash } from "node:crypto";
import type { N8nRawWorkflow } from "../../n8n/mapper.js";
import { shortType } from "../../n8n/taxonomy.js";

export const N8N_RULES_VERSION = "n8n-rules-v1";

export type N8nFindingSeverity = "blocker" | "risk" | "suggestion";

export type N8nFinding = {
  ruleId: string;
  severity: N8nFindingSeverity;
  title: string;
  detail: string;
  suggestedFix: string;
  workflowId: string;
  /** n8n node ids (not ArchNode ids) — location only, never secret values */
  nodeIds: string[];
  fingerprint: string;
};

export const N8N_RULE_IDS = [
  "no_error_handling",
  "hardcoded_secret",
  "batch_without_wait",
] as const;

export type N8nRuleId = (typeof N8N_RULE_IDS)[number];

export function buildFindingFingerprint(parts: {
  rulesVersion: string;
  ruleId: string;
  workflowId: string;
  nodeKey: string;
}): string {
  const payload = [
    parts.rulesVersion,
    parts.ruleId,
    parts.workflowId,
    parts.nodeKey,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

const SECRET_PARAM_KEY =
  /^(api[_-]?key|secret|token|password|pwd|authorization|access[_-]?token|private[_-]?key|client[_-]?secret)$/i;

/** Looks like a pasted key / token, not an expression. */
function looksLikeSecretValue(v: string): boolean {
  if (!v || v.length < 12) return false;
  if (v.includes("{{") || v.includes("$(") || v.includes("$json") || v.includes("$env")) {
    return false;
  }
  // sk-… / xoxb-… / Bearer-ish / long entropy
  if (/^(sk-|rk-|xox[baprs]-|ghp_|glpat-|AIza)/i.test(v)) return true;
  if (/^[A-Za-z0-9+/_-]{24,}$/.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v)) return true;
  return false;
}

function walkParams(
  value: unknown,
  path: string[],
  hits: Array<{ path: string }>
): void {
  if (value == null) return;
  if (typeof value === "string") {
    const key = path[path.length - 1] ?? "";
    if (SECRET_PARAM_KEY.test(key) && looksLikeSecretValue(value)) {
      hits.push({ path: path.join(".") });
    } else if (
      // also catch inline "Authorization: Bearer sk-…" style strings in non-secret keys
      /Bearer\s+(sk-|ghp_|xox)/i.test(value) ||
      /api[_-]?key\s*[:=]\s*['"]?sk-/i.test(value)
    ) {
      hits.push({ path: path.join(".") });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkParams(v, [...path, String(i)], hits));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkParams(v, [...path, k], hits);
    }
  }
}

function ruleNoErrorHandling(wf: N8nRawWorkflow, workflowId: string): N8nFinding[] {
  const nodes = wf.nodes ?? [];
  const hasErrorTrigger = nodes.some(
    (n) => shortType(n.type).toLowerCase() === "errortrigger"
  );
  if (hasErrorTrigger) return [];
  // Skip empty / sticky-only
  const functional = nodes.filter((n) => shortType(n.type) !== "stickyNote");
  if (functional.length === 0) return [];
  return [
    {
      ruleId: "no_error_handling",
      severity: "blocker",
      title: "No error handling",
      detail:
        "This workflow has no Error Trigger. Failures in production will fail silently or stop without a recovery path.",
      suggestedFix:
        "Add an Error Trigger node (or workflow-level error workflow) and route failures to alerting or a dead-letter path.",
      workflowId,
      nodeIds: [],
      fingerprint: buildFindingFingerprint({
        rulesVersion: N8N_RULES_VERSION,
        ruleId: "no_error_handling",
        workflowId,
        nodeKey: "workflow",
      }),
    },
  ];
}

function ruleHardcodedSecret(wf: N8nRawWorkflow, workflowId: string): N8nFinding[] {
  const findings: N8nFinding[] = [];
  for (const n of wf.nodes ?? []) {
    if (!n?.id || shortType(n.type) === "stickyNote") continue;
    const hits: Array<{ path: string }> = [];
    walkParams(n.parameters, [], hits);
    if (hits.length === 0) continue;
    // Location only — never include the secret value
    const loc = hits[0]!.path;
    findings.push({
      ruleId: "hardcoded_secret",
      severity: "blocker",
      title: "Hardcoded secret in node parameters",
      detail: `Node "${n.name}" appears to contain a secret in parameters (${loc}). Secrets in exports are the most common shared-workflow defect.`,
      suggestedFix:
        "Move the value into n8n credentials or an expression that reads $env / credential fields. Rotate the exposed secret.",
      workflowId,
      nodeIds: [n.id],
      fingerprint: buildFindingFingerprint({
        rulesVersion: N8N_RULES_VERSION,
        ruleId: "hardcoded_secret",
        workflowId,
        nodeKey: `${n.id}:${loc}`,
      }),
    });
  }
  return findings;
}

function ruleBatchWithoutWait(wf: N8nRawWorkflow, workflowId: string): N8nFinding[] {
  const nodes = wf.nodes ?? [];
  const connections = wf.connections ?? {};
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const findings: N8nFinding[] = [];

  const hasWaitDownstream = (startName: string, budget = 40): boolean => {
    const seen = new Set<string>();
    const queue = [startName];
    while (queue.length && budget-- > 0) {
      const name = queue.shift()!;
      if (seen.has(name)) continue;
      seen.add(name);
      const node = byName.get(name);
      if (node && shortType(node.type).toLowerCase() === "wait") return true;
      const outs = connections[name];
      if (!outs) continue;
      for (const group of Object.values(outs)) {
        if (!Array.isArray(group)) continue;
        for (const targets of group) {
          if (!Array.isArray(targets)) continue;
          for (const t of targets) {
            if (t?.node) queue.push(t.node);
          }
        }
      }
    }
    return false;
  };

  for (const n of nodes) {
    if (shortType(n.type).toLowerCase() !== "splitinbatches") continue;
    // Check loop output (index 0) for a Wait
    if (hasWaitDownstream(n.name)) continue;
    findings.push({
      ruleId: "batch_without_wait",
      severity: "risk",
      title: "Split In Batches without Wait",
      detail: `Node "${n.name}" batches items but no Wait was found on the loop path. Unthrottled batches correlate with rate-limit failures in production.`,
      suggestedFix:
        "Add a Wait node inside the batch loop (or rate-limit at the HTTP node) before calling external APIs.",
      workflowId,
      nodeIds: [n.id],
      fingerprint: buildFindingFingerprint({
        rulesVersion: N8N_RULES_VERSION,
        ruleId: "batch_without_wait",
        workflowId,
        nodeKey: n.id,
      }),
    });
  }
  return findings;
}

export function evaluateN8nWorkflow(rawInput: unknown): N8nFinding[] {
  const wf = (rawInput ?? {}) as N8nRawWorkflow;
  const workflowId = String(wf.id ?? "unknown");
  return [
    ...ruleNoErrorHandling(wf, workflowId),
    ...ruleHardcodedSecret(wf, workflowId),
    ...ruleBatchWithoutWait(wf, workflowId),
  ];
}
