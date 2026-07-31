/**
 * Reviewing what the tool changed.
 *
 * Changes land immediately rather than waiting in a sandbox, so this is the
 * step that makes that defensible: every write is listed with its diff and can
 * be put back exactly. Without it the tool writes into a repository and the
 * only record is whatever the model said it did — and today it reported
 * creating a file three searches could not find.
 *
 * The Code tab held a message saying "No file selected" and did nothing. This
 * is what it should have been.
 */
import { useCallback, useEffect, useState } from "react";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Change = {
  id: string;
  at: string;
  action: "edit" | "create";
  file: string;
  reverted: boolean;
  revertedAt: string | null;
  stats: { added: number; removed: number };
  diff: string;
};

type Props = {
  projectRoot?: string | null;
  apiBase: string;
  accessToken: string | null;
};

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

function DiffBody({ diff }: { diff: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 6,
        fontFamily: MONO,
        fontSize: 11.5,
        lineHeight: 1.6,
        overflowX: "auto",
        whiteSpace: "pre",
      }}
    >
      {diff.split("\n").map((line, i) => {
        const kind = line.startsWith("+ ")
          ? "add"
          : line.startsWith("- ")
            ? "del"
            : "ctx";
        return (
          <div
            key={i}
            style={{
              color:
                kind === "add" ? "#3fb950" : kind === "del" ? "#f85149" : "#6e7681",
              background:
                kind === "add"
                  ? "rgba(63,185,80,0.07)"
                  : kind === "del"
                    ? "rgba(248,81,73,0.07)"
                    : "transparent",
            }}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function ChangesPanel({ projectRoot, apiBase, accessToken }: Props) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectRoot || !accessToken) return;
    setLoading(true);
    try {
      const r = await fetch(
        apiBase + "/changes?projectRoot=" + encodeURIComponent(projectRoot),
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "Could not load changes.");
        return;
      }
      setChanges(d.changes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, accessToken, projectRoot]);

  useEffect(() => {
    load();
  }, [load]);

  const revert = async (id: string) => {
    if (!projectRoot || !accessToken) return;
    setBusy(id);
    setError(null);
    try {
      const r = await fetch(apiBase + "/changes/" + id + "/revert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({ projectRoot }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "Could not revert.");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  };

  if (!accessToken) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: "#8b949e", lineHeight: 1.6 }}>
        Sign in to see what the tool has changed.
      </div>
    );
  }

  if (!projectRoot) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: "#8b949e", lineHeight: 1.6 }}>
        Scan a repository to review changes.
      </div>
    );
  }

  const live = changes.filter((c) => !c.reverted).length;

  return (
    <div style={{ padding: "12px 4px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 12,
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
          CHANGES
        </span>
        <span style={{ fontSize: 11, color: "#6e7681" }}>
          {live} applied
          {changes.length > live ? " · " + (changes.length - live) + " reverted" : ""}
        </span>
        <button
          type="button"
          onClick={load}
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 5,
            border: "1px solid #30363d",
            background: "transparent",
            color: "#8b949e",
            cursor: "pointer",
          }}
        >
          {loading ? "…" : "refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            fontSize: 11.5,
            color: "#f85149",
            marginBottom: 10,
            fontFamily: MONO,
          }}
        >
          {error}
        </div>
      )}

      {changes.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#8b949e", lineHeight: 1.65 }}>
          Nothing has been changed in this repository yet. Ask in chat for an
          edit and it will appear here with its diff, so you can see exactly
          what happened and put it back if it is wrong.
        </div>
      ) : (
        changes.map((c) => {
          const isOpen = expanded === c.id;
          return (
            <div
              key={c.id}
              style={{
                borderBottom: "1px solid #21262d",
                padding: "9px 0",
                opacity: c.reverted ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid " + (c.action === "create" ? "#3fb950" : "#58a6ff"),
                    color: c.action === "create" ? "#3fb950" : "#58a6ff",
                  }}
                >
                  {c.action}
                </span>

                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    color: "#e6edf3",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: c.reverted ? "line-through" : "none",
                  }}
                  title={c.file}
                >
                  {c.file}
                </span>

                <span style={{ fontFamily: MONO, fontSize: 10.5, whiteSpace: "nowrap" }}>
                  <span style={{ color: "#3fb950" }}>+{c.stats.added}</span>{" "}
                  <span style={{ color: "#f85149" }}>−{c.stats.removed}</span>
                </span>

                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: "#6e7681",
                    whiteSpace: "nowrap",
                  }}
                >
                  {relative(c.at)}
                </span>

                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
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
                  {isOpen ? "▴" : "▾"}
                </button>

                {!c.reverted && (
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => revert(c.id)}
                    title="Put this file back as it was"
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 5,
                      border: "1px solid #30363d",
                      background: "transparent",
                      color: "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    {busy === c.id ? "…" : "revert"}
                  </button>
                )}
              </div>

              {c.reverted && c.revertedAt && (
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: "#6e7681",
                    marginTop: 4,
                  }}
                >
                  reverted {relative(c.revertedAt)}
                </div>
              )}

              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  <DiffBody diff={c.diff} />
                </div>
              )}
            </div>
          );
        })
      )}

      <p
        style={{
          marginTop: 18,
          fontSize: 11,
          color: "#484f58",
          lineHeight: 1.6,
        }}
      >
        Changes are applied as they are made, not held for approval. An edit
        that fails its typecheck is reverted automatically; this list is for the
        ones that compiled and may still be wrong.
      </p>
    </div>
  );
}
