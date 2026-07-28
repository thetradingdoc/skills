import { useState, useCallback, useEffect } from "react";
import type { ArchNode, ArchGraph } from "./types";
import { LAYER_CFG } from "./layerPalette";

const API_BASE = "/api";

type TabId = "overview" | "traces" | "memory" | "state" | "eval";

interface AgentTrace {
  id?: string;
  question?: string;
  agent_answer?: string;
  agent_model?: string;
  critic_score?: string | null;
  agent_latency_ms?: number | null;
  langsmith_url?: string | null;
  created_at?: string;
}

interface Props {
  node: ArchNode;
  graph: ArchGraph;
  repoUrl?: string;
  onClose: () => void;
  workspaceId?: string | null;
  accessToken?: string | null;
}

type FileState = "loading" | { content: string } | { error: string };

export function NodePopup({ node, graph, repoUrl, onClose, workspaceId, accessToken }: Props) {
  const [showContext, setShowContext] = useState(false);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [tracesError, setTracesError] = useState<string | null>(null);
  const [evalData, setEvalData] = useState<{ avgLatency?: number; avgScore?: number; count?: number } | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [memories, setMemories] = useState<Array<{ id?: string; content?: string; memory_type?: string; created_at?: string }>>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [todoCreating, setTodoCreating] = useState(false);
  const [todoError, setTodoError] = useState<string | null>(null);

  const inbound = graph.edges.filter((e) => e.target === node.id);
  const outbound = graph.edges.filter((e) => e.source === node.id);
  const baseRepo = repoUrl?.replace(/\.git\/?$/, "") ?? "";
  const cfg = LAYER_CFG[(node.layer ?? "Uncategorized") as string] ?? LAYER_CFG["Uncategorized"];

  const fetchFileContent = useCallback(
    async (filePath: string) => {
      if (!repoUrl) return;
      setActiveFile(filePath);
      setOpenFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
      const existing = fileStates[filePath];
      if (existing) return; // already loaded or loading
      setFileStates((prev) => ({ ...prev, [filePath]: "loading" }));
      try {
        const res = await fetch(`${API_BASE}/file-content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl, filePath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load file");
        setFileStates((prev) => ({ ...prev, [filePath]: { content: data.content ?? "" } }));
      } catch (err) {
        setFileStates((prev) => ({
          ...prev,
          [filePath]: { error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [repoUrl, fileStates]
  );

  const closeFile = useCallback((filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenFiles((prev) => prev.filter((f) => f !== filePath));
    setFileStates((prev) => {
      const next = { ...prev };
      delete next[filePath];
      return next;
    });
    setActiveFile((current) => (current === filePath ? null : current));
  }, []);

  const closeAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFile(null);
    setFileStates({});
  }, []);

  useEffect(() => {
    if (activeTab !== "traces" || !accessToken) return;
    setTracesLoading(true);
    setTracesError(null);
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    params.set("nodeId", node.id);
    params.set("limit", "20");
    fetch(`${API_BASE}/metrics/agent?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.traces) setTraces(data.traces);
        else setTracesError(data.error ?? "No traces");
      })
      .catch((e) => setTracesError(e instanceof Error ? e.message : "Failed to load traces"))
      .finally(() => setTracesLoading(false));
  }, [activeTab, accessToken, workspaceId, node.id]);

  useEffect(() => {
    if (activeTab !== "eval" || !accessToken) return;
    setEvalLoading(true);
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    params.set("nodeId", node.id);
    params.set("limit", "50");
    fetch(`${API_BASE}/metrics/agent?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.traces?.length) {
          const t = data.traces;
          const withLatency = t.filter((x: AgentTrace) => x.agent_latency_ms != null);
          const withScore = t.filter((x: AgentTrace) => x.critic_score != null);
          setEvalData({
            count: t.length,
            avgLatency: withLatency.length
              ? withLatency.reduce((s: number, x: AgentTrace) => s + (x.agent_latency_ms ?? 0), 0) / withLatency.length
              : undefined,
            avgScore: withScore.length
              ? withScore.reduce((s: number, x: AgentTrace) => s + parseFloat(String(x.critic_score ?? 0)), 0) / withScore.length
              : undefined,
          });
        } else setEvalData(null);
      })
      .catch(() => setEvalData(null))
      .finally(() => setEvalLoading(false));
  }, [activeTab, accessToken, workspaceId, node.id]);

  useEffect(() => {
    if (activeTab !== "memory" || !accessToken || !workspaceId) return;
    setMemoriesLoading(true);
    fetch(`${API_BASE}/workspaces/${workspaceId}/memories?nodeId=${encodeURIComponent(node.id)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => setMemories(data.memories ?? []))
      .catch(() => setMemories([]))
      .finally(() => setMemoriesLoading(false));
  }, [activeTab, accessToken, workspaceId, node.id]);

  const activeState = activeFile ? fileStates[activeFile] : null;

  return (
    <>
      <style>{`@keyframes popupIn{from{opacity:0;transform:translate(-50%,-50%) scale(0.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(2px)",
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 1001,
          width: "min(800px, 95vw)",
          maxWidth: "95vw",
          height: "min(520px, 90vh)",
          maxHeight: "90vh",
          background: `linear-gradient(150deg, ${cfg.dim}, #0c1220)`,
          border: `1px solid ${cfg.accent}66`,
          borderRadius: 12,
          boxShadow: [
            `0 4px 0 ${cfg.accent}33`,
            `0 8px 0 ${cfg.accent}18`,
            `0 24px 48px rgba(0,0,0,0.5)`,
          ].join(", "),
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "popupIn 0.18s cubic-bezier(0.34,1.56,0.64,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            height: 4,
            background: `linear-gradient(90deg, ${cfg.accent}88, ${cfg.color}, ${cfg.accent}88)`,
            borderRadius: "12px 12px 0 0",
          }}
        />
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${cfg.accent}33`,
            padding: "0 16px",
          }}
        >
          {[
            { id: "overview" as const, label: "Overview" },
            { id: "traces" as const, label: "Traces" },
            { id: "memory" as const, label: "Memory" },
            { id: "state" as const, label: "State" },
            { id: "eval" as const, label: "Evaluation" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "8px 12px",
                marginRight: 8,
                fontSize: 11,
                background: "transparent",
                border: "none",
                borderBottom: activeTab === tab.id ? `2px solid ${cfg.color}` : "2px solid transparent",
                color: activeTab === tab.id ? "#e2e8f0" : "#7d8590",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${cfg.accent}22`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>
              {node.suggestedLabel ?? node.label}
            </span>
            {node.role && (
              <span style={{ fontSize: 12, color: "#7d8590", marginLeft: 8 }}>{node.role}</span>
            )}
            <div style={{ fontSize: 11, color: cfg.color, marginTop: 2, wordBreak: "break-all" }}>
              {node.id}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {workspaceId && accessToken && (
              <button
                type="button"
                onClick={async () => {
                  if (todoCreating) return;
                  setTodoError(null);
                  setTodoCreating(true);
                  try {
                    const res = await fetch(
                      `${API_BASE}/greenfield/nodes/${encodeURIComponent(node.id)}/to-todo`,
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${accessToken}`,
                        },
                        body: JSON.stringify({ workspaceId }),
                      }
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      const msg = typeof data.error === "string" ? data.error : "Failed to create todo.";
                      setTodoError(msg);
                      return;
                    }
                    setTodoError(null);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    setTodoError(msg);
                  } finally {
                    setTodoCreating(false);
                  }
                }}
                style={{
                  padding: "6px 8px",
                  fontSize: 11,
                  borderRadius: 6,
                  border: "1px solid #4b5563",
                  background: "#020617",
                  color: "#e6edf3",
                  cursor: todoCreating ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {todoCreating ? "Creating…" : "Create todo"}
              </button>
            )}
            {baseRepo && (
              <a
                href={`${baseRepo}/tree/main/${node.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: cfg.color, textDecoration: "none" }}
              >
                Open on GitHub ↗
              </a>
            )}
            <button
              onClick={onClose}
              aria-label="Close popup"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: "#1e293b",
                color: "#8b949e",
                border: "1px solid #334155",
                borderRadius: 6,
                cursor: "pointer",
                minWidth: 44,
                minHeight: 36,
              }}
            >
              Close
            </button>
          </div>
        </div>

        {todoError && (
          <div
            style={{
              padding: "6px 16px",
              fontSize: 11,
              color: "#fecaca",
              background: "rgba(248,113,113,0.12)",
              borderBottom: "1px solid rgba(248,113,113,0.4)",
            }}
          >
            {todoError}
          </div>
        )}

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {activeTab !== "overview" ? (
            <div style={{ flex: 1, overflow: "auto", padding: 16, fontSize: 12 }}>
              {activeTab === "traces" && (
                <>
                  {!accessToken ? (
                    <p style={{ color: "#7d8590" }}>Sign in to view traces.</p>
                  ) : tracesLoading ? (
                    <p style={{ color: "#7d8590" }}>Loading traces…</p>
                  ) : tracesError ? (
                    <p style={{ color: "#f87171" }}>{tracesError}</p>
                  ) : traces.length === 0 ? (
                    <p style={{ color: "#7d8590" }}>No traces for this node yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {traces.map((t, i) => (
                        <div
                          key={t.id ?? i}
                          style={{
                            padding: 12,
                            background: "#1e293b",
                            borderRadius: 8,
                            border: "1px solid #334155",
                          }}
                        >
                          {t.question && (
                            <div style={{ fontWeight: 600, marginBottom: 6, color: "#e2e8f0" }}>
                              {t.question.slice(0, 120)}{t.question.length > 120 ? "…" : ""}
                            </div>
                          )}
                          {t.agent_model && (
                            <span style={{ fontSize: 10, color: "#7d8590", marginRight: 8 }}>
                              {t.agent_model}
                            </span>
                          )}
                          {t.agent_latency_ms != null && (
                            <span style={{ fontSize: 10, color: "#7d8590" }}>{t.agent_latency_ms}ms</span>
                          )}
                          {t.critic_score != null && (
                            <span style={{ fontSize: 10, color: "#8b949e", marginLeft: 8 }}>
                              score: {t.critic_score}
                            </span>
                          )}
                          {t.langsmith_url && (
                            <div style={{ marginTop: 6 }}>
                              <a
                                href={t.langsmith_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 10, color: "#22d3ee" }}
                              >
                                View in LangSmith →
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {activeTab === "memory" && (
                <>
                  {!accessToken || !workspaceId ? (
                    <p style={{ color: "#7d8590" }}>Sign in and load a workspace to view memories.</p>
                  ) : memoriesLoading ? (
                    <p style={{ color: "#7d8590" }}>Loading memories…</p>
                  ) : memories.length === 0 ? (
                    <p style={{ color: "#7d8590" }}>No architectural memories for this node yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {memories.map((m, i) => (
                        <div
                          key={m.id ?? i}
                          style={{
                            padding: 12,
                            background: "#1e293b",
                            borderRadius: 8,
                            border: "1px solid #334155",
                            fontSize: 11,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            color: "#e2e8f0",
                          }}
                        >
                          {(m.content ?? "").slice(0, 500)}
                          {(m.content?.length ?? 0) > 500 && "…"}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {activeTab === "state" && (
                <p style={{ color: "#7d8590" }}>Node state — coming soon.</p>
              )}
              {activeTab === "eval" && (
                <>
                  {!accessToken ? (
                    <p style={{ color: "#7d8590" }}>Sign in to view evaluation metrics.</p>
                  ) : evalLoading ? (
                    <p style={{ color: "#7d8590" }}>Loading…</p>
                  ) : evalData ? (
                    <div style={{ display: "flex", gap: 24 }}>
                      <div>
                        <span style={{ color: "#7d8590", fontSize: 11 }}>Traces</span>
                        <div style={{ fontSize: 18, fontWeight: 600, color: "#e2e8f0" }}>{evalData.count}</div>
                      </div>
                      {evalData.avgLatency != null && (
                        <div>
                          <span style={{ color: "#7d8590", fontSize: 11 }}>Avg latency</span>
                          <div style={{ fontSize: 18, fontWeight: 600, color: "#e2e8f0" }}>
                            {Math.round(evalData.avgLatency)}ms
                          </div>
                        </div>
                      )}
                      {evalData.avgScore != null && (
                        <div>
                          <span style={{ color: "#7d8590", fontSize: 11 }}>Avg critic score</span>
                          <div style={{ fontSize: 18, fontWeight: 600, color: "#e2e8f0" }}>
                            {evalData.avgScore.toFixed(1)}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: "#7d8590" }}>No evaluation data for this node.</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
          {/* Left panel: file list + connections */}
          <div
            style={{
              width: 200,
              flexShrink: 0,
              borderRight: "1px solid #1e293b",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
              {Array.isArray(node.files) && node.files.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#7d8590", marginBottom: 6, fontWeight: 600 }}>
                    Files ({node.files.length}) — click to open
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      background: "#0d1117",
                      borderRadius: 6,
                      border: "1px solid #1e293b",
                      overflowY: "auto",
                      maxHeight: 160,
                    }}
                  >
                    {node.files.map((f) => {
                      const fileName = f.split("/").pop() ?? f;
                      const isOpen = openFiles.includes(f);
                      const isActive = activeFile === f;
                      return (
                        <div
                          key={f}
                          onClick={() => (baseRepo ? fetchFileContent(f) : null)}
                          style={{
                            padding: "6px 10px",
                            borderBottom: "1px solid #1e293b",
                            color: baseRepo
                              ? isActive
                                ? "#22d3ee"
                                : isOpen
                                  ? "#58a6ff"
                                  : "#8b949e"
                              : "#7d8590",
                            cursor: baseRepo ? "pointer" : "default",
                            background: isActive ? "#1e293b" : "transparent",
                          }}
                        >
                          {isOpen && "● "}
                          {fileName}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(inbound.length > 0 || outbound.length > 0) && (
                <div style={{ marginBottom: 12 }}>
                  {inbound.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: "#7d8590", marginBottom: 4 }}>
                        Inbound ({inbound.length})
                      </div>
                      <div style={{ fontSize: 11, color: "#8b949e" }}>
                        {inbound.slice(0, 5).map((e) => {
                          const src = graph.nodes.find((n) => n.id === e.source);
                          return (
                            <div key={e.id}>← {src?.suggestedLabel ?? src?.label ?? e.source}</div>
                          );
                        })}
                        {inbound.length > 5 && (
                          <div style={{ color: "#7d8590" }}>+{inbound.length - 5} more</div>
                        )}
                      </div>
                    </div>
                  )}
                  {outbound.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "#7d8590", marginBottom: 4 }}>
                        Outbound ({outbound.length})
                      </div>
                      <div style={{ fontSize: 11, color: "#8b949e" }}>
                        {outbound.slice(0, 5).map((e) => {
                          const tgt = graph.nodes.find((n) => n.id === e.target);
                          return (
                            <div key={e.id}>→ {tgt?.suggestedLabel ?? tgt?.label ?? e.target}</div>
                          );
                        })}
                        {outbound.length > 5 && (
                          <div style={{ color: "#7d8590" }}>+{outbound.length - 5} more</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {node.contextRawContent && (
                <div>
                  <button
                    onClick={() => setShowContext((v) => !v)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      background: "#1e293b",
                      color: "#8b949e",
                      border: "1px solid #334155",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    {showContext ? "Hide" : "View"} .context.md
                  </button>
                  {showContext && (
                    <pre
                      style={{
                        marginTop: 6,
                        padding: 8,
                        background: "#0d1117",
                        border: "1px solid #1e293b",
                        borderRadius: 6,
                        fontSize: 10,
                        maxHeight: 80,
                        overflowY: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: "#8b949e",
                      }}
                    >
                      {node.contextRawContent}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: file tabs + content */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              background: "#0d1117",
            }}
          >
            {openFiles.length > 0 ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    padding: "8px 12px",
                    background: "#161b22",
                    borderBottom: "1px solid #1e293b",
                    overflowX: "auto",
                  }}
                >
                  {openFiles.map((f) => {
                    const label = f.split("/").pop() ?? f;
                    const isActive = activeFile === f;
                    return (
                      <div
                        key={f}
                        onClick={() => setActiveFile(f)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "6px 10px",
                          fontSize: 11,
                          fontFamily: "monospace",
                          background: isActive ? "#0d1117" : "#1e293b",
                          color: isActive ? "#e2e8f0" : "#8b949e",
                          borderRadius: 6,
                          cursor: "pointer",
                          border: `1px solid ${isActive ? "#334155" : "transparent"}`,
                        }}
                      >
                        {label}
                        <button
                          onClick={(e) => closeFile(f, e)}
                          style={{
                            padding: 0,
                            marginLeft: 2,
                            background: "none",
                            border: "none",
                            color: "#7d8590",
                            cursor: "pointer",
                            fontSize: 12,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    onClick={closeAllFiles}
                    style={{
                      marginLeft: 8,
                      padding: "4px 8px",
                      fontSize: 10,
                      background: "transparent",
                      color: "#7d8590",
                      border: "1px solid #334155",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    Close all
                  </button>
                </div>
                <div
                  style={{
                    flex: 1,
                    overflow: "auto",
                    padding: 12,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    lineHeight: 1.5,
                    whiteSpace: "pre",
                    color: "#e2e8f0",
                  }}
                >
                  {activeState === "loading" && (
                    <span style={{ color: "#7d8590" }}>Loading…</span>
                  )}
                  {activeState && typeof activeState === "object" && "error" in activeState && (
                    <span style={{ color: "#f87171" }}>{activeState.error}</span>
                  )}
                  {activeState && typeof activeState === "object" && "content" in activeState && (
                    <>
                      <code>{activeState.content}</code>
                      {baseRepo && activeFile && (
                        <div style={{ marginTop: 12 }}>
                          <a
                            href={`${baseRepo}/blob/main/${activeFile}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: cfg.color, textDecoration: "none" }}
                          >
                            Open on GitHub ↗
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#7d8590",
                  fontSize: 12,
                }}
              >
                Click a file on the left to view
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
