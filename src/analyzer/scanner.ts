import { Project, SourceFile, SyntaxKind } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import { ArchNode, ArchEdge, ArchGraph, SemanticSignals, ContractFinding } from "../types";
import { resolveImportPath } from "./pathResolver";

// ── Asset / vendor path exclusions ──────────────────────────────────────────
const EXCLUDED_PATTERNS = [
  /\/assets\//i,
  /\/public\//i,
  /\/static\//i,
  /\/dist\//i,
  /\/build\//i,
  /\/vendor\//i,
  /node_modules/i,
  /\/\.git\//,
  /\/__tests__\//,
  /\/coverage\//i,
  /\/\.next\//i,
  /\/\.nuxt\//i,
];

const EXCLUDED_BASENAMES = new Set([
  "js",
  "css",
  "images",
  "fonts",
  "icons",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  "out",
]);

function isExcluded(moduleId: string): boolean {
  const norm = moduleId.replace(/\\/g, "/");
  if (EXCLUDED_PATTERNS.some((p) => p.test(`/${norm}/`))) return true;
  const segments = norm.split("/");
  return segments.some((s) => EXCLUDED_BASENAMES.has(s));
}

/**
 * Trading: under middleware-platform/services, every first-level folder becomes
 * its own node (strategy/policy/risk/… plus compliance/provenance/…). Flat
 * *.js files in services/ map to spine-aligned aliases — never a bare
 * middleware-platform/services mega-node.
 */
/** Flat service files → spine-aligned buckets (no disk moves). */
const RESIDUAL_SERVICE_FILE_ALIAS: Record<string, string> = {
  "llm-router.js": "agent-runtime",
  "trading-tool-executor.js": "agent-runtime",
  "trading-turn-resolver.js": "agent-runtime",
  "trading-chat-service.js": "agent-runtime",
  "telegram-bot.js": "ingress",
  "telegram-auth.js": "ingress",
  "telegram-paper-commands.js": "ingress",
  "caller.js": "ingress",
  "identity-service.js": "ingress",
  "email-sender.js": "ingress",
  "paper-wallet-writer.js": "payment",
  "wallet-service.js": "payment",
  "trade-service.js": "payment",
  "trade-confirm.js": "payment",
  "trade-reporting.js": "payment",
  "positions.js": "payment",
  "signal-engine.js": "strategy",
  "pead.js": "strategy",
  "pead-cycle-adapter.js": "strategy",
  "fda-client.js": "strategy",
  "dividend-service.js": "strategy",
  "earnings-ingest.js": "strategy",
  "regime-service.js": "strategy",
  "sub-sectors.js": "strategy",
  "policy.js": "policy",
  "broker-snapshot.js": "broker",
  "market-data-client.js": "market-data",
  "market-calendar-nyse.js": "market-data",
  "health-service.js": "data_obs",
  "observability-service.js": "data_obs",
  "scheduler.js": "data_obs",
  "metrics.js": "data_obs",
  "metrics-service.js": "data_obs",
  "eod-report.js": "data_obs",
  "langsmith-trace-service.js": "data_obs",
  "knowledge-ingest.js": "data_obs",
  "entity-resolver.js": "data_obs",
  "pinecone-rest.js": "data_obs",
  "vector-index-ops.js": "data_obs",
  "vector-retriever.js": "data_obs",
  "vector-retriever-stub.js": "data_obs",
  "logger.js": "data_obs",
  "secure-logger.js": "data_obs",
  "embedding-provider.js": "agent-runtime",
  "embedding-stub.js": "agent-runtime",
  "text-chunking.js": "agent-runtime",
};

