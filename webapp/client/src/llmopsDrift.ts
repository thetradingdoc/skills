/**
 * P6 — runtime shape drift vs design for Agent nodes (client copy).
 *
 * Designed Agent should typically have Memory (and optionally Eval) connected.
 * Compares design graph topology + latest eval status to produce actionable drift.
 *
 * Keep this in sync with webapp/server/src/llmopsDrift.ts — same pure logic,
 * duplicated so design mode (no workspace/auth) can still surface Memory/Eval
 * warnings client-side without a round trip.
 */
export type DriftSeverity = "ok" | "warn" | "fail";

export type AgentShapeDrift = {
  nodeId: string;
  label: string;
  severity: DriftSeverity;
  reasons: string[];
  hasMemoryEdge: boolean;
  hasEvalEdge: boolean;
  latestEvalStatus: "pass" | "fail" | "error" | "none";
  recentTraceCount: number;
  recentTraceErrors: number;
};

export type DesignNodeLike = {
  id: string;
  label?: string;
  kind?: string;
  layer?: string;
};

export type DesignEdgeLike = {
  source: string;
  target: string;
  relation?: string;
};

export type EvalRunLike = {
  node_id: string;
  status: "pass" | "fail" | "error";
  created_at?: string;
};

export type RuntimeTraceLike = {
  node_id: string;
  status: "ok" | "error";
};

export function isAgentNode(n: DesignNodeLike): boolean {
  const kind = (n.kind ?? "").toLowerCase();
  const layer = (n.layer ?? "").toLowerCase();
  const label = (n.label ?? "").toLowerCase();
  return (
    kind === "agent" ||
    layer === "reasoning" ||
    /\bagent\b/.test(label) ||
    /\brag\b/.test(label)
  );
}

function isMemoryNode(n: DesignNodeLike): boolean {
  const layer = (n.layer ?? "").toLowerCase();
  const label = (n.label ?? "").toLowerCase();
  const kind = (n.kind ?? "").toLowerCase();
  return layer === "memory" || kind === "memory" || /\bmemory\b|\bsession\b|\bhistory\b/.test(label);
}

function isEvalNode(n: DesignNodeLike): boolean {
  const layer = (n.layer ?? "").toLowerCase();
  const label = (n.label ?? "").toLowerCase();
  if (layer === "evaluation") return true;
  if (/\beval\b|\bharness\b|\btest suite\b/.test(label)) return true;
  return false;
}

function connectedIds(nodeId: string, edges: DesignEdgeLike[]): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source === nodeId) out.add(e.target);
    if (e.target === nodeId) out.add(e.source);
  }
  return out;
}

/**
 * Pure: for each agent-like design node, report whether Memory/Eval are linked
 * and whether the latest eval run / traces look healthy.
 */
export function computeAgentShapeDrift(
  nodes: DesignNodeLike[],
  edges: DesignEdgeLike[],
  evalRuns: EvalRunLike[] = [],
  traces: RuntimeTraceLike[] = []
): AgentShapeDrift[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const latestEval = new Map<string, EvalRunLike>();
  for (const r of evalRuns) {
    const prev = latestEval.get(r.node_id);
    if (!prev || (r.created_at && prev.created_at && r.created_at > prev.created_at) || !prev.created_at) {
      latestEval.set(r.node_id, r);
    }
  }

  const results: AgentShapeDrift[] = [];
  for (const n of nodes) {
    if (!isAgentNode(n)) continue;
    const linked = connectedIds(n.id, edges);
    const linkedNodes = [...linked].map((id) => byId.get(id)).filter(Boolean) as DesignNodeLike[];
    const hasMemoryEdge = linkedNodes.some(isMemoryNode);
    const hasEvalEdge = linkedNodes.some(isEvalNode);

    const evalOnAgent = latestEval.get(n.id);
    let latestEvalStatus: AgentShapeDrift["latestEvalStatus"] = evalOnAgent?.status ?? "none";
    if (latestEvalStatus === "none") {
      for (const ln of linkedNodes.filter(isEvalNode)) {
        const er = latestEval.get(ln.id);
        if (er) {
          latestEvalStatus = er.status;
          break;
        }
      }
    }

    const nodeTraces = traces.filter((t) => t.node_id === n.id);
    const recentTraceCount = nodeTraces.length;
    const recentTraceErrors = nodeTraces.filter((t) => t.status === "error").length;

    const reasons: string[] = [];
    if (!hasMemoryEdge) reasons.push("No Memory node connected on the design graph");
    if (!hasEvalEdge) reasons.push("No Eval node connected on the design graph");
    if (latestEvalStatus === "fail") reasons.push("Latest eval run failed");
    if (latestEvalStatus === "error") reasons.push("Latest eval run errored");
    if (latestEvalStatus === "none" && hasEvalEdge) reasons.push("Eval node present but no eval runs recorded");
    if (recentTraceErrors > 0) reasons.push(`${recentTraceErrors} recent runtime trace error(s)`);

    let severity: DriftSeverity = "ok";
    if (latestEvalStatus === "fail" || latestEvalStatus === "error" || recentTraceErrors > 0) {
      severity = "fail";
    } else if (reasons.length > 0) {
      severity = "warn";
    }

    results.push({
      nodeId: n.id,
      label: n.label ?? n.id,
      severity,
      reasons,
      hasMemoryEdge,
      hasEvalEdge,
      latestEvalStatus,
      recentTraceCount,
      recentTraceErrors,
    });
  }

  return results.sort((a, b) => {
    const rank = { fail: 0, warn: 1, ok: 2 };
    return rank[a.severity] - rank[b.severity] || a.label.localeCompare(b.label);
  });
}

export function driftSummary(drifts: AgentShapeDrift[]): {
  fail: number;
  warn: number;
  ok: number;
} {
  return drifts.reduce(
    (acc, d) => {
      acc[d.severity] += 1;
      return acc;
    },
    { fail: 0, warn: 0, ok: 0 }
  );
}
