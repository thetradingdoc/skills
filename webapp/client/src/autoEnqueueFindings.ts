/**
 * Client-side auto-enqueue of design findings → Tasks todos (redesign v2 Epic 2 / D1/D4/D6).
 * Pure helpers — App posts to existing /todos endpoint.
 */
import type { ArchGraph } from "./types";
import {
  evaluateDesign,
  type DesignFinding,
} from "./designRules";
import { insightsTodoSourcePath } from "./insightsTodo";

export type AutoEnqueueCandidate = {
  title: string;
  description: string;
  source: "insights";
  sourcePath: string;
  fileScope: string[];
  agentFile: string | null;
  layerId: string | null;
  kind: "task";
  context: string;
  assigneeLabel: "Cursor";
  ruleId: string;
  nodeId: string;
};

/** Guard: never spam n8n / greenfield / no-root workspaces (Epic 2). */
export function canAutoEnqueueForGraph(
  graph: ArchGraph | null | undefined,
  opts?: { optInGreenfield?: boolean }
): boolean {
  if (!graph) return false;
  if (!graph.projectRoot?.trim()) return false;
  const nodes = graph.nodes ?? [];
  if (nodes.some((n) => n.importSource === "n8n")) return false;
  // Design-only board (spine/architecture without scanned file bindings).
  const hasScannedFiles = nodes.some((n) => (n.files?.length ?? 0) > 0);
  if (graph.architectureBoard && !hasScannedFiles && !opts?.optInGreenfield) return false;
  return true;
}

/** Blocker + code remediation only — excludes missing_trading_spine (D1). */
export function selectAutoEnqueueFindings(findings: DesignFinding[]): DesignFinding[] {
  return findings.filter(
    (f) =>
      f.sharedSeverity === "blocker" &&
      f.remediation === "code" &&
      f.ruleId !== "missing_trading_spine"
  );
}

export function findingToAutoEnqueueCandidate(
  finding: DesignFinding,
  graph: ArchGraph
): AutoEnqueueCandidate | null {
  const nodeId = finding.nodeIds[0];
  if (!nodeId) return null;
  const node = graph.nodes.find((n) => n.id === nodeId);
  const actionId = finding.ruleId;
  const sourcePath = insightsTodoSourcePath(nodeId, actionId);
  const fileScope = (node?.files ?? []).slice(0, 12);
  return {
    title: finding.title,
    description: finding.whyItMatters,
    source: "insights",
    sourcePath,
    fileScope,
    agentFile: fileScope[0] ?? null,
    layerId:
      (node?.subsystem as string | undefined) ??
      (typeof node?.layer === "string" ? node.layer : null),
    kind: "task",
    context: `Blanko auto-enqueue · ${finding.ruleId} · ${node?.label ?? nodeId}`,
    assigneeLabel: "Cursor",
    ruleId: finding.ruleId,
    nodeId,
  };
}

export function collectAutoEnqueueCandidates(graph: ArchGraph): AutoEnqueueCandidate[] {
  if (!canAutoEnqueueForGraph(graph)) return [];
  const findings = selectAutoEnqueueFindings(evaluateDesign(graph));
  const out: AutoEnqueueCandidate[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const c = findingToAutoEnqueueCandidate(f, graph);
    if (!c || seen.has(c.sourcePath)) continue;
    seen.add(c.sourcePath);
    out.push(c);
  }
  return out;
}

/** Diff candidates against open todo source_paths. */
export function newAutoEnqueueCandidates(
  candidates: AutoEnqueueCandidate[],
  openSourcePaths: Set<string> | Iterable<string>
): AutoEnqueueCandidate[] {
  const open = openSourcePaths instanceof Set ? openSourcePaths : new Set(openSourcePaths);
  return candidates.filter((c) => !open.has(c.sourcePath));
}
