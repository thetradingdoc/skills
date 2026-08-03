#!/usr/bin/env npx tsx
/**
 * Agent inventory: repo path in → JSON out.
 * Detects files that construct a model client or register a model-driven handler.
 * Does not use or modify module grouping / enricher.
 *
 * Usage: npx tsx scripts/agent-inventory.ts <repo-path>
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectAgentAuth,
  loadClassifyConfig,
  resolveHandlerViaKellyExecutor,
  scrubExtractionNoise,
  traceToolHandler,
  unresolvedHandlerReach,
  writeClassifyConfig,
  DEFAULT_MAX_DEPTH,
  type AgentAuthFinding,
  type ToolReach,
} from "./resource-trace";
import { attachLayersToInventory } from "./agent-layers";
import type { AgentLayerResult } from "./agent-layers";

export type AgentTool = {
  name: string;
  handler: string | null;
  description: string | null;
  params: string[];
  /** When the tool lives only in a hosted console / external config. */
  note?: string;
  /** Resources reached from the handler (when resolvable). */
  reach?: ToolReach;
};

export type AgentSurfaceKind = "agent" | "helper" | "unknown";
export type AgentLoopKind =
  | "hosted"
  | "tool-loop"
  | "single-shot-with-tools"
  | "unknown";

export type AgentSurface = {
  file: string;
  provider: string;
  evidence: string;
  model: string | null;
  systemPrompt: string | null;
  /** @deprecated Prefer `tools` for agents; kept for dashboard compatibility. */
  toolCandidates: string[];
  confidence: "high" | "low";
  kind: AgentSurfaceKind;
  kindSignal: string;
  loopKind: AgentLoopKind | null;
  tools: AgentTool[];
  /** Auth / identity check before tools, if any. */
  auth?: AgentAuthFinding;
  /** Reference-model layer fill for the Layers canvas. */
  layers?: AgentLayerResult[];
};

export type AgentInventory = {
  agents: AgentSurface[];
  scannedFiles: number;
  languages: Record<string, number>;
  pythonAgents: string[];
  searchedFor: string[];
};

/** Candidate SDKs — only used after intersecting with the target's package.json. */
const CANDIDATE_PACKAGES = [
  "openai",
  "@anthropic-ai/sdk",
  "groq-sdk",
  "retell-ai",
  "cohere-ai",
  "@mistralai/mistralai",
  "together-ai",
  "replicate",
  "@google/generative-ai",
  "@google-cloud/vertexai",
  "@aws-sdk/client-bedrock-runtime",
  "langchain",
  "llamaindex",
  "ai",
  "@livekit/agents",
  "pipecat",
] as const;

/** @langchain/* is matched by prefix when declared. */
const LANGCHAIN_PREFIX = "@langchain/";

const PROVIDER_HTTP_HOSTS: Array<{ host: string; provider: string }> = [
  { host: "api.openai.com", provider: "openai" },
  { host: "api.anthropic.com", provider: "anthropic" },
  { host: "api.groq.com", provider: "groq" },
  { host: "api.retellai.com", provider: "retell" },
];

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "out",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
]);

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const PYTHON_AGENT_IMPORT_RE =
  /^\s*(?:from|import)\s+(livekit\.agents|langchain|langgraph|openai|anthropic|crewai|autogen|semantic_kernel|pipecat|groq|retell|llama_index|llamaindex)\b/m;

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== ".github") continue;
      if (SKIP_DIR.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

function collectDeclaredPackages(root: string): Set<string> {
  const declared = new Set<string>();
  for (const file of walkFiles(root)) {
    if (path.basename(file) !== "package.json") continue;
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let pkg: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const block of [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies,
    ]) {
      if (!block) continue;
      for (const name of Object.keys(block)) declared.add(name);
    }
  }
  return declared;
}

function activePackages(declared: Set<string>): string[] {
  const active: string[] = [];
  for (const p of CANDIDATE_PACKAGES) {
    if (declared.has(p)) active.push(p);
  }
  for (const d of declared) {
    if (d.startsWith(LANGCHAIN_PREFIX) && !active.includes(d)) {
      active.push(d);
    }
    if (d === "langchain" && !active.includes("langchain")) {
      active.push("langchain");
    }
  }
  return active.sort();
}

