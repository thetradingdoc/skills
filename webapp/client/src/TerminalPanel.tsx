/**
 * Terminals, plural, that survive leaving the tab.
 *
 * Two problems with the single view this replaces. Switching to Files unmounted
 * it, which closed the websocket and destroyed the scrollback — you came back
 * to an empty prompt and a lost session. And there was only ever one, so
 * checking something meant abandoning whatever was running.
 *
 * Both come from the same place: a terminal is stateful in a way the rest of
 * this app is not. Every other view can be rebuilt from the graph; a shell
 * cannot. So sessions are kept mounted and hidden with CSS rather than
 * conditionally rendered, and the panel holds several at once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const MONO = "JetBrains Mono, ui-monospace, monospace";

const THEME = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "rgba(88,166,255,0.25)",
  black: "#484f58",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#a371f7",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ff7b72",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

type SessionProps = {
  id: string;
  cwd?: string | null;
  accessToken: string | null;
  apiBase: string;
  /** Hidden sessions stay mounted so their shell and scrollback survive. */
  active: boolean;
  onStatus: (id: string, status: SessionStatus, cwd?: string) => void;
};

type SessionStatus = "connecting" | "open" | "closed" | "error";

function TerminalSession({
  id,
  cwd,
  accessToken,
  apiBase,
  active,
  onStatus,
}: SessionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Frozen at creation. A chat response updates the graph, and with cwd in the
  // effect deps that tore the shell down and reconnected it — losing scrollback
  // on every prompt. The directory you started in is also not where you are
  // after a cd, so following the graph was wrong anyway.
  const cwdRef = useRef<string | null | undefined>(cwd);

  useEffect(() => {
    if (!hostRef.current || !accessToken) return;

    const term = new Terminal({
      fontFamily: MONO,
      fontSize: 12.5,
      lineHeight: 1.35,
      theme: THEME,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* container may have no size yet */
    }

    termRef.current = term;
    fitRef.current = fit;
    onStatus(id, "connecting");

    const origin =
      (import.meta as { env?: Record<string, string> }).env?.VITE_API_ORIGIN ??
      (apiBase.startsWith("http")
        ? apiBase.replace(/\/api$/, "")
        : window.location.protocol + "//" + window.location.hostname + ":4000");

    const ws = new WebSocket(
      origin.replace(/^http/, "ws") +
        "/api/terminal?token=" +
        encodeURIComponent(accessToken) +
        (cwdRef.current ? "&cwd=" + encodeURIComponent(cwdRef.current) : "")
    );
    wsRef.current = ws;

    ws.onopen = () => {
      onStatus(id, "open");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (ev) => {
      let msg: { type?: string; data?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "out" && msg.data) term.write(msg.data);
      if (msg.type === "ready") onStatus(id, "open", msg.data);
      if (msg.type === "error") {
        term.write("\r\n\x1b[31m" + (msg.data ?? "error") + "\x1b[0m\r\n");
        onStatus(id, "error");
      }
      if (msg.type === "exit") onStatus(id, "closed");
    };

    ws.onerror = () => onStatus(id, "error");
    ws.onclose = () => onStatus(id, "closed");

    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "in", data }));
      }
    });

    const resize = () => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* not laid out */
      }
    };

    const obs = new ResizeObserver(resize);
    if (hostRef.current) obs.observe(hostRef.current);
    window.addEventListener("resize", resize);

    return () => {
      obs.disconnect();
      window.removeEventListener("resize", resize);
      onData.dispose();
      try {
        ws.close();
      } catch {
        /* closing */
      }
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
    // Deliberately not depending on `active` — remounting on every tab switch
    // is the bug this component exists to fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accessToken, apiBase]);

  // A hidden container has no size, so xterm's last fit was against zero.
  // Refit and refocus when this session comes back into view.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit();
        termRef.current?.focus();
        const ws = wsRef.current;
        const term = termRef.current;
        if (ws?.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* not laid out yet */
      }
    }, 40);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div
      ref={hostRef}
      style={{
        // display:none rather than unmounting — the shell and its scrollback
        // are the state, and rebuilding them is not possible.
        display: active ? "block" : "none",
        height: "100%",
        padding: "6px 8px",
      }}
    />
  );
}

type Session = {
  id: string;
  label: string;
  status: SessionStatus;
  cwd?: string;
};

type Props = {
  cwd?: string | null;
  accessToken: string | null;
  apiBase: string;
};

const MAX_SESSIONS = 5;

export function TerminalPanel({ cwd, accessToken, apiBase }: Props) {
  const [sessions, setSessions] = useState<Session[]>([
    { id: "t1", label: "1", status: "connecting" },
  ]);
  const [activeId, setActiveId] = useState("t1");

  const handleStatus = useCallback(
    (id: string, status: SessionStatus, sessionCwd?: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status, cwd: sessionCwd ?? s.cwd } : s
        )
      );
    },
    []
  );

  const addSession = () => {
    if (sessions.length >= MAX_SESSIONS) return;
    const n = Math.max(0, ...sessions.map((s) => Number(s.label) || 0)) + 1;
    const id = "t" + Date.now().toString(36);
    setSessions((prev) => [...prev, { id, label: String(n), status: "connecting" }]);
    setActiveId(id);
  };

  const closeSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        // Never leave the panel empty — a terminal tab with no terminal in it
        // is a dead end.
        const fresh = { id: "t" + Date.now().toString(36), label: "1", status: "connecting" as const };
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  if (!accessToken) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e", lineHeight: 1.65 }}>
        Sign in to open a terminal.
      </div>
    );
  }

  const active = sessions.find((s) => s.id === activeId);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <span
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 4px 2px 8px",
                borderRadius: 6,
                border: isActive ? "1px solid #58a6ff" : "1px solid #30363d",
                background: isActive ? "rgba(88,166,255,0.10)" : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                title={s.cwd ?? "Terminal " + s.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "none",
                  border: 0,
                  padding: 0,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: isActive ? "#58a6ff" : "#8b949e",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background:
                      s.status === "open"
                        ? "#3fb950"
                        : s.status === "connecting"
                          ? "#d29922"
                          : s.status === "error"
                            ? "#f85149"
                            : "#6e7681",
                  }}
                />
                {s.label}
              </button>

              <button
                type="button"
                onClick={() => closeSession(s.id)}
                title="Close this terminal"
                style={{
                  background: "none",
                  border: 0,
                  padding: "0 2px",
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: 1,
                  color: "#484f58",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </span>
          );
        })}

        {sessions.length < MAX_SESSIONS && (
          <button
            type="button"
            onClick={addSession}
            title="New terminal"
            style={{
              padding: "3px 9px",
              borderRadius: 6,
              border: "1px dashed #30363d",
              background: "transparent",
              color: "#6e7681",
              fontFamily: MONO,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            +
          </button>
        )}

        <span
          style={{
            marginLeft: 10,
            fontFamily: MONO,
            fontSize: 10,
            color: "#6e7681",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
          title={active?.cwd ?? undefined}
        >
          {active?.cwd ?? ""}
        </span>

        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: "#484f58",
            flexShrink: 0,
          }}
        >
          local only
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {sessions.map((s) => (
          <TerminalSession
            key={s.id}
            id={s.id}
            cwd={cwd}
            accessToken={accessToken}
            apiBase={apiBase}
            active={s.id === activeId}
            onStatus={handleStatus}
          />
        ))}
      </div>
    </div>
  );
}
