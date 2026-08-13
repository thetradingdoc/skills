export { ScenePanel } from "./ScenePanel";
export { DockRail } from "./DockRail";
export { DockFrame } from "./DockFrame";
export { DockTabShell } from "./DockTabShell";
export { BuildPanel } from "./BuildPanel";
export { InsightsPanel } from "./InsightsPanel";
export { TasksDock } from "./TasksDock";
export { AgentsDock } from "./AgentsDock";
export { WorkspaceDock } from "./WorkspaceDock";
export { OpsDock } from "./OpsDock";
export { CodeDock } from "./CodeDock";
export { ViewDock } from "./ViewDock";
export { EvidencePanel } from "./EvidencePanel";
export { ChatBar } from "./ChatBar";
export { ChromeBar } from "./ChromeBar";
export type { CanvasInteractionMode } from "./ChromeBar";
export { StatusBar } from "./StatusBar";
export { EdgeTeachStrip } from "./EdgeTeachStrip";
export { ViewShell } from "./ViewShell";
export type {
  DockMode,
  EvidenceTab,
  OverflowView,
  AgentsDockTab,
  WorkspaceDockTab,
  CodeDockTab,
} from "./types";
export type { LeftRailTab, LeftExploreSection } from "./ScenePanel";
export { DOCK_MODES, OVERFLOW_VIEWS, CONFIG_SECTIONS, normalizeDockMode } from "./types";
export {
  isWideDockMode,
  canMaximizeDockMode,
  nextDockEscAction,
  clampDockWidth,
  defaultDockWidthForMode,
  DOCK_NARROW_DEFAULT,
  DOCK_WIDE_DEFAULT,
  DOCK_NARROW_MIN,
  DOCK_NARROW_MAX,
  DOCK_WIDE_MIN,
  DOCK_WIDE_MAX,
} from "./dockLayout";
export { getBuildItem, recommendForSelection, allBuildItems } from "./buildCatalog";
