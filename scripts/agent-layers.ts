/**
 * Per-agent layer detection against reference-model.json.
 *
 * A component belongs to an agent's layer only if there is a path from
 * that agent to it (forward require closure + tool-handler reach, or
 * reverse callers into the agent for ingress). Shared repo files are
 * not attributed by name smear.
 */
import * as fs from "fs";
import * as path from "path";
import type { AgentSurface, AgentTool } from "./agent-inventory";
import { extractDatabaseModule, loadClassifyConfig, resourceRole } from "./resource-trace";

export type LayerId =
  | "ingress"
  | "context"
  | "reasoning"
  | "tools"
  | "memory"
  | "knowledge"
  | "data"
  | "safety"
  | "observability"
  | "evaluation"
  | "deployment";

export type LayerFill = "filled" | "thin" | "empty" | "unsearched";

export type LayerScope = "agent" | "system";

export type LayerComponent = {
  id: string;
  label: string;
  evidence: string;
  /** Sensitive reach mark for the canvas */
  sensitive?: "patient" | "money" | null;
};

export type AgentLayerResult = {
  id: LayerId;
  name: string;
  question: string;
  whyItMatters: string;
  whatFillsIt?: string;
  status: LayerFill;
  /**
   * agent = evidence is only from this agent's turn path.
   * system = evidence may include repo-wide signals (eval harnesses, deploy configs).
   */
  scope: LayerScope;
  /** empty = searched and found nothing; unsearched = could not search */
  emptyReason?: string;
  components: LayerComponent[];
};

export type ReferenceLayer = {
  id: LayerId;
  name: string;
  question: string;
  whatFillsIt: string;
  whyItMatters: string;
  requirement: {
    whenSensitive: "essential" | "expected" | "optional";
    whenNotSensitive: "essential" | "expected" | "optional";
  };
};

export type ReferenceModel = {
  version: number;
  description?: string;
  layers: ReferenceLayer[];
};

const LAYER_ORDER: LayerId[] = [
  "ingress",
  "context",
  "reasoning",
  "tools",
  "memory",
  "knowledge",
  "data",
  "safety",
  "observability",
  "evaluation",
  "deployment",
];

export function loadReferenceModel(productRoot: string): ReferenceModel {
  const p = path.join(productRoot, "reference-model.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as ReferenceModel;
}

function readSafe(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function walkFiles(root: string, maxFiles = 5000): string[] {
  const out: string[] = [];
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    "vendor",
  ]);
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (/\.(js|ts|mjs|cjs|jsx|tsx|yml|yaml|json)$/i.test(e.name)) {
        out.push(abs);
      }
    }
  }
  return out;
}

