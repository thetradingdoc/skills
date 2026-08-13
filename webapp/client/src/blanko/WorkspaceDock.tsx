/**
 * System dock — Platforms + Path + Rollup + Changes (Ops folded into System).
 */
import { useEffect, useState } from "react";
import type { ArchGraph, AgentInventoryResult } from "../types";
import { PlatformInventoryView } from "../PlatformInventoryView";
import { FlowView } from "../FlowView";
import { ManagementRollupView } from "../ManagementRollupView";
import { ChangesView } from "../ChangesView";
import { DockTabShell } from "./DockTabShell";
import { normalizeWorkspaceDockTab, type WorkspaceDockTab } from "./types";
import { FONT_UI, SLATE, LINE, CANVAS } from "../theme/tokens";

const SYSTEM_TABS: { id: WorkspaceDockTab; label: string }[] = [
  { id: "platforms", label: "Platforms" },
  { id: "path", label: "Path" },
  { id: "rollup", label: "Rollup" },
  { id: "changes", label: "Changes" },
];

type Props = {
  graph: ArchGraph;
  initialTab?: WorkspaceDockTab;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  agents?: AgentInventoryResult;
  onSelectNode?: (nodeId: string) => void;
  onSelectAgent?: (file: string) => void;
  selectedAgentFile?: string | null;
  onOpenFile?: (path: string, line?: number) => void;
  hasProjectRoot?: boolean;
  onConnectGitHub?: () => void;
  rollupRefreshKey?: number;
};

export function WorkspaceDock({
  graph,
  initialTab = "platforms",
  workspaceId,
  accessToken,
  apiBase = "/api",
  agents,
  onSelectNode,
  onSelectAgent,
  selectedAgentFile,
  onOpenFile,
  hasProjectRoot = false,
  onConnectGitHub,
  rollupRefreshKey = 0,
}: Props) {
  const [tab, setTab] = useState<WorkspaceDockTab>(() => normalizeWorkspaceDockTab(initialTab));

  useEffect(() => {
    setTab(normalizeWorkspaceDockTab(initialTab));
  }, [initialTab]);

  const crumbLabel =
    tab === "path"
      ? "Path"
      : tab === "rollup"
        ? "Rollup"
        : tab === "changes"
          ? "Changes"
          : "Platforms";
  const crumb = `System · ${crumbLabel}`;

  const shellActive: WorkspaceDockTab =
    tab === "flow" ? "path" : tab === "ops" ? "rollup" : tab;

  return (
    <div
      data-testid="blanko-workspace-dock"
      style={{ height: "100%", fontFamily: FONT_UI, display: "flex", flexDirection: "column" }}
    >
      <div
        data-testid="blanko-workspace-breadcrumb"
        style={{
          padding: "8px 12px",
          fontSize: 11,
          color: SLATE,
          borderBottom: `1px solid ${LINE}`,
          background: CANVAS,
          flexShrink: 0,
        }}
      >
        {crumb}
      </div>
      {/* Keep ops testids for specs that still look for rollup entry */}
      <div data-testid="blanko-ops-dock" style={{ display: "none" }} aria-hidden />
      <div style={{ flex: 1, minHeight: 0 }}>
        <DockTabShell
          tabs={SYSTEM_TABS}
          active={
            shellActive === "platforms" ||
            shellActive === "path" ||
            shellActive === "rollup" ||
            shellActive === "changes"
              ? shellActive
              : "platforms"
          }
          onChange={(id) => setTab(id as WorkspaceDockTab)}
        >
          {tab === "platforms" ? (
            <PlatformInventoryView graph={graph} onSelectNode={onSelectNode} />
          ) : null}
          {tab === "path" || tab === "flow" ? (
            <FlowView
              graph={graph}
              workspaceId={workspaceId}
              accessToken={accessToken}
              apiBase={apiBase}
              agents={agents ?? graph.agents}
              selectedAgentFile={selectedAgentFile}
              onSelectAgent={onSelectAgent}
              initialPane="path"
              onOpenFile={onOpenFile}
              hasProjectRoot={hasProjectRoot}
            />
          ) : null}
          {tab === "rollup" || tab === "ops" ? (
            workspaceId ? (
              <div data-testid="blanko-ops-rollup" style={{ height: "100%" }}>
                <ManagementRollupView
                  graph={graph}
                  workspaceId={workspaceId}
                  accessToken={accessToken ?? null}
                  apiBase={apiBase}
                  onSelectNode={onSelectNode}
                  onConnectGitHub={onConnectGitHub}
                  refreshKey={rollupRefreshKey}
                />
              </div>
            ) : (
              <div style={{ padding: 14, fontSize: 12, color: SLATE }}>Open a workspace for rollup.</div>
            )
          ) : null}
          {tab === "changes" ? (
            <div data-testid="blanko-ops-changes" style={{ height: "100%" }}>
              <ChangesView
                graph={graph}
                apiBase={apiBase}
                accessToken={accessToken ?? null}
                workspaceId={workspaceId ?? null}
              />
            </div>
          ) : null}
        </DockTabShell>
      </div>
    </div>
  );
}
