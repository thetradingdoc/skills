/**
 * A shell, in the app.
 *
 * This is the piece that turns the tool from somewhere you inspect a repository
 * into somewhere you work in one: git, npm, anything that needs a prompt or a
 * password. It talks to a pty on the server over a websocket, so it behaves
 * like a real terminal rather than a command runner with a text box.
 *
 * It opens in the scanned repository, which is almost always where you want to
 * be — and is the difference between this and opening Terminal.app, where the
 * first thing you do is cd somewhere.
 *
 * The server refuses to register this endpoint at all unless TERMINAL_ENABLED=1
 * and it is bound to loopback, so a deployed instance has no terminal to find.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
  /** Where the shell opens. The scanned repository, when there is one. */
  cwd?: string | null;
  accessToken: string | null;
  /** Base URL of the API, used to derive the websocket origin. */
  apiBase: string;
};

const MONO = "JetBrains Mono, ui-monospace, monospace";

/** Matches the rest of the interface rather than xterm's defaults. */
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

export function TerminalView({ cwd, accessToken, apiBase }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [openedIn, setOpenedIn] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current || !accessToken) return;

    const term = new Terminal({
      fontFamily: MONO,
      fontSize: 12.5,
      lineHeight: 1.35,
      theme: THEME,
      cursorBlink: true,
      scrollback: 5000,
      // A shell that cannot be scrolled back is a shell you cannot read.
      convertEol: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    setStatus("connecting");

    // API_BASE is "/api", a relative path the dev server proxies. A websocket
    // needs a real origin, and Vite does not proxy upgrades unless configured
    // to. The terminal only runs locally anyway, so it connects straight to the
    // API server rather than pretending to route like the rest of the app.
    const origin =
      (import.meta as { env?: Record<string, string> }).env?.VITE_API_ORIGIN ??
      (apiBase.startsWith("http")
        ? apiBase.replace(/\/api$/, "")
        : window.location.protocol + "//" + window.location.hostname + ":4000");

    const wsUrl =
      origin.replace(/^http/, "ws") +
      "/api/terminal?token=" +
      encodeURIComponent(accessToken) +
      (cwd ? "&cwd=" + encodeURIComponent(cwd) : "");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      // a stale failure message outliving a successful reconnect reads as broken
      setMessage(null);
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (ev) => {
      let msg: { type?: string; data?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "out" && msg.data) term.write(msg.data);
      if (msg.type === "ready") setOpenedIn(msg.data ?? null);
      if (msg.type === "error") {
        setStatus("error");
        setMessage(msg.data ?? "The shell could not start.");
      }
      if (msg.type === "exit") {
        setStatus("closed");
        setMessage("The shell exited. Reload to start another.");
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setMessage(
        "Could not connect. The terminal only runs locally — check the server started with TERMINAL_ENABLED=1."
      );
    };

    ws.onclose = () => {
      setStatus((s) => (s === "error" ? s : "closed"));
    };

    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "in", data }));
      }
    });

    // The pty needs to know the window size or output wraps at the wrong column.
    const resize = () => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* the container may not be laid out yet */
      }
    };

    const observer = new ResizeObserver(resize);
    if (hostRef.current) observer.observe(hostRef.current);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      onData.dispose();
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [accessToken, apiBase, cwd]);

  if (!accessToken) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e", lineHeight: 1.65 }}>
        Sign in to open a terminal.
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background:
              status === "open"
                ? "#3fb950"
                : status === "connecting"
                  ? "#d29922"
                  : status === "error"
                    ? "#f85149"
                    : "#6e7681",
          }}
        />
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8b949e" }}>
          {status === "open" && openedIn
            ? openedIn
            : status === "connecting"
              ? "connecting…"
              : status === "closed"
                ? "closed"
                : status === "error"
                  ? "not connected"
                  : ""}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10,
            color: "#484f58",
          }}
        >
          local only
        </span>
      </div>

      {message && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11.5,
            color: status === "error" ? "#f85149" : "#8b949e",
            fontFamily: MONO,
            borderBottom: "1px solid #21262d",
            flexShrink: 0,
          }}
        >
          {message}
        </div>
      )}

      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: "6px 8px",
        }}
      />
    </div>
  );
}