function resolveLocalRequire(
  fromAbs: string,
  spec: string,
  repoRoot: string
): string | null {
  if (!spec.startsWith(".")) return null;
  const dir = path.dirname(fromAbs);
  const candidates = [
    path.join(dir, spec),
    path.join(dir, spec + ".js"),
    path.join(dir, spec + ".ts"),
    path.join(dir, spec + ".mjs"),
    path.join(dir, spec + ".cjs"),
    path.join(dir, spec, "index.js"),
    path.join(dir, spec, "index.ts"),
  ];
  for (const abs of candidates) {
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        if (rel.startsWith("..")) return null;
        return abs;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

function extractLocalRequires(text: string): string[] {
  const out: string[] = [];
  const re =
    /require\s*\(\s*['"`](\.[^'"`]+)['"`]\s*\)|from\s+['"`](\.[^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1] || m[2]!);
  }
  return out;
}

export type RepoGraph = {
  files: string[];
  /** rel → abs */
  byRel: Map<string, string>;
  /** rel → files that require it (reverse edges) */
  callersOf: Map<string, Set<string>>;
  searchable: boolean;
};

let cachedGraph: { root: string; graph: RepoGraph } | null = null;

export function buildRepoGraph(repoRoot: string): RepoGraph {
  if (cachedGraph?.root === repoRoot) return cachedGraph.graph;
  const files = walkFiles(repoRoot);
  const byRel = new Map<string, string>();
  const callersOf = new Map<string, Set<string>>();
  let searchable = true;

  for (const abs of files) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    byRel.set(rel, abs);
  }

  for (const abs of files) {
    const fromRel = path.relative(repoRoot, abs).split(path.sep).join("/");
    const text = readSafe(abs);
    if (text == null) {
      searchable = false;
      continue;
    }
    if (text.length > 900_000) continue;
    for (const spec of extractLocalRequires(text)) {
      const toAbs = resolveLocalRequire(abs, spec, repoRoot);
      if (!toAbs) continue;
      const toRel = path.relative(repoRoot, toAbs).split(path.sep).join("/");
      let set = callersOf.get(toRel);
      if (!set) {
        set = new Set();
        callersOf.set(toRel, set);
      }
      set.add(fromRel);
    }
  }

  const graph: RepoGraph = { files, byRel, callersOf, searchable };
  cachedGraph = { root: repoRoot, graph };
  return graph;
}

export function clearLayerIndexCache(): void {
  cachedGraph = null;
  pathCache.clear();
}

/** Forward require closure from seed files (agent + tool handlers). */
function forwardClosure(
  repoRoot: string,
  graph: RepoGraph,
  seeds: string[],
  maxNodes = 400
): { reachable: Set<string>; ok: boolean } {
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const s of seeds) {
    const norm = s.split(path.sep).join("/");
    if (graph.byRel.has(norm)) {
      queue.push(norm);
      reachable.add(norm);
    } else if (fs.existsSync(path.join(repoRoot, norm))) {
      queue.push(norm);
      reachable.add(norm);
    }
  }
  if (queue.length === 0) return { reachable, ok: false };

  while (queue.length && reachable.size < maxNodes) {
    const rel = queue.shift()!;
    const abs = graph.byRel.get(rel) ?? path.join(repoRoot, rel);
    const text = readSafe(abs);
    if (text == null) continue;
    const slice = text.length > 400_000 ? text.slice(0, 400_000) : text;
    for (const spec of extractLocalRequires(slice)) {
      const toAbs = resolveLocalRequire(abs, spec, repoRoot);
      if (!toAbs) continue;
      const toRel = path.relative(repoRoot, toAbs).split(path.sep).join("/");
      if (reachable.has(toRel)) continue;
      reachable.add(toRel);
      queue.push(toRel);
    }
  }
  return { reachable, ok: true };
}

type AgentPath = {
  /** Require-closure from the agent entry file only (turn / I/O path). */
  agentForward: Set<string>;
  agentForwardOk: boolean;
  callers: string[];
  callersOk: boolean;
  agentRel: string;
};

const pathCache = new Map<string, AgentPath>();

function toolsOf(a: AgentSurface): AgentTool[] {
  return (a.tools ?? []).filter((t) => t.name !== "(hosted)");
}

function agentBase(file: string): string {
  return path.basename(file).replace(/\.(js|ts|mjs|cjs|tsx)$/, "");
}

function buildAgentPath(
  repoRoot: string,
  graph: RepoGraph,
  agent: AgentSurface
): AgentPath {
  const key = `${repoRoot}::${agent.file}`;
  const hit = pathCache.get(key);
  if (hit) return hit;

  // Safety / context / observability / knowledge modules must be on the
  // agent turn path — not smeared via a shared tool-executor handler file.
  const { reachable, ok } = forwardClosure(repoRoot, graph, [agent.file]);
  const callers = [...(graph.callersOf.get(agent.file) ?? [])];
  const pathInfo: AgentPath = {
    agentForward: reachable,
    agentForwardOk: ok,
    callers,
    callersOk: graph.searchable,
    agentRel: agent.file,
  };
  pathCache.set(key, pathInfo);
  return pathInfo;
}

function statusFromCount(n: number, thinMax = 1): LayerFill {
  if (n === 0) return "empty";
  if (n <= thinMax) return "thin";
  return "filled";
}

const INGRESS_FILE_RE =
  /(route|routes|webhook|webhooks|server\.js|app\.js|listener|websocket|queue|consumer|runtime\.cjs)/i;
