import * as fs from "fs";

function loadEnv(p: string) {
  const o: Record<string, string> = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    o[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|['"]$/g, "");
  }
  return o;
}

async function mintToken(): Promise<string | null> {
  const serverEnv = loadEnv("webapp/server/.env");
  const clientEnv = loadEnv("webapp/client/.env");
  const rootEnv = loadEnv(".env");
  const SUPABASE_URL =
    serverEnv.SUPABASE_URL || clientEnv.VITE_SUPABASE_URL || rootEnv.SUPABASE_URL || "";
  const SERVICE_ROLE =
    serverEnv.SUPABASE_SERVICE_ROLE_KEY || rootEnv.SUPABASE_SERVICE_ROLE_KEY || "";
  const ANON =
    clientEnv.VITE_SUPABASE_ANON_KEY ||
    clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    rootEnv.VITE_SUPABASE_ANON_KEY ||
    "";
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) return null;
  const email = `blanko-g-${Date.now()}@example.com`;
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
    console.error("create user failed", created.status, await created.text());
    return null;
  }
  const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signed.ok) {
    console.error("sign-in failed", signed.status, await signed.text());
    return null;
  }
  const body = (await signed.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function main() {
  const trading = `${process.env.HOME}/Voice Agent/trading-agent`;
  const API = process.env.BLANKO_API ?? "http://127.0.0.1:4000";
  const token = await mintToken();
  if (!token) throw new Error("mint failed");

  const scan = await fetch(`${API}/api/scan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: trading }),
  });
  const scanJson = (await scan.json()) as Record<string, any>;
  const workspaceId = scanJson.workspaceId as string | undefined;

  let loadStatus: number | undefined;
  let loadJson: Record<string, any> | null = null;
  if (workspaceId) {
    const load = await fetch(`${API}/api/workspaces/${workspaceId}/load`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    loadStatus = load.status;
    loadJson = (await load.json()) as Record<string, any>;
  }

  const out = {
    scanStatus: scan.status,
    scanError: scanJson.error,
    workspaceId,
    scanProjectRoot: scanJson.projectRoot,
    loadStatus,
    loadProjectRoot: loadJson?.projectRoot,
    loadRepoUrl: loadJson?.repoUrl,
    graphProjectRoot: loadJson?.graph?.projectRoot,
  };
  fs.mkdirSync("docs/ops/blanko-dual-audit", { recursive: true });
  fs.writeFileSync("docs/ops/blanko-dual-audit/verify-g-project-root.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
