/**
 * Reach matrix — tools × sensitivity columns, derived from inventory reach traces.
 * Does not modify Agents view layout or the module graph.
 */
import { useMemo, useState } from "react";
import type {
  AgentInventoryResult,
  AgentSurface,
  AgentTool,
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

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

function classesReached(tool: AgentTool): Set<ResourceClass> {
  const s = new Set<ResourceClass>();
  for (const r of tool.reach?.resources ?? []) s.add(r.class);
  return s;
}

function resourcesForClass(tool: AgentTool, cls: ResourceClass): ReachResource[] {
  return (tool.reach?.resources ?? []).filter((r) => r.class === cls);
}

function toolReachesPatient(tool: AgentTool): boolean {
  return classesReached(tool).has("patient");
}
function toolReachesMoney(tool: AgentTool): boolean {
  return classesReached(tool).has("money");
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

  const selectedResources = selectedTool
    ? resourcesForClass(selectedTool.tool, selected!.cls)
    : [];

  const anyResolved = agentSurfaces.some((a) =>
    (a.tools ?? []).some((t) => t.name !== "(hosted)" && t.handler)
  );

  const unclassifiedCount = useMemo(() => {
    const names = new Set<string>();
    for (const a of agentSurfaces) {
      for (const t of a.tools ?? []) {
        for (const r of t.reach?.resources ?? []) {
          if (r.class === "unclassified") names.add(`${r.kind}:${r.name}`);
        }
      }
    }
    return names.size;
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
    const reasons = agentSurfaces.map((a) => {
      const tools = (a.tools ?? []).filter((t) => t.name !== "(hosted)");
      const missing = tools.filter((t) => !t.handler);
      return {
        file: a.file,
        total: tools.length,
        missing: missing.length,
        note:
          missing[0]?.note ||
          "No case 'toolName' handler found in-repo (hosted console–only or unresolved dispatch).",
      };
    });
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
        <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 560, lineHeight: 1.5, marginBottom: 16 }}>
          Reach walks outward from a handler at file:line. These agents had tools but no resolvable
          handlers:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#9ca3af", lineHeight: 1.7 }}>
          {reasons.map((r) => (
            <li key={r.file}>
              <span style={{ color: "#e5e7eb" }}>{fileName(r.file)}</span> — {r.missing}/{r.total}{" "}
              without handler. {r.note}
            </li>
          ))}
        </ul>
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
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px 40px" }}>
        {agentSurfaces.map((surface) => {
          const tools = (surface.tools ?? []).filter((t) => t.name !== "(hosted)");
          const patientN = tools.filter(toolReachesPatient).length;
          const moneyN = tools.filter(toolReachesMoney).length;
          const auth = surface.auth;

          return (
            <div key={surface.file} style={{ marginBottom: 28 }}>
              {/* Summary strip */}
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
                <span style={{ fontSize: 11, color: "#9ca3af" }}>
                  {tools.length} tools
                </span>
                <span style={{ fontSize: 11, color: "#fca5a5" }}>
                  {patientN} reach patient
                </span>
                <span style={{ fontSize: 11, color: "#fcd34d" }}>
                  {moneyN} reach money
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: auth?.found ? "#86efac" : "#f87171",
                    maxWidth: 480,
                  }}
                  title={auth?.evidence}
                >
                  {auth?.found
                    ? `Auth found — ${auth.location}`
                    : "No auth found before tools"}
                </span>
              </div>

              {/* Matrix */}
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
                  {tools.map((tool) => {
                    const reached = classesReached(tool);
                    return (
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
                          {tool.reach?.truncated && (
                            <span
                              style={{ color: "#f59e0b", marginLeft: 6 }}
                              title={tool.reach.truncationNote ?? "depth truncated"}
                            >
                              ⋯
                            </span>
                          )}
                        </td>
                        {COLUMNS.map((cls) => {
                          const filled = reached.has(cls);
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
                              {filled ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelected({
                                      agent: surface.file,
                                      tool: tool.name,
                                      cls,
                                    })
                                  }
                                  title={`Show path to ${cls}`}
                                  style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: 3,
                                    border: active ? "1px solid #93c5fd" : "1px solid transparent",
                                    background:
                                      cls === "patient"
                                        ? "#f87171"
                                        : cls === "money"
                                          ? "#fbbf24"
                                          : cls === "external"
                                            ? "#60a5fa"
                                            : cls === "unclassified"
                                              ? "#a78bfa"
                                              : "#6b7280",
                                    cursor: "pointer",
                                    padding: 0,
                                  }}
                                />
                              ) : (
                                <span style={{ color: "#1f2937" }}>·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Path detail panel */}
      {selected && selectedTool && (
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
              {selectedTool.tool.name} → {selected.cls}
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
          {selectedResources.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>No resources in this class.</div>
          )}
          {selectedResources.map((r) => (
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