// ── Module boundary: max N path segments from root (drilldown configurable) ──
// e.g. depth=2: src/payment/handlers/refund.ts → "src/payment", lib/http.ts → "lib"
export function getModuleId(rootPath: string, filePath: string): string {
  const rel = path.relative(rootPath, filePath);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 1) return ".";
  const dirParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1] ?? "";
  // Trading-agent: every services/<subdir> is its own node (not a mega services bag).
  // Known money-path names stay first-class; other folders (compliance, provenance, …) also split.
  if (
    dirParts.length >= 3 &&
    dirParts[0] === "middleware-platform" &&
    dirParts[1] === "services"
  ) {
    return dirParts.slice(0, 3).join("/");
  }
  // Residual flat files under middleware-platform/services/*.js → spine-aligned buckets
  if (
    dirParts.length === 2 &&
    dirParts[0] === "middleware-platform" &&
    dirParts[1] === "services"
  ) {
    const alias = RESIDUAL_SERVICE_FILE_ALIAS[fileName] ?? "platform-utils";
    return `middleware-platform/services/${alias}`;
  }
  const depthEnv = process.env.ARCH_MODULE_DEPTH;
  const depth =
    typeof depthEnv === "string"
      ? Math.min(4, Math.max(1, Number.parseInt(depthEnv, 10) || 2))
      : 2;
  return dirParts.slice(0, depth).join("/") || ".";
}

// ── Health check ─────────────────────────────────────────────────────────────
function checkHealth(modulePath: string): ArchNode["health"] {
  if (!fs.existsSync(modulePath)) {
    return { hasDocs: false, hasTests: false, hasContext: false };
  }
  let files: string[] = [];
  try {
    files = fs.readdirSync(modulePath, { recursive: true }) as string[];
  } catch {
    return { hasDocs: false, hasTests: false, hasContext: false };
  }
  const flat = Array.isArray(files) ? files.flat(10) : [];
  return {
    hasDocs: flat.some(
      (f) =>
        typeof f === "string" &&
        (f.endsWith("README.md") || f.endsWith(".context.md"))
    ),
    hasTests: flat.some(
      (f) =>
        typeof f === "string" &&
        (f.includes(".test.") || f.includes(".spec."))
    ),
    // Single source for "No context" in UI: missing .context.md in module dir.
    // UI: missingContextNodes = graph.nodes.filter(n => !n.health?.hasContext)
    hasContext: flat.some(
      (f) => typeof f === "string" && f.endsWith(".context.md")
    ),
  };
}

