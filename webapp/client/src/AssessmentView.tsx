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
import { useMemo, useState } from "react";
import { buildAssessment, type EvalRow } from "./assessment";
import { FindingsList } from "./FindingsList";

type Props = {
  graph: any;
  evaluations?: EvalRow[];
  apiBase: string;
  accessToken: string | null;
  workspaceId: string | null;
};

/** Minimal markdown rendering — headings, bold, bullets, ordered items, rules. */
function renderLine(line: string, i: number) {
  const key = "l" + i;

  if (line.trim() === "---") {
    return (
      <hr
        key={key}
        style={{ border: 0, borderTop: "1px solid #30363d", margin: "22px 0" }}
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
          color: "#e6edf3",
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
          color: "#8b949e",
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
          color: "#6e7681",
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
        <strong key={j} style={{ color: "#e6edf3", fontWeight: 600 }}>
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
          color: "#c9d1d9",
          lineHeight: 1.65,
          margin: "0 0 6px",
        }}
      >
        <span style={{ color: "#484f58", flexShrink: 0 }}>—</span>
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
          color: "#c9d1d9",
          lineHeight: 1.65,
          margin: "0 0 12px",
        }}
      >
        <span
          style={{
            color: "#58a6ff",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
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
        color: "#c9d1d9",
        lineHeight: 1.7,
        margin: "0 0 10px",
        maxWidth: "78ch",
      }}
    >
      {bold(line)}
    </p>
  );
}

const MONO_F = "JetBrains Mono, ui-monospace, monospace";

export function AssessmentView({ graph, evaluations = [], apiBase, accessToken, workspaceId }: Props) {
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
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e" }}>
        Scan a repository to generate an assessment.
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "20px 26px 60px",
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
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            borderRadius: 6,
            border: "1px solid #30363d",
            background: copied ? "rgba(63,185,80,0.15)" : "transparent",
            color: copied ? "#3fb950" : "#8b949e",
            cursor: "pointer",
          }}
          title="Copy the assessment as markdown"
        >
          {copied ? "copied" : "copy markdown"}
        </button>
      </div>

      <FindingsList graph={graph} evaluations={evaluations} apiBase={apiBase} accessToken={accessToken} workspaceId={workspaceId} />

      <article style={{ maxWidth: 820 }}>
        {lines.map((line, i) => renderLine(line, i))}
      </article>

      <p
        style={{
          marginTop: 32,
          fontSize: 11.5,
          color: "#484f58",
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
