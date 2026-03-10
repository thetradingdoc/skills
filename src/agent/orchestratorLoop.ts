/**
 * Agent orchestrator loop — AGENT_ROADMAP v4 §1
 * schedule → critic → checkGates → act
 *
 * Run on trigger (e.g. after plan, after task, or on demand).
 * If a gate fires, act (emit/notify, pause); otherwise continue.
 */

import type { GateCondition } from "./gateChecker";
import { checkGates } from "./gateChecker";
import type { GateCheckContext } from "./gateChecker";

export interface OrchestratorLoopResult {
  /** Gate that fired, or null if none */
  gate: GateCondition | null;
  /** Whether to pause (HITL required) */
  shouldPause: boolean;
}

/**
 * Run one cycle: evaluate gates with the given context.
 * Caller is responsible for schedule (when to run) and critic (what state to pass).
 */
export function runOrchestratorCycle(ctx: Partial<GateCheckContext>): OrchestratorLoopResult {
  const gate = checkGates(ctx);
  const shouldPause =
    gate !== null &&
    !["token_budget_exceeded", "session_llm_limit", "cost_cap_exceeded"].includes(gate.gate);
  return { gate, shouldPause };
}
