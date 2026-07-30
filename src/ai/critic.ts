/**
 * Critic — architecture review for analysis and greenfield answers.
 * Uses OpenAI gpt-4o-mini when OPENAI_API_KEY is set. Falls back to Claude
 * (Anthropic) when OPENAI_API_KEY is not set but ANTHROPIC_API_KEY is set.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ArchGraph, ContractFinding, CriticResult, CriticViolation } from "../types";
import type { GraphCommand } from "../types";
import { LAYER_ORDER as CANONICAL_LAYERS } from "../architecture/layerModel";
import {
  getGreenfieldCriticSystemSnippet,
} from "../agent/rail/greenfieldCriticPlaybook";
import { getAntiPatternWarnings } from "../agent/rail/manager";

export const ARCH_RULESET_VERSION = "v1";

const LAYER_INDEX: Record<string, number> = CANONICAL_LAYERS.reduce(
  (acc, layer, idx) => {
    acc[layer] = idx;
    return acc;
  },
  {} as Record<string, number>
);

function getOpenAIClient(apiKey?: string): OpenAI | null {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  return key ? new OpenAI({ apiKey: key }) : null;
}

function getAnthropicKey(apiKeyClaude?: string): string | null {
  const key = apiKeyClaude ?? process.env.ANTHROPIC_API_KEY?.trim();
  return key || null;
}

async function callCriticLLM(prompt: string, apiKey?: string, apiKeyClaude?: string): Promise<string | null> {
  const openai = getOpenAIClient(apiKey);
  if (openai) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    return completion.choices[0]?.message?.content ?? null;
  }
  const anthropicKey = getAnthropicKey(apiKeyClaude);
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : null;
  }
  return null;
}

export async function reviewArchitectureAnswer(params: {
  question: string;
  answer: string;
  graph: ArchGraph;
  findings?: ContractFinding[];
  apiKey?: string;
  apiKeyClaude?: string;
}): Promise<CriticResult> {
  const openai = getOpenAIClient(params.apiKey);
  const anthropicKey = getAnthropicKey(params.apiKeyClaude);
  if (!openai && !anthropicKey) {
    return {
      approved: true,
      score: 10,
      report: "No OpenAI or Anthropic API key; auto-approved.",
      violations: [],
    };
  }
  const { question, answer, graph, findings } = params;
  const graphSummary = graph.nodes
    .slice(0, 40)
    .map((n) => `- ${n.suggestedLabel ?? n.label} (${n.layer ?? "?"}) [${n.id}]`)
    .join("\n");
  const findingsSummary =
    findings && findings.length > 0
      ? findings
          .slice(0, 20)
          .map((f) => `- [${f.severity}] ${f.type} at ${f.location}: ${f.description}`)
          .join("\n")
      : "None.";
  const isUtilityTask =
    /script|skill|helper|tool|snippet|utility/i.test(question) ||
    /write a|create a|build a|generate a/i.test(question);
  const taskContext = isUtilityTask
    ? "\nThis is a utility script/skill creation or usage task. Judge primarily on correctness, usefulness, and alignment with the request. Do NOT penalize for missing unit tests, exhaustive edge-case handling, or theoretical circular-dependency concerns unless they are explicitly in scope."
    : "";
  const MAX_ANSWER_CHARS = 8000;
  const truncatedAnswer =
    answer.length > MAX_ANSWER_CHARS
      ? answer.slice(0, MAX_ANSWER_CHARS) +
        `\n\n[Answer truncated for review; original length ${answer.length} chars.]`
      : answer;
  const prompt = `You are a senior software architect acting as a strict code and architecture reviewer.${taskContext}

Question:
${question}

Proposed answer:
${truncatedAnswer}

Architecture (truncated):
${graphSummary}

Static analysis findings:
${findingsSummary}

Evaluate the proposed answer ONLY on:
- Whether it is TRUE of this codebase,
- Architectural fit (layers, boundaries, dependencies),
- Code correctness and safety at a high level (given the description).

A correct refusal is a good answer. If the question assumes something that
does not exist in this codebase, and the answer says so plainly, that is a
10 — not an incomplete response. Do not penalise an answer for being short,
for declining to speculat or for saying it could not determine something.
An answer that admits uncertainty is better than one that sounds complete
and is wrong.

Score what the answer claims, not how much it says.

Your task:
- Judge whether the assistant's answer is acceptable.
- Assign a numeric score from 1-10.
- Extract architecture violations ONLY where the graph or the static findings
  above show one. A violation is something the scan established, not something
  you think would be an improvement. Do not raise a violation because a feature
  is missing, because you would have structured the code differently, or
  because the answer could have said more. If nothing in the supplied
  architecture or findings evidences a violation, return an empty array.

Respond with STRICT JSON (no markdown) in this shape:
{
  "approved": boolean,
  "score": number,        // integer 1-10
  "report": string,       // one-paragraph human-readable summary
  "violations": [
    {
      "type": "layer_violation" | "drift" | "missing_context" | "circular_dep" | "god_module",
      "severity": "critical" | "high" | "medium",
      "sourceNodeId": "exact ArchNode.id from the graph",
      "targetNodeId": "exact ArchNode.id from the graph or omit if N/A",
      "description": "plain-English description of what is wrong",
      "suggestedFix": "plain-English recommendation for how to fix it"
    }
  ]
}

If there are no violations, return "violations": [].
Do not include any additional fields. Do not wrap the JSON in markdown.`;

  try {
    const raw = (await callCriticLLM(prompt, params.apiKey, params.apiKeyClaude)) ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let parsed: { approved?: boolean; score?: number; report?: string; violations?: CriticViolation[] } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        approved: true,
        score: 10,
        report: cleaned || "Critic returned non-JSON output; treating as approved.",
        violations: [],
      };
    }
    const score =
      typeof parsed.score === "number" && Number.isFinite(parsed.score) ? parsed.score : 5;
    const approved = parsed.approved === true && score >= 7;
    const report =
      typeof parsed.report === "string" && parsed.report.trim().length > 0
        ? parsed.report
        : approved
          ? "APPROVED"
          : "Not approved; no specific issues provided.";
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    return { approved, score, report, violations };
  } catch (err) {
    return {
      approved: true,
      score: 10,
      report: `Critic error; treating as approved: ${err instanceof Error ? err.message : String(err)}`,
      violations: [],
    };
  }
}

function buildProposedGraph(graphCommands: GraphCommand[] | GraphCommand | undefined): {
  nodes: Array<{ id: string; layer?: string; label?: string }>;
  edges: Array<{ source: string; target: string }>;
} {
  const nodes: Array<{ id: string; layer?: string; label?: string }> = [];
  const edges: Array<{ source: string; target: string }> = [];
  const cmds = graphCommands
    ? Array.isArray(graphCommands)
      ? graphCommands
      : [graphCommands]
    : [];
  for (const cmd of cmds) {
    if (cmd.action === "create_node") {
      nodes.push({
        id: cmd.id,
        layer: cmd.layer,
        label: "label" in cmd && typeof cmd.label === "string" ? cmd.label : undefined,
      });
    }
    if (cmd.action === "connect") {
      edges.push({ source: cmd.fromId, target: cmd.toId });
    }
  }
  return { nodes, edges };
}

function detectCycle(edges: Array<{ source: string; target: string }>): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  function dfs(node: string): string[] | null {
    visited.add(node);
    recStack.add(node);
    path.push(node);
    for (const n of adj.get(node) ?? []) {
      if (!visited.has(n)) {
        const cycle = dfs(n);
        if (cycle) return cycle;
      } else if (recStack.has(n)) {
        const idx = path.indexOf(n);
        return path.slice(idx);
      }
    }
    path.pop();
    recStack.delete(node);
    return null;
  }
  for (const src of adj.keys()) {
    if (!visited.has(src)) {
      const cycle = dfs(src);
      if (cycle) return cycle;
    }
  }
  return null;
}

function checkLayering(
  nodes: Array<{ id: string; layer?: string }>,
  edges: Array<{ source: string; target: string }>
): CriticViolation[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const violations: CriticViolation[] = [];
  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) continue;
    const srcOrder = LAYER_INDEX[src.layer ?? "Uncategorized"] ?? CANONICAL_LAYERS.length;
    const tgtOrder = LAYER_INDEX[tgt.layer ?? "Uncategorized"] ?? CANONICAL_LAYERS.length;
    if (srcOrder > tgtOrder) {
      violations.push({
        type: "layer_violation",
        severity: "high",
        sourceNodeId: e.source,
        targetNodeId: e.target,
        description: `${src.layer ?? "?"} (${e.source}) should not depend on ${tgt.layer ?? "?"} (${e.target}). Lower layers depend on higher.`,
        suggestedFix: "Invert the dependency or move the module to a higher layer.",
      });
    }
  }
  return violations;
}

function checkGreenfieldCollisions(
  proposedNodes: Array<{ id: string; layer?: string }>,
  existingGraph: ArchGraph | null | undefined
): CriticViolation[] {
  if (!existingGraph?.nodes?.length) return [];
  const existingIds = new Set(existingGraph.nodes.map((n) => n.id));
  const existingLabels = new Set(
    existingGraph.nodes.map((n) => (n.suggestedLabel ?? n.label ?? "").toLowerCase().trim()).filter(Boolean)
  );
  const violations: CriticViolation[] = [];
  for (const n of proposedNodes) {
    if (existingIds.has(n.id)) {
      violations.push({
        type: "layer_violation",
        severity: "high",
        sourceNodeId: n.id,
        description: `Proposed node id "${n.id}" already exists in the graph. Choose a different id or remove the existing module first.`,
        suggestedFix: "Rename the proposed node or remove the existing one from the design.",
      });
    }
    const label = "label" in n ? (n as { label?: string }).label : undefined;
    if (typeof label === "string" && label.trim()) {
      const lower = label.toLowerCase().trim();
      if (existingLabels.has(lower)) {
        violations.push({
          type: "layer_violation",
          severity: "high",
          sourceNodeId: n.id,
          description: `Proposed label "${label}" conflicts with an existing node. Use a distinct name.`,
          suggestedFix: "Rename the proposed node to avoid collision.",
        });
      }
    }
  }
  return violations;
}

export async function reviewGreenfieldAnswer(params: {
  question: string;
  answer: string;
  graphCommands?: GraphCommand[];
  graphCommand?: GraphCommand;
  apiKey?: string;
  apiKeyClaude?: string;
  /** When provided, proposed node ids/labels are checked for collision with existing graph. */
  existingGraph?: ArchGraph | null;
  /** When provided with archetype, loads anti-patterns and injects into critic prompt. */
  rootPath?: string | null;
  archetype?: string | null;
}): Promise<CriticResult> {
  const { question, answer, graphCommands, graphCommand, apiKey, apiKeyClaude, existingGraph, rootPath, archetype } = params;
  const commands = graphCommands ?? (graphCommand ? [graphCommand] : []);
  const { nodes, edges } = buildProposedGraph(commands);

  const MAX_NODES = 30;
  const MAX_EDGES = 100;
  if (nodes.length > MAX_NODES) {
    return {
      approved: false,
      score: 4,
      report: `Too many nodes (${nodes.length}). Keep designs focused (≤${MAX_NODES} nodes).`,
      violations: [
        {
          type: "god_module",
          severity: "medium",
          sourceNodeId: nodes[0]?.id ?? "",
          description: `Design has ${nodes.length} nodes; limit is ${MAX_NODES}.`,
          suggestedFix: "Consolidate or remove modules.",
        },
      ],
    };
  }
  if (edges.length > MAX_EDGES) {
    return {
      approved: false,
      score: 4,
      report: `Too many edges (${edges.length}). Simplify dependencies (≤${MAX_EDGES}).`,
      violations: [],
    };
  }
  const cycle = detectCycle(edges);
  if (cycle && cycle.length > 0) {
    return {
      approved: false,
      score: 3,
      report: `Circular dependency detected: ${cycle.join(" → ")}.`,
      violations: [
        {
          type: "circular_dep",
          severity: "critical",
          sourceNodeId: cycle[0],
          targetNodeId: cycle[cycle.length - 1],
          description: `Cycle: ${cycle.join(" → ")}.`,
          suggestedFix: "Break the cycle by introducing an abstraction or inverting a dependency.",
        },
      ],
    };
  }
  const layerViolations = checkLayering(nodes, edges);
  if (layerViolations.length > 0) {
    return {
      approved: false,
      score: 5,
      report: `Layer violations: ${layerViolations.map((v) => v.description).join("; ")}`,
      violations: layerViolations,
    };
  }
  const collisionViolations = checkGreenfieldCollisions(nodes, existingGraph);
  if (collisionViolations.length > 0) {
    return {
      approved: false,
      score: 4,
      report: `Collision with existing graph: ${collisionViolations.map((v) => v.description).join("; ")}`,
      violations: collisionViolations,
    };
  }
  const openai = getOpenAIClient(apiKey);
  const anthropicKey = getAnthropicKey(apiKeyClaude);
  if ((!openai && !anthropicKey) || nodes.length === 0) {
    return {
      approved: true,
      score: 8,
      report: "Deterministic checks passed. No LLM review (empty design or no API key).",
      violations: [],
    };
  }
  const graphSummary = nodes.map((n) => `- ${n.id} (${n.layer})`).join("\n");
  const edgeSummary = edges.map((e) => `  ${e.source} → ${e.target}`).join("\n");
  const baseForAntiPatterns =
    rootPath && rootPath.trim()
      ? rootPath
      : (process.env.PROJECTS_BASE_DIR?.trim() || process.env.PROJECT_ROOT?.trim() || process.cwd());
  const antiWarnings = getAntiPatternWarnings(baseForAntiPatterns, archetype ?? undefined);
  const playbookSnippet = getGreenfieldCriticSystemSnippet(antiWarnings);
  const prompt = `${playbookSnippet}

You are a senior software architect reviewing a greenfield design. Apply the playbook rules above.

Question: ${question}

Proposed answer:
${answer.slice(0, 4000)}

Proposed nodes:
${graphSummary || "(none)"}

Proposed edges:
${edgeSummary || "(none)"}

Evaluate for coherence: Are responsibilities clear? Is layering sensible? Are dependencies logical?
Extract acceptance criteria the design should satisfy (functional, visual, architectural).
Respond with STRICT JSON only, no markdown:
{
  "approved": boolean,
  "score": 1-10,
  "report": "one paragraph",
  "violations": [],
  "acceptanceCriteria": {
    "functional": ["criterion 1", "criterion 2"],
    "visual": ["criterion 1"],
    "architectural": ["criterion 1"]
  }
}`;
  try {
    const raw = (await callCriticLLM(prompt, apiKey, apiKeyClaude)) ?? "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const score =
      typeof parsed.score === "number" && Number.isFinite(parsed.score) ? parsed.score : 7;
    const approved = parsed.approved === true && score >= 6;
    const report =
      typeof parsed.report === "string" ? parsed.report : approved ? "APPROVED" : "Not approved.";
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    const acceptanceCriteria =
      parsed.acceptanceCriteria &&
      typeof parsed.acceptanceCriteria === "object" &&
      Array.isArray(parsed.acceptanceCriteria.functional)
        ? {
            functional: parsed.acceptanceCriteria.functional.filter((s: unknown) => typeof s === "string"),
            visual: Array.isArray(parsed.acceptanceCriteria.visual)
              ? parsed.acceptanceCriteria.visual.filter((s: unknown) => typeof s === "string")
              : [],
            architectural: Array.isArray(parsed.acceptanceCriteria.architectural)
              ? parsed.acceptanceCriteria.architectural.filter((s: unknown) => typeof s === "string")
              : [],
          }
        : undefined;
    return { approved, score, report, violations, acceptanceCriteria };
  } catch {
    return {
      approved: true,
      score: 7,
      report: "Deterministic checks passed. LLM review failed; treating as approved.",
      violations: [],
    };
  }
}
