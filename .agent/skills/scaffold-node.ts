#!/usr/bin/env npx tsx
/**
 * scaffold-node skill
 *
 * Creates a directory (or file) for a proposed module and ensures the target
 * entry file begins with:
 *
 *   // @archNodeId: <archNodeId>
 *
 * Usage (from manager via run_skill):
 *   run_skill scaffold-node "<archNodeId> <relPath> [layerEncoded] [kindEncoded] [--readme] [--test] [--template=api_route|service]"
 *
 * Encoding:
 *   - layerEncoded/kindEncoded replace spaces with "__" so args remain split-safe.
 *   - Example: "Business__Logic" -> "Business Logic"
 *
 * Templates:
 *   - api_route: Express-style route handler stub
 *   - service: Service layer with exported functions
 *   - (default): Generic module boilerplate
 */

import * as fs from "fs";
import * as path from "path";

function decodeArg(v?: string): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.replaceAll("__", " ");
}

function isSafeRelPath(relPath: string): boolean {
  if (/\.\.|\\\\|\/\//.test(relPath)) return false;
  return true;
}

type TemplateKind = "api_route" | "service" | "module";

function parseArgs(argv: string[]) {
  const pos = argv.filter((a) => !a.startsWith("--"));
  const flags = argv.filter((a) => a.startsWith("--"));
  const readme = flags.some((f) => f === "--readme");
  const test = flags.some((f) => f === "--test");
  let template: TemplateKind = "module";
  const t = flags.find((f) => f.startsWith("--template="));
  if (t) {
    const v = t.split("=")[1]?.toLowerCase();
    if (v === "api_route" || v === "service") template = v;
  }
  return { pos, readme, test, template };
}

function boilerplateForTemplate(
  archNodeId: string,
  kind: string | undefined,
  layer: string | undefined,
  template: TemplateKind
): string {
  const safeId = archNodeId.replace(/[^a-zA-Z0-9_]/g, "_");
  const layerStr = layer ?? "Uncategorized";
  const kindStr = kind ?? "module";

  if (template === "api_route") {
    return `

import { Request, Response } from "express";

/** ${kindStr} route for layer ${layerStr} */
export async function handle(req: Request, res: Response): Promise<void> {
  // TODO: Implement route logic
  res.json({ ok: true });
}
`;
  }
  if (template === "service") {
    return `

/** ${kindStr} service for layer ${layerStr} */
export async function execute(): Promise<unknown> {
  // TODO: Implement service logic
  return null;
}
`;
  }
  return `

// TODO: Implement ${kindStr} for layer ${layerStr}.
export function TODO_${safeId}() {
  // implementation pending
}
`;
}

async function main() {
  const { pos, readme, test, template } = parseArgs(process.argv.slice(2));
  const [archNodeIdRaw, relPathRaw, layerEnc, kindEnc] = pos;
  const archNodeId = (archNodeIdRaw ?? "").trim();
  const relPath = (relPathRaw ?? "").trim();
  const layer = decodeArg(layerEnc);
  const kind = decodeArg(kindEnc);

  if (!archNodeId || !relPath) {
    console.error(
      "Usage: run_skill scaffold-node \"<archNodeId> <relPath> [layerEncoded] [kindEncoded]\" [--readme] [--test] [--template=api_route|service]"
    );
    process.exit(1);
  }
  if (!isSafeRelPath(relPath)) {
    console.error("Invalid relPath: path traversal blocked.");
    process.exit(1);
  }

  const rootPath = process.cwd();
  const root = path.resolve(rootPath);
  const absPath = path.resolve(root, relPath);
  const rel = path.relative(root, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    console.error("Path outside project root (blocked).");
    process.exit(1);
  }

  const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
  const targetDir = pathLooksLikeFile ? path.dirname(absPath) : absPath;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const indexPath = pathLooksLikeFile ? absPath : path.join(absPath, "index.ts");
  const header = `// @archNodeId: ${archNodeId}`;
  const boilerplate = boilerplateForTemplate(archNodeId, kind, layer, template);

  if (fs.existsSync(indexPath)) {
    const existing = fs.readFileSync(indexPath, "utf-8");
    if (!existing.includes("@archNodeId:")) {
      fs.writeFileSync(indexPath, `${header}\n${existing}`, "utf-8");
    }
  } else {
    fs.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
  }

  if (readme) {
    const readmePath = path.join(targetDir, "README.md");
    const modName = path.basename(targetDir, path.extname(targetDir));
    const readmeContent = `# ${modName}\n\nArchitecture node: \`${archNodeId}\`\n\n## Purpose\n\nTODO: Describe this module.\n`;
    fs.writeFileSync(readmePath, readmeContent, "utf-8");
  }

  if (test) {
    const baseName = pathLooksLikeFile
      ? path.basename(absPath, path.extname(absPath))
      : "index";
    const testPath = path.join(targetDir, `${baseName}.test.ts`);
    const testContent = `// @archNodeId: ${archNodeId}\n\nimport { describe, it, expect } from "vitest";\n\ndescribe("${archNodeId}", () => {\n  it("should pass", () => {\n    expect(true).toBe(true);\n  });\n});\n`;
    fs.writeFileSync(testPath, testContent, "utf-8");
  }

  const out = path.relative(rootPath, indexPath).replace(/\\/g, "/");
  console.log(`Scaffolded node at ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

