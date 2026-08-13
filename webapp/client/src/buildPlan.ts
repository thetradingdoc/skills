/**
 * P1 assisted design loop — workstream D: build plan.
 *
 * Pure module: no React, no network. Turns a design ArchGraph into an
 * ordered list of build steps (dependencies first) so a non-expert has a
 * concrete "build this, then this" sequence instead of a blank canvas.
 */
import type { ArchGraph } from "./types";

export interface PlanStep {
  id: string;
  nodeId: string;
  label: string;
  reason: string;
  /** Step ids (not node ids) that must come before this step. */
  dependsOn: string[];
}

function stepIdFor(nodeId: string): string {
  return `step-${nodeId}`;
}

/**
 * Topologically order nodes so that anything a node depends on (the target
 * of a `calls`/`reads`/`writes`/… edge) is built before it. Cycles are
 * broken by falling back to graph order for whatever's left once no more
 * progress can be made — a design in progress is allowed to have a cycle,
 * it just can't be perfectly ordered.
 */
export function planFromGraph(graph: ArchGraph): PlanStep[] {
  const nodes = graph.nodes;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const dependsOn = new Map<string, Set<string>>();
  for (const n of nodes) dependsOn.set(n.id, new Set());
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    dependsOn.get(e.source)!.add(e.target);
  }

  const steps: PlanStep[] = [];
  const remaining = new Set(nodes.map((n) => n.id));

  let progress = true;
  while (remaining.size > 0 && progress) {
    progress = false;
    for (const n of nodes) {
      if (!remaining.has(n.id)) continue;
      const deps = dependsOn.get(n.id)!;
      const unmetDeps = [...deps].filter((d) => remaining.has(d));
      if (unmetDeps.length > 0) continue;

      steps.push({
        id: stepIdFor(n.id),
        nodeId: n.id,
        label: n.label,
        reason:
          deps.size === 0
            ? "No dependencies — safe to build first."
            : `Depends on ${[...deps].map((d) => nodeById.get(d)?.label ?? d).join(", ")}.`,
        dependsOn: [...deps].map(stepIdFor),
      });
      remaining.delete(n.id);
      progress = true;
    }
  }

  // Anything left is part of a cycle — append in graph order rather than
  // looping forever, but only reference dependencies that already have a
  // scheduled step so dependsOn never points at a step that doesn't exist.
  if (remaining.size > 0) {
    const scheduledNodeIds = new Set(steps.map((s) => s.nodeId));
    for (const n of nodes) {
      if (!remaining.has(n.id)) continue;
      const deps = [...dependsOn.get(n.id)!].filter((d) => scheduledNodeIds.has(d) || remaining.has(d));
      steps.push({
        id: stepIdFor(n.id),
        nodeId: n.id,
        label: n.label,
        reason: "Part of a circular dependency group — build alongside its connected pieces.",
        dependsOn: deps.filter((d) => scheduledNodeIds.has(d)).map(stepIdFor),
      });
      scheduledNodeIds.add(n.id);
      remaining.delete(n.id);
    }
  }

  return steps;
}

/** First step whose node isn't marked "built" yet, in plan order. */
export function nextStep(plan: PlanStep[], graph: ArchGraph): PlanStep | null {
  const statusByNode = new Map(graph.nodes.map((n) => [n.id, n.buildStatus ?? "planned"]));
  for (const step of plan) {
    if ((statusByNode.get(step.nodeId) ?? "planned") !== "built") return step;
  }
  return null;
}