// ── Semantic signal extraction ────────────────────────────────────────────────
function extractSignals(
  file: SourceFile,
  rootPath: string
): Omit<SemanticSignals, "fileCount"> {
  const exports: string[] = [];
  const exportedMap = file.getExportedDeclarations();
  for (const [name] of exportedMap) {
    if (name && typeof name === "string" && !name.startsWith("_")) {
      exports.push(name);
    }
  }
  const defaultExport = file.getDefaultExportSymbol();
  if (defaultExport) {
    const name = defaultExport.getName();
    if (name && !exports.includes(name)) exports.push(name);
  }

  const externalImports: string[] = [];
  const addPkg = (specifier: string) => {
    if (specifier.startsWith(".")) return;
    const resolved = resolveImportPath(
      specifier,
      file.getFilePath(),
      rootPath
    );
    if (!resolved) {
      const raw = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (raw && !externalImports.includes(raw)) {
        externalImports.push(raw.replace(/^@/, "").split("/")[0] ?? raw);
      }
    }
  };

  for (const imp of file.getImportDeclarations()) {
    addPkg(imp.getModuleSpecifierValue());
  }

  try {
    file.forEachDescendant((node) => {
      if (node.getKind() === SyntaxKind.CallExpression) {
        const call = node.asKind(SyntaxKind.CallExpression);
        if (!call) return;
        const expr = call.getExpression();
        const text = expr.getText();
        if (text === "require" || text.endsWith(".require")) {
          const args = call.getArguments();
          if (args[0]) {
            const argText = args[0].getText().replace(/['"]/g, "");
            addPkg(argText);
          }
        }
      }
    });
  } catch {
    /* ignore */
  }

  return {
    exports: [...new Set(exports)].slice(0, 15),
    externalImports: [...new Set(externalImports)].slice(0, 10),
  };
}

// ── DevOps scanner: .github/workflows, Dockerfile, docker-compose, k8s/ ────────
function discoverDevOpsNodes(rootPath: string): ArchNode[] {
  const nodes: ArchNode[] = [];
  const baseHealth = { hasDocs: false, hasTests: false, hasContext: false };

  const workflowsDir = path.join(rootPath, ".github", "workflows");
  if (fs.existsSync(workflowsDir) && fs.statSync(workflowsDir).isDirectory()) {
    const files = fs.readdirSync(workflowsDir, { withFileTypes: true });
    const yamlFiles = files.filter((f) => f.isFile() && /\.(yml|yaml)$/i.test(f.name));
    if (yamlFiles.length > 0) {
      nodes.push({
        id: ".github/workflows",
        label: "workflows",
        path: workflowsDir,
        files: yamlFiles.map((f) => path.join(".github", "workflows", f.name)),
        health: baseHealth,
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: yamlFiles.length },
        kind: "infra",
        layer: "Infrastructure",
      });
    }
  }

  const dockerPaths = ["Dockerfile", "docker/Dockerfile", "Dockerfile.dev"];
  for (const rel of dockerPaths) {
    const p = path.join(rootPath, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      const id = path.dirname(rel) === "." ? "Dockerfile" : path.join(path.dirname(rel), "Dockerfile");
      if (!nodes.some((n) => n.id === id)) {
        nodes.push({
          id,
          label: "Dockerfile",
          path: path.dirname(p),
          files: [rel],
          health: baseHealth,
          status: "unknown",
          isDrift: false,
          semanticSignals: { exports: [], externalImports: [], fileCount: 1 },
          kind: "infra",
          layer: "Infrastructure",
        });
      }
      break;
    }
  }

  const composePaths = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"];
  for (const rel of composePaths) {
    const p = path.join(rootPath, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      nodes.push({
        id: "docker-compose",
        label: "docker-compose",
        path: rootPath,
        files: [rel],
        health: baseHealth,
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: 1 },
        kind: "infra",
        layer: "Infrastructure",
      });
      break;
    }
  }

  const k8sDir = path.join(rootPath, "k8s");
  if (fs.existsSync(k8sDir) && fs.statSync(k8sDir).isDirectory()) {
    const raw = fs.readdirSync(k8sDir, { recursive: true }) as string[];
    const yamlFiles = Array.isArray(raw)
      ? raw.filter((f) => typeof f === "string" && /\.(yml|yaml)$/i.test(f))
      : [];
    if (yamlFiles.length > 0) {
      // Aggregate "k8s" node for quick overview.
      nodes.push({
        id: "k8s",
        label: "k8s",
        path: k8sDir,
        files: yamlFiles.map((f) => path.join("k8s", f)),
        health: baseHealth,
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: yamlFiles.length },
        kind: "infra",
        layer: "Infrastructure",
        tags: ["k8s"],
      });

      // Parse individual resources for drilldown (kind/name).
      for (const rel of yamlFiles) {
        if (typeof rel !== "string") continue;
        const relPath = path.join("k8s", rel);
        const fullPath = path.join(rootPath, relPath);
        let text = "";
        try {
          text = fs.readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }
        const kindMatch = text.match(/^\s*kind:\s*([A-Za-z0-9]+)/m);
        const nameMatch = text.match(/^\s*name:\s*([A-Za-z0-9._-]+)/m);
        const kind = kindMatch?.[1] ?? "Resource";
        const name = nameMatch?.[1] ?? path.basename(rel, path.extname(rel));
        const id = `k8s/${kind}/${name}`;
        if (nodes.some((n) => n.id === id)) continue;
        nodes.push({
          id,
          label: `${name}`,
          path: path.dirname(fullPath),
          files: [relPath],
          health: baseHealth,
          status: "unknown",
          isDrift: false,
          semanticSignals: { exports: [], externalImports: [], fileCount: 1 },
          kind: "infra",
          layer: "Infrastructure",
          tags: ["k8s", kind.toLowerCase()],
        });
      }
    }
  }

  // Terraform / Bicep / Helm detection (coarse infra entities).
  const terraformDir = path.join(rootPath, "terraform");
  if (fs.existsSync(terraformDir) && fs.statSync(terraformDir).isDirectory()) {
    const raw = fs.readdirSync(terraformDir, { recursive: true }) as string[];
    const tfFiles = Array.isArray(raw)
      ? raw.filter((f) => typeof f === "string" && f.endsWith(".tf"))
      : [];
    if (tfFiles.length > 0) {
      const files = tfFiles.map((f) => path.join("terraform", f));
      const fullFirst = path.join(rootPath, files[0]);
      let sample = "";
      try {
        sample = fs.readFileSync(fullFirst, "utf-8");
      } catch {
        // ignore
      }
      let cloud: ArchNode["cloudProvider"] = "unknown";
      if (/azurerm_/i.test(sample)) cloud = "azure";
      else if (/aws_/i.test(sample)) cloud = "aws";
      else if (/google_/i.test(sample)) cloud = "gcp";

      nodes.push({
        id: "infra/terraform",
        label: "terraform",
        path: terraformDir,
        files,
        health: baseHealth,
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: files.length },
        kind: "infra",
        layer: "Infrastructure",
        cloudProvider: cloud,
        tags: ["terraform", cloud !== "unknown" ? cloud : undefined].filter(
          Boolean
        ) as string[],
      });
    }
  }

  const bicepDir = path.join(rootPath, "infra");
  if (fs.existsSync(bicepDir) && fs.statSync(bicepDir).isDirectory()) {
    const raw = fs.readdirSync(bicepDir, { recursive: true }) as string[];
    const bicepFiles = Array.isArray(raw)
      ? raw.filter((f) => typeof f === "string" && f.endsWith(".bicep"))
      : [];
    if (bicepFiles.length > 0) {
      nodes.push({
        id: "infra/bicep",
        label: "bicep",
        path: bicepDir,
        files: bicepFiles.map((f) => path.join("infra", f)),
        health: baseHealth,
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: bicepFiles.length },
        kind: "infra",
        layer: "Infrastructure",
        cloudProvider: "azure",
        tags: ["bicep", "azure"],
      });
    }
  }

  return nodes;
}

