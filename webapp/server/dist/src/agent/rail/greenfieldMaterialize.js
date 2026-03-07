"use strict";
/**
 * Greenfield materialize as a Rail — sandbox first, then HITL approval to copy to root.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializeGreenfieldRail = materializeGreenfieldRail;
exports.approveGreenfieldMaterialize = approveGreenfieldMaterialize;
const manager_1 = require("./manager");
const sandbox_1 = require("./sandbox");
const executor_1 = require("./executor");
const orchestrator_1 = require("./orchestrator");
const greenfieldSpecGeneration_1 = require("./greenfieldSpecGeneration");
const GREENFIELD_MATERIALIZE_ARCHETYPE = "greenfield-materialize";
/**
 * Create a greenfield materialize rail: scaffold proposed nodes into sandbox, set state to VERIFYING.
 * Caller later approves and calls approveGreenfieldMaterialize(rootPath, railId) to copy to root and archive.
 */
function materializeGreenfieldRail(params) {
    const { rootPath, sessionId, outcome, nodes } = params;
    const trigger = {
        source: "chat",
        userMessage: outcome,
        sessionId,
    };
    const now = Date.now();
    const railId = `rail-greenfield-${now}`;
    const rail = {
        id: railId,
        version: 1,
        outcome,
        trigger,
        archetype: GREENFIELD_MATERIALIZE_ARCHETYPE,
        logicPath: [],
        state: "PLANNING",
        activeAgent: null,
        tasks: [],
        jiraKeys: [],
        traceIds: [],
        overlaps: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "human",
        sessionId,
    };
    (0, manager_1.createRail)(rootPath, rail);
    const toExec = (0, orchestrator_1.transitionRail)(rootPath, railId, "EXECUTING", { planApproved: true });
    if (!toExec.ok || !toExec.rail)
        return null;
    const sandboxPath = (0, sandbox_1.getSandboxPath)(rootPath, railId);
    (0, sandbox_1.ensureSandbox)(rootPath, railId);
    const { created, errors } = (0, executor_1.writeProposedNodesToSandbox)(sandboxPath, nodes);
    if (errors.length > 0 && created.length === 0) {
        return null;
    }
    if (params.acceptanceCriteria?.functional?.length) {
        try {
            (0, greenfieldSpecGeneration_1.writeGeneratedSpecToSandbox)(sandboxPath, params.acceptanceCriteria.functional, "e2e/greenfield-generated.spec.ts");
        }
        catch {
            // Non-fatal: spec generation failed
        }
    }
    const toVerifying = (0, orchestrator_1.transitionRail)(rootPath, railId, "VERIFYING");
    if (!toVerifying.ok)
        return (0, manager_1.getRail)(rootPath, railId);
    const current = (0, manager_1.getRail)(rootPath, railId);
    if (!current)
        return null;
    const partial = {};
    if (params.acceptanceCriteria)
        partial.acceptanceCriteria = params.acceptanceCriteria;
    if (params.lastCritique) {
        partial.lastCritique = {
            source: "reviewer",
            message: params.lastCritique.message,
            createdAt: now,
            criticScore: params.lastCritique.criticScore,
            violations: Array.isArray(params.lastCritique.violations)
                ? params.lastCritique.violations.map((v) => {
                    const o = v;
                    return {
                        type: String(o.type ?? ""),
                        severity: String(o.severity ?? ""),
                        description: String(o.description ?? ""),
                    };
                })
                : undefined,
        };
    }
    const updated = Object.keys(partial).length > 0 ? (0, manager_1.updateRailPartial)(rootPath, railId, partial) : current;
    return updated ?? current;
}
/**
 * Copy sandbox to project root and archive the rail. Call after user approves materialization.
 */
function approveGreenfieldMaterialize(rootPath, railId) {
    const rail = (0, manager_1.getRail)(rootPath, railId);
    if (!rail || rail.archetype !== GREENFIELD_MATERIALIZE_ARCHETYPE)
        return null;
    return (0, orchestrator_1.completeMaterializeAndArchive)(rootPath, railId);
}
