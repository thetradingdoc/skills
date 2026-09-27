/** Follow-up: save/revision with top-level scan graph shape + append findings. */
import * as fs from "node:fs";
import * as path from "node:path";
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

function parseEnv(p: string) {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main() {
  const serverEnv = parseEnv("webapp/server/.env");
  const clientEnv = parseEnv("webapp/client/.env");
  const SUPABASE_URL = serverEnv.SUPABASE_URL!;
  const SERVICE_ROLE = serverEnv.SUPABASE_SERVICE_ROLE_KEY!;
  const ANON = clientEnv.VITE_SUPABASE_ANON_KEY || clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY!;
  const email = `blanko.save.audit+${Date.now()}@gmail.com`;
  const password = randomBytes(24).toString("base64url");
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const tokRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { access_token: token } = (await tokRes.json()) as { access_token?: string };
  if (!token) throw new Error("no token");

  async function req(method: string, p: string, body?: unknown) {
    const r = await fetch(API + p, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, json };
  }

  const scan = await req("POST", "/api/scan", { repoUrl: SCAN_CLONE });
  const ws = (scan.json as { workspaceId?: string }).workspaceId!;
  const sj = scan.json as Record<string, unknown>;
  const graph = {
    nodes: sj.nodes,
    edges: sj.edges,
    revision: 1,
    projectRoot: sj.projectRoot,
    projectName: sj.projectName,
  };
  fs.writeFileSync(
    path.join(OUT, "backend-blanko-save-graph-shape.json"),
    JSON.stringify(
      { ws, nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0 },
      null,
      2
    )
  );

  const save1 = await req("POST", `/api/workspaces/${ws}/save`, {
    graph,
    repoUrl: SCAN_CLONE,
    baseRevision: 1,
  });
  fs.writeFileSync(path.join(OUT, "backend-blanko-save-1.json"), JSON.stringify(save1, null, 2));

  const saveConflict = await req("POST", `/api/workspaces/${ws}/save`, {
    graph: { ...graph, revision: 1 },
    repoUrl: SCAN_CLONE,
    baseRevision: 0,
  });
  fs.writeFileSync(
    path.join(OUT, "backend-blanko-save-conflict.json"),
    JSON.stringify(saveConflict, null, 2)
  );

  const findingsPath = path.join(OUT, "findings-backend-blanko.json");
  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8")) as Array<Record<string, string>>;
  const ids = new Set(findings.map((f) => f.id));

  const push = (f: Record<string, string>) => {
    if (!ids.has(f.id)) {
      findings.push(f);
      ids.add(f.id);
    }
  };

  push({
    id: "BK-RESCAN-API-005",
    target: "blanko",
    layer: "backend",
    severity: "P1",
    area: "API/Scan",
    title: "POST /api/scan/refresh rejects local scan-clone paths",
    expected: "Rescan works for local projectRoot used by Blanko target",
    actual: "400 Workspace repo_url is not a GitHub URL.",
    evidence: "backend-blanko-scan-refresh.json",
  });

  if (save1.ok) {
    push({
      id: "BK-GRAPH-SAVE-PASS",
      target: "blanko",
      layer: "backend",
      severity: "P3",
      area: "GraphSync",
      title: "POST /workspaces/:id/save OK with top-level scan graph shape",
      expected: "200",
      actual: String(save1.status),
      evidence: "backend-blanko-save-1.json",
    });
  } else {
    push({
      id: "BK-GRAPH-API-001",
      target: "blanko",
      layer: "backend",
      severity: "P1",
      area: "GraphSync",
      title: "Workspace save failed with scan graph shape",
      expected: "200",
      actual: `${save1.status} ${JSON.stringify(save1.json).slice(0, 200)}`,
      evidence: "backend-blanko-save-1.json",
    });
  }

  if (saveConflict.status === 409) {
    push({
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
  } else if (save1.ok) {
    push({
      id: "BK-GRAPH-REV-001",
      target: "blanko",
      layer: "backend",
      severity: "P1",
      area: "GraphSync",
      title: "Stale baseRevision save did not 409",
      expected: "409",
      actual: String(saveConflict.status),
      evidence: "backend-blanko-save-conflict.json",
    });
  }

  push({
    id: "BK-CHAT-API-002",
    target: "blanko",
    layer: "backend",
    severity: "P2",
    area: "Chat/Memory",
    title: "POST /api/chat ignored trading scan graph for probe question",
    expected: "Answer grounded in provided graph / trading-agent context",
    actual: "Invented greenfield backend-blanko folder structure",
    evidence: "backend-blanko-chat.json",
  });

  fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2));
  console.log(
    JSON.stringify(
      { save1: save1.status, conflict: saveConflict.status, ids: findings.map((f) => f.id) },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
