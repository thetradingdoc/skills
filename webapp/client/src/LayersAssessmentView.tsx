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
import { ACCENT, BAD, CANVAS, GOOD, INK, LINE, PAPER, SLATE, WARN } from "./theme/tokens";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Item = { what: string; where?: string; why?: string };

type LayerState = "working" | "built_unconnected" | "absent" | "not_applicable";

type Layer = {
  id: string;
  name: string;
  complete_means: string;
  state: LayerState;
  summary: string;
  working?: Item[];
  unconnected?: Item[];
  absent?: Item[];
  measured?: string;
  /** agent = evidence is only from an agent's own turn path (safety, observability). */
  scope?: "agent" | "system";
  /** Detected state before any human applicability override, when the doc carries one. */
  detected?: { state: Exclude<LayerState, "not_applicable"> };
  /** Human override, when present. Backward compatible — old docs have neither field. */
  declared?: { state: LayerState; reason?: string } | null;
};

type Assessment = {
  assessed_at?: string;
  assessed_by?: string;
  layers: Layer[];
};

type Props = {
  assessment: Assessment | null;
  onOpenFile?: (path: string, line?: number) => void;
  /** Mark a layer not applicable to this system (PATCH /api/layers/applicability). */
  onMarkNotApplicable?: (layerId: string) => void;
};

const STATE = {
  working: { label: "working", colour: GOOD, dot: GOOD },
  built_unconnected: { label: "built, unconnected", colour: WARN, dot: WARN },
  absent: { label: "absent", colour: BAD, dot: BAD },
  not_applicable: { label: "not applicable", colour: SLATE, dot: LINE },
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

  const colour = tone === "working" ? SLATE : tone === "unconnected" ? WARN : BAD;

  return (
    <div style={{ marginTop: 8 }}>
      {items.map((it, i) => {
        const p = pathOf(it.where);
        return (
          <div key={i} style={{ marginBottom: 6, lineHeight: 1.55 }}>
            <span style={{ fontSize: 11.5, color: INK }}>{it.what}</span>
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
                      color: ACCENT,
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
              <div style={{ fontSize: 11, color: SLATE, marginTop: 2, lineHeight: 1.5 }}>
                {it.why}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LayersAssessmentView({ assessment, onOpenFile, onMarkNotApplicable }: Props) {
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
      <div style={{ padding: 28, fontSize: 13, color: SLATE, lineHeight: 1.65 }}>
        No assessment for this workspace.
        <div style={{ marginTop: 8, fontSize: 12, color: SLATE }}>
          Add an <span style={{ fontFamily: MONO }}>architecture.layers.json</span> to the repository root.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px 48px" }}>
      <div style={{ maxWidth: 860 }}>
        <div style={{ fontSize: 17, color: INK, fontWeight: 600 }}>
          Ten layers
        </div>
        <div style={{ fontSize: 12.5, color: SLATE, marginTop: 4, lineHeight: 1.6 }}>
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
              <span style={{ fontFamily: MONO, fontSize: 12, color: INK }}>{counts[k]}</span>
              <span style={{ fontSize: 11.5, color: SLATE }}>{STATE[k].label}</span>
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
              color: INK,
              lineHeight: 1.6,
            }}
          >
            <strong>{unconnectedTotal} components are built and unreachable.</strong>{" "}
            <span style={{ color: SLATE }}>
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
                  borderTop: `1px solid ${LINE}`,
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
                      color: INK,
                      fontWeight: 600,
                      minWidth: 118,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                    }}
                  >
                    {l.name}
                    {(l.scope === "agent" || l.id === "safety" || l.id === "observability") && (
                      <span
                        title="Scoped to each agent's own turn path, not the whole system"
                        style={{
                          fontSize: 8,
                          fontWeight: 600,
                          color: ACCENT,
                          border: "1px solid rgba(167,139,250,0.45)",
                          borderRadius: 3,
                          padding: "1px 4px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          flexShrink: 0,
                        }}
                      >
                        agent path
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12.5, color: SLATE, flex: 1, lineHeight: 1.55 }}>
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

                {onMarkNotApplicable && l.state !== "not_applicable" && (
                  <div style={{ marginTop: 6, marginLeft: 18 }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkNotApplicable(l.id);
                      }}
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: SLATE,
                        background: "none",
                        border: `1px solid ${LINE}`,
                        borderRadius: 4,
                        padding: "2px 8px",
                        cursor: "pointer",
                      }}
                      title={`Declare ${l.name} not applicable to this system`}
                    >
                      mark n/a
                    </button>
                  </div>
                )}

                {isOpen && (
                  <div style={{ marginTop: 12, marginLeft: 18, paddingBottom: 4 }}>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: SLATE,
                        fontStyle: "italic",
                        lineHeight: 1.6,
                        marginBottom: 12,
                      }}
                    >
                      Complete means: {l.complete_means}
                    </div>

                    {l.declared && l.detected && l.declared.state !== l.detected.state && (
                      <div
                        style={{
                          padding: "8px 11px",
                          background: "rgba(167,139,250,0.08)",
                          border: "1px solid rgba(167,139,250,0.28)",
                          borderRadius: 6,
                          fontSize: 11.5,
                          color: INK,
                          lineHeight: 1.6,
                          marginBottom: 12,
                        }}
                      >
                        Detected <strong>{STATE[l.detected.state].label}</strong>, declared{" "}
                        <strong>{STATE[l.declared.state].label}</strong>
                        {l.declared.reason ? ` — ${l.declared.reason}` : ""}.
                      </div>
                    )}

                    {l.measured && (
                      <div
                        style={{
                          padding: "8px 11px",
                          background: PAPER,
                          border: `1px solid ${LINE}`,
                          borderRadius: 6,
                          fontSize: 11.5,
                          color: INK,
                          lineHeight: 1.6,
                          marginBottom: 12,
                        }}
                      >
                        {l.measured}
                      </div>
                    )}

                    {l.unconnected && l.unconnected.length > 0 && (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: WARN, letterSpacing: "0.06em" }}>
                          BUILT, UNREACHABLE
                        </div>
                        <Evidence items={l.unconnected} tone="unconnected" onOpenFile={onOpenFile} />
                      </>
                    )}

                    {l.absent && l.absent.length > 0 && (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: BAD, letterSpacing: "0.06em", marginTop: 12 }}>
                          ABSENT
                        </div>
                        <Evidence items={l.absent} tone="absent" onOpenFile={onOpenFile} />
                      </>
                    )}

                    {l.working && l.working.length > 0 && (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: GOOD, letterSpacing: "0.06em", marginTop: 12 }}>
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
            borderTop: `1px solid ${LINE}`,
            fontSize: 11,
            color: SLATE,
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
