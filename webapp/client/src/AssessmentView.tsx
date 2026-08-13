/**
 * Assessment view.
 *
 * The conclusion, not the evidence. Every other view reports what is in a
 * repository; this one says what the system is, which findings matter, and
 * what could not be established. It is the first thing worth reading after
 * a scan and the thing you would hand to someone else.
 *
 * Rendering is deliberately plain — headings, paragraphs, bullets. The
 * document has to survive being copied into an email or a review doc, so it
 * is generated as markdown and shown close to how it will look elsewhere.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildAssessment, type EvalRow } from "./assessment";
import { FindingsList } from "./FindingsList";
import { LayersAssessmentView } from "./LayersAssessmentView";
import {
  INK,
  SLATE,
  LINE,
  ACCENT,
  GOOD,
  FONT_MONO,
  FONT_UI,
} from "./theme/tokens";

type Props = {
  graph: any;
  evaluations?: EvalRow[];
  apiBase: string;
  accessToken: string | null;
  workspaceId: string | null;
  onOpenFile?: (path: string, line?: number) => void;
};

type LayersDoc = {
  present: boolean;
  reason?: string;
  assessed_at?: string;
  generated_at?: string;
  assessed_by?: string;
  source?: string;
  layers?: unknown[];
};

/**
 * System layers panel above the assessment markdown.
 *
 * Fetches architecture.layers.json for the scanned repository and lets a
 * reviewer declare a layer not applicable — that PATCH just writes
 * architecture.layers.apply.json; refetching GET /api/layers re-merges the
 * declaration onto the detected state, so this component stays dumb.
 */
function SystemLayersPanel({
  projectRoot,
  apiBase,
  accessToken,
  onOpenFile,
}: {
  projectRoot: string;
  apiBase: string;
  accessToken: string | null;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const [doc, setDoc] = useState<LayersDoc | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectRoot) {
      setDoc(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(
        `${apiBase}/layers?projectRoot=${encodeURIComponent(projectRoot)}`,
        accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
      );
      const d = await r.json();
      setDoc(d);
    } catch {
      setDoc({ present: false, reason: "Could not reach the layers endpoint." });
    } finally {
      setLoading(false);
    }
  }, [apiBase, accessToken, projectRoot]);

  useEffect(() => {
    load();
  }, [load]);

  const markNotApplicable = useCallback(
    async (layerId: string) => {
      if (!accessToken) return;
      try {
        await fetch(`${apiBase}/layers/applicability`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ projectRoot, layerId, state: "not_applicable" }),
        });
      } catch {
        /* best effort — refetch below shows whatever state actually landed */
      }
      load();
    },
    [apiBase, accessToken, projectRoot, load]
  );

  if (loading) return null;

  if (!doc?.present) {
    return (
      <div
        style={{
          maxWidth: 820,
          marginBottom: 20,
          fontSize: 12,
          color: SLATE,
        }}
      >
        Scan to generate architecture.layers.json.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, marginBottom: 8, border: `1px solid ${LINE}`, borderRadius: 8 }}>
      <LayersAssessmentView
        assessment={doc as any}
        onOpenFile={onOpenFile}
        onMarkNotApplicable={accessToken ? markNotApplicable : undefined}
      />
    </div>
  );
}

