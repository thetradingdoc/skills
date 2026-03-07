/**
 * Context trimming — shared token estimation and trim logic for main chat and rail.
 * Uses ~4 chars/token heuristic; trim oldest/lowest-value first.
 */

/** Rough heuristic: 1 token ≈ 4 characters for typical English/code. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/** History message with role + content. */
export type TrimMessage = { role: string; content: string };

/**
 * Trim history to fit within token budget.
 * Keeps most recent messages; replaces older dropped ones with a digest.
 */
export function trimHistoryToBudget(
  messages: TrimMessage[],
  budget: number,
  fractionForRecent = 0.8
): TrimMessage[] {
  const targetBudget = Math.floor(budget * fractionForRecent);
  let tokensUsed = 0;
  const recent: TrimMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && tokensUsed < targetBudget; i--) {
    const m = messages[i];
    const t = estimateTokens(m.content);
    if (tokensUsed + t <= targetBudget) {
      recent.unshift(m);
      tokensUsed += t;
    } else break;
  }
  const droppedCount = messages.length - recent.length;
  if (droppedCount <= 0) return recent;
  const last = messages[messages.length - 1];
  const digest = `(Prior ${messages.length} turns, latest): ${last.role}: ${last.content.slice(0, 600)}`;
  const digestTokens = estimateTokens(digest);
  if (digestTokens + tokensUsed <= budget) {
    return [{ role: "system", content: `HISTORY DIGEST: ${digest}` }, ...recent];
  }
  return recent;
}

/**
 * Trim a single text block to fit within remaining budget.
 */
export function trimTextToBudget(text: string, budget: number): string {
  const est = estimateTokens(text);
  if (est <= budget) return text;
  const maxChars = Math.max(0, budget * 4);
  return text.slice(0, maxChars) + "\n[Truncated for context limit.]";
}
