import { useEffect, useState } from "react";
import { ArchCanvas } from "./ArchCanvas";
import { analyseGraph } from "./analysis/graphAnalyser";
import type { ArchGraph } from "./types";

const API_BASE = "/api";

export function SharedView({ slug }: { slug: string }) {
  const [graph, setGraph] = useState<ArchGraph | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/shared/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        if (data.graph && Array.isArray(data.graph.nodes) && Array.isArray(data.graph.edges)) {
          setGraph(analyseGraph(data.graph as ArchGraph));
          setRepoUrl(data.repoUrl ?? "");
        } else {
          setError("Invalid graph data");
        }
      })
      .catch(() => setError("Failed to load"));
  }, [slug]);

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          color: "#f85149",
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {error}
      </div>
    );
  }

  if (!graph) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          color: "#7d8590",
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0d1117" }}>
      <div
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 20,
          background: "rgba(7,13,26,0.9)",
          border: "1px solid #1e2d45",
          borderRadius: 8,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          backdropFilter: "blur(8px)",
        }}
      >
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#8b949e", letterSpacing: "0.1em" }}>
          LITTLELABS
        </span>
        <a
          href="/"
          style={{ fontSize: 10, color: "#58a6ff", textDecoration: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
        >
          Try it with your repo →
        </a>
      </div>
      <ArchCanvas
        graph={graph}
        selectedNode={null}
        onNodeSelect={() => {}}
        repoUrl={repoUrl}
      />
    </div>
  );
}
