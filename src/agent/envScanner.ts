import * as fs from "fs";
import * as path from "path";
import { ContractFinding } from "../types";

function readEnvTemplate(rootPath: string): Set<string> {
  const candidates = [".env.example", ".env.sample"];
  const vars = new Set<string>();
  for (const name of candidates) {
    const full = path.join(rootPath, name);
    if (!fs.existsSync(full)) continue;
    let content: string;
    try {
      content = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key] = trimmed.split("=", 1);
      if (key) vars.add(key.trim());
    }
  }
  return vars;
}

function walkCodeFiles(root: string): string[] {
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
      } else {
        const ext = path.extname(e.name);
        if ([".ts", ".tsx", ".js", ".jsx", ".py"].includes(ext)) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

export function scanEnvironmentGaps(rootPath: string): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const documented = readEnvTemplate(rootPath);
  if (documented.size === 0) return findings;

  const used = new Map<string, Set<string>>(); // var -> files
  const files = walkCodeFiles(rootPath);
  const tsEnvRe = /process\.env\.([A-Z0-9_]+)/g;
  const pyEnvRe = /os\.environ\.get\(\s*["']([A-Z0-9_]+)["']/g;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = tsEnvRe.exec(content))) {
      const key = m[1]!;
      if (!used.has(key)) used.set(key, new Set());
      used.get(key)!.add(path.relative(rootPath, file));
    }
    while ((m = pyEnvRe.exec(content))) {
      const key = m[1]!;
      if (!used.has(key)) used.set(key, new Set());
      used.get(key)!.add(path.relative(rootPath, file));
    }
  }

  // Vars used in code but missing from template
  for (const [key, filesSet] of used) {
    if (!documented.has(key)) {
      findings.push({
        type: "missing_env_var",
        severity: "warning",
        description: `Environment variable ${key} is used in code but not documented in .env.example / .env.sample`,
        location: Array.from(filesSet)[0] ?? "",
        evidence: [`Used in: ${Array.from(filesSet).join(", ")}`],
      });
    }
  }

  // Vars documented but never used
  for (const key of documented) {
    if (!used.has(key)) {
      findings.push({
        type: "config_mismatch",
        severity: "info",
        description: `Environment variable ${key} is listed in .env.example / .env.sample but not referenced in code`,
        location: ".env.example or .env.sample",
        evidence: [],
      });
    }
  }

  return findings;
}

