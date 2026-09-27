/**
 * Workspace dock — connections/activity plus repository architecture/tools.
 */
import { useEffect, useState } from "react";
import type { ArchGraph, AgentInventoryResult } from "../types";
import { PlatformInventoryView } from "../PlatformInventoryView";
import { FlowView } from "../FlowView";
import { ManagementRollupView } from "../ManagementRollupView";
import { ChangesView } from "../ChangesView";
import { AgentsDock } from "./AgentsDock";
import { DockTabShell } from "./DockTabShell";
import { normalizeWorkspaceDockTab, type AgentsDockTab, type WorkspaceDockTab } from "./types";
import { FONT_UI, SLATE, LINE, CANVAS } from "../theme/tokens";

const SYSTEM_TABS: { id: WorkspaceDockTab; label: string }[] = [
  { id: "platforms", label: "Connections" },
  { id: "path", label: "Workflow" },
  { id: "rollup", label: "Overview" },
  { id: "changes", label: "Scan changes" },
];

type WorkspaceArea = "workspace" | "architecture";

type Props = {
  graph: ArchGraph;
  initialTab?: WorkspaceDockTab;
  initialArea?: WorkspaceArea;
  initialAgentTab?: AgentsDockTab;
  onAreaChange?: (area: WorkspaceArea) => void;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  agents?: AgentInventoryResult;
  onSelectNode?: (nodeId: string) => void;
  onSelectAgent?: (file: string) => void;
  selectedAgentFile?: string | null;
  openPath?: string | null;
  onOpenFile?: (path: string, line?: number) => void;
  hasProjectRoot?: boolean;
  onConnectGitHub?: () => void;
  rollupRefreshKey?: number;
};

export function WorkspaceDock({
  graph,
  initialTab = "platforms",
  initialArea = "workspace",
  initialAgentTab = "inventory",
  onAreaChange,
  workspaceId,
  accessToken,
  apiBase = "/api",
  agents,
  onSelectNode,
  onSelectAgent,
  selectedAgentFile,
  openPath,
  onOpenFile,
  hasProjectRoot = false,
  onConnectGitHub,
  rollupRefreshKey = 0,
}: Props) {
  const [area, setArea] = useState<WorkspaceArea>(initialArea);
  const [tab, setTab] = useState<WorkspaceDockTab>(() => normalizeWorkspaceDockTab(initialTab));

  useEffect(() => {
    setTab(normalizeWorkspaceDockTab(initialTab));
  }, [initialTab]);
  useEffect(() => setArea(initialArea), [initialArea]);

  const crumbLabel =
    tab === "path"
      ? "Workflow"
      : tab === "rollup"
        ? "Overview"
        : tab === "changes"
          ? "Scan changes"
          : "Connections";
  const crumb = `Workspace · ${crumbLabel}`;

  const shellActive: WorkspaceDockTab =
    tab === "flow" ? "path" : tab === "ops" ? "rollup" : tab;

  return (
    <div
      data-testid="blanko-workspace-dock"
      style={{ height: "100%", fontFamily: FONT_UI, display: "flex", flexDirection: "column" }}
    >
      <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: `1px solid ${LINE}`, background: CANVAS, flexShrink: 0 }}>
        {(["workspace", "architecture"] as const).map((item) => {
          const selected = area === item;
          const label = item === "workspace" ? "Connections & activity" : "Architecture & tools";
          return (
            <button
              key={item}
              type="button"
              aria-pressed={selected}
              onClick={() => { setArea(item); onAreaChange?.(item); }}
              style={{ border: `1px solid ${selected ? "#5b5bd6" : LINE}`, borderRadius: 8, padding: "6px 10px", background: selected ? "#f0efff" : CANVAS, color: selected ? "#4b4bb7" : SLATE, font: "600 11px -apple-system, BlinkMacSystemFont, sans-serif", cursor: "pointer" }}
            >
              {label}
            </button>
          );
        })}
        <div data-testid="blanko-workspace-breadcrumb" aria-live="polite" style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: SLATE }}>{area === "workspace" ? crumb : "Architecture & tools · Repository insights"}</div>
      </div>
      {/* Keep the legacy ops test id while old clients/specs transition to Workspace. */}
      <div data-testid="blanko-ops-dock" style={{ display: "none" }} aria-hidden />
      {area === "workspace" ? <div style={{ flex: 1, minHeight: 0 }}>
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
      </div> : null}
      {area === "architecture" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <AgentsDock
            graph={graph}
            agents={agents}
            initialTab={initialAgentTab}
            workspaceId={workspaceId}
            accessToken={accessToken}
            apiBase={apiBase}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSelectNode={onSelectNode}
          />
        </div>
      ) : null}
    </div>
  );
}
