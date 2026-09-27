/**
 * Blanko dock types — canvas-first right wall.
 * Shell IA: Agents (inventory + Files/Terminal) | System (Platforms + Path + Rollup + Changes).
 */
export type DockMode =
  | "inspect"
  | "insights"
  /** @deprecated mapped to work */
  | "tasks"
  | "build"
  | "agents"
  /** System — Platforms + Path + Rollup + Changes */
  | "workspace"
  /** Tasks board (display label "Tasks"; id stays "work") */
  | "work"
  /** @deprecated mapped to workspace (System · Rollup) */
  | "ops"
  /** @deprecated mapped to agents (Agents · Files) */
  | "code"
  /** Display label "Canvas" (2D/3D); id stays "view" */
  | "view"
  | "harness"
  /** @deprecated mapped to agents · terminal */
  | "terminal"
  /** @deprecated mapped to agents · files */
  | "evidence";

export type EvidenceTab = "files" | "terminal";

export type AgentsDockTab =
  | "inventory"
  | "layers"
  | "reach"
  | "assessment"
  | "usage"
  | "guard"
  | "files"
  | "terminal";

/** System dock tabs — Platforms, Path, Rollup, Changes. */
export type WorkspaceDockTab =
  | "platforms"
  | "path"
  | "rollup"
  | "changes"
  /** @deprecated Tasks is DockMode "work" */
  | "work"
  /** @deprecated use path */
  | "flow"
  /** @deprecated use rollup */
  | "ops";

export type CodeDockTab = "files" | "terminal";

export type ViewDockTab = "canvas" | "3d";

/** @deprecated OverflowView kept for legacy App full-page routes / tests. */
export type OverflowView =
  | "assessment"
  | "agents"
  | "reach"
  | "flow"
  | "layers"
  | "guard"
  | "changes"
  | "rollup"
  | "platforms"
  | "usage"
  | "3d"
  | "files"
  | "canvas"
  | "standard"
  | "devops";

/**
 * Primary right-wall modes. Repository architecture and System views share Workspace.
 */
export const DOCK_MODES: { id: DockMode; label: string; title: string }[] = [
  { id: "harness", label: "Harness", title: "Build, configure, and run an agent" },
  { id: "build", label: "Components", title: "Place agent pieces on the canvas" },
  {
    id: "workspace",
    label: "Workspace",
    title: "Repository architecture, connections, workflow, and activity",
  },
  { id: "work", label: "Tasks", title: "Tasks board — Up next · In progress · Review" },
  { id: "view", label: "Canvas", title: "2D or 3D canvas (chrome View/Edit is pan vs edit)" },
  { id: "insights", label: "Insights", title: "Findings and next actions for the selected architecture" },
];

/** @deprecated Config sections removed from rail; kept empty for import safety. */
export type ConfigSection = {
  title: string;
  items: { id: OverflowView; label: string }[];
};

export const CONFIG_SECTIONS: ConfigSection[] = [];

export const OVERFLOW_VIEWS: { id: OverflowView; label: string }[] = [
  { id: "assessment", label: "Review" },
  { id: "agents", label: "Agents" },
  { id: "layers", label: "Agent Layers" },
  { id: "reach", label: "Reach" },
  { id: "flow", label: "Path" },
  { id: "usage", label: "Usage" },
  { id: "guard", label: "Guard" },
  { id: "files", label: "Files" },
  { id: "platforms", label: "Platforms" },
  { id: "rollup", label: "Rollup" },
  { id: "changes", label: "Changes" },
  { id: "3d", label: "3D" },
  { id: "canvas", label: "Canvas" },
];

export function normalizeDockMode(mode: DockMode | null): DockMode | null {
  if (mode === "inspect") return "insights";
  if (mode === "tasks") return "work";
  if (mode === "agents" || mode === "terminal" || mode === "evidence" || mode === "code") return "workspace";
  if (mode === "ops") return "workspace";
  return mode;
}

/** System dock — coerce deprecated aliases; keep rollup/changes. */
export function normalizeWorkspaceDockTab(tab: WorkspaceDockTab | undefined): WorkspaceDockTab {
  if (!tab || tab === "flow" || tab === "work") return "path";
  if (tab === "ops") return "rollup";
  if (tab === "platforms" || tab === "path" || tab === "rollup" || tab === "changes") return tab;
  return "platforms";
}

/** Agents dock — map legacy code dock tabs. */
export function normalizeAgentsDockTab(tab: AgentsDockTab | undefined): AgentsDockTab {
  if (!tab) return "inventory";
  return tab;
}
