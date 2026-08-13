/**
 * Public read-only view of a shared workspace. This is the "look before you
 * join" journey: no account, no AI, no editing — just the picture plus a
 * clear path into signup. The canvas itself keeps its own theme (Phase 5).
 */
import { useEffect, useState } from "react";
import { ArchCanvas } from "./ArchCanvas";
import { analyseGraph } from "./analysis/graphAnalyser";
import type { ArchGraph } from "./types";
import {
  ACCENT,
  BAD,
  CANVAS,
  FONT_BRAND,
  FONT_MONO,
  FONT_UI,
  INK,
  LINE,
  PAPER,
  SLATE,
} from "./theme/tokens";

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
          background: CANVAS,
          color: BAD,
          padding: 24,
          fontFamily: FONT_UI,
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
          background: CANVAS,
          color: SLATE,
          padding: 24,
          fontFamily: FONT_UI,
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: CANVAS }}>
      <div
        data-testid="shared-view-chrome"
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 20,
          background: CANVAS,
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: "0 8px 24px rgba(18,19,26,0.10)",
          fontFamily: FONT_UI,
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontFamily: FONT_BRAND,
            fontWeight: 400,
            color: INK,
            letterSpacing: "-0.01em",
          }}
        >
          blanko
        </span>
        <span
          data-testid="shared-view-only-badge"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: SLATE,
            background: PAPER,
            border: `1px solid ${LINE}`,
            borderRadius: 6,
            padding: "3px 8px",
          }}
        >
          View only
        </span>
        <a
          href="/?get-started=1&intent=Create%20an%20account%20to%20keep%2C%20share%2C%20and%20use%20AI%20on%20designs%20you%20view."
          data-testid="shared-view-join"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: ACCENT,
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textDecoration = "underline";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = "none";
          }}
        >
          Get started free →
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
