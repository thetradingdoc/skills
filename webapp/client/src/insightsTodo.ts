/**
 * Insights → todos binding helpers (sourcePath / fileScope).
 * Pure — used by App + unit tests.
 */
import type { ArchNode } from "./types";
import type { NodeNextAction } from "./insightsBriefing";

export type InsightsTodoPayload = {
  title: string;
  description: string;
  source: "insights";
  sourcePath: string;
  sourceNodeId: string;
  fileScope: string[];
  agentFile: string | null;
  layerId: string | null;
  kind: "task" | "issue";
  context: string;
  assigneeLabel: "Cursor";
};

/** Stable id for dedupe: insights:{nodeId}:{actionId} */
export function insightsTodoSourcePath(nodeId: string, actionId: string): string {
  return `insights:${nodeId}:${actionId}`;
}

/** Spine gaps are Apply-spine CTAs — never agent Run/Approve todos (D1). */
export function isSpineRemediationAction(action: Pick<NodeNextAction, "kind" | "id" | "taskTitle" | "title">): boolean {
  if (action.kind === "spine") return true;
  const id = (action.id ?? "").toLowerCase();
  if (
    id === "wire-ingress" ||
    id === "board-setup" ||
    id.includes("missing_trading_spine")
  ) {
    return true;
  }
  const title = `${action.taskTitle ?? ""} ${action.title ?? ""}`.toLowerCase();
  return (
    title.includes("trading agent spine") ||
    title.includes("architecture spine") ||
    title.includes("apply trading spine") ||
    title.includes("money-path board") ||
    title.includes("money path board")
  );
}

/** Detect already-created todos that should not Run/Approve as agent work. */
export function isSpineRemediationTodo(todo: {
  title?: string | null;
  context?: string | null;
  source_path?: string | null;
  description?: string | null;
}): boolean {
  const title = (todo.title ?? "").toLowerCase();
  const ctx = `${todo.context ?? ""} ${todo.description ?? ""}`.toLowerCase();
  const sp = (todo.source_path ?? "").toLowerCase();
  if (
    sp.includes("missing_trading_spine") ||
    sp.includes(":wire-ingress") ||
    sp.includes(":board-setup")
  ) {
    return true;
  }
  if (ctx.includes("missing_trading_spine") || ctx.includes("wire-ingress") || ctx.includes("board-setup")) {
    return true;
  }
  return (
    title.includes("trading agent spine") ||
    title.includes("architecture spine") ||
    title.includes("apply trading spine") ||
    title.includes("money-path board") ||
    title.includes("money path board")
  );
}

export function buildInsightsTodoPayload(
  node: ArchNode,
  action: NodeNextAction
): InsightsTodoPayload {
  if (isSpineRemediationAction(action)) {
    throw new Error("Spine gaps use Apply trading spine in Insights — not Tasks Run/Approve.");
  }
  const title = (action.taskTitle ?? action.title).trim() || `Review ${node.label}`;
  const description = action.detail?.trim() || "";
  const fileScope = [
    ...(action.filePath ? [action.filePath] : []),
    ...((node.files ?? []).filter((f) => f && f !== action.filePath) as string[]),
  ].slice(0, 12);
  const agentFile = action.filePath ?? node.files?.[0] ?? null;
  const layerId =
    (node.subsystem as string | undefined) ??
    (typeof node.layer === "string" ? node.layer : null);
  const kind: "task" | "issue" = "task";

  return {
    title,
    description,
    source: "insights",
    sourcePath: insightsTodoSourcePath(node.id, action.id),
    sourceNodeId: node.id,
    fileScope,
    agentFile,
    layerId,
    kind,
    context: `Blanko Insights · ${node.label} (${node.id}) · action ${action.id}`,
    assigneeLabel: "Cursor",
  };
}
