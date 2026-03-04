import { useState, useEffect } from "react";
import { vscode } from "./vscode";
import type { ArchNode, ArchGraph } from "./types";

const LAYER_OPTIONS = [
  "Presentation",
  "Business Logic",
  "External Services",
  "Data Access",
  "Infrastructure",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

interface Props {
  node: ArchNode;
  graph: ArchGraph;
  onClose: () => void;
  onSaveContext: (layer: string, description: string) => void;
  writeStatus: "idle" | "success" | "error";
  writeError: string | null;
  fileContentMap?: Record<string, { content: string | null; error?: string }>;
  onClearFileContent?: () => void;
}

export function NodePopup({
  node,
  graph,
  onClose,
  onSaveContext,
  writeStatus,
  writeError,
  fileContentMap = {},
  onClearFileContent,
}: Props) {
  const [showContext, setShowContext] = useState(false);
  const [editLayer, setEditLayer] = useState(node.layer ?? "Uncategorized");
  const [editDescription, setEditDescription] = useState(node.description ?? "");
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const inbound = graph.edges.filter((e) => e.target === node.id);
  const outbound = graph.edges.filter((e) => e.source === node.id);

  /** Path relative to module for extension API (extension echoes this back as key) */
  const getRelPath = (f: string) =>
    node.id === "." ? f : f.startsWith(node.id + "/") ? f.slice(node.id.length + 1) : f;

  const handleViewFile = (filePath: string) => {
    const relPath = getRelPath(filePath);
    setActiveFile(relPath);
    setOpenFiles((prev) => (prev.includes(relPath) ? prev : [...prev, relPath]));
    vscode.postMessage({ type: "readFileContent", nodeId: node.id, filePath: relPath });
  };

  const closeFile = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenFiles((prev) => prev.filter((f) => f !== filePath));
    setActiveFile((current) => (current === filePath ? null : current));
  };

  const closeAllFiles = () => {
    setOpenFiles([]);
    setActiveFile(null);
    onClearFileContent?.();
  };

  useEffect(() => {
    return () => onClearFileContent?.();
  }, [onClearFileContent]);

  const activeData = activeFile ? fileContentMap[activeFile] : null;
  const activeLoading = activeFile && openFiles.includes(activeFile) && !(activeFile in fileContentMap);

  return (
    <>
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
          width: "min(1000px, 95vw)",
          height: "min(560px, 85vh)",
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "nodePopupFadeIn 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #30363d",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#e6edf3" }}>
              {node.suggestedLabel ?? node.label}
            </span>
            {node.role && (
              <span style={{ fontSize: 12, color: "#7d8590", marginLeft: 8 }}>{node.role}</span>
            )}
            <div style={{ fontSize: 11, color: "#58a6ff", marginTop: 2, wordBreak: "break-all" }}>
              {node.id}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => vscode.postMessage({ type: "openInEditor", nodeId: node.id })}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                background: "#238636",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Open in editor
            </button>
            <button
              onClick={onClose}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                background: "#21262d",
                color: "#8b949e",
                border: "1px solid #30363d",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Left panel: file list + health + connections + context + correct architecture */}
          <div
            style={{
              width: 260,
              flexShrink: 0,
              borderRight: "1px solid #30363d",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 12,
                  fontSize: 12,
                }}
              >
                {[
                  { label: "Docs", ok: node.health?.hasDocs },
                  { label: "Tests", ok: node.health?.hasTests },
                  { label: "Context", ok: node.health?.hasContext },
                ].map(({ label, ok }) => (
                  <span key={label} style={{ color: ok ? "#3fb950" : "#f85149" }}>
                    {label}: {ok ? "✓" : "—"}
                  </span>
                ))}
              </div>

              {node.files && node.files.length > 0 && (
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
                      border: "1px solid #30363d",
                      overflowY: "auto",
                      maxHeight: 140,
                    }}
                  >
                    {node.files.map((f) => {
                      const relPath = getRelPath(f);
                      const fileName = f.split("/").pop() ?? f;
                      const isOpen = openFiles.includes(relPath);
                      const isActive = activeFile === relPath;
                      return (
                        <div
                          key={f}
                          onClick={() => handleViewFile(f)}
                          style={{
                            padding: "6px 10px",
                            borderBottom: "1px solid #21262d",
                            color: isActive ? "#22d3ee" : isOpen ? "#58a6ff" : "#8b949e",
                            cursor: "pointer",
                            background: isActive ? "#21262d" : "transparent",
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
                            <div key={e.id}>
                              ← {src?.suggestedLabel ?? src?.label ?? e.source}
                            </div>
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
                            <div key={e.id}>
                              → {tgt?.suggestedLabel ?? tgt?.label ?? e.target}
                            </div>
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

              {node.isDrift && (
                <div
                  style={{
                    marginBottom: 12,
                    color: "#f0883e",
                    fontSize: 11,
                    background: "#1a1008",
                    padding: "6px 10px",
                    borderRadius: 6,
                  }}
                >
                  ⚠ Architectural drift
                </div>
              )}

              {node.contextRawContent && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => setShowContext((v) => !v)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      background: "#21262d",
                      color: "#8b949e",
                      border: "1px solid #30363d",
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
                        border: "1px solid #30363d",
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

              <div
                style={{
                  paddingTop: 12,
                  borderTop: "1px solid #30363d",
                }}
              >
                <div style={{ fontSize: 11, color: "#7d8590", marginBottom: 8 }}>
                  Correct architecture
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: "block", fontSize: 10, color: "#8b949e", marginBottom: 4 }}>
                    Layer
                  </label>
                  <select
                    value={editLayer}
                    onChange={(e) => setEditLayer(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      color: "#e6edf3",
                      fontSize: 12,
                    }}
                  >
                    {LAYER_OPTIONS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ display: "block", fontSize: 10, color: "#8b949e", marginBottom: 4 }}>
                    Description
                  </label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    placeholder="What this module does..."
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      color: "#e6edf3",
                      fontSize: 12,
                      resize: "none",
                      outline: "none",
                    }}
                  />
                </div>
                <button
                  onClick={() => onSaveContext(editLayer, editDescription)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "#238636",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Save to .context.md
                </button>
                {writeStatus === "success" && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#3fb950" }}>✓ Saved</div>
                )}
                {writeStatus === "error" && writeError && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#f85149" }}>{writeError}</div>
                )}
              </div>
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
                    alignItems: "flex-end",
                    gap: 2,
                    padding: "0 12px",
                    background: "#161b22",
                    borderBottom: "1px solid #30363d",
                    overflowX: "auto",
                  }}
                >
                  {openFiles.map((f) => {
                    const label = f.split("/").pop() ?? f;
                    const isActive = activeFile === f;
                    const isHovered = hoveredTab === f && !isActive;
                    return (
                      <div
                        key={f}
                        onClick={() => setActiveFile(f)}
                        onMouseEnter={() => setHoveredTab(f)}
                        onMouseLeave={() => setHoveredTab(null)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 12px",
                          fontSize: 12,
                          fontFamily: "monospace",
                          background: isActive ? "#0d1117" : isHovered ? "#21262d" : "transparent",
                          color: isActive ? "#e6edf3" : "#8b949e",
                          borderBottom: isActive ? "2px solid #238636" : "2px solid transparent",
                          cursor: "pointer",
                          marginBottom: -1,
                          transition: "background 0.15s, color 0.15s",
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
                            color: "#64748b",
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
                      border: "1px solid #30363d",
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
                    fontFamily: "monospace",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: "#e6edf3",
                  }}
                >
                  {activeLoading && <span style={{ color: "#7d8590" }}>Loading…</span>}
                  {activeData?.error && (
                    <span style={{ color: "#f85149" }}>{activeData.error}</span>
                  )}
                  {activeData?.content != null && (
                    <>
                      <pre style={{ margin: 0, fontFamily: "inherit", fontSize: "inherit" }}>
                        {activeData.content}
                      </pre>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (activeFile) {
                            vscode.postMessage({
                              type: "openFile",
                              nodeId: node.id,
                              filePath: activeFile,
                            });
                          }
                        }}
                        style={{
                          display: "inline-block",
                          marginTop: 12,
                          fontSize: 11,
                          color: "#58a6ff",
                          textDecoration: "none",
                        }}
                      >
                        Open in editor ↗
                      </a>
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
        </div>
      </div>
    </>
  );
}
