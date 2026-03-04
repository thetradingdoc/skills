/**
 * Agent Trace panel — AGENT_ROADMAP v4 §9
 * Minimal live view of agent steps.
 */

import { useRef, useEffect, useState } from "react";
import { styles } from "./styles";

export interface AgentTraceEntryData {
  id: string;
  sessionId: string;
  timestamp: string;
  stepType: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  decision: string;
  reasoning?: string;
  llmCallCount?: number;
  tokenUsage?: number;
  railId?: string;
  role?: "executor" | "reviewer" | "manager";
  eventType?: "info" | "tool_call" | "critic_feedback" | "error";
  metadata?: {
    logicPathStep?: string;
    filePath?: string;
  };
}

interface Props {
  entries: AgentTraceEntryData[];
  /** Optional active rail to scope the trace to (Z6.8). */
  activeRailId?: string | null;
  onExport?: () => void;
  replayEntries?: AgentTraceEntryData[] | null;
  replayIndex?: number;
  onReplayPrev?: () => void;
  onReplayNext?: () => void;
  onReplayLoad?: (json: string) => void;
  onReplayClose?: () => void;
  onJumpToRail?: (railId: string) => void;
  onJumpToTask?: (railId: string, taskId?: string) => void;
}

export function AgentTracePanel({
  entries,
  activeRailId,
  onExport,
  replayEntries,
  replayIndex = 0,
  onReplayPrev,
  onReplayNext,
  onReplayLoad,
  onReplayClose,
  onJumpToRail,
  onJumpToTask,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const displayEntries = replayEntries ?? entries;
  const isReplayMode = replayEntries != null;

  const railIds = Array.from(
    new Set(entries.map((e) => e.railId).filter(Boolean) as string[])
  );
  const roles = Array.from(
    new Set(entries.map((e) => e.role).filter(Boolean) as ("executor" | "reviewer" | "manager")[])
  );
  const types = Array.from(
    new Set(entries.map((e) => e.eventType).filter(Boolean) as ("info" | "tool_call" | "critic_feedback" | "error")[])
  );

  const [railFilter, setRailFilter] = useState<string | "all">(activeRailId ?? "all");
  const [roleFilter, setRoleFilter] = useState<string | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");

  // Keep trace rail-scoped to active rail when provided (Z6.8).
  useEffect(() => {
    if (activeRailId) {
      setRailFilter(activeRailId);
    }
  }, [activeRailId]);

  const filteredEntries = displayEntries.filter((e) => {
    if (railFilter !== "all" && e.railId !== railFilter) return false;
    if (roleFilter !== "all" && e.role !== roleFilter) return false;
    if (typeFilter !== "all" && e.eventType !== typeFilter) return false;
    return true;
  });

  // p12: Group by role when rail is selected (Reasoning Timeline)
  const roleOrder = ["manager", "executor", "reviewer"] as const;
  const groupedByRole =
    railFilter !== "all"
      ? roleOrder.map((role) => ({
          role,
          entries: filteredEntries.filter((e) => e.role === role),
        }))
      : null;

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  };

  return (
    <div style={styles.panel}>
      <div
        style={{
          ...styles.sectionHeader,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {railFilter !== "all"
          ? `Reasoning Timeline ${isReplayMode ? `(${replayIndex + 1}/${displayEntries.length})` : ""}`
          : `Agent Trace ${isReplayMode ? `(${replayIndex + 1}/${displayEntries.length})` : ""}`}
        <div style={{ display: "flex", gap: 4 }}>
          {isReplayMode && onReplayPrev && (
            <button
              onClick={onReplayPrev}
              disabled={replayIndex <= 0}
              style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
            >
              ← Prev
            </button>
          )}
          {isReplayMode && onReplayNext && (
            <button
              onClick={onReplayNext}
              disabled={replayIndex >= displayEntries.length - 1}
              style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
            >
              Next →
            </button>
          )}
          {isReplayMode && onReplayClose && (
            <button
              onClick={onReplayClose}
              style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
            >
              Exit replay
            </button>
          )}
          {!isReplayMode && onReplayLoad && (
            <button
              onClick={() => {
                const json = prompt("Paste trace JSON to replay:");
                if (json) onReplayLoad(json);
              }}
              style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
            >
              Load replay
            </button>
          )}
          {!isReplayMode && onExport && displayEntries.length > 0 && (
            <button
              onClick={onExport}
              style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
            >
              Export JSON
            </button>
          )}
        </div>
      </div>
      {/* Filters — rail first (p3: rail-scoped trace) */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 6,
          marginBottom: 4,
          fontSize: 11,
        }}
      >
        <select
          value={railFilter}
          onChange={(e) => setRailFilter(e.target.value as string)}
          style={{
            flex: 1,
            background: "#0d1117",
            color: "#c9d1d9",
            border: "1px solid #30363d",
            borderRadius: 4,
          }}
        >
          <option value="all">All rails</option>
          {railIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as any)}
          style={{
            flex: 1,
            background: "#0d1117",
            color: "#c9d1d9",
            border: "1px solid #30363d",
            borderRadius: 4,
          }}
        >
          <option value="all">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          style={{
            flex: 1,
            background: "#0d1117",
            color: "#c9d1d9",
            border: "1px solid #30363d",
            borderRadius: 4,
          }}
        >
          <option value="all">All events</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div
        style={{
          maxHeight: 180,
          overflowY: "auto",
          fontSize: 11,
          fontFamily: "monospace",
        }}
      >
        {filteredEntries.length === 0 && (
          <div style={{ color: "#7d8590", padding: 12 }}>No trace entries yet. Generate a plan to start.</div>
        )}
        {groupedByRole ? (
          groupedByRole.map(
            ({ role, entries }) =>
              entries.length > 0 && (
                <div key={role}>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#8b949e",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      marginTop: 8,
                      marginBottom: 4,
                    }}
                  >
                    {role}
                  </div>
                  {entries.map((e) => (
          <div
            key={e.id}
            style={{
              padding: "8px 0",
              borderBottom: "1px solid #21262d",
              ...(isReplayMode && displayEntries.indexOf(e) === replayIndex
                ? { background: "#21262d", border: "1px solid #58a6ff", borderRadius: 6 }
                : {}),
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#8b949e" }}>{formatTime(e.timestamp)}</span>
              <span
                style={{
                  background: "#21262d",
                  padding: "2px 6px",
                  borderRadius: 4,
                  color: "#58a6ff",
                }}
              >
                {e.stepType}
              </span>
              {e.metadata?.logicPathStep && (
                <span
                  style={{
                    background: "#161b22",
                    padding: "2px 6px",
                    borderRadius: 4,
                    color: "#7ee787",
                    fontSize: 10,
                  }}
                  title={e.metadata.filePath}
                >
                  {e.metadata.logicPathStep}
                </span>
              )}
              {e.llmCallCount != null && (
                <span style={{ color: "#7d8590" }}>LLM:{e.llmCallCount}</span>
              )}
              {e.tokenUsage != null && (
                <span style={{ color: "#7d8590" }}>tokens:{e.tokenUsage}</span>
              )}
            </div>
            <div style={{ color: "#e6edf3", marginTop: 4 }}>{e.decision}</div>
            {e.reasoning && (
              <div style={{ color: "#8b949e", marginTop: 4, fontSize: 10, whiteSpace: "pre-wrap" }}>{e.reasoning}</div>
            )}
            {(e.railId || onJumpToRail || onJumpToTask) && (
              <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                {e.railId && onJumpToRail && (
                  <button
                    onClick={() => onJumpToRail(e.railId!)}
                    style={{
                      ...styles.buttonBase,
                      ...styles.buttonSecondary,
                      padding: "2px 6px",
                      fontSize: 10,
                    }}
                  >
                    Jump to rail
                  </button>
                )}
                {e.railId && onJumpToTask && (
                  <button
                    onClick={() => onJumpToTask(e.railId!, (e.output as any)?.taskId)}
                    style={{
                      ...styles.buttonBase,
                      ...styles.buttonSecondary,
                      padding: "2px 6px",
                      fontSize: 10,
                    }}
                  >
                    Jump to task
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
                </div>
              )
          )
        ) : (
          filteredEntries.map((e) => (
          <div
            key={e.id}
            style={{
              padding: "8px 0",
              borderBottom: "1px solid #21262d",
              ...(isReplayMode && displayEntries.indexOf(e) === replayIndex
                ? { background: "#21262d", border: "1px solid #58a6ff", borderRadius: 6 }
                : {}),
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#8b949e" }}>{formatTime(e.timestamp)}</span>
              <span
                style={{
                  background: "#21262d",
                  padding: "2px 6px",
                  borderRadius: 4,
                  color: "#58a6ff",
                }}
              >
                {e.stepType}
              </span>
              {e.metadata?.logicPathStep && (
                <span
                  style={{
                    background: "#161b22",
                    padding: "2px 6px",
                    borderRadius: 4,
                    color: "#7ee787",
                    fontSize: 10,
                  }}
                  title={e.metadata.filePath}
                >
                  {e.metadata.logicPathStep}
                </span>
              )}
              {e.llmCallCount != null && (
                <span style={{ color: "#7d8590" }}>LLM:{e.llmCallCount}</span>
              )}
              {e.tokenUsage != null && (
                <span style={{ color: "#7d8590" }}>tokens:{e.tokenUsage}</span>
              )}
            </div>
            <div style={{ color: "#e6edf3", marginTop: 4 }}>{e.decision}</div>
            {e.reasoning && (
              <div style={{ color: "#8b949e", marginTop: 4, fontSize: 10, whiteSpace: "pre-wrap" }}>{e.reasoning}</div>
            )}
            {(e.railId || onJumpToRail || onJumpToTask) && (
              <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                {e.railId && onJumpToRail && (
                  <button
                    onClick={() => onJumpToRail(e.railId!)}
                    style={{
                      ...styles.buttonBase,
                      ...styles.buttonSecondary,
                      padding: "2px 6px",
                      fontSize: 10,
                    }}
                  >
                    Jump to rail
                  </button>
                )}
                {e.railId && onJumpToTask && (
                  <button
                    onClick={() => onJumpToTask(e.railId!, (e.output as any)?.taskId)}
                    style={{
                      ...styles.buttonBase,
                      ...styles.buttonSecondary,
                      padding: "2px 6px",
                      fontSize: 10,
                    }}
                  >
                    Jump to task
                  </button>
                )}
              </div>
            )}
          </div>
        ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