// ── Main scanner ──────────────────────────────────────────────────────────────
export async function scanProject(rootPath: string, findings?: ContractFinding[]): Promise<ArchGraph> {
  const tsConfigPath = path.join(rootPath, "tsconfig.json");
  const hasTsConfig = fs.existsSync(tsConfigPath);

  const project = new Project({
    tsConfigFilePath: hasTsConfig ? tsConfigPath : undefined,
    addFilesFromTsConfig: hasTsConfig,
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: false,
  });

  if (!hasTsConfig || project.getSourceFiles().length === 0) {
    // Discover top-level source directories dynamically instead of a fixed
    // allowlist -- repos with unconventional layouts (e.g. execution-engine/,
    // unified-dashboard/) were previously invisible to the scanner.
    const EXCLUDED_TOP_DIRS = new Set([
      "node_modules", ".git", "dist", "build", "coverage", ".next", ".nuxt",
      ".github", ".vscode", "out", "tmp", "docs", "data", "deploy", ".turbo",
      ".cache", "logs", "test-results", "fixtures",
    ]);
    let topLevelDirs: string[] = [];
    try {
      topLevelDirs = fs
        .readdirSync(rootPath, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            !EXCLUDED_TOP_DIRS.has(d.name) &&
            !d.name.startsWith(".")
        )
        .map((d) => d.name);
    } catch {
      topLevelDirs = [];
    }
    const codeGlobs = [
      `${rootPath}/*.{ts,tsx,js,jsx}`,
      ...topLevelDirs.map((d) => `${rootPath}/${d}/**/*.{ts,tsx,js,jsx}`),
    ];
    project.addSourceFilesAtPaths(codeGlobs);
  }

  if (project.getSourceFiles().length === 0) {
    project.addSourceFilesAtPaths([
      `${rootPath}/**/*.{ts,tsx,js,jsx}`,
    ]);
  }

  type AccNode = ArchNode & {
    _exports: Set<string>;
    _externals: Set<string>;
    _unresolvedDynamic?: boolean;
  };

  const moduleMap = new Map<string, AccNode>();
  const edgeSet = new Set<string>();
  const edges: ArchEdge[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    if (
      filePath.includes("node_modules") ||
      filePath.includes("/dist/") ||
      filePath.includes("/.git/") ||
      filePath.includes("/build/")
    ) {
      continue;
    }

    const moduleId = getModuleId(rootPath, filePath);
    if (isExcluded(moduleId)) continue;

    const relPath = path.relative(rootPath, filePath);
    const signals = extractSignals(sourceFile, rootPath);

    if (!moduleMap.has(moduleId)) {
      const modulePath = path.join(rootPath, moduleId);
      moduleMap.set(moduleId, {
        id: moduleId,
        label: path.basename(moduleId) || moduleId,
        path: modulePath,
        files: [],
        health: checkHealth(modulePath),
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
        _exports: new Set(signals.exports),
        _externals: new Set(signals.externalImports),
      });
    }

    const entry = moduleMap.get(moduleId)!;
    entry.files.push(relPath);
    signals.exports.forEach((e) => entry._exports.add(e));
    signals.externalImports.forEach((e) => entry._externals.add(e));

    const addEdgeForSpecifier = (specifier: string) => {
      const resolved = resolveImportPath(specifier, filePath, rootPath);
      if (!resolved) return;
      const targetId = getModuleId(rootPath, resolved);
      if (isExcluded(targetId) || targetId === moduleId) return;
      const edgeId = `${moduleId}-->${targetId}`;
      if (!edgeSet.has(edgeId)) {
        edgeSet.add(edgeId);
        edges.push({
          id: edgeId,
          source: moduleId,
          target: targetId,
          type: "import",
          isDrift: false,
        });
      }
    };

    for (const imp of sourceFile.getImportDeclarations()) {
      addEdgeForSpecifier(imp.getModuleSpecifierValue());
    }

    // require() calls — CommonJS (literal only for resolvable edges)
    try {
      sourceFile.forEachDescendant((node) => {
        if (node.getKind() !== SyntaxKind.CallExpression) return;
        const call = node.asKind(SyntaxKind.CallExpression);
        if (!call) return;
        const expr = call.getExpression();
        const text = expr.getText();
        if (text !== "require" && !text.endsWith(".require")) return;
        const args = call.getArguments();
        const arg = args[0];
        if (!arg) return;
        const kind = arg.getKind();
        if (kind !== SyntaxKind.StringLiteral && kind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
          // Computed require — flag source module; cannot resolve target.
          const entryDyn = moduleMap.get(moduleId);
          if (entryDyn) {
            (entryDyn as { _unresolvedDynamic?: boolean })._unresolvedDynamic = true;
          }
          return;
        }
        const specifier = arg.getText().replace(/['"`]/g, "");
        addEdgeForSpecifier(specifier);
      });
    } catch {
      /* ignore parse errors */
    }

    // dynamic import() — emit type:"dynamic" when specifier is a string literal
    try {
      sourceFile.forEachDescendant((node) => {
        if (node.getKind() !== SyntaxKind.CallExpression) return;
        const call = node.asKind(SyntaxKind.CallExpression);
        if (!call) return;
        const expr = call.getExpression();
        if (expr.getKind() !== SyntaxKind.ImportKeyword && expr.getText() !== "import") return;
        const args = call.getArguments();
        const arg = args[0];
        if (!arg) return;
        const kind = arg.getKind();
        if (kind !== SyntaxKind.StringLiteral && kind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
          const entryDyn = moduleMap.get(moduleId);
          if (entryDyn) {
            (entryDyn as { _unresolvedDynamic?: boolean })._unresolvedDynamic = true;
          }
          return;
        }
        const specifier = arg.getText().replace(/['"`]/g, "");
        const resolved = resolveImportPath(specifier, filePath, rootPath);
        if (!resolved) {
          const entryDyn = moduleMap.get(moduleId);
          if (entryDyn) {
            (entryDyn as { _unresolvedDynamic?: boolean })._unresolvedDynamic = true;
          }
          return;
        }
        const targetId = getModuleId(rootPath, resolved);
        if (isExcluded(targetId) || targetId === moduleId) return;
        const edgeId = `${moduleId}-dyn->${targetId}`;
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: moduleId,
            target: targetId,
            type: "dynamic",
            isDrift: false,
          });
        }
      });
    } catch {
      /* ignore */
    }
  }

  function applyTechMetadata(rootPathForNode: string, node: ArchNode): void {
    // Allow per-node overrides via .arch-node.json placed in the module directory.
    try {
      const overridePath = path.join(
        typeof node.path === "string" ? node.path : rootPathForNode,
        ".arch-node.json",
      );
      if (fs.existsSync(overridePath) && fs.statSync(overridePath).isFile()) {
        const raw = fs.readFileSync(overridePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<
          Pick<ArchNode, "techKind" | "cloudProvider" | "tags" | "iconKey">
        >;
        node.techKind = parsed.techKind ?? node.techKind;
        node.cloudProvider = parsed.cloudProvider ?? node.cloudProvider;
        if (Array.isArray(parsed.tags)) {
          node.tags = parsed.tags;
        }
        node.iconKey = parsed.iconKey ?? node.iconKey;
        // If overrides are present we trust them and skip heuristics.
        if (parsed.techKind || parsed.cloudProvider || parsed.tags || parsed.iconKey) {
          return;
        }
      }
    } catch {
      // Ignore malformed override files.
    }

    const tags = new Set<string>(node.tags ?? []);
    const label = (node.suggestedLabel ?? node.role ?? node.label ?? "").toLowerCase();
    const id = (node.id ?? "").toLowerCase();
    const pathLower = (node.path ?? "").toLowerCase();
    const filesJoined = (node.files ?? []).join(" ").toLowerCase();
    const externals = (node.semanticSignals?.externalImports ?? []).map((x) =>
      x.toLowerCase(),
    );

    const text = [label, id, pathLower, filesJoined].join(" ");

    let techKind = node.techKind;
    let cloudProvider = node.cloudProvider;

    const setKind = (kind: ArchNode["techKind"], tag?: string) => {
      techKind = kind;
      if (tag) tags.add(tag);
      if (!node.iconKey) {
        node.iconKey = kind ?? undefined;
      }
    };

    if (!techKind) {
      // Kubernetes / container orchestration
      if (text.includes("k8s") || text.includes("kubernetes") || id === "k8s") {
        setKind("kubernetes", "k8s");
      } else if (text.includes("docker") || text.includes("compose")) {
        setKind("container-service", "container");
      }
    }

    if (!techKind) {
      // Databases
      const dbLibs = ["pg", "typeorm", "prisma", "mongoose", "mysql2", "pg-promise"];
      const hitsDb = externals.some((e) => dbLibs.includes(e)) || /db|database|repo\b/.test(text);
      if (hitsDb) {
        setKind("database", "db");
      }
    }

    if (!techKind) {
      // Caches
      if (externals.some((e) => e.includes("redis")) || text.includes("cache")) {
        setKind("cache", "cache");
      }
    }

    if (!techKind) {
      // Message queues / buses
      const mqLibs = ["kafkajs", "bull", "bullmq", "amqplib", "sqs", "sns"];
      const hitsMq =
        externals.some((e) => mqLibs.includes(e)) ||
        text.includes("queue") ||
        text.includes("eventbus") ||
        text.includes("event-bus");
      if (hitsMq) {
        setKind("message-bus", "queue");
      }
    }

    if (!techKind) {
      // HTTP APIs / routes / controllers
      const httpWords = ["api", "controller", "routes", "router", "endpoint"];
      const hitsHttp = httpWords.some((w) => text.includes(w));
      if (hitsHttp) {
        setKind("http-api", "api");
      }
    }

    if (!techKind) {
      // Web UI
      const uiWords = ["component", "page", "ui", "view", "screen", "client"];
      const hitsUi =
        text.includes("frontend") ||
        text.includes("web") ||
        uiWords.some((w) => text.includes(`/src/${w}`) || text.includes(`/${w}/`));
      if (hitsUi) {
        setKind("web-ui", "ui");
      }
    }

    if (!techKind) {
      // Serverless / functions
      if (text.includes("lambda") || text.includes("functions") || text.includes("serverless")) {
        setKind("serverless", "fn");
      }
    }

    if (!techKind && text.includes("auth")) {
      setKind("generic-service", "auth");
    }

    if (!techKind && externals.length > 0) {
      setKind("generic-service", "service");
    }

    if (!techKind) {
      techKind = "unknown";
    }

    // Cloud provider hints (very coarse).
    if (!cloudProvider) {
      if (externals.some((e) => e.includes("aws"))) cloudProvider = "aws";
      else if (externals.some((e) => e.includes("gcp") || e.includes("google-cloud")))
        cloudProvider = "gcp";
      else if (externals.some((e) => e.includes("azure"))) cloudProvider = "azure";
      else cloudProvider = "unknown";
    }

    node.techKind = techKind;
    node.cloudProvider = cloudProvider;
    node.tags = Array.from(tags);
  }

  const nodes: ArchNode[] = [];
  for (const [, entry] of moduleMap) {
    const { _exports, _externals, _unresolvedDynamic, ...rest } = entry;
    const tags = new Set<string>(rest.tags ?? []);
    if (_unresolvedDynamic) tags.add("dynamic-imports");
    nodes.push({
      ...rest,
      tags: Array.from(tags),
      semanticSignals: {
        exports: Array.from(_exports).slice(0, 15),
        externalImports: Array.from(_externals).slice(0, 10),
        fileCount: entry.files.length,
      },
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const devOpsNodes = discoverDevOpsNodes(rootPath);
  for (const n of devOpsNodes) {
    if (!nodeIds.has(n.id)) {
      nodes.push(n);
      nodeIds.add(n.id);
    }
  }

  // Infer coarse-grained tech metadata for richer visualization.
  for (const node of nodes) {
    applyTechMetadata(rootPath, node);
  }

  // Runtime / cloud-provider edges: connect nodes with cloudProvider hints to provider hubs.
  const runtimeEdges: ArchEdge[] = [];
  const providerIds = new Set<string>();
  function ensureProviderNode(provider: ArchNode["cloudProvider"]): string {
    const id = `cloud:${provider}`;
    if (!nodeIds.has(id)) {
      nodes.push({
        id,
        label: provider.toUpperCase(),
        path: rootPath,
        files: [],
        health: { hasDocs: false, hasTests: false, hasContext: false },
        status: "unknown",
        isDrift: false,
        semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
        kind: "infra",
        layer: "Infrastructure",
        cloudProvider: provider,
        tags: ["cloud", provider],
      });
      nodeIds.add(id);
    }
    providerIds.add(id);
    return id;
  }

  for (const node of nodes) {
    if (!node.cloudProvider || node.cloudProvider === "unknown") continue;
    const providerNodeId = ensureProviderNode(node.cloudProvider);
    const edgeId = `runtime:${node.id}->${providerNodeId}`;
    runtimeEdges.push({
      id: edgeId,
      source: node.id,
      target: providerNodeId,
      type: "runtime",
      isDrift: false,
      importance: "architectural",
      isLayerViolation: false,
    });
  }

  const allEdges = [...edges, ...runtimeEdges];
  const filteredEdges = allEdges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  // Fold findings into node status: critical → error, warning → warning (if unknown)
  if (findings && findings.length > 0) {
    const byFile = new Map<string, ContractFinding[]>();
    for (const f of findings) {
      const list = byFile.get(f.location) ?? [];
      list.push(f);
      byFile.set(f.location, list);
    }
    for (const node of nodes) {
      const relPaths = node.files;
      const nodeFindings = relPaths.flatMap((p) => byFile.get(p) ?? []);
      if (nodeFindings.length === 0) continue;
      const hasCritical = nodeFindings.some((f) => f.severity === "critical");
      const hasWarning = nodeFindings.some((f) => f.severity === "warning");
      if (hasCritical) {
        node.status = "error";
      } else if (hasWarning && node.status === "unknown") {
        node.status = "warning";
      }
    }
  }

  return {
    nodes,
    edges: filteredEdges,
    generatedAt: Date.now(),
    projectRoot: rootPath,
    projectName: path.basename(rootPath),
    findings,
  };
}
