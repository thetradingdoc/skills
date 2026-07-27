/**
 * Reach matrix — tools × sensitivity columns with three cell states:
 * reaches | none | not-traced. Click a cell for the full evidence chain.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  AgentInventoryResult,
  AgentSurface,
  AgentTool,
  CellState,
  ClassCell,
  ReachResource,
  ResourceClass,
} from "./types";

type Props = {
  agents: AgentInventoryResult | undefined;
};

const COLUMNS: ResourceClass[] = [
  "patient",
  "money",
  "external",
  "internal",
  "unclassified",
];

const DISPUTES_KEY = "arch_trace_disputes";

type DisputeKey = string; // agent::tool::class or tool::resource

function disputeCellKey(agent: string, tool: string, cls: string): DisputeKey {
  return `${agent}::${tool}::${cls}`;
}

function loadDisputedCells(): Set<string> {
  try {
    const raw = localStorage.getItem(DISPUTES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { cells?: string[] };
    return new Set(parsed.cells ?? []);
  } catch {
    return new Set();
  }
}

function saveDisputedCells(set: Set<string>) {
  localStorage.setItem(DISPUTES_KEY, JSON.stringify({ cells: [...set] }));
}

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

function cellFor(tool: AgentTool, cls: ResourceClass): ClassCell {
  const fromCells = tool.reach?.cells?.[cls];
  if (fromCells) return fromCells;
  const resources = (tool.reach?.resources ?? []).filter((r) => r.class === cls);
  if (resources.length) {
    const best = resources.reduce((a, b) => (a.depth <= b.depth ? a : b));
    return {
      state: "reaches",
      depth: best.depth,
      path: best.path,
      reason: null,
      resources,
    };
  }
  if (!tool.handler || tool.reach?.truncated) {
    return {
      state: "not-traced",
      depth: null,
      path: null,
      reason:
        tool.reach?.truncationReasons?.[0] ??
        tool.reach?.truncationNote ??
        (!tool.handler ? "unresolved-handler" : "walk truncated"),
      resources: [],
    };
  }
  return { state: "none", depth: null, path: null, reason: null, resources: [] };
}

function toolReachesPatient(tool: AgentTool): boolean {
  return cellFor(tool, "patient").state === "reaches";
}
function toolReachesMoney(tool: AgentTool): boolean {
  return cellFor(tool, "money").state === "reaches";
}

function CellMark({
  state,
  depth,
  active,
  disputed,
  reason,
  onClick,
  cls,
}: {
  state: CellState;
  depth: number | null;
  active: boolean;
  disputed: boolean;
  reason: string | null;
  onClick: () => void;
  cls: ResourceClass;
}) {
  if (state === "none") {
    return (
      <span title="Walk completed — no path found" style={{ color: "#374151" }}>
        ·
      </span>
    );
  }
  if (state === "not-traced") {
    return (
      <button
        type="button"
        title={reason ?? "not traced"}
        onClick={onClick}
        style={{
          width: disputed ? 22 : 14,
          height: 14,
          borderRadius: 2,
          border: active
            ? "1px solid #fde68a"
            : disputed
              ? "1px solid #f472b6"
              : "1px dashed #b45309",
          background: disputed ? "rgba(244,114,182,0.15)" : "transparent",
          color: "#f59e0b",
          cursor: "pointer",
          padding: 0,
          fontSize: 10,
          lineHeight: "12px",
        }}
      >
        ?
      </button>
    );
  }
  const bg =
    cls === "patient"
      ? "#f87171"
      : cls === "money"
        ? "#fbbf24"
        : cls === "external"
          ? "#60a5fa"
          : cls === "unclassified"
            ? "#a78bfa"
            : "#6b7280";
  const depthLabel = depth == null ? "" : String(depth);
  return (
    <button
      type="button"
      data-testid="reach-cell"
      data-reach-state="reaches"
      title={`reaches at depth ${depth ?? "?"}${disputed ? " (disputed)" : ""}`}
      onClick={onClick}
      style={{
        minWidth: depthLabel ? 22 : 14,
        height: 16,
        borderRadius: 3,
        border: active
          ? "1px solid #93c5fd"
          : disputed
            ? "1px solid #f472b6"
            : "1px solid transparent",
        background: disputed ? "rgba(244,114,182,0.25)" : bg,
        cursor: "pointer",
        padding: "0 3px",
        fontSize: 9,
        fontWeight: 700,
        color: disputed ? "#fce7f3" : "#0f172a",
        lineHeight: "14px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {depthLabel}
    </button>
  );
}

function EvidenceChain({
  tool,
  surface,
  cls,
  cell,
}: {
  tool: AgentTool;
  surface: AgentSurface;
  cls: ResourceClass;
  cell: ClassCell;
}) {
  const primary: ReachResource | null =
    cell.resources.length > 0
      ? cell.resources.reduce((a, b) => (a.depth <= b.depth ? a : b))
      : null;

  return (
    <div style={{ marginTop: 10, fontSize: 11, color: "#d1d5db", lineHeight: 1.55 }}>
      <div style={{ color: "#f3f4f6", fontWeight: 600 }}>
        {tool.name}
        <span style={{ color: "#9ca3af", fontWeight: 400, marginLeft: 8 }}>
          → {cls} ({cell.state}
          {cell.state === "reaches" && cell.depth != null ? ` · depth ${cell.depth}` : ""})
        </span>
      </div>
      {tool.description && (
        <div style={{ marginTop: 4, color: "#9ca3af" }}>
          model description: {tool.description}
        </div>
      )}
      {tool.handler && (
        <div style={{ marginTop: 6, color: "#93c5fd" }}>
          handler {tool.handler}
        </div>
      )}
      {!tool.handler && (
        <div style={{ marginTop: 6, color: "#f59e0b" }}>
          no handler resolved on {fileName(surface.file)}
        </div>
      )}

      {cell.state === "not-traced" && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px dashed #b45309",
            background: "rgba(120,53,15,0.2)",
            color: "#fbbf24",
          }}
        >
          Stopped: {cell.reason}
          {(tool.reach?.truncationReasons?.length ?? 0) > 1 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#fcd34d" }}>
              {tool.reach!.truncationReasons!.slice(0, 6).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {cell.state === "none" && (
        <div style={{ marginTop: 8, color: "#6b7280" }}>
          Walk completed with no path to {cls}.
        </div>
      )}

      {cell.resources.map((r) => {
        const hops =
          r.hops && r.hops.length > 0
            ? r.hops
            : (r.path ?? []).map((label) => ({
                file: label.split(":")[0] ?? label,
                line: null as number | null,
                snippet: label,
                label,
              }));
        return (
          <div
            key={`${r.kind}:${r.name}:${r.depth}`}
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "rgba(15,23,42,0.6)",
            }}
          >
            <div style={{ color: "#93c5fd" }}>
              {r.kind}:{r.name}{" "}
              <span style={{ color: "#6b7280" }}>depth {r.depth}</span>
              {r.guess && (
                <span style={{ color: "#fbbf24", marginLeft: 8 }}>guess</span>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              {hops.map((h, i) => (
                <div
                  key={`${h.label}-${i}`}
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 6,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ color: "#4b5563", minWidth: 14 }}>{i + 1}.</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#e5e7eb" }}>
                      {h.file}
                      {h.line != null ? `:${h.line}` : ""}
                      {h.label && h.label !== h.file && (
                        <span style={{ color: "#6b7280", marginLeft: 8 }}>{h.label}</span>
                      )}
                    </div>
                    {h.snippet && (
                      <pre
                        style={{
                          margin: "4px 0 0",
                          padding: "6px 8px",
                          borderRadius: 4,
                          background: "#0b1220",
                          color: "#a5b4fc",
                          fontSize: 10,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          border: "1px solid #1f2937",
                        }}
                      >
                        {h.snippet}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {(r.proof || r.evidence) && (
              <div style={{ marginTop: 8, color: "#86efac", fontSize: 10 }}>
                proof: {r.proof ?? r.evidence}
              </div>
            )}
          </div>
        );
      })}

      {primary && cell.state === "reaches" && (
        <div style={{ marginTop: 8, color: "#4b5563", fontSize: 10 }}>
          shortest path: {(primary.path ?? []).join(" → ")}
        </div>
      )}
    </div>
  );
}

export default function ReachView({ agents }: Props) {
  const agentSurfaces = useMemo(() => {
    const list = (agents?.agents ?? []).filter((a) => a.kind === "agent");
    return list.sort((a, b) => a.file.localeCompare(b.file));
  }, [agents]);

  const [selected, setSelected] = useState<{
    agent: string;
    tool: string;
    cls: ResourceClass;
  } | null>(null);

  const [disputed, setDisputed] = useState<Set<string>>(() => loadDisputedCells());
  const [disputeStatus, setDisputeStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/resources/disputes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.disputes) return;
        setDisputed((prev) => {
          const next = new Set(prev);
          for (const d of data.disputes) {
            if (d.agent && d.class) next.add(disputeCellKey(d.agent, d.tool, d.class));
          }
          saveDisputedCells(next);
          return next;
        });
      })
      .catch(() => {
        /* localStorage only */
      });
  }, []);

  const selectedTool: { surface: AgentSurface; tool: AgentTool } | null =
    useMemo(() => {
      if (!selected) return null;
      const surface = agentSurfaces.find((a) => a.file === selected.agent);
      const tool = surface?.tools?.find((t) => t.name === selected.tool);
      if (!surface || !tool) return null;
      return { surface, tool };
    }, [selected, agentSurfaces]);

  const selectedCell = selectedTool
    ? cellFor(selectedTool.tool, selected!.cls)
    : null;

  const anyResolved = agentSurfaces.some((a) =>
    (a.tools ?? []).some((t) => t.name !== "(hosted)" && t.handler)
  );

  const { unclassifiedCount, notTracedCells, totalCells } = useMemo(() => {
    const names = new Set<string>();
    let notTraced = 0;
    let total = 0;
    for (const a of agentSurfaces) {
      for (const t of (a.tools ?? []).filter((x) => x.name !== "(hosted)")) {
        for (const c of COLUMNS) {
          total++;
          const cell = cellFor(t, c);
          if (cell.state === "not-traced") notTraced++;
          if (cell.state === "reaches") {
            for (const r of cell.resources) {
              if (r.class === "unclassified") names.add(`${r.kind}:${r.name}`);
            }
          }
        }
      }
    }
    return { unclassifiedCount: names.size, notTracedCells: notTraced, totalCells: total };
  }, [agentSurfaces]);

  async function markLooksWrong() {
    if (!selected || !selectedTool || !selectedCell) return;
    const primary =
      selectedCell.resources[0] ??
      ({
        kind: "service",
        name: selected.cls,
      } as { kind: string; name: string });
    const resource = `${primary.kind}:${primary.name}`;
    const claim = selectedCell.state;
    const body = {
      tool: selected.tool,
      resource,
      claim,
      agent: selected.agent,
      class: selected.cls,
      reason: selectedCell.reason ?? undefined,
    };
    const key = disputeCellKey(selected.agent, selected.tool, selected.cls);
    setDisputed((prev) => {
      const next = new Set(prev);
      next.add(key);
      saveDisputedCells(next);
      return next;
    });
    setDisputeStatus("Recording…");
    try {
      const res = await fetch("/api/resources/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setDisputeStatus("Saved to trace-disputes.json");
    } catch (e) {
      setDisputeStatus(
        `Marked locally (file write failed: ${e instanceof Error ? e.message : String(e)})`
      );
    }
  }

  if (!agents || agentSurfaces.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 32,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#d1d5db",
          background: "rgba(6,12,26,0.4)",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "#f3f4f6" }}>No agents to measure</h2>
        <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 520, lineHeight: 1.5 }}>
          Reach needs kind=agent surfaces with tools. Re-scan a repository that has tool-loop or
          hosted agents.
        </p>
      </div>
    );
  }

  if (!anyResolved) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 32,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#d1d5db",
          background: "rgba(6,12,26,0.4)",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "#f3f4f6" }}>
          No tool handlers resolved
        </h2>
        <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 560, lineHeight: 1.5 }}>
          Every tool is not-traced until a handler at file:line exists. Re-scan after handlers are
          in-repo, or open Resources once surfaces appear.
        </p>
      </div>
    );
  }

  const selectedDisputed =
    selected != null &&
    disputed.has(disputeCellKey(selected.agent, selected.tool, selected.cls));

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "rgba(6,12,26,0.35)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid #30363d",
          fontSize: 12,
          color: "#fbbf24",
          background: "rgba(120,53,15,0.25)",
        }}
      >
        {notTracedCells} of {totalCells} cells are untraced. Filled digit = reaches at that depth · ·
        = none · ? = not-traced. Pink border = disputed. Click any claim for the evidence chain.
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px 40px" }}>
        {agentSurfaces.map((surface) => {
          const tools = (surface.tools ?? []).filter((t) => t.name !== "(hosted)");
          const patientN = tools.filter(toolReachesPatient).length;
          const moneyN = tools.filter(toolReachesMoney).length;
          const auth = surface.auth;
          const untracedHere = tools.reduce((n, t) => {
            return n + COLUMNS.filter((c) => cellFor(t, c).state === "not-traced").length;
          }, 0);

          return (
            <div key={surface.file} style={{ marginBottom: 28 }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px 20px",
                  alignItems: "baseline",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #30363d",
                  background: "rgba(17,24,39,0.85)",
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "#f3f4f6" }}>
                  {fileName(surface.file)}
                </span>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>{tools.length} tools</span>
                <span style={{ fontSize: 11, color: "#fca5a5" }}>{patientN} reach patient</span>
                <span style={{ fontSize: 11, color: "#fcd34d" }}>{moneyN} reach money</span>
                <span style={{ fontSize: 11, color: "#f59e0b" }}>{untracedHere} cells untraced</span>
                <span
                  style={{
                    fontSize: 11,
                    color: auth?.found ? "#86efac" : "#f87171",
                    maxWidth: 420,
                  }}
                  title={auth?.evidence}
                >
                  {auth?.found ? `Auth found — ${auth.location}` : "No auth found before tools"}
                </span>
              </div>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11,
                  color: "#d1d5db",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        borderBottom: "1px solid #30363d",
                        color: "#6b7280",
                        fontWeight: 500,
                        width: "28%",
                      }}
                    >
                      Tool
                    </th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c}
                        style={{
                          textAlign: "center",
                          padding: "6px 8px",
                          borderBottom: "1px solid #30363d",
                          color: c === "unclassified" ? "#fbbf24" : "#6b7280",
                          fontWeight: 500,
                          width: "14%",
                        }}
                      >
                        {c === "unclassified" ? (
                          <span>
                            unclassified ({unclassifiedCount})
                            <br />
                            <a
                              href="/resources.classify.json"
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#93c5fd", fontSize: 10 }}
                            >
                              open resources.classify.json
                            </a>
                          </span>
                        ) : (
                          c
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => (
                    <tr key={tool.name}>
                      <td
                        style={{
                          padding: "5px 8px",
                          borderBottom: "1px solid #21262d",
                          color: tool.handler ? "#e5e7eb" : "#6b7280",
                        }}
                        title={tool.handler ?? tool.note ?? "no handler"}
                      >
                        {tool.name}
                        {!tool.handler && (
                          <span style={{ color: "#4b5563", marginLeft: 6 }}>no handler</span>
                        )}
                      </td>
                      {COLUMNS.map((cls) => {
                        const cell = cellFor(tool, cls);
                        const active =
                          selected?.agent === surface.file &&
                          selected?.tool === tool.name &&
                          selected?.cls === cls;
                        const isDisputed = disputed.has(
                          disputeCellKey(surface.file, tool.name, cls)
                        );
                        return (
                          <td
                            key={cls}
                            style={{
                              textAlign: "center",
                              padding: "5px 8px",
                              borderBottom: "1px solid #21262d",
                            }}
                          >
                            <CellMark
                              state={cell.state}
                              depth={cell.depth}
                              active={active}
                              disputed={isDisputed}
                              reason={cell.reason}
                              cls={cls}
                              onClick={() =>
                                setSelected({
                                  agent: surface.file,
                                  tool: tool.name,
                                  cls,
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {selected && selectedTool && selectedCell && (
        <div
          style={{
            borderTop: "1px solid #30363d",
            background: "rgba(17,24,39,0.97)",
            padding: "12px 20px 16px",
            maxHeight: 340,
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Evidence</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                onClick={markLooksWrong}
                disabled={selectedDisputed}
                style={{
                  background: selectedDisputed ? "rgba(244,114,182,0.2)" : "transparent",
                  border: "1px solid #f472b6",
                  color: "#f9a8d4",
                  borderRadius: 4,
                  padding: "4px 10px",
                  cursor: selectedDisputed ? "default" : "pointer",
                  fontSize: 11,
                }}
              >
                {selectedDisputed ? "Disputed" : "This looks wrong"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setDisputeStatus(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                close
              </button>
            </div>
          </div>
          {disputeStatus && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#f9a8d4" }}>{disputeStatus}</div>
          )}
          <EvidenceChain
            tool={selectedTool.tool}
            surface={selectedTool.surface}
            cls={selected.cls}
            cell={selectedCell}
          />
        </div>
      )}
    </div>
  );
}