/** Minimal markdown rendering — headings, bold, bullets, ordered items, rules. */
function renderLine(line: string, i: number) {
  const key = "l" + i;

  if (line.trim() === "---") {
    return (
      <hr
        key={key}
        style={{ border: 0, borderTop: `1px solid ${LINE}`, margin: "22px 0" }}
      />
    );
  }

  if (line.startsWith("# ")) {
    return (
      <h1
        key={key}
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: INK,
          margin: "0 0 4px",
          letterSpacing: "-0.01em",
        }}
      >
        {line.slice(2)}
      </h1>
    );
  }

  if (line.startsWith("## ")) {
    return (
      <h2
        key={key}
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: SLATE,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          margin: "26px 0 10px",
        }}
      >
        {line.slice(3)}
      </h2>
    );
  }

  // Emphasised standalone line (the generated-on note, the closing summary).
  if (line.startsWith("_") && line.endsWith("_") && line.length > 2) {
    return (
      <p
        key={key}
        style={{
          fontSize: 12,
          color: SLATE,
          margin: "0 0 6px",
          fontStyle: "italic",
        }}
      >
        {line.slice(1, -1)}
      </p>
    );
  }

  const bold = (text: string) =>
    text.split(/\*\*(.+?)\*\*/g).map((part, j) =>
      j % 2 === 1 ? (
        <strong key={j} style={{ color: INK, fontWeight: 600 }}>
          {part}
        </strong>
      ) : (
        <span key={j}>{part}</span>
      )
    );

  if (line.startsWith("- ")) {
    return (
      <div
        key={key}
        style={{
          display: "flex",
          gap: 10,
          fontSize: 13.5,
          color: INK,
          lineHeight: 1.65,
          margin: "0 0 6px",
        }}
      >
        <span style={{ color: SLATE, flexShrink: 0 }}>—</span>
        <span>{bold(line.slice(2))}</span>
      </div>
    );
  }

  const ordered = line.match(/^(\d+)\.\s(.*)$/);
  if (ordered) {
    return (
      <div
        key={key}
        style={{
          display: "grid",
          gridTemplateColumns: "22px 1fr",
          gap: 8,
          fontSize: 13.5,
          color: INK,
          lineHeight: 1.65,
          margin: "0 0 12px",
        }}
      >
        <span
          style={{
            color: ACCENT,
            fontFamily: FONT_MONO,
            fontSize: 12,
            paddingTop: 2,
          }}
        >
          {ordered[1]}
        </span>
        <span>{bold(ordered[2])}</span>
      </div>
    );
  }

  if (line.trim() === "") return <div key={key} style={{ height: 6 }} />;

  return (
    <p
      key={key}
      style={{
        fontSize: 13.5,
        color: INK,
        lineHeight: 1.7,
        margin: "0 0 10px",
        maxWidth: "78ch",
      }}
    >
      {bold(line)}
    </p>
  );
}


export function AssessmentView({ graph, evaluations = [], apiBase, accessToken, workspaceId, onOpenFile }: Props) {
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(
    () => buildAssessment(graph, evaluations),
    [graph, evaluations]
  );

  const lines = markdown.split("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the download in Export still works */
    }
  };

  if (!graph) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: SLATE, fontFamily: FONT_UI }}>
        Scan a repository to generate a review.
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "20px 26px 60px",
        background: "transparent",
        color: INK,
        fontFamily: FONT_UI,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <button
          type="button"
          onClick={copy}
          style={{
            padding: "4px 12px",
            fontSize: 11,
            fontFamily: FONT_MONO,
            borderRadius: 6,
            border: `1px solid ${LINE}`,
            background: copied ? "rgba(63,185,80,0.15)" : "transparent",
            color: copied ? GOOD : SLATE,
            cursor: "pointer",
          }}
          title="Copy the assessment as markdown"
        >
          {copied ? "copied" : "copy markdown"}
        </button>
      </div>

      <FindingsList graph={graph} evaluations={evaluations} apiBase={apiBase} accessToken={accessToken} workspaceId={workspaceId} />

      {graph?.projectRoot && accessToken && (
        <SystemLayersPanel
          projectRoot={graph.projectRoot}
          apiBase={apiBase}
          accessToken={accessToken}
          onOpenFile={onOpenFile}
        />
      )}

      <article style={{ maxWidth: 820 }}>
        {lines.map((line, i) => renderLine(line, i))}
      </article>

      <p
        style={{
          marginTop: 32,
          fontSize: 11.5,
          color: SLATE,
          maxWidth: "70ch",
          lineHeight: 1.6,
        }}
      >
        Generated from the current scan. Nothing above is asserted unless the
        tracer established it — where reach could not be followed, the document
        says so rather than treating silence as a clean result.
      </p>
    </div>
  );
}
