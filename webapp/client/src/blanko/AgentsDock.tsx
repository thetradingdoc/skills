/**
 * Agents dock — inventory / layers / reach / review / usage / guard / files / terminal.
 */
import { useEffect, useState } from "react";
import type { AgentInventoryResult, ArchGraph } from "../types";
import AgentsView from "../AgentsView";
import LayersView from "../LayersView";
import ReachView from "../ReachView";
import { AssessmentView } from "../AssessmentView";
import { UsageView } from "../UsageView";
import GuardView from "../GuardView";
import { FileBrowser } from "../FileBrowser";
import { TerminalPanel } from "../TerminalPanel";
import { DockTabShell } from "./DockTabShell";
import type { AgentsDockTab } from "./types";
import { FONT_UI, SLATE } from "../theme/tokens";

const TABS: { id: AgentsDockTab; label: string }[] = [
  { id: "inventory", label: "Inventory" },
  { id: "layers", label: "Layers" },
  { id: "reach", label: "Reach" },
  { id: "assessment", label: "Review" },
  { id: "usage", label: "Usage" },
  { id: "guard", label: "Guard" },
  { id: "files", label: "Files" },
  { id: "terminal", label: "Terminal" },
];

type Props = {
  graph: ArchGraph;
  agents?: AgentInventoryResult;
  initialTab?: AgentsDockTab;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  openPath?: string | null;
  onOpenFile?: (path: string, line?: number) => void;
  onSelectNode?: (nodeId: string) => void;
};

export function AgentsDock({
  graph,
  agents,
  initialTab = "inventory",
  workspaceId,
  accessToken,
  apiBase = "/api",
  openPath,
  onOpenFile,
  onSelectNode,
}: Props) {
  const [tab, setTab] = useState<AgentsDockTab>(initialTab);
  const [selectedAgentFile, setSelectedAgentFile] = useState<string | null>(null);
  const hasRoot = !!(graph.projectRoot && graph.projectRoot.trim());

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const inventory = agents ?? graph.agents;
  const emptyInventory = tab === "inventory" && !(inventory?.agents?.length);
  const emptyCode = (tab === "files" || tab === "terminal") && !hasRoot;

  return (
    <div data-testid="blanko-agents-dock" style={{ height: "100%", fontFamily: FONT_UI }}>
      <DockTabShell
        tabs={TABS}
        active={tab}
        onChange={(id) => setTab(id as AgentsDockTab)}
        emptyHint={
          emptyInventory
            ? "No agent inventory on this board yet — rescan a repo with agent SDKs, or open Insights for architecture checks."
            : null
        }
      >
        {tab === "inventory" && !emptyInventory ? (
          <AgentsView agents={inventory} onOpenFile={onOpenFile} />
        ) : null}
        {tab === "layers" ? (
          <LayersView
            agents={inventory}
            selectedAgentFile={selectedAgentFile}
            onSelectAgent={setSelectedAgentFile}
          />
        ) : null}
        {tab === "reach" ? <ReachView agents={inventory} /> : null}
        {tab === "assessment" ? (
          <AssessmentView
            graph={graph}
            apiBase={apiBase}
            accessToken={accessToken ?? null}
            workspaceId={workspaceId ?? null}
            onOpenFile={onOpenFile}
          />
        ) : null}
        {tab === "usage" ? (
          workspaceId && accessToken ? (
            <UsageView
              workspaceId={workspaceId}
              accessToken={accessToken}
              apiBase={apiBase}
              onSelectNode={onSelectNode}
            />
          ) : (
            <div style={{ padding: 14, fontSize: 12, color: SLATE }}>Sign in to see usage.</div>
          )
        ) : null}
        {tab === "guard" ? <GuardView agents={inventory} apiBase={apiBase} /> : null}
        {tab === "files" ? (
          <div data-testid="blanko-code-dock" style={{ padding: emptyCode ? 14 : 8 }}>
            {emptyCode ? (
              <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45 }}>
                No project root yet — scan or clone a repo to browse files and use the terminal.
              </div>
            ) : (
              <FileBrowser
                graph={graph}
                openPath={openPath ?? undefined}
                onOpen={(path, line) => onOpenFile?.(path, line)}
              />
            )}
          </div>
        ) : null}
        {tab === "terminal" ? (
          <div
            data-testid="blanko-code-dock"
            style={{ height: "100%", minHeight: 280, padding: emptyCode ? 14 : 0 }}
          >
            {emptyCode ? (
              <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45 }}>
                No project root yet — scan or clone a repo to browse files and use the terminal.
              </div>
            ) : (
              <TerminalPanel
                cwd={graph.projectRoot}
                accessToken={accessToken ?? null}
                apiBase={apiBase}
              />
            )}
          </div>
        ) : null}
      </DockTabShell>
    </div>
  );
}
