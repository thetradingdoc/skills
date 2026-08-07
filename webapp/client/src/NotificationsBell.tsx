import { useCallback, useEffect, useRef, useState } from "react";
import { ACCENT, CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "./theme/tokens";

const POLL_MS = 30000;

type Notification = {
  id: string;
  workspace_id: string | null;
  kind: "mention" | "assign" | "claim" | "system";
  title: string;
  body: string | null;
  deep_link: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type Staleness = {
  available: boolean;
  reason?: string;
  changed: number;
  files?: { path: string; modified: string; isNew: boolean }[];
  truncated?: boolean;
  scannedCommit?: string;
  summary?: string;
};

interface Props {
  apiBase: string;
  accessToken: string | null;
  onNavigate?: (deepLink: Record<string, unknown>) => void;
  /** blanko = outline bell on light chrome; legacy = emoji on dark chrome */
  variant?: "legacy" | "blanko";
  /** Scan workspace: show repo-change + Rescan inside the bell panel */
  projectRoot?: string | null;
  generatedAt?: number | null;
  scannedCommit?: string | null;
  onRescan?: () => void;
  scanning?: boolean;
  hideStaleness?: boolean;
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function BellOutlineIcon({ color = SLATE }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.2 1.5 5.5 1.5 5.5H5s1.5-1.3 1.5-5.5Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M10 18.5a2 2 0 0 0 4 0" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function NotificationsBell({
  apiBase,
  accessToken,
  onNavigate,
  variant = "legacy",
  projectRoot,
  generatedAt,
  scannedCommit,
  onRescan,
  scanning,
  hideStaleness,
}: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [staleness, setStaleness] = useState<Staleness | null>(null);
  const [open, setOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blanko = variant === "blanko";

  const fetchNotifications = useCallback(async () => {
    if (!accessToken) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const r = await fetch(`${apiBase}/notifications`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return;
      const d = await r.json();
      setNotifications(d.notifications ?? []);
      setUnreadCount(d.unreadCount ?? 0);
    } catch {
      /* best-effort */
    }
  }, [apiBase, accessToken]);

  const fetchStaleness = useCallback(async () => {
    if (hideStaleness || !projectRoot || !generatedAt || !accessToken) {
      setStaleness(null);
      return;
    }
    try {
      const r = await fetch(
        apiBase +
          "/scan-staleness?projectRoot=" +
          encodeURIComponent(projectRoot) +
          "&since=" +
          generatedAt +
          (scannedCommit ? `&scannedCommit=${encodeURIComponent(scannedCommit)}` : ""),
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      if (!r.ok) return;
      setStaleness(await r.json());
    } catch {
      /* best-effort */
    }
  }, [apiBase, accessToken, projectRoot, generatedAt, scannedCommit, hideStaleness]);

  useEffect(() => {
    fetchNotifications();
    fetchStaleness();
    if (pollRef.current) clearInterval(pollRef.current);
    if (!accessToken) return;
    pollRef.current = setInterval(() => {
      fetchNotifications();
      fetchStaleness();
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchNotifications, fetchStaleness, accessToken]);

  useEffect(() => {
    setFilesOpen(false);
  }, [generatedAt]);

  const markRead = useCallback(
    async (id: string) => {
      if (!accessToken) return;
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await fetch(`${apiBase}/notifications/${id}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        /* best-effort */
      }
    },
    [apiBase, accessToken]
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.deep_link && onNavigate) onNavigate(n.deep_link);
      setOpen(false);
    },
    [markRead, onNavigate]
  );

  if (!accessToken) return null;

  const repoNeedsRescan =
    !!onRescan &&
    !!staleness &&
    ((staleness.available && staleness.changed > 0) || !staleness.available);
  const tipSha = (scannedCommit || staleness?.scannedCommit || "").slice(0, 7);
  const showScanTip =
    !!onRescan && !!projectRoot && !!generatedAt && (!!tipSha || !!staleness);
  const badgeCount = unreadCount + (repoNeedsRescan ? 1 : 0);

  return (
    <div style={{ position: "relative", fontFamily: blanko ? FONT_UI : "JetBrains Mono, ui-monospace, monospace" }}>
      <button
        type="button"
        data-testid="notifications-bell"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        style={
          blanko
            ? {
                position: "relative",
                width: 32,
                height: 32,
                borderRadius: 999,
                border: `1px solid ${LINE}`,
                background: open ? PAPER : CANVAS,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }
            : {
                position: "relative",
                padding: "2px 8px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid #30363d",
                background: "transparent",
                color: "#8b949e",
                cursor: "pointer",
              }
        }
      >
        {blanko ? <BellOutlineIcon color={badgeCount > 0 ? INK : SLATE} /> : "🔔"}
        {badgeCount > 0 && (
          <span
            data-testid="notifications-bell-badge"
            style={{
              position: "absolute",
              top: blanko ? -2 : -4,
              right: blanko ? -2 : -4,
              minWidth: 14,
              height: 14,
              padding: "0 3px",
              borderRadius: 999,
              background: ACCENT,
              color: "white",
              fontSize: 9,
              lineHeight: "14px",
              textAlign: "center",
              fontFamily: FONT_UI,
              fontWeight: 700,
            }}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div
            data-testid="notifications-panel"
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 8,
              width: 320,
              maxHeight: 440,
              overflowY: "auto",
              background: blanko ? CANVAS : "#161b22",
              border: blanko ? `1px solid ${LINE}` : "1px solid #30363d",
              borderRadius: blanko ? 12 : 8,
              boxShadow: blanko ? "0 12px 32px rgba(18,19,26,0.12)" : "0 12px 32px rgba(0,0,0,0.45)",
              zIndex: 91,
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderBottom: blanko ? `1px solid ${LINE}` : "1px solid #30363d",
                fontSize: 11,
                fontWeight: 600,
                color: blanko ? SLATE : "#6e7681",
                letterSpacing: 0.04,
              }}
            >
              Notifications
            </div>

            {showScanTip && onRescan ? (
              <div
                data-testid="notifications-rescan-row"
                style={{
                  padding: "12px",
                  borderBottom: blanko ? `1px solid ${LINE}` : "1px solid #21262d",
                  background: repoNeedsRescan
                    ? blanko
                      ? ACCENT + "0c"
                      : "rgba(239,50,166,0.08)"
                    : blanko
                      ? PAPER
                      : "#0d1117",
                  fontFamily: FONT_UI,
                }}
              >
                {tipSha ? (
                  <div
                    data-testid="notifications-scan-commit"
                    style={{
                      fontSize: 11,
                      fontFamily: "ui-monospace, monospace",
                      color: blanko ? SLATE : "#8b949e",
                      marginBottom: 6,
                    }}
                  >
                    Clone at {tipSha}
                    {staleness?.available && staleness.changed === 0 ? " · up to date" : ""}
                  </div>
                ) : null}
                <div style={{ fontSize: 13, fontWeight: 700, color: blanko ? INK : "#e6edf3" }}>
                  {!staleness
                    ? "Repository scan"
                    : !staleness.available
                      ? staleness.reason ?? "Scan unavailable"
                      : staleness.changed > 0
                        ? `${staleness.changed} file${staleness.changed === 1 ? "" : "s"} changed since this scan`
                        : staleness.summary || "Nothing changed since this scan"}
                </div>
                <div style={{ fontSize: 12, color: blanko ? SLATE : "#8b949e", marginTop: 4, lineHeight: 1.4 }}>
                  Rescan pulls the latest clone from GitHub, then rebuilds the canvas.
                </div>
                {staleness?.available && (staleness.files?.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    data-testid="notifications-which-files"
                    onClick={() => setFilesOpen((v) => !v)}
                    style={{
                      marginTop: 8,
                      border: "none",
                      background: "none",
                      padding: 0,
                      color: ACCENT,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                      fontFamily: FONT_UI,
                    }}
                  >
                    {filesOpen ? "Hide files" : "Which files"}
                  </button>
                ) : null}
                {filesOpen && staleness?.files && (
                  <ul
                    style={{
                      margin: "8px 0 0",
                      paddingLeft: 16,
                      fontSize: 11,
                      color: blanko ? INK : "#e6edf3",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {staleness.files.slice(0, 12).map((f) => (
                      <li key={f.path} style={{ marginBottom: 2 }}>
                        {f.isNew ? "+ " : ""}
                        {f.path}
                      </li>
                    ))}
                    {staleness.truncated ? <li>…</li> : null}
                  </ul>
                )}
                <button
                  type="button"
                  data-testid="notifications-rescan"
                  disabled={!!scanning}
                  onClick={() => {
                    onRescan();
                    setOpen(false);
                  }}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: ACCENT,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: scanning ? "wait" : "pointer",
                    fontFamily: FONT_UI,
                    opacity: scanning ? 0.7 : 1,
                  }}
                >
                  {scanning ? "Scanning…" : "Rescan"}
                </button>
              </div>
            ) : null}

            {notifications.length === 0 && !showScanTip ? (
              <div style={{ padding: 16, fontSize: 13, color: blanko ? SLATE : "#6e7681", fontFamily: FONT_UI }}>
                Nothing yet — mentions, assignments, and repo changes show up here.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    padding: "10px 12px",
                    borderBottom: blanko ? `1px solid ${LINE}` : "1px solid #21262d",
                    cursor: "pointer",
                    background: n.read_at ? "transparent" : blanko ? ACCENT + "0c" : "rgba(88,166,255,0.06)",
                    fontFamily: FONT_UI,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        color: blanko ? INK : "#e6edf3",
                        fontWeight: n.read_at ? 400 : 600,
                      }}
                    >
                      {n.title}
                    </span>
                    {!n.read_at && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: ACCENT,
                          flexShrink: 0,
                          marginTop: 4,
                        }}
                      />
                    )}
                  </div>
                  {n.body && (
                    <div style={{ fontSize: 12, color: blanko ? SLATE : "#8b949e", marginTop: 3, lineHeight: 1.4 }}>
                      {n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: blanko ? SLATE : "#6e7681", marginTop: 4 }}>
                    {relative(n.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
