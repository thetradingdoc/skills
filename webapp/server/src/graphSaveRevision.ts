/**
 * Pure revision gate for POST /workspaces/:id/save — unit-tested without DB.
 */
export function checkSaveRevision(
  storedRevision: number,
  baseRevision: number | null
): { ok: true } | { ok: false; currentRevision: number } {
  if (baseRevision !== null && baseRevision !== storedRevision) {
    return { ok: false, currentRevision: storedRevision };
  }
  return { ok: true };
}

export function nextGraphRevision(
  graphRevision: unknown,
  storedRevision: number
): number {
  return typeof graphRevision === "number" ? graphRevision : storedRevision + 1;
}

export function storedRevisionFromGraph(graph: Record<string, unknown> | null): number {
  return typeof graph?.revision === "number" ? (graph.revision as number) : 0;
}
