import type { Rail, RailId, RailOverlap, RailRegistry } from "../types";

export function checkRailCollisions(
  rail: Rail,
  registry: RailRegistry,
  loadRail: (id: RailId) => Rail | null
): RailOverlap[] {
  const overlaps: RailOverlap[] = [];

  const siblingIds = new Set<RailId>();

  for (const key of rail.jiraKeys) {
    for (const id of registry.index.byJira[key] ?? []) {
      if (id !== rail.id) siblingIds.add(id);
    }
  }

  for (const step of rail.logicPath) {
    for (const id of registry.index.byNode[step.nodeId] ?? []) {
      if (id !== rail.id) siblingIds.add(id);
    }
  }

  for (const otherId of siblingIds) {
    const other = loadRail(otherId);
    if (!other) continue;
    const sharedJira = rail.jiraKeys.filter((k) => other.jiraKeys.includes(k));
    const sharedNodes = rail.logicPath
      .map((s) => s.nodeId)
      .filter((id) => other.logicPath.some((o) => o.nodeId === id));
    if (sharedJira.length === 0 && sharedNodes.length === 0) continue;
    overlaps.push({
      railId: other.id,
      sharedJira,
      sharedNodes,
      flaggedBy: "reviewer",
      flaggedAt: Date.now(),
      suggestion:
        "Multiple rails touch the same Jira issues or modules. Consider consolidating ownership or splitting scope.",
    });
  }

  return overlaps;
}

