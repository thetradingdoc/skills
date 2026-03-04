import * as path from "path";
import * as fs from "fs";

export interface TsConfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

/**
 * Load and parse tsconfig paths for alias resolution.
 */
export function loadTsConfigPaths(rootPath: string): TsConfigPaths | null {
  const candidates = [
    path.join(rootPath, "tsconfig.json"),
    path.join(rootPath, "tsconfig.base.json"),
  ];

  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const json = JSON.parse(content);
      const compilerOptions = json.compilerOptions || {};
      const baseUrl = compilerOptions.baseUrl || ".";
      const paths = compilerOptions.paths || {};
      return { baseUrl: path.resolve(rootPath, baseUrl), paths };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Resolve an import specifier to an absolute file path.
 * Handles: relative (./, ../), and path aliases from tsconfig.
 */
export function resolveImportPath(
  specifier: string,
  fromFile: string,
  rootPath: string
): string | null {
  if (specifier.startsWith(".")) {
    return resolveRelative(specifier, fromFile);
  }

  const tsPaths = loadTsConfigPaths(rootPath);
  if (!tsPaths) return null;

  for (const [pattern, targets] of Object.entries(tsPaths.paths)) {
    const match = matchPathPattern(specifier, pattern);
    if (!match) continue;

    for (const target of targets) {
      const resolved = target.replace(/\*/g, match);
      const absPath = path.resolve(tsPaths.baseUrl, resolved);
      const withExt = tryExtensions(absPath);
      if (withExt) return withExt;
    }
  }
  return null;
}

function resolveRelative(specifier: string, fromFile: string): string | null {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, specifier);
  return tryExtensions(resolved);
}

function matchPathPattern(specifier: string, pattern: string): string | null {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + escaped.replace(/\\\*/g, "(.*)") + "$");
  const m = specifier.match(regex);
  return m ? m[1] ?? "" : null;
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ""];

function tryExtensions(filePath: string): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = ext ? filePath + ext : filePath;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const idx of ["index.ts", "index.tsx", "index.js", "index.jsx"]) {
    const candidate = path.join(filePath, idx);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
