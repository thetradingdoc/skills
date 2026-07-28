/**
 * Standard scorecard — entirely driven by reference-model.json tiers
 * against per-agent layer detection status.
 */

export type LayerStatus = "filled" | "thin" | "empty" | "unsearched";
export type RequirementTier = "essential" | "expected" | "optional";

export type ReferenceLayerSpec = {
  id: string;
  name: string;
  question: string;
  whatFillsIt: string;
  whyItMatters: string;
  requirement: {
    whenSensitive: RequirementTier;
    whenNotSensitive: RequirementTier;
  };
};

export type ReferenceModelDoc = {
  version?: number;
  description?: string;
  layers: ReferenceLayerSpec[];
};

export type AgentLayerLike = {
  id: string;
  status: LayerStatus;
  components?: unknown[];
  emptyReason?: string;
};

export type AgentLike = {
  file: string;
  tools?: Array<{
    name?: string;
    reach?: {
      cells?: Record<string, { state?: string } | undefined>;
    };
  }>;
  layers?: AgentLayerLike[];
};

export type ScorecardRow = {
  id: string;
  name: string;
  question: string;
  whatFillsIt: string;
  whyItMatters: string;
  tier: RequirementTier;
  status: LayerStatus;
  componentCount: number;
  emptyReason?: string;
  pass: boolean;
};

export type Scorecard = {
  sensitive: boolean;
  verdict: SensitivityVerdict;
  calibration: string;
  passCount: number;
  total: number;
  rows: ScorecardRow[];
};

/** unsearched never passes. */
export function meetsRequirement(
  status: LayerStatus,
  tier: RequirementTier
): boolean {
  if (status === "unsearched") return false;
  if (tier === "essential") return status === "filled";
  if (tier === "expected") return status === "filled" || status === "thin";
  // optional: empty/thin/filled all meet the bar
  return status === "filled" || status === "thin" || status === "empty";
}

export type SensitivityVerdict = "sensitive" | "clear" | "unknown";

/**
 * Three answers, not two. A tracer that could not resolve an agent's reach has
 * not established that the agent is safe — and an unknown must never earn the
 * mild requirement tier, or a gap in tracing silently lowers the bar.
 */
export function agentSensitivity(agent: AgentLike): SensitivityVerdict {
  const tools = (agent.tools ?? []).filter((t) => t.name !== "(hosted)");
  let untraced = 0;
  let cells = 0;
  for (const t of tools) {
    const c = t.reach?.cells ?? {};
    for (const k of ["patient", "money", "external", "internal"]) {
      const st = (c as any)[k]?.state;
      if (!st) continue;
      cells++;
      if (st === "reaches" && (k === "patient" || k === "money")) return "sensitive";
      if (st === "not-traced") untraced++;
    }
  }
  if (tools.length === 0) return "unknown";
  if (cells === 0) return "unknown";
  // A quarter of the scope unresolved is too much to call an agent clear.
  if (untraced / cells > 0.25) return "unknown";
  return "clear";
}

/** @deprecated prefer agentSensitivity — this collapses clear and unknown. */
export function agentReachesSensitive(agent: AgentLike): boolean {
  return agentSensitivity(agent) === "sensitive";
}

export function buildScorecard(
  model: ReferenceModelDoc,
  agent: AgentLike
): Scorecard {
  const verdict = agentSensitivity(agent);
  const sensitive = verdict !== "clear"; // unknown takes the strict tier
  const layerById = new Map((agent.layers ?? []).map((l) => [l.id, l]));

  const rows: ScorecardRow[] = (model.layers ?? []).map((spec) => {
    const detected = layerById.get(spec.id);
    const status: LayerStatus = detected?.status ?? "unsearched";
    const tier = sensitive
      ? spec.requirement.whenSensitive
      : spec.requirement.whenNotSensitive;
    return {
      id: spec.id,
      name: spec.name,
      question: spec.question,
      whatFillsIt: spec.whatFillsIt,
      whyItMatters: spec.whyItMatters,
      tier,
      status,
      componentCount: detected?.components?.length ?? 0,
      emptyReason: detected?.emptyReason,
      pass: meetsRequirement(status, tier),
    };
  });

  const passCount = rows.filter((r) => r.pass).length;
  const calibration =
    verdict === "sensitive"
      ? "This agent reaches patient records and/or payment rails, so observability, evaluation and safety are treated as essential where the reference model marks them so."
      : verdict === "unknown"
        ? "Reach could not be established for this agent - too much of its tool surface is untraced to call it clear. The strict requirement tiers apply: an untraced agent does not earn an easier bar."
        : "Reach was traced and this agent touches no patient records or payment rails, so the milder requirement tiers apply.";

  return {
    sensitive,
    verdict,
    calibration,
    passCount,
    total: rows.length,
    rows,
  };
}
