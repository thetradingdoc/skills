/**
 * blanko control panel — canvas-first overlays.
 * Wall: Components · Insights · Terminal (+ Config).
 * Node context lives inside Insights (not a separate Inspect wall tab).
 * `inspect` kept for legacy callers — mapped to insights in App.
 */
export type DockMode = "inspect" | "insights" | "build" | "terminal" | "evidence";

export type EvidenceTab = "files" | "terminal";

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
  /** @deprecated kept for callers; not shown in Config. */
  | "standard"
  | "devops";

/** Primary right-wall modes (control panel). */
export const DOCK_MODES: { id: DockMode; label: string; title: string }[] = [
  { id: "build", label: "Components", title: "Place agent pieces on the canvas" },
  { id: "insights", label: "Insights", title: "Where the agent system is broken" },
  { id: "terminal", label: "Terminal", title: "Shell for this workspace" },
];

export type ConfigSection = {
  title: string;
  items: { id: OverflowView; label: string }[];
};

/** Config menu — Review detail pages, Workspace sheets, View. */
export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    title: "Review",
    items: [
      { id: "assessment", label: "Review" },
      { id: "agents", label: "Agents" },
      { id: "layers", label: "Layers" },
      { id: "reach", label: "Reach" },
      { id: "flow", label: "Flow" },
      { id: "usage", label: "Usage" },
      { id: "guard", label: "Guard" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { id: "files", label: "Files" },
      { id: "platforms", label: "Platforms" },
      { id: "rollup", label: "Rollup" },
      { id: "changes", label: "Changes" },
    ],
  },
  {
    title: "View",
    items: [
      { id: "3d", label: "3D" },
      { id: "canvas", label: "Canvas" },
    ],
  },
];

/** Flat list for tests / legacy imports. */
export const OVERFLOW_VIEWS: { id: OverflowView; label: string }[] = CONFIG_SECTIONS.flatMap((s) => s.items);
