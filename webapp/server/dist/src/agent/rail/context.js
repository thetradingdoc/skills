"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRailContext = buildRailContext;
const tokenBudget_1 = require("../tokenBudget");
function asTokenEstimate(text) {
    // Very rough heuristic: 1 token ≈ 4 characters.
    return Math.ceil(text.length / 4);
}
function summarizeMessages(messages) {
    if (messages.length === 0)
        return "";
    const last = messages[messages.length - 1];
    const prefix = messages.length > 1 ? `(${messages.length} turns) Latest:\n` : "";
    return `${prefix}${last.role}: ${last.content.slice(0, 800)}`;
}
function buildRailContext(rail, fullHistory, tokenBudget) {
    const result = [];
    // Tier 1: Rail summary (prefer frozen scope if available)
    const effectiveOutcome = rail.frozenOutcome ?? rail.outcome;
    const effectiveLogicPath = rail.frozenLogicPath ?? rail.logicPath;
    const logicPathSummary = effectiveLogicPath.length > 0
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
        const any = m;
        const msgRailId = any.railId;
        const msgSessionId = any.sessionId;
        if (msgRailId && msgRailId === rail.id)
            return true;
        if (!msgRailId && (msgSessionId === rail.sessionId || !msgSessionId))
            return true;
        return false;
    });
    const MAX_RECENT = 12;
    const recent = sessionHistory.slice(-MAX_RECENT);
    const recentMessages = [];
    for (const msg of recent) {
        const t = asTokenEstimate(msg.content);
        if (tokensUsed + t > tokenBudget * tokenBudget_1.TIER2_FRACTION) {
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
    }
    else {
        result.push(...recentMessages);
    }
    // Tier 3: skills are injected elsewhere on demand; no-op here.
    return result;
}
