/**
 * Layers canvas — fixed horizontal bands from the reference model.
 * No dragging, no saved positions — layout is the data.
 */
import { useEffect, useMemo, useState } from "react";
import type { AgentInventoryResult, AgentSurface } from "./types";

type LayerComponent = {
  id: string;
  label: string;
  evidence: string;
  sensitive?: "patient" | "money" | null;
};

type AgentLayerResult = {
  id: string;
  name: string;
  question: string;
  whyItMatters: string;
  status: "filled" | "thin" | "empty" | "unsearched";
  emptyReason?: string;
  components: LayerComponent[];
};

type Props = {
  agents: AgentInventoryResult | undefined;
  selectedAgentFile?: string | null;
  onSelectAgent?: (file: string) => void;
  /** Evidence is "path: reason". The path half is worth opening. */
  onOpenFile?: (path: string, line?: number) => void;
};

type RefLayer = {
  id: string;
  name: string;
  question: string;
  whyItMatters: string;
  whatFillsIt?: string;
};

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

const STATUS_BORDER: Record<string, string> = {
  filled: "#30363d",
  thin: "#4b5563",
  empty: "#b45309",
  unsearched: "#7c3aed",
};


/** Evidence reads "path: reason". Only the path half is worth opening. */
function EvidenceLink({
  evidence,
  onOpenFile,
}: {
  evidence?: string | null;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  if (!evidence) return null;
  const i = evidence.indexOf(":");
  const path = i > 0 ? evidence.slice(0, i) : null;
  const rest = i > 0 ? evidence.slice(i + 1) : evidence;
  const openable = !!path && !!onOpenFile && /\.[jt]sx?$/.test(path);
  return (
    <span>
      {openable ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenFile!(path!); }}
          title={"Open " + path}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            font: "inherit",
            color: "#58a6ff",
            cursor: "pointer",
          }}
        >
          {path}
        </button>
      ) : (
        <span>{path ?? ""}</span>
      )}
      <span>{path ? ":" : ""}{rest}</span>
    </span>
  );
}
export default function LayersView({
  onOpenFile,
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
  const [refLayers, setRefLayers] = useState<RefLayer[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<{
    layer: AgentLayerResult;
    component: LayerComponent;
  } | null>(null);

  useEffect(() => {
    if (selectedAgentFile) setAgentFile(selectedAgentFile);
    else if (!agentFile && agentSurfaces[0]) {
      setAgentFile(agentSurfaces[0].file);
    }
  }, [selectedAgentFile, agentSurfaces, agentFile]);

  useEffect(() => {
    fetch("/reference-model.json")
      .then((r) => r.json())
      .then((data) => setRefLayers(data.layers ?? []))
      .catch(() => setRefLayers([]));
  }, []);

  const surface: AgentSurface | undefined = agentSurfaces.find(
    (a) => a.file === agentFile
  );
  const layers: AgentLayerResult[] = (surface as AgentSurface & { layers?: AgentLayerResult[] })
    ?.layers ?? [];

  function pickAgent(file: string) {
    setAgentFile(file);
    setSelectedComponent(null);
    onSelectAgent?.(file);
  }

  if (!agents || agentSurfaces.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          padding: 32,
          color: "#8b949e",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        Scan a repository to see agent layers.
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
        <span style={{ color: "#58a6ff", fontWeight: 600, fontSize: 12 }}>Layers</span>
        <span style={{ color: "#7d8590", fontSize: 11 }}>Agent</span>
        <select
          data-testid="layers-agent-select"
          value={agentFile ?? ""}
          onChange={(e) => pickAgent(e.target.value)}
          style={{
            background: "#0b1220",
            color: "#e6edf3",
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
        {surface?.loopKind === "hosted" && (
          <span style={{ fontSize: 11, color: "#d29922" }}>
            hosted — control loop lives outside this repo
          </span>
        )}
      </div>

      <div
        key={agentFile ?? "none"}
        data-testid="layers-canvas"
        data-agent-file={agentFile ?? ""}
        style={{ flex: 1, overflow: "auto", padding: "8px 12px 24px" }}
      >
        {layers.length === 0 && (
          <div style={{ color: "#d29922", padding: 24, fontSize: 12 }}>
            No layer data on this agent — re-scan after reference-model detection is wired.
          </div>
        )}
        {layers.map((layer) => {
          const ref = refLayers.find((r) => r.id === layer.id);
          const why = layer.whyItMatters || ref?.whyItMatters || "";
          const question = layer.question || ref?.question || "";
          const isEmpty = layer.status === "empty";
          const isUnsearched = layer.status === "unsearched";
          const loud = isEmpty || isUnsearched;

          return (
            <div
              key={layer.id}
              data-testid="layers-band"
              data-layer-id={layer.id}
              data-layer-status={layer.status}
              data-layer-components={String(layer.components?.length ?? 0)}
              style={{
                display: "flex",
                minHeight: loud ? 72 : 56,
                marginBottom: 6,
                borderRadius: 6,
                border: `1px solid ${STATUS_BORDER[layer.status]}`,
                background: isEmpty
                  ? "rgba(120,53,15,0.35)"
                  : isUnsearched
                    ? "rgba(76,29,149,0.25)"
                    : "rgba(17,24,39,0.75)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: 220,
                  flexShrink: 0,
                  padding: "10px 12px",
                  borderRight: "1px solid #21262d",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span
                    style={{
                      color: loud ? "#fde68a" : "#f3f4f6",
                      fontWeight: 700,
                      fontSize: loud ? 13 : 12,
                    }}
                  >
                    {layer.name}
                  </span>
                  <span style={{ color: "#7d8590", fontSize: 10 }}>
                    {layer.components.length}
                  </span>
                </div>
                <div style={{ color: "#8b949e", fontSize: 10, lineHeight: 1.35 }}>
                  {question}
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  alignItems: "center",
                  alignContent: "center",
                }}
              >
                {isEmpty && (
                  <div
                    style={{
                      width: "100%",
                      border: "1px dashed #d29922",
                      borderRadius: 4,
                      padding: "10px 12px",
                      background: "rgba(0,0,0,0.2)",
                    }}
                  >
                    <div style={{ color: "#fde68a", fontWeight: 700, fontSize: 12 }}>
                      Missing — {layer.name}
                    </div>
                    <div style={{ color: "#fcd34d", fontSize: 11, marginTop: 4 }}>
                      {layer.emptyReason || "Searched and found nothing."}
                    </div>
                    <div style={{ color: "#fdba74", fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
                      Why it matters: {why}
                    </div>
                  </div>
                )}
                {isUnsearched && (
                  <div
                    style={{
                      width: "100%",
                      border: "1px dashed #a78bfa",
                      borderRadius: 4,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ color: "#ddd6fe", fontWeight: 700, fontSize: 12 }}>
                      Could not search — {layer.name}
                    </div>
                    <div style={{ color: "#c4b5fd", fontSize: 11, marginTop: 4 }}>
                      {layer.emptyReason || "Detection could not run for this layer."}
                    </div>
                  </div>
                )}
                {!isEmpty &&
                  !isUnsearched &&
                  layer.components.slice(0, 24).map((c) => {
                    const sens = c.sensitive;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        title={c.evidence}
                        onClick={() => setSelectedComponent({ layer, component: c })}
                        style={{
                          textAlign: "left",
                          padding: "5px 8px",
                          borderRadius: 4,
                          border: sens
                            ? `1px solid ${sens === "patient" ? "#f87171" : "#d29922"}`
                            : "1px solid #30363d",
                          background:
                            selectedComponent?.component.id === c.id
                              ? "rgba(37,99,235,0.25)"
                              : "rgba(15,23,42,0.9)",
                          color: "#e6edf3",
                          fontSize: 10,
                          cursor: "pointer",
                          maxWidth: 200,
                        }}
                      >
                        <div
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.label}
                        </div>
                        {sens && (
                          <div
                            style={{
                              marginTop: 2,
                              fontSize: 9,
                              color: sens === "patient" ? "#fca5a5" : "#fcd34d",
                            }}
                          >
                            reaches {sens}
                          </div>
                        )}
                      </button>
                    );
                  })}
                {!isEmpty &&
                  !isUnsearched &&
                  layer.components.length > 24 && (
                    <span style={{ color: "#7d8590", fontSize: 10 }}>
                      +{layer.components.length - 24} more
                    </span>
                  )}
                {layer.status === "thin" && layer.components.length > 0 && (
                  <span style={{ color: "#8b949e", fontSize: 10, marginLeft: 4 }}>
                    thin
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedComponent && (
        <div
          style={{
            borderTop: "1px solid #30363d",
            background: "rgba(17,24,39,0.97)",
            padding: "12px 16px 14px",
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12, color: "#f3f4f6" }}>
              {selectedComponent.layer.name} → {selectedComponent.component.label}
            </div>
            <button
              type="button"
              onClick={() => setSelectedComponent(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "#8b949e",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              close
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#58a6ff", lineHeight: 1.5 }}>
            <EvidenceLink
              evidence={selectedComponent.component.evidence}
              onOpenFile={onOpenFile}
            />
          </div>
          {selectedComponent.component.sensitive && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#fca5a5" }}>
              Marked: reaches {selectedComponent.component.sensitive}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
