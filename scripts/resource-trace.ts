/**
 * Resource reach tracing from agent tool handlers.
 * Three cell states: reaches | none | not-traced.
 * Large hubs like database.js are extracted once and cached.
 */

import * as fs from "fs";
import * as path from "path";

export type ResourceKind = "db" | "db_call" | "service" | "external" | "fs";
export type ResourceClass =
  | "patient"
  | "money"
  | "external"
  | "internal"
  | "plumbing"
  | "unclassified";

export type CellState = "reaches" | "none" | "not-traced";
export type ClaimConfidence = "high" | "medium";

export type ReachHop = {
  /** Relative file path */
  file: string;
  line: number | null;
  /** Source line or short snippet at the callsite */
  snippet: string;
  label: string;
};

export type ReachResource = {
  kind: ResourceKind;
  name: string;
  class: ResourceClass;
  depth: number;
  path: string[];
  evidence: string;
  /** true when this is a heuristic suggestion, not a human decision */
  guess?: boolean;
  /** Call chain with source lines for the evidence panel */
  hops?: ReachHop[];
  /** Query or call that proves the resource touch */
  proof?: string;
  /** How strongly the tracer stands behind this reaches claim */
  confidence?: ClaimConfidence;
};

export type ClassCell = {
  state: CellState;
  depth: number | null;
  path: string[] | null;
  reason: string | null;
  resources: ReachResource[];
  /** Strongest confidence among resources when state=reaches */
  confidence?: ClaimConfidence | null;
};

export type ToolReach = {
  resources: ReachResource[];
  cells: Record<ResourceClass, ClassCell>;
  truncated: boolean;
  truncationReasons: string[];
};

export type AgentAuthFinding = {
  found: boolean;
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
    plumbing: string[];
  };
  /** Confirmed human (or committed) decisions. */
  resources: Record<string, ResourceClass>;
  /** Heuristic suggestions awaiting confirmation. */
  guesses: Record<string, ResourceClass>;
  /** Keys still needing a decision. */
  unclassified: string[];
  /** Keys dropped as extraction noise (db method calls mistaken for tables, etc.). */
  noise?: string[];
};

/** Sensitivity columns for Reach / rules — plumbing is classified but not a matrix column. */
export const RESOURCE_CLASSES: ResourceClass[] = [
  "patient",
  "money",
  "external",
  "internal",
  "unclassified",
];

export const ALL_RESOURCE_CLASSES: ResourceClass[] = [
  ...RESOURCE_CLASSES,
  "plumbing",
];

/** Cross-cutting utilities — not blast-radius / classify-queue resources. */
export const PLUMBING_SERVICE_NAMES = new Set([
  "http-client-call",
  "circuit-breaker",
  "circuit_breaker",
  "logger",
  "logging",
  "secure-logger",
  "debug",
  "pino",
  "winston",
  "bunyan",
  "prom-client",
  "uuid",
  "lodash",
  "underscore",
]);

export function isPlumbingResource(kind: ResourceKind, name: string): boolean {
  if (kind === "db_call") return false;
  const n = name.toLowerCase().replace(/\.(js|ts|mjs)$/, "");
  if (PLUMBING_SERVICE_NAMES.has(n)) return true;
  if (kind === "external" && n === "http-client-call") return true;
  if (kind === "service" && /^(secure-)?logger$|^circuit[-_]?breaker$/i.test(n)) {
    return true;
  }
  return false;
}

export function isBlastRadiusEligible(kind: ResourceKind, name: string, cls?: ResourceClass): boolean {
  if (kind === "db_call") return false;
  if (cls === "plumbing" || isPlumbingResource(kind, name)) return false;
  return true;
}

/** Default hop depth after measuring 3 / 5 / 7 — see depth experiment in report. */
export const DEFAULT_MAX_DEPTH = 5;

const DEFAULT_CONFIG: ClassifyConfig = {
  version: 2,
  description:
    "Resource sensitivity classification for agent tool reach. guesses = heuristics awaiting confirmation; resources = decisions.",
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
      "opqrst",
      "records",
      "encounter",
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
      "wallet",
      "ledger",
      "position",
      "portfolio",
      "balance",
      "order",
      "trade",
      "holding",
      "custody",
      "settlement",
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
    plumbing: [
      "http-client-call",
      "circuit-breaker",
      "circuit_breaker",
      "logger",
      "logging",
      "metrics",
      "telemetry",
      "prom-client",
    ],
  },
  resources: {},
  guesses: {},
  unclassified: [],
  noise: [],
};

function resourceKey(kind: ResourceKind, name: string): string {
  return `${kind}:${name}`.toLowerCase();
}

export function productClassifyRoot(): string {
  return path.resolve(__dirname, "..");
}

export function classifyConfigPath(repoRoot?: string): string {
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
          plumbing:
            (raw.heuristics as { plumbing?: string[] } | undefined)?.plumbing ??
            cfg.heuristics.plumbing,
        },
        resources: { ...cfg.resources, ...(raw.resources ?? {}) },
        guesses: { ...cfg.guesses, ...(raw.guesses ?? {}) },
        unclassified: [
          ...new Set([
            ...(cfg.unclassified ?? []),
            ...(Array.isArray(raw.unclassified) ? raw.unclassified : []),
          ]),
        ],
        noise: [
          ...new Set([
            ...(cfg.noise ?? []),
            ...(Array.isArray(raw.noise) ? raw.noise : []),
          ]),
        ],
      };
    } catch {
      /* keep */
    }
  };

  loadFile(productPath);
  if (path.resolve(scanPath) !== path.resolve(productPath)) loadFile(scanPath);
  if (!fs.existsSync(productPath)) writeClassifyConfig(productClassifyRoot(), cfg);
  return cfg;
}

