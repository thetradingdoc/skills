/**
 * Unit checks for Fix A providers payload + Fix C local-path gate predicate.
 */
import assert from "node:assert/strict";
import * as fs from "fs";
import { buildScanProvidersPayload } from "./lib/scanProviders.ts";

const tradingRoot = `${process.env.HOME}/Voice Agent/trading-agent`;
assert.ok(fs.existsSync(tradingRoot), `missing trading root ${tradingRoot}`);

const payload = buildScanProvidersPayload(tradingRoot);
assert.equal(payload.static, true);
assert.ok(payload.providers.some((p) => p.id === "anthropic"));
assert.ok(payload.providers.some((p) => p.id === "groq"));
assert.ok(payload.providers.some((p) => p.id === "openai"));
assert.equal(payload.llmRouting.primary, "anthropic");
assert.equal(payload.llmRouting.fallback, "groq");
assert.equal(payload.llmRouting.source, "detected");

const anthropic = payload.providers.find((p) => p.id === "anthropic")!;
const groq = payload.providers.find((p) => p.id === "groq")!;
// Live trading .env currently has empty LLM placeholders — report honestly.
assert.equal(anthropic.hasCredential, false);
assert.equal(groq.hasCredential, false);

const alpaca = payload.providers.find((p) => p.id === "alpaca");
assert.ok(alpaca?.detected);

// Fix C gate predicate (mirrors scan.ts /scan + /scan/refresh)
function acceptsRepoUrl(trimmed: string): boolean {
  const isLocalDir =
    !trimmed.match(/^https?:/i) &&
    fs.existsSync(trimmed) &&
    fs.statSync(trimmed).isDirectory();
  return isLocalDir || !!trimmed.match(/github\.com[/:]/i);
}
assert.equal(acceptsRepoUrl(tradingRoot), true);
assert.equal(acceptsRepoUrl("https://github.com/owner/repo"), true);
assert.equal(acceptsRepoUrl("/tmp/does-not-exist-blanko-xyz"), false);
assert.equal(acceptsRepoUrl("https://gitlab.com/owner/repo"), false);

console.log("ok: scan providers + refresh local gate");
console.log(
  JSON.stringify(
    {
      llmRouting: payload.llmRouting,
      llm: payload.providers
        .filter((p) => ["anthropic", "groq", "openai"].includes(p.id))
        .map((p) => ({
          id: p.id,
          detected: p.detected,
          hasCredential: p.hasCredential,
          configuredEnvKeys: p.configuredEnvKeys,
        })),
      alpaca: alpaca
        ? { detected: alpaca.detected, hasCredential: alpaca.hasCredential }
        : null,
    },
    null,
    2
  )
);
