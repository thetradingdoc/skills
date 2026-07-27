import { useState, useMemo } from "react";
import type { ArchGraph } from "./types";
import { findPath } from "./analysis/pathSearch";

interface PathSearchBarProps {
  graph: ArchGraph;
  onPathFound: (nodeIds: string[]) => void;
  onClear: () => void;
}

export function PathSearchBar({ graph, onPathFound, onClear }: PathSearchBarProps) {
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [path, setPath] = useState<string[] | null>(null);

  const options = useMemo(() => {
    return graph.nodes
      .map((n) => ({ id: n.id, label: n.suggestedLabel ?? n.role ?? n.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graph.nodes]);

  const handleSearch = () => {
    if (!fromId || !toId) return;
    const p = findPath(graph, fromId, toId);
    setPath(p);
    onPathFound(p);
  };

  const handleClear = () => {
    setFromId("");
    setToId("");
    setPath(null);
    onClear();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "rgba(15,23,42,0.92)",
        border: "1px solid #334155",
        borderRadius: 8,
        fontSize: 11,
      }}
    >
      <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>Path:</span>
      <select
        value={fromId}
        onChange={(e) => setFromId(e.target.value)}
        style={{
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 4,
          color: "#e2e8f0",
          padding: "4px 8px",
          fontSize: 11,
          minWidth: 120,
        }}
      >
        <option value="">From…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span style={{ color: "#64748b" }}>→</span>
      <select
        value={toId}
        onChange={(e) => setToId(e.target.value)}
        style={{
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 4,
          color: "#e2e8f0",
          padding: "4px 8px",
          fontSize: 11,
          minWidth: 120,
        }}
      >
        <option value="">To…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleSearch}
        disabled={!fromId || !toId}
        style={{
          padding: "4px 10px",
          background: "#3b82f6",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          fontSize: 11,
          cursor: !fromId || !toId ? "not-allowed" : "pointer",
        }}
      >
        Search
      </button>
      {(path !== null || fromId || toId) && (
        <button
          type="button"
          onClick={handleClear}
          style={{
            padding: "4px 8px",
            background: "transparent",
            border: "1px solid #475569",
            borderRadius: 4,
            color: "#94a3b8",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      )}
      {path !== null && (
        <span style={{ color: path.length ? "#22c55e" : "#f59e0b", fontSize: 11 }}>
          {path.length ? `${path.length} node${path.length !== 1 ? "s" : ""}` : "No path"}
        </span>
      )}
    </div>
  );
}
