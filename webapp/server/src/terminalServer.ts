/**
 * A shell, over a websocket — without a pty.
 *
 * node-pty would give a true terminal: interactive prompts, colours, curses
 * applications. It refuses to spawn on this machine and every variant of the
 * call failed identically, so this uses child_process instead.
 *
 * What that costs: anything that stops and asks a question. A password prompt,
 * `npm init`, an interactive rebase. Those will appear to hang, because there
 * is no tty for them to read from.
 *
 * What it keeps: git status, diff, commit, push over SSH, npm install, test,
 * build, and every other command that runs to completion. That is the large
 * majority of what anyone types in a project directory.
 *
 * Each command runs as its own process rather than in a persistent shell, so
 * `cd` is tracked here — otherwise every command would start back where the
 * session began.
 *
 * The security gate is unchanged and is the important part: TERMINAL_ENABLED=1,
 * loopback binding, and a signed-in user, all required, or the route is never
 * registered. There is nothing to find on a deployed instance.
 */
import type { Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { supabaseAdmin } from "./supabaseAdmin.js";

type Session = {
  socket: WebSocket;
  cwd: string;
  running: ChildProcess | null;
};

const sessions = new Set<Session>();

export function terminalEnabled(): boolean {
  if (process.env.TERMINAL_ENABLED !== "1") return false;
  const host = (process.env.HOST ?? "localhost").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
}

async function userFromToken(token: string | undefined): Promise<string | null> {
  if (!token || !supabaseAdmin) return null;
  try {
    const { data } = await supabaseAdmin.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

function resolveCwd(requested: string | undefined): string {
  const home = os.homedir();
  if (!requested) return home;
  try {
    const abs = path.resolve(requested);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
  } catch {
    /* fall through */
  }
  return home;
}

function send(ws: WebSocket, type: string, data: string): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, data }));
}

/** Written here, since there is no shell to write one. */
function prompt(session: Session): string {
  const home = os.homedir();
  const shown = session.cwd.startsWith(home)
    ? "~" + session.cwd.slice(home.length)
    : session.cwd;
  return "\r\n\x1b[36m" + shown + "\x1b[0m $ ";
}

function runCommand(session: Session, line: string): void {
  const ws = session.socket;
  const trimmed = line.trim();

  if (!trimmed) {
    send(ws, "out", prompt(session));
    return;
  }

  // cd is handled here: each command is its own process, so a cd inside a child
  // would be forgotten the moment it exits.
  if (trimmed === "cd" || trimmed.startsWith("cd ")) {
    const target = trimmed.slice(2).trim() || os.homedir();
    const next = path.resolve(session.cwd, target.replace(/^~/, os.homedir()));
    if (fs.existsSync(next) && fs.statSync(next).isDirectory()) {
      session.cwd = next;
    } else {
      send(ws, "out", "\r\ncd: no such directory: " + target);
    }
    send(ws, "out", prompt(session));
    return;
  }

  if (trimmed === "clear") {
    send(ws, "out", "\x1b[2J\x1b[H");
    send(ws, "out", prompt(session));
    return;
  }

  if (trimmed === "exit") {
    send(ws, "out", "\r\n");
    ws.close();
    return;
  }

  send(ws, "out", "\r\n");

  // A login shell so aliases, PATH and version managers behave as they do in a
  // real terminal.
  const child = spawn(process.env.SHELL || "/bin/zsh", ["-lc", trimmed], {
    cwd: session.cwd,
    env: { ...process.env, TERM: "xterm-256color", FORCE_COLOR: "1" },
  });

  session.running = child;

  child.stdout?.on("data", (b: Buffer) =>
    send(ws, "out", b.toString().replace(/\n/g, "\r\n"))
  );
  child.stderr?.on("data", (b: Buffer) =>
    send(ws, "out", b.toString().replace(/\n/g, "\r\n"))
  );

  child.on("error", (err) => {
    send(ws, "out", "\r\n\x1b[31m" + err.message + "\x1b[0m");
    session.running = null;
    send(ws, "out", prompt(session));
  });

  child.on("close", (code) => {
    session.running = null;
    if (code && code !== 0) {
      send(ws, "out", "\r\n\x1b[31mexit " + code + "\x1b[0m");
    }
    send(ws, "out", prompt(session));
  });
}

export function attachTerminal(server: Server): void {
  if (!terminalEnabled()) {
    console.log("[terminal] not enabled — set TERMINAL_ENABLED=1 and bind to localhost");
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/api/terminal") return;

    const userId = await userFromToken(url.searchParams.get("token") ?? undefined);
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, url.searchParams.get("cwd"));
    });
  });

  wss.on("connection", (ws: WebSocket, _req: unknown, cwdParam?: string | null) => {
    const session: Session = {
      socket: ws,
      cwd: resolveCwd(cwdParam ?? undefined),
      running: null,
    };
    sessions.add(session);

    send(ws, "ready", session.cwd);
    send(
      ws,
      "out",
      "\x1b[2m Commands run one at a time. Anything that waits for input — a" +
        " password prompt, an interactive rebase — will appear to hang.\x1b[0m\r\n"
    );
    send(ws, "out", prompt(session));

    // The client sends raw keystrokes; the line is assembled here so that
    // backspace and Ctrl-C behave as expected.
    let buffer = "";

    ws.on("message", (raw) => {
      let msg: { type?: string; data?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type !== "in" || typeof msg.data !== "string") return;

      for (const ch of msg.data) {
        if (ch === "\x03") {
          if (session.running) {
            session.running.kill("SIGINT");
            send(ws, "out", "^C");
          } else {
            buffer = "";
            send(ws, "out", "^C" + prompt(session));
          }
          continue;
        }

        if (ch === "\r" || ch === "\n") {
          const line = buffer;
          buffer = "";
          if (session.running) {
            send(ws, "out", "\r\n\x1b[2m(a command is still running)\x1b[0m");
            continue;
          }
          runCommand(session, line);
          continue;
        }

        if (ch === "\x7f" || ch === "\b") {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            send(ws, "out", "\b \b");
          }
          continue;
        }

        // Ignore other control characters rather than echoing noise.
        if (ch < " ") continue;

        buffer += ch;
        send(ws, "out", ch);
      }
    });

    ws.on("close", () => {
      try {
        session.running?.kill();
      } catch {
        /* already gone */
      }
      sessions.delete(session);
    });
  });

  console.log("[terminal] enabled at ws://localhost:<port>/api/terminal (pipe mode)");
}

export function closeAllTerminals(): void {
  for (const s of sessions) {
    try {
      s.running?.kill();
      s.socket.close();
    } catch {
      /* best effort */
    }
  }
  sessions.clear();
}
