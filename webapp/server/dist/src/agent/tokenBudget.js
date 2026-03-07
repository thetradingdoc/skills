"use strict";
/**
 * Token budget — AGENT_ROADMAP v4 §4b
 * Per-session limit, 80% warning, hard stop, extend mechanic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER2_FRACTION = void 0;
exports.getTokenUsage = getTokenUsage;
exports.getTokenBudget = getTokenBudget;
exports.addTokenUsage = addTokenUsage;
exports.setTokenBudget = setTokenBudget;
exports.extendBudget = extendBudget;
exports.isOverBudget = isOverBudget;
exports.isWarningThreshold = isWarningThreshold;
exports.resetTokenBudget = resetTokenBudget;
const TOKEN_BUDGET_DEFAULT = 100_000;
const WARNING_THRESHOLD = 0.8;
const EXTEND_DEFAULT = 20_000;
const CEILING = 500_000;
exports.TIER2_FRACTION = 0.8;
let tokenUsage = 0;
let budget = TOKEN_BUDGET_DEFAULT;
function getTokenUsage() {
    return tokenUsage;
}
function getTokenBudget() {
    return budget;
}
function addTokenUsage(count) {
    tokenUsage += count;
}
function setTokenBudget(value) {
    budget = Math.min(value, CEILING);
}
function extendBudget(amount = EXTEND_DEFAULT) {
    budget = Math.min(budget + amount, CEILING);
}
function isOverBudget() {
    return tokenUsage >= budget;
}
function isWarningThreshold() {
    return tokenUsage >= budget * WARNING_THRESHOLD;
}
function resetTokenBudget() {
    tokenUsage = 0;
    budget = TOKEN_BUDGET_DEFAULT;
}
