#!/usr/bin/env npx tsx
/**
 * Part 1 LIVE re-audit — trading-agent agentic architecture against SSOT.
 * SSOT: ~/Voice Agent/trading-agent (PORT 4100) — NOT Blanko scan-clone.
 * Discovery only. Writes docs/ops/blanko-dual-audit/part1-live-*
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  tradingApiUrl,
  tradingLiveRoot,
  tradingScanClone,
} from "./lib/blanko-target.ts";

const OUT = path.resolve("docs/ops/blanko-dual-audit");
const LIVE = tradingLiveRoot();
const MW = path.join(LIVE, "middleware-platform");
const API = tradingApiUrl();
const BLANKO_API = process.env.API_URL?.trim() || "http://localhost:4000";
const SCAN_CLONE = tradingScanClone();

type Finding = {
  id: string;
  target: "trading-agent" | "blanko" | "both";
  layer: "ui" | "backend" | "ui+backend";
  severity: "P0" | "P1" | "P2" | "P3";
  area: string;
  title: string;
  expected: string;
  actual: string;
  evidence: string;
  status: "open" | "resolved-on-live" | "stale-scan-clone-only";
};

const findings: Finding[] = [];
function add(f: Finding) {
  findings.push(f);
}
function write(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

function tip(dir: string) {
  const r = spawnSync("git", ["log", "-1", "--oneline"], { cwd: dir, encoding: "utf8" });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  return {
    oneline: (r.stdout || "").trim(),
    head: (head.stdout || "").trim(),
    dirtyCount: (dirty.stdout || "").split("\n").filter(Boolean).length,
  };
}

function readFile(p: string) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ── Diagnosis: Blanko target dual identity ──────────────────────────────
  const targetPath = path.resolve(".blanko-target");
  const targetText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  const liveTip = tip(LIVE);
  const scanTip = tip(SCAN_CLONE);
  const diagnosis = {
    problem:
      "Blanko .blanko-target has TWO roots: local (live SSOT) and scan-clone (Blanko sandbox under ~/.arch-viz/repos). Prior dual audit + harnesses used scan-clone. Live :4100 runs Voice Agent middleware with uncommitted fixes. Same committed tip 911fb48, divergent working trees → stale TA findings.",
    blankoTarget: targetText,
    live: { root: LIVE, port: 4100, ...liveTip, localRuntimeDoc: "docs/trading/LOCAL_RUNTIME.md says scan-clone is NOT SSOT" },
    scanClone: { root: SCAN_CLONE, ...scanTip },
    sameCommittedTip: liveTip.head === scanTip.head,
    solve: [
      "1. Treat ~/Voice Agent/trading-agent + :4100 as trading SSOT (LOCAL_RUNTIME.md).",
      "2. Blanko Import/scan for architecture truth: use local path as repoUrl OR refresh scan-clone from live after commits.",
      "3. Do not Approve Blanko rails against live without intent — Prefer scan-clone for mutate, local for read-only audit.",
      "4. Update harness defaults: BLANKO_TARGET_ROOT / TRADING_LIVE_ROOT; prefer local for Part 1 runtime checks.",
      "5. Optional: sync scan-clone to live tip+worktree once committed, or delete stale untracked agent debris in scan-clone.",
    ],
  };
  write("part1-live-diagnosis.json", diagnosis);

  // ── Live health / chat ──────────────────────────────────────────────────
  let health: { status: number; body: unknown } = { status: 0, body: null };
  let chat: { status: number; body: unknown } = { status: 0, body: null };
  try {
    const hr = await fetch(`${API}/health`);
    health = { status: hr.status, body: await hr.json().catch(() => ({})) };
  } catch (e) {
    health = { status: 0, body: String(e) };
  }
  try {
    const cr = await fetch(`${API}/api/trading/chat/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "part1 live audit ping" }),
    });
    chat = { status: cr.status, body: await cr.json().catch(() => ({})) };
  } catch (e) {
    chat = { status: 0, body: String(e) };
  }
  write("part1-live-health-chat.json", { api: API, health, chat });

  const healthOk =
    health.status === 200 &&
    typeof health.body === "object" &&
    health.body &&
    (health.body as { status?: string }).status === "ok";
  if (healthOk) {
    add({
      id: "TA-HEALTH-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P0",
      area: "Health",
      title: "GET /health on live :4100 is OK (prior 503 was scan-clone / wrong process)",
      expected: "200 ok",
      actual: JSON.stringify(health.body),
      evidence: "part1-live-health-chat.json",
      status: "resolved-on-live",
    });
  } else {
    add({
      id: "TA-HEALTH-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P0",
      area: "Health",
      title: "Live :4100 /health not OK",
      expected: "200 {status:ok}",
      actual: `${health.status} ${JSON.stringify(health.body)}`,
      evidence: "part1-live-health-chat.json",
      status: "open",
    });
  }

  const chatBody = chat.body as { success?: boolean; error?: string; reply?: string };
  if (chat.status === 200 && chatBody.success) {
    add({
      id: "TA-CHAT-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P1",
      area: "Chat/Memory",
      title: "Trading chat turn OK on live (sessionId typo fixed in dirty tree)",
      expected: "200 success",
      actual: `200 reply=${String(chatBody.reply || "").slice(0, 120)}`,
      evidence: "part1-live-health-chat.json",
      status: "resolved-on-live",
    });
  } else if (String(chatBody.error || "").includes("sessionId")) {
    add({
      id: "TA-CHAT-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P1",
      area: "Chat/Memory",
      title: "sessionId typo still on live",
      expected: "200",
      actual: JSON.stringify(chatBody),
      evidence: "part1-live-health-chat.json",
      status: "open",
    });
  } else {
    add({
      id: "TA-CHAT-001b",
      target: "trading-agent",
      layer: "backend",
      severity: "P1",
      area: "Chat/Memory",
      title: "Trading chat turn unexpected on live",
      expected: "200 success",
      actual: `${chat.status} ${JSON.stringify(chatBody).slice(0, 300)}`,
      evidence: "part1-live-health-chat.json",
      status: "open",
    });
  }

  // ── Source checks live vs scan-clone ────────────────────────────────────
  const liveChatSrc = readFile(path.join(MW, "services/trading-chat-service.js"));
  const scanChatSrc = readFile(
    path.join(SCAN_CLONE, "middleware-platform/services/trading-chat-service.js")
  );
  const liveHasTypo = /const sessiId\b/.test(liveChatSrc);
  const scanHasTypo = /const sessiId\b/.test(scanChatSrc);
  write("part1-live-source-diff.json", {
    liveHasSessiIdTypo: liveHasTypo,
    scanHasSessiIdTypo: scanHasTypo,
    liveAlpacaHasHttpFetch: /async _fetch|this\._fetch/.test(
      readFile(path.join(MW, "services/broker/alpaca-broker.js"))
    ),
    scanAlpacaAlwaysNotWired: /HTTP order path is not implemented \(NOT_WIRED\)/.test(
      readFile(path.join(SCAN_CLONE, "middleware-platform/services/broker/alpaca-broker.js"))
    ),
    expectedSpineLive: fs.existsSync(path.join(MW, "services/trading-rails/expected-spine.js")),
    expectedSpineScan: fs.existsSync(
      path.join(SCAN_CLONE, "middleware-platform/services/trading-rails/expected-spine.js")
    ),
  });

  if (scanHasTypo && !liveHasTypo) {
    add({
      id: "BOTH-CLONE-001",
      target: "both",
      layer: "backend",
      severity: "P1",
      area: "Scan",
      title: "Blanko scan-clone still has sessiId typo; live Voice Agent fixed — dual-root drift",
      expected: "scan-clone matches live SSOT or audits use local path",
      actual: "scan HasTypo=true live HasTypo=false same committed tip",
      evidence: "part1-live-source-diff.json, part1-live-diagnosis.json, .blanko-target",
      status: "open",
    });
  }

  // Broker
  const alpaca = readFile(path.join(MW, "services/broker/alpaca-broker.js"));
  const hasHttp = /submitOrder[\s\S]{0,400}_fetch|async _fetch/.test(alpaca);
  const stillNotWiredMissingCreds = /NOT_WIRED/.test(alpaca);
  if (hasHttp) {
    add({
      id: "TA-BROKER-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P1",
      area: "Policy/Risk/Execution",
      title: "Live AlpacaBroker has HTTP path (prior always-NOT_WIRED was scan-clone stub)",
      expected: "Wired paper HTTP or explicit stub",
      actual: `hasHttp=${hasHttp}; stillThrowsNotWiredIfNoCreds=${stillNotWiredMissingCreds}`,
      evidence: "part1-live-source-diff.json + live alpaca-broker.js",
      status: "resolved-on-live",
    });
  } else {
    add({
      id: "TA-BROKER-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P1",
      area: "Policy/Risk/Execution",
      title: "Live Alpaca still stub-only",
      expected: "HTTP submit path",
      actual: "no _fetch/submit wiring found",
      evidence: "part1-live-source-diff.json",
      status: "open",
    });
  }

  // Propose-only / allowlists
  const propose = readFile(path.join(MW, "services/trading-rails/propose-only-guard.js"));
  const allow = readFile(path.join(MW, "services/trading-rails/tool-allowlists.js"));
  const proposeOk = /submit|broker|alpaca/i.test(propose) && /forbid|reject|FORBIDDEN/i.test(propose);
  write("part1-live-guards.json", {
    proposeLen: propose.length,
    allowLen: allow.length,
    proposeSnippet: propose.slice(0, 800),
    allowSnippet: allow.slice(0, 1200),
  });
  add({
    id: proposeOk ? "TA-GUARD-PASS" : "TA-GUARD-001",
    target: "trading-agent",
    layer: "backend",
    severity: proposeOk ? "P3" : "P1",
    area: "Policy/Risk/Execution",
    title: proposeOk
      ? "Propose-only guard present on live"
      : "Propose-only guard weak/missing on live",
    expected: "Forbidden broker/submit tool names",
    actual: `proposeOk=${proposeOk}`,
    evidence: "part1-live-guards.json",
    status: proposeOk ? "resolved-on-live" : "open",
  });

  if (!fs.existsSync(path.join(MW, "services/trading-rails/expected-spine.js"))) {
    add({
      id: "TA-SPINE-001",
      target: "trading-agent",
      layer: "backend",
      severity: "P2",
      area: "Spine",
      title: "expected-spine.js still missing on live HEAD tree",
      expected: "Runtime SSOT file for Blanko binding",
      actual: "absent under trading-rails/",
      evidence: "part1-live-source-diff.json",
      status: "open",
    });
  }

  // npm test (live middleware) — may be long
  const test = spawnSync("npm", ["test", "--", "--testPathPattern=propose-only|paper-wallet|trading-chat|paper-broker|server-health", "--forceExit"], {
    cwd: MW,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, CI: "1" },
  });
  write("part1-live-npm-subset.json", {
    status: test.status,
    stdout: (test.stdout || "").slice(-4000),
    stderr: (test.stderr || "").slice(-2000),
  });

  // Blanko scan of LIVE path (architecture UI evidence) — optional if Blanko up
  let blankoScan: { status: number; body: unknown } = { status: 0, body: null };
  try {
    const sr = await fetch(`${BLANKO_API}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: LIVE }),
    });
    const sj = (await sr.json().catch(() => ({}))) as Record<string, unknown>;
    blankoScan = {
      status: sr.status,
      body: {
        keys: Object.keys(sj),
        nodeCount: Array.isArray(sj.nodes) ? sj.nodes.length : null,
        projectRoot: sj.projectRoot,
        agentFiles: ((sj.agents as { agents?: { file?: string }[] })?.agents ?? []).map((a) => a.file),
        persistError: sj.persistError,
      },
    };
  } catch (e) {
    blankoScan = { status: 0, body: String(e) };
  }
  write("part1-live-blanko-scan.json", blankoScan);
  if (blankoScan.status === 200) {
    const root = (blankoScan.body as { projectRoot?: string })?.projectRoot || "";
    if (root.includes(".arch-viz/repos")) {
      add({
        id: "BK-SCAN-ROOT-001",
        target: "blanko",
        layer: "backend",
        severity: "P1",
        area: "Scan",
        title: "Blanko scan of live local path still landed projectRoot under ~/.arch-viz/repos",
        expected: "projectRoot = live path OR explicit copy note",
        actual: root,
        evidence: "part1-live-blanko-scan.json",
        status: "open",
      });
    } else if (root.includes("Voice Agent") || root === LIVE) {
      add({
        id: "BK-SCAN-ROOT-PASS",
        target: "blanko",
        layer: "backend",
        severity: "P3",
        area: "Scan",
        title: "Blanko scan used live Voice Agent path as projectRoot",
        expected: LIVE,
        actual: root,
        evidence: "part1-live-blanko-scan.json",
        status: "resolved-on-live",
      });
    }
  }

  write("findings-part1-live.json", findings);
  console.log(
    JSON.stringify(
      {
        diagnosis: "see part1-live-diagnosis.json",
        api: API,
        healthOk,
        chatStatus: chat.status,
        findings: findings.map((f) => ({ id: f.id, status: f.status, severity: f.severity })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
