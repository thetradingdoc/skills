/**
 * System-level architecture.layers.json — detected (not hand-written).
 *
 * Combines per-agent layer results into one rollup, marks modules that are
 * built but unreachable from any agent ingress, and merges human applicability
 * declarations from architecture.layers.apply.json beside the repo.
 */
import * as fs from "fs";
import * as path from "path";
import type { AgentSurface } from "./agent-inventory";
import {
  buildRepoGraph,
  loadReferenceModel,
  type AgentLayerResult,
  type LayerId,
  type RepoGraph,
} from "./agent-layers";

export type LayerState = "working" | "built_unconnected" | "absent" | "not_applicable";

export type LayerEvidenceItem = {
  what: string;
  where?: string;
  why?: string;
  source?: "detected" | "declared";
};

export type SystemLayerAssessment = {
  id: string;
  name: string;
  complete_means: string;
  state: LayerState;
  summary: string;
  scope: "agent" | "system";
  /** Raw detector outcome before applicability override. */
  detected: {
    state: Exclude<LayerState, "not_applicable">;
    statusRollup: "filled" | "thin" | "empty" | "unsearched" | "mixed";
    agentHits: number;
    agentMisses: number;
  };
  /** Human override when present. */
  declared: { state: "not_applicable" | LayerState; reason?: string } | null;
  working?: LayerEvidenceItem[];
  unconnected?: LayerEvidenceItem[];
  absent?: LayerEvidenceItem[];
  measured?: string;
};

export type UnconnectedModule = {
  file: string;
  imports: string[];
  reason: string;
};

export type ArchitectureLayersDoc = {
  version: number;
  generated_at: string;
  source: "detected";
  projectRoot?: string;
  layers: SystemLayerAssessment[];
  unconnected_modules: UnconnectedModule[];
};

export type ApplicabilityDoc = {
  version: number;
  /** layer id → declaration */
  layers: Record<
    string,
    {
      state: "not_applicable" | "working" | "built_unconnected" | "absent";
      reason?: string;
      updated_at?: string;
      updated_by?: string;
    }
  >;
};

const CAPABILITY_FILE_RE =
  /(vector-retriever|retriever|langsmith|opentelemetry|otel|observability|tracer|pinecone|weaviate|chroma|qdrant|eval-engine|evaluate-accuracy|moderation|guardrail|pii-redactor)/i;

const ENTRY_HINT_RE =
  /(index|main|server|app|cli|bin\/|scripts\/|webhook|handler|route|ingress)/i;

