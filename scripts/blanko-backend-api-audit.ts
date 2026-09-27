/**
 * Deep Blanko backend API audit (plan todo: backend-blanko).
 * Uses minted Supabase user JWT (no CHAT_DEV_BYPASS).
 * Probes: todos, scan/refresh, scan-staleness, platforms-from-scan, workspace save revision + CRDT units.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { tradingLiveRoot, tradingScanClone } from "./lib/blanko-target.ts";

const OUT = path.resolve("docs/ops/blanko-dual-audit");
const API = process.env.API_URL ?? "http://localhost:4000";
const SCAN_CLONE = process.env.BLANKO_TARGET_ROOT?.trim()
  ? process.env.BLANKO_TARGET_ROOT.trim()
  : (() => {
      try {
        return tradingLiveRoot();
      } catch {
        return tradingScanClone();
      }
    })();

type Finding = {
  id: string;
  target: "blanko";
  layer: "backend" | "ui+backend";
  severity: "P0" | "P1" | "P2" | "P3";
  area: string;
  title: string;
  expected: string;
  actual: string;
  evidence: string;
};

const findings: Finding[] = [];
let authToken: string | null = null;

function add(f: Finding) {
  findings.push(f);
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function mintAuthToken(): Promise<string | null> {
  const serverEnv = parseEnvFile(path.resolve("webapp/server/.env"));
  const clientEnv = parseEnvFile(path.resolve("webapp/client/.env"));
  const SUPABASE_URL = serverEnv.SUPABASE_URL ?? clientEnv.VITE_SUPABASE_URL ?? "";
  const SERVICE_ROLE = serverEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ANON_KEY =
    clientEnv.VITE_SUPABASE_ANON_KEY ?? clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) return null;

  const email = `blanko.backend.audit+${Date.now()}@gmail.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) {
    write("backend-blanko-auth-create-fail.json", {
      status: created.status,
      body: await created.text(),
    });
    return null;
  }

  const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const tokBody = (await signed.json()) as { access_token?: string };
  return signed.ok && tokBody.access_token ? tokBody.access_token : null;
}

async function req(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 500);
  }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 2000) };
}

function write(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  authToken = await mintAuthToken();
  write("backend-blanko-auth.json", { hasToken: !!authToken });
  if (!authToken) {
    add({
      id: "BK-API-AUTH-001",
      target: "blanko",
      layer: "backend",
      severity: "P1",
      area: "API/Scan",
      title: "Could not mint Supabase token for authenticated API probes",
      expected: "access_token via service role",
      actual: "null",
      evidence: "backend-blanko-auth.json",
    });
  }

  const health = await req("GET", "/health");
  write("backend-blanko-health.json", health);
  if (!health.ok) {
    add({
      id: "BK-API-HEALTH-001",
      target: "blanko",
      layer: "backend",
      severity: "P0",
      area: "API/Scan",
      title: "Blanko /health failed during backend-blanko pass",
      expected: "200",
      actual: String(health.status),
      evidence: "backend-blanko-health.json",
    });
  }

  // Authenticated scan so workspaceId + project_root persist
  const scan = await req("POST", "/api/scan", { repoUrl: SCAN_CLONE });
  write("backend-blanko-scan.json", {
    status: scan.status,
    keys: scan.json && typeof scan.json === "object" ? Object.keys(scan.json as object) : [],
    workspaceId: (scan.json as { workspaceId?: string })?.workspaceId,
    projectRoot: (scan.json as { projectRoot?: string })?.projectRoot,
    persistError: (scan.json as { persistError?: string })?.persistError,
    nodeCount: (scan.json as { graph?: { nodes?: unknown[] } })?.graph?.nodes?.length,
    agentFiles: ((scan.json as { agents?: { agents?: { file?: string }[] } })?.agents?.agents ?? []).map(
      (a) => a.file
    ),
  });

  const workspaceId = (scan.json as { workspaceId?: string })?.workspaceId;
  const graph = (scan.json as { graph?: Record<string, unknown> })?.graph;
  const projectRoot =
    (scan.json as { projectRoot?: string })?.projectRoot ?? SCAN_CLONE;
  const scannedAt = Date.now() - 60_000;

  const scanObj = (scan.json ?? {}) as Record<string, unknown>;
  const platformKeys = ["providers", "platforms", "inventory", "detectedProviders", "bindings"].filter(
    (k) => k in scanObj
  );
  write("backend-blanko-platforms-payload.json", {
    status: scan.status,
    platformKeys,
    topKeys: Object.keys(scanObj).slice(0, 40),
    note: "Platforms dock derives bound/detected client-side; no dedicated /api/platforms",
  });
  if (scan.ok && platformKeys.length === 0) {
    add({
      id: "BK-PLAT-API-001",
      target: "blanko",
      layer: "backend",
      severity: "P2",
      area: "Providers",
      title: "Scan response has no dedicated providers/platforms inventory fields",
      expected: "Server inventory or documented client-only derivation",
      actual: "platformKeys=[] — bound vs detected must be computed client-side",
      evidence: "backend-blanko-platforms-payload.json",
    });
  }

  // scan-staleness
  const staleMissing = await req(
    "GET",
    `/api/scan-staleness?projectRoot=${encodeURIComponent(projectRoot)}`
  );
  write("backend-blanko-staleness-missing-since.json", staleMissing);
  if (staleMissing.status !== 400 && staleMissing.status !== 401) {
    add({
      id: "BK-RESCAN-API-001",
      target: "blanko",
      layer: "backend",
      severity: "P2",
      area: "API/Scan",
      title: "scan-staleness without since did not return expected 400",
      expected: "400 since required",
      actual: String(staleMissing.status),
      evidence: "backend-blanko-staleness-missing-since.json",
    });
  }

  const staleOk = await req(
    "GET",
    `/api/scan-staleness?projectRoot=${encodeURIComponent(projectRoot)}&since=${scannedAt}`
  );
  write("backend-blanko-staleness.json", staleOk);
  if (!staleOk.ok) {
    add({
      id: "BK-RESCAN-API-003",
      target: "blanko",
      layer: "backend",
      severity: "P1",
      area: "API/Scan",
      title: "scan-staleness failed with auth + projectRoot + since",
      expected: "200",
      actual: `${staleOk.status} ${JSON.stringify(staleOk.json).slice(0, 200)}`,
      evidence: "backend-blanko-staleness.json",
    });
  } else {
    add({
      id: "BK-RESCAN-API-PASS",
      target: "blanko",
      layer: "backend",
      severity: "P3",
      area: "API/Scan",
      title: "GET /api/scan-staleness OK",
      expected: "200",
      actual: JSON.stringify(staleOk.json).slice(0, 200),
      evidence: "backend-blanko-staleness.json",
    });
  }

  const refresh = await req("POST", "/api/scan/refresh", {
    workspaceId: workspaceId ?? "missing",
    repoUrl: SCAN_CLONE,
  });
  write("backend-blanko-scan-refresh.json", refresh);
  if (!refresh.ok && refresh.status !== 400) {
    add({
      id: "BK-RESCAN-API-004",
      target: "blanko",
      layer: "backend",
      severity: "P2",
      area: "API/Scan",
      title: "POST /api/scan/refresh unexpected failure",
      expected: "200 or clear 400",
      actual: `${refresh.status} ${JSON.stringify(refresh.json).slice(0, 250)}`,
      evidence: "backend-blanko-scan-refresh.json",
    });
  }

  // todos
  const todosNoWs = await req("GET", "/api/todos");
  write("backend-blanko-todos-no-ws.json", todosNoWs);
  if (todosNoWs.status !== 400) {
    add({
      id: "BK-TODO-API-000",
      target: "blanko",
      layer: "backend",
      severity: "P3",
      area: "API/Scan",
      title: "GET /api/todos without workspaceId contract",
      expected: "400 workspaceId required",
      actual: String(todosNoWs.status),
      evidence: "backend-blanko-todos-no-ws.json",
    });
  }

  if (workspaceId) {
    const todosList = await req("GET", `/api/todos?workspaceId=${encodeURIComponent(workspaceId)}`);
    write("backend-blanko-todos-list.json", todosList);

    const todoCreate = await req("POST", "/api/todos", {
      workspaceId,
      title: "dual-audit backend-blanko probe",
      description: "discovery-only todo from blanko-backend-api-audit",
    });
    write("backend-blanko-todos-create.json", todoCreate);
    const todoId =
      (todoCreate.json as { todo?: { id?: string } })?.todo?.id ??
      (todoCreate.json as { id?: string })?.id;

    if (!todoCreate.ok) {
      add({
        id: "BK-TODO-API-002",
        target: "blanko",
        layer: "backend",
        severity: "P1",
        area: "API/Scan",
        title: "POST /api/todos failed when authenticated",
        expected: "200/201 todo",
        actual: `${todoCreate.status} ${JSON.stringify(todoCreate.json).slice(0, 300)}`,
        evidence: "backend-blanko-todos-create.json",
      });
    } else {
      add({
        id: "BK-TODO-API-PASS",
        target: "blanko",
        layer: "backend",
        severity: "P3",
        area: "API/Scan",
        title: "POST /api/todos create OK",
        expected: "200/201",
        actual: String(todoCreate.status),
        evidence: "backend-blanko-todos-create.json",
      });
    }

    if (todoId) {
      const run = await req("POST", `/api/todos/${todoId}/run`, {});
      write("backend-blanko-todos-run.json", run);
      if (!run.ok && ![402, 409, 400].includes(run.status)) {
        add({
          id: "BK-TODO-API-003",
          target: "blanko",
          layer: "backend",
          severity: "P2",
          area: "API/Scan",
          title: "POST /api/todos/:id/run unexpected failure",
          expected: "200 / 402 / 409 / 400",
          actual: `${run.status} ${JSON.stringify(run.json).slice(0, 300)}`,
          evidence: "backend-blanko-todos-run.json",
        });
      }
      await req("DELETE", `/api/todos/${todoId}`);
    }
  } else {
    add({
      id: "BK-TODO-API-004",
      target: "blanko",
      layer: "backend",
      severity: "P1",
      area: "API/Scan",
      title: "Auth scan did not return workspaceId — cannot probe todos",
      expected: "workspaceId from POST /api/scan",
      actual: `${scan.status} ${JSON.stringify(scan.json).slice(0, 200)}`,
      evidence: "backend-blanko-scan.json",
    });
  }

  // workspace save / revision
  if (workspaceId && graph) {
    const save1 = await req("POST", `/api/workspaces/${workspaceId}/save`, {
      graph: { ...graph, revision: (graph as { revision?: number }).revision ?? 1 },
      repoUrl: SCAN_CLONE,
      baseRevision: typeof (graph as { revision?: number }).revision === "number"
        ? (graph as { revision: number }).revision
        : 0,
    });
    write("backend-blanko-save-1.json", { status: save1.status, body: save1.json });

    const saveConflict = await req("POST", `/api/workspaces/${workspaceId}/save`, {
      graph: { ...graph, revision: 1 },
      repoUrl: SCAN_CLONE,
      baseRevision: 0,
    });
    write("backend-blanko-save-conflict.json", {
      status: saveConflict.status,
      body: saveConflict.json,
    });

    if (!save1.ok && save1.status !== 409) {
      add({
        id: "BK-GRAPH-API-001",
        target: "blanko",
        layer: "backend",
        severity: "P1",
        area: "GraphSync",
        title: "Workspace save failed",
        expected: "200 with revision",
        actual: `${save1.status} ${JSON.stringify(save1.json).slice(0, 250)}`,
        evidence: "backend-blanko-save-1.json",
      });
    }

    if (saveConflict.status === 409) {
      add({
        id: "BK-GRAPH-REV-PASS",
        target: "blanko",
        layer: "backend",
        severity: "P3",
        area: "GraphSync",
        title: "Save revision conflict returns 409 REVISION_CONFLICT",
        expected: "409",
        actual: "409",
        evidence: "backend-blanko-save-conflict.json",
      });
    } else if (save1.ok && saveConflict.ok) {
      add({
        id: "BK-GRAPH-REV-001",
        target: "blanko",
        layer: "backend",
        severity: "P1",
        area: "GraphSync",
        title: "Stale baseRevision save did not 409",
        expected: "409 REVISION_CONFLICT",
        actual: String(saveConflict.status),
        evidence: "backend-blanko-save-conflict.json",
      });
    }
  }

  // CRDT-lite unit
  const syncUnit = spawnSync("npx", ["tsx", "scripts/test-graph-sync.ts"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    timeout: 60_000,
  });
  write("backend-blanko-graph-sync-unit.json", {
    status: syncUnit.status,
    stdout: (syncUnit.stdout || "").slice(0, 4000),
    stderr: (syncUnit.stderr || "").slice(0, 2000),
  });
  if (syncUnit.status !== 0) {
    add({
      id: "BK-GRAPH-SYNC-001",
      target: "blanko",
      layer: "backend",
      severity: "P1",
      area: "GraphSync",
      title: "test-graph-sync.ts failed",
      expected: "exit 0",
      actual: `exit ${syncUnit.status}`,
      evidence: "backend-blanko-graph-sync-unit.json",
    });
  } else {
    add({
      id: "BK-GRAPH-SYNC-PASS",
      target: "blanko",
      layer: "backend",
      severity: "P3",
      area: "GraphSync",
      title: "CRDT-lite mergeGraphs unit suite PASS",
      expected: "exit 0",
      actual: "0",
      evidence: "backend-blanko-graph-sync-unit.json",
    });
  }

  const chat = await req("POST", "/api/chat", {
    question: "backend-blanko probe one word ok",
    sessionId: "backend-blanko-probe",
    graph: graph ?? { nodes: [], edges: [] },
  });
  write("backend-blanko-chat.json", { status: chat.status, body: chat.json });

  write("findings-backend-blanko.json", findings);
  console.log(JSON.stringify({ findings: findings.length, ids: findings.map((f) => f.id) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
