/**
 * The findings list, interactive.
 *
 * A ranked list you can only read tells you what is wrong. This one holds the
 * decisions: accept it, waive it with a reason, mark it resolved, leave a
 * comment. Those decisions survive a rescan, which is what makes a finding
 * something two people can work on rather than a line of output.
 *
 * Stored state is merged onto scan output rather than replacing it. The scan
 * is the authority on what exists and how severe it is; the database is the
 * authority on what anyone decided about it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { rankFindings, severityColor, type Finding } from "./findings";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type StoredFinding = {
  finding_id: string;
  state: "open" | "accepted" | "waived" | "resolved";
  assignee_id: string | null;
  rationale: string | null;
  decided_by: string | null;
  decided_at: string | null;
  absent: boolean;
  recurrence_count: number;
  log: LogEntry[];
};

type LogEntry = {
  at: string;
  actor: string | null;
  actor_name: string | null;
  kind: "comment" | "state" | "assign" | "rationale";
  from: string | null;
  to: string | null;
  text: string | null;
};

type Props = {
  graph: any;
  evaluations?: any[];
  apiBase: string;
  accessToken: string | null;
  workspaceId: string | null;
};

const STATE_LABEL: Record<string, string> = {
  open: "open",
  accepted: "accepted",
  waived: "waived",
  resolved: "resolved",
};

const STATE_COLOR: Record<string, string> = {
  open: "#8b949e",
  accepted: "#58a6ff",
  waived: "#a371f7",
  resolved: "#3fb950",
};

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

function logLine(e: LogEntry): string {
  if (e.kind === "comment") return e.text ?? "";
  if (e.kind === "state") {
    const move = e.from + " to " + e.to;
    return e.text ? move + " — " + e.text : move;
  }
  if (e.kind === "assign") return e.to ? "assigned" : "unassigned";
  return e.text ?? "";
}

export function FindingsList({
  graph,
  evaluations = [],
  apiBase,
  accessToken,
  workspaceId,
}: Props) {
  const scanned = useMemo(
    () => rankFindings(graph, evaluations),
    [graph, evaluations]
  );

  const [stored, setStored] = useState<Record<string, StoredFinding>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const canPersist = !!accessToken && !!workspaceId;

  const load = useCallback(async () => {
    if (!canPersist) return;
    try {
      const r = await fetch(
        apiBase + "/findings?workspaceId=" + encodeURIComponent(workspaceId!),
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      if (!r.ok) return;
      const d = await r.json();
      const map: Record<string, StoredFinding> = {};
      for (const f of d.findings ?? []) map[f.finding_id] = f;
      setStored(map);
    } catch {
      /* offline or unauthenticated — the list still reads */
    }
  }, [apiBase, accessToken, workspaceId, canPersist]);

  // Push what the scan found, then read back what anyone decided about it.
  useEffect(() => {
    if (!canPersist || scanned.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        await fetch(apiBase + "/findings/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + accessToken,
          },
          body: JSON.stringify({ workspaceId, findings: scanned }),
        });
      } catch {
        /* sync is best effort */
      }
      if (!cancelled) load();
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, accessToken, workspaceId, canPersist, scanned, load]);

  const patch = async (
    id: string,
    body: Record<string, unknown>,
    label: string
  ) => {
    if (!canPersist) {
      setNote("Sign in to record decisions.");
      return;
    }
    setBusy(id);
    setNote(null);
    try {
      const r = await fetch(
        apiBase + "/findings/" + encodeURIComponent(id),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + accessToken,
          },
          body: JSON.stringify({ workspaceId, ...body }),
        }
      );
      const d = await r.json();
      if (!r.ok) {
        setNote(d.error ?? "Could not " + label + ".");
        return;
      }
      if (d.finding) {
        setStored((s) => ({ ...s, [id]: d.finding }));
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  };

  const comment = async (id: string) => {
    const text = draft.trim();
    if (!text) return;
    if (!canPersist) {
      setNote("Sign in to comment.");
      return;
    }
    setBusy(id);
    try {
      const r = await fetch(
        apiBase + "/findings/" + encodeURIComponent(id) + "/comment",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + accessToken,
          },
          body: JSON.stringify({ workspaceId, text }),
        }
      );
      const d = await r.json();
      if (r.ok && d.finding) {
        setStored((s) => ({ ...s, [id]: d.finding }));
        setDraft("");
      } else {
        setNote(d.error ?? "Could not add the comment.");
      }
    } finally {
      setBusy(null);
    }
  };

  const setState = (f: Finding, next: string) => {
    // Waiving needs a reason; the server enforces this too.
    if (next === "waived") {
      const why = window.prompt(
        "Why is this being waived? A waiver without a reason is how a finding disappears quietly."
      );
      if (!why?.trim()) return;
      patch(f.id, { state: next, rationale: why.trim() }, "waive");
      return;
    }
    patch(f.id, { state: next }, "update");
  };

  if (scanned.length === 0) return null;

  const openCount = scanned.filter(
    (f) => (stored[f.id]?.state ?? "open") === "open"
  ).length;
  const decided = scanned.length - openCount;

  return (
    <div style={{ maxWidth: 860, marginBottom: 30 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.09em",
            color: "#6e7681",
          }}
        >
          FINDINGS, RANKED
        </span>
        <span style={{ fontSize: 11, color: "#6e7681" }}>
          {openCount} open
          {decided > 0 ? " · " + decided + " decided" : ""}
        </span>
        {!canPersist && (
          <span style={{ fontSize: 11, color: "#6e7681" }}>
            — sign in to record decisions
          </span>
        )}
      </div>

      {note && (
        <div
          style={{
            fontSize: 11.5,
            color: "#f85149",
            marginBottom: 8,
            fontFamily: MONO,
          }}
        >
          {note}
        </div>
      )}

      {scanned.map((f) => {
        const s = stored[f.id];
        const state = s?.state ?? "open";
        const isOpen = open === f.id;
        const log = s?.log ?? [];
        const comments = log.filter((e) => e.kind === "comment").length;

        return (
          <div
            key={f.id}
            style={{
              borderBottom: "1px solid #21262d",
              padding: "10px 0",
              opacity: state === "resolved" || state === "waived" ? 0.62 : 1,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "62px 1fr auto",
                gap: 12,
                alignItems: "start",
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  color: severityColor(f.severity),
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  paddingTop: 3,
                }}
              >
                {f.severity}
              </span>

              <span>
                <span
                  style={{
                    fontSize: 13,
                    color: "#e6edf3",
                    display: "block",
                    textDecoration:
                      state === "resolved" ? "line-through" : "none",
                  }}
                >
                  {f.title}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "#8b949e",
                    display: "block",
                    marginTop: 3,
                    lineHeight: 1.55,
                  }}
                >
                  {f.detail}
                </span>

                {s?.rationale && (
                  <span
                    style={{
                      display: "block",
                      marginTop: 6,
                      fontSize: 11.5,
                      color: "#a371f7",
                      fontFamily: MONO,
                    }}
                  >
                    waived: {s.rationale}
                  </span>
                )}

                {s?.absent && (
                  <span
                    style={{
                      display: "block",
                      marginTop: 6,
                      fontSize: 11,
                      color: "#6e7681",
                      fontFamily: MONO,
                    }}
                  >
                    not in the latest scan — kept for its history
                  </span>
                )}

                {(s?.recurrence_count ?? 1) > 1 && (
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      fontSize: 11,
                      color: "#d29922",
                      fontFamily: MONO,
                    }}
                  >
                    has come back {s!.recurrence_count} times
                  </span>
                )}
              </span>

              <span
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    padding: "2px 7px",
                    borderRadius: 4,
                    border: "1px solid " + STATE_COLOR[state],
                    color: STATE_COLOR[state],
                  }}
                >
                  {STATE_LABEL[state]}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(isOpen ? null : f.id);
                    setDraft("");
                  }}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 5,
                    border: "1px solid #30363d",
                    background: "transparent",
                    color: "#8b949e",
                    cursor: "pointer",
                  }}
                >
                  {/* Never "open" here — that is the state chip beside it, and two
                      controls a few pixels apart reading the same word is a bug. */}
                  {comments > 0 ? comments + (isOpen ? " ▴" : " ▾") : isOpen ? "▴" : "▾"}
                </button>
              </span>
            </div>

            {isOpen && (
              <div
                style={{
                  marginTop: 10,
                  marginLeft: 74,
                  paddingLeft: 12,
                  borderLeft: "1px solid #21262d",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginBottom: 10,
                  }}
                >
                  {(["open", "accepted", "waived", "resolved"] as const).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={busy === f.id || st === state}
                        onClick={() => setState(f, st)}
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          padding: "3px 9px",
                          borderRadius: 5,
                          border:
                            "1px solid " +
                            (st === state ? STATE_COLOR[st] : "#30363d"),
                          background:
                            st === state ? "rgba(88,166,255,0.08)" : "transparent",
                          color: st === state ? STATE_COLOR[st] : "#8b949e",
                          cursor: st === state ? "default" : "pointer",
                        }}
                      >
                        {st}
                      </button>
                    )
                  )}
                </div>

                {log.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {log
                      .slice()
                      .reverse()
                      .map((e, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: 11.5,
                            color: "#8b949e",
                            padding: "4px 0",
                            lineHeight: 1.5,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 10,
                              color: "#6e7681",
                            }}
                          >
                            {e.actor_name ?? "someone"} · {relative(e.at)} ·{" "}
                            {e.kind}
                          </span>
                          {logLine(e) && (
                            <div style={{ color: "#c9d1d9", marginTop: 2 }}>
                              {logLine(e)}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") comment(f.id);
                    }}
                    placeholder="Add a note"
                    style={{
                      flex: 1,
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      padding: "5px 9px",
                      fontSize: 12,
                      color: "#e6edf3",
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy === f.id || !draft.trim()}
                    onClick={() => comment(f.id)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      padding: "5px 11px",
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: "transparent",
                      color: "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    add
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "#484f58",
                    fontFamily: MONO,
                  }}
                >
                  evidence: {f.source}
                  {f.agent ? " · " + f.agent.split("/").pop() : ""}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
