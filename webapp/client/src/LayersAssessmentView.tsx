/**
 * Ten layers, three states, no score.
 *
 * The existing dashboard answers "what agents exist and what can they reach".
 * This answers a different question: measured against what a complete agent
 * has, where is this one — and the interesting answer is rarely "missing".
 *
 * Three states, deliberately not a percentage. A percentage would average a
 * finished financial layer against an absent memory layer into a number
 * describing neither, and invite the reader to feel 60% done.
 *
 *   working            — built and on the execution path
 *   built_unconnected  — built, imports its dependencies, and nothing reaches it
 *   absent             — not there
 *
 * The middle state is the point of this view. Three components in this codebase
 * are wired to their dependencies and imported by nothing: a vector retriever
 * connected to Pinecone, a LangSmith tracer, and an observability service for a
 * system that no longer exists here. In a file listing all three look like
 * capability. On the execution path none of them exist.
 *
 * That is not visible in any other view, and it is the reason this one exists.
 */
import { useMemo, useState } from "react";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Item = { what: string; where?: string; why?: string };

type Layer = {
  id: string;
  name: string;
  complete_means: string;
  state: "working" | "built_unconnected" | "absent" | "not_applicable";
  summary: string;
  working?: Item[];
  unconnected?: Item[];
  absent?: Item[];
  measured?: string;
};

type Assessment = {
  assessed_at?: string;
  assessed_by?: string;
  layers: Layer[];
};

type Props = {
  assessment: Assessment | null;
  onOpenFile?: (path: string, line?: number) => void;
};

const STATE = {
  working: { label: "working", colour: "#3fb950", dot: "#3fb950" },
  built_unconnected: { label: "built, unconnected", colour: "#d29922", dot: "#d29922" },
  absent: { label: "absent", colour: "#f85149", dot: "#f85149" },
  not_applicable: { label: "not applicable", colour: "#6e7681", dot: "#30363d" },
} as const;

/**
 * A file path from an evidence line. Some point at a table or a constant rather
 * than a file, and those are not openable — better to render them as plain text
 * than as a link that goes nowhere.
 */
function pathOf(where?: string): string | null {
  if (!where) return null;
  const first = where.split(/[\s,]/)[0];
  return /\.[jt]sx?$/.test(first) ? first : null;
}