function providerForPackage(pkg: string): string {
  if (pkg === "openai" || pkg.startsWith("@langchain/openai")) return "openai";
  if (pkg === "@anthropic-ai/sdk") return "anthropic";
  if (pkg === "groq-sdk" || pkg.startsWith("@langchain/groq")) return "groq";
  if (pkg === "retell-ai") return "retell";
  if (pkg === "cohere-ai") return "cohere";
  if (pkg === "@mistralai/mistralai") return "mistral";
  if (pkg === "together-ai") return "together";
  if (pkg === "replicate") return "replicate";
  if (pkg === "@google/generative-ai" || pkg === "@google-cloud/vertexai")
    return "google";
  if (pkg === "@aws-sdk/client-bedrock-runtime") return "bedrock";
  if (pkg === "langchain" || pkg.startsWith("@langchain/")) return "langchain";
  if (pkg === "llamaindex") return "llamaindex";
  if (pkg === "ai") return "vercel-ai";
  if (pkg === "@livekit/agents") return "livekit";
  if (pkg === "pipecat") return "pipecat";
  return pkg;
}

/** Construction patterns keyed by package / provider family. */
const CONSTRUCTION_PATTERNS: Array<{
  packages: string[]; // empty = any of provider family
  provider: string;
  re: RegExp;
}> = [
  {
    packages: ["openai", "@langchain/openai"],
    provider: "openai",
    re: /\bnew\s+OpenAI\s*\(|OpenAI\s*\(\s*\{/,
  },
  {
    packages: ["@anthropic-ai/sdk"],
    provider: "anthropic",
    re: /\bnew\s+Anthropic\s*\(/,
  },
  {
    packages: ["groq-sdk", "@langchain/groq"],
    provider: "groq",
    re: /\bnew\s+Groq\s*\(|ChatGroq\s*\(/,
  },
  {
    packages: ["retell-ai"],
    provider: "retell",
    re: /\bnew\s+Retell\s*\(/,
  },
  {
    packages: ["cohere-ai"],
    provider: "cohere",
    re: /\bnew\s+CohereClient\s*\(|\bnew\s+Cohere\s*\(/,
  },
  {
    packages: ["@mistralai/mistralai"],
    provider: "mistral",
    re: /\bnew\s+Mistral\s*\(/,
  },
  {
    packages: ["@google/generative-ai"],
    provider: "google",
    re: /\bnew\s+GoogleGenerativeAI\s*\(|getGenerativeModel\s*\(/,
  },
  {
    packages: ["@google-cloud/vertexai"],
    provider: "google",
    re: /\bnew\s+VertexAI\s*\(/,
  },
  {
    packages: ["@aws-sdk/client-bedrock-runtime"],
    provider: "bedrock",
    re: /\bnew\s+BedrockRuntimeClient\s*\(/,
  },
  {
    packages: ["langchain", "@langchain/core", "@langchain/langgraph"],
    provider: "langchain",
    re: /\.bindTools\s*\(|ChatOpenAI\s*\(|ChatAnthropic\s*\(|ChatGroq\s*\(/,
  },
  {
    packages: ["ai"],
    provider: "vercel-ai",
    re: /\bgenerateText\s*\(|\bstreamText\s*\(|\bgenerateObject\s*\(/,
  },
  {
    packages: ["@livekit/agents"],
    provider: "livekit",
    re: /\bnew\s+Agent\s*\(|\bAgentSession\s*\(/,
  },
];

function extractImportSpecifiers(text: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const spec = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (spec && !spec.startsWith(".")) specs.push(spec);
  }
  return specs;
}

function matchesActivePackage(spec: string, active: string[]): string | null {
  for (const pkg of active) {
    if (spec === pkg || spec.startsWith(pkg + "/")) return pkg;
  }
  return null;
}

function lineOfMatch(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end < 0) end = text.length;
  return text.slice(start, end).trim().slice(0, 200);
}

function findModel(text: string): string | null {
  const patterns = [
    /model\s*:\s*['"`]([^'"`]+)['"`]/,
    /model\s*=\s*['"`]([^'"`]+)['"`]/,
    /DEFAULT_MODEL\s*=\s*['"`]([^'"`]+)['"`]/,
    /ESCALATE_MODEL\s*=\s*['"`]([^'"`]+)['"`]/,
    /\.chat\.completions\.create\(\s*\{[^}]*model\s*:\s*['"`]([^'"`]+)['"`]/s,
    /messages\.create\(\s*\{[^}]*model\s*:\s*['"`]([^'"`]+)['"`]/s,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1] && !/\$\{/.test(m[1])) return m[1];
  }
  return null;
}

function findSystemPrompt(text: string, file: string): string | null {
  const pathLoad = text.match(
    /(?:readFileSync|readFile)\s*\(\s*([^)]+\.(?:md|txt|prompt)[^)]*)\)/
  );
  if (pathLoad?.[1]) {
    const cleaned = pathLoad[1].replace(/['"`]/g, "").trim();
    if (cleaned) return cleaned.slice(0, 160);
  }
  const varRef = text.match(
    /\b(systemPrompt|SYSTEM_PROMPT|system_prompt|buildSystemPrompt|loadSalesPrompt|getDefaultShopPrompt)\b/
  );
  if (varRef?.[1]) return varRef[1];
  const inline = text.match(
    /(?:role\s*:\s*['"]system['"]\s*,\s*content\s*:\s*|system\s*:\s*)(['"`])/
  );
  if (inline) return `(inline system message in ${path.basename(file)})`;
  return null;
}

function findToolCandidates(text: string): string[] {
  return extractTools(text, "", null).map((t) => t.name);
}

/** Parse OpenAI-compatible / LangChain tool definitions from source text. */
function extractTools(
  text: string,
  relFile: string,
  repoRoot: string | null
): AgentTool[] {
  const tools: AgentTool[] = [];
  const seen = new Set<string>();

  // OpenAI-style: function: { name: '...', description: '...', parameters: {...} }
  const nameOnly =
    /function\s*:\s*\{\s*name\s*:\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = nameOnly.exec(text)) !== null) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const window = text.slice(m.index, m.index + 2500);
    const descM = window.match(
      /description\s*:\s*['"`]((?:\\.|[^'\\"`])*)['"`]/
    );
    const description = descM
      ? descM[1]!.replace(/\\n/g, " ").replace(/\\'/g, "'").trim()
      : null;
    const params = extractParamNames(window);
    tools.push({
      name,
      handler: resolveToolHandler(name, text, relFile, repoRoot),
      description,
      params,
    });
  }

  // LangChain DynamicStructuredTool({ name: '...', description: '...' })
  const dynRe =
    /DynamicStructuredTool\(\s*\{\s*name\s*:\s*['"`]([a-zA-Z0-9_.-]+)['"`]\s*,\s*description\s*:\s*['"`]((?:\\.|[^'\\"`])*)['"`]/g;
  while ((m = dynRe.exec(text)) !== null) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const window = text.slice(m.index, m.index + 800);
    const zodParams = Array.from(window.matchAll(/(\w+)\s*:\s*z\./g), (x) => x[1]!).filter(
      (p) =>
        !["object", "string", "array", "enum", "boolean", "number", "optional"].includes(
          p
        )
    );
    tools.push({
      name,
      handler: resolveToolHandler(name, text, relFile, repoRoot),
      description: m[2]!.replace(/\\n/g, " ").trim() || null,
      params: [...new Set(zodParams)],
    });
  }

  return tools;
}

function extractParamNames(block: string): string[] {
  const idx = block.search(/properties\s*:\s*\{/);
  if (idx < 0) return [];
  const braceStart = block.indexOf("{", idx);
  if (braceStart < 0) return [];
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < block.length; i++) {
    const ch = block[i]!;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const src = block.slice(braceStart + 1, end);
  const names: string[] = [];
  let propDepth = 0;
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\{|[{}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[0] === "{") {
      propDepth++;
      continue;
    }
    if (m[0] === "}") {
      propDepth--;
      continue;
    }
    if (propDepth !== 0) continue;
    const n = m[1]!;
    if (
      ![
        "type",
        "properties",
        "items",
        "required",
        "additionalProperties",
        "parameters",
      ].includes(n)
    ) {
      names.push(n);
    }
    // Match includes the opening `{` of this property value — nest until its close.
    propDepth++;
  }
  return [...new Set(names)].slice(0, 30);
}

function resolveToolHandler(
  toolName: string,
  text: string,
  relFile: string,
  repoRoot: string | null
): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`case\\s+['"\`]${toolName}['"\`]`).test(lines[i]!)) {
      return `${relFile}:${i + 1}`;
    }
  }

  // Follow require('./foo-tool-executor') siblings
  if (!repoRoot) return null;
  const reqRe = /require\(\s*['"](\.[^'"]*tool[^'"]*)['"]\s*\)/gi;
  let m: RegExpExecArray | null;
  const dir = path.dirname(path.join(repoRoot, relFile));
  while ((m = reqRe.exec(text)) !== null) {
    const spec = m[1]!;
    const candidates = [
      path.join(dir, spec + ".js"),
      path.join(dir, spec + ".ts"),
      path.join(dir, spec, "index.js"),
    ];
    for (const abs of candidates) {
      if (!fs.existsSync(abs)) continue;
      let body: string;
      try {
        body = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      const blines = body.split("\n");
      for (let i = 0; i < blines.length; i++) {
        if (new RegExp(`case\\s+['"\`]${toolName}['"\`]`).test(blines[i]!)) {
          return `${rel}:${i + 1}`;
        }
      }
      // executeTool('name' ...) in registry
      const execM = body.match(
        new RegExp(
          `executeTool\\(\\s*['"\`]${toolName}['"\`]|[\\"'\\\`]${toolName}[\\"'\\\`]\\s*,\\s*async`
        )
      );
      if (execM && execM.index != null) {
        const line =
          body.slice(0, execM.index).split("\n").length;
        return `${rel}:${line}`;
      }
    }
  }
  return null;
}

function loadRetellFunctionsJson(
  relFile: string,
  repoRoot: string
): AgentTool[] | null {
  const dir = path.dirname(path.join(repoRoot, relFile));
  const candidates = [
    path.join(dir, "../retell-functions/retell-functions.json"),
    path.join(repoRoot, "middleware-platform/retell-functions/retell-functions.json"),
  ];
  for (const abs of candidates) {
    if (!fs.existsSync(abs)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
      const fns = Array.isArray(raw?.functions) ? raw.functions : [];
      const tools: AgentTool[] = [];
      for (const f of fns) {
        const name = f?.name ?? f?.function?.name;
        if (!name || typeof name !== "string") continue;
        const description =
          typeof f.description === "string"
            ? f.description
            : typeof f?.function?.description === "string"
              ? f.function.description
              : null;
        const paramsObj =
          f?.parameters?.properties ??
          f?.function?.parameters?.properties ??
          {};
        const params = Object.keys(paramsObj);
        tools.push({
          name,
          handler: null,
          description,
          params,
          note: `Declared in ${path.relative(repoRoot, abs).split(path.sep).join("/")} (pushed to Retell; may also be edited in Retell console)`,
        });
      }
      return tools.length ? tools : null;
    } catch {
      continue;
    }
  }
  return null;
}

function classifySurface(
  text: string,
  rel: string,
  tools: AgentTool[],
  provider: string
): { kind: AgentSurfaceKind; kindSignal: string; loopKind: AgentLoopKind | null } {
  const hasToolDefs = tools.length > 0;
  const hasToolLoop =
    /MAX_TOOL_ROUNDS|tool_calls|toolCalls|for\s*\(.*round|while\s*\(.*tool|bindTools\s*\(|toolsUsed|tool_choice\s*:\s*['"]auto['"]/i.test(
      text
    ) &&
    (hasToolDefs ||
      /\.chat\.completions\.create|messages\.create|invokeLlm|_invokeLlm/i.test(
        text
      ));

  const isRetellHandler =
    /retell-service\.js|retell-websocket\.js|voice-incoming-handler\.js|somo-demo-handler\.js|consumer-navigation-handler\.js/i.test(
      rel
    ) ||
    (/RetellWebSocketHandler|function_call_response/i.test(text) &&
      /webhook|retell/i.test(rel));

  const isHostedPlatform =
    isRetellHandler ||
    /loadRetellFunctions\s*\(|type\s*:\s*['"]custom-llm['"]/.test(text) ||
    /['"`]https?:\/\/api\.retellai\.com[^'"`]*register-phone-call/.test(text);

  // Shared routers / client factories are not agents.
  if (
    /(^|\/)(llm-router|model-router)(\.|$)/i.test(rel) ||
    (/Router|getGroq|getAnthropic|module\.exports\.chatCompletion/i.test(text) &&
      !hasToolDefs &&
      !/KELLY_TOOLS|DEMO_TOOLS|bindTools/i.test(text) &&
      /chatCompletion|completions\.create/.test(text))
  ) {
    if (!hasToolDefs && !isRetellHandler) {
      return {
        kind: "unknown",
        kindSignal:
          "shared model router / client factory — forwards calls but is not itself an agent",
        loopKind: null,
      };
    }
  }

  if (hasToolLoop && hasToolDefs) {
    return {
      kind: "agent",
      kindSignal: `tool definitions (${tools.length}) + model tool-call loop`,
      loopKind: "tool-loop",
    };
  }
  if (hasToolDefs && /tools\s*:/.test(text) && !hasToolLoop) {
    // tools passed once without an obvious feedback loop
    if (/\.chat\.completions\.create|messages\.create/.test(text)) {
      return {
        kind: "agent",
        kindSignal: `tools array passed to model once (${tools.length} tools)`,
        loopKind: "single-shot-with-tools",
      };
    }
  }
  if (isHostedPlatform || isRetellHandler) {
    return {
      kind: "agent",
      kindSignal: isRetellHandler
        ? "hosted platform handler (Retell webhook / agent registration)"
        : "registers or serves a hosted agent platform (Retell/Vapi/Bland)",
      loopKind: "hosted",
    };
  }
  if (hasToolLoop && !hasToolDefs) {
    return {
      kind: "agent",
      kindSignal: "tool-call loop present; tool list resolved from sibling module or registry",
      loopKind: "tool-loop",
    };
  }

  // Helper: one-shot completion (SDK or raw HTTP), no tools
  const oneShot =
    (/\.chat\.completions\.create|messages\.create|generateText\s*\(|getGenerativeModel|chatCompletion\s*\(/i.test(
      text
    ) ||
      /\/v1\/chat\/completions|\/v1\/messages\b/i.test(text)) &&
    !hasToolDefs &&
    !hasToolLoop &&
    !isHostedPlatform &&
    !isRetellHandler;

  if (oneShot) {
    return {
      kind: "helper",
      kindSignal:
        "single model call in → text/JSON out; no tools and no tool-call loop",
      loopKind: null,
    };
  }

  // Construction only / HTTP client wrapper without clear call pattern
  if (!hasToolDefs && !hasToolLoop && !isHostedPlatform && !isRetellHandler) {
    if (/new\s+(Groq|OpenAI|Anthropic|ChatGroq|ChatOpenAI|AzureChatOpenAI)\s*\(/.test(text)) {
      if (
        /Router|getGroq|getClient|_groq\s*=|_anthropic\s*=/i.test(text) &&
        !/\.chat\.completions\.create|\/chat\/completions/.test(text)
      ) {
        return {
          kind: "unknown",
          kindSignal:
            "constructs a model client but no call site or tool loop in this file",
          loopKind: null,
        };
      }
      return {
        kind: "helper",
        kindSignal:
          "model client construction with completion usage, no tools",
        loopKind: null,
      };
    }
    if (/api\.retellai\.com|apiBaseUrl.*retell/i.test(text)) {
      return {
        kind: "unknown",
        kindSignal:
          "Retell API URL present; unclear if agent registration vs admin/read",
        loopKind: null,
      };
    }
  }

  return {
    kind: "unknown",
    kindSignal:
      "ambiguous — could not confirm tool loop, hosted handler, or single-shot helper",
    loopKind: null,
  };
}

function enrichSurface(
  base: Omit<AgentSurface, "kind" | "kindSignal" | "loopKind" | "tools" | "toolCandidates" | "auth"> & {
    toolCandidates?: string[];
  },
  text: string,
  repoRoot: string,
  classifyCfg?: ReturnType<typeof loadClassifyConfig>
): AgentSurface {
  let tools = extractTools(text, base.file, repoRoot);

  // Pull tools from required sibling tool modules (e.g. ./groq-tools)
  const dir = path.dirname(path.join(repoRoot, base.file));
  if (/groq-tools|buildHealthLangChainTools|toolRegistry/i.test(text)) {
    const candidates = [
      path.join(dir, "groq-tools.js"),
      path.join(dir, "groq-tools.ts"),
      path.join(dir, "../tools/registry.js"),
    ];
    for (const abs of candidates) {
      if (!fs.existsSync(abs)) continue;
      const body = fs.readFileSync(abs, "utf8");
      const more = extractTools(
        body,
        path.relative(repoRoot, abs).split(path.sep).join("/"),
        repoRoot
      );
      for (const t of more) {
        if (!tools.some((x) => x.name === t.name)) tools.push(t);
      }
    }
  }

  // Retell: tools often live in retell-functions.json
  if (/retell/i.test(base.provider + base.file + text.slice(0, 2000))) {
    const fromJson = loadRetellFunctionsJson(base.file, repoRoot);
    if (fromJson && fromJson.length) {
      // Prefer JSON list for hosted retell agent config surfaces
      if (/retell-service|voice-incoming|retell-websocket/i.test(base.file)) {
        tools = fromJson;
      } else {
        for (const t of fromJson) {
          if (!tools.some((x) => x.name === t.name)) tools.push(t);
        }
      }
    }
  }

  const { kind, kindSignal, loopKind } = classifySurface(
    text,
    base.file,
    tools,
    base.provider
  );

  // Hosted agents with no in-file tool list
  if (
    kind === "agent" &&
    loopKind === "hosted" &&
    tools.length === 0
  ) {
    tools = [
      {
        name: "(hosted)",
        handler: null,
        description: null,
        params: [],
        note: "Tool list is declared on the hosted agent platform (Retell console) and/or retell-functions.json — not extractable as OpenAI tool defs in this file.",
      },
    ];
  }

  // Resolve handlers for catalog tools that dispatch through KellyToolExecutor
  if (kind === "agent") {
    for (const t of tools) {
      if (!t.handler && t.name !== "(hosted)") {
        const via = resolveHandlerViaKellyExecutor(repoRoot, t.name);
        if (via) {
          t.handler = via;
          if (t.note) t.note = `${t.note}; handler resolved via KellyToolExecutor`;
          else t.note = "handler resolved via KellyToolExecutor";
        }
      }
    }
  }

  // Resource reach tracing + auth (agents only). Config is mutated in place;
  // caller (buildAgentInventory) persists once at the end.
  let auth: AgentAuthFinding | undefined;
  if (kind === "agent") {
    const cfg = classifyCfg ?? loadClassifyConfig(repoRoot);
    for (const t of tools) {
      if (t.name === "(hosted)") {
        t.reach = unresolvedHandlerReach(
          "hosted-console: tool declared on hosted platform without in-repo handler"
        );
        continue;
      }
      if (!t.handler) {
        t.reach = unresolvedHandlerReach();
        continue;
      }
      t.reach = traceToolHandler(
        repoRoot,
        t.handler,
        t.name,
        cfg,
        DEFAULT_MAX_DEPTH
      );
    }
    auth = detectAgentAuth(repoRoot, base.file, text);
  }

  return {
    ...base,
    toolCandidates: tools.filter((t) => t.name !== "(hosted)").map((t) => t.name),
    kind,
    kindSignal,
    loopKind: kind === "agent" ? loopKind ?? "unknown" : null,
    tools: kind === "agent" ? tools : [],
    auth,
  };
}


/**
 * Which providers a file reaches through its own modules.
 *
 * extractImportSpecifiers drops anything starting with "." because the SDK
 * intersection only cares about packages. That is right for the intersection
 * and wrong for detection: a file that requires "./llm-router" and runs a tool
 * loop is an agent, and it was invisible.
 *
 * This penalises exactly the codebases that factored their model access
 * properly — the SDK sits in one shared client, and every agent that uses it
 * disappears. One hop is enough for that shape and stops well short of walking
 * a whole dependency tree.
 */
function resolveLocalProviders(
  absPath: string,
  text: string,
  active: stri[]
): string[] {
  const dir = path.dirname(absPath);
  const found: string[] = [];

  const re = /(?:require\s*\(\s*['"](\.[^'"]+)['"]\s*\)|from\s+['"](\.[^'"]+)['"])/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const spec = (m[1] ?? m[2] ?? "").trim();
    if (!spec) continue;

    for (const ext of ["", ".js", ".ts", ".mjs", ".cjs", "/index.js", "/index.ts"]) {
      const candidate = path.resolve(dir, spec + ext);
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;

      let inner: string;
      try {
        inner = fs.readFileSync(candidate, "utf8").slice(0, 200_000);
      } catch {
        break;
      }

      for (const pkg of active) {
        const importRe = new RegExp(
          "(?:require\\s*\\(\\s*['\"]" + pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\function analyzeJsTsFile(") +
          "['\"]|from\\s+['\"]" + pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\function analyzeJsTsFile(") + "['\"])"
        );
        if (importRe.test(inner) && !found.includes(pkg)) found.push(pkg);
      }
      break;
    }
  }

  return found;
}

function analyzeJsTsFile(
  absPath: string,
  rel: string,
  active: string[],
  repoRoot: string,
  classifyCfg: ReturnType<typeof loadClassifyConfig>
): AgentSurface | null {
  // Prefer missing: tests and ops scripts are not product agent surfaces.
  if (/(^|\/)(__tests__|tests?|e2e|scripts?)(\/|$)/i.test(rel)) {
    return null;
  }

  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  if (text.length > 1_500_000) text = text.slice(0, 1_500_000);

  const imports = extractImportSpecifiers(text);
  const importedActive: string[] = [];
  for (const spec of imports) {
    const hit = matchesActivePackage(spec, active);
    if (hit && !importedActive.includes(hit)) importedActive.push(hit);
  }

  // A file reaching a provider through a shared local client counts. Without
  // this, "if (!hasPkgImport) continue" skips every provider pattern and a
  // real agent is reported as nothing at all.
  for (const pkg of resolveLocalProviders(absPath, text, active)) {
    if (!importedActive.includes(pkg)) importedActive.push(pkg);
  }

  const finish = (
    partial: Omit<
      AgentSurface,
      "kind" | "kindSignal" | "loopKind" | "tools" | "toolCandidates" | "auth"
    >
  ) => enrichSurface(partial, text, repoRoot, classifyCfg);

  // Hosted platform handlers (even without SDK construction in-file)
  if (
    (/RetellWebSocketHandler|function_call_response|custom-llm/i.test(text) &&
      /retell/i.test(rel + text.slice(0, 3000))) ||
    (/register-phone-call/i.test(text) && /retell/i.test(text))
  ) {
    return finish({
      file: rel,
      provider: "retell",
      evidence:
        text
          .split("\n")
          .find((l) =>
            /RetellWebSocket|function_call_response|register-phone-call|custom-llm/i.test(
              l
            )
          )
          ?.trim()
          .slice(0, 200) ?? "Retell hosted handler",
      model: findModel(text),
      systemPrompt: findSystemPrompt(text, rel),
      confidence: "high",
    });
  }

  // Construction / bindTools when this file imports a matching declared package
  for (const pat of CONSTRUCTION_PATTERNS) {
    const hasPkgImport = importedActive.some((i) =>
      pat.packages.some(
        (p) =>
          i === p ||
          i.startsWith(p + "/") ||
          (p.endsWith("/*") && i.startsWith(p.slice(0, -1)))
      )
    );
    if (!hasPkgImport) continue;
    const m = pat.re.exec(text);
    if (m) {
      const model = findModel(text);
      if (
        model &&
        /embedding/i.test(model) &&
        !/\.chat\.completions\.|messages\.create\s*\(|bindTools\s*\(/.test(text)
      ) {
        continue;
      }
      if (
        /Embeddings\s*\(|embeddings\.create\s*\(/.test(text) &&
        !/\.chat\.completions\.|messages\.create\s*\(|bindTools\s*\(/.test(text)
      ) {
        continue;
      }
      return finish({
        file: rel,
        provider: pat.provider,
        evidence: lineOfMatch(text, m.index),
        model,
        systemPrompt: findSystemPrompt(text, rel),
        confidence: "high",
      });
    }
  }

  // An agent that reaches a model through a local client.
  //
  // The provider patterns above look for the SDK's own method names —
  // messages.create, chat.completions.create — at the call site. A file that
  // calls its own router instead has none of them, so a real agent with tool
  // definitions and a tool-call loop was reported as nothing at all.
  //
  // This is the shape of every codebase that put its model access behind one
  // shared client, which is the better design. Requiring all three signals
  // together keeps it from firing on files that merely import the router.
  if (importedActive.length > 0 && !/messages\.create|completions\.create/.test(text)) {
    const hasSchemas = /tools\s*[:=]|TOOL_SCHEMAS|toolSchemas|function:\s*\{/.test(text);
    const hasLoop = /tool_calls|tool_use|toolCalls/.test(text) && /for\s*\(|while\s*\(|\.map\s*\(/.test(text);

    if (hasSchemas && hasLoop) {
      return finish({
        file: rel,
        provider: providerForPackage(importedActive[0]),
        evidence:
          text
            .split("\n")
            .find((l) => /tool_calls|tool_use|toolCalls/.test(l))
            ?.trim()
            .slice(0, 160) ?? "tool-call loop over a local model client",
        model: findModel(text),
        systemPrompt: findSystemPrompt(text, rel),
        confidence: "high",
      });
    }
  }

  // Direct HTTP to model APIs
  for (const { host, provider } of PROVIDER_HTTP_HOSTS) {
    const re = new RegExp(
      `https?:\\/\\/${host.replace(/\./g, "\\.")}[^\\s'\`"]*`,
      "i"
    );
    const m = re.exec(text);
    if (!m) continue;
    const line = lineOfMatch(text, m.index);
    const surrounding = text.slice(
      Math.max(0, m.index - 120),
      Math.min(text.length, m.index + 180)
    );
    const looksLikeCall =
      /axios\.|fetch\s*\(|\.get\s*\(|\.post\s*\(|\.request\s*\(|apiBaseUrl|register-phone-call|create-agent|create_agent|update-agent|create.?llm|custom.?llm/i.test(
        surrounding
      );
    if (!looksLikeCall) continue;
    if (/\/embeddings\b|\/audio\/speech\b|\/audio\/transcriptions\b/i.test(m[0])) {
      continue;
    }
    if (
      provider === "retell" &&
      /\/(get-call|list-calls|list-phone-numbers)\b/i.test(m[0]) &&
      !/register-phone-call|create-agent|update-agent|create-llm/i.test(surrounding)
    ) {
      continue;
    }
    if (/health-check|dependency.?probe|DEPENDENCY_CACHE/i.test(rel + "\n" + text.slice(0, 500))) {
      continue;
    }
    if (
      /(^|\/)scripts?\//i.test(rel) &&
      !CONSTRUCTION_PATTERNS.some((p) => p.re.test(text) && importedActive.length > 0)
    ) {
      continue;
    }
    return finish({
      file: rel,
      provider,
      evidence: line,
      model: findModel(text),
      systemPrompt: findSystemPrompt(text, rel),
      confidence: "high",
    });
  }

  const nonGraphImports = importedActive.filter(
    (p) => p !== "@langchain/langgraph" && !p.startsWith("@langchain/langgraph")
  );
  if (
    nonGraphImports.length > 0 &&
    !/(^|\/)(__tests__|tests?|e2e|scripts?|fixtures?|middleware\/health)(\/|$)/i.test(rel) &&
    /\.chat\.completions\.|messages\.create\s*\(|generateText\s*\(|streamText\s*\(/.test(
      text
    )
  ) {
    const pkg = nonGraphImports[0]!;
    const importLine =
      text
        .split("\n")
        .find((l) =>
          nonGraphImports.some(
            (p) => l.includes(`'${p}'`) || l.includes(`"${p}"`)
          )
        )
        ?.trim()
        .slice(0, 200) ?? `imports ${pkg}`;
    return finish({
      file: rel,
      provider: providerForPackage(pkg),
      evidence: importLine,
      model: findModel(text),
      systemPrompt: findSystemPrompt(text, rel),
      confidence: "low",
    });
  }

  return null;
}

export function buildAgentInventory(repoRoot: string): AgentInventory {
  const root = path.resolve(repoRoot);
  const declared = collectDeclaredPackages(root);
  const active = activePackages(declared);
  const searchedFor = [
    ...active,
    ...PROVIDER_HTTP_HOSTS.map((h) => `https://${h.host}`),
  ];
  const classifyCfg = loadClassifyConfig(root);

  const allFiles = walkFiles(root);
  const languages: Record<string, number> = {};
  const agents: AgentSurface[] = [];
  const pythonAgents: string[] = [];
  let scannedFiles = 0;

  for (const abs of allFiles) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const ext = path.extname(abs).toLowerCase();
    languages[ext || "(none)"] = (languages[ext || "(none)"] ?? 0) + 1;

    if (ext === ".py") {
      let text: string;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (PYTHON_AGENT_IMPORT_RE.test(text)) {
        pythonAgents.push(rel);
      }
      continue;
    }

    if (!CODE_EXT.has(ext)) continue;
    if (rel.includes("node_modules/") || rel.includes("/dist/")) continue;
    scannedFiles += 1;
    const surface = analyzeJsTsFile(abs, rel, active, root, classifyCfg);
    if (surface) agents.push(surface);
  }

  // Prefer high-confidence when the same file would appear twice (shouldn't)
  const byFile = new Map<string, AgentSurface>();
  for (const a of agents) {
    const prev = byFile.get(a.file);
    if (!prev || (prev.confidence === "low" && a.confidence === "high")) {
      byFile.set(a.file, a);
    }
  }

  const deduped = [...byFile.values()].sort((a, b) =>
    a.file.localeCompare(b.file)
  );

  // Drop unclassified keys that gained an explicit class
  classifyCfg.unclassified = classifyCfg.unclassified.filter(
    (k) => !classifyCfg.resources[k] || classifyCfg.resources[k] === "unclassified"
  );
  scrubExtractionNoise(classifyCfg);
  writeClassifyConfig(root, classifyCfg);

  // Reference-model layers (product artifact at arch-visualizer root)
  const productRoot = path.resolve(__dirname, "..");
  attachLayersToInventory(root, deduped, productRoot);

  return {
    agents: deduped,
    scannedFiles,
    languages,
    pythonAgents: pythonAgents.sort(),
    searchedFor,
  };
}

async function main() {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("Usage: npx tsx scripts/agent-inventory.ts <repo-path>");
    process.exit(1);
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    console.error(`Not a directory: ${repoPath}`);
    process.exit(1);
  }
  const inventory = buildAgentInventory(repoPath);
  console.log(JSON.stringify(inventory, null, 2));
}

const isMain =
  typeof process.argv[1] === "string" &&
  /agent-inventory\.(ts|js|mts|mjs)$/.test(
    process.argv[1]!.replace(/\\/g, "/")
  );

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
