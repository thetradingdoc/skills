import OpenAI from "openai";
import {
  ArchGraph,
  ArchNode,
  ContractFinding,
  EnrichmentResult,
  GraphCommand,
  NodeLayer,
  SemanticSignals,
} from "../types";

export type AskResult = { answer: string; graphCommand?: GraphCommand };

function getClient(apiKey?: string): OpenAI | null {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  return key ? new OpenAI({ apiKey: key }) : null;
}

const VALID_LAYERS: NodeLayer[] = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

function isValidLayer(v: string): v is NodeLayer {
  return VALID_LAYERS.includes(v as NodeLayer);
}

function buildEnrichmentPrompt(node: ArchNode): string {
  const signals: SemanticSignals = node.semanticSignals ?? {
    exports: [],
    externalImports: [],
    fileCount: node.files.length,
  };
  const fileCount = signals.fileCount ?? node.files.length;
  return `You are an expert software architect. Analyze this code module and classify it.

Module path: ${node.id}
Folder name: ${node.label}
Files (${fileCount}): ${node.files.slice(0, 5).join(", ")}${node.files.length > 5 ? ` ...+${node.files.length - 5} more` : ""}
Exported symbols: ${(signals.exports ?? []).slice(0, 10).join(", ") || "(none detected)"}
External libraries used: ${(signals.externalImports ?? []).join(", ") || "(none)"}

Respond with ONLY a valid JSON object — no markdown, no explanation:
{
  "suggestedLabel": "<clear human-readable module name, max 3 words>",
  "layer": "<one of: Presentation | Business Logic | Data Access | Infrastructure | External Services | Utilities | Configuration | Uncategorized>",
  "description": "<one sentence explaining what this module does>",
  "status": "<one of: stable | new | deprecated | unknown | warning>",
  "confidence": "<one of: high | medium | low>"
}`;
}

async function enrichNode(node: ArchNode, client: OpenAI): Promise<EnrichmentResult> {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 256,
      messages: [{ role: "user", content: buildEnrichmentPrompt(node) }],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Partial<EnrichmentResult>;

    return {
      suggestedLabel:
        typeof parsed.suggestedLabel === "string" && parsed.suggestedLabel
          ? parsed.suggestedLabel
          : node.label,
      layer: isValidLayer(parsed.layer ?? "") ? parsed.layer! : "Uncategorized",
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      status: ["stable", "new", "deprecated", "unknown", "warning", "error"].includes(
        parsed.status ?? ""
      )
        ? (parsed.status as EnrichmentResult["status"])
        : "unknown",
      confidence: (parsed.confidence as EnrichmentResult["confidence"]) ?? "low",
    };
  } catch (err) {
    console.error(`[enricher] Failed to enrich ${node.id}:`, err);
    return {
      suggestedLabel: node.label,
      layer: "Uncategorized",
      description: "",
      status: "unknown",
      confidence: "low",
    };
  }
}

async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  async function run(): Promise<void> {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
}

export async function enrichGraph(graph: ArchGraph, apiKey?: string): Promise<ArchGraph> {
  const client = getClient(apiKey);
  if (!client) {
    return graph;
  }

  const enriched = graph.nodes.map((n) => ({ ...n }));

  await withConcurrency(enriched, 3, async (node) => {
    if (
      node.suggestedLabel &&
      node.layer &&
      node.layer !== "Uncategorized"
    )
      return;
    const result = await enrichNode(node, client);
    node.suggestedLabel = result.suggestedLabel;
    node.layer = result.layer;
    node.description = result.description;
    node.role = result.suggestedLabel;
    if (!node.status || node.status === "unknown") {
      node.status = result.status;
    }
  });

  return { ...graph, nodes: enriched };
}

const VALID_LAYERS_FOR_CMD: NodeLayer[] = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

function parseGraphCommand(raw: unknown): GraphCommand | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const action = o.action;
  if (action === "highlight_nodes" && Array.isArray(o.nodeIds)) {
    const nodeIds = o.nodeIds.filter((id): id is string => typeof id === "string");
    if (nodeIds.length > 0) return { action: "highlight_nodes", nodeIds };
  }
  if (action === "filter_layer" && typeof o.layer === "string" && VALID_LAYERS_FOR_CMD.includes(o.layer as NodeLayer)) {
    return { action: "filter_layer", layer: o.layer as NodeLayer };
  }
  if (action === "filter_edge_type" && typeof o.edgeType === "string") {
    const edgeType = o.edgeType as "arch" | "drift" | "violations" | "all";
    if (["arch", "drift", "violations", "all"].includes(edgeType)) {
      return { action: "filter_edge_type", edgeType };
    }
  }
  if (action === "focus_node" && typeof o.nodeId === "string") {
    return { action: "focus_node", nodeId: o.nodeId };
  }
  if (action === "reset") return { action: "reset" };
  return undefined;
}

