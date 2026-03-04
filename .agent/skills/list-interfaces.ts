#!/usr/bin/env ts-node
/**
 * list-interfaces.ts
 * Finds all exported TypeScript interfaces in the project.
 * Usage: npx ts-node .agent/skills/list-interfaces.ts [root_dir]
 * Defaults root_dir to process.cwd() if not provided.
 */

import * as fs from "fs";
import * as path from "path";

const EXPORT_INTERFACE_RE = /^\s*export\s+interface\s+(\w+)/;

function walkDir(dir: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[warn] Cannot read directory "${dir}": ${(err as Error).message}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (["node_modules", ".git", "dist", "out", "build", ".agent"].includes(entry.name)) continue;
      walkDir(fullPath, results);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(fullPath);
    }
  }
}

function findExportedInterfaces(rootDir: string): void {
  // Validate root directory
  if (!fs.existsSync(rootDir)) {
    console.error(`[error] Root directory does not exist: "${rootDir}"`);
    process.exit(1);
  }

  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    console.error(`[error] Provided path is not a directory: "${rootDir}"`);
    process.exit(1);
  }

  const files: string[] = [];
  walkDir(rootDir, files);

  let totalFound = 0;

  for (const filePath of files) {
    let lines: string[];
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      lines = content.split("\n");
    } catch (err) {
      console.warn(`[warn] Cannot read file "${filePath}": ${(err as Error).message}`);
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const match = EXPORT_INTERFACE_RE.exec(lines[i]);
      if (match) {
        const relativePath = path.relative(rootDir, filePath);
        console.log(`${relativePath}:${i + 1}  →  ${match[1]}`);
        totalFound++;
      }
    }
  }

  console.log(`\nTotal exported interfaces found: ${totalFound}`);
}

// Entry point
const rootDir = process.argv[2] ?? process.cwd();
findExportedInterfaces(rootDir);
