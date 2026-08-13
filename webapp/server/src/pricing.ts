/**
 * Model → cost pricing (cents per 1k tokens). Used at ingest so rollups
 * don't recompute prices later. Numbers are approximate list rates for V1.
 */
export type TokenPricing = {
  promptPer1kCents: number;
  completionPer1kCents: number;
};

const DEFAULT: TokenPricing = { promptPer1kCents: 0.3, completionPer1kCents: 1.5 };

/** Keys are lowercase model id prefixes or exact ids. */
const PRICING: Record<string, TokenPricing> = {
  "gpt-4o": { promptPer1kCents: 0.25, completionPer1kCents: 1.0 },
  "gpt-4o-mini": { promptPer1kCents: 0.015, completionPer1kCents: 0.06 },
  "gpt-4.1": { promptPer1kCents: 0.2, completionPer1kCents: 0.8 },
  "o3": { promptPer1kCents: 1.0, completionPer1kCents: 4.0 },
  "claude-opus": { promptPer1kCents: 1.5, completionPer1kCents: 7.5 },
  "claude-sonnet": { promptPer1kCents: 0.3, completionPer1kCents: 1.5 },
  "claude-haiku": { promptPer1kCents: 0.08, completionPer1kCents: 0.4 },
  "claude-3-5-sonnet": { promptPer1kCents: 0.3, completionPer1kCents: 1.5 },
  "claude-3-7-sonnet": { promptPer1kCents: 0.3, completionPer1kCents: 1.5 },
  "gemini": { promptPer1kCents: 0.1, completionPer1kCents: 0.4 },
  "mistral": { promptPer1kCents: 0.2, completionPer1kCents: 0.6 },
  "groq": { promptPer1kCents: 0.05, completionPer1kCents: 0.08 },
};

export function pricingForModel(model: string | null | undefined): TokenPricing {
  if (!model) return DEFAULT;
  const m = model.toLowerCase();
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (m.includes(key)) return pricing;
  }
  return DEFAULT;
}

/** Cost in integer cents (rounded up so tiny burns still show). */
export function estimateCostCents(
  promptTokens: number,
  completionTokens: number,
  model?: string | null
): number {
  const p = pricingForModel(model);
  const raw =
    (Math.max(0, promptTokens) / 1000) * p.promptPer1kCents +
    (Math.max(0, completionTokens) / 1000) * p.completionPer1kCents;
  if (raw <= 0) return 0;
  return Math.max(1, Math.round(raw));
}

export function providerFromModel(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("openai")) return "openai";
  if (m.includes("gemini") || m.includes("google")) return "google";
  if (m.includes("mistral")) return "mistral";
  if (m.includes("groq")) return "groq";
  if (m.includes("bedrock")) return "bedrock";
  return null;
}
