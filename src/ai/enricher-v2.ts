import * as fs from "fs";
import * as path from "path";
import { ArchGraph, ArchNode, NodeKind, NodeLayer } from "../types";
import { readContextFile } from "../analyzer/contextReader";
import { classifySubsystem } from "../analyzer/subsystemClassify";
import { refineGraphNodeLabels } from "../analyzer/nodeLabel";

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

/** Model / agent SDKs — import evidence for Reasoning (path keywords are fallback only). */
const REASONING_PACKAGES = [
  "openai",
  "anthropic",
  "@anthropic-ai/sdk",
  "groq-sdk",
  "retell-sdk",
  "retell-client",
  "retell-ai",
  "cohere",
  "mistralai",
  "together-ai",
  "replicate",
  "@google/generative-ai",
  "@aws-sdk/client-bedrock-runtime",
  "@google-cloud/vertexai",
  "langchain",
  "llamaindex",
  "crewai",
  "autogen",
  "semantic-kernel",
  "livekit-agents",
  "pipecat",
  "vapi",
] as const;

/** Vector / embedding clients — import evidence for Memory. */
const MEMORY_PACKAGES = [
  "pinecone",
  "@pinecone-database/pinecone",
  "weaviate",
  "chromadb",
  "qdrant",
  "@qdrant/js-client-rest",
  "pgvector",
  "faiss",
] as const;

const AGENT_KEYWORD_LAYERS: Set<NodeLayer> = new Set([
  "Reasoning",
  "Memory",
  "Safety",
]);

/** Tools is detected as agent evidence but is not a NodeLayer — see assignLayer. */
type AgentEvidenceLayer = "Reasoning" | "Memory" | "Safety" | "Tools";

export type AgentLayerEvidence = {
  layer: AgentEvidenceLayer;
  evidence: string;
};

function normalizePkgName(pkg: string): string {
  return pkg.toLowerCase().replace(/^@/, "").trim();
}

function packageMatchesKnown(imported: string, known: string): boolean {
  const a = normalizePkgName(imported);
  const b = normalizePkgName(known);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b + "/") || b.startsWith(a + "/")) return true;
  const a0 = a.split("/")[0] ?? a;
  const b0 = b.split("/")[0] ?? b;
  // Avoid short false positives (e.g. "ai")
  if (a0.length >= 4 && a0 === b0) return true;
  return false;
}

function findMatchingPackage(
  imports: string[],
  known: readonly string[]
): string | undefined {
  for (const imp of imports) {
    for (const k of known) {
      if (packageMatchesKnown(imp, k)) return k;
    }
  }
  return undefined;
}

const CONTENT_IMPORT_RE =
  /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

const SAFETY_CONTENT_RE =
  /(?:pii|phi).{0,40}redact|redact.{0,40}(?:pii|phi)|(?:^|[^a-z])(?:run|apply|check|enforce)Guardrail|moderation\.create|\/v1\/moderations|content.?filter.{0,40}(?:llm|model|prompt|completion)/i;

const MEMORY_STATE_RE =
  /conversation.?state|conversation.?memory|voice_conversation_memory|appendConversationMemory|session.?ssot|transcript.?stor|persist(?:s|ed|ing)?.{0,40}transcript|chat.?history|INSERT\s+INTO\s+health_sessions/i;

