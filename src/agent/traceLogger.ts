/**
 * Trace logger — AGENT_ROADMAP v4 §9
 * Emits trace entries for real-time observation and replay.
 */

import type { AgentTrace, TraceEntry, TraceStepType } from "./types";

let sessionId: string = "";
let subscriber: ((entry: TraceEntry) => void) | null = null;
let agentSubscriber: ((entry: AgentTrace) => void) | null = null;
const agentTraces: AgentTrace[] = [];

export interface TraceContext {
  railId?: string;
  taskId?: string;
  logicPathStep?: string;
  filePath?: string;
}

let traceContext: TraceContext = {};
let agentTraceSink: ((entry: AgentTrace) => void) | null = null;

/** Optional sink (e.g. Phase 1 todo session_log). */
export function setAgentTraceSink(cb: ((entry: AgentTrace) => void) | null): void {
  agentTraceSink = cb;
}

export function setTraceContext(ctx: TraceContext): void {
  traceContext = { ...ctx };
}

export function clearTraceContext(): void {
  traceContext = {};
}

export function getTraceContext(): TraceContext {
  return { ...traceContext };
}

function generateId(): string {
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function initTraceLogger(newSessionId?: string): void {
  sessionId = newSessionId ?? `sess_${Date.now()}`;
}

export function getSessionId(): string {
  return sessionId;
}

export function subscribeTrace(cb: (entry: TraceEntry) => void): () => void {
  subscriber = cb;
  return () => {
    subscriber = null;
  };
}

export function subscribeAgentTrace(cb: (entry: AgentTrace) => void): () => void {
  agentSubscriber = cb;
  return () => {
    agentSubscriber = null;
  };
}

function emitLegacyTrace(
  stepType: TraceStepType,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  decision: string,
  opts?: { llmCallCount?: number; tokenUsage?: number }
): TraceEntry {
  const entry: TraceEntry = {
    id: generateId(),
    sessionId,
    timestamp: new Date().toISOString(),
    stepType,
    input,
    output,
    decision,
    ...opts,
  };
  subscriber?.(entry);
  return entry;
}

function emitAgentTrace(entry: Omit<AgentTrace, "id" | "timestamp">): AgentTrace {
  const merged: Omit<AgentTrace, "id" | "timestamp"> = {
    ...entry,
    railId: entry.railId ?? traceContext.railId,
    taskId: entry.taskId ?? traceContext.taskId,
    metadata: {
      ...entry.metadata,
      logicPathStep: entry.metadata?.logicPathStep ?? traceContext.logicPathStep,
      filePath: entry.metadata?.filePath ?? traceContext.filePath,
    },
  };
  const full: AgentTrace = {
    id: generateId(),
    timestamp: Date.now(),
    ...merged,
  };
  agentTraces.push(full);
  agentSubscriber?.(full);
  agentTraceSink?.(full);
  return full;
}

export function getAgentTraces(): AgentTrace[] {
  return agentTraces.slice();
}

export function collectRecentReasoning(
  railId: string,
  windowN: number
): Array<{ message: string; timestamp: number; role: AgentTrace["role"]; type: AgentTrace["type"] }> {
  const filtered = agentTraces.filter(
    (t) => t.railId === railId && (t.type === "info" || t.type === "critic_feedback" || t.type === "error")
  );
  const recent = filtered.slice(-windowN);
  return recent.map((t) => ({
    message: t.message,
    timestamp: t.timestamp,
    role: t.role,
    type: t.type,
  }));
}

// Backwards compatible overloads:
export function emitTrace(
  entry: Omit<AgentTrace, "id" | "timestamp">
): AgentTrace;
export function emitTrace(
  stepType: TraceStepType,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  decision: string,
  opts?: { llmCallCount?: number; tokenUsage?: number }
): TraceEntry;
export function emitTrace(
  a: any,
  b?: any,
  c?: any,
  d?: any,
  e?: any
): TraceEntry | AgentTrace {
  // New API: emitTrace({ role, type, message, ... })
  if (a && typeof a === "object" && typeof a.message === "string") {
    return emitAgentTrace(a as Omit<AgentTrace, "id" | "timestamp">);
  }
  // Legacy API: emitTrace(stepType, input, output, decision, opts?)
  return emitLegacyTrace(a as TraceStepType, b ?? {}, c ?? {}, d ?? "", e);
}
