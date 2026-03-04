import * as fs from "fs";
import * as path from "path";
import { ArchGraph, ArchNode, NodeKind, NodeLayer } from "../types";
import { readContextFile } from "../analyzer/contextReader";

// ── Keyword → Layer mapping ───────────────────────────────────────────────────
const VALID_LAYERS: Set<NodeLayer> = new Set([
  "Presentation",
  "Orchestration",
  "Reasoning",
  "Business Logic",
  "Memory",
  "Data Access",
  "Safety",
  "External Services",
  "Infrastructure",
  "Utilities",
  "Configuration",
  "Uncategorized",
]);

function isValidLayer(s: string): s is NodeLayer {
  return VALID_LAYERS.has(s as NodeLayer);
}

const LAYER_RULES: Array<{
  patterns: RegExp[];
  layer: NodeLayer;
  labelFn?: (id: string) => string;
}> = [
  {
    patterns: [
      /ui|view|page|screen|component|dashboard|frontend|layout|display|render|template|panel/i,
    ],
    layer: "Presentation",
  },
  {
    patterns: [/orchestrat|workflow|coordinator|pipeline|choreograph/i],
    layer: "Orchestration",
  },
  {
    patterns: [/reasoning|llm|agent|claude|openai|anthropic|gpt|inference/i],
    layer: "Reasoning",
  },
  {
    patterns: [/memory|vector|embedding|store|cache|pinecone|weaviate|retrieval/i],
    layer: "Memory",
  },
  {
    patterns: [/guardrail|safety|validator|rate.?limit|content.?filter|output.?validat/i],
    layer: "Safety",
  },
  {
    patterns: [/auth|login|session|jwt|oauth|permission|role|user|account/i],
    layer: "Business Logic",
    labelFn: () => "Auth Service",
  },
  {
    patterns: [
      /payment|billing|invoice|stripe|order|checkout|cart|purchase|transaction/i,
    ],
    layer: "Business Logic",
  },
  {
    patterns: [
      /service|handler|controller|manager|processor|workflow|logic|business|core|domain/i,
    ],
    layer: "Business Logic",
  },
  {
    patterns: [
      /route|router|api|endpoint|rest|graphql|middleware|adapter|gateway|proxy/i,
    ],
    layer: "Business Logic",
  },
  {
    patterns: [
      /notification|email|sms|push|webhook|event|message|queue|worker/i,
    ],
    layer: "External Services",
  },
  {
    patterns: [
      /db|database|model|schema|entity|repository|migration|query|store|prisma|mongo|postgres|mysql|redis|cache/i,
    ],
    layer: "Data Access",
  },
  {
    patterns: [/server|app|main|index|boot|init|startup|entry|cluster/i],
    layer: "Infrastructure",
  },
  {
    patterns: [/config|env|setting|constant|flag|feature|secret/i],
    layer: "Configuration",
  },
  {
    patterns: [
      /util|helper|lib|tool|common|shared|format|parse|validate|transform|convert/i,
    ],
    layer: "Utilities",
  },
  {
    patterns: [/script|task|job|cron|batch|seed|fixture|migration/i],
    layer: "Utilities",
  },
];

// External library signals → layer hints
const EXTERNAL_LAYER_HINTS: Array<{
  packages: RegExp;
  layer: NodeLayer;
}> = [
  {
    packages: /^(react|vue|angular|next|nuxt|svelte|remix|gatsby)/,
    layer: "Presentation",
  },
  {
    packages: /^(anthropic|openai|@anthropic-ai|ollama|langchain)/,
    layer: "Reasoning",
  },
  {
    packages: /^(pinecone|weaviate|qdrant|chroma|@langchain\/vectorstores)/,
    layer: "Memory",
  },
  {
    packages: /^(prisma|mongoose|sequelize|typeorm|knex|pg|mysql2|redis|ioredis)/,
    layer: "Data Access",
  },
  { packages: /^(stripe|paypal|braintree)/, layer: "Business Logic" },
  {
    packages: /^(sendgrid|nodemailer|twilio|mailgun|amplitude|mixpanel|segment)/,
    layer: "External Services",
  },
  { packages: /^(express|fastify|koa|hapi|nest)/, layer: "Infrastructure" },
  { packages: /^(jwt|passport|bcrypt|argon2)/, layer: "Business Logic" },
];

