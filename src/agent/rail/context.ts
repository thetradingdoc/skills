import type { Rail } from "../types";
import type { ArchitectureChatHistory } from "../types";
import { TIER2_FRACTION } from "../tokenBudget";

type ChatMessage = ArchitectureChatHistory[number];

function asTokenEstimate(text: string): number {
  // Very rough heuristic: 1 token ≈ 4 characters.
  return Math.ceil(text.length / 4);
}

function summarizeMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) return "";
  const last = messages[messages.length - 1];
  const prefix = messages.length > 1 ? `(${messages.length} turns) Latest:\n` : "";
  return `${prefix}${last.role}: ${last.content.slice(0, 800)}`;
}

export function buildRailContext(
  rail: Rail,
  fullHistory: ArchitectureChatHistory,
  tokenBudget: number
): ArchitectureChatHistory {
  const result: ArchitectureChatHistory = [];

  // Tier 1: Rail summary (prefer frozen scope if available)
  const effectiveOutcome = rail.frozenOutcome ?? rail.outcome;
  const effectiveLogicPath = rail.frozenLogicPath ?? rail.logicPath;
  const logicPathSummary =
    effectiveLogicPath.length > 0
      ? effectiveLogicPath
          .map((s) => `${s.layer}:${s.nodeId}`)
          .slice(0, 8)
          .join(" → ")
      : "unknown";
  const railSummary = [
    `RAIL OUTCOME: ${effectiveOutcome}`,
    `RAIL STATE: ${rail.state}`,
    `LOGIC PATH: ${logicPathSummary}`,
  ].join("\n");
  result.push({
    role: "system",
    content: railSummary,
  });
  let tokensUsed = asTokenEstimate(railSummary);

  // Tier 2: recent messages scoped to this rail when possible, falling back to session.
  const sessionHistory = fullHistory.filter((m) => {
    const any = m as any;
    const msgRailId = any.railId as string | undefined;
    const msgSessionId = any.sessionId as string | undefined;

    if (msgRailId && msgRailId === rail.id) return true;
    if (!msgRailId && (msgSessionId === rail.sessionId || !msgSessionId)) return true;
    return false;
  });
  const MAX_RECENT = 12;
  const recent = sessionHistory.slice(-MAX_RECENT);

  const recentMessages: ArchitectureChatHistory = [];
  for (const msg of recent) {
    const t = asTokenEstimate(msg.content);
    if (tokensUsed + t > tokenBudget * TIER2_FRACTION) {
      break;
    }
    recentMessages.push(msg);
    tokensUsed += t;
  }

  // If we had to cut a lot, replace with a digest.
  const droppedCount = recent.length - recentMessages.length;
  if (droppedCount > 0) {
    const digest = summarizeMessages(recent);
    let digestText = `RAIL HISTORY DIGEST:\n${digest}`;
    let digestTokens = asTokenEstimate(digestText);
    if (tokensUsed + digestTokens > tokenBudget) {
      const available = Math.max(tokenBudget - tokensUsed, 0);
      const maxChars = available * 4;
      digestText = digestText.slice(0, Math.max(maxChars, 0));
      digestTokens = asTokenEstimate(digestText);
    }
    if (digestTokens > 0 && tokensUsed + digestTokens <= tokenBudget) {
      result.push({
        role: "system",
        content: digestText,
      });
      tokensUsed += digestTokens;
    }
  } else {
    result.push(...recentMessages);
  }

  // Tier 3: skills are injected elsewhere on demand; no-op here.
  return result;
}

