import { useState } from "react";
import { styles } from "./styles";

export interface ProposedFile {
  name: string;
  purpose: string;
  todos: string[];
}

export interface ProposedNode {
  id: string;
  label: string;
  layer: string;
  description: string;
  files: ProposedFile[];
  connectsTo: string[];
}

export interface ArchitectureProposal {
  summary: string;
  nodes: ProposedNode[];
  reuses: string[];
  rationale: string;
}

interface Props {
  proposal: ArchitectureProposal;
  existingNodeLabels: Record<string, string>;
  onApprove: (proposal: ArchitectureProposal) => void;
  onReject: () => void;
}

const LAYER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Presentation: { bg: "#0d2137", border: "#58a6ff", text: "#58a6ff" },
  "Business Logic": { bg: "#0d2137", border: "#3fb950", text: "#3fb950" },
  "Data Access": { bg: "#1a1a2e", border: "#a371f7", text: "#a371f7" },
  Infrastructure: { bg: "#1a2020", border: "#56d364", text: "#56d364" },
  "External Services": { bg: "#2a1a0d", border: "#f0883e", text: "#f0883e" },
  Utilities: { bg: "#1a1a1a", border: "#8b949e", text: "#8b949e" },
  Configuration: { bg: "#1a1a0d", border: "#d29922", text: "#d29922" },
  Uncategorized: { bg: "#161b22", border: "#30363d", text: "#8b949e" },
};

function layerStyle(layer: string) {
  return LAYER_COLORS[layer] ?? LAYER_COLORS.Uncategorized;
}