function inferLayer(node: ArchNode): NodeLayer {
  const segments = node.id.toLowerCase().split("/");
  const lastName = segments[segments.length - 1] ?? "";
  const allParts = segments.join(" ");

  const sig = node.semanticSignals ?? {
    exports: [],
    externalImports: [],
    fileCount: 0,
  };

  // 1. Check folder/file name patterns
  for (const rule of LAYER_RULES) {
    if (rule.patterns.some((p) => p.test(lastName) || p.test(allParts))) {
      return rule.layer;
    }
  }

  // 2. Check external imports
  for (const hint of EXTERNAL_LAYER_HINTS) {
    if (
      (sig.externalImports ?? []).some((pkg) => hint.packages.test(pkg))
    ) {
      return hint.layer;
    }
  }

  // 3. Check export names
  const exportStr = (sig.exports ?? []).join(" ").toLowerCase();
  if (/route|controller|handler|endpoint/.test(exportStr))
    return "Business Logic";
  if (/model|schema|entity|repository/.test(exportStr)) return "Data Access";
  if (/config|env|setting/.test(exportStr)) return "Configuration";
  if (/util|helper|format|parse/.test(exportStr)) return "Utilities";

  return "Uncategorized";
}

function inferLabel(node: ArchNode, layer: NodeLayer): string {
  const base = node.label
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

  const titled = base.replace(/\b\w/g, (c) => c.toUpperCase());

  const suffixes: Partial<Record<NodeLayer, string>> = {
    "Data Access": "Repository",
    Infrastructure: "Server",
    Configuration: "Config",
    "External Services": "Service",
  };
  const suffix = suffixes[layer];
  if (suffix && !titled.toLowerCase().includes(suffix.toLowerCase())) {
    return `${titled} ${suffix}`;
  }
  return titled;
}

function inferStatus(node: ArchNode): ArchNode["status"] {
  const h = node.health ?? { hasDocs: false, hasTests: false, hasContext: false };
  if (h.hasTests && h.hasDocs) return "stable";
  if (!h.hasTests && !h.hasDocs && !h.hasContext) return "warning";
  if (node.files.length === 0) return "unknown";
  return "stable";
}

// ── AI-specific kind inference ───────────────────────────────────────────────
const LLM_PACKAGES: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /^(anthropic|@anthropic-ai\/sdk)/, provider: "anthropic" },
  { pattern: /^(openai|@openai\/)/, provider: "openai" },
  { pattern: /^(ollama|ollama)/, provider: "ollama" },
  { pattern: /^(langchain|@langchain)/, provider: "langchain" },
];

const RAG_PATTERNS =
  /vector|embedding|pinecone|weaviate|qdrant|chroma|faiss|retrieval|rag|semantic.?search/i;

const GUARDRail_PATTERNS =
  /guardrail|rate.?limit|output.?validat|content.?filter|auth.?middleware|pii.?detect/i;