export async function askAboutArchitecture(
  question: string,
  graph: ArchGraph,
  nodeId?: string,
  history?: { role: "user" | "assistant"; content: string }[],
  apiKey?: string,
  findings?: ContractFinding[]
): Promise<AskResult> {
  const client = getClient(apiKey);
  if (!client) {
    return { answer: `[No API key] You asked: "${question}". Set archVisualizer.openaiApiKey or OPENAI_API_KEY to enable AI Q&A.` };
  }

  const focusNode = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;

  const graphSummary = graph.nodes
    .map(
      (n) =>
        `- ${n.suggestedLabel ?? n.label} (${n.layer ?? "?"}) [${n.id}]: ${n.description ?? ""}`
    )
    .join("\n");

  const edgeSummary = graph.edges
    .slice(0, 40)
    .map((e) => {
      const src =
        graph.nodes.find((n) => n.id === e.source)?.suggestedLabel ?? e.source;
      const tgt =
        graph.nodes.find((n) => n.id === e.target)?.suggestedLabel ?? e.target;
      return `  ${src} → ${tgt}${e.isDrift ? " ⚠ DRIFT" : ""}`;
    })
    .join("\n");

  const context = focusNode
    ? `\nFocused module: ${focusNode.suggestedLabel ?? focusNode.label}
Path: ${focusNode.id}
Layer: ${focusNode.layer}
Description: ${focusNode.description}
Exports: ${(focusNode.semanticSignals?.exports ?? []).join(", ")}
Uses: ${(focusNode.semanticSignals?.externalImports ?? []).join(", ")}
Files: ${focusNode.files.length}`
    : "";

  const importantFindings =
    findings?.filter((f) => f.severity === "critical" || f.severity === "warning") ?? [];
  const findingsSummary =
    importantFindings.length > 0
      ? importantFindings
          .slice(0, 20)
          .map((f) => `- [${f.severity}] ${f.type} at ${f.location}: ${f.description}`)
          .join("\n")
      : "None detected by static analysis.";

  const nodeIdList = graph.nodes.map((n) => `"${n.id}"`).join(", ");
  const prompt = `You are an expert software architect reviewing a codebase.

Architecture overview (${graph.nodes.length} modules):
${graphSummary}

Key connections:
${edgeSummary}
${context}

Known issues from static analysis:
${findingsSummary}

When the user asks to SHOW, HIGHLIGHT, or FILTER (e.g. "show me the Business Logic layer", "what's violating?", "where does X connect?"), you must also output a graphCommand.

Respond with valid JSON only:
{"answer": "<your text answer>", "graphCommand": <optional>}

graphCommand (include ONLY when user wants to see/focus on something):
- "show me the X layer" / "filter to X" → {"action":"filter_layer","layer":"<Presentation|Business Logic|Data Access|Infrastructure|External Services|Utilities|Configuration|Uncategorized>"}
- "what's violating?" / "show violations" → {"action":"filter_edge_type","edgeType":"violations"}
- "show drift" / "drift edges" → {"action":"filter_edge_type","edgeType":"drift"}
- "where does X connect?" / "focus on X" → {"action":"highlight_nodes","nodeIds":["<nodeId>","<neighbourId>",...]} — use exact ids from: ${nodeIdList.slice(0, 800)}
- "focus node X" → {"action":"focus_node","nodeId":"<exact node id>"}
- "reset" / "show all" → {"action":"reset"}
- "filter_edge_type" edgeType can be: "arch" | "drift" | "violations" | "all"

If the question is purely explanatory (why, how, what), omit graphCommand.

${history?.length ? `Previous:\n${history.map((h) => `${h.role}: ${(h.content as string).slice(0, 150)}`).join("\n")}\n\n` : ""}User: ${question}

Output valid JSON:`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let parsed: { answer?: string; graphCommand?: unknown };
    try {
      parsed = JSON.parse(cleaned) as { answer?: string; graphCommand?: unknown };
    } catch {
      return { answer: raw || "No response." };
    }
    const answer = typeof parsed.answer === "string" && parsed.answer ? parsed.answer : raw || "No response.";
    const graphCommand = parseGraphCommand(parsed.graphCommand);
    return { answer, ...(graphCommand ? { graphCommand } : {}) };
  } catch (err) {
    return { answer: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
