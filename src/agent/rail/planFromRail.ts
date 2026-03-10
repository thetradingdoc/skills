import type { AgentPlan, AgentPlanTask, Rail } from "../types";
import type { NodeLayer, ArchGraph } from "../../types";

export function buildPlanFromRail(rail: Rail, graph?: ArchGraph | null): AgentPlan {
  const codeTasks = (rail.tasks ?? []).filter(
    (t) => t.kind === "code_change" && t.autoCapable !== false
  );

  if (codeTasks.length === 0) {
    throw new Error("Rail has no auto-capable code_change tasks to plan.");
  }

  const tasks: AgentPlanTask[] = codeTasks.map((t, index) => {
    const pathEntry = rail.logicPath.find((s) => s.step === t.logicStep) ?? rail.logicPath[index];
    const layer = (pathEntry?.layer as NodeLayer | undefined) ?? ("Business Logic" as NodeLayer);
    let module = pathEntry?.filePath ?? pathEntry?.nodeId ?? "";
    // Best-effort: if graph carries files on nodes, prefer that mapping.
    if (graph && pathEntry?.nodeId && Array.isArray((graph as any).nodes)) {
      const node = (graph as any).nodes.find(
        (n: any) => typeof n?.id === "string" && n.id === pathEntry.nodeId
      ) as { files?: string[] } | undefined;
      const files = Array.isArray(node?.files) ? node!.files! : [];
      if (files.length > 0) {
        module = files[0]!;
      }
    }
    const expectedOutput = t.description;
    const successChecks =
      rail.logicPath.length > 0
        ? ([
            { kind: "staging_write", required: true } as const,
          ] as AgentPlanTask["successChecks"])
        : undefined;
    const action: AgentPlanTask["action"] =
      module && module.includes("new/") ? "create" : "refactor";

    return {
      id: t.id,
      module,
      layer,
      action,
      expectedOutput,
      successChecks,
      proposedFiles: undefined,
    };
  });

  // Conservative: keep declared order but avoid forcing a chain when logicStep is the same.
  const dependencies: Array<[string, string]> = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    const a = codeTasks[i]!;
    const b = codeTasks[i + 1]!;
    if (a.logicStep !== b.logicStep) {
      dependencies.push([tasks[i]!.id, tasks[i + 1]!.id]);
    }
  }

  return {
    goal: rail.outcome,
    tasks,
    dependencies,
  };
}

