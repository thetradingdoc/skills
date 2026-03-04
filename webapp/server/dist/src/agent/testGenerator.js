"use strict";
/**
 * Generates test stubs from the architecture graph.
 * Creates vitest test files that verify module exports exist.
 */
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
exports.generateTestsFromGraph = generateTestsFromGraph;
exports.writeGeneratedTests = writeGeneratedTests;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function getModuleDir(nodeId) {
    return /\.[a-z]+$/i.test(nodeId) ? path.dirname(nodeId) : nodeId;
}
function generateModuleTest(node, projectRoot) {
    const exports = node.semanticSignals?.exports ?? [];
    const files = node.files ?? [];
    if (exports.length === 0 && files.length === 0) {
        return `// No exports detected for ${node.id}\ndescribe("${node.id}", () => {\n  it("module exists", () => expect(true).toBe(true));\n});\n`;
    }
    const importPaths = files
        .slice(0, 3)
        .map((f) => {
        const rel = path.relative(path.join(projectRoot, path.dirname(node.id)), path.join(projectRoot, f));
        return rel.startsWith(".") ? rel : `./${rel}`;
    })
        .filter((p) => !p.includes(".."));
    const lines = [
        `import { describe, it, expect } from "vitest";`,
        ``,
        `describe("${node.id} [${node.layer ?? "Uncategorized"}]", () => {`,
    ];
    if (exports.length > 0) {
        const mainFile = files[0];
        if (mainFile) {
            const testDir = path.join(projectRoot, getModuleDir(node.id));
            const relToTest = path.relative(testDir, path.join(projectRoot, mainFile)).replace(/\\/g, "/");
            const importPath = relToTest.startsWith(".") ? relToTest : `./${relToTest}`;
            lines.push(`  it("exports expected symbols", async () => {`);
            lines.push(`    const mod = await import("${importPath.replace(/"/g, '\\"')}");`);
            for (const exp of exports.slice(0, 5)) {
                lines.push(`    expect(mod).toHaveProperty("${exp}");`);
            }
            lines.push(`  });`);
        }
    }
    else {
        lines.push(`  it("module loads", () => expect(true).toBe(true));`);
    }
    lines.push(`});`);
    return lines.join("\n");
}
function generateTestsFromGraph(graph, options) {
    const { projectRoot } = options;
    const out = new Map();
    for (const node of graph.nodes) {
        const content = generateModuleTest(node, projectRoot);
        const moduleDir = getModuleDir(node.id);
        const testDir = path.join(projectRoot, moduleDir);
        const testPath = path.join(testDir, "arch.test.ts");
        out.set(path.relative(projectRoot, testPath), content);
    }
    return out;
}
function writeGeneratedTests(tests, projectRoot) {
    const written = [];
    for (const [relPath, content] of tests) {
        const fullPath = path.join(projectRoot, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, "utf-8");
        written.push(fullPath);
    }
    return written;
}
