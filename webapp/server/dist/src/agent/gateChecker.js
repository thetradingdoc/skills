"use strict";
/**
 * Gate checker — AGENT_ROADMAP v4 §3
 * Central module that evaluates HITL gate conditions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkGates = checkGates;
exports.isUserActionToken = isUserActionToken;
const RETRY_LIMIT_CODE_DEFAULT = 3;
const RETRY_LIMIT_ARCH_DEFAULT = 2;
const RETRY_LIMIT_SESSION_DEFAULT = 50;
const TOKEN_BUDGET_DEFAULT = 100_000;
/**
 * Evaluate which gate (if any) should trigger.
 * Returns the first matching gate in priority order.
 */
function checkGates(ctx) {
    const codeLimit = ctx.retryLimitCode ?? RETRY_LIMIT_CODE_DEFAULT;
    const archLimit = ctx.retryLimitArch ?? RETRY_LIMIT_ARCH_DEFAULT;
    const sessionLimit = ctx.retryLimitSession ?? RETRY_LIMIT_SESSION_DEFAULT;
    const tokenBudget = ctx.tokenBudget ?? TOKEN_BUDGET_DEFAULT;
    if (ctx.tokenUsage !== undefined && ctx.tokenUsage >= tokenBudget) {
        return { gate: "token_budget_exceeded", condition: true };
    }
    if (ctx.costCapSession !== undefined &&
        ctx.costCapSession > 0 &&
        (ctx.estimatedCostSession ?? 0) >= ctx.costCapSession) {
        return { gate: "cost_cap_exceeded", condition: true };
    }
    if (ctx.llmCallCount !== undefined && ctx.llmCallCount >= sessionLimit) {
        return { gate: "session_llm_limit", condition: true };
    }
    if (ctx.scopeViolation) {
        return {
            gate: "scope_violation",
            condition: true,
            metadata: { path: ctx.scopeViolationPath },
        };
    }
    if (ctx.hasStagingWrites) {
        return { gate: "diff_preview", condition: true };
    }
    if (ctx.hasPlan && !ctx.planApproved) {
        return { gate: "plan_review", condition: true };
    }
    if (ctx.retryCountCode !== undefined && ctx.retryCountCode >= codeLimit) {
        return { gate: "test_failure", condition: true };
    }
    if (ctx.hasPartialPlanFailure) {
        return { gate: "partial_plan_failure", condition: true };
    }
    if (ctx.hasRuleProposal) {
        return { gate: "rule_proposal", condition: true };
    }
    if (ctx.hasJiraResolvePrompt) {
        return { gate: "jira_resolve_prompt", condition: true };
    }
    if (ctx.hasStaleJiraMismatch) {
        return { gate: "stale_jira_mismatch", condition: true };
    }
    // Runtime failure untouched: playwright failed on path not in touchedPaths
    if (ctx.playwrightPassed === false &&
        ctx.failureFilePath &&
        !ctx.touchedPaths?.includes(ctx.failureFilePath)) {
        return {
            gate: "runtime_failure_untouched",
            condition: true,
            metadata: { path: ctx.failureFilePath },
        };
    }
    return null;
}
function isUserActionToken(s) {
    const tokens = [
        "approve",
        "reject",
        "edit_and_retry",
        "create_jira_and_stop",
        "extend_budget",
        "abort",
        "resolve_jira",
        "keep_jira",
        "dismiss_jira",
        "accept_rule",
        "reject_rule",
    ];
    return tokens.includes(s);
}
