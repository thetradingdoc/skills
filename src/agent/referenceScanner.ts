import * as fs from "fs";
import * as path from "path";
import { ContractFinding } from "../types";

function walkMarkdown(root: string): string[] {
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
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

function extractReferences(content: string): string[] {
  const refs = new Set<string>();
  const backtickRe = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(content))) {
    const ref = m[1]!.trim();
    if (!ref) continue;
    if (/[\\/]/.test(ref) || /\.[a-zA-Z0-9]+$/.test(ref)) {
      refs.add(ref);
    }
  }
  return Array.from(refs);
}

export function scanDocumentReferences(rootPath: string): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const files = walkMarkdown(rootPath);

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const rel = path.relative(rootPath, file);
    const refs = extractReferences(content);
    for (const ref of refs) {
      const target = path.resolve(rootPath, ref);
      if (!fs.existsSync(target)) {
        findings.push({
          type: "missing_file",
          severity: "warning",
          description: `Documentation references ${ref} but it does not exist`,
          location: rel,
          expectedLocation: ref,
          evidence: [`Reference: \`${ref}\` in ${rel}`],
        });
      }
    }
  }

  return findings;
}