function TodoItem({
  text,
  done,
  onToggle,
}: {
  text: string;
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "4px 0",
        cursor: "pointer",
        opacity: done ? 0.5 : 1,
      }}
    >
      <span
        style={{
          color: done ? "#3fb950" : "#30363d",
          fontSize: 14,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {done ? "✓" : "○"}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "#c9d1d9",
          textDecoration: done ? "line-through" : "none",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function FileCard({ file }: { file: ProposedFile }) {
  const [open, setOpen] = useState(false);
  const [doneTodos, setDoneTodos] = useState<Set<number>>(new Set());

  return (
    <div
      style={{
        border: "1px solid #21262d",
        borderRadius: 4,
        marginBottom: 6,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 10px",
          background: "#0d1117",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            color: "#58a6ff",
          }}
        >
          {file.name}
        </span>
        <span style={{ fontSize: 10, color: "#7d8590" }}>
          {file.todos.length} todo{file.todos.length !== 1 ? "s" : ""}{" "}
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div style={{ padding: "6px 10px", background: "#161b22" }}>
          <div
            style={{
              fontSize: 10,
              color: "#7d8590",
              marginBottom: 6,
            }}
          >
            {file.purpose}
          </div>
          {file.todos.map((todo, i) => (
            <TodoItem
              key={i}
              text={todo}
              done={doneTodos.has(i)}
              onToggle={() =>
                setDoneTodos((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeCard({
  node,
  existingNodeLabels,
}: {
  node: ProposedNode;
  existingNodeLabels: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const ls = layerStyle(node.layer);
  const totalTodos = node.files.reduce((acc, f) => acc + f.todos.length, 0);

  return (
    <div
      style={{
        border: `1px solid ${ls.border}`,
        borderRadius: 6,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: ls.bg,
          padding: "10px 12px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                border: `2px dashed ${ls.border}`,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#e6edf3",
              }}
            >
              {node.label}
            </span>
            <span
              style={{
                fontSize: 9,
                padding: "1px 6px",
                borderRadius: 10,
                border: `1px solid ${ls.border}`,
                color: ls.text,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {node.layer}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#7d8590" }}>
            {node.description}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, color: "#8b949e" }}>
            {node.files.length} files
          </span>
          <span style={{ fontSize: 10, color: "#8b949e" }}>
            {totalTodos} todos
          </span>
          <span style={{ fontSize: 10, color: "#7d8590" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "10px 12px", background: "#0d1117" }}>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                color: "#7d8590",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Files
            </div>
            {node.files.map((f, i) => (
              <FileCard key={i} file={f} />
            ))}
          </div>
          {node.connectsTo.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "#7d8590",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Connects to
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {node.connectsTo.map((targetId) => (
                  <span
                    key={targetId}
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      background: "#21262d",
                      borderRadius: 4,
                      color: "#8b949e",
                      border: "1px solid #30363d",
                    }}
                  >
                    → {existingNodeLabels[targetId] ?? targetId}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DesignProposalPanel({
  proposal,
  existingNodeLabels,
  onApprove,
  onReject,
}: Props) {
  const [editingRationale, setEditingRationale] = useState(false);
  const [editedRationale, setEditedRationale] = useState(proposal.rationale);
  const [approveHover, setApproveHover] = useState(false);

  const totalFiles = proposal.nodes.reduce(
    (acc, n) => acc + n.files.length,
    0
  );
  const totalTodos = proposal.nodes.reduce(
    (acc, n) => acc + n.files.reduce((a, f) => a + f.todos.length, 0),
    0
  );

  return (
    <div
      style={{
        ...styles.panel,
        borderLeft: "3px solid #58a6ff",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#e6edf3",
            }}
          >
            Architecture Proposal
          </div>
          <span
            style={{
              fontSize: 9,
              padding: "2px 8px",
              background: "#0d2137",
              border: "1px solid #58a6ff",
              borderRadius: 10,
              color: "#58a6ff",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Awaiting Approval
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#c9d1d9",
            lineHeight: 1.5,
            marginBottom: 8,
          }}
        >
          {proposal.summary}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { val: proposal.nodes.length, label: "New modules" },
            { val: totalFiles, label: "Files" },
            { val: totalTodos, label: "Todos" },
            { val: proposal.reuses.length, label: "Reused" },
          ].map(({ val, label }) => (
            <div key={label}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#58a6ff",
                }}
              >
                {val}
              </div>
              <div style={{ fontSize: 10, color: "#7d8590" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {proposal.reuses.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              color: "#7d8590",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Reuses existing
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {proposal.reuses.map((id) => (
              <span
                key={id}
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  background: "#122117",
                  border: "1px solid #3fb950",
                  borderRadius: 4,
                  color: "#3fb950",
                }}
              >
                ✓ {existingNodeLabels[id] ?? id}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 10,
            color: "#7d8590",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          New modules (dotted = unbuilt)
        </div>
        {proposal.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            existingNodeLabels={existingNodeLabels}
          />
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#7d8590",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Why this design fits
          </div>
          <button
            onClick={() => setEditingRationale((e) => !e)}
            style={{
              ...styles.buttonBase,
              padding: "2px 6px",
              fontSize: 10,
              height: "auto",
            }}
          >
            {editingRationale ? "Done" : "Edit"}
          </button>
        </div>
        {editingRationale ? (
          <textarea
            value={editedRationale}
            onChange={(e) => setEditedRationale(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              padding: 8,
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 4,
              color: "#c9d1d9",
              fontSize: 11,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 11,
              color: "#8b949e",
              lineHeight: 1.5,
            }}
          >
            {editedRationale}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onMouseEnter={() => setApproveHover(true)}
          onMouseLeave={() => setApproveHover(false)}
          onClick={() =>
            onApprove({ ...proposal, rationale: editedRationale })
          }
          style={{
            flex: 1,
            ...styles.buttonBase,
            background: approveHover ? "#2ea043" : "#238636",
            color: "white",
            border: "1px solid #2ea043",
            fontWeight: 600,
            fontSize: 13,
            padding: "8px 0",
          }}
        >
          Approve & Plan →
        </button>
        <button
          onClick={onReject}
          style={{
            ...styles.buttonBase,
            ...styles.buttonSecondary,
            padding: "8px 16px",
          }}
        >
          Reject
        </button>
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: "#7d8590",
          textAlign: "center",
        }}
      >
        Approving creates a task plan. No code is written until you approve the
        plan.
      </div>
    </div>
  );
}

