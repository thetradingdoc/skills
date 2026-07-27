/**
 * Resource reach tracing from agent tool handlers.
 * Walks outward (depth-limited) and classifies resources via resources.classify.json.
 */

import * as fs from "fs";
import * as path from "path";

export type ResourceKind = "db" | "service" | "external" | "fs";
export type ResourceClass =
  | "patient"
  | "money"
  | "external"
  | "internal"
  | "unclassified";

export type ReachResource = {
  kind: ResourceKind;
  /** Table, host, module path, or file path. */
  name: string;
  class: ResourceClass;
  depth: number;
  /** Path hops: tool handler → … → this resource evidence. */
  path: string[];
  evidence: string;
};

export type ToolReach = {
  resources: ReachResource[];
  truncated: boolean;
  truncationNote: string | null;
};

export type AgentAuthFinding = {
  found: boolean;
  /** file:line when found */
  location: string | null;
  evidence: string;
};

export type ClassifyConfig = {
  version: number;
  description?: string;
  heuristics: {
    patient: string[];
    money: string[];
    external: string[];
    internal: string[];
  };
  /** Explicit resource key → class. Key form: "kind:name" (lowercase). */
  resources: Record<string, ResourceClass>;
  /** Keys seen but not yet classified — humans fill these in. */
  unclassified: string[];
};

const DEFAULT_MAX_DEPTH = 3;

const DEFAULT_CONFIG: ClassifyConfig = {
  version: 1,
  description:
    "Resource sensitivity classification for agent tool reach. Edit resources and clear entries from unclassified after deciding.",
  heuristics: {
    patient: [
      "patient",
      "fhir",
      "triage",
      "clinical",
      "medical",
      "phi",
      "hipaa",
      "insurance",
      "member_id",
      "claim",
      "appointment",
      "chart",
      "lab",
      "diagnosis",
      "icd",
      "cpt",
      "allergy",
      "medication",
      "demograph",
      "identity",
      "caller",
      "voice_call",
      "session_meta",
    ],
    money: [
      "payment",
      "stripe",
      "checkout",
      "billing",
      "invoice",
      "payout",
      "copay",
      "commerce",
      "cart",
      "quote",
      "price",
      "charge",
      "refund",
      "claim",
    ],
    external: [
      "api.",
      "https://",
      "http://",
      "stripe",
      "twilio",
      "retell",
      "openai",
      "anthropic",
      "groq",
      "pubmed",
      "sendgrid",
      "mailgun",
      "aws.",
      "s3.",
    ],
    internal: [],
  },
  resources: {},
  unclassified: [],
};

function resourceKey(kind: ResourceKind, name: string): string {
  return `${kind}:${name}`.toLowerCase();
}

export function productClassifyRoot(): string {
  // scripts/resource-trace.ts → repo root of arch-visualizer
  return path.resolve(__dirname, "..");
}

export function classifyConfigPath(repoRoot?: string): string {
  // Prefer a classify file in the scanned repo when present; otherwise product root.
  if (repoRoot) {
    const inScan = path.join(repoRoot, "resources.classify.json");
    if (fs.existsSync(inScan)) return inScan;
  }
  return path.join(productClassifyRoot(), "resources.classify.json");
}

