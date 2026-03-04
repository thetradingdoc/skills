/**
 * Rail orchestrator — Section 5
 * Central state machine for rails: valid transitions and guards.
 */

import * as fs from "fs";
import * as path from "path";
import type { Rail, RailId, RailState } from "../types";
import { getRail, updateRailState, archiveRail, enterExecutingState } from "./manager";
import { getSandboxPath, ensureSandbox } from "./sandbox";
import { materializeRail } from "./executor";

/** Maps RailState to the corresponding graph node (where applicable). */
const STATE_TO_NODE: Partial<Record<RailState, string>> = {
  PRE_PLANNING: "plan_node",
  PLANNING: "plan_node",
  AWAITING_APPROVAL: "hitl_approve_plan",
  EXECUTING: "executor_node",
  AWAITING_HITL: "hitl_gate_node",
  VERIFYING: "reviewer_node",
  SELF_CORRECTING: "executor_node",
  MATERIALIZING: "materialize_node",
  ARCHIVED: "archive_node",
  SUSPENDED: "hitl_gate_node",
  FAILED: "archive_node",
};

/** Valid transitions: fromState -> Set of allowed toStates. */
const VALID_TRANSITIONS: Partial<Record<RailState, Set<RailState>>> = {
  PRE_PLANNING: new Set(["PLANNING", "AWAITING_APPROVAL", "SUSPENDED", "FAILED"]),
  PLANNING: new Set(["AWAITING_APPROVAL", "SUSPENDED", "FAILED"]),
  AWAITING_APPROVAL: new Set(["EXECUTING", "SUSPENDED", "FAILED"]),
  EXECUTING: new Set(["AWAITING_HITL", "VERIFYING", "SELF_CORRECTING", "SUSPENDED", "FAILED"]),
  AWAITING_HITL: new Set(["EXECUTING", "SUSPENDED", "FAILED"]),
  VERIFYING: new Set(["MATERIALIZING", "SELF_CORRECTING", "SUSPENDED", "FAILED"]),
  SELF_CORRECTING: new Set(["EXECUTING", "AWAITING_HITL", "SUSPENDED", "FAILED"]),
  MATERIALIZING: new Set(["ARCHIVED", "SUSPENDED", "FAILED"]),
  SUSPENDED: new Set(["AWAITING_APPROVAL", "EXECUTING"]),
  FAILED: new Set(), // terminal
  ARCHIVED: new Set(), // terminal
};

export interface OrchestratorContext {
  /** Plan approved by human (required to enter EXECUTING). */
  planApproved?: boolean;
  /** Reviewer passed (lint + vitest + playwright). */
  reviewerPassed?: boolean;
  /** Human approved materialization. In our flow, commits = materialization. */
  materializationApproved?: boolean;
  /** Number of self-correction retries so far. */
  retryCount?: number;
  /** Max retries before FAILED. */
  retryLimit?: number;
}

/**
 * Check if a state transition is valid.
 */
export function canTransition(
  from: RailState,
  to: RailState,
  _ctx?: OrchestratorContext
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  if (!allowed.has(to)) return false;

  // Guards
  if (to === "EXECUTING" && from === "AWAITING_APPROVAL") {
    // Guard: cannot enter EXECUTING without plan approval
    return _ctx?.planApproved === true;
  }
  if (to === "MATERIALIZING" && from === "VERIFYING") {
    // Guard: cannot enter MATERIALIZING without reviewer passing
    return _ctx?.reviewerPassed === true;
  }
  if (to === "ARCHIVED" && from === "MATERIALIZING") {
    // Guard: cannot enter ARCHIVED without materialize_node completing
    return _ctx?.materializationApproved === true;
  }
  if (to === "SUSPENDED") {
    // Can always suspend from non-terminal states
    return from !== "ARCHIVED" && from !== "FAILED";
  }
  if (to === "FAILED") {
    // Can fail from any non-terminal state
    return from !== "ARCHIVED";
  }

  return true;
}

/**
 * Transition a rail to a new state if guards pass.
 * Returns the updated rail or null.
 */
export function transitionRail(
  rootPath: string,
  railId: RailId,
  to: RailState,
  ctx?: OrchestratorContext
): { ok: boolean; rail: Rail | null; error?: string } {
  const rail = getRail(rootPath, railId);
  if (!rail) {
    return { ok: false, rail: null, error: "Rail not found" };
  }

  const from = rail.state;

  if (from === to) {
    return { ok: true, rail };
  }

  if (!canTransition(from, to, ctx)) {
    return {
      ok: false,
      rail: null,
      error: `Invalid transition: ${from} -> ${to} (guards may have failed)`,
    };
  }

  // Sandbox lifecycle hooks: create on EXECUTING, delete on ARCHIVED/FAILED.
  if (to === "EXECUTING") {
    ensureSandbox(rootPath, railId);
  }
  if (to === "ARCHIVED" || to === "FAILED") {
    const sandboxPath = getSandboxPath(rootPath, railId);
    try {
      if (fs.existsSync(sandboxPath)) {
        fs.rmSync(sandboxPath, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup; never block transition.
    }
  }

  const updated =
    to === "EXECUTING" ? enterExecutingState(rootPath, railId) : updateRailState(rootPath, railId, to);
  return { ok: !!updated, rail: updated ?? null };
}

/**
 * Complete the materialize → archive flow.
 * Call when reviewer has passed and materialization is done (in our flow, commits = materialization).
 */
export function completeMaterializeAndArchive(rootPath: string, railId: RailId): Rail | null {
  const rail = getRail(rootPath, railId);
  if (!rail) return null;
  if (rail.state !== "VERIFYING" && rail.state !== "MATERIALIZING") {
    return null;
  }

  // p8: HITL lock — block MATERIALIZING when hallucination > 0.5 until human acknowledges drift.
  const hi = rail.hallucinationIndex;
  const acknowledged = !!rail.hallucinationAcknowledgedAt;
  if (hi != null && hi > 0.5 && !acknowledged) {
    return null;
  }

  // Treat sandbox → project copy as the materialization step.
  const sandboxPath = getSandboxPath(rootPath, railId);
  const mat = materializeRail(railId, sandboxPath, rootPath);
  const canProceed = mat.success || (mat.error?.includes("does not exist"));
  if (!canProceed) {
    // Materialization failed; keep rail in VERIFYING for HITL investigation.
    return rail;
  }

  if (rail.state === "VERIFYING") {
    updateRailState(rootPath, railId, "MATERIALIZING");
  }
  return archiveRail(rootPath, railId);
}
