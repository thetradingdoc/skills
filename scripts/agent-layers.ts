/**
 * Per-agent layer detection against reference-model.json.
 */
import * as fs from "fs";
import * as path from "path";
import type { AgentSurface, AgentTool } from "./agent-inventory";

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
  status: LayerFill;
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

function walkFiles(root: string, maxFiles = 4000): string[] {
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

type RepoIndex = {
  files: string[];
  byRel: Map<string, string>;
  knowledgeHits: Array<{ file: string; evidence: string }>;
  safetyHits: Array<{ file: string; evidence: string }>;
  observabilityHits: Array<{ file: string; evidence: string }>;
  evaluationHits: Array<{ file: string; evidence: string }>;
  ingressHits: Array<{ file: string; evidence: string; agentsMentioned: string[] }>;
  deploymentHits: Array<{ file: string; evidence: string }>;
};

let cachedIndex: { root: string; index: RepoIndex } | null = null;

function buildRepoIndex(repoRoot: string): RepoIndex {
  if (cachedIndex?.root === repoRoot) return cachedIndex.index;
  const files = walkFiles(repoRoot);
  const byRel = new Map<string, string>();
  const knowledgeHits: RepoIndex["knowledgeHits"] = [];
  const safetyHits: RepoIndex["safetyHits"] = [];
  const observabilityHits: RepoIndex["observabilityHits"] = [];
  const evaluationHits: RepoIndex["evaluationHits"] = [];
  const ingressHits: RepoIndex["ingressHits"] = [];
  const deploymentHits: RepoIndex["deploymentHits"] = [];

  const knowledgeRe =
    /\b(pinecone|weaviate|chromadb|@chroma-core|qdrant|pgvector|createEmbedding|embeddings\.create|Pinecone|openai\.embeddings)\b/i;
  const safetyRe =
    /\b(pii-?redactor|redactPii|redactPHI|moderation|guardrail|openai\.moderations|content.?filter)\b/i;
  const obsRe =
    /\b(@opentelemetry|opentelemetry|langfuse|helicone|braintrust|logToolCall|tool_call.*log|logModelCall|trace.*tool_call|OpenTelemetry)\b/i;
  const evalRe =
    /\b(eval:coding|evaluate-accuracy|eval-engine|eval harness|scoring|EVAL_USE_SEMANTIC)\b/i;
  const ingressRe =
    /\b(router\.(get|post|put|patch|delete)|app\.(get|post)|WebSocket|webhook|retell|twilio|createServer|subscribe\(|on\(['"]message)\b/i;
  const deployRe =
    /\b(process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN)|API_KEY|ecosystem\.config|Dockerfile|docker-compose)\b/;

  for (const abs of files) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    byRel.set(rel, abs);
    const text = readSafe(abs);
    if (!text || text.length > 800_000) continue;
    const head = text.slice(0, 120_000);

    if (knowledgeRe.test(head)) {
      const m = head.match(knowledgeRe);
      knowledgeHits.push({
        file: rel,
        evidence: `${rel}: ${m?.[0] ?? "vector/embedding"}`,
      });
    }
    if (safetyRe.test(head)) {
      const m = head.match(safetyRe);
      safetyHits.push({
        file: rel,
        evidence: `${rel}: ${m?.[0] ?? "safety"}`,
      });
    }
    if (obsRe.test(head)) {
      const m = head.match(obsRe);
      // Exclude pure HTTP access-log style unless tool/model specific
      if (!/access.?log|morgan|request.?log/i.test(m?.[0] ?? "")) {
        observabilityHits.push({
          file: rel,
          evidence: `${rel}: ${m?.[0] ?? "trace"}`,
        });
      }
    }
    if (
      evalRe.test(head) ||
      /coding-eval-nightly|evaluate-accuracy\.js|eval-engine\.js/i.test(rel)
    ) {
      evaluationHits.push({
        file: rel,
        evidence: /coding-eval-nightly/i.test(rel)
          ? `${rel}: nightly workflow runs npm run eval:coding:prod`
          : `${rel}: eval/scoring`,
      });
    }
    if (ingressRe.test(head)) {
      const agentsMentioned: string[] = [];
      for (const name of [
        "kelly-agent-service",
        "retell-service",
        "retell-websocket",
        "voice-incoming-handler",
        "somo-demo",
        "consumer-navigation",
        "orchestrator",
      ]) {
        if (head.includes(name) || rel.includes(name)) agentsMentioned.push(name);
      }
      ingressHits.push({
        file: rel,
        evidence: `${rel}: ingress handler`,
        agentsMentioned,
      });
    }
    if (
      deployRe.test(head) ||
      /ecosystem\.config|Dockerfile|docker-compose/i.test(rel)
    ) {
      deploymentHits.push({
        file: rel,
        evidence: `${rel}: runtime/secrets`,
      });
    }
  }

  const index: RepoIndex = {
    files,
    byRel,
    knowledgeHits,
    safetyHits,
    observabilityHits,
    evaluationHits,
    ingressHits,
    deploymentHits,
  };
  cachedIndex = { root: repoRoot, index };
  return index;
}

export function clearLayerIndexCache(): void {
  cachedIndex = null;
}

function agentBase(file: string): string {
  return path.basename(file).replace(/\.(js|ts|mjs|tsx)$/, "");
}

function toolsOf(a: AgentSurface): AgentTool[] {
  return (a.tools ?? []).filter((t) => t.name !== "(hosted)");
}

function agentSensitive(a: AgentSurface): boolean {
  return toolsOf(a).some((t) => {
    const p = t.reach?.cells?.patient;
    const m = t.reach?.cells?.money;
    return p?.state === "reaches" || m?.state === "reaches";
  });
}

function relatedToAgent(
  hitFile: string,
  agent: AgentSurface,
  textMentions?: string[]
): boolean {
  const base = agentBase(agent.file).toLowerCase();
  const f = hitFile.toLowerCase();
  if (f === agent.file.toLowerCase()) return true;
  // Same directory sibling often shares the path
  const agentDir = path.dirname(agent.file).toLowerCase();
  if (f.startsWith(agentDir + "/") && f.includes(base.slice(0, 12))) return true;
  if (f.includes(base)) return true;
  if (textMentions?.some((m) => m.toLowerCase() === base || base.includes(m.toLowerCase()))) {
    return true;
  }
  return false;
}

/** Stricter: file requires/imports the agent module, or is the agent. */
function importsAgent(repoRoot: string, hitRel: string, agent: AgentSurface): boolean {
  if (hitRel === agent.file) return true;
  const abs = path.join(repoRoot, hitRel);
  const text = readSafe(abs);
  if (!text) return false;
  const base = agentBase(agent.file);
  return new RegExp(
    `require\\(['"\`].*${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]\\)|from ['"].*${base}`,
    "i"
  ).test(text);
}

function statusFromCount(n: number, thinMax = 1): LayerFill {
  if (n === 0) return "empty";
  if (n <= thinMax) return "thin";
  return "filled";
}

export function detectAgentLayers(
  repoRoot: string,
  agent: AgentSurface,
  model: ReferenceModel
): AgentLayerResult[] {
  const index = buildRepoIndex(repoRoot);
  const base = agentBase(agent.file);
  const agentAbs = path.join(repoRoot, agent.file);
  const agentText = readSafe(agentAbs) ?? "";
  const results: AgentLayerResult[] = [];

  for (const spec of model.layers) {
    const id = spec.id;
    const components: LayerComponent[] = [];
    let status: LayerFill = "empty";
    let emptyReason: string | undefined;

    if (id === "ingress") {
      for (const h of index.ingressHits) {
        if (!importsAgent(repoRoot, h.file, agent) && !relatedToAgent(h.file, agent, h.agentsMentioned)) {
          continue;
        }
        // Prefer direct importers / self
        if (!importsAgent(repoRoot, h.file, agent) && h.file !== agent.file) {
          // keep only webhooks/routes that mention the agent basename
          if (!h.agentsMentioned.some((m) => agentBase(agent.file).includes(m) || m.includes(agentBase(agent.file).slice(0, 8)))) {
            continue;
          }
        }
        components.push({
          id: `ingress:${h.file}`,
          label: path.basename(h.file),
          evidence: h.evidence,
        });
      }
      if (
        /webhook|websocket|router\.|app\.(get|post)/i.test(agentText) ||
        /webhooks\//.test(agent.file)
      ) {
        if (!components.some((c) => c.id.includes(agent.file))) {
          components.push({
            id: `ingress:${agent.file}`,
            label: base,
            evidence: `${agent.file}: agent file is itself an ingress surface`,
          });
        }
      }
      if (agent.loopKind === "hosted") {
        components.push({
          id: "ingress:hosted-console",
          label: "hosted provider console",
          evidence: `${agent.file}: loopKind=hosted — ingress is outside this repo`,
        });
      }
      // Cap noise
      components.splice(8);
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "Searched routes, webhooks, and WebSocket handlers for references to this agent — none found.";
      }
    } else if (id === "context") {
      if (agent.systemPrompt) {
        components.push({
          id: "context:systemPrompt",
          label: "system prompt",
          evidence: `${agent.file}: systemPrompt captured (${agent.systemPrompt.slice(0, 80)}…)`,
        });
      }
      if (/systemPrompt|SYSTEM_PROMPT|buildPrompt|promptTemplate/i.test(agentText)) {
        components.push({
          id: "context:prompt-assembly",
          label: "prompt assembly",
          evidence: `${agent.file}: prompt assembly symbols`,
        });
      }
      // Deduplicate
      const seen = new Set<string>();
      const uniq = components.filter((c) => {
        if (seen.has(c.label)) return false;
        seen.add(c.label);
        return true;
      });
      components.length = 0;
      components.push(...uniq);
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "Searched for systemPrompt / prompt assembly in the agent file — nothing traceable.";
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
          evidence: t.handler
            ? `handler ${t.handler}`
            : t.note ?? "no handler",
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
      if (/session|conversationHistory|chatHistory/i.test(agentText)) {
        components.push({
          id: "memory:in-agent",
          label: "session/history in agent",
          evidence: `${agent.file}: session or history symbols`,
        });
      }
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "No session/history stores attributed from tools or the agent file.";
      }
    } else if (id === "knowledge") {
      // Prefer tool-reach vector/RAG resources — highest signal
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
      // Plus vector client modules that this agent (or its tool executor) imports
      for (const h of index.knowledgeHits) {
        if (!/pinecone|weaviate|chroma|qdrant|vector-retriever|embedding/i.test(h.file)) {
          continue;
        }
        if (
          importsAgent(repoRoot, h.file, agent) ||
          relatedToAgent(h.file, agent) ||
          // shared RAG used by kelly tool path
          (/kelly|retell|voice|triage/i.test(base) &&
            /pinecone|vector-retriever|layer2-rag|triage-rag/i.test(h.file))
        ) {
          components.push({
            id: `knowledge:${h.file}`,
            label: path.basename(h.file),
            evidence: h.evidence,
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
      components.push(...uniq.slice(0, 12));
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "Searched for Pinecone/Weaviate/Chroma/Qdrant/pgvector and embedding calls related to this agent — none.";
      }
    } else if (id === "data") {
      const seen = new Set<string>();
      for (const t of toolsOf(agent)) {
        for (const r of t.reach?.resources ?? []) {
          if (r.kind === "db_call" || r.class === "plumbing") continue;
          if (r.kind !== "db" && r.kind !== "external") continue;
          if (r.class !== "patient" && r.class !== "money" && r.class !== "internal") {
            if (r.class === "external") {
              /* include external APIs as data */
            } else continue;
          }
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
          toolsOf(agent).length === 0
            ? "No tools to attribute data stores from."
            : "Tool reach found no db/external stores for this agent.";
      }
    } else if (id === "safety") {
      for (const h of index.safetyHits) {
        // Real safety: pii-redactor, moderation APIs, guardrail libs — not deploy scripts
        if (/guardrail-no-azure|deploy\.cjs/i.test(h.file)) continue;
        const near =
          relatedToAgent(h.file, agent) ||
          /pii-redactor|moderation|guardrail/i.test(h.file);
        if (!near) continue;
        components.push({
          id: `safety:${h.file}`,
          label: path.basename(h.file),
          evidence: h.evidence,
        });
      }
      if (/pii-redactor|redactPii|moderation/i.test(agentText)) {
        components.push({
          id: "safety:in-agent",
          label: "safety call in agent",
          evidence: `${agent.file}: safety/redaction symbols`,
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
          "Searched for moderation, guardrails, and PII/PHI redaction on this agent path — none found.";
      }
    } else if (id === "observability") {
      for (const h of index.observabilityHits) {
        if (!relatedToAgent(h.file, agent)) continue;
        components.push({
          id: `obs:${h.file}`,
          label: path.basename(h.file),
          evidence: h.evidence,
        });
      }
      if (/logToolCall|tool_call|logModel|trace\(/.test(agentText)) {
        components.push({
          id: "obs:in-agent",
          label: "tool/model logging",
          evidence: `${agent.file}: tool or model call logging`,
        });
      }
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "Searched for tracing SDKs and model/tool-call logging (HTTP access logs excluded) — none on this path.";
      }
    } else if (id === "evaluation") {
      for (const h of index.evaluationHits) {
        // Keep real eval harness / nightly workflow — not every package.json mention
        if (
          /coding-eval-nightly|evaluate-accuracy|eval-engine|pipeline-eval|eval:coding/i.test(
            h.file + h.evidence
          )
        ) {
          components.push({
            id: `eval:${h.file}`,
            label: path.basename(h.file),
            evidence: h.evidence,
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
      components.push(...uniq.slice(0, 8));
      // Eval is repo-level for all voice/kelly agents when present
      status = statusFromCount(components.length);
      if (status === "empty") {
        emptyReason =
          "Searched eval harnesses, scoring scripts, and coding-eval-nightly.yml — nothing attributable to this agent.";
      }
    } else if (id === "deployment") {
      for (const h of index.deploymentHits.slice(0, 20)) {
        if (
          relatedToAgent(h.file, agent) ||
          /ecosystem\.config|Dockerfile|package\.json/i.test(h.file)
        ) {
          components.push({
            id: `deploy:${h.file}`,
            label: path.basename(h.file),
            evidence: h.evidence,
          });
        }
      }
      if (/process\.env\./.test(agentText)) {
        components.push({
          id: "deploy:env",
          label: "process.env secrets",
          evidence: `${agent.file}: reads process.env`,
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
          "Searched deploy configs and secret env references for this agent — none found.";
      }
    }

    results.push({
      id,
      name: spec.name,
      question: spec.question,
      whyItMatters: spec.whyItMatters,
      status,
      emptyReason: status === "empty" ? emptyReason : undefined,
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
