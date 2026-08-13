/**
 * Looking at a file.
 *
 * Every view in this tool names files. The Agents view shows a tool declared at
 * kelly-tool-executor.js:981. Guard cites evidence by path. Flow lists
 * components. The assessment names agents. None of it could be opened, because
 * the only file viewer took an ArchNode from the module graph — so the one
 * route to source ran through the 2D view, which is the view about folder
 * structure rather than agents.
 *
 * This takes a path and an optional line instead, which means any filename
 * anywhere in the app can become a link to the thing it names.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Props = {
  projectRoot?: string | null;
  /** Path relative to the project root. */
  filePath?: string | null;
  /** Scroll here and mark it. 1-based, as editors and stack traces count. */
  line?: number | null;
  apiBase: string;
  accessToken: string | null;
  onClose?: () => void;
};

/**
 * Very light highlighting — comments, strings, keywords.
 *
 * Not a syntax highlighter, and deliberately not: a real one is a large
 * dependency for a panel whose job is to let you check what a line says. This
 * makes code scannable without pretending to be an editor.
 */
function tint(line: string): { text: string; colour: string }[] {
  const trimmed = line.trim();

  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
    return [{ text: line, colour: "#6e7681" }];
  }
  if (trimmed.startsWith("#")) {
    return [{ text: line, colour: "#6e7681" }];
  }
  return [{ text: line, colour: "#c9d1d9" }];
}

export function FileViewer({
  projectRoot,
  filePath,
  line,
  apiBase,
  accessToken,
  onClose,
}: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<{ lines: number; bytes: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!projectRoot || !filePath || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(apiBase + "/local-file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({ projectRoot, filePath }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "Could not read the file.");
        setContent(null);
        return;
      }
      setContent(d.content ?? "");
      setMeta({ lines: d.lines ?? 0, bytes: d.bytes ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, accessToken, projectRoot, filePath]);

  useEffect(() => {
    load();
  }, [load]);

  // Bring the cited line into view once the content is there.
  useEffect(() => {
    if (!content || !line) return;
    const t = setTimeout(() => {
      targetRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [content, line]);

  if (!filePath) {
    return (
      <div style={{ padding: 20, fontSize: 12.5, color: "#8b949e", lineHeight: 1.65 }}>
        No file open. Click any filename — in the dashboard, in Agents, in Guard
        evidence — and it opens here.
      </div>
    );
  }

  const lines = (content ?? "").split("\n");
  const gutterWidth = String(lines.length).length * 8 + 16;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 10px",
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: "#e6edf3",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={filePath}
        >
          {filePath}
        </span>

        {line ? (
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#ef32a6" }}>
            :{line}
          </span>
        ) : null}

        {meta ? (
          <span style={{ fontFamily: MONO, fontSize: 10, color: "#484f58" }}>
            {meta.lines} lines
          </span>
        ) : null}

        <button
          type="button"
          onClick={load}
          title="Reload from disk"
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: 5,
            border: "1px solid #30363d",
            background: "transparent",
            color: "#8b949e",
            cursor: "pointer",
          }}
        >
          {loading ? "…" : "reload"}
        </button>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              fontFamily: MONO,
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 5,
              border: "1px solid #30363d",
              background: "transparent",
              color: "#8b949e",
              cursor: "pointer",
            }}
          >
            close
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          style={{
            padding: "12px 14px",
            fontSize: 12,
            color: "#f85149",
            fontFamily: MONO,
            lineHeight: 1.6,
          }}
        >
          {error}
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            fontFamily: MONO,
            fontSize: 11.5,
            lineHeight: 1.6,
          }}
        >
          {lines.map((l, i) => {
            const n = i + 1;
            const isTarget = line === n;
            return (
              <div
                key={i}
                ref={isTarget ? targetRef : undefined}
                style={{
                  display: "flex",
                  background: isTarget ? "rgba(88,166,255,0.10)" : "transparent",
                  borderLeft: isTarget ? "2px solid #ef32a6" : "2px solid transparent",
                }}
              >
                <span
                  style={{
                    width: gutterWidth,
                    flexShrink: 0,
                    textAlign: "right",
                    paddingRight: 10,
                    color: isTarget ? "#ef32a6" : "#484f58",
                    userSelect: "none",
                  }}
                >
                  {n}
                </span>
                <span style={{ whiteSpace: "pre", paddingRight: 16 }}>
                  {tint(l).map((seg, j) => (
                    <span key={j} style={{ color: seg.colour }}>
                      {seg.text || " "}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
