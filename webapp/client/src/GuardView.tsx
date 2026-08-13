/**
 * Guard — edit reach.rules, see PASS / FAIL / UNEVALUABLE, baseline failures.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentInventoryResult, ResourceClass } from "./types";
import {
  INK,
  SLATE,
  LINE,
  ACCENT,
  GOOD,
  WARN,
  BAD,
  FONT_MONO,
  PAPER,
  CANVAS,
} from "./theme/tokens";

type Props = {
  agents: AgentInventoryResult | undefined;
  apiBase: string;
  onOpenEvidence?: (args: {
    agent: string;
    tool: string;
    cls: ResourceClass;
  }) => void;
};

type EvalRow = {
  rule: { raw: string; kind?: string; line?: number };
  status: "PASS" | "FAIL" | "UNEVALUABLE";
  reason: string;
  display?: string;
  coveragePercent?: number;
  claim?: {
    agent: string;
    tool: string;
    class?: ResourceClass;
    resource?: string;
    confidence?: string;
    depth?: number | null;
    evidence?: string;
  } | null;
  unevaluableCount?: number | null;
  baselined?: boolean;
};

type EvalResponse = {
  rules: string;
  ciLine: string;
  confidenceOfReaches?: { high: number; medium: number };
  summary: {
    pass: number;
    fail: number;
    failNew: number;
    failBaselined: number;
    unevaluable: number;
  };
  evaluations: EvalRow[];
  exitCode: number;
};

const STATUS_COLOR: Record<string, string> = {
  PASS: GOOD,
  FAIL: BAD,
  UNEVALUABLE: WARN,
};

export default function GuardView({ agents, apiBase, onOpenEvidence }: Props) {
  const [rulesText, setRulesText] = useState("");
  const [report, setReport] = useState<EvalResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const evaluate = useCallback(
    async (text?: string) => {
      if (!agents) return;
      setBusy(true);
      setError(null);
      try {
        // Send a slim inventory — reach cells only — to stay under body limits
        const slim = {
          agents: (agents.agents ?? [])
            .filter((a) => a.kind === "agent")
            .map((a) => ({
              file: a.file,
              kind: a.kind,
              auth: a.auth,
              tools: (a.tools ?? [])
                .filter((t) => t.name !== "(hosted)")
                .map((t) => ({
                  name: t.name,
                  handler: t.handler,
                  note: t.note,
                  reach: t.reach
                    ? {
                        cells: t.reach.cells,
                        truncated: t.reach.truncated,
                        truncationReasons: t.reach.truncationReasons,
                        resources: (t.reach.resources ?? [])
                          .filter(
                            (r) =>
                              r.kind !== "db_call" && r.class !== "plumbing"
                          )
                          .map((r) => ({
                            kind: r.kind,
                            name: r.name,
                            class: r.class,
                            depth: r.depth,
                            path: r.path,
                            evidence: r.evidence,
                            confidence: r.confidence,
                            proof: r.proof,
                          })),
                      }
                    : undefined,
                })),
            })),
          scannedFiles: agents.scannedFiles,
          languages: agents.languages,
          pythonAgents: agents.pythonAgents,
          searchedFor: agents.searchedFor,
        };
        const res = await fetch(`${apiBase}/reach/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: slim,
            rules: text ?? rulesText,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as EvalResponse;
        setReport(data);
        if (typeof data.rules === "string") setRulesText(data.rules);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [agents, apiBase, rulesText]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/reach/rules`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (cancelled) return;
        setRulesText(data.rules ?? "");
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (agents && rulesText !== undefined) {
      void evaluate(rulesText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  async function saveRules() {
    setBusy(true);
    setSaveNote(null);
    try {
      const res = await fetch(`${apiBase}/reach/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rulesText }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveNote("Saved to reach.rules");
      await evaluate(rulesText);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function baselineCurrentFailures() {
    if (!report) return;
    const keys: string[] = [];
    for (const e of report.evaluations) {
      if (e.status !== "FAIL" || e.baselined) continue;
      keys.push(e.rule.raw);
      if (e.claim) {
        keys.push(
          `${e.rule.raw}::${e.claim.agent}::${e.claim.tool}::${e.claim.resource ?? e.claim.class ?? ""}`
        );
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/reach/baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveNote("Current failures marked pre-existing");
      await evaluate(rulesText);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!agents) {
    return (
      <div
        style={{
          flex: 1,
          padding: 32,
          color: SLATE,
          fontFamily: FONT_MONO,
        }}
      >
        Scan a repository to evaluate Guard rules.
      </div>
    );
  }

  const blocking = report?.summary.failNew ?? 0;
  const baselined = report?.summary.failBaselined ?? 0;
  const uneval = report?.summary.unevaluable ?? 0;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: PAPER,
        fontFamily: FONT_MONO,
      }}
    >
      <div
        style={{
          padding: "10px 20px",
          borderBottom: `1px solid ${LINE}`,
          fontSize: 12,
          color: INK,
          background: CANVAS,
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 16px",
          alignItems: "center",
        }}
      >
        <span style={{ color: ACCENT, fontWeight: 600 }}>Guard</span>
        <span style={{ color: SLATE }}>
          {report?.ciLine ??
            `${blocking} new failures would block, ${baselined} baselined, ${uneval} unevaluable.`}
        </span>
        {report?.confidenceOfReaches && (
          <span style={{ color: SLATE, fontSize: 11 }}>
            reaches conf: high {report.confidenceOfReaches.high} · medium{" "}
            {report.confidenceOfReaches.medium}
          </span>
        )}
        {error && <span style={{ color: BAD }}>{error}</span>}
        {saveNote && <span style={{ color: GOOD }}>{saveNote}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div
          style={{
            flex: "0 0 46%",
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${LINE}`,
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderBottom: `1px solid ${LINE}`,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 11, color: SLATE }}>reach.rules</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveRules()}
              style={{
                marginLeft: "auto",
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #1f6feb",
                background: "rgba(239, 50, 166, 0.12)",
                color: ACCENT,
                cursor: "pointer",
              }}
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void evaluate(rulesText)}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: `1px solid ${LINE}`,
                background: "transparent",
                color: INK,
                cursor: "pointer",
              }}
            >
              Re-check
            </button>
          </div>
          <textarea
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              outline: "none",
              padding: 12,
              background: PAPER,
              color: INK,
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "12px 16px 32px" }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              disabled={busy || blocking === 0}
              onClick={() => void baselineCurrentFailures()}
              style={{
                fontSize: 11,
                padding: "5px 12px",
                borderRadius: 4,
                border: "1px solid #a78bfa",
                background: "rgba(139,92,246,0.15)",
                color: SLATE,
                cursor: blocking === 0 ? "default" : "pointer",
                opacity: blocking === 0 ? 0.5 : 1,
              }}
            >
              Mark current failures as pre-existing
            </button>
            <span style={{ fontSize: 10, color: SLATE }}>
              Baselined failures show separately and do not block CI.
            </span>
          </div>

          {(report?.evaluations ?? []).map((e, i) => {
            const isBaselinedFail = e.status === "FAIL" && e.baselined;
            const statusLabel = isBaselinedFail ? "FAIL (baselined)" : e.status;
            const color = isBaselinedFail ? "#c4b5fd" : STATUS_COLOR[e.status];
            return (
              <div
                key={`${e.rule.raw}-${i}`}
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: `1px solid ${isBaselinedFail ? "#5b21b6" : LINE}`,
                  background: PAPER,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ color, fontWeight: 700, fontSize: 11, minWidth: 110 }}>
                    {statusLabel}
                  </span>
                  <span style={{ color: SLATE, fontSize: 10 }}>
                    {e.display ?? `${e.status} (${e.coveragePercent ?? "?"}%)`}
                  </span>
                </div>
                <div style={{ marginTop: 4, color: INK, fontSize: 12 }}>{e.rule.raw}</div>
                <div style={{ marginTop: 6, fontSize: 11, color: SLATE }}>{e.reason}</div>
                {e.claim && (
                  <div style={{ marginTop: 8, fontSize: 11, color: INK }}>
                    claim: {e.claim.tool}
                    {e.claim.resource ? ` → ${e.claim.resource}` : ""}
                    {e.claim.confidence ? ` (${e.claim.confidence})` : ""}
                    {e.claim.class && onOpenEvidence && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenEvidence({
                            agent: e.claim!.agent,
                            tool: e.claim!.tool,
                            cls: e.claim!.class!,
                          })
                        }
                        style={{
                          marginLeft: 10,
                          background: "transparent",
                          border: "none",
                          color: ACCENT,
                          cursor: "pointer",
                          fontSize: 11,
                          textDecoration: "underline",
                        }}
                      >
                        open evidence
                      </button>
                    )}
                    {e.claim.evidence && (
                      <div style={{ marginTop: 4, color: SLATE, fontSize: 10 }}>
                        {e.claim.evidence}
                      </div>
                    )}
                  </div>
                )}
                {e.status === "UNEVALUABLE" && e.unevaluableCount != null && (
                  <div style={{ marginTop: 4, fontSize: 10, color: WARN }}>
                    {e.unevaluableCount} covering cell(s)
                  </div>
                )}
              </div>
            );
          })}

          {report && report.evaluations.length === 0 && (
            <div style={{ color: SLATE, fontSize: 12 }}>
              No rules yet. Save a starter reach.rules or write rules in the editor.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
