/**
 * Reach matrix — tools × sensitivity columns with three cell states:
 * reaches | none | not-traced.
 */
import { useMemo, useState } from "react";
import type {
  AgentInventoryResult,
  AgentSurface,
  AgentTool,
  CellState,
  ClassCell,
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

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

function cellFor(tool: AgentTool, cls: ResourceClass): ClassCell {
  const fromCells = tool.reach?.cells?.[cls];
  if (fromCells) return fromCells;
  // Backward compat for older scans without cells
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
  active,
  reason,
  onClick,
  cls,
}: {
  state: CellState;
  active: boolean;
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
          width: 14,
          height: 14,
          borderRadius: 2,
          border: active ? "1px solid #fde68a" : "1px dashed #b45309",
          background: "transparent",
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
  return (
    <button
      type="button"
      title="Show path"
      onClick={onClick}
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        border: active ? "1px solid #93c5fd" : "1px solid transparent",
        background: bg,
        cursor: "pointer",
        padding: 0,
      }}
    />
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
        {notTracedCells} of {totalCells} cells are untraced (depth limit, module cap, unresolved
        handler, or dynamic dispatch). Filled = reaches · · = none · ? = not-traced.
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
                              active={active}
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
            background: "rgba(17,24,39,0.95)",
            padding: "12px 20px 16px",
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 12, color: "#f3f4f6" }}>
              {selectedTool.tool.name} → {selected.cls}{" "}
              <span style={{ color: "#9ca3af" }}>({selectedCell.state})</span>
              {selectedTool.tool.handler && (
                <span style={{ color: "#6b7280", marginLeft: 8 }}>
                  handler {selectedTool.tool.handler}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
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
          {selectedCell.state === "not-traced" && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#fbbf24" }}>
              {selectedCell.reason}
            </div>
          )}
          {selectedCell.state === "none" && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>
              Walk completed with no path to {selected.cls}.
            </div>
          )}
          {selectedCell.resources.map((r) => (
            <div
              key={`${r.kind}:${r.name}:${r.depth}`}
              style={{
                marginTop: 10,
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #30363d",
                fontSize: 11,
                color: "#d1d5db",
              }}
            >
              <div style={{ color: "#93c5fd" }}>
                {r.kind}:{r.name}{" "}
                <span style={{ color: "#6b7280" }}>depth {r.depth}</span>
                {r.guess && (
                  <span style={{ color: "#fbbf24", marginLeft: 8 }}>guess</span>
                )}
              </div>
              <div style={{ marginTop: 4, color: "#9ca3af", lineHeight: 1.5 }}>
                {r.path.join(" → ")}
              </div>
              <div style={{ marginTop: 4, color: "#4b5563" }}>{r.evidence}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
