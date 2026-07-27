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

export type AgentSurface = {
  file: string;
  provider: string;
  evidence: string;
  model: string | null;
  systemPrompt: string | null;
  toolCandidates: string[];
  confidence: "high" | "low";
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
  const names = new Set<string>();
  // OpenAI-style tool definitions: { type: 'function', function: { name: '...' } }
  const fnName = /function\s*:\s*\{\s*name\s*:\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = fnName.exec(text)) !== null) names.add(m[1]!);
  // tools: [ { name: '...' } ]
  const toolName = /(?:tools|toolDefinitions|TOOL_DEFINITIONS)\s*[:=]\s*\[[\s\S]{0,8000}?\]/g;
  const blocks = text.match(toolName) ?? [];
  for (const block of blocks) {
    const nameRe = /name\s*:\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g;
    while ((m = nameRe.exec(block)) !== null) names.add(m[1]!);
  }
  // bindTools([...]) with string names is rare; skip guessing.
  return [...names].slice(0, 40);
}

function analyzeJsTsFile(
  absPath: string,
  rel: string,
  active: string[]
): AgentSurface | null {
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

  // Construction / bindTools when this file imports a matching declared package
  for (const pat of CONSTRUCTION_PATTERNS) {
    const hasPkgImport = importedActive.some((i) =>
      pat.packages.some(
        (p) => i === p || i.startsWith(p + "/") || (p.endsWith("/*") && i.startsWith(p.slice(0, -1)))
      )
    );
    if (!hasPkgImport) continue;
    const m = pat.re.exec(text);
    if (m) {
      return {
        file: rel,
        provider: pat.provider,
        evidence: lineOfMatch(text, m.index),
        model: findModel(text),
        systemPrompt: findSystemPrompt(text, rel),
        toolCandidates: findToolCandidates(text),
        confidence: "high",
      };
    }
  }

  // Direct HTTP to model APIs (teams skipping the SDK)
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
    // Embeddings / TTS / speech are model APIs but not agent surfaces.
    if (/\/embeddings\b|\/audio\/speech\b|\/audio\/transcriptions\b/i.test(m[0])) {
      continue;
    }
    // Read-only Retell admin probes are not agent surfaces.
    if (
      provider === "retell" &&
      /\/(get-call|list-calls|list-phone-numbers)\b/i.test(m[0]) &&
      !/register-phone-call|create-agent|update-agent|create-llm/i.test(surrounding)
    ) {
      continue;
    }
    // Health / dependency probes are not agent surfaces.
    if (/health-check|dependency.?probe|DEPENDENCY_CACHE/i.test(rel + "\n" + text.slice(0, 500))) {
      continue;
    }
    // Diagnostic scripts: keep SDK construction, skip HTTP-only probes.
    if (
      /(^|\/)scripts?\//i.test(rel) &&
      !CONSTRUCTION_PATTERNS.some((p) => p.re.test(text) && importedActive.length > 0)
    ) {
      continue;
    }
    return {
      file: rel,
      provider,
      evidence: line,
      model: findModel(text),
      systemPrompt: findSystemPrompt(text, rel),
      toolCandidates: findToolCandidates(text),
      confidence: "high",
    };
  }

  // Low confidence: declared chat SDK imported and used without `new X` in-file.
  // Skip langgraph-only scaffolding and tests/scripts (prefer missing over inventing).
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
    return {
      file: rel,
      provider: providerForPackage(pkg),
      evidence: importLine,
      model: findModel(text),
      systemPrompt: findSystemPrompt(text, rel),
      toolCandidates: findToolCandidates(text),
      confidence: "low",
    };
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
    const surface = analyzeJsTsFile(abs, rel, active);
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
