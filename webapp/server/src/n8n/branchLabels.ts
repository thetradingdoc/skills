/**
 * Derive human branch labels from n8n connection output indexes.
 * if → true/false, switch → named rules, splitInBatches → loop/done, error → error.
 */

export type BranchLabelContext = {
  sourceType: string;
  /** Output group name from connections, usually "main" or "error". */
  outputGroup: string;
  /** Index within that output group array. */
  outputIndex: number;
  /** Optional switch node rules from parameters.rules.values[].outputKey / renameOutput */
  switchOutputs?: string[];
};

function short(t: string): string {
  return t.replace(/^n8n-nodes-base\./, "").replace(/^@n8n\/n8n-nodes-langchain\./, "");
}

export function deriveBranchLabel(ctx: BranchLabelContext): string | undefined {
  const group = ctx.outputGroup || "main";
  if (group === "error") return "error";

  const st = short(ctx.sourceType).toLowerCase();
  const idx = ctx.outputIndex;

  if (st === "if") {
    return idx === 0 ? "true" : idx === 1 ? "false" : `out-${idx}`;
  }

  if (st === "switch") {
    if (ctx.switchOutputs && ctx.switchOutputs[idx]) return ctx.switchOutputs[idx]!;
    return idx === 0 ? "default" : `rule-${idx}`;
  }

  if (st === "splitinbatches") {
    // n8n: output 0 = loop body, output 1 = done
    return idx === 0 ? "loop" : idx === 1 ? "done" : `out-${idx}`;
  }

  if (st === "filter") {
    return idx === 0 ? "kept" : idx === 1 ? "discarded" : `out-${idx}`;
  }

  // Multi-output without a known schema — only label when not the sole/zeroth output
  if (idx > 0) return `out-${idx}`;
  return undefined;
}

/** Extract switch output labels from node parameters when present. */
export function switchOutputLabels(parameters: unknown): string[] | undefined {
  if (!parameters || typeof parameters !== "object") return undefined;
  const p = parameters as Record<string, unknown>;
  const rules = p.rules as { values?: Array<{ outputKey?: string; renameOutput?: string }> } | undefined;
  if (rules?.values && Array.isArray(rules.values)) {
    return rules.values.map((v, i) => v.outputKey || v.renameOutput || `rule-${i}`);
  }
  // Older switch shape
  if (Array.isArray(p.outputs)) {
    return (p.outputs as unknown[]).map((o, i) =>
      typeof o === "string" ? o : `rule-${i}`
    );
  }
  return undefined;
}
