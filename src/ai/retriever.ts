/**
 * retriever.ts
 *
 * Step 2 of the retrieval pipeline.
 * Given a list of file paths (from questionRouter), reads the actual file content
 * and returns trimmed snippets suitable for inclusion in the LLM prompt.
 *
 * This closes the gap between "the model sees summaries" and
 * "the model sees actual code".
 */

import * as fs from "fs";
import * as path from "path";
import type { ArchGraph, ArchNode } from "../types";
import { redactSecrets } from "../analyzer/driftDetector";

export interface FileSnippet {
  filePath: string;
  nodeId: string;
  content: string;
  truncated: boolean;
  lineCount: number;
}

export interface RetrievedContext {
  snippets: FileSnippet[];
  formatted: string;
  /** Telemetry: files not found or skipped (for logging). */
  telemetry?: { filesNotFound: string[]; filesSkipped: number };
}

const MAX_LINES_PER_FILE = 60;
const MAX_TOTAL_CHARS = 6000;

function resolveFilePath(rootPath: string, fileOrPath: string): string {
  // 1. Absolute paths are used as-is.
  if (path.isAbsolute(fileOrPath)) return fileOrPath;

  // 2. Prevent double-joining when the incoming path already contains the root.
  const normalizedRoot = path.normalize(rootPath);
  const normalizedFile = path.normalize(fileOrPath);
  if (normalizedFile.startsWith(normalizedRoot)) {
    return normalizedFile;
  }

  // 3. Fallback: join root and relative file path.
  return path.join(rootPath, fileOrPath);
}

function extractSignificantLines(
  content: string,
  maxLines: number,
  questionKeywords: string[] = []
): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;

  const scored = lines.map((line, i) => {
    const l = line.trim();
    const lower = l.toLowerCase();
    let score = 0;
    if (/^export\s/.test(l)) score += 10;
    if (/^(class|function|const|interface|type)\s/.test(l)) score += 8;
    if (/\b(app|router)\.(get|post|put|delete|patch|use)\s*\(/.test(l)) score += 12;
    if (/^import\s/.test(l)) score += 3;
    if (/\/\/\s*(TODO|FIXME|NOTE|HACK)/.test(l)) score += 5;
    if (l.length === 0) score -= 2;
    score += Math.max(0, (100 - i) / 20);
    for (const kw of questionKeywords) {
      if (kw.length > 2 && lower.includes(kw.toLowerCase())) score += 15;
    }
    return { line, score, index: i };
  });

  const alwaysInclude = new Set(Array.from({ length: Math.min(10, lines.length) }, (_, i) => i));

  const remaining = scored
    .filter((s) => !alwaysInclude.has(s.index))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLines - 10)
    .map((s) => s.index)
    .sort((a, b) => a - b);

  const selectedIndices = [...alwaysInclude, ...remaining].sort((a, b) => a - b);
  const result: string[] = [];
  let prev = -1;
  for (const idx of selectedIndices) {
    if (prev !== -1 && idx > prev + 1) result.push("  // ...");
    result.push(lines[idx]!);
    prev = idx;
  }

  return result.join("\n");
}

export function retrieveFileSnippets(
  rootPath: string,
  filePaths: string[],
  graph: ArchGraph,
  questionKeywords: string[] = []
): RetrievedContext {
  const snippets: FileSnippet[] = [];
  let totalChars = 0;
  const filesNotFound: string[] = [];
  let filesSkipped = 0;

  const fileToNodeId = new Map<string, string>();
  for (const node of graph.nodes) {
    for (const file of node.files) {
      const fullPath = path.join(graph.projectRoot, file);
      fileToNodeId.set(fullPath, node.id);
    }
    fileToNodeId.set(node.path, node.id);
  }

  for (const filePath of filePaths) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      filesSkipped += 1;
      continue;
    }

    const absPath = resolveFilePath(rootPath, filePath);
    let content: string;
    try {
      if (!fs.existsSync(absPath)) {
        filesNotFound.push(absPath);
        console.warn(`[retriever] File not found: ${absPath}`);
        continue;
      }
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      filesSkipped += 1;
      continue;
    }

    // Redact secrets in config/env-like files before including in prompts
    const basename = path.basename(absPath).toLowerCase();
    if (
      basename.startsWith(".env") ||
      basename.includes("config") ||
      /\.(config|env|secret|credentials)\.(json|yaml|yml|toml)$/i.test(absPath)
    ) {
      content = redactSecrets(content);
    }

    const extracted = extractSignificantLines(
      content,
      MAX_LINES_PER_FILE,
      questionKeywords
    );
    const truncated = content.split("\n").length > MAX_LINES_PER_FILE;
    const remaining = MAX_TOTAL_CHARS - totalChars;
    const finalContent = extracted.slice(0, remaining);
    totalChars += finalContent.length;

    const relPath = path.relative(rootPath, absPath).replace(/\\/g, "/");

    snippets.push({
      filePath: relPath,
      nodeId: fileToNodeId.get(absPath) ?? path.dirname(relPath),
      content: finalContent,
      truncated,
      lineCount: content.split("\n").length,
    });
  }

  const formatted =
    snippets.length === 0
      ? ""
      : "Relevant code (read from filesystem for this question):\n\n" +
        snippets
          .map(
            (s) =>
              `--- ${s.filePath} (${s.lineCount} lines${s.truncated ? ", truncated" : ""}) ---\n${s.content}`
          )
          .join("\n\n");

  const telemetry =
    filesNotFound.length > 0 || filesSkipped > 0
      ? { filesNotFound, filesSkipped }
      : undefined;

  return { snippets, formatted, ...(telemetry && { telemetry }) };
}

export function retrieveNodeContext(
  rootPath: string,
  node: ArchNode,
  graph: ArchGraph
): RetrievedContext {
  const filePaths = (node.files ?? [])
    .filter((f) => /\.(ts|tsx|js|py)$/.test(f) && !/\.test\.|\.spec\./.test(f))
    .slice(0, 3)
    .map((f) => path.join(graph.projectRoot, f));

  return retrieveFileSnippets(rootPath, filePaths, graph, []);
}

export function formatRetrievedContext(context: RetrievedContext): string {
  return context.formatted;
}
