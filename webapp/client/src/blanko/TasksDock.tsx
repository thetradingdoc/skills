/**
 * Tasks dock — FlowTasksBoard only (separate from System / Ops).
 */
import type { AgentInventoryResult } from "../types";
import { FlowTasksBoard } from "../FlowTasksBoard";
import { ACCENT, CANVAS, FONT_UI, LINE, SLATE } from "../theme/tokens";

type Props = {
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  agents?: AgentInventoryResult;
  onSelectAgent?: (file: string) => void;
  selectedAgentFile?: string | null;
  focusTodoId?: string | null;
  notice?: string | null;
  refreshKey?: number;
  onOpenFile?: (path: string, line?: number) => void;
  fixAgentDisabledReason?: string | null;
  dockMaximized?: boolean;
  hasProjectRoot?: boolean;
  onTodoApproved?: (todoId: string) => void;
  breadcrumbDetail?: string | null;
  onApplyTradingSpine?: () => void;
  onOpenInsights?: () => void;
};

export function TasksDock({
  workspaceId,
  accessToken,
  apiBase = "/api",
  agents,
  onSelectAgent,
  selectedAgentFile,
  focusTodoId,
  notice,
  refreshKey = 0,
  onOpenFile,
  fixAgentDisabledReason,
  dockMaximized = false,
  hasProjectRoot = false,
  onTodoApproved,
  breadcrumbDetail = null,
  onApplyTradingSpine,
  onOpenInsights,
}: Props) {
  const crumb = `Tasks${breadcrumbDetail ? ` · ${breadcrumbDetail}` : ""}`;

  return (
    <div data-testid="blanko-tasks-dock" style={{ height: "100%", fontFamily: FONT_UI, display: "flex", flexDirection: "column" }}>
      <div
        data-testid="blanko-tasks-breadcrumb"
        style={{
          padding: "8px 12px",
          fontSize: 11,
          color: SLATE,
          borderBottom: `1px solid ${LINE}`,
          background: CANVAS,
        }}
      >
        {crumb}
      </div>
      {notice ? (
        <div
          data-testid="blanko-flow-tasks-notice"
          style={{ padding: "8px 12px", fontSize: 12, color: ACCENT, borderBottom: `1px solid ${LINE}` }}
        >
          {notice}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }} key={refreshKey}>
        <FlowTasksBoard
          workspaceId={workspaceId}
          accessToken={accessToken}
          apiBase={apiBase}
          agentFile={selectedAgentFile}
          agents={agents}
          onSelectAgent={onSelectAgent}
          focusTodoId={focusTodoId}
          notice={notice}
          refreshKey={refreshKey}
          onOpenFile={onOpenFile ? (path) => onOpenFile(path) : undefined}
          fixAgentDisabledReason={fixAgentDisabledReason}
          dockMaximized={dockMaximized}
          hasProjectRoot={hasProjectRoot}
          onApproved={onTodoApproved}
          onApplyTradingSpine={onApplyTradingSpine}
          onOpenInsights={onOpenInsights}
        />
      </div>
    </div>
  );
}
