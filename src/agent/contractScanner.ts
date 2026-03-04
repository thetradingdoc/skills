import * as fs from "fs";
import * as path from "path";
import { ContractFinding } from "../types";

interface RouteDef {
  method: string;
  path: string;
  file: string;
}

interface RouteCall {
  method: string;
  path: string;
  file: string;
}

function walkFiles(root: string, exts: string[]): string[] {
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
      } else if (exts.includes(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

function extractDefinedRoutes(rootPath: string): RouteDef[] {
  const files = walkFiles(rootPath, [".ts", ".tsx", ".js", ".jsx"]);
  const defs: RouteDef[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const routeRegex = /\b(app|router)\.(get|post|put|delete|patch|use)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = routeRegex.exec(content))) {
      const method = m[2]!.toUpperCase();
      const p = m[3]!;
      if (!p.startsWith("/")) continue;
      defs.push({ method, path: p, file: path.relative(rootPath, file) });
    }
  }
  return defs;
}

function extractCalledRoutes(rootPath: string): RouteCall[] {
  const files = walkFiles(rootPath, [".ts", ".tsx", ".js", ".jsx", ".py"]);
  const calls: RouteCall[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const fetchRegex = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g;
    const axiosRegex = /\baxios\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = fetchRegex.exec(content))) {
      const p = m[1]!;
      if (!p.startsWith("/")) continue;
      calls.push({ method: "GET", path: p, file: path.relative(rootPath, file) });
    }
    while ((m = axiosRegex.exec(content))) {
      const method = m[1]!.toUpperCase();
      const p = m[2]!;
      if (!p.startsWith("/") && !p.includes("/api/")) continue;
      calls.push({ method, path: p, file: path.relative(rootPath, file) });
    }
  }
  return calls;
}

export function scanContracts(rootPath: string): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const defs = extractDefinedRoutes(rootPath);
  const calls = extractCalledRoutes(rootPath);

  const defKey = (r: RouteDef | RouteCall) => `${r.method}:${r.path}`;
  const defsByKey = new Map<string, RouteDef[]>();
  for (const d of defs) {
    const key = defKey(d);
    const arr = defsByKey.get(key) ?? [];
    arr.push(d);
    defsByKey.set(key, arr);
  }

  const callsByKey = new Map<string, RouteCall[]>();
  for (const c of calls) {
    const key = defKey(c);
    const arr = callsByKey.get(key) ?? [];
    arr.push(c);
    callsByKey.set(key, arr);
  }

  // NOTE: This scanner uses simple regex-based heuristics.
  // It will miss routes composed from variables/template literals
  // and routes mounted via sub-routers (e.g. app.use('/api', router)).
  // Treat findings as hints, not ground truth.

  // Defined but never called
  for (const [key, defList] of defsByKey) {
    if (callsByKey.has(key)) continue;
    for (const d of defList) {
      findings.push({
        type: "missing_caller",
        severity: "warning",
        description: `Route ${d.method} ${d.path} has no callers in codebase`,
        location: d.file,
        evidence: [`Defined in ${d.file}`],
      });
    }
  }

  // Called but not defined
  for (const [key, callList] of callsByKey) {
    if (defsByKey.has(key)) continue;
    for (const c of callList) {
      findings.push({
        type: "missing_implementor",
        severity: "critical",
        description: `Route ${c.method} ${c.path} is called but no definition was found`,
        location: c.file,
        evidence: [`Call in ${c.file}`],
      });
    }
  }

  return findings;
}

