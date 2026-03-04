"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanProject = scanProject;
const ts_morph_1 = require("ts-morph");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const pathResolver_1 = require("./pathResolver");
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
function isExcluded(moduleId) {
    const norm = moduleId.replace(/\\/g, "/");
    if (EXCLUDED_PATTERNS.some((p) => p.test(`/${norm}/`)))
        return true;
    const segments = norm.split("/");
    return segments.some((s) => EXCLUDED_BASENAMES.has(s));
}
// ── Module boundary: max 2 path segments from root ──────────────────────────
// e.g. src/payment/handlers/refund.ts → "src/payment", lib/http.ts → "lib"
function getModuleId(rootPath, filePath) {
    const rel = path.relative(rootPath, filePath);
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length <= 1)
        return ".";
    const dirParts = parts.slice(0, -1);
    const depth = 2;
    return dirParts.slice(0, depth).join("/") || ".";
}
// ── Health check ─────────────────────────────────────────────────────────────
function checkHealth(modulePath) {
    if (!fs.existsSync(modulePath)) {
        return { hasDocs: false, hasTests: false, hasContext: false };
    }
    let files = [];
    try {
        files = fs.readdirSync(modulePath, { recursive: true });
    }
    catch {
        return { hasDocs: false, hasTests: false, hasContext: false };
    }
    const flat = Array.isArray(files) ? files.flat(10) : [];
    return {
        hasDocs: flat.some((f) => typeof f === "string" &&
            (f.endsWith("README.md") || f.endsWith(".context.md"))),
        hasTests: flat.some((f) => typeof f === "string" &&
            (f.includes(".test.") || f.includes(".spec."))),
        hasContext: flat.some((f) => typeof f === "string" && f.endsWith(".context.md")),
    };
}
// ── Semantic signal extraction ────────────────────────────────────────────────
function extractSignals(file, rootPath) {
    const exports = [];
    const exportedMap = file.getExportedDeclarations();
    for (const [name] of exportedMap) {
        if (name && typeof name === "string" && !name.startsWith("_")) {
            exports.push(name);
        }
    }
    const defaultExport = file.getDefaultExportSymbol();
    if (defaultExport) {
        const name = defaultExport.getName();
        if (name && !exports.includes(name))
            exports.push(name);
    }
    const externalImports = [];
    const addPkg = (specifier) => {
        if (specifier.startsWith("."))
            return;
        const resolved = (0, pathResolver_1.resolveImportPath)(specifier, file.getFilePath(), rootPath);
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
            if (node.getKind() === ts_morph_1.SyntaxKind.CallExpression) {
                const call = node.asKind(ts_morph_1.SyntaxKind.CallExpression);
                if (!call)
                    return;
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
    }
    catch {
        /* ignore */
    }
    return {
        exports: [...new Set(exports)].slice(0, 15),
        externalImports: [...new Set(externalImports)].slice(0, 10),
    };
}
// ── DevOps scanner: .github/workflows, Dockerfile, docker-compose, k8s/ ────────
function discoverDevOpsNodes(rootPath) {
    const nodes = [];
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
        const raw = fs.readdirSync(k8sDir, { recursive: true });
        const yamlFiles = Array.isArray(raw)
            ? raw.filter((f) => typeof f === "string" && /\.(yml|yaml)$/i.test(f))
            : [];
        if (yamlFiles.length > 0) {
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
            });
        }
    }
    return nodes;
}
// ── Main scanner ──────────────────────────────────────────────────────────────
async function scanProject(rootPath, findings) {
    const tsConfigPath = path.join(rootPath, "tsconfig.json");
    const hasTsConfig = fs.existsSync(tsConfigPath);
    const project = new ts_morph_1.Project({
        tsConfigFilePath: hasTsConfig ? tsConfigPath : undefined,
        addFilesFromTsConfig: hasTsConfig,
        compilerOptions: { allowJs: true },
        skipAddingFilesFromTsConfig: false,
    });
    if (!hasTsConfig || project.getSourceFiles().length === 0) {
        const codeGlobs = [
            `${rootPath}/src/**/*.{ts,tsx,js,jsx}`,
            `${rootPath}/lib/**/*.{ts,tsx,js,jsx}`,
            `${rootPath}/app/**/*.{ts,tsx,js,jsx}`,
            `${rootPath}/packages/**/*.{ts,tsx,js,jsx}`,
            `${rootPath}/services/**/*.{ts,tsx,js,jsx}`,
            `${rootPath}/server/**/*.{ts,tsx,js,jsx}`,
            `${rootPath}/client/**/*.{ts,tsx,js,jsx}`,
        ];
        project.addSourceFilesAtPaths(codeGlobs);
    }
    if (project.getSourceFiles().length === 0) {
        project.addSourceFilesAtPaths([
            `${rootPath}/**/*.{ts,tsx,js,jsx}`,
        ]);
    }
    const moduleMap = new Map();
    const edgeSet = new Set();
    const edges = [];
    for (const sourceFile of project.getSourceFiles()) {
        const filePath = sourceFile.getFilePath();
        if (filePath.includes("node_modules") ||
            filePath.includes("/dist/") ||
            filePath.includes("/.git/") ||
            filePath.includes("/build/")) {
            continue;
        }
        const moduleId = getModuleId(rootPath, filePath);
        if (isExcluded(moduleId))
            continue;
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
        const entry = moduleMap.get(moduleId);
        entry.files.push(relPath);
        signals.exports.forEach((e) => entry._exports.add(e));
        signals.externalImports.forEach((e) => entry._externals.add(e));
        const addEdgeForSpecifier = (specifier) => {
            const resolved = (0, pathResolver_1.resolveImportPath)(specifier, filePath, rootPath);
            if (!resolved)
                return;
            const targetId = getModuleId(rootPath, resolved);
            if (isExcluded(targetId) || targetId === moduleId)
                return;
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
        // require() calls — CommonJS
        try {
            sourceFile.forEachDescendant((node) => {
                if (node.getKind() !== ts_morph_1.SyntaxKind.CallExpression)
                    return;
                const call = node.asKind(ts_morph_1.SyntaxKind.CallExpression);
                if (!call)
                    return;
                const expr = call.getExpression();
                const text = expr.getText();
                if (text !== "require" && !text.endsWith(".require"))
                    return;
                const args = call.getArguments();
                const arg = args[0];
                if (!arg)
                    return;
                const specifier = arg.getText().replace(/['"]/g, "");
                addEdgeForSpecifier(specifier);
            });
        }
        catch {
            /* ignore parse errors */
        }
    }
    const nodes = [];
    for (const [, entry] of moduleMap) {
        const { _exports, _externals, ...rest } = entry;
        nodes.push({
            ...rest,
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
    const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    // Fold findings into node status: critical → error, warning → warning (if unknown)
    if (findings && findings.length > 0) {
        const byFile = new Map();
        for (const f of findings) {
            const list = byFile.get(f.location) ?? [];
            list.push(f);
            byFile.set(f.location, list);
        }
        for (const node of nodes) {
            const relPaths = node.files;
            const nodeFindings = relPaths.flatMap((p) => byFile.get(p) ?? []);
            if (nodeFindings.length === 0)
                continue;
            const hasCritical = nodeFindings.some((f) => f.severity === "critical");
            const hasWarning = nodeFindings.some((f) => f.severity === "warning");
            if (hasCritical) {
                node.status = "error";
            }
            else if (hasWarning && node.status === "unknown") {
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