function inferKind(node: ArchNode): NodeKind {
  const sig = node.semanticSignals ?? {
    exports: [],
    externalImports: [],
    fileCount: 0,
  };
  const ext = (sig.externalImports ?? []).map((x) => x.toLowerCase());
  const allText = [
    node.id,
    node.description ?? "",
    (sig.exports ?? []).join(" "),
    ext.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (GUARDRail_PATTERNS.test(allText)) return "guardrail";

  const hasLlm = ext.some((pkg) =>
    LLM_PACKAGES.some(({ pattern }) => pattern.test(pkg))
  );

  // Orchestrator: coordinates multiple agents / workflows.
  const segs = node.id.toLowerCase().split("/");
  const isOrchestratorHint = segs.some((s) =>
    /orchestrat|coordinat|workflow|pipeline/.test(s)
  );
  if (hasLlm && isOrchestratorHint) return "orchestrator";

  if (hasLlm) return "agent";

  if (RAG_PATTERNS.test(allText)) return "module"; // could refine further if needed

  if (
    segs.some(
      (s) =>
        s === "docker" ||
        s === "k8s" ||
        s === "infra" ||
        s === "ci" ||
        s === "workflows"
    )
  ) {
    return "infra";
  }

  return "module";
}

function inferLlmProvider(node: ArchNode): string | undefined {
  const sig = node.semanticSignals ?? { externalImports: [], exports: [], fileCount: 0 };
  const ext = sig.externalImports ?? [];
  for (const pkg of ext) {
    const m = LLM_PACKAGES.find(({ pattern }) => pattern.test(pkg.toLowerCase()));
    if (m) return m.provider;
  }
  return undefined;
}

function inferHasRAG(node: ArchNode): boolean {
  const sig = node.semanticSignals ?? { externalImports: [], exports: [], fileCount: 0 };
  const allText = [
    node.id,
    node.description ?? "",
    (sig.externalImports ?? []).join(" "),
    (sig.exports ?? []).join(" "),
  ].join();
  return RAG_PATTERNS.test(allText);
}

function inferToolCount(node: ArchNode): number {
  const sig = node.semanticSignals ?? { externalImports: [], exports: [], fileCount: 0 };
  const exports = sig.exports ?? [];
  const toolNames = ["tool", "tools", "executeTool", "runTool", "invokeTool"];
  let count = 0;
  for (const exp of exports) {
    if (toolNames.some((t) => exp.toLowerCase().includes(t))) count++;
  }
  return count > 0 ? count : 0;
}

function generateDescription(node: ArchNode, layer: NodeLayer): string {
  const sig = node.semanticSignals ?? {
    exports: [],
    externalImports: [],
    fileCount: 0,
  };
  const ext = sig.externalImports ?? [];
  if (ext.length > 0) {
    return `${layer} module using ${ext.slice(0, 3).join(", ")}`;
  }
  const exports = sig.exports ?? [];
  if (exports.length > 0) {
    return `Exports: ${exports.slice(0, 3).join(", ")}`;
  }
  return `${layer} module — ${node.files.length} file${node.files.length === 1 ? "" : "s"}`;
}

function getModuleDir(nodeId: string, projectRoot: string): string {
  return path.join(
    projectRoot,
    /\.[a-z]+$/i.test(nodeId) ? path.dirname(nodeId) : nodeId
  );
}

// ── Main heuristic enricher ──────────────────────────────────────────────────
export async function enrichGraphHeuristic(graph: ArchGraph): Promise<ArchGraph> {
  const nodes = graph.nodes.map((node) => {
    const moduleDir = getModuleDir(node.id, graph.projectRoot);
    const context = readContextFile(moduleDir);

    if (context?.layer && isValidLayer(context.layer)) {
      const layer = context.layer as NodeLayer;
      const kind = inferKind(node);
      const llmProvider = kind === "agent" ? inferLlmProvider(node) : undefined;
      const hasRAG = inferHasRAG(node);
      const toolCount = kind === "agent" ? inferToolCount(node) : undefined;
      return {
        ...node,
        layer,
        suggestedLabel: context.role ?? node.label,
        role: context.role ?? inferLabel(node, layer),
        description: context.description ?? node.description ?? generateDescription(node, layer),
        status: inferStatus(node),
        kind,
        ...(llmProvider && { llmProvider }),
        ...(hasRAG && { hasRAG: true }),
        ...(toolCount != null && toolCount > 0 && { toolCount }),
      };
    }

    if (
      node.layer &&
      node.layer !== "Uncategorized" &&
      node.suggestedLabel
    ) {
      return node;
    }

    const layer = inferLayer(node);
    const label = inferLabel(node, layer);
    const status = inferStatus(node);
    const kind = inferKind(node);
    const llmProvider = kind === "agent" ? inferLlmProvider(node) : undefined;
    const hasRAG = inferHasRAG(node);
    const toolCount = kind === "agent" ? inferToolCount(node) : undefined;

    return {
      ...node,
      layer,
      suggestedLabel: label,
      role: label,
      status,
      description: node.description ?? generateDescription(node, layer),
      kind,
      ...(llmProvider && { llmProvider }),
      ...(hasRAG && { hasRAG: true }),
      ...(toolCount != null && toolCount > 0 && { toolCount }),
    };
  });

  return { ...graph, nodes };
}

// ── OpenAI enricher (real AI, requires OPENAI_API_KEY) ────────────────────────
const classificationCache = new Map<
  string,
  Partial<Pick<ArchNode, "layer" | "suggestedLabel" | "description" | "status">>
>();

function moduleFingerprint(node: ArchNode): string {
  return `${node.id}:${node.files.slice().sort().join(",")}`;
}

async function enrichGraphWithOpenAI(
  graph: ArchGraph,
  apiKey?: string
): Promise<ArchGraph> {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return enrichGraphHeuristic(graph);
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: key });

  const results = await Promise.allSettled(
    graph.nodes.map(async (node) => {
      if (node.layer && node.layer !== "Uncategorized") return node;

      const fp = moduleFingerprint(node);
      const cached = classificationCache.get(fp);
      if (cached) {
        return { ...node, ...cached };
      }

      const sig = node.semanticSignals ?? {
        exports: [],
        externalImports: [],
        fileCount: 0,
      };

      let snippet = "";
      try {
        const mainPath =
          node.files.find((f) => /index|main/i.test(path.basename(f))) ??
          node.files[0];
        if (mainPath) {
          const fullPath = path.join(graph.projectRoot, mainPath);
          if (fs.existsSync(fullPath)) {
            snippet = fs.readFileSync(fullPath, "utf-8").slice(0, 400);
          }
        }
      } catch {
        // ignore snippet errors
      }

      const snippetBlock = snippet
        ? `\nFirst lines of main file:\n${snippet}\n`
        : "";

      const prompt = `You are a software architect. Classify this module:

Path: ${node.id}
Files (${node.files.length}): ${node.files.slice(0, 4).join(", ")}
Exports: ${(sig.exports ?? []).slice(0, 8).join(", ") || "(none)"}
External libs: ${(sig.externalImports ?? []).join(", ") || "(none)"}

${snippetBlock}

Return ONLY valid JSON (no markdown):
{"suggestedLabel":"<2-3 word name>","layer":"<Presentation|Orchestration|Reasoning|Business Logic|Memory|Data Access|Safety|External Services|Infrastructure|Utilities|Configuration|Uncategorized>","description":"<one sentence>","status":"<stable|new|warning|deprecated|unknown>"}`;

      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 200,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }],
        });
        const text = completion.choices[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        const merged: ArchNode = { ...node, ...parsed };
        classificationCache.set(fp, {
          layer: merged.layer,
          suggestedLabel: merged.suggestedLabel,
          description: merged.description,
          status: merged.status,
        });
        return merged;
      } catch {
        const layer = inferLayer(node);
        return {
          ...node,
          layer,
          suggestedLabel: inferLabel(node, layer),
          status: inferStatus(node),
        };
      }
    })
  );

  return {
    ...graph,
    nodes: results.map((r, i) =>
      r.status === "fulfilled" ? r.value : graph.nodes[i]!
    ),
  };
}

// ── Auto-select: try OpenAI, fall back to heuristic ───────────────────────────
export async function enrichGraph(
  graph: ArchGraph,
  apiKey?: string
): Promise<ArchGraph> {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (key) {
    return enrichGraphWithOpenAI(graph, key);
  }
  return enrichGraphHeuristic(graph);
}
