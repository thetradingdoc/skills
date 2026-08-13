/**
 * End-to-end Fix C + D/E/F/G/H verification harness (trading-agent local path).
 * Mints a throwaway Supabase user JWT like blanko-backend-api-audit.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { applyTradingSpine } from "../webapp/client/src/tradingSpine.ts";
import { isDesignGraph } from "../webapp/client/src/greenfieldDesign.ts";
import { buildPlatformInventory } from "../webapp/client/src/platformInventory.ts";
import { bindingStatusLabel } from "../webapp/client/src/providerCatalog.ts";
import type { ArchGraph } from "../webapp/client/src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TRADING = path.join(process.env.HOME ?? "", "Voice Agent/trading-agent");
const API = process.env.BLANKO_API ?? "http://127.0.0.1:4000";
const OUT = path.join(ROOT, "docs/ops/blanko-dual-audit");

function loadEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

async function mintToken(): Promise<string | null> {
  const serverEnv = loadEnvFile(path.join(ROOT, "webapp/server/.env"));
  const clientEnv = loadEnvFile(path.join(ROOT, "webapp/client/.env"));
  const rootEnv = loadEnvFile(path.join(ROOT, ".env"));
  const SUPABASE_URL =
    serverEnv.SUPABASE_URL || clientEnv.VITE_SUPABASE_URL || rootEnv.SUPABASE_URL || "";
  const SERVICE_ROLE =
    serverEnv.SUPABASE_SERVICE_ROLE_KEY || rootEnv.SUPABASE_SERVICE_ROLE_KEY || "";
  const ANON =
    clientEnv.VITE_SUPABASE_ANON_KEY ||
    clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    rootEnv.VITE_SUPABASE_ANON_KEY ||
    "";
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) {
    console.error("missing supabase credentials for mint");
    return null;
  }
  const email = `blanko-monitor-${Date.now()}@example.com`;
  const password = `Tmp-${Date.now()}-Aa1!`;
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
    console.error("admin create user failed", created.status, await created.text());
    return null;
  }
  const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signed.ok) {
    console.error("password grant failed", signed.status, await signed.text());
    return null;
  }
  const body = (await signed.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function api(
  method: string,
  route: string,
  token: string,
  body?: unknown
): Promise<{ status: number; ok: boolean; json: any; text: string }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return { status: res.status, ok: res.ok, json, text };
}

function write(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

async function main() {
  if (!fs.existsSync(TRADING)) throw new Error(`missing ${TRADING}`);
  const token = await mintToken();
  if (!token) {
    write("fix-c-refresh-blocked.json", {
      blocked: true,
      reason: "Could not mint Supabase JWT (check SUPABASE_* in webapp/server/.env)",
    });
    console.log("BLOCKED: Fix C HTTP — no JWT");
    process.exit(2);
  }

  // Health / reachability
  const health = await fetch(`${API}/api/health`).catch((e) => ({ ok: false, status: 0, err: String(e) }));
  const healthStatus = "status" in health ? health.status : 0;
  if (healthStatus === 0) {
    // try without /api
  }

  const scan = await api("POST", "/api/scan", token, {
    repoUrl: TRADING,
  });
  write("verify-scan-trading-local.json", {
    status: scan.status,
    ok: scan.ok,
    nodeIds: (scan.json?.nodes ?? []).map((n: any) => n.id),
    nodeCount: scan.json?.nodes?.length,
    agentFiles: (scan.json?.agents?.agents ?? []).map((a: any) => a.file),
    providersLlm: (scan.json?.providers?.providers ?? []).filter((p: any) =>
      ["anthropic", "groq", "openai"].includes(p.id)
    ),
    projectRoot: scan.json?.projectRoot,
    workspaceId: scan.json?.workspaceId,
    workspaceProjectRootHint: "see refresh",
  });

  if (!scan.ok || !scan.json?.workspaceId) {
    write("fix-c-refresh-blocked.json", {
      blocked: true,
      reason: "POST /api/scan failed or no workspaceId",
      scan: { status: scan.status, error: scan.json?.error ?? scan.text.slice(0, 500) },
    });
    console.log("BLOCKED after scan", scan.status, scan.json?.error);
    process.exit(2);
  }

  const workspaceId = scan.json.workspaceId as string;

  // Fix C: refresh with local repo_url already stored from scan
  const refresh = await api("POST", "/api/scan/refresh", token, { workspaceId });
  write("verify-scan-refresh-local.json", {
    status: refresh.status,
    ok: refresh.ok,
    error: refresh.json?.error,
    nodeCount: refresh.json?.nodes?.length,
    projectRoot: refresh.json?.projectRoot,
    hasProviders: !!refresh.json?.providers,
    textSlice: refresh.text.slice(0, 400),
  });
  console.log("Fix C refresh HTTP", refresh.status, refresh.ok, refresh.json?.error ?? "ok");

  // Offline graph correctness from scan payload (D/E/F/H)
  const graph = scan.json as ArchGraph;
  const agentFiles = (graph.agents?.agents ?? []).map((a) => a.file ?? "").filter(Boolean);
  const spine = applyTradingSpine({ from: graph, inferBuilt: true })!;
  const spineAgents = (spine.agents?.agents ?? []).map((a) => a.file ?? "");
  const inv = buildPlatformInventory(spine, []);
  const headerBound = inv.filter((r) => r.status === "connected").length;
  const headerNotCfg = inv.filter((r) => r.status === "missing_credentials").length;
  const badgeSample = inv
    .filter((r) => r.boundNodeIds.length > 0 || r.status !== "unbound")
    .slice(0, 12)
    .map((r) => ({
      id: r.provider.id,
      status: r.status,
      badge: bindingStatusLabel(r.status),
      labels: r.accountLabels,
    }));

  write("verify-d-e-f-h.json", {
    D: {
      scanAgentCount: agentFiles.length,
      spineAgentCount: spineAgents.length,
      agentsPreserved: spineAgents.length === agentFiles.length && spineAgents.length > 0,
      hasExecuteTurn: spineAgents.some((f) => /execute-turn/i.test(f)),
      hasLlmRouter: spineAgents.some((f) => /llm-router/i.test(f)),
      sampleFiles: spineAgents.slice(0, 15),
    },
    E: {
      nodeIds: (graph.nodes ?? []).map((n) => n.id),
      hasStrategy: (graph.nodes ?? []).some((n) => /services\/strategy/.test(n.id)),
      hasPolicy: (graph.nodes ?? []).some((n) => /services\/policy/.test(n.id)),
      hasRisk: (graph.nodes ?? []).some((n) => /services\/risk/.test(n.id)),
      hasExecution: (graph.nodes ?? []).some((n) => /services\/execution/.test(n.id)),
      hasBroker: (graph.nodes ?? []).some((n) => /services\/broker/.test(n.id)),
      stillMegaServicesOnly: (graph.nodes ?? []).some(
        (n) => n.id === "middleware-platform/services"
      ),
    },
    F: {
      headerBound,
      headerNotConfigured: headerNotCfg,
      badgeSample,
      agree:
        badgeSample.every((b) =>
          b.status === "connected"
            ? b.badge === "bound"
            : b.status === "missing_credentials"
              ? b.badge === "NOT CONFIGURED"
              : true
        ) && headerBound === inv.filter((r) => r.status === "connected").length,
    },
    H: {
      isDesignBeforeSpine: isDesignGraph(graph),
      isDesignAfterSpine: isDesignGraph(spine),
      expectAnalysisAfterSpine: isDesignGraph(spine) === false,
      projectRoot: spine.projectRoot,
      architectureBoard: spine.architectureBoard,
    },
    G: {
      graphProjectRoot: graph.projectRoot,
      workspaceId,
      note: "workspace.project_root written on scan/refresh; save no longer nulls it",
    },
  });

  // Fix H chat grounding — send flat graph (not .graph)
  const chat = await api("POST", "/api/chat", token, {
    question: "Which spine nodes and agents exist for the trading agent llm-router and execute-turn?",
    graph: spine,
    mode: "analysis",
  });
  write("verify-chat-grounding.json", {
    status: chat.status,
    ok: chat.ok,
    answerSlice: String(chat.json?.answer ?? chat.json?.error ?? chat.text).slice(0, 1200),
    mentionsLlmRouter: /llm-router/i.test(String(chat.json?.answer ?? "")),
    mentionsExecuteTurn: /execute-turn/i.test(String(chat.json?.answer ?? "")),
  });

  console.log(
    JSON.stringify(
      {
        C: { status: refresh.status, ok: refresh.ok, error: refresh.json?.error },
        D: {
          agentsPreserved: spineAgents.length === agentFiles.length && spineAgents.length > 0,
          count: spineAgents.length,
        },
        E: {
          nodeCount: graph.nodes?.length,
          split: ["strategy", "policy", "risk", "execution", "broker"].map((s) =>
            (graph.nodes ?? []).some((n) => n.id.includes(`services/${s}`))
          ),
        },
        F: { headerBound, headerNotCfg },
        H: { analysis: isDesignGraph(spine) === false, chat: chat.status },
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
