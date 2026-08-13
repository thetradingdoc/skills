/**
 * Static provider probe for scan payloads (Fix A / BK-PLAT-API-001).
 *
 * Reads the *scanned repo's* .env files + package.json — NOT Blanko's own env,
 * and NOT a live :4100 health check. Callers must keep that distinction in UI copy.
 */
import * as fs from "fs";
import * as path from "path";
import { PROVIDER_CATALOG } from "../../webapp/client/src/providerCatalog.ts";

export type ScanProviderEntry = {
  id: string;
  detected: boolean;
  hasCredential: boolean;
  /** Always false at scan time; spine / canvas bindings fill this in. */
  boundToNode: boolean;
  credentialEnv: string[];
  /** Which credential env keys were non-empty in the scanned tree (names only). */
  configuredEnvKeys: string[];
  evidence: string[];
};

export type LlmRoutingReport = {
  primary: string;
  fallback: string;
  /** `detected` = read from llm-router / env in scanned repo; `default` = Anthropic→Groq assumption. */
  source: "detected" | "default";
  kellyPrimaryProvider: string | null;
  note: string;
};

export type ScanProvidersPayload = {
  /** Static snapshot — not live API health. */
  static: true;
  note: string;
  providers: ScanProviderEntry[];
  llmRouting: LlmRoutingReport;
};

/** Trading-agent (and similar) often use alternate env names vs the catalog. */
const ENV_ALIASES: Record<string, string[]> = {
  alpaca: ["ALPACA_KEY", "ALPACA_SECRET", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY"],
  kraken: ["KRAKEN_PRIVATE_KEY"],
};

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return out;
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function collectEnvMaps(projectRoot: string): Record<string, string> {
  const merged: Record<string, string> = {};
  const candidates = [
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "middleware-platform", ".env"),
    path.join(projectRoot, "webapp", "server", ".env"),
  ];
  for (const p of candidates) {
    const parsed = parseEnvFile(p);
    for (const [k, v] of Object.entries(parsed)) {
      // First non-empty wins; empty placeholders don't overwrite a real value.
      if (!(k in merged) || (!merged[k] && v)) merged[k] = v;
    }
  }
  return merged;
}

function readPackageBlob(projectRoot: string): string {
  const parts: string[] = [];
  for (const rel of ["package.json", "middleware-platform/package.json"]) {
    const p = path.join(projectRoot, rel);
    if (!fs.existsSync(p)) continue;
    try {
      parts.push(fs.readFileSync(p, "utf8").toLowerCase());
    } catch {
      /* skip */
    }
  }
  return parts.join("\n");
}

function fileExistsUnder(projectRoot: string, relParts: string[]): boolean {
  return fs.existsSync(path.join(projectRoot, ...relParts));
}

/**
 * Infer Kelly/llm-router primary from scanned tree.
 * Static only — does not call the running middleware.
 */