export function writeClassifyConfig(repoRoot: string, cfg: ClassifyConfig): void {
  const productPath = path.join(productClassifyRoot(), "resources.classify.json");
  const sorted: ClassifyConfig = {
    ...cfg,
    unclassified: [...new Set(cfg.unclassified)].sort(),
    noise: [...new Set(cfg.noise ?? [])].sort(),
    resources: Object.fromEntries(
      Object.entries(cfg.resources).sort(([a], [b]) => a.localeCompare(b))
    ),
    guesses: Object.fromEntries(
      Object.entries(cfg.guesses ?? {}).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
  fs.writeFileSync(productPath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  const publicCopy = path.join(
    productClassifyRoot(),
    "webapp/client/public/resources.classify.json"
  );
  try {
    fs.mkdirSync(path.dirname(publicCopy), { recursive: true });
    fs.writeFileSync(publicCopy, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  } catch {
    /* optional */
  }
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

/** Snake_case / plural table-like names vs camelCase call expressions. */
export function looksLikeTableName(name: string): boolean {
  if (!name || name.length < 2) return false;
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) return true; // snake_case
  if (/^[a-z]+s$/.test(name) && name.length >= 4 && !/[A-Z]/.test(name)) return true;
  return false;
}

export function looksLikeCallExpression(name: string): boolean {
  // camelCase or PascalCase method-ish
  if (/^[a-z]+[A-Z]/.test(name)) return true;
  if (/^(get|set|create|update|delete|upsert|insert|find|list|clear|is|has|check|run|build|resolve|compute|fetch|load|save|send|verify)/i.test(name) && !name.includes("_")) {
    return true;
  }
  return false;
}

/**
 * Classify a resource. Confirmed resources win; else guesses; else heuristics → guess.
 */
export function classifyResource(
  kind: ResourceKind,
  name: string,
  cfg: ClassifyConfig
): { class: ResourceClass; guess: boolean } {
  const key = resourceKey(kind, name);
  const decided = cfg.resources[key];
  if (
    decided === "patient" ||
    decided === "money" ||
    decided === "external" ||
    decided === "internal" ||
    decided === "plumbing" ||
    decided === "unclassified"
  ) {
    return { class: decided, guess: false };
  }

  if (isPlumbingResource(kind, name)) {
    return { class: "plumbing", guess: false };
  }

  const priorGuess = cfg.guesses?.[key];
  if (
    priorGuess === "patient" ||
    priorGuess === "money" ||
    priorGuess === "external" ||
    priorGuess === "internal" ||
    priorGuess === "plumbing"
  ) {
    return { class: priorGuess, guess: true };
  }

  if (kind === "external") {
    const label = `${kind} ${name}`;
    const patientHit = matchesAny(label, cfg.heuristics.patient);
    const moneyHit = matchesAny(label, cfg.heuristics.money);
    if (patientHit && !moneyHit) return { class: "patient", guess: true };
    if (moneyHit && !patientHit) return { class: "money", guess: true };
    return { class: "external", guess: true };
  }
  if (kind === "fs") return { class: "internal", guess: true };

  const label = `${kind} ${name}`;
  const patientHit = matchesAny(label, cfg.heuristics.patient);
  const moneyHit = matchesAny(label, cfg.heuristics.money);
  if (patientHit && moneyHit) return { class: "unclassified", guess: false };
  if (patientHit) return { class: "patient", guess: true };
  if (moneyHit) return { class: "money", guess: true };
  return { class: "unclassified", guess: false };
}

function trackClassification(
  cfg: ClassifyConfig,
  kind: ResourceKind,
  name: string,
  cls: ResourceClass,
  guess: boolean
): void {
  const key = resourceKey(kind, name);
  if (kind === "db_call" || cls === "plumbing" || isPlumbingResource(kind, name)) {
    if (!cfg.resources[key] && cls === "plumbing") cfg.resources[key] = "plumbing";
    delete cfg.guesses[key];
    cfg.unclassified = cfg.unclassified.filter((k) => k !== key);
    return;
  }
  if (cfg.resources[key]) return;
  if (guess && cls !== "unclassified") {
    cfg.guesses[key] = cls;
  }
  if (!cfg.resources[key] && cls === "unclassified") {
    if (!cfg.unclassified.includes(key)) cfg.unclassified.push(key);
  } else if (guess && !cfg.unclassified.includes(key) && !cfg.resources[key]) {
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
  const stop = new Set([
    "select", "set", "values", "where", "and", "or", "not", "exists",
    "from", "into", "update", "delete", "insert", "join", "left", "right",
    "inner", "outer", "on", "as", "in", "is", "null", "true", "false",
    "their", "there", "then", "than", "this", "that", "with", "when",
    "case", "when", "else", "end", "limit", "offset", "group", "order",
    "by", "having", "union", "all", "distinct", "table", "if",
  ]);
  const re =
    /\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+[`"']?([a-zA-Z_][a-zA-Z0-9_]*)[`"']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const t = m[1]!;
    if (stop.has(t.toLowerCase())) continue;
    if (!looksLikeTableName(t) && looksLikeCallExpression(t)) continue;
    tables.push(t);
  }
  return [...new Set(tables)];
}

function isDatabaseModule(absPath: string): boolean {
  const base = path.basename(absPath).toLowerCase();
  return base === "database.js" || base === "database.ts" || /\/database\.js$/.test(absPath.replace(/\\/g, "/"));
}

type DatabaseCacheEntry = {
  fileRel: string;
  /** Genuine table / collection names from SQL (inventory only — never attributed wholesale). */
  tables: string[];
  /** Exported function → tables that function queries. */
  methodTables: Record<string, string[]>;
  /** Exported function → representative SQL proof snippet. */
  methodProof: Record<string, string>;
};

const databaseModuleCache = new Map<string, DatabaseCacheEntry>();

export function clearDatabaseCache(): void {
  databaseModuleCache.clear();
}

export function extractDatabaseModule(
  absPath: string,
  repoRoot: string
): DatabaseCacheEntry {
  const cached = databaseModuleCache.get(absPath);
  if (cached) return cached;

  const text = fs.readFileSync(absPath, "utf8");
  const fileRel = path.relative(repoRoot, absPath).split(path.sep).join("/");
  const tables = new Set<string>();

  const collectSqlFrom = (chunk: string, into: Set<string>) => {
    if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|INTO|JOIN|CREATE\s+TABLE)\b/i.test(chunk)) {
      return;
    }
    for (const t of extractSqlTables(chunk)) {
      if (looksLikeTableName(t) || /^[a-z][a-z0-9_]*$/.test(t)) into.add(t);
    }
  };

  // Module-wide table inventory (for reporting only — never attributed wholesale)
  const sqlRe = /`([^`]{8,4000})`/g;
  let m: RegExpExecArray | null;
  while ((m = sqlRe.exec(text)) !== null) collectSqlFrom(m[1]!, tables);
  const sqlStrRe = /'(SELECT\s[^']{8,2000}|INSERT\s[^']{8,2000}|UPDATE\s[^']{8,2000}|DELETE\s[^']{8,2000})'/gi;
  while ((m = sqlStrRe.exec(text)) !== null) collectSqlFrom(m[1]!, tables);
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([a-zA-Z_][a-zA-Z0-9_]*)[`"']?/gi;
  while ((m = createRe.exec(text)) !== null) tables.add(m[1]!);

  const methodTables: Record<string, string[]> = {};
  const methodProof: Record<string, string> = {};

  // Object / export methods: name: (args) => { ... }  OR  name: function (...) {
  // Also: function name(  /  exports.name =  /  async function name(
  const startRe =
    /(?:^|\n)\s*(?:async\s+)?(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::\s*(?:async\s*)?(?:function\s*)?\(|=\s*(?:async\s*)?(?:function\s*)?\(|\()/gm;

  const starts: Array<{ name: string; index: number }> = [];
  while ((m = startRe.exec(text)) !== null) {
    const name = m[1]!;
    // Skip control / keywords
    if (
      [
        "if",
        "for",
        "while",
        "switch",
        "catch",
        "return",
        "typeof",
        "new",
        "await",
        "const",
        "let",
        "var",
      ].includes(name)
    ) {
      continue;
    }
    starts.push({ name, index: m.index });
  }

  for (let i = 0; i < starts.length; i++) {
    const { name, index } = starts[i]!;
    // Find opening '{' of the function body (skip param list, which may contain `= null`)
    let openParen = text.indexOf("(", index);
    if (openParen < 0 || openParen > index + 120) continue;
    let paren = 0;
    let braceStart = -1;
    for (let j = openParen; j < text.length && j < openParen + 8000; j++) {
      const ch = text[j]!;
      if (ch === "(") paren++;
      else if (ch === ")") {
        paren--;
        if (paren === 0) {
          const arrow = text.slice(j + 1, j + 40).match(/^\s*(?:=>)?\s*\{/);
          if (!arrow) break;
          braceStart = j + 1 + text.slice(j + 1).indexOf("{");
          break;
        }
      }
    }
    if (braceStart < 0) continue;
    let depth = 0;
    let end = braceStart;
    const limit = Math.min(text.length, braceStart + 120000);
    for (let j = braceStart; j < limit; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    const body = text.slice(braceStart, end + 1);
    const local = new Set<string>();
    const proofs: string[] = [];
    const bodySql = /`([^`]{8,4000})`/g;
    let bm: RegExpExecArray | null;
    while ((bm = bodySql.exec(body)) !== null) {
      const before = local.size;
      collectSqlFrom(bm[1]!, local);
      if (local.size > before) proofs.push(bm[1]!.replace(/\s+/g, " ").slice(0, 160));
    }
    const bodyStr = /'(SELECT\s[^']+|INSERT\s[^']+|UPDATE\s[^']+|DELETE\s[^']+)'/gi;
    while ((bm = bodyStr.exec(body)) !== null) {
      const before = local.size;
      collectSqlFrom(bm[1]!, local);
      if (local.size > before) proofs.push(bm[1]!.replace(/\s+/g, " ").slice(0, 160));
    }
    if (local.size) {
      // Prefer later definition if duplicates (object literal usually last)
      methodTables[name] = [...local];
      if (proofs[0]) methodProof[name] = proofs[0]!;
    }
  }

  const entry: DatabaseCacheEntry = {
    fileRel,
    tables: [...tables].sort(),
    methodTables,
    methodProof,
  };
  databaseModuleCache.set(absPath, entry);
  return entry;
}

type FoundInSnippet = {
  resources: Array<{ kind: ResourceKind; name: string; evidence: string }>;
  localRequires: string[];
  /** Top-level binding → require path, when fileBindings provided */
  bindingCalls: Array<{ binding: string; method?: string }>;
  truncHints: string[];
};

function scanSnippet(
  text: string,
  fileRel: string,
  opts?: { emitDbCalls?: boolean }
): FoundInSnippet {
  const resources: FoundInSnippet["resources"] = [];
  const localRequires: string[] = [];
  const truncHints: string[] = [];
  const emitDbCalls = opts?.emitDbCalls !== false;

  const reqRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = reqRe.exec(text)) !== null) localRequires.push(m[1]!);
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  while ((m = importRe.exec(text)) !== null) localRequires.push(m[1]!);

  // Genuine SQL tables only — in backticks or in quotes.
  //
  // This scanned template literals alone, so db.prepare('SELECT ... FROM x')
  // was invisible and the agent appeared to touch nothing. extractDatabaseModule
  // already handled the quoted form; these two disagreed, silently.
  const sqlChunks: string[] = [];

  const sqlRe = /`([^`]{10,4000})`/g;
  while ((m = sqlRe.exec(text)) !== null) sqlChunks.push(m[1]!);

  const quotedSqlRe =
    /['"]\s*((?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE)\s[^'"]{8,2000})['"]/gi;
  while ((m = quotedSqlRe.exec(text)) !== null) sqlChunks.push(m[1]!);

  for (const chunk of sqlChunks) {
    if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|INTO|JOIN|CREATE\s+TABLE)\b/i.test(chunk)) {
      continue;
    }
    for (const table of extractSqlTables(chunk)) {
      if (!looksLikeTableName(table) && looksLikeCallExpression(table)) continue;
      if (table.length < 3) continue;
      resources.push({
        kind: "db",
        name: table,
        evidence: `${fileRel}: SQL table ${table}`,
      });
    }
  }

  // knex('table') / prisma.model — tables
  const knexRe = /\b(?:knex|db)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
  while ((m = knexRe.exec(text)) !== null) {
    const t = m[1]!;
    if (looksLikeTableName(t) || !looksLikeCallExpression(t)) {
      resources.push({ kind: "db", name: t, evidence: `${fileRel}: knex/db('${t}')` });
    }
  }
  const prismaRe = /\bprisma\.([a-zA-Z_][a-zA-Z0-9_]*)\./g;
  while ((m = prismaRe.exec(text)) !== null) {
    resources.push({
      kind: "db",
      name: m[1]!,
      evidence: `${fileRel}: prisma.${m[1]}`,
    });
  }

  // db.method — call OR property reference (e.g. const fn = db.getPatient…; fn())
  if (emitDbCalls) {
    const dbMethodRe = /\bdb\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const skipDbProps = new Set([
      "db",
      "prepare",
      "exec",
      "transaction",
      "query",
      "run",
      "get",
      "all",
      "pragma",
      "close",
      "serialize",
      "parallelize",
    ]);
    const seenMethods = new Set<string>();
    while ((m = dbMethodRe.exec(text)) !== null) {
      const method = m[1]!;
      if (skipDbProps.has(method) || method.length < 3) continue;
      if (seenMethods.has(method)) continue;
      seenMethods.add(method);
      const line = text.slice(0, m.index).split("\n").length;
      const lineText = text.split("\n")[line - 1]?.trim() ?? `db.${method}`;
      resources.push({
        kind: "db_call",
        name: method,
        evidence: `${fileRel}:${line}: ${lineText.slice(0, 120)}`,
      });
    }
  }

  // Generic db.prepare('SQL') / db.query("SQL") with literal — extract tables
  const litPrep =
    /\bdb\.(?:prepare|query|exec|run)\(\s*(`([^`]{8,4000})`|'((?:SELECT|INSERT|UPDATE|DELETE)\s[^']{8,2000})')/gi;
  while ((m = litPrep.exec(text)) !== null) {
    const sql = m[2] || m[3] || "";
    const line = text.slice(0, m.index).split("\n").length;
    for (const table of extractSqlTables(sql)) {
      if (!looksLikeTableName(table) && looksLikeCallExpression(table)) continue;
      resources.push({
        kind: "db",
        name: table,
        evidence: `${fileRel}:${line}: literal SQL → ${table}`,
      });
    }
  }
  // Runtime-built SQL into prepare/query — not-traced marker via truncHints
  if (
    /\bdb\.(?:prepare|query)\(\s*(?!`|'|")/.test(text) ||
    /\bdb\.(?:prepare|query)\(\s*[a-zA-Z_$][\w$]*\s*[,)]/.test(text)
  ) {
    // Ignore if every prepare uses a literal (already handled). Flag remaining dynamic forms.
    const dyn =
      /\bdb\.(?:prepare|query)\(\s*([a-zA-Z_$][\w$]*|[^`'"][^)]*)\)/g;
    while ((m = dyn.exec(text)) !== null) {
      const arg = m[1] || "";
      if (/^[`']/.test(arg.trim())) continue;
      if (/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(arg.trim())) continue;
      truncHints.push(
        `dynamic-sql: ${fileRel} db.prepare/query with runtime string — cannot attribute tables`
      );
      break;
    }
  }

  const hostRe = /https?:\/\/([a-zA-Z0-9.-]+)/g;
  while ((m = hostRe.exec(text)) !== null) {
    const host = m[1]!;
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com/.test(host)) continue;
    resources.push({ kind: "external", name: host, evidence: `${fileRel}: HTTP ${host}` });
  }

  // Literal HTTP paths — prefer these over generic http-client-call
  const litPaths: string[] = [];
  const postLit =
    /\b(?:this\.)?_post(?:Direct)?\(\s*['"`](\/[^'"`]+)['"`]/g;
  while ((m = postLit.exec(text)) !== null) litPaths.push(m[1]!);
  const axiosLit =
    /\baxios\.(get|post|put|patch|delete)\(\s*['"`](https?:\/\/[^'"`]+|\/[^'"`]+)['"`]/gi;
  while ((m = axiosLit.exec(text)) !== null) litPaths.push(m[2]!);
  const axiosTpl =
    /\baxios\.(get|post|put|patch|delete)\(\s*`\$\{[^}]+\}(\/[^`]+)`/gi;
  while ((m = axiosTpl.exec(text)) !== null) litPaths.push(m[2]!);
  const fetchLit = /\bfetch\(\s*[`'"](https?:\/\/[^'"`]+|\/[^'"`]+)[`'"]/g;
  while ((m = fetchLit.exec(text)) !== null) litPaths.push(m[1]!);

  for (const p of [...new Set(litPaths)]) {
    const pathOnly = p.replace(/^https?:\/\/[^/]+/, "") || p;
    const line = 0;
    resources.push({
      kind: "external",
      name: pathOnly.replace(/^\//, "").slice(0, 120) || p,
      evidence: `${fileRel}: HTTP ${p}`,
    });
  }

  const hasGenericHttp =
    /\baxios\.(get|post|put|patch|delete)\b/.test(text) || /\bfetch\s*\(/.test(text);
  if (hasGenericHttp && litPaths.length === 0) {
    resources.push({
      kind: "external",
      name: "http-client-call",
      evidence: `${fileRel}: axios/fetch outbound call (no literal path)`,
    });
  }
  const sdkRe =
    /\b(stripe|twilio|retell|openai|Anthropic|groq|SendGrid|aws-sdk|@aws-sdk)\b/g;
  while ((m = sdkRe.exec(text)) !== null) {
    resources.push({
      kind: "external",
      name: m[1]!.toLowerCase(),
      evidence: `${fileRel}: SDK ${m[1]}`,
    });
  }
  const fsRe =
    /\bfs\.(readFile|writeFile|appendFile|createReadStream|createWriteStream|promises\.(readFile|writeFile))\b/g;
  while ((m = fsRe.exec(text)) !== null) {
    resources.push({ kind: "fs", name: m[1]!, evidence: `${fileRel}: fs.${m[1]}` });
  }

  // Binding.method( calls — resolved via file-level requires by caller
  const bindingCalls: Array<{ binding: string; method?: string }> = [];
  const callRe = /\b([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((m = callRe.exec(text)) !== null) {
    if (["Math", "JSON", "Object", "Array", "Promise", "Error", "Date", "Buffer"].includes(m[1]!)) {
      continue;
    }
    bindingCalls.push({ binding: m[1]!, method: m[2] });
  }

  if (localRequires.length > 50) {
    truncHints.push(`${fileRel}: ${localRequires.length} local requires (capped)`);
  }

  return {
    resources,
    localRequires: [...new Set(localRequires)].slice(0, 50),
    bindingCalls,
    truncHints,
  };
}

function parseFileBindings(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    map.set(m[1]!, m[2]!);
  }
  return map;
}

export function extractCaseBody(source: string, toolName: string): string | null {
  const re = new RegExp(
    `case\\s+['"\`]${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]\\s*:`,
    "m"
  );
  const m = re.exec(source);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length;
  const rest = source.slice(start);
  const endM = rest.search(/\n\s*case\s+['"`]|\n\s*default\s*:/);
  return endM >= 0 ? rest.slice(0, endM) : rest.slice(0, 4000);
}

function extractMethodBody(source: string, methodName: string): string | null {
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Prefer definitions (static/async/function) over call sites.
  const re = new RegExp(
    `(?:static\\s+|async\\s+|function\\s+)+${escaped}\\s*\\(`,
    "gm"
  );
  let m: RegExpExecArray | null;
  const candidates: number[] = [];
  while ((m = re.exec(source)) !== null) {
    candidates.push(m.index + m[0].length - 1); // index of '('
  }
  // Fallback: bare `name(` only if unique definition-like `) {` follows
  if (candidates.length === 0) {
    const bare = new RegExp(`(?:^|[\\s;.{}])${escaped}\\s*\\(`, "gm");
    while ((m = bare.exec(source)) !== null) {
      const open = source.indexOf("(", m.index);
      candidates.push(open);
    }
  }

  for (const openParen of candidates) {
    let i = openParen;
    let paren = 0;
    let braceStart = -1;
    for (; i < source.length && i < openParen + 5000; i++) {
      const ch = source[i]!;
      if (ch === "(") paren++;
      else if (ch === ")") {
        paren--;
        if (paren === 0) {
          const rest = source.slice(i + 1);
          const bm = rest.match(/^\s*\{/);
          if (!bm) break;
          braceStart = i + 1 + rest.indexOf("{");
          break;
        }
      }
    }
    if (braceStart < 0) continue;
    let depth = 0;
    for (let j = braceStart; j < source.length && j < braceStart + 80000; j++) {
      const ch = source[j]!;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return source.slice(braceStart + 1, j);
      }
    }
  }
  return null;
}

function emptyCells(
  state: CellState,
  reason: string | null
): Record<ResourceClass, ClassCell> {
  const cells = {} as Record<ResourceClass, ClassCell>;
  for (const c of RESOURCE_CLASSES) {
    cells[c] = {
      state,
      depth: null,
      path: null,
      reason,
      resources: [],
      confidence: null,
    };
  }
  return cells;
}

const CONF_RANK: Record<ClaimConfidence, number> = { medium: 0, high: 1 };

export function rankConfidence(a: ClaimConfidence, b: ClaimConfidence): ClaimConfidence {
  return CONF_RANK[a] >= CONF_RANK[b] ? a : b;
}

/**
 * Confidence for a reaches claim (two tiers only — low was unreachable and misleading).
 * high   — literal SQL or explicit SDK/HTTP path, depth <= 2
 * medium — deeper, or inferred from a function/service name rather than a query
 */
export function assignClaimConfidence(
  r: Omit<ReachResource, "confidence">,
  _truncationReasons: string[]
): ClaimConfidence {
  const literalSql = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(r.proof ?? r.evidence);
  const explicitHttp =
    r.kind === "external" &&
    r.name !== "http-client-call" &&
    (/HTTP \//.test(r.evidence) || /SDK /.test(r.evidence));
  const explicitSdk =
    r.kind === "external" &&
    /^(stripe|twilio|retell|openai|anthropic|groq|sendgrid)/i.test(r.name);

  if ((literalSql || explicitHttp || explicitSdk) && r.depth <= 2) return "high";
  return "medium";
}

function buildCells(
  resources: ReachResource[],
  truncated: boolean,
  truncationReasons: string[],
  unresolvedHandler: boolean
): Record<ResourceClass, ClassCell> {
  if (unresolvedHandler) {
    return emptyCells(
      "not-traced",
      "unresolved-handler: no file:line handler for this tool"
    );
  }

  const cells = {} as Record<ResourceClass, ClassCell>;
  for (const c of RESOURCE_CLASSES) {
    const use = resources.filter((r) => r.class === c && r.class !== "plumbing");
    if (use.length > 0) {
      const best = use.reduce((a, b) => (a.depth <= b.depth ? a : b));
      const conf = use.reduce<ClaimConfidence>(
        (acc, r) => rankConfidence(acc, r.confidence ?? "medium"),
        "medium"
      );
      cells[c] = {
        state: "reaches",
        depth: best.depth,
        path: best.path,
        reason: null,
        resources: use,
        confidence: conf,
      };
    } else if (truncated) {
      cells[c] = {
        state: "not-traced",
        depth: null,
        path: null,
        reason:
          truncationReasons[0] ??
          "walk truncated before this class could be ruled out",
        resources: [],
        confidence: null,
      };
    } else {
      cells[c] = {
        state: "none",
        depth: null,
        path: null,
        reason: null,
        resources: [],
        confidence: null,
      };
    }
  }
  return cells;
}

export function unresolvedHandlerReach(reason?: string): ToolReach {
  const r = reason ?? "unresolved-handler: no file:line handler for this tool";
  return {
    resources: [],
    cells: emptyCells("not-traced", r),
    truncated: true,
    truncationReasons: [r],
  };
}

export function traceToolHandler(
  repoRoot: string,
  handler: string | null,
  toolName: string,
  cfg: ClassifyConfig,
  maxDepth = DEFAULT_MAX_DEPTH
): ToolReach {
  if (!handler) {
    return unresolvedHandlerReach();
  }

  const [rel, lineStr] = handler.split(":");
  if (!rel) return unresolvedHandlerReach("unresolved-handler: malformed handler ref");

  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return unresolvedHandlerReach(`unresolved-handler: missing file ${rel}`);
  }

  let source: string;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    return unresolvedHandlerReach(`unresolved-handler: unreadable ${rel}`);
  }

  const fileBindings = parseFileBindings(source);
  const caseBody = extractCaseBody(source, toolName);
  const out: ReachResource[] = [];
  const seenResource = new Set<string>();
  const visitedFiles = new Set<string>([abs]);
  let truncated = false;
  const truncNotes: string[] = [];
  const startSnippets: Array<{
    text: string;
    fileAbs: string;
    fileRel: string;
    label: string;
    bindings: Map<string, string>;
  }> = [];

  if (caseBody) {
    startSnippets.push({
      text: caseBody,
      fileAbs: abs,
      fileRel: rel,
      label: `${rel}:${lineStr || "?"} case '${toolName}'`,
      bindings: fileBindings,
    });
    // Method dispatch, class dispatch, and plain function dispatch. The last
    // was missing, so
    //
    //   case 'get_portfolio': return getPortfolio(args, context);
    //
    // led nowhere and the tool reported zero resources — indistinguishable from
    // having checked and found nothing.
    const methodCalls = [
      ...caseBody.matchAll(/this\.(_?[a-zA-Z][a-zA-Z0-9_]*)\s*\(/g),
      ...caseBody.matchAll(/KellyToolExecutor\.(_?[a-zA-Z][a-zA-Z0-9_]*)\s*\(/g),
      ...caseBody.matchAll(/(?:return|await)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g),
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
          bindings: fileBindings,
        });
      } else {
        truncated = true;
        truncNotes.push(
          `dynamic-dispatch: could not resolve method body for ${rel}#${name}`
        );
      }
    }
  } else {
    const lines = source.split("\n");
    const line = Math.max(0, (parseInt(lineStr || "1", 10) || 1) - 1);
    startSnippets.push({
      text: lines.slice(line, line + 80).join("\n"),
      fileAbs: abs,
      fileRel: rel,
      label: handler,
      bindings: fileBindings,
    });
  }

  type QueueItem = {
    fileAbs: string;
    fileRel: string;
    text: string;
    depth: number;
    pathSoFar: string[];
    bindings: Map<string, string>;
  };

  const queue: QueueItem[] = startSnippets.map((s) => ({
    fileAbs: s.fileAbs,
    fileRel: s.fileRel,
    text: s.text,
    depth: 0,
    pathSoFar: [s.label],
    bindings: s.bindings,
  }));

  // visitedFiles already seeded with handler file below

  const pushResource = (
    kind: ResourceKind,
    name: string,
    depth: number,
    pathSoFar: string[],
    evidence: string,
    hops?: ReachHop[],
    proof?: string
  ) => {
    const key = resourceKey(kind, name);
    const dedupe = `${key}@${depth}`;
    if (seenResource.has(dedupe)) return;
    seenResource.add(dedupe);
    const { class: cls, guess } = classifyResource(kind, name, cfg);
    trackClassification(cfg, kind, name, cls, guess);
    const derivedHops: ReachHop[] =
      hops ??
      pathSoFar.map((label) => {
        const lm = /^(.+?):(\d+)/.exec(label);
        return {
          file: lm?.[1] ?? label.replace(/#.+$/, ""),
          line: lm ? parseInt(lm[2]!, 10) : null,
          snippet: label,
          label,
        };
      });
    // Append leaf evidence as final hop when not already covered
    if (evidence && !derivedHops.some((h) => h.snippet === evidence.slice(0, 160))) {
      const em = /([^:\s]+):(\d+)/.exec(evidence);
      derivedHops.push({
        file: em?.[1] ?? pathSoFar[pathSoFar.length - 1] ?? "",
        line: em ? parseInt(em[2]!, 10) : null,
        snippet: evidence.slice(0, 200),
        label: `${kind}:${name}`,
      });
    }
    out.push({
      kind,
      name,
      class: cls,
      depth,
      path: [...pathSoFar, `${kind}:${name}`],
      evidence,
      guess: guess || undefined,
      hops: derivedHops,
      proof,
      confidence: assignClaimConfidence(
        {
          kind,
          name,
          class: cls,
          depth,
          path: [...pathSoFar, `${kind}:${name}`],
          evidence,
          proof,
        },
        truncNotes
      ),
    });
  };

  /**
   * Attribute ONLY tables touched by a specific exported function.
   * Never dumps the whole module table set.
   */
  const attachDatabaseCallsite = (
    dbAbs: string,
    depth: number,
    pathSoFar: string[],
    method: string | undefined,
    callsiteEvidence: string
  ): void => {
    const entry = extractDatabaseModule(dbAbs, repoRoot);
    if (!method) {
      truncated = true;
      truncNotes.push(
        `unresolved-callsite: require(${entry.fileRel}) without a specific exported function — not attributing all tables`
      );
      return;
    }
    const tables = entry.methodTables[method];
    const pathWithDb = [...pathSoFar, `${entry.fileRel}#${method}`];
    const hop: ReachHop = {
      file: entry.fileRel,
      line: null,
      snippet: callsiteEvidence.slice(0, 160),
      label: `db.${method}`,
    };
    if (tables && tables.length) {
      const proof = entry.methodProof[method];
      for (const t of tables) {
        pushResource(
          "db",
          t,
          depth,
          pathWithDb,
          `${entry.fileRel}: ${method} → ${t}`,
          [hop],
          proof ?? `db.${method}`
        );
      }
      return;
    }
    // Function resolved but no SQL found in body — record call, do not smear tables
    truncated = true;
    truncNotes.push(
      `unresolved-callsite: ${entry.fileRel}#${method} has no extractable SQL tables (empty body, dynamic SQL, or re-export)`
    );
    pushResource(
      "db_call",
      method,
      depth,
      pathWithDb,
      `${entry.fileRel}: db.${method} (no SQL mapped)`,
      [hop],
      `db.${method}(…)`
    );
  };

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (!item.text) continue;

    const found = scanSnippet(item.text, item.fileRel);
    for (const hint of found.truncHints) {
      truncated = true;
      truncNotes.push(hint);
    }

    for (const r of found.resources) {
      if (r.kind === "db_call") {
        // Prefer resolving through database cache
        const dbCandidates = [
          path.join(path.dirname(item.fileAbs), "../database.js"),
          path.join(path.dirname(item.fileAbs), "../../database.js"),
          path.join(repoRoot, "middleware-platform/database.js"),
          path.join(repoRoot, "database.js"),
        ];
        let resolvedDb: string | null = null;
        for (const c of dbCandidates) {
          if (fs.existsSync(c)) {
            resolvedDb = c;
            break;
          }
        }
        // Also from require('../database') in same file bindings
        for (const spec of item.bindings.values()) {
          if (/database/.test(spec)) {
            const rabs = resolveRequire(item.fileAbs, spec, repoRoot);
            if (rabs && isDatabaseModule(rabs)) resolvedDb = rabs;
          }
        }
        if (resolvedDb) {
          attachDatabaseCallsite(
            resolvedDb,
            item.depth,
            item.pathSoFar,
            r.name,
            r.evidence
          );
        } else {
          truncated = true;
          truncNotes.push(
            `unresolved-callsite: db.${r.name} — database module not found`
          );
          pushResource(r.kind, r.name, item.depth, item.pathSoFar, r.evidence);
        }
        continue;
      }
      pushResource(r.kind, r.name, item.depth, item.pathSoFar, r.evidence);
    }

    // Follow Binding.method via file requires (e.g. QueryPlanner.runRecordsRetrieval)
    for (const bc of found.bindingCalls) {
      const spec = item.bindings.get(bc.binding);
      if (!spec) continue;
      const resolved = resolveRequire(item.fileAbs, spec, repoRoot);
      if (!resolved) {
        truncated = true;
        truncNotes.push(
          `dynamic-dispatch: ${bc.binding}.${bc.method} require '${spec}' unresolved`
        );
        continue;
      }
      const serviceName =
        path.basename(spec.replace(/\\/g, "/")).replace(/\.(js|ts|mjs)$/, "") ||
        spec.replace(/^\.\//, "");

      if (isDatabaseModule(resolved)) {
        attachDatabaseCallsite(
          resolved,
          item.depth + 1 > maxDepth ? maxDepth : item.depth + 1,
          [...item.pathSoFar, `${serviceName}${bc.method ? "." + bc.method : ""}`],
          bc.method,
          `${item.fileRel}: ${bc.binding}.${bc.method}`
        );
        continue;
      }

      pushResource(
        "service",
        serviceName,
        item.depth,
        item.pathSoFar,
        `${item.fileRel}: ${bc.binding}.${bc.method} via require('${spec}')`
      );

      if (visitedFiles.has(resolved)) continue;
      const nextDepth = item.depth + 1;
      if (nextDepth > maxDepth) {
        truncated = true;
        truncNotes.push(
          `depth-limit: depth ${maxDepth} stopped before ${path.relative(repoRoot, resolved).split(path.sep).join("/")} (${bc.binding}.${bc.method})`
        );
        continue;
      }
      let nextText = fs.readFileSync(resolved, "utf8");
      if (bc.method) {
        const body = extractMethodBody(nextText, bc.method!);
        if (body) nextText = body;
      }
      if (nextText.length > 200_000) {
        truncated = true;
        truncNotes.push(
          `module-size-cap: ${path.relative(repoRoot, resolved).split(path.sep).join("/")} (${nextText.length} bytes)`
        );
        nextText = nextText.slice(0, 200_000);
      }
      visitedFiles.add(resolved);
      queue.push({
        fileAbs: resolved,
        fileRel: path.relative(repoRoot, resolved).split(path.sep).join("/"),
        text: nextText,
        depth: nextDepth,
        pathSoFar: [
          ...item.pathSoFar,
          path.relative(repoRoot, resolved).split(path.sep).join("/"),
        ],
        bindings: parseFileBindings(fs.readFileSync(resolved, "utf8")),
      });
    }

    for (const spec of found.localRequires) {
      const resolved = resolveRequire(item.fileAbs, spec, repoRoot);
      const serviceName =
        path.basename(spec.replace(/\\/g, "/")).replace(/\.(js|ts|mjs)$/, "") ||
        spec.replace(/^\.\//, "");

      // database.js: never attribute all tables on a bare require — and do not
      // credit a generic service:database reach (that re-smeared every tool).
      if (resolved && isDatabaseModule(resolved)) {
        attachDatabaseCallsite(
          resolved,
          item.depth + 1,
          [...item.pathSoFar, serviceName],
          undefined,
          `${item.fileRel}: require('${spec}')`
        );
        continue;
      }

      pushResource(
        "service",
        serviceName,
        item.depth,
        item.pathSoFar,
        `${item.fileRel}: require('${spec}')`
      );

      if (!resolved) continue;
      if (visitedFiles.has(resolved)) continue;

      const nextDepth = item.depth + 1;
      if (nextDepth > maxDepth) {
        truncated = true;
        truncNotes.push(
          `depth-limit: depth ${maxDepth} stopped before ${path.relative(repoRoot, resolved).split(path.sep).join("/")} (require '${spec}')`
        );
        continue;
      }

      let nextText: string;
      try {
        nextText = fs.readFileSync(resolved, "utf8");
      } catch {
        continue;
      }
      if (nextText.length > 200_000) {
        truncated = true;
        truncNotes.push(
          `module-size-cap: ${path.relative(repoRoot, resolved).split(path.sep).join("/")} (${nextText.length} bytes)`
        );
        nextText = nextText.slice(0, 200_000);
      }
      visitedFiles.add(resolved);
      queue.push({
        fileAbs: resolved,
        fileRel: path.relative(repoRoot, resolved).split(path.sep).join("/"),
        text: nextText,
        depth: nextDepth,
        pathSoFar: [
          ...item.pathSoFar,
          path.relative(repoRoot, resolved).split(path.sep).join("/"),
        ],
        bindings: parseFileBindings(nextText),
      });
    }
  }

  // Prefer shallowest per key
  const byKey = new Map<string, ReachResource>();
  for (const r of out) {
    const k = resourceKey(r.kind, r.name);
    const prev = byKey.get(k);
    if (!prev || r.depth < prev.depth) byKey.set(k, r);
  }
  const resources = [...byKey.values()].sort((a, b) =>
    a.depth !== b.depth ? a.depth - b.depth : a.name.localeCompare(b.name)
  );

  const reasons = [...new Set(truncNotes)].slice(0, 12);
  return {
    resources,
    cells: buildCells(resources, truncated, reasons, false),
    truncated,
    truncationReasons: reasons,
  };
}

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

  return {
    found: false,
    location: null,
    evidence:
      "No authentication or identity check found in this file. Callers and " +
      "middleware are not followed, so a check performed at the ingress — where " +
      "it belongs — will not be seen here. Verify before treating this as a " +
      "finding. (Conversation-mode firewalls and error-code strings are not " +
      "authentication.)",
  };
}

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

/**
 * After a scan, move camelCase db:* keys that are really call expressions into noise,
 * drop db_call from the queue, and mark plumbing resources.
 */
export function scrubExtractionNoise(cfg: ClassifyConfig): {
  noiseCount: number;
  realUnclassified: number;
  plumbingRemoved: number;
  dbCallRemoved: number;
} {
  const noise: string[] = [...(cfg.noise ?? [])];
  let plumbingRemoved = 0;
  let dbCallRemoved = 0;
  const keepUncl: string[] = [];

  const dropKey = (key: string, why: "noise" | "plumbing" | "db_call") => {
    if (why === "noise") noise.push(key);
    if (why === "plumbing") {
      cfg.resources[key] = "plumbing";
      plumbingRemoved++;
    }
    if (why === "db_call") dbCallRemoved++;
    delete cfg.guesses[key];
  };

  for (const key of cfg.unclassified) {
    const [kind, ...rest] = key.split(":");
    const name = rest.join(":");
    if (kind === "db_call") {
      dropKey(key, "db_call");
      continue;
    }
    if (kind === "db" && looksLikeCallExpression(name) && !looksLikeTableName(name)) {
      dropKey(key, "noise");
      continue;
    }
    if (
      kind &&
      name &&
      (isPlumbingResource(kind as ResourceKind, name) ||
        cfg.resources[key] === "plumbing" ||
        matchesAny(name, cfg.heuristics.plumbing ?? []))
    ) {
      dropKey(key, "plumbing");
      continue;
    }
    keepUncl.push(key);
  }

  for (const map of [cfg.resources, cfg.guesses]) {
    for (const key of Object.keys(map)) {
      const [kind, ...rest] = key.split(":");
      const name = rest.join(":");
      if (kind === "db_call") {
        delete map[key];
        dbCallRemoved++;
        continue;
      }
      if (kind === "db" && looksLikeCallExpression(name) && !looksLikeTableName(name)) {
        noise.push(key);
        delete map[key];
        continue;
      }
      if (kind && name && isPlumbingResource(kind as ResourceKind, name)) {
        if (map === cfg.resources) cfg.resources[key] = "plumbing";
        else delete map[key];
        plumbingRemoved++;
      }
    }
  }

  // Force session meta classification from committed decision (set by caller)
  cfg.noise = [...new Set(noise)].sort();
  cfg.unclassified = [...new Set(keepUncl)].sort();
  return {
    noiseCount: cfg.noise.length,
    realUnclassified: cfg.unclassified.length,
    plumbingRemoved,
    dbCallRemoved,
  };
}
