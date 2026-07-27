/**
 * Standard scorecard view — 11 layers vs reference-model.json requirements.
 */
import { useEffect, useMemo, useState } from "react";
import type { AgentInventoryResult, AgentSurface } from "./types";
import {
  buildScorecard,
  type ReferenceModelDoc,
  type Scorecard,
} from "./standardScorecard";

type Props = {
  agents: AgentInventoryResult | undefined;
  selectedAgentFile?: string | null;
  onSelectAgent?: (file: string) => void;
};

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

const TIER_COLOR: Record<string, string> = {
  essential: "#f87171",
  expected: "#fbbf24",
  optional: "#6b7280",
};

export default function StandardView({
  agents,
  selectedAgentFile,
  onSelectAgent,
}: Props) {
  const agentSurfaces = useMemo(() => {
    return (agents?.agents ?? [])
      .filter((a) => a.kind === "agent")
      .sort((a, b) => a.file.localeCompare(b.file));
  }, [agents]);

  const [agentFile, setAgentFile] = useState<string | null>(
    selectedAgentFile ?? null
  );
  const [model, setModel] = useState<ReferenceModelDoc | null>(null);

  useEffect(() => {
    if (selectedAgentFile) setAgentFile(selectedAgentFile);
    else if (!agentFile && agentSurfaces[0]) {
      setAgentFile(agentSurfaces[0].file);
    }
  }, [selectedAgentFile, agentSurfaces, agentFile]);

  useEffect(() => {
    fetch("/reference-model.json")
      .then((r) => r.json())
      .then((data: ReferenceModelDoc) => setModel(data))
      .catch(() => setModel(null));
  }, []);

  const surface = agentSurfaces.find((a) => a.file === agentFile);

  const scorecard: Scorecard | null = useMemo(() => {
    if (!model || !surface) return null;
    return buildScorecard(model, surface as AgentSurface);
  }, [model, surface]);

  function pickAgent(file: string) {
    setAgentFile(file);
    onSelectAgent?.(file);
  }

  if (!agents || agentSurfaces.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          padding: 32,
          color: "#9ca3af",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        Scan a repository to see the Standard scorecard.
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "rgba(6,12,26,0.4)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #30363d",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          background: "rgba(15,23,42,0.95)",
        }}
      >
        <span style={{ color: "#93c5fd", fontWeight: 600, fontSize: 12 }}>
          Standard
        </span>
        <span style={{ color: "#6b7280", fontSize: 11 }}>Agent</span>
        <select
          value={agentFile ?? ""}
          onChange={(e) => pickAgent(e.target.value)}
          style={{
            background: "#0b1220",
            color: "#e5e7eb",
            border: "1px solid #30363d",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
            maxWidth: 360,
          }}
        >
          {agentSurfaces.map((a) => (
            <option key={a.file} value={a.file}>
              {fileName(a.file)} ({a.loopKind ?? a.kind})
            </option>
          ))}
        </select>
        {scorecard && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 13,
              fontWeight: 700,
              color:
                scorecard.passCount === scorecard.total ? "#4ade80" : "#f87171",
            }}
          >
            {scorecard.passCount} of {scorecard.total} layers meet the bar
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px 32px" }}>
        {!model && (
          <div style={{ color: "#fbbf24", fontSize: 12 }}>
            Loading reference-model.json…
          </div>
        )}
        {scorecard && (
          <>
            <div
              style={{
                marginBottom: 16,
                padding: "12px 14px",
                borderRadius: 6,
                border: scorecard.sensitive
                  ? "1px solid #7f1d1d"
                  : "1px solid #334155",
                background: scorecard.sensitive
                  ? "rgba(127,29,29,0.25)"
                  : "rgba(30,41,59,0.5)",
                color: "#e5e7eb",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <div style={{ color: "#93c5fd", fontWeight: 600, marginBottom: 4 }}>
                Calibration
              </div>
              {scorecard.calibration}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {scorecard.rows.map((row) => {
                const essentialEmpty =
                  row.tier === "essential" &&
                  (row.status === "empty" || row.status === "unsearched");
                return (
                  <div
                    key={row.id}
                    style={{
                      border: essentialEmpty
                        ? "2px dashed #ef4444"
                        : row.pass
                          ? "1px solid #30363d"
                          : "1px solid #b45309",
                      borderRadius: 6,
                      padding: essentialEmpty ? "16px 14px" : "10px 12px",
                      background: essentialEmpty
                        ? "rgba(127,29,29,0.35)"
                        : row.pass
                          ? "rgba(15,23,42,0.6)"
                          : "rgba(120,53,15,0.2)",
                      boxShadow: essentialEmpty
                        ? "0 0 0 1px rgba(239,68,68,0.4)"
                        : undefined,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        alignItems: "baseline",
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: essentialEmpty ? 15 : 12,
                          color: essentialEmpty ? "#fecaca" : "#e5e7eb",
                        }}
                      >
                        {row.name}
                      </span>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        {row.question}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          fontWeight: 700,
                          color: row.pass ? "#4ade80" : "#f87171",
                        }}
                      >
                        {row.pass ? "PASS" : "FAIL"}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        fontSize: 11,
                        color: "#9ca3af",
                        marginBottom: 6,
                      }}
                    >
                      <span>
                        Requirement:{" "}
                        <span
                          style={{
                            color: TIER_COLOR[row.tier],
                            fontWeight: 600,
                          }}
                        >
                          {row.tier}
                        </span>
                      </span>
                      <span>
                        Status:{" "}
                        <span style={{ color: "#e5e7eb" }}>
                          {row.status}
                          {row.componentCount > 0
                            ? ` (${row.componentCount})`
                            : ""}
                        </span>
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.45 }}>
                      <div>
                        <span style={{ color: "#8b9cb3" }}>Fills it: </span>
                        {row.whatFillsIt}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        <span style={{ color: "#8b9cb3" }}>Why it matters: </span>
                        {row.whyItMatters}
                      </div>
                      {essentialEmpty && row.emptyReason && (
                        <div
                          style={{
                            marginTop: 8,
                            color: "#fecaca",
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          Missing: {row.emptyReason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