export function loadClassifyConfig(repoRoot: string): ClassifyConfig {
  const productPath = path.join(productClassifyRoot(), "resources.classify.json");
  const scanPath = path.join(repoRoot, "resources.classify.json");

  let cfg = structuredClone(DEFAULT_CONFIG);
  const loadFile = (p: string) => {
    if (!fs.existsSync(p)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ClassifyConfig>;
      cfg = {
        version: raw.version ?? cfg.version,
        description: raw.description ?? cfg.description,
        heuristics: {
          patient: raw.heuristics?.patient ?? cfg.heuristics.patient,
          money: raw.heuristics?.money ?? cfg.heuristics.money,
          external: raw.heuristics?.external ?? cfg.heuristics.external,
          internal: raw.heuristics?.internal ?? cfg.heuristics.internal,
        },
        resources: { ...cfg.resources, ...(raw.resources ?? {}) },
        unclassified: [
          ...new Set([
            ...(cfg.unclassified ?? []),
            ...(Array.isArray(raw.unclassified) ? raw.unclassified : []),
          ]),
        ],
      };
    } catch {
      /* keep cfg */
    }
  };

  // Product defaults first, then scan-repo overlay
  loadFile(productPath);
  if (path.resolve(scanPath) !== path.resolve(productPath)) {
    loadFile(scanPath);
  }

  // Ensure product artifact exists
  if (!fs.existsSync(productPath)) {
    writeClassifyConfig(productClassifyRoot(), cfg);
  }
  return cfg;
}

