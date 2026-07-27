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

export function agentReachesSensitive(agent: AgentLike): boolean {
  for (const t of agent.tools ?? []) {
    if (t.name === "(hosted)") continue;
    const p = t.reach?.cells?.patient?.state;
    const m = t.reach?.cells?.money?.state;
    if (p === "reaches" || m === "reaches") return true;
  }
  return false;
}

export function buildScorecard(
  model: ReferenceModelDoc,
  agent: AgentLike
): Scorecard {
  const sensitive = agentReachesSensitive(agent);
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
  const calibration = sensitive
    ? "This agent reaches patient records and/or payment rails, so observability, evaluation and safety are treated as essential where the reference model marks them so."
    : "This agent has no high-sensitivity patient/money reach in the current scan, so the milder (whenNotSensitive) requirement tiers apply.";

  return {
    sensitive,
    calibration,
    passCount,
    total: rows.length,
    rows,
  };
}
