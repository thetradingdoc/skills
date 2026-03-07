"use strict";
/**
 * Rail orchestrator — Section 5
 * Central state machine for rails: valid transitions and guards.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransition = canTransition;
exports.transitionRail = transitionRail;
exports.completeMaterializeAndArchive = completeMaterializeAndArchive;
const fs = __importStar(require("fs"));
const manager_1 = require("./manager");
const sandbox_1 = require("./sandbox");
const executor_1 = require("./executor");
/** Maps RailState to the corresponding graph node (where applicable). */
const STATE_TO_NODE = {
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
const VALID_TRANSITIONS = {
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
/**
 * Check if a state transition is valid.
 */
function canTransition(from, to, _ctx) {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed)
        return false;
    if (!allowed.has(to))
        return false;
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
function transitionRail(rootPath, railId, to, ctx) {
    const rail = (0, manager_1.getRail)(rootPath, railId);
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
        (0, sandbox_1.ensureSandbox)(rootPath, railId);
    }
    if (to === "ARCHIVED" || to === "FAILED") {
        const sandboxPath = (0, sandbox_1.getSandboxPath)(rootPath, railId);
        try {
            if (fs.existsSync(sandboxPath)) {
                fs.rmSync(sandboxPath, { recursive: true, force: true });
            }
        }
        catch {
            // Best-effort cleanup; never block transition.
        }
    }
    const updated = to === "EXECUTING" ? (0, manager_1.enterExecutingState)(rootPath, railId) : (0, manager_1.updateRailState)(rootPath, railId, to);
    return { ok: !!updated, rail: updated ?? null };
}
/**
 * Complete the materialize → archive flow.
 * Call when reviewer has passed and materialization is done (in our flow, commits = materialization).
 */
function completeMaterializeAndArchive(rootPath, railId) {
    const rail = (0, manager_1.getRail)(rootPath, railId);
    if (!rail)
        return null;
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
    const sandboxPath = (0, sandbox_1.getSandboxPath)(rootPath, railId);
    const mat = (0, executor_1.materializeRail)(railId, sandboxPath, rootPath);
    const canProceed = mat.success || (mat.error?.includes("does not exist"));
    if (!canProceed) {
        // Materialization failed; keep rail in VERIFYING for HITL investigation.
        return rail;
    }
    if (rail.state === "VERIFYING") {
        (0, manager_1.updateRailState)(rootPath, railId, "MATERIALIZING");
    }
    return (0, manager_1.archiveRail)(rootPath, railId);
}