/** Persist to the product rules file (arch-visualizer root), not a temp clone. */
export function writeClassifyConfig(repoRoot: string, cfg: ClassifyConfig): void {
  // Always write the product artifact; also write into scan root when it already has one.
  const productPath = path.join(productClassifyRoot(), "resources.classify.json");
  const sorted: ClassifyConfig = {
    ...cfg,
    unclassified: [...new Set(cfg.unclassified)].sort(),
    resources: Object.fromEntries(
      Object.entries(cfg.resources).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
  fs.writeFileSync(productPath, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  const scanPath = path.join(repoRoot, "resources.classify.json");
  if (
    path.resolve(repoRoot) !== path.resolve(productClassifyRoot()) &&
    fs.existsSync(scanPath)
  ) {
    fs.writeFileSync(scanPath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  }
}

function matchesAny(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase();
  return needles.some((n) => n && h.includes(n.toLowerCase()));
}

/**
 * Classify a resource. Does not guess: unknown → unclassified.
 * Heuristics only apply when they clearly match; ambiguous stays unclassified.
 */
export function classifyResource(
  kind: ResourceKind,
  name: string,
  cfg: ClassifyConfig
): ResourceClass {
  const key = resourceKey(kind, name);
  const explicit = cfg.resources[key];
  if (
    explicit === "patient" ||
    explicit === "money" ||
    explicit === "external" ||
    explicit === "internal" ||
    explicit === "unclassified"
  ) {
    return explicit;
  }

  // External kind is always external sensitivity unless explicitly overridden.
  if (kind === "external") {
    return "external";
  }

  const label = `${kind} ${name}`;
  const patientHit = matchesAny(label, cfg.heuristics.patient);
  const moneyHit = matchesAny(label, cfg.heuristics.money);

  // Conflicting patient+money heuristic → leave for human (e.g. "claim")
  if (patientHit && moneyHit) {
    return "unclassified";
  }
  if (patientHit) return "patient";
  if (moneyHit) return "money";
  if (kind === "fs") return "internal";
  if (kind === "service") {
    // Local service module — only classify if heuristic is clear; else unclassified
    if (matchesAny(name, cfg.heuristics.internal)) return "internal";
    // Many services are ambiguous (payer-quote-service could be money or clinical)
    return "unclassified";
  }
  // db table with no heuristic match
  return "unclassified";
}

function ensureUnclassifiedTracked(cfg: ClassifyConfig, key: string): void {
  if (cfg.resources[key]) return;
  if (!cfg.unclassified.includes(key)) {
    cfg.unclassified.push(key);
  }
}

function resolveRequire(
  fromFile: string,
  spec: string,
  repoRoot: string
): string | null {
  if (!spec.startsWith(".")) return null;
  const dir = path.dirname(fromFile);
  const candidates = [
    path.join(dir, spec),
    path.join(dir, spec + ".js"),
    path.join(dir, spec + ".ts"),
    path.join(dir, spec + ".mjs"),
    path.join(dir, spec, "index.js"),
    path.join(dir, spec, "index.ts"),
  ];
  for (const abs of candidates) {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      if (rel.startsWith("..")) return null;
      return abs;
    }
  }
  return null;
}

function extractSqlTables(sql: string): string[] {
  const tables: string[] = [];
  const re =
    /\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+[`"']?([a-zA-Z_][a-zA-Z0-9_]*)[`"']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const t = m[1]!;
    if (!["select", "set", "values", "where", "and", "or"].includes(t.toLowerCase())) {
      tables.push(t);
    }
  }
  return [...new Set(tables)];
}

type FoundInSnippet = {
  resources: Array<{
    kind: ResourceKind;
    name: string;
    evidence: string;
  }>;
  localRequires: string[];
  truncatedHints: string[];
};

function scanSnippet(text: string, fileRel: string): FoundInSnippet {
  const resources: FoundInSnippet["resources"] = [];
  const localRequires: string[] = [];
  const truncatedHints: string[] = [];

  // require('./local')
  const reqRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = reqRe.exec(text)) !== null) {
    localRequires.push(m[1]!);
  }
  // import x from './local'
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  while ((m = importRe.exec(text)) !== null) {
    localRequires.push(m[1]!);
  }

  // SQL in template literals only (backticks) — avoid English prose false positives
  const sqlRe = /`([^`]{10,2000})`/g;
  while ((m = sqlRe.exec(text)) !== null) {
    const chunk = m[1]!;
    if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|INTO|JOIN)\b/i.test(chunk)) continue;
    for (const table of extractSqlTables(chunk)) {
      if (table.length < 3) continue;
      resources.push({
        kind: "db",
        name: table,
        evidence: `${fileRel}: SQL mentions ${table}`,
      });
    }
  }

  // db.getX / db.upsertX — method names that look like data accessors
  const dbMethodRe = /\bdb\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((m = dbMethodRe.exec(text)) !== null) {
    const method = m[1]!;
    if (
      method === "db" ||
      method === "prepare" ||
      method === "exec" ||
      method === "transaction" ||
      method.length < 4
    ) {
      continue;
    }
    resources.push({
      kind: "db",
      name: method,
      evidence: `${fileRel}: db.${method}(…)`,
    });
  }
  const knexRe = /\b(?:knex|db)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
  while ((m = knexRe.exec(text)) !== null) {
    resources.push({
      kind: "db",
      name: m[1]!,
      evidence: `${fileRel}: knex/db('${m[1]}')`,
    });
  }
  const prismaRe = /\bprisma\.([a-zA-Z_][a-zA-Z0-9_]*)\./g;
  while ((m = prismaRe.exec(text)) !== null) {
    resources.push({
      kind: "db",
      name: m[1]!,
      evidence: `${fileRel}: prisma.${m[1]}`,
    });
  }

  // HTTP hosts
  const hostRe = /https?:\/\/([a-zA-Z0-9.-]+)/g;
  while ((m = hostRe.exec(text)) !== null) {
    const host = m[1]!;
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com/.test(host)) continue;
    resources.push({
      kind: "external",
      name: host,
      evidence: `${fileRel}: HTTP ${host}`,
    });
  }
  // axios/fetch to template BASE_URL etc. — mark as external service call
  if (/\baxios\.(get|post|put|patch|delete)\b/.test(text) || /\bfetch\s*\(/.test(text)) {
    resources.push({
      kind: "external",
      name: "http-client-call",
      evidence: `${fileRel}: axios/fetch outbound call`,
    });
  }

  // Third-party SDKs
  const sdkRe =
    /\b(stripe|twilio|retell|openai|Anthropic|groq|SendGrid|aws-sdk|@aws-sdk)\b/g;
  while ((m = sdkRe.exec(text)) !== null) {
    resources.push({
      kind: "external",
      name: m[1]!.toLowerCase(),
      evidence: `${fileRel}: SDK ${m[1]}`,
    });
  }

  // fs
  const fsRe = /\bfs\.(readFile|writeFile|appendFile|createReadStream|createWriteStream|promises\.(readFile|writeFile))\b/g;
  while ((m = fsRe.exec(text)) !== null) {
    resources.push({
      kind: "fs",
      name: m[1]!,
      evidence: `${fileRel}: fs.${m[1]}`,
    });
  }

  if (localRequires.length > 40) {
    truncatedHints.push(
      `${fileRel}: ${localRequires.length} local requires (capped for walk)`
    );
  }

  return {
    resources,
    localRequires: [...new Set(localRequires)].slice(0, 40),
    truncatedHints,
  };
}

/** Extract case body for `case 'toolName':` … next case / default / end. */
export function extractCaseBody(source: string, toolName: string): string | null {
  const re = new RegExp(
    `case\\s+['"\`]${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]\\s*:`,
    "m"
  );
  const m = re.exec(source);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length;
  const rest = source.slice(start);
  // End at next case/default at similar indent, or closing of switch (heuristic: \n        case )
  const endM = rest.search(/\n\s*case\s+['"`]|\n\s*default\s*:/);
  const body = endM >= 0 ? rest.slice(0, endM) : rest.slice(0, 4000);
  return body;
}

function extractMethodBody(source: string, methodName: string): string | null {
  const re = new RegExp(
    `(?:static\\s+)?(?:async\\s+)?${methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\([^)]*\\)\\s*\\{`,
    "m"
  );
  const m = re.exec(source);
  if (!m || m.index == null) return null;
  const braceStart = source.indexOf("{", m.index);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length && i < braceStart + 80000; i++) {
    const ch = source[i]!;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  return source.slice(braceStart + 1, braceStart + 8000);
}

export function traceToolHandler(
  repoRoot: string,
  handler: string,
  toolName: string,
  cfg: ClassifyConfig,
  maxDepth = DEFAULT_MAX_DEPTH
): ToolReach {
  const [rel, lineStr] = handler.split(":");
  if (!rel) {
    return { resources: [], truncated: false, truncationNote: null };
  }
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return {
      resources: [],
      truncated: false,
      truncationNote: `handler file missing: ${rel}`,
    };
  }

  let source: string;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    return { resources: [], truncated: false, truncationNote: `unreadable ${rel}` };
  }

  const caseBody = extractCaseBody(source, toolName);
  const startSnippets: Array<{ text: string; fileAbs: string; fileRel: string; label: string }> =
    [];

  if (caseBody) {
    startSnippets.push({
      text: caseBody,
      fileAbs: abs,
      fileRel: rel,
      label: `${rel}:${lineStr || "?"} case '${toolName}'`,
    });
    // Follow this._method / Class._method calls inside case
    const methodCalls = [
      ...caseBody.matchAll(/this\.(_?[a-zA-Z][a-zA-Z0-9_]*)\s*\(/g),
      ...caseBody.matchAll(/KellyToolExecutor\.(_?[a-zA-Z][a-zA-Z0-9_]*)\s*\(/g),
    ];
    for (const mc of methodCalls) {
      const name = mc[1]!;
      if (["execute", "constructor", "log", "warn", "error"].includes(name)) continue;
      const body = extractMethodBody(source, name);
      if (body) {
        startSnippets.push({
          text: body,
          fileAbs: abs,
          fileRel: rel,
          label: `${rel}#${name}`,
        });
      }
    }
  } else {
    // No case — scan a window around the line
    const lines = source.split("\n");
    const line = Math.max(0, (parseInt(lineStr || "1", 10) || 1) - 1);
    const window = lines.slice(line, line + 80).join("\n");
    startSnippets.push({
      text: window,
      fileAbs: abs,
      fileRel: rel,
      label: `${handler}`,
    });
  }

  const out: ReachResource[] = [];
  const seenResource = new Set<string>();
  const visitedFiles = new Set<string>();
  let truncated = false;
  const truncNotes: string[] = [];

  type QueueItem = {
    fileAbs: string;
    fileRel: string;
    text: string;
    depth: number;
    pathSoFar: string[];
  };

  const queue: QueueItem[] = startSnippets.map((s) => ({
    fileAbs: s.fileAbs,
    fileRel: s.fileRel,
    text: s.text,
    depth: 0,
    pathSoFar: [s.label],
  }));

  // Always mark the handler file as visited for full-file walks so requires
  // cannot pull the entire executor back in at depth 1+.
  visitedFiles.add(abs);

  while (queue.length > 0) {
    const item = queue.shift()!;
    const found = scanSnippet(item.text, item.fileRel);
    for (const hint of found.truncatedHints) {
      truncated = true;
      truncNotes.push(hint);
    }

    for (const r of found.resources) {
      const key = resourceKey(r.kind, r.name);
      const dedupe = `${key}@${item.depth}`;
      if (seenResource.has(dedupe)) continue;
      seenResource.add(dedupe);

      const cls = classifyResource(r.kind, r.name, cfg);
      if (cls === "unclassified") {
        ensureUnclassifiedTracked(cfg, key);
      } else if (!cfg.resources[key]) {
        cfg.resources[key] = cls;
      }

      out.push({
        kind: r.kind,
        name: r.name,
        class: cls,
        depth: item.depth,
        path: [...item.pathSoFar, `${r.kind}:${r.name}`],
        evidence: r.evidence,
      });
    }

    for (const spec of found.localRequires) {
      const resolved = resolveRequire(item.fileAbs, spec, repoRoot);
      const serviceName = path.basename(spec.replace(/\\/g, "/")).replace(/\.(js|ts|mjs)$/, "") ||
        spec.replace(/^\.\//, "");
      const sKey = resourceKey("service", serviceName);
      const dedupe = `${sKey}@${item.depth}`;
      if (!seenResource.has(dedupe)) {
        seenResource.add(dedupe);
        const cls = classifyResource("service", serviceName, cfg);
        if (cls === "unclassified") ensureUnclassifiedTracked(cfg, sKey);
        else if (!cfg.resources[sKey]) cfg.resources[sKey] = cls;
        out.push({
          kind: "service",
          name: serviceName,
          class: cls,
          depth: item.depth,
          path: [...item.pathSoFar, `service:${serviceName}`],
          evidence: `${item.fileRel}: require('${spec}')`,
        });
      }

      if (!resolved) continue;
      if (visitedFiles.has(resolved)) continue;

      const nextDepth = item.depth + 1;
      if (nextDepth > maxDepth) {
        truncated = true;
        truncNotes.push(
          `depth ${maxDepth} truncated walk into ${path.relative(repoRoot, resolved).split(path.sep).join("/")} (from ${item.fileRel} require '${spec}')`
        );
        continue;
      }
      let nextText: string;
      try {
        nextText = fs.readFileSync(resolved, "utf8");
      } catch {
        continue;
      }
      // Cap large modules — prefer exported function bodies later; for now slice
      if (nextText.length > 120_000) {
        truncated = true;
        truncNotes.push(
          `large module truncated: ${path.relative(repoRoot, resolved).split(path.sep).join("/")} (${nextText.length} bytes)`
        );
        nextText = nextText.slice(0, 120_000);
      }
      visitedFiles.add(resolved);
      const nextRel = path.relative(repoRoot, resolved).split(path.sep).join("/");
      queue.push({
        fileAbs: resolved,
        fileRel: nextRel,
        text: nextText,
        depth: nextDepth,
        pathSoFar: [...item.pathSoFar, nextRel],
      });
    }
  }

  // Prefer shallowest occurrence per resource key
  const byKey = new Map<string, ReachResource>();
  for (const r of out) {
    const k = resourceKey(r.kind, r.name);
    const prev = byKey.get(k);
    if (!prev || r.depth < prev.depth) byKey.set(k, r);
  }

  return {
    resources: [...byKey.values()].sort((a, b) =>
      a.depth !== b.depth ? a.depth - b.depth : a.name.localeCompare(b.name)
    ),
    truncated,
    truncationNote: truncNotes.length
      ? [...new Set(truncNotes)].slice(0, 8).join("; ")
      : null,
  };
}

/**
 * Detect auth / identity checks that run before tools execute on this agent surface.
 * Does not infer safety from absence — reports found:false explicitly.
 */
export function detectAgentAuth(
  repoRoot: string,
  agentFile: string,
  agentText: string
): AgentAuthFinding {
  const lines = agentText.split("\n");
  const patterns: Array<{ re: RegExp; label: string }> = [
    {
      re: /\b(requireAuth|verifyAuth|authenticateUser|isAuthenticated|ensureAuth)\s*\(/,
      label: "auth helper call",
    },
    { re: /\bjwt\.verify\s*\(/, label: "jwt.verify" },
    { re: /\bpassport\.(authenticate|authorize)\s*\(/, label: "passport" },
    {
      re: /\b(verifyIdToken|checkSession|validateSession)\s*\(/,
      label: "session/id token check",
    },
    {
      re: /\b(requireUser|requireWorkspaceAccess)\s*\(/,
      label: "requireUser / workspace access",
    },
    {
      re: /\b(verifyCallerIdentity|assertCallerVerified|requireVerifiedCaller)\s*\(/,
      label: "caller identity verification",
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comments and string-only error codes
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
    for (const p of patterns) {
      if (p.re.test(line)) {
        return {
          found: true,
          location: `${agentFile}:${i + 1}`,
          evidence: `${p.label}: ${line.trim().slice(0, 160)}`,
        };
      }
    }
  }

  // Follow KellyToolExecutor / voice handlers for real identity gates before execute
  const followFiles = [
    path.join(repoRoot, agentFile),
    path.join(repoRoot, "middleware-platform/services/kelly-tool-executor.js"),
    path.join(
      path.dirname(path.join(repoRoot, agentFile)),
      "kelly-tool-executor.js"
    ),
  ];
  const seen = new Set<string>();
  for (const cand of followFiles) {
    if (!fs.existsSync(cand) || seen.has(cand)) continue;
    seen.add(cand);
    const body = fs.readFileSync(cand, "utf8");
    const blines = body.split("\n");
    for (let i = 0; i < blines.length; i++) {
      const line = blines[i]!;
      if (/^\s*\/\//.test(line)) continue;
      if (
        /\b(verifyCallerIdentity|assertAuthenticated|requirePatientAuth|identityVerified\s*=\s*true)\b/.test(
          line
        ) &&
        !/error_code|message\s*:/.test(line)
      ) {
        const rel = path.relative(repoRoot, cand).split(path.sep).join("/");
        return {
          found: true,
          location: `${rel}:${i + 1}`,
          evidence: line.trim().slice(0, 160),
        };
      }
    }
  }

  return {
    found: false,
    location: null,
    evidence:
      "No authentication or identity check found on the path into tool execution. (Conversation-mode firewalls and error-code strings are not authentication.)",
  };
}

/** Prefer resolving tool handlers via KellyToolExecutor when agent dispatches there. */
export function resolveHandlerViaKellyExecutor(
  repoRoot: string,
  toolName: string
): string | null {
  const candidates = [
    path.join(repoRoot, "middleware-platform/services/kelly-tool-executor.js"),
    path.join(repoRoot, "services/kelly-tool-executor.js"),
  ];
  for (const abs of candidates) {
    if (!fs.existsSync(abs)) continue;
    const body = fs.readFileSync(abs, "utf8");
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`case\\s+['"\`]${toolName}['"\`]`).test(lines[i]!)) {
        return `${path.relative(repoRoot, abs).split(path.sep).join("/")}:${i + 1}`;
      }
    }
  }
  return null;
}