const INGRESS_TEXT_RE =
  /\b(router\.(get|post|put|patch|delete)|app\.(get|post)|WebSocket|webhook|createServer|subscribe\(|on\(['"]message)\b/i;

const KNOWLEDGE_FILE_RE =
  /(pinecone|weaviate|chroma|qdrant|pgvector|vector-retriever|embedding|triage-rag|layer2-rag|remote-rag)/i;
const KNOWLEDGE_TEXT_RE =
  /\b(pinecone|weaviate|chromadb|qdrant|pgvector|createEmbedding|embeddings\.create|Pinecone)\b/i;

const SAFETY_FILE_RE =
  /(pii-redactor|redaction-service|safety-prescreen|guardrail|moderation)/i;
const SAFETY_TEXT_RE =
  /\b(pii-?redactor|redactPii|redactPHI|openai\.moderations|content.?filter|SafetyPreScreen|redactObject|assertCaller)\b/i;

const OBS_FILE_RE = /(opentelemetry|langfuse|helicone|braintrust|otel|langsmith)/i;
const OBS_TEXT_RE =
  /\b(@opentelemetry|opentelemetry|langfuse|helicone|braintrust|logToolCall|logModelCall|langsmith|LANGCHAIN_TRACING|LANGSMITH_)\b/i;

const EVAL_FILE_RE =
  /(evaluate-accuracy|eval-engine|coding-eval-nightly|pipeline-eval|eval:coding|agent-tests\.js|__tests__\/|\.test\.(js|ts|mjs|cjs)|\.spec\.(js|ts|mjs|cjs))/i;

/**
 * Does this harness actually invoke `agent` (or a module unique to it)?
 * Matching on "eval exists in repo" is the smear we are removing.
 */
function evalExercisesAgent(
  repoRoot: string,
  evalRel: string,
  agent: AgentSurface,
  graph: RepoGraph
): { yes: boolean; evidence: string } {
  const base = agentBase(agent.file);
  const abs = graph.byRel.get(evalRel) ?? path.join(repoRoot, evalRel);
  const text = readSafe(abs);
  if (text == null) return { yes: false, evidence: "" };

  // Workflow YAML: follow the npm script it runs
  if (/\.ya?ml$/i.test(evalRel)) {
    const runMatch = text.match(/run:\s*npm run (\S+)/);
    if (runMatch) {
      const pkgAbs = path.join(repoRoot, "middleware-platform", "package.json");
      const pkgText = readSafe(pkgAbs) ?? readSafe(path.join(repoRoot, "package.json"));
      if (pkgText) {
        try {
          const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> };
          const script = pkg.scripts?.[runMatch[1]!];
          if (script) {
            const scriptFile = script.match(
              /(?:node|tsx)\s+(\S*evaluate-accuracy\S*|\S*eval-engine\S*)/
            );
            if (scriptFile?.[1]) {
              const resolved = scriptFile[1].replace(/^\.\//, "");
              const candidates = [
                path.join("middleware-platform", resolved),
                resolved,
                path.join("middleware-platform", "scripts", path.basename(resolved)),
              ];
              for (const c of candidates) {
                if (graph.byRel.has(c) || fs.existsSync(path.join(repoRoot, c))) {
                  return evalExercisesAgent(repoRoot, c, agent, graph);
                }
              }
            }
            // eval:coding:prod → evaluate-accuracy — already handled via script body
            if (/evaluate-accuracy/.test(script)) {
              const ea = "middleware-platform/scripts/evaluate-accuracy.js";
              if (graph.byRel.has(ea)) {
                return evalExercisesAgent(repoRoot, ea, agent, graph);
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    // YAML that names the agent entry directly
    if (new RegExp(`\\b${base}\\b`).test(text)) {
      return {
        yes: true,
        evidence: `${evalRel}: workflow names ${base}`,
      };
    }
    return { yes: false, evidence: "" };
  }

  // Direct require/import of this agent module (with or without extension)
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const agentImportRe = new RegExp(
    `(?:require\\s*\\(\\s*['"\`][^'"\`]*${escapedBase}(?:\\.[cm]?[jt]sx?)?['"\`]\\s*\\)|from\\s+['"][^'"]*${escapedBase}(?:\\.[cm]?[jt]sx?)?['"])`
  );
  if (agentImportRe.test(text)) {
    return {
      yes: true,
      evidence: `${evalRel}: requires ${base}`,
    };
  }

  // Soft: harness body mentions the agent basename AND asserts/expects something
  // (covers scripts that load via a helper but still exercise this agent).
  if (
    new RegExp(`\\b${escapedBase}\\b`).test(text) &&
    /\b(assert|expect|describe|it\s*\(|test\s*\()/i.test(text)
  ) {
    return {
      yes: true,
      evidence: `${evalRel}: test harness names ${base}`,
    };
  }

  // evaluate-accuracy.js exercises knowledge-service / medical coding — not voice agents
  if (/evaluate-accuracy/.test(evalRel)) {
    const requiresKnowledge =
      /require\(['"][^'"]*knowledge-service['"]\)/.test(text) ||
      /getCodeCandidatesDualSource/.test(text);
    const isCodingAgent = /medical-coding|coding-orchestrator|knowledge-service/i.test(
      agent.file
    );
    if (requiresKnowledge && isCodingAgent) {
      return {
        yes: true,
        evidence: `${evalRel}: scores medical coding via knowledge-service`,
      };
    }
    return { yes: false, evidence: "" };
  }

  // eval-engine pattern scorer — only if it imports/invokes this agent
  if (/eval-engine/.test(evalRel)) {
    if (new RegExp(`\\b${base}\\b`).test(text) && /require\(/.test(text)) {
      // basename mention alone is weak; require already checked above
    }
    return { yes: false, evidence: "" };
  }

  return { yes: false, evidence: "" };
}

function fileLooksLikeIngress(rel: string, text: string): boolean {
  return INGRESS_FILE_RE.test(rel) || INGRESS_TEXT_RE.test(text.slice(0, 80_000));
}

/**
 * Which tables a shared database module's method touches.
 *
 * extractDatabaseModule already does this — it was written for the reach
 * tracer and maps methods to tables by reading the module. Reusing it here
 * means turn-assembly detection resolves db.listTradingHistory to
 * trading_conversation_history without a new mechanism.
 */
function dbMethodTables(repoRoot: string, agentAbs: string, method: string): string[] {
  const candidates = [
    path.join(path.dirname(agentAbs), "../database.js"),
    path.join(path.dirname(agentAbs), "../../database.js"),
    path.join(repoRoot, "middleware-platform/database.js"),
    path.join(repoRoot, "database.js"),
  ];


  for (const abs of candidates) {
    if (!fs.existsSync(abs)) continue;
    try {
      const mod = extractDatabaseModule(abs, repoRoot);
      const tables = mod.methodTables?.[method];
      if (tables && tables.length) return tables;
    } catch (e) {
    }
  }
  return [];
}

/** A store's declared role, or undefined when nobody has said. */
function layerRoleOf(repoRoot: string, table: string): string | undefined {
  try {
    const cfg = loadClassifyConfig(repoRoot);
    return resourceRole("db", table, cfg);
  } catch {
    return undefined;
  }
}

export function detectAgentLayers(
  repoRoot: string,
  agent: AgentSurface,
  model: ReferenceModel
): AgentLayerResult[] {
  const graph = buildRepoGraph(repoRoot);
  const pathInfo = buildAgentPath(repoRoot, graph, agent);
  const base = agentBase(agent.file);
  const agentAbs = path.join(repoRoot, agent.file);
  const agentText = readSafe(agentAbs);
  const results: AgentLayerResult[] = [];

  for (const spec of model.layers) {
    const id = spec.id;
    const components: LayerComponent[] = [];
    let status: LayerFill = "empty";
    let emptyReason: string | undefined;

    if (id === "ingress") {
      if (!pathInfo.callersOk) {
        status = "unsearched";
        emptyReason =
          "Could not build the reverse-require index — ingress callers unsearched.";
      } else {
        // Callers that require THIS agent and look like ingress
        for (const caller of pathInfo.callers) {
          if (/(__tests__|\.test\.|\.spec\.|\/tests\/|\/scripts\/e2e|e2e-)/i.test(caller)) {
            continue;
          }
          const abs = graph.byRel.get(caller);
          const text = abs ? readSafe(abs) ?? "" : "";
          if (!fileLooksLikeIngress(caller, text)) continue;
          components.push({
            id: `ingress:${caller}`,
            label: path.basename(caller),
            evidence: `${caller}: requires ${base} (ingress surface)`,
          });
        }
        // Agent file itself is an ingress when it is a webhook/route handler
        if (
          agentText != null &&
          (INGRESS_FILE_RE.test(agent.file) || INGRESS_TEXT_RE.test(agentText.slice(0, 40_000)))
        ) {
          if (!components.some((c) => c.id === `ingress:${agent.file}`)) {
            components.push({
              id: `ingress:${agent.file}`,
              label: base,
              evidence: `${agent.file}: agent file is itself an ingress surface`,
            });
          }
        }
        if (agent.loopKind === "hosted" && components.length === 0) {
          components.push({
            id: "ingress:hosted-console",
            label: "hosted provider console",
            evidence: `${agent.file}: loopKind=hosted — primary ingress is outside this repo`,
          });
        }
        components.splice(12);
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched reverse requires into this agent for routes/webhooks/WebSocket — none found.";
        }
      }
    } else if (id === "context") {
      if (agentText == null) {
        status = "unsearched";
        emptyReason = "Could not read agent file — context unsearched.";
      } else {
        if (agent.systemPrompt) {
          components.push({
            id: "context:systemPrompt",
            label: "system prompt",
            evidence: `${agent.file}: systemPrompt captured (${agent.systemPrompt.slice(0, 80)}…)`,
          });
        }
        // Prompt builders on the agent turn path
        for (const rel of pathInfo.agentForward) {
          if (!/prompt|context.?build|system.?prompt/i.test(rel)) continue;
          if (rel === agent.file) continue;
          components.push({
            id: `context:${rel}`,
            label: path.basename(rel),
            evidence: `${rel}: on turn path from ${base}`,
          });
        }
        if (/systemPrompt|SYSTEM_PROMPT|buildPrompt|promptTemplate|KellyPromptBuilder/i.test(agentText)) {
          if (!components.some((c) => c.label === "prompt assembly")) {
            components.push({
              id: "context:prompt-assembly",
              label: "prompt assembly",
              evidence: `${agent.file}: prompt assembly symbols on agent turn path`,
            });
          }
        }
        const seen = new Set<string>();
        const uniq = components.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        components.length = 0;
        components.push(...uniq.slice(0, 10));
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched prompt assembly on this agent's turn path — nothing traceable.";
        }
      }
    } else if (id === "reasoning") {
      if (agent.provider) {
        components.push({
          id: `reasoning:provider:${agent.provider}`,
          label: agent.provider,
          evidence: agent.evidence || `${agent.file}: provider ${agent.provider}`,
        });
      }
      if (agent.model) {
        components.push({
          id: `reasoning:model:${agent.model}`,
          label: agent.model,
          evidence: `${agent.file}: model ${agent.model}`,
        });
      }
      if (agent.loopKind) {
        components.push({
          id: `reasoning:loop:${agent.loopKind}`,
          label: agent.loopKind,
          evidence: `${agent.file}: loopKind=${agent.loopKind}`,
        });
      }
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason = "No provider/model/loop detected on this surface.";
      }
    } else if (id === "tools") {
      for (const t of toolsOf(agent).slice(0, 40)) {
        const patient = t.reach?.cells?.patient?.state === "reaches";
        const money = t.reach?.cells?.money?.state === "reaches";
        components.push({
          id: `tool:${t.name}`,
          label: t.name,
          evidence: t.handler ? `handler ${t.handler}` : t.note ?? "no handler",
          sensitive: patient ? "patient" : money ? "money" : null,
        });
      }
      if (agent.loopKind === "hosted" && toolsOf(agent).length === 0) {
        components.push({
          id: "tools:hosted",
          label: "(hosted tools)",
          evidence: `${agent.file}: tools declared in hosted console`,
        });
      }
      status = statusFromCount(components.length, 2);
      if (status === "empty") {
        emptyReason = "No tool bindings on this agent surface.";
      }
    } else if (id === "memory") {
      const memKeys = new Set<string>();
      for (const t of toolsOf(agent)) {
        for (const r of t.reach?.resources ?? []) {
          if (
            /session|memory|history|conversation|meta_kv|agent_state|snapshot/i.test(
              r.name
            )
          ) {
            const key = `${r.kind}:${r.name}`;
            if (memKeys.has(key)) continue;
            memKeys.add(key);
            components.push({
              id: `memory:${key}`,
              label: r.name,
              evidence: r.evidence,
              sensitive:
                r.class === "patient"
                  ? "patient"
                  : r.class === "money"
                    ? "money"
                    : null,
            });
          }
        }
      }
      for (const rel of pathInfo.agentForward) {
        if (!/session-state|session-store|conversation-memory|eligibility-session/i.test(rel)) {
          continue;
        }
        components.push({
          id: `memory:mod:${rel}`,
          label: path.basename(rel),
          evidence: `${rel}: session module on path from ${base}`,
        });
      }
      // The agent's own turn assembly. A conversation history read happens
      // before any tool runs, so tool reach cannot contain it, and the file is
      // not named session-store — the two checks above are structurally unable
      // to see it. The agent's source is already loaded; consult it.
      if (agentText) {
        for (const m of agentText.matchAll(/\bdb\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
          const method = m[1];
          const tables = dbMethodTables(repoRoot, agentAbs, method);
          for (const table of tables) {
            const role = layerRoleOf(repoRoot, table);
            if (role !== "conversation") continue;
            const key = "turn:" + table;
            if (memKeys.has(key)) continue;
            memKeys.add(key);
            components.push({
              id: "memory:" + key,
              label: table,
              evidence: base + ": db." + method + "() in turn assembly, before tool dispatch",
            });
          }
        }
        // Fallback when resources.classify.json has not labeled tables: any
        // db.method whose name itself signals conversation history still counts.
        for (const m of agentText.matchAll(/\bdb\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
          const method = m[1] ?? "";
          if (!/history|session|prior|conversation|memory|messages/i.test(method)) continue;
          const key = "method:" + method;
          if (memKeys.has(key)) continue;
          memKeys.add(key);
          components.push({
            id: "memory:" + key,
            label: "db." + method,
            evidence: base + ": db." + method + "() in turn assembly (history/session-shaped)",
          });
        }
      }

      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "No conversation store on this agent's tool reach, forward path, or turn " +
          "assembly. If one exists, it may be a store nobody has given a role — " +
          "roles are declared in resources.classify.json.";
      }
    } else if (id === "knowledge") {
      if (!pathInfo.agentForwardOk && toolsOf(agent).every((t) => !t.handler)) {
        status = "unsearched";
        emptyReason =
          "Could not establish a forward path from this agent — knowledge unsearched.";
      } else {
        // Tool-reach vector/RAG resources (already traced per tool from handlers)
        for (const t of toolsOf(agent)) {
          for (const r of t.reach?.resources ?? []) {
            if (/pinecone|weaviate|chroma|qdrant|vector|rag|embedding/i.test(r.name)) {
              components.push({
                id: `knowledge:reach:${r.kind}:${r.name}`,
                label: r.name,
                evidence: r.evidence,
              });
            }
          }
        }
        // Retrieval clients the agent itself imports on the turn path
        for (const rel of pathInfo.agentForward) {
          if (!KNOWLEDGE_FILE_RE.test(rel)) continue;
          components.push({
            id: `knowledge:${rel}`,
            label: path.basename(rel),
            evidence: `${rel}: retrieval client on turn path from ${base}`,
          });
        }
        const seen = new Set<string>();
        const uniq = components.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        components.length = 0;
        components.push(...uniq.slice(0, 14));
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched this agent's tool reach and forward path for vector/RAG/embedding clients — none.";
        }
      }
    } else if (id === "data") {
      const tools = toolsOf(agent);
      const allUnresolved =
        tools.length > 0 &&
        tools.every(
          (t) =>
            !t.handler ||
            t.reach?.truncationReasons?.some((r) => /unresolved-handler/.test(r))
        );
      if (allUnresolved && tools.every((t) => (t.reach?.resources ?? []).length === 0)) {
        status = "unsearched";
        emptyReason =
          "Tool handlers could not be resolved — data stores unsearched for this agent.";
      } else {
        const seen = new Set<string>();
        for (const t of tools) {
          for (const r of t.reach?.resources ?? []) {
            if (r.kind === "db_call" || r.class === "plumbing") continue;
            if (r.kind !== "db" && r.kind !== "external") continue;
            const key = `${r.kind}:${r.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            components.push({
              id: `data:${key}`,
              label: r.name,
              evidence: r.evidence,
              sensitive:
                r.class === "patient"
                  ? "patient"
                  : r.class === "money"
                    ? "money"
                    : null,
            });
          }
        }
        status = statusFromCount(components.length, 3);
        if (status === "empty") {
          emptyReason =
            tools.length === 0
              ? "No tools to attribute data stores from."
              : "Tool reach found no db/external stores for this agent. This " +
                "means none were traced, not that none exist — a store reached " +
                "through a shared module or a dispatch the tracer could not follow " +
                "will not appear.";
        }
      }
    } else if (id === "safety") {
      if (!pathInfo.agentForwardOk) {
        status = "unsearched";
        emptyReason =
          "Could not establish a forward path from this agent — safety unsearched.";
      } else {
        // Controls living in the agent file itself (e.g. assertCaller before tools)
        if (agentText && SAFETY_TEXT_RE.test(agentText)) {
          const m = agentText.match(
            /\b(assertCaller|redactPii|redactPHI|SafetyPreScreen|openai\.moderations|content.?filter)\b/i
          );
          if (m) {
            components.push({
              id: "safety:in-agent",
              label: m[1] ?? "in-agent guard",
              evidence: `${agent.file}: ${m[1]} on agent turn assembly`,
            });
          }
        }
        for (const rel of pathInfo.agentForward) {
          // Agent source already handled above
          if (rel === agent.file) continue;
          if (/guardrail-no-azure|deploy\.cjs|secure-logger/i.test(rel)) continue;
          const abs = graph.byRel.get(rel);
          const text = abs ? readSafe(abs) ?? "" : "";
          const fileHit = SAFETY_FILE_RE.test(rel);
          const textHit = SAFETY_TEXT_RE.test(text.slice(0, 60_000));
          if (!fileHit && !textHit) continue;
          // Filename-only weak hits need an actual control symbol in-file
          if (
            !fileHit &&
            !/(redact|moderat|guardrail|SafetyPreScreen|pii|assertCaller)/i.test(text.slice(0, 60_000))
          ) {
            continue;
          }
          // patient-orchestrator counts only when it actually redacts
          if (
            /patient-orchestrator/i.test(rel) &&
            !/pii-?redactor|redact\s*\(/i.test(text.slice(0, 80_000))
          ) {
            continue;
          }
          components.push({
            id: `safety:${rel}`,
            label: path.basename(rel),
            evidence: `${rel}: safety control on turn path from ${base}`,
          });
        }
        const seen = new Set<string>();
        const uniq = components.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        components.length = 0;
        components.push(...uniq.slice(0, 10));
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched this agent's turn path (not the whole system) for moderation, guardrails, and PII/PHI redaction — none found on this path.";
        }
      }
    } else if (id === "observability") {
      if (!pathInfo.agentForwardOk && pathInfo.callers.length === 0) {
        status = "unsearched";
        emptyReason =
          "Could not establish a forward path from this agent — observability unsearched.";
      } else {
        // Turn-path modules plus direct callers (e.g. main-graph wraps executeTurn
        // with langsmith-config). Callers are the ingress of tracing for this surface.
        const obsRels = new Set<string>([
          ...pathInfo.agentForward,
          ...pathInfo.callers,
        ]);
        for (const rel of obsRels) {
          if (rel === agent.file) {
            if (agentText && OBS_TEXT_RE.test(agentText)) {
              components.push({
                id: "obs:in-agent",
                label: "tool/model logging",
                evidence: `${agent.file}: tool or model call logging on agent path`,
              });
            }
            continue;
          }
          const abs = graph.byRel.get(rel);
          const text = abs ? readSafe(abs) ?? "" : "";
          if (!OBS_FILE_RE.test(rel) && !OBS_TEXT_RE.test(text.slice(0, 40_000))) continue;
          if (/access.?log|morgan|request.?log/i.test(path.basename(rel))) continue;
          components.push({
            id: `obs:${rel}`,
            label: path.basename(rel),
            evidence: pathInfo.callers.includes(rel)
              ? `${rel}: caller of ${base} wires tracing/logging`
              : `${rel}: agent-path tracing/logging (not HTTP access logs)`,
          });
        }
        // One hop: caller requires langsmith-config / otel without inlining the SDK name.
        for (const caller of pathInfo.callers) {
          const callerAbs = graph.byRel.get(caller) ?? path.join(repoRoot, caller);
          const callerText = readSafe(callerAbs);
          if (!callerText) continue;
          const reqRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
          let rm: RegExpExecArray | null;
          while ((rm = reqRe.exec(callerText)) !== null) {
            const resolved = resolveLocalRequire(callerAbs, rm[1]!, repoRoot);
            if (!resolved) continue;
            const hopRel = path.relative(repoRoot, resolved).split(path.sep).join("/");
            if (!OBS_FILE_RE.test(hopRel)) continue;
            if (components.some((c) => c.id === `obs:${hopRel}`)) continue;
            components.push({
              id: `obs:${hopRel}`,
              label: path.basename(hopRel),
              evidence: `${caller} → ${hopRel}: tracing config on turn caller`,
            });
          }
        }
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched this agent's turn path and direct callers for tracing SDKs and model/tool-call logging — none found.";
        }
      }
    } else if (id === "evaluation") {
      if (!graph.searchable) {
        status = "unsearched";
        emptyReason = "Could not scan the repo for eval harnesses — evaluation unsearched.";
      } else {
        for (const abs of graph.files) {
          const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
          if (!EVAL_FILE_RE.test(rel)) {
            // Also catch package scripts referencing eval — skip; workflows cover nightly
            continue;
          }
          const { yes, evidence } = evalExercisesAgent(repoRoot, rel, agent, graph);
          if (!yes) continue;
          components.push({
            id: `eval:${rel}`,
            label: path.basename(rel),
            evidence,
          });
        }
        const seen = new Set<string>();
        const uniq = components.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        components.length = 0;
        components.push(...uniq.slice(0, 8));
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched eval harnesses for ones that invoke this agent — none (e.g. evaluate-accuracy.js scores medical coding via knowledge-service, not this surface).";
        }
      }
    } else if (id === "deployment") {
      if (agentText == null && !pathInfo.agentForwardOk) {
        status = "unsearched";
        emptyReason = "Could not read agent entry — deployment unsearched.";
      } else {
        // Deploy configs that name THIS agent's entrypoint
        for (const abs of graph.files) {
          const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
          if (!/ecosystem\.config|Dockerfile|docker-compose|Procfile|pm2/i.test(rel)) {
            continue;
          }
          const text = readSafe(abs);
          if (!text) continue;
          if (
            text.includes(base) ||
            text.includes(agent.file) ||
            text.includes(path.basename(agent.file))
          ) {
            components.push({
              id: `deploy:${rel}`,
              label: path.basename(rel),
              evidence: `${rel}: references ${base}`,
            });
          }
        }
        if (agentText && /process\.env\./.test(agentText)) {
          components.push({
            id: "deploy:env",
            label: "process.env secrets",
            evidence: `${agent.file}: reads process.env (this agent process)`,
          });
        }
        // Hosted: deployment is the provider runtime
        if (agent.loopKind === "hosted" && components.length === 0) {
          components.push({
            id: "deploy:hosted",
            label: "hosted provider runtime",
            evidence: `${agent.file}: loopKind=hosted — process runs at provider`,
          });
        }
        status = statusFromCount(components.length);
        if (status === "empty") {
          emptyReason =
            "Searched deploy configs that start this agent's process — none found.";
        }
      }
    }

    results.push({
      id,
      name: spec.name,
      question: spec.question,
      whyItMatters: spec.whyItMatters,
      whatFillsIt: spec.whatFillsIt,
      status,
      // Safety and Observability only walk this agent's forward path — label
      // them as agent-scoped so the Layers UI does not read as "the system".
      scope: id === "safety" || id === "observability" ? "agent" : "system",
      emptyReason:
        status === "empty" || status === "unsearched" ? emptyReason : undefined,
      components,
    });
  }

  return results;
}

export function attachLayersToInventory(
  repoRoot: string,
  agents: AgentSurface[],
  productRoot: string
): void {
  clearLayerIndexCache();
  const model = loadReferenceModel(productRoot);
  for (const a of agents) {
    if (a.kind !== "agent") {
      (a as AgentSurface & { layers?: AgentLayerResult[] }).layers = undefined;
      continue;
    }
    (a as AgentSurface & { layers?: AgentLayerResult[] }).layers =
      detectAgentLayers(repoRoot, a, model);
  }
}

export { LAYER_ORDER };
