/**
 * Greenfield materialize as a Rail — sandbox first, then HITL approval to copy to root.
 */

import type { Rail, RailTrigger } from "../types";
import { createRail, getRail, updateRailPartial } from "./manager";
import { getSandboxPath, ensureSandbox } from "./sandbox";
import { writeProposedNodesToSandbox, type ProposedNodeSpec } from "./executor";
import { transitionRail, completeMaterializeAndArchive } from "./orchestrator";
import { writeGeneratedSpecToSandbox } from "./greenfieldSpecGeneration";

const GREENFIELD_MATERIALIZE_ARCHETYPE = "greenfield-materialize";

export interface MaterializeGreenfieldRailParams {
  rootPath: string;
  sessionId: string;
  outcome: string;
  nodes: ProposedNodeSpec[];
  acceptanceCriteria?: { functional: string[]; visual: string[]; architectural: string[] };
  lastCritique?: { criticScore?: number; message: string; violations?: unknown[] };
}

/**
 * Create a greenfield materialize rail: scaffold proposed nodes into sandbox, set state to VERIFYING.
 * Caller later approves and calls approveGreenfieldMaterialize(rootPath, railId) to copy to root and archive.
 */
export function materializeGreenfieldRail(params: MaterializeGreenfieldRailParams): Rail | null {
  const { rootPath, sessionId, outcome, nodes } = params;
  const trigger: RailTrigger = {
    source: "chat",
    userMessage: outcome,
    sessionId,
  };
  const now = Date.now();
  const railId = `rail-greenfield-${now}`;
  const rail: Rail = {
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
  createRail(rootPath, rail);

  const toExec = transitionRail(rootPath, railId, "EXECUTING", { planApproved: true });
  if (!toExec.ok || !toExec.rail) return null;

  const sandboxPath = getSandboxPath(rootPath, railId);
  ensureSandbox(rootPath, railId);
  const { created, errors } = writeProposedNodesToSandbox(sandboxPath, nodes);
  if (errors.length > 0 && created.length === 0) {
    return null;
  }

  if (params.acceptanceCriteria?.functional?.length) {
    try {
        writeGeneratedSpecToSandbox(sandboxPath, params.acceptanceCriteria.functional);
    } catch {
      // Non-fatal: spec generation failed
    }
  }

  const toVerifying = transitionRail(rootPath, railId, "VERIFYING");
  if (!toVerifying.ok) return getRail(rootPath, railId);

  const current = getRail(rootPath, railId);
  if (!current) return null;

  const partial: Partial<Pick<Rail, "acceptanceCriteria" | "lastCritique">> = {};
  if (params.acceptanceCriteria) partial.acceptanceCriteria = params.acceptanceCriteria;
  if (params.lastCritique) {
    partial.lastCritique = {
      source: "reviewer",
      message: params.lastCritique.message,
      createdAt: now,
      criticScore: params.lastCritique.criticScore,
      violations: Array.isArray(params.lastCritique.violations)
        ? params.lastCritique.violations.map((v: unknown) => {
            const o = v as Record<string, unknown>;
            return {
              type: String(o.type ?? ""),
              severity: String(o.severity ?? ""),
              description: String(o.description ?? ""),
            };
          })
        : undefined,
    };
  }
  const updated = Object.keys(partial).length > 0 ? updateRailPartial(rootPath, railId, partial) : current;
  return updated ?? current;
}

/**
 * Copy sandbox to project root and archive the rail. Call after user approves materialization.
 */
export function approveGreenfieldMaterialize(rootPath: string, railId: string): Rail | null {
  const rail = getRail(rootPath, railId);
  if (!rail || rail.archetype !== GREENFIELD_MATERIALIZE_ARCHETYPE) return null;
  return completeMaterializeAndArchive(rootPath, railId);
}
