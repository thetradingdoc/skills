/**
 * Code dock — Files | Terminal (replaces evidence + terminal wall modes).
 */
import { useEffect, useState } from "react";
import type { ArchGraph } from "../types";
import { FileBrowser } from "../FileBrowser";
import { TerminalPanel } from "../TerminalPanel";
import { DockTabShell } from "./DockTabShell";
import type { CodeDockTab } from "./types";
import { FONT_UI } from "../theme/tokens";

const TABS: { id: CodeDockTab; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "terminal", label: "Terminal" },
];

type Props = {
  graph: ArchGraph;
  initialTab?: CodeDockTab;
  openPath?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  onOpenFile?: (path: string, line?: number) => void;
};

export function CodeDock({
  graph,
  initialTab = "files",
  openPath,
  accessToken,
  apiBase = "/api",
  onOpenFile,
}: Props) {
  const [tab, setTab] = useState<CodeDockTab>(initialTab);
  const hasRoot = !!(graph.projectRoot && graph.projectRoot.trim());

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div data-testid="blanko-code-dock" style={{ height: "100%", fontFamily: FONT_UI }}>
      <DockTabShell
        tabs={TABS}
        active={tab}
        onChange={(id) => setTab(id as CodeDockTab)}
        emptyHint={
          !hasRoot
            ? "No project root yet — scan or clone a repo to browse files and use the terminal."
            : null
        }
      >
        {hasRoot && tab === "files" ? (
          <div style={{ padding: 8 }}>
            <FileBrowser
              graph={graph}
              openPath={openPath ?? undefined}
              onOpen={(path, line) => onOpenFile?.(path, line)}
            />
          </div>
        ) : null}
        {hasRoot && tab === "terminal" ? (
          <div style={{ height: "100%", minHeight: 280 }}>
            <TerminalPanel cwd={graph.projectRoot} accessToken={accessToken ?? null} apiBase={apiBase} />
          </div>
        ) : null}
      </DockTabShell>
    </div>
  );
}