function readJsonSafe<T>(abs: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadApplicability(repoRoot: string): ApplicabilityDoc {
  const abs = path.join(repoRoot, "architecture.layers.apply.json");
  const raw = readJsonSafe<ApplicabilityDoc>(abs);
  if (!raw || typeof raw !== "object") return { version: 1, layers: {} };
  return {
    version: raw.version ?? 1,
    layers: raw.layers && typeof raw.layers === "object" ? raw.layers : {},
  };
}

export function saveApplicability(repoRoot: string, doc: ApplicabilityDoc): void {
  const abs = path.join(repoRoot, "architecture.layers.apply.json");
  fs.writeFileSync(abs, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

/**
 * Files that look like capability modules, import real deps, and have zero
 * callers anywhere in the repo (nothing reaches them).
 */
export function detectBuiltUnconnected(
  repoRoot: string,
  graph: RepoGraph = buildRepoGraph(repoRoot)
): UnconnectedModule[] {
  const out: UnconnectedModule[] = [];
  for (const [rel, abs] of graph.byRel) {
    if (!CAPABILITY_FILE_RE.test(rel)) continue;
    if (/node_modules|\.test\.|\.spec\.|__tests__|\.d\.ts$/i.test(rel)) continue;
    const callers = graph.callersOf.get(rel);
    if (callers && callers.size > 0) continue;

    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8").slice(0, 120_000);
    } catch {
      continue;
    }
    const imports: string[] = [];
    const re = /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const spec = (m[1] ?? m[2] ?? "").trim();
      if (spec) imports.push(spec);
    }
    // Must import something — otherwise it isn't "built and wired to deps"
    if (imports.length === 0) continue;
    // Skip obvious entrypoints that may be started externally
    if (ENTRY_HINT_RE.test(path.basename(rel)) && imports.some((i) => !i.startsWith("."))) {
      continue;
    }
    out.push({
      file: rel,
      imports: imports.slice(0, 8),
      reason: "Imports dependencies but nothing in the repo requires this file.",
    });
  }
  return out.slice(0, 40);
}

function rollupStatus(
  layers: AgentLayerResult[]
): SystemLayerAssessment["detected"]["statusRollup"] {
  if (layers.length === 0) return "empty";
  const statuses = new Set(layers.map((l) => l.status));
  if (statuses.size === 1) return [...statuses][0]!;
  if (statuses.has("filled") || statuses.has("thin")) {
    if (statuses.has("empty") || statuses.has("unsearched")) return "mixed";
    return statuses.has("filled") ? "filled" : "thin";
  }
  if (statuses.has("unsearched") && statuses.has("empty")) return "mixed";
  return statuses.has("unsearched") ? "unsearched" : "empty";
}

function detectedStateFromRollup(
  rollup: SystemLayerAssessment["detected"]["statusRollup"],
  unconnectedForLayer: LayerEvidenceItem[]
): Exclude<LayerState, "not_applicable"> {
  // mixed = some agents filled/thin and some empty — the layer exists on the system
  if (rollup === "filled" || rollup === "thin" || rollup === "mixed") return "working";
  if (unconnectedForLayer.length > 0) return "built_unconnected";
  return "absent";
}

/**
 * Build the system-level architecture.layers.json document from agent inventory.
 */
export function buildArchitectureLayersDoc(
  repoRoot: string,
  agents: AgentSurface[],
  productRoot: string
): ArchitectureLayersDoc {
  const model = loadReferenceModel(productRoot);
  const graph = buildRepoGraph(repoRoot);
  const unconnected = detectBuiltUnconnected(repoRoot, graph);
  const apply = loadApplicability(repoRoot);

  const agentLayers = agents.filter((a) => a.kind === "agent" && Array.isArray((a as any).layers));

  const layers: SystemLayerAssessment[] = model.layers.map((spec) => {
    const perAgent = agentLayers
      .map((a) => ((a as any).layers as AgentLayerResult[]).find((l) => l.id === spec.id))
      .filter(Boolean) as AgentLayerResult[];

    const working: LayerEvidenceItem[] = [];
    const absentHints: LayerEvidenceItem[] = [];
    for (const a of agentLayers) {
      const layer = ((a as any).layers as AgentLayerResult[]).find((l) => l.id === spec.id);
      if (!layer) continue;
      if (layer.status === "filled" || layer.status === "thin") {
        for (const c of layer.components.slice(0, 4)) {
          working.push({
            what: c.label,
            where: a.file,
            why: c.evidence,
            source: "detected",
          });
        }
      } else if (layer.status === "empty" && layer.emptyReason) {
        absentHints.push({
          what: `No ${spec.name.toLowerCase()} on ${path.basename(a.file)}`,
          where: a.file,
          why: layer.emptyReason,
          source: "detected",
        });
      }
    }

    const unconnectedForLayer: LayerEvidenceItem[] = unconnected
      .filter((u) => {
        // Map unconnected modules loosely onto layer ids by filename cues
        if (spec.id === "knowledge") return /vector|retriev|rag|pinecone|weaviate|chroma|qdrant/i.test(u.file);
        if (spec.id === "observability") return /langsmith|otel|opentelemetry|observability|tracer/i.test(u.file);
        if (spec.id === "evaluation") return /eval/i.test(u.file);
        if (spec.id === "safety") return /moderat|guardrail|pii|redact/i.test(u.file);
        if (spec.id === "memory") return /memory|session|history/i.test(u.file);
        return false;
      })
      .map((u) => ({
        what: path.basename(u.file),
        where: u.file,
        why: u.reason,
        source: "detected" as const,
      }));

    const statusRollup = rollupStatus(perAgent);
    const hits = perAgent.filter((l) => l.status === "filled" || l.status === "thin").length;
    const misses = perAgent.filter((l) => l.status === "empty").length;
    const detectedState = detectedStateFromRollup(statusRollup, unconnectedForLayer);

    const declaredRaw = apply.layers[spec.id] ?? null;
    const declared = declaredRaw
      ? { state: declaredRaw.state, reason: declaredRaw.reason }
      : null;

    let state: LayerState = detectedState;
    let summary = "";
    if (declared?.state === "not_applicable") {
      state = "not_applicable";
      summary = declared.reason || `${spec.name} marked not applicable for this system.`;
    } else if (declared && declared.state !== detectedState) {
      state = declared.state;
      summary =
        (declared.reason || `Declared ${declared.state}`) +
        ` (detector saw ${detectedState}).`;
    } else if (detectedState === "working") {
      summary = `${hits} agent path${hits === 1 ? "" : "s"} show ${spec.name.toLowerCase()}.`;
    } else if (detectedState === "built_unconnected") {
      summary = `${spec.name} modules exist but nothing on an agent path reaches them.`;
    } else {
      summary =
        misses > 0
          ? `${spec.name} empty on ${misses} agent path${misses === 1 ? "" : "s"}.`
          : `No ${spec.name.toLowerCase()} detected on agent paths.`;
    }

    const scope =
      spec.id === "safety" || spec.id === "observability" ? ("agent" as const) : ("system" as const);

    return {
      id: spec.id,
      name: spec.name,
      complete_means: spec.whatFillsIt,
      state,
      summary,
      scope,
      detected: {
        state: detectedState,
        statusRollup,
        agentHits: hits,
        agentMisses: misses,
      },
      declared,
      working: working.slice(0, 12),
      unconnected: unconnectedForLayer.slice(0, 8),
      absent: state === "absent" ? absentHints.slice(0, 8) : undefined,
      measured: `detected ${detectedState}; ${hits} hit / ${misses} miss across ${agentLayers.length} agents`,
    };
  });

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source: "detected",
    projectRoot: repoRoot,
    layers,
    unconnected_modules: unconnected,
  };
}

export function writeArchitectureLayersDoc(repoRoot: string, doc: ArchitectureLayersDoc): void {
  const abs = path.join(repoRoot, "architecture.layers.json");
  const { projectRoot: _drop, ...rest } = doc;
  fs.writeFileSync(abs, JSON.stringify(rest, null, 2) + "\n", "utf8");
}

/** Pure helpers exported for unit tests. */
export function _testDetectState(
  rollup: SystemLayerAssessment["detected"]["statusRollup"],
  unconnectedCount: number
): Exclude<LayerState, "not_applicable"> {
  return detectedStateFromRollup(
    rollup,
    unconnectedCount > 0
      ? [{ what: "x", source: "detected" }]
      : []
  );
}
