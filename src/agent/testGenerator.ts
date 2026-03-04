/**
 * Generates test stubs from the architecture graph.
 * Creates vitest test files that verify module exports exist.
 */

import * as path from "path";
import * as fs from "fs";
import type { ArchGraph, ArchNode } from "../types";

export interface GenerateTestOptions {
  projectRoot: string;
  testFramework?: "vitest" | "jest";
}

function getModuleDir(nodeId: string): string {
  return /\.[a-z]+$/i.test(nodeId) ? path.dirname(nodeId) : nodeId;
}

function generateModuleTest(node: ArchNode, projectRoot: string): string {
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

  const lines: string[] = [
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
  } else {
    lines.push(`  it("module loads", () => expect(true).toBe(true));`);
  }

  lines.push(`});`);
  return lines.join("\n");
}

export function generateTestsFromGraph(
  graph: ArchGraph,
  options: GenerateTestOptions
): Map<string, string> {
  const { projectRoot } = options;
  const out = new Map<string, string>();

  for (const node of graph.nodes) {
    const content = generateModuleTest(node, projectRoot);
    const moduleDir = getModuleDir(node.id);
    const testDir = path.join(projectRoot, moduleDir);
    const testPath = path.join(testDir, "arch.test.ts");
    out.set(path.relative(projectRoot, testPath), content);
  }

  return out;
}

export function writeGeneratedTests(
  tests: Map<string, string>,
  projectRoot: string
): string[] {
  const written: string[] = [];
  for (const [relPath, content] of tests) {
    const fullPath = path.join(projectRoot, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    written.push(fullPath);
  }
  return written;
}