const MEMORY_VECTOR_MENTION_RE =
  /(?:require|from|import)\s*\(?\s*['"][^'"]*(?:pinecone|weaviate|chromadb|qdrant|pgvector|faiss)/i;

const TOOL_DEF_RE =
  /\btools?\s*[:=]|function.?definitions?|tool_choice|type\s*:\s*['"]function['"]|executeTool|tool-allowlist|toolAllowlist/i;

/** Path buckets where content mentions of pinecone/guardrail are usually incidental. */
function isIncidentalAgentPath(nodeId: string): boolean {
  return /(^|\/)(migrations?|scripts?|tests?|e2e|__tests__|fixtures?|seeds?|config|\.github)(\/|$)/i.test(
    nodeId
  );
}

function isCodeSourceFile(relPath: string): boolean {
  return /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(relPath);
}

function collectImportsFromFiles(
  node: ArchNode,
  projectRoot: string,
  maxFiles = 80
): string[] {
  const found = new Set<string>();
  const files = (node.files ?? []).filter(isCodeSourceFile);
  const slice =
    files.length <= maxFiles
      ? files
      : [
          ...files.filter((f) =>
            /llm|agent|rag|pinecone|retell|groq|openai|anthropic|embedding|vector|redact|guard|moderat|tool|memory|transcript|session/i.test(
              f
            )
          ),
          ...files.slice(0, maxFiles),
        ].slice(0, maxFiles * 2);

  for (const rel of slice) {
    const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
    let text: string;
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.length > 400_000) text = text.slice(0, 400_000);
    CONTENT_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CONTENT_IMPORT_RE.exec(text)) !== null) {
      const spec = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!spec || spec.startsWith(".")) continue;
      const raw = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0] ?? spec;
      if (raw) found.add(raw);
    }
  }
  return [...found];
}

function sampleFileText(
  node: ArchNode,
  projectRoot: string,
  maxFiles = 40
): string {
  const parts: string[] = [];
  const files = (node.files ?? []).filter(isCodeSourceFile);
  const preferred = files.filter((f) =>
    /redact|guard|safety|moderat|pii|phi|memory|transcript|session|tool|llm|agent|rag|pinecone|embedding|retell|groq|openai/i.test(
      f
    )
  );
  const ordered = [...preferred, ...files.filter((f) => !preferred.includes(f))];
  for (const rel of ordered.slice(0, maxFiles)) {
    const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      let text = fs.readFileSync(abs, "utf8");
      if (text.length > 80_000) text = text.slice(0, 80_000);
      parts.push(rel + "\n" + text);
    } catch {
      /* ignore */
    }
  }
  return parts.join("\n");
}

/**
 * Import / content evidence for agent layers.
 * Priority when multiple hit: Reasoning > Memory > Safety > Tools.
 * Keyword path rules are NOT consulted here — callers use them as fallback.
 */
