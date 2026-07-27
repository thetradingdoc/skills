/**
 * Append events to todos.session_log (jsonb array). Phase 1 session log.
 */

import { supabaseAdmin } from "./supabaseAdmin.js";
import * as traceLogger from "../../../src/agent/traceLogger.js";
import type { AgentTrace } from "../../../src/agent/types.js";

export type SessionLogEntry = {
  ts: string;
  type: string;
  payload?: Record<string, unknown>;
};

function newEntry(type: string, payload?: Record<string, unknown>): SessionLogEntry {
  return { ts: new Date().toISOString(), type, payload };
}

/** Atomic append via Postgres function when available; fallback to read-merge-write. */
export async function appendTodoSessionLog(
  todoId: string,
  type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  if (!supabaseAdmin) return;
  const entry = newEntry(type, payload);
  try {
    const { error } = await supabaseAdmin.rpc("append_todo_session_log", {
      p_todo_id: todoId,
      p_entry: entry,
    });
    if (!error) return;
  } catch {
    // RPC missing until migration applied — fallback below
  }
  try {
    const { data } = await supabaseAdmin
      .from("todos")
      .select("session_log")
      .eq("id", todoId)
      .maybeSingle();
    const prev = Array.isArray(data?.session_log) ? (data!.session_log as SessionLogEntry[]) : [];
    await supabaseAdmin
      .from("todos")
      .update({ session_log: [...prev, entry] })
      .eq("id", todoId);
  } catch {
    // best-effort
  }
}

export async function appendTodoSessionLogByRailId(
  railId: string,
  type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const { data } = await supabaseAdmin
      .from("todos")
      .select("id")
      .eq("rail_id", railId)
      .maybeSingle();
    if (data?.id) await appendTodoSessionLog(data.id as string, type, payload);
  } catch {
    // best-effort
  }
}

export async function setTodoStatusByRailId(
  railId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("todos")
      .update({ status, updated_at: now })
      .eq("rail_id", railId);
    await appendTodoSessionLogByRailId(railId, "status_change", { status, ...extra });
  } catch {
    // best-effort
  }
}

/** Wire agent traces into linked todo session_log. */
export function registerTodoSessionLogSink(): void {
  traceLogger.setAgentTraceSink((trace: AgentTrace) => {
    if (!trace.railId) return;
    const type =
      trace.type === "tool_call"
        ? "tool_call"
        : trace.type === "error"
          ? "error"
          : trace.type === "critic_feedback"
            ? "critic"
            : "agent";
    void appendTodoSessionLogByRailId(trace.railId, type, {
      message: trace.message?.slice(0, 2000),
      role: trace.role,
      filePath: trace.metadata?.filePath,
      logicPathStep: trace.metadata?.logicPathStep,
    });
  });
}
