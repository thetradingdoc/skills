import { useState } from "react";
import type { ArchGraph, ArchNode } from "./types";

interface CodeViewerPanelProps {
  node: ArchNode | null | undefined;
  graph: ArchGraph | null | undefined;
  selectedNodeId: string | null;
}

export default function CodeViewerPanel({ node, graph, selectedNodeId }: CodeViewerPanelProps) {
  const [languageOpen, setLanguageOpen] = useState(true);

  if (!node) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          borderRadius: 8,
          border: "1px solid #1f2937",
          padding: 16,
          fontSize: 12,
          color: "#6b7280",
        }}
      >
        No file selected. Click a node in the graph to view its code context.
      </div>
    );
  }

  const primaryFile = node.files[0];
  const additionalFileCount = Math.max(0, (node.files?.length ?? 0) - 1);
  const filePathLabel =
    primaryFile && additionalFileCount > 0
      ? `${primaryFile} (+${additionalFileCount} more)`
      : primaryFile ?? "project files";

  const summary = node.summary ?? node.description ?? "No summary available for this node.";
  const lineInfo = node.lineRange
    ? `Lines ${node.lineRange[0]}–${node.lineRange[1]}`
    : "Full file";
  const tags = node.tags ?? [];
  const complexity = node.complexity ?? "unknown";

  const connections =
    graph && selectedNodeId
      ? graph.edges.filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
      : [];

  const typeBadgeColor = "#4a7c9b";

  const canOpenInVsCode = !!(graph?.projectRoot && primaryFile);
  const vscodeUrl = canOpenInVsCode
    ? `vscode://file/${encodeURIComponent(
        `${graph!.projectRoot.replace(/\/+$/, "")}/${primaryFile}`.replace(/\\/g, "/")
      )}`
    : null;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "#020617",
        borderRadius: 8,
        border: "1px solid #1f2937",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "#0b1120",
          borderBottom: "1px solid #111827",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 1,
            padding: "2px 6px",
            borderRadius: 999,
            border: `1px solid rgba(74,124,155,0.3)`,
            color: typeBadgeColor,
            backgroundColor: "rgba(74,124,155,0.1)",
          }}
        >
          {node.kind ?? "module"}
        </span>
        <span
          style={{
            fontSize: 13,
            fontFamily: "Georgia, ui-serif, serif",
            color: "#e6edf3",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
          }}
          title={node.suggestedLabel ?? node.label}
        >
          {node.suggestedLabel ?? node.label}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            color: "#9ca3af",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 220,
          }}
          title={filePathLabel}
        >
          {filePathLabel}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#6b7280",
            marginLeft: 8,
          }}
        >
          {lineInfo}
        </span>
        {vscodeUrl && (
          <button
            type="button"
            onClick={() => {
              window.location.href = vscodeUrl;
            }}
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              fontSize: 10,
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "transparent",
              color: "#93c5fd",
              cursor: "pointer",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            }}
            title="Open in VS Code"
          >
            Open
          </button>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Summary */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#d4a574",
              marginBottom: 4,
            }}
          >
            Summary
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#9ca3af",
              lineHeight: 1.5,
            }}
          >
            {summary}
          </div>
        </div>

        {/* Language notes */}
        {node.languageNotes && (
          <div>
            <button
              type="button"
              onClick={() => setLanguageOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  transform: languageOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.12s ease-out",
                  color: "#d4a574",
                  fontSize: 11,
                }}
              >
                ▶
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#d4a574",
                }}
              >
                Language notes
              </span>
            </button>
            {languageOpen && (
              <div
                style={{
                  background: "rgba(212,165,116,0.06)",
                  border: "1px solid rgba(212,165,116,0.25)",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 12,
                  color: "#e5e7eb",
                  lineHeight: 1.5,
                }}
              >
                {node.languageNotes}
              </div>
            )}
          </div>
        )}

        {/* Tags + complexity */}
        {(tags.length > 0 || complexity) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#7d8590",
                }}
              >
                Complexity
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.4)",
                  color:
                    complexity === "complex"
                      ? "#fca5a5"
                      : complexity === "moderate"
                      ? "#fbbf24"
                      : "#a5b4fc",
                  backgroundColor:
                    complexity === "complex"
                      ? "rgba(248,113,113,0.08)"
                      : complexity === "moderate"
                      ? "rgba(251,191,36,0.08)"
                      : "rgba(129,140,248,0.08)",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {complexity}
              </span>
            </div>

            {tags.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: "#7d8590",
                    marginBottom: 4,
                  }}
                >
                  Tags
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 11,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "rgba(31,41,55,0.9)",
                        border: "1px solid #30363d",
                        color: "#9ca3af",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connections */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#d4a574",
              marginBottom: 4,
            }}
          >
            Connections {connections.length > 0 ? `(${connections.length})` : ""}
          </div>
          {connections.length === 0 ? (
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
              }}
            >
              This node has no direct connections in the current graph view.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {connections.map((edge, idx) => {
                const isSource = edge.source === selectedNodeId;
                const otherId = isSource ? edge.target : edge.source;
                const otherNode = graph?.nodes.find((n) => n.id === otherId);
                const arrow = isSource ? "→" : "←";
                const label =
                  otherNode?.suggestedLabel ?? otherNode?.label ?? otherId;
                const edgeLabel =
                  edge.flowKind ??
                  (edge.type === "runtime"
                    ? "runtime_path"
                    : edge.type === "import"
                    ? "depends_on"
                    : edge.type);

                return (
                  <div
                    key={`${edge.id}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: "#020617",
                      border: "1px solid #111827",
                      fontSize: 11,
                      color: "#9ca3af",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        color: "#d4a574",
                      }}
                    >
                      {arrow}
                    </span>
                    <span
                      style={{
                        color: "#7d8590",
                      }}
                    >
                      {edgeLabel}
                    </span>
                    <span
                      style={{
                        color: "#e5e7eb",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={label}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Source note */}
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "#6b7280",
            fontStyle: "italic",
          }}
        >
          Source code available locally at {primaryFile ?? "the project directory"}.
        </div>
      </div>
    </div>
  );
}

