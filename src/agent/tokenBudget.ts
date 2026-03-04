/**
 * Token budget — AGENT_ROADMAP v4 §4b
 * Per-session limit, 80% warning, hard stop, extend mechanic.
 */

const TOKEN_BUDGET_DEFAULT = 100_000;
const WARNING_THRESHOLD = 0.8;
const EXTEND_DEFAULT = 20_000;
const CEILING = 500_000;
export const TIER2_FRACTION = 0.8;

let tokenUsage = 0;
let budget = TOKEN_BUDGET_DEFAULT;

export function getTokenUsage(): number {
  return tokenUsage;
}

export function getTokenBudget(): number {
  return budget;
}

export function addTokenUsage(count: number): void {
  tokenUsage += count;
}

export function setTokenBudget(value: number): void {
  budget = Math.min(value, CEILING);
}

export function extendBudget(amount: number = EXTEND_DEFAULT): void {
  budget = Math.min(budget + amount, CEILING);
}

export function isOverBudget(): boolean {
  return tokenUsage >= budget;
}

export function isWarningThreshold(): boolean {
  return tokenUsage >= budget * WARNING_THRESHOLD;
}

export function resetTokenBudget(): void {
  tokenUsage = 0;
  budget = TOKEN_BUDGET_DEFAULT;
}
