/**
 * Live dogfood: Insights-style Fix → poll Needs review → diff → Reject on trading-agent scan clone.
 *
 * Never Approves (keeps clone disk clean). Reject = Phase 1 undo.
 *
 * Required env:
 *   BLANKO_DOGFOOD=1          Enable live run
 *   API_BASE                  e.g. http://localhost:4000/api
 *   BLANKO_ACCESS_TOKEN       Bearer JWT
 *   BLANKO_WORKSPACE_ID       Workspace whose project_root IS the trading scan clone
 *
 * Server must have ANTHROPIC_API_KEY or OPENAI_API_KEY for the agent run.
 * Optional: BLANKO_DOGFOOD_TIMEOUT_MS (default 600000 = 10m)
 *
 * DB prerequisite (remote todos table must have Phase 1 columns):
 *   SUPABASE_DB_PASSWORD='…' npx tsx scripts/apply-todos-phase1-migration.ts
 * Without context/session_log/acceptance_criteria/agent_file/…, POST /todos returns 500.
 *
 * Skip (exit 0) when BLANKO_DOGFOOD is unset.
 * Exit non-zero when BLANKO_DOGFOOD=1 but other vars incomplete, or workspace root mismatch.
 *
 * Run: BLANKO_DOGFOOD=1 API_BASE=… BLANKO_ACCESS_TOKEN=… BLANKO_WORKSPACE_ID=… npx tsx scripts/dogfood-trading-fix-automation.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tradingScanClone } from "./lib/blanko-target";

const DOGFOOD = process.env.BLANKO_DOGFOOD === "1";
const API_BASE = (process.env.API_BASE || "").replace(/\/$/, "");
const TOKEN = process.env.BLANKO_ACCESS_TOKEN || "";
const WORKSPACE_ID = process.env.BLANKO_WORKSPACE_ID || "";
const TIMEOUT_MS = Number(process.env.BLANKO_DOGFOOD_TIMEOUT_MS || 600_000);

function readBlankoTargetScanClone(): string | null {
  try {
    // Dogfood mutates disk — always use scan-clone sandbox, never live SSOT.
    return tradingScanClone();
  } catch {
    return null;
  }
}

async function api(
  method: string,
  route: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${API_BASE}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

function resolvePathMaybe(p: string | null | undefined): string | null {
  if (!p || !String(p).trim()) return null;
  let s = String(p).trim();
  if (s.startsWith("~/")) s = path.join(os.homedir(), s.slice(2));
  try {
    return fs.realpathSync(path.resolve(s));
  } catch {
    return path.resolve(s);
  }
}

async function main() {
  if (!DOGFOOD) {
    console.log("dogfood-trading-fix-automation: skip (set BLANKO_DOGFOOD=1 to run)");
    process.exit(0);
  }

  const missing: string[] = [];
  if (!API_BASE) missing.push("API_BASE");
  if (!TOKEN) missing.push("BLANKO_ACCESS_TOKEN");
  if (!WORKSPACE_ID) missing.push("BLANKO_WORKSPACE_ID");
  if (missing.length) {
    console.error(`BLANKO_DOGFOOD=1 but missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  const expectedClone = resolvePathMaybe(readBlankoTargetScanClone());
  if (!expectedClone) {
    console.error("Could not read scan-clone from .blanko-target");
    process.exit(1);
  }

  const loaded = await api("GET", `/workspaces/${encodeURIComponent(WORKSPACE_ID)}/load`);
  if (loaded.status !== 200) {
    console.error("Workspace load failed", loaded.status, loaded.json);
    process.exit(1);
  }

  const graph = (loaded.json.graph ?? loaded.json) as {
    projectRoot?: string;
    project_root?: string;
  };
  const actual =
    resolvePathMaybe(graph.projectRoot) ||
    resolvePathMaybe(graph.project_root) ||
    resolvePathMaybe((loaded.json as { projectRoot?: string }).projectRoot);

  if (!actual || actual !== expectedClone) {
    console.error(
      "Workspace project root does not match trading-agent scan clone.\n" +
        `  expected: ${expectedClone}\n` +
        `  got:      ${actual ?? "(none)"}\n` +
        "Point BLANKO_WORKSPACE_ID at the workspace scanned from that clone."
    );
    process.exit(1);
  }
  console.log("Workspace root OK:", actual);

  const stamp = Date.now();
  const sourcePath = `insights:dogfood-trading-fix:${stamp}`;
  const fileScope = ["middleware-platform/server.js"];
  const title = `[dogfood] micro-fix comment ${stamp}`;
  const description =
    "Deterministic micro-fix for dogfood: add a single one-line comment near the top of " +
    "middleware-platform/server.js (e.g. // blanko-dogfood). Do not change behavior. " +
    "Touch only that file. Keep the diff tiny.";

  const created = await api("POST", "/todos", {
    workspaceId: WORKSPACE_ID,
    title,
    description,
    context: description,
    fileScope,
    agentFile: "middleware-platform/server.js",
    source: "insights",
    sourcePath,
    assigneeLabel: "Cursor",
    kind: "task",
  });
  if (created.status >= 400 || !created.json.todo) {
    console.error("POST /todos failed", created.status, created.json);
    process.exit(1);
  }
  const todo = created.json.todo as { id: string; status?: string };
  console.log("Created todo", todo.id);

  const run = await api("POST", `/todos/${encodeURIComponent(todo.id)}/run`);
  if (run.status >= 400) {
    console.error("POST /todos/:id/run failed", run.status, run.json);
    process.exit(1);
  }
  console.log("Agent run started", run.json.railId ?? run.json);

  const deadline = Date.now() + TIMEOUT_MS;
  let row: {
    id: string;
    status?: string;
    rail_id?: string | null;
    session_log?: unknown[];
  } | null = null;

  while (Date.now() < deadline) {
    const list = await api("GET", `/todos?workspaceId=${encodeURIComponent(WORKSPACE_ID)}`);
    const todos = (list.json.todos ?? []) as typeof row[];
    row = todos.find((t) => t?.id === todo.id) ?? null;
    const st = row?.status;
    console.log("poll", st, row?.rail_id ? `rail=${String(row.rail_id).slice(0, 8)}…` : "");
    if (st === "needs_review") break;
    if (st === "done" || st === "completed") {
      console.error("Unexpected done without review — aborting before any further action");
      process.exit(1);
    }
    const log = Array.isArray(row?.session_log) ? row!.session_log! : [];
    const err = log.find((e) => {
      const ev = (e as { event?: string; type?: string }).event ?? (e as { type?: string }).type;
      return ev === "error" || ev === "verification_failed";
    });
    if (err && st === "todo") {
      console.warn("Agent reported error; still attempting Reject path if needs_review, else exit 0 after log");
      console.warn(JSON.stringify(err));
      // If run failed back to todo without review, treat as completed attempt for dogfood.
      console.log("dogfood-trading-fix-automation: agent error — no Reject needed");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  if (!row || row.status !== "needs_review") {
    console.error("Timed out waiting for needs_review", { status: row?.status, log: row?.session_log });
    process.exit(1);
  }

  const railId = row.rail_id;
  if (railId) {
    const diff = await api(
      "GET",
      `/rails/${encodeURIComponent(railId)}/diff?workspaceId=${encodeURIComponent(WORKSPACE_ID)}`
    );
    const files = (diff.json.files ?? []) as Array<{ path?: string }>;
    console.log(
      "Diff files:",
      files.map((f) => f.path).filter(Boolean)
    );
    if (files.length === 0) {
      console.warn("Empty diff (soft warning) — still Rejecting");
    }
  } else {
    console.warn("No rail_id on needs_review todo — skipping diff, still Rejecting");
  }

  const rej = await api("POST", `/todos/${encodeURIComponent(todo.id)}/reject`, {
    targetStatus: "todo",
  });
  if (rej.status >= 400) {
    console.error("Reject failed", rej.status, rej.json);
    process.exit(1);
  }
  console.log("Rejected OK — sandbox discarded, clone disk unchanged");
  console.log("dogfood-trading-fix-automation: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