export function detectLlmRouting(
  projectRoot: string,
  env: Record<string, string>
): LlmRoutingReport {
  const kellyRaw = (env.KELLY_PRIMARY_PROVIDER || "").trim().toLowerCase();
  const routerCandidates = [
    path.join(projectRoot, "middleware-platform", "services", "llm-router.js"),
    path.join(projectRoot, "services", "llm-router.js"),
  ];
  let routerText = "";
  for (const p of routerCandidates) {
    if (fs.existsSync(p)) {
      try {
        routerText = fs.readFileSync(p, "utf8");
        break;
      } catch {
        /* skip */
      }
    }
  }

  const hasRouter = routerText.length > 0;
  if (kellyRaw === "groq" || kellyRaw === "anthropic") {
    const primary = kellyRaw;
    const fallback = primary === "groq" ? "anthropic" : "groq";
    return {
      primary,
      fallback,
      source: "detected",
      kellyPrimaryProvider: kellyRaw,
      note:
        "Read KELLY_PRIMARY_PROVIDER from scanned repo .env (static; not live process env).",
    };
  }

  // Match llm-router default: anthropic unless forced to groq in source comments/code default.
  if (hasRouter) {
    const defaultAnthropic =
      /KELLY_PRIMARY_PROVIDER\s*\|\|\s*['"]anthropic['"]/.test(routerText) ||
      /default primary.*anthropic/i.test(routerText);
    return {
      primary: "anthropic",
      fallback: "groq",
      source: "detected",
      kellyPrimaryProvider: null,
      note: defaultAnthropic
        ? "Inferred from llm-router.js default (Anthropic primary, Groq fallback). Static scan — not live."
        : "llm-router.js present; using Anthropic primary / Groq fallback (router convention).",
    };
  }

  return {
    primary: "anthropic",
    fallback: "groq",
    source: "default",
    kellyPrimaryProvider: null,
    note: "Default Anthropic primary / Groq fallback — llm-router.js not found in scanned tree.",
  };
}

export function buildScanProvidersPayload(projectRoot: string): ScanProvidersPayload {
  const root = path.resolve(projectRoot);
  const env = collectEnvMaps(root);
  const pkgBlob = readPackageBlob(root);
  const llmRouting = detectLlmRouting(root, env);

  const providers: ScanProviderEntry[] = [];

  for (const def of PROVIDER_CATALOG) {
    const credKeys = [...(def.credentialEnv ?? [])];
    const aliases = ENV_ALIASES[def.id] ?? [];
    const allKeys = [...credKeys, ...aliases];
    const evidence: string[] = [];
    let detected = false;

    const configuredEnvKeys: string[] = [];
    for (const k of allKeys) {
      if (k in env) {
        detected = true;
        evidence.push(`env-key:${k}`);
        if (String(env[k] || "").trim()) configuredEnvKeys.push(k);
      }
    }

    for (const pkg of def.packages ?? []) {
      if (pkgBlob.includes(pkg.toLowerCase())) {
        detected = true;
        evidence.push(`package:${pkg}`);
      }
    }

    // Light file cues for trading / common LLMs
    if (def.id === "anthropic" || def.id === "groq" || def.id === "openai") {
      if (
        fileExistsUnder(root, ["middleware-platform", "services", "llm-router.js"]) ||
        fileExistsUnder(root, ["services", "llm-router.js"])
      ) {
        detected = true;
        evidence.push("file:llm-router.js");
      }
    }
    if (def.id === "alpaca") {
      if (
        fileExistsUnder(root, ["middleware-platform", "services", "broker", "alpaca-broker.js"]) ||
        pkgBlob.includes("alpaca")
      ) {
        detected = true;
        evidence.push("file:alpaca-broker");
      }
    }
    if (def.id === "telegram") {
      if (
        fileExistsUnder(root, ["middleware-platform", "services", "telegram-bot.js"]) ||
        pkgBlob.includes("telegraf")
      ) {
        detected = true;
        evidence.push("file:telegram-bot");
      }
    }

    const hasCredential = configuredEnvKeys.length > 0;
    // Only emit rows that are detected or have credential keys present (even empty),
    // plus always emit LLM trio + alpaca/telegram when this looks like trading.
    const looksTrading =
      fs.existsSync(path.join(root, "middleware-platform")) ||
      /trading-agent/i.test(path.basename(root));
    const always =
      def.id === "anthropic" ||
      def.id === "groq" ||
      def.id === "openai" ||
      (looksTrading && (def.id === "alpaca" || def.id === "telegram" || def.id === "kraken"));

    if (!detected && !always) continue;

    providers.push({
      id: def.id,
      detected: detected || always,
      hasCredential,
      boundToNode: false,
      credentialEnv: credKeys,
      configuredEnvKeys,
      evidence: evidence.length ? evidence : always ? ["catalog:always-for-board"] : [],
    });
  }

  return {
    static: true,
    note: "Static scan of repo .env + package.json — not live runtime or vendor credit balances.",
    providers,
    llmRouting,
  };
}