export function detectAgentLayerEvidence(
  node: ArchNode,
  projectRoot: string
): AgentLayerEvidence | null {
  const sig = node.semanticSignals ?? {
    exports: [],
    externalImports: [],
    fileCount: 0,
  };
  let imports = [...(sig.externalImports ?? [])];

  const reasoningFromImports = findMatchingPackage(imports, REASONING_PACKAGES);
  if (reasoningFromImports) {
    return {
      layer: "Reasoning",
      evidence: `imports ${reasoningFromImports}`,
    };
  }

  const memoryFromImports = findMatchingPackage(imports, MEMORY_PACKAGES);
  if (memoryFromImports) {
    return {
      layer: "Memory",
      evidence: `imports ${memoryFromImports}`,
    };
  }

  // Imports truncated / incomplete — scan file contents for known packages.
  // Soft content signals skipped for incidental paths (config/migrations/scripts/CI).
  const incidental = isIncidentalAgentPath(node.id);
  if (projectRoot && (node.files?.length ?? 0) > 0) {
    const contentImports = collectImportsFromFiles(node, projectRoot);
    imports = [...new Set([...imports, ...contentImports])];

    const reasoningContent = findMatchingPackage(imports, REASONING_PACKAGES);
    if (reasoningContent) {
      return {
        layer: "Reasoning",
        evidence: `imports ${reasoningContent} (file content)`,
      };
    }
    const memoryContent = findMatchingPackage(imports, MEMORY_PACKAGES);
    if (memoryContent) {
      return {
        layer: "Memory",
        evidence: `imports ${memoryContent} (file content)`,
      };
    }

    if (incidental) {
      return null;
    }

    const body = sampleFileText(node, projectRoot);
    const fileNames = (node.files ?? []).join(" ");

    if (
      /\bretell-ai\b|\bretell-sdk\b|retell-client|require\s*\(\s*['"]retell(?:-ai|-sdk)?['"]|from\s+['"]retell|new\s+Retell\b|class\s+RetellWebSocket|livekit-agents/i.test(
        body
      ) ||
      /(?:^|\/)retell-handler\.js|(?:^|\/)retell-websocket\.js|kelly-pa-video-orchestrator/i.test(
        fileNames
      )
    ) {
      return {
        layer: "Reasoning",
        evidence: "Retell/LiveKit agent runtime usage in module files",
      };
    }

    if (
      SAFETY_CONTENT_RE.test(body) ||
      /pii-redactor|phi-safe|redaction-service/i.test(fileNames)
    ) {
      return {
        layer: "Safety",
        evidence:
          "PII/PHI redaction, guardrail, or model-output validation in module files",
      };
    }
    if (
      MEMORY_STATE_RE.test(body) ||
      MEMORY_STATE_RE.test(fileNames) ||
      MEMORY_VECTOR_MENTION_RE.test(body)
    ) {
      return {
        layer: "Memory",
        evidence: MEMORY_VECTOR_MENTION_RE.test(body)
          ? "vector store / embedding client import in module files"
          : "persists conversation/session/transcript state",
      };
    }
    if (
      TOOL_DEF_RE.test(body) ||
      (sig.exports ?? []).some((e) =>
        /tool|executeTool|runTool|invokeTool/i.test(e)
      )
    ) {
      return {
        layer: "Tools",
        evidence: "exports or defines model tool/function handlers",
      };
    }
  }

  return null;
}

function inferLayerFromKeywords(
  node: ArchNode,
  opts?: { skipAgentKeywordLayers?: boolean }
): NodeLayer | null {
  const segments = node.id.toLowerCase().split("/");
  const lastName = segments[segments.length - 1] ?? "";
  const allParts = segments.join(" ");

  for (const rule of LAYER_RULES) {
    if (
      opts?.skipAgentKeywordLayers &&
      AGENT_KEYWORD_LAYERS.has(rule.layer)
    ) {
      continue;
    }
    if (rule.patterns.some((p) => p.test(lastName) || p.test(allParts))) {
      return rule.layer;
    }
  }
  return null;
}

function inferLayerFromExternalsAndExports(node: ArchNode): NodeLayer {
  const sig = node.semanticSignals ?? {
    exports: [],
    externalImports: [],
    fileCount: 0,
  };

  for (const hint of EXTERNAL_LAYER_HINTS) {
    if ((sig.externalImports ?? []).some((pkg) => hint.packages.test(pkg))) {
      return hint.layer;
    }
  }

  const exportStr = (sig.exports ?? []).join(" ").toLowerCase();
  if (/route|controller|handler|endpoint/.test(exportStr))
    return "Business Logic";
  if (/model|schema|entity|repository/.test(exportStr)) return "Data Access";
  if (/config|env|setting/.test(exportStr)) return "Configuration";
  if (/util|helper|format|parse/.test(exportStr)) return "Utilities";

  return "Uncategorized";
}

/**
 * Resolve layer: agent import/content evidence wins over path keywords.
 * Tools is agent evidence but not a NodeLayer — falls through to non-agent keywords.
 */
function assignLayer(
  node: ArchNode,
  agentHit: AgentLayerEvidence | null
): { layer: NodeLayer; evidence?: string } {
  if (
    agentHit &&
    (agentHit.layer === "Reasoning" ||
      agentHit.layer === "Memory" ||
      agentHit.layer === "Safety")
  ) {
    return { layer: agentHit.layer, evidence: agentHit.evidence };
  }

  const skipAgentKeywords = agentHit?.layer === "Tools";
  const keywordLayer = inferLayerFromKeywords(node, {
    skipAgentKeywordLayers: skipAgentKeywords,
  });
  if (keywordLayer) {
    return {
      layer: keywordLayer,
      evidence: agentHit
        ? `Tools signal (${agentHit.evidence}); keyword fallback → ${keywordLayer}`
        : undefined,
    };
  }

  return {
    layer: inferLayerFromExternalsAndExports(node),
    evidence: agentHit
      ? `Tools signal (${agentHit.evidence}); non-keyword fallback`
      : undefined,
  };
}

/** @deprecated Prefer assignLayer with precomputed agent evidence. Kept for callers. */
function inferLayer(node: ArchNode, projectRoot = ""): NodeLayer {
  return assignLayer(node, detectAgentLayerEvidence(node, projectRoot)).layer;
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
  const projectRoot = graph.projectRoot ?? "";

  // Pass 1: import/content evidence per node
  const agentHits = new Map<string, AgentLayerEvidence>();
  for (const node of graph.nodes) {
    const hit = detectAgentLayerEvidence(node, projectRoot);
    if (hit) agentHits.set(node.id, hit);
  }

  // Pass 2: Tools — modules referenced (imported) by a Reasoning module
  const reasoningIds = new Set(
    [...agentHits.entries()]
      .filter(([, h]) => h.layer === "Reasoning")
      .map(([id]) => id)
  );
  for (const edge of graph.edges ?? []) {
    if (!reasoningIds.has(edge.source)) continue;
    if (agentHits.has(edge.target)) continue;
    agentHits.set(edge.target, {
      layer: "Tools",
      evidence: `referenced by Reasoning node ${edge.source}`,
    });
  }

  const nodes = graph.nodes.map((node) => {
    const moduleDir = getModuleDir(node.id, projectRoot);
    const context = readContextFile(moduleDir);
    const agentHit = agentHits.get(node.id) ?? null;

    if (context?.layer && isValidLayer(context.layer)) {
      // Import evidence wins over .context.md when they disagree on agent layers.
      const fromContext = context.layer as NodeLayer;
      const assigned =
        agentHit &&
        (agentHit.layer === "Reasoning" ||
          agentHit.layer === "Memory" ||
          agentHit.layer === "Safety")
          ? { layer: agentHit.layer as NodeLayer, evidence: agentHit.evidence }
          : { layer: fromContext, evidence: undefined };
      const layer = assigned.layer;
      const kind = inferKind(node);
      const llmProvider = kind === "agent" ? inferLlmProvider(node) : undefined;
      const hasRAG = inferHasRAG(node);
      const toolCount = kind === "agent" ? inferToolCount(node) : undefined;
      const baseDesc =
        context.description ?? node.description ?? generateDescription(node, layer);
      return {
        ...node,
        layer,
        suggestedLabel: context.role ?? node.label,
        role: context.role ?? inferLabel(node, layer),
        description: assigned.evidence
          ? `${baseDesc} [${assigned.evidence}]`
          : baseDesc,
        status: inferStatus(node),
        kind,
        subsystem: classifySubsystem(node, { contextSubsystem: context.subsystem }).subsystem,
        ...(llmProvider && { llmProvider }),
        ...(hasRAG && { hasRAG: true }),
        ...(toolCount != null && toolCount > 0 && { toolCount }),
      };
    }

    if (
      node.layer &&
      node.layer !== "Uncategorized" &&
      node.suggestedLabel &&
      !agentHit
    ) {
      return {
        ...node,
        subsystem:
          node.subsystem ??
          classifySubsystem(node, { contextSubsystem: context?.subsystem }).subsystem,
      };
    }

    // Import/content agent evidence overrides a pre-stamped non-Uncategorized layer.
    const { layer, evidence } = assignLayer(node, agentHit);
    const label = inferLabel(node, layer);
    const status = inferStatus(node);
    const kind = inferKind(node);
    const llmProvider = kind === "agent" ? inferLlmProvider(node) : undefined;
    const hasRAG = inferHasRAG(node);
    const toolCount = kind === "agent" ? inferToolCount(node) : undefined;
    const baseDesc = node.description ?? generateDescription(node, layer);

    return {
      ...node,
      layer,
      suggestedLabel: label,
      role: label,
      status,
      description: evidence ? `${baseDesc} [${evidence}]` : baseDesc,
      kind,
      subsystem: classifySubsystem(node, { contextSubsystem: context?.subsystem }).subsystem,
      ...(llmProvider && { llmProvider }),
      ...(hasRAG && { hasRAG: true }),
      ...(toolCount != null && toolCount > 0 && { toolCount }),
    };
  });

  return refineGraphNodeLabels({ ...graph, nodes });
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
        const layer = inferLayer(node, graph.projectRoot ?? "");
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
