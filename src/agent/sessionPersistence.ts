/**
 * Session persistence — AGENT_ROADMAP v4 §5c
 * AgentSession serialization, crash recovery.
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentSession, AgentPlan, GateType } from "./types";
import { getTraceContext } from "./traceLogger";
import { recordTokens, recordLlmCall } from "./rail/telemetry";

const SESSION_FILE = ".arch-agent-session.json";

export function getSessionPath(projectRoot: string): string {
  return path.join(projectRoot, SESSION_FILE);
}

export function saveSession(projectRoot: string, session: AgentSession): void {
  const p = getSessionPath(projectRoot);
  fs.writeFileSync(p, JSON.stringify(session, null, 2), "utf-8");
}

export function loadSession(projectRoot: string): AgentSession | null {
  const p = getSessionPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as AgentSession;
  } catch {
    return null;
  }
}

export function deleteSession(projectRoot: string): void {
  const p = getSessionPath(projectRoot);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function createEmptySession(plan: AgentPlan): AgentSession {
  return {
    planState: plan,
    currentTaskIndex: 0,
    sessionTouchedPaths: [],
    tokenUsage: 0,
    llmCallCount: 0,
    retryCounts: {},
    activeGate: "plan_review" as GateType,
    stagingIds: [],
  };
}

export function bumpSessionUsage(
  projectRoot: string,
  delta: { tokenUsage?: number; llmCallCount?: number }
): void {
  const session = loadSession(projectRoot);
  if (!session) return;
  const ctx = getTraceContext();
  if (typeof delta.tokenUsage === "number" && Number.isFinite(delta.tokenUsage)) {
    session.tokenUsage += delta.tokenUsage;
    if (ctx.railId) {
      recordTokens(ctx.railId, delta.tokenUsage);
    }
  }
  if (typeof delta.llmCallCount === "number" && Number.isFinite(delta.llmCallCount)) {
    session.llmCallCount += delta.llmCallCount;
    if (ctx.railId) {
      recordLlmCall(ctx.railId);
    }
  }
  saveSession(projectRoot, session);
}