function Evidence({
  items,
  tone,
  onOpenFile,
}: {
  items?: Item[];
  tone: "working" | "unconnected" | "absent";
  onOpenFile?: (path: string, line?: number) => void;
}) {
  if (!items || items.length === 0) return null;

  const colour = tone === "working" ? "#8b949e" : tone === "unconnected" ? "#d29922" : "#f85149";

  return (
    <div style={{ marginTop: 8 }}>
      {items.map((it, i) => {
        const p = pathOf(it.where);
        return (
          <div key={i} style={{ marginBottom: 6, lineHeight: 1.55 }}>
            <span style={{ fontSize: 11.5, color: "#e6edf3" }}>{it.what}</span>
            {it.where && (
              <>
                {"  "}
                {p && onOpenFile ? (
                  <button
                    type="button"
                    onClick={() => onOpenFile(p)}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      fontFamily: MONO,
                      fontSize: 10,
                      color: "#58a6ff",
                      cursor: "pointer",
                    }}
                  >
                    {it.where}
                  </button>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: 10, color: colour }}>{it.where}</span>
                )}
              </>
            )}
            {it.why && (
              <div style={{ fontSize: 11, color: "#6e7681", marginTop: 2, lineHeight: 1.5 }}>
                {it.why}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LayersAssessmentView({ assessment, onOpenFile }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { working: 0, built_unconnected: 0, absent: 0, not_applicable: 0 };
    for (const l of assessment?.layers ?? []) c[l.state] += 1;
    return c;
  }, [assessment]);

  const unconnectedTotal = useMemo(
    () => (assessment?.layers ?? []).reduce((n, l) => n + (l.unconnected?.length ?? 0), 0),
    [assessment]
  );

  if (!assessment) {
    return (
      <div style={{ padding: 28, fontSize: 13, color: "#8b949e", lineHeight: 1.65 }}>
        No assessment for this workspace.
        <div style={{ marginTop: 8, fontSize: 12, color: "#6e7681" }}>
          Add an <span style={{ fontFamily: MONO }}>architecture.layers.json</span> to the repository root.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px 48px" }}>
      <div style={{ maxWidth: 860 }}>
        <div style={{ fontSize: 17, color: "#e6edf3", fontWeight: 600 }}>
          Ten layers
        </div>
        <div style={{ fontSize: 12.5, color: "#8b949e", marginTop: 4, lineHeight: 1.6 }}>
          Measured against what a complete agent has. Assessed{" "}
          {assessment.assessed_at ?? "at an unknown date"}
          {assessment.assessed_by === "hand" ? " by hand, not detected." : "."}
        </div>

        {/* The counts, and no percentage. Averaging a finished layer against an
            absent one produces a number describing neither. */}
        <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap" }}>
          {(["working", "built_unconnected", "absent"] as const).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: STATE[k].dot,
                }}
              />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "#e6edf3" }}>{counts[k]}</span>
              <span style={{ fontSize: 11.5, color: "#8b949e" }}>{STATE[k].label}</span>
            </span>
          ))}
        </div>

        {unconnectedTotal > 0 && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 13px",
              background: "rgba(210,153,34,0.08)",
              border: "1px solid rgba(210,153,34,0.28)",
              borderRadius: 8,
              fontSize: 12,
              color: "#e6edf3",
              lineHeight: 1.6,
            }}
          >
            <strong>{unconnectedTotal} components are built and unreachable.</strong>{" "}
            <span style={{ color: "#8b949e" }}>
              They exist, they import their dependencies, and nothing on the execution path
              imports them. In a file listing they look like capability.
            </span>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          {assessment.layers.map((l) => {
            const st = STATE[l.state];
            const isOpen = open === l.id;

            return (
              <div
                key={l.id}
                style={{
                  borderTop: "1px solid #21262d",
                  padding: "13px 0",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : l.id)}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 11,
                    width: "100%",
                    background: "none",
                    border: 0,
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: st.dot,
                      flexShrink: 0,
                      position: "relative",
                      top: -1,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13.5,
                      color: "#e6edf3",
                      fontWeight: 600,
                      minWidth: 118,
                    }}
                  >
                    {l.name}
                  </span>
                  <span style={{ fontSize: 12.5, color: "#8b949e", flex: 1, lineHeight: 1.55 }}>
                    {l.summary}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: st.colour,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {st.label}
                  </span>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 12, marginLeft: 18, paddingBottom: 4 }}>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#6e7681",
                        fontStyle: "italic",
                        lineHeight: 1.6,
                        marginBottom: 12,
                      }}
                    >
                      Complete means: {l.complete_means}
                    </div>

                    {l.measured && (
                      <div
                        style={{
                          padding: "8px 11px",
                          background: "#0d1117",
                          border: "1px solid #21262d",
                          borderRadius: 6,
                          fontSize: 11.5,
                          color: "#e6edf3",
                          lineHeight: 1.6,
                          marginBottom: 12,
                        }}
                      >
                        {l.measured}
                      </div>
                    )}

                    {l.unconnected && l.unconnected.length > 0 && (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "#d29922", letterSpacing: "0.06em" }}>
                          BUILT, UNREACHABLE
                        </div>
                        <Evidence items={l.unconnected} tone="unconnected" onOpenFile={onOpenFile} />
                      </>
                    )}

                    {l.absent && l.absent.length > 0 && (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "#f85149", letterSpacing: "0.06em", marginTop: 12 }}>
                          ABSENT
                        </div>
                        <Evidence items={l.absent} tone="absent" onOpenFile={onOpenFile} />
                      </>
                    )}

                    {l.working && l.working.length > 0 && (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "#3fb950", letterSpacing: "0.06em", marginTop: 12 }}>
                          WORKING
                        </div>
                        <Evidence items={l.working} tone="working" onOpenFile={onOpenFile} />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 24,
            paddingTop: 14,
            borderTop: "1px solid #21262d",
            fontSize: 11,
            color: "#484f58",
            lineHeight: 1.65,
          }}
        >
          Hand-written, not detected. This exists to test whether the view says more than
          the findings dashboard does — if it does, the detectors get built.
        </div>
      </div>
    </div>
  );
}
