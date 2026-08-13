/**
 * P6 — LLMOps at a glance for the selected agent-like node.
 *
 * Sits beside NodeCollabMeta: eval status, recent traces, prompt/config
 * lineage, and shape drift (has this agent's design lost its Memory/Eval
 * wiring, or started failing evals?). Works with or without a signed-in
 * workspace — anonymous design mode falls back to a client-side topology
 * check via computeAgentShapeDrift so Memory/Eval warnings still show up.
 */
import { useEffect, useState } from "react";
import type { ArchNode, ArchEdge } from "./types";
import { computeAgentShapeDrift, type AgentShapeDrift } from "./llmopsDrift";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type EvalRun = {
  id: string;
  status: "pass" | "fail" | "error";
  score?: number | null;
  suite?: string | null;
  run_url?: string | null;
  created_at: string;
};

type RuntimeTrace = {
  id: string;
  status: "ok" | "error";
  summary?: string | null;
  trace_url?: string | null;
  latency_ms?: number | null;
  created_at: string;
};

type LlmopsRefs = {
  prompt_ref?: string | null;
  config_ref?: string | null;
  memory_node_id?: string | null;
  eval_node_id?: string | null;
} | null;

type LlmopsData = {
  nodeId: string;
  evalRuns: EvalRun[];
  traces: RuntimeTrace[];
  refs: LlmopsRefs;
  latestEval: EvalRun | null;
  migrationPending?: boolean;
};

type Props = {
  workspaceId: string | null;
  nodeId: string | null;
  nodeLabel?: string;
  apiBase: string;
  accessToken: string | null;
  graphNodes: ArchNode[];
  graphEdges: ArchEdge[];
  /** Offset the panel horizontally so it doesn't overlap other inspector panels. */
  rightOffset?: number;
};

const sectionLabelStyle = {
  fontSize: 9,
  color: "#8b949e",
  textTransform: "uppercase" as const,
  letterSpacing: 0.06,
  marginBottom: 5,
};

function evalBadgeColor(status: string): string {
  if (status === "pass") return "#3fb950";
  if (status === "fail" || status === "error") return "#f85149";
  return "#6e7681";
}

function severityColor(sev: AgentShapeDrift["severity"]): string {
  if (sev === "fail") return "#f85149";
  if (sev === "warn") return "#d29922";
  return "#3fb950";
}

export function NodeLlmopsPanel({
  workspaceId,
  nodeId,
  nodeLabel,
  apiBase,
  accessToken,
  graphNodes,
  graphEdges,
  rightOffset = 0,
}: Props) {
  const [data, setData] = useState<LlmopsData | null>(null);
  const [drift, setDrift] = useState<AgentShapeDrift | null>(null);
  const [driftLoading, setDriftLoading] = useState(true);

  useEffect(() => {
    setData(null);
    if (!workspaceId || !nodeId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(nodeId)}/llmops`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setData(d as LlmopsData);
      } catch {
        /* best-effort — LLMOps metadata is a nice-to-have, not a blocker */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, accessToken, workspaceId, nodeId]);

  useEffect(() => {
    setDrift(null);
    setDriftLoading(true);
    if (!nodeId) {
      setDriftLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (workspaceId && accessToken) {
        try {
          const r = await fetch(
            `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/llmops/drift`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ nodes: graphNodes, edges: graphEdges }),
            }
          );
          if (r.ok) {
            const d = await r.json();
            const found = (d.drifts as AgentShapeDrift[] | undefined)?.find((x) => x.nodeId === nodeId) ?? null;
            if (!cancelled) {
              setDrift(found);
              setDriftLoading(false);
            }
            return;
          }
        } catch {
          /* fall through to client-side compute */
        }
      }
      const client = computeAgentShapeDrift(graphNodes, graphEdges);
      const found = client.find((x) => x.nodeId === nodeId) ?? null;
      if (!cancelled) {
        setDrift(found);
        setDriftLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, accessToken, workspaceId, nodeId, graphNodes, graphEdges]);

  if (!nodeId) return null;

  const localNode = graphNodes.find((n) => n.id === nodeId);
  const promptRef = data?.refs?.prompt_ref ?? localNode?.llmops?.promptRef ?? null;
  const configRef = data?.refs?.config_ref ?? localNode?.llmops?.configRef ?? null;
  const latestEval = data?.latestEval ?? null;
  const evalStatus = latestEval?.status ?? "none";

  return (
    <div
      data-testid="node-llmops-panel"
      style={{
        position: "absolute",
        top: 12,
        right: 12 + rightOffset,
        width: 260,
        zIndex: 18,
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 10,
        padding: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        fontFamily: MONO,
      }}
    >
      <div style={{ fontSize: 9, color: "#6e7681", textTransform: "uppercase", letterSpacing: 0.06, marginBottom: 8 }}>
        {nodeLabel ? `${nodeLabel} · LLMOps` : "LLMOps"}
      </div>

      <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #21262d" }}>
        <div style={sectionLabelStyle}>Eval</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            data-testid="llmops-eval-status"
            style={{ fontSize: 11, fontWeight: 600, color: evalBadgeColor(evalStatus), textTransform: "uppercase" }}
          >
            {evalStatus}
          </span>
          {latestEval?.score != null && (
            <span style={{ fontSize: 11, color: "#8b949e" }}>score {latestEval.score}</span>
          )}
          {latestEval?.run_url && (
            <a
              href={latestEval.run_url}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: "#ef32a6", textDecoration: "none" }}
            >
              view →
            </a>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #21262d" }}>
        <div style={sectionLabelStyle}>Traces</div>
        {data && data.traces.length > 0 ? (
          <div data-testid="llmops-traces" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.traces.slice(0, 3).map((t) => (
              <div key={t.id} style={{ fontSize: 10.5, color: "#c9d1d9" }}>
                <span style={{ color: t.status === "error" ? "#f85149" : "#3fb950" }}>{t.status}</span>
                {t.latency_ms != null ? ` · ${t.latency_ms}ms` : ""}
                {t.summary ? ` · ${t.summary}` : ""}
                {t.trace_url && (
                  <a
                    href={t.trace_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginLeft: 6, color: "#ef32a6", textDecoration: "none" }}
                  >
                    view
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10.5, color: "#6e7681" }}>No traces recorded yet.</div>
        )}
      </div>

      <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #21262d" }}>
        <div style={sectionLabelStyle}>Prompt / config</div>
        <div style={{ fontSize: 10.5, color: "#c9d1d9", marginBottom: 2 }} data-testid="llmops-prompt-ref">
          Prompt: {promptRef || "Not set"}
        </div>
        <div style={{ fontSize: 10.5, color: "#c9d1d9" }} data-testid="llmops-config-ref">
          Config: {configRef || "Not set"}
        </div>
      </div>

      <div>
        <div style={sectionLabelStyle}>Drift</div>
        {driftLoading ? (
          <div style={{ fontSize: 10.5, color: "#6e7681" }}>Computing…</div>
        ) : drift ? (
          <>
            <div
              data-testid="llmops-drift-severity"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: severityColor(drift.severity),
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              {drift.severity}
            </div>
            {drift.reasons.length > 0 ? (
              <ul
                data-testid="llmops-drift-reasons"
                style={{ margin: 0, paddingLeft: 16, fontSize: 10.5, color: "#8b949e", lineHeight: 1.5 }}
              >
                {drift.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 10.5, color: "#6e7681" }}>No issues detected.</div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 10.5, color: "#6e7681" }}>Not tracked as an agent node.</div>
        )}
      </div>
    </div>
  );
}
