/**
 * Security allowlist — AGENT_ROADMAP v4 §6
 * Path validation for read_file, get_ast, write_file.
 */

import * as path from "path";

const READ_ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".env.example",
  ".env.sample",
  ".sh",
]);

const WRITE_ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md"]);

const EXCLUDED_PATTERNS = [
  /node_modules/,
  /\.config\./,
  /\.lock$/,
];

function isEnvProtected(basename: string): boolean {
  if (basename === ".env") return true;
  if (basename.startsWith(".env.") && !basename.endsWith(".example") && !basename.endsWith(".sample")) {
    return true;
  }
  return false;
}
const DEFAULT_ALLOWED_PREFIXES = ["src/", "docs/"];

export interface AllowlistConfig {
  projectRoot: string;
  allowedPrefixes?: string[];
}

export interface AllowlistResult {
  allowed: boolean;
  reason?: string;
}

export function checkPathAllowed(
  filePath: string,
  config: AllowlistConfig,
  mode: "read" | "write" = "write"
): AllowlistResult {
  const root = path.resolve(config.projectRoot);
  const resolved = path.resolve(root, filePath);

  if (!resolved.startsWith(root)) {
    return { allowed: false, reason: "Path outside project root" };
  }

  const relative = path.relative(root, resolved).replace(/\\/g, "/");
  if (relative.includes("..")) {
    return { allowed: false, reason: "Path traversal not allowed" };
  }

  const ext = path.extname(resolved);
  const basename = path.basename(resolved);

  if (isEnvProtected(basename)) {
    return { allowed: false, reason: "Environment files (.env*) are not readable or writable" };
  }

  const isDockerfile = basename === "Dockerfile";
  const allowedExts = mode === "read" ? READ_ALLOWED_EXTENSIONS : WRITE_ALLOWED_EXTENSIONS;

  if (!isDockerfile && !allowedExts.has(ext)) {
    return { allowed: false, reason: `Extension ${ext || "<none>"} not allowed for ${mode}` };
  }

  for (const pat of EXCLUDED_PATTERNS) {
    if (pat.test(relative)) {
      return { allowed: false, reason: `Path matches excluded pattern: ${pat}` };
    }
  }

  const prefixes = config.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const ok = prefixes.some((p) => relative.startsWith(p));
  if (!ok) {
    return { allowed: false, reason: `Path must be under ${prefixes.join(" or ")}` };
  }

  return { allowed: true };
}
