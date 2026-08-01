/**
 * Editing existing files.
 *
 * The contract here comes from watching patches fail. On 29 July six of them
 * lost characters in transit; three landed silently and one syntax error
 * survived four commits. The ones that failed safely all shared a shape:
 * match an anchor exactly once, or refuse to act. The ones that caused damage
 * wrote first and were checked afterwards.
 *
 * So this never applies a diff. It replaces text only when the text it expects
 * to find appears exactly once, and it verifies the result before reporting
 * success. A model that cannot find its anchor is told the match count so it
 * can widen the anchor and try again — which is a better failure than a
 * confident write into the wrong place.
 *
 * Undo strategy, decided rather than accumulated: git is the record for
 * tracked files, .agent/writes.jsonl says what the tool changed and when, and
 * an edit that fails its typecheck is reverted immediately. No separate backup
 * mechanism — two overlapping undo systems is worse than either alone.
 *
 * Paths follow the same guards executeReadFile and executeScaffoldNode use:
 * no traversal, nothing outside the project root, no environment files.
 */
import * as fs from "fs";
import * as path from "path";

/** Directories a write must never touch, regardless of the path guard. */
const WRITE_DENY = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
];

function isUnderRoot(rootPath: string, absPath: string): boolean {
  const rel = path.relative(rootPath, absPath);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isSafeRelPath(p: string): boolean {
  if (!p || path.isAbsolute(p)) return false;
  if (p.split(/[/\\]/).some((seg) => seg === "..")) return false;
  return true;
}

/** Shared gate for anything that writes. Returns the absolute path or a reason. */
function resolveWritePath(
  rootPath: string,
  filePath: string
): { abs?: string; error?: string } {
  if (!isSafeRelPath(filePath)) {
    return { error: "Invalid path: traversal blocked" };
  }

  const root = path.resolve(rootPath);
  const abs = path.resolve(root, filePath);

  if (!isUnderRoot(root, abs)) {
    return { error: "Path outside project root (blocked)" };
  }

  const base = path.basename(abs);
  if (base === ".env" || (base.startsWith(".env.") && !base.endsWith(".example") && !base.endsWith(".sample"))) {
    return { error: "Environment files (.env*) are not writable" };
  }

  const segments = path.relative(root, abs).split(/[/\\]/);
  const denied = segments.find((seg) => WRITE_DENY.includes(seg));
  if (denied) {
    return { error: `Writes to ${denied}/ are blocked` };
  }

  return { abs };
}

/**
 * A record of every write, in the repository being edited.
 *
 * Today a file was written successfully and three separate searches failed to
 * find it, because the clone lives somewhere other than where I assumed. A log
 * answers "what did the tool actually change, and where" in one line rather
 * than by inference.
 */
export function appendWriteLog(
  rootPath: string,
  entry: { action: "edit" | "create" | "restore"; file: string; note?: string }
): void {
  try {
    const dir = path.join(path.resolve(rootPath), ".agent");
    fs.mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({
        at: new Date().toISOString(),
        action: entry.action,
        file: entry.file,
        note: entry.note ?? null,
      }) + "\n";
    fs.appendFileSync(path.join(dir, "writes.jsonl"), line, "utf-8");
  } catch {
    // The log must never be the reason a write fails.
  }
}

export type EditResult = {
  result?: string;
  error?: string;
  /** How many times old_str appeared. Present when the edit was refused. */
  matches?: number;
  /** Absolute path written, for the caller to verify or roll back. */
  written?: string;
  /** The file's contents before the write, so the caller can restore them. */
  previous?: string;
};

/**
 * Replace one unique occurrence of old_str with new_str.
 *
 * Refuses on zero matches and on more than one, returning the count either
 * way. An empty new_str deletes the matched text, which is the usual way to
 * remove a block.
 */
export function executeEditFile(
  rootPath: string,
  params: { filePath: string; oldStr: string; newStr: string }
): EditResult {
  const { filePath, oldStr, newStr } = params;

  if (!filePath) return { error: "filePath is required" };
  if (typeof oldStr !== "string" || oldStr.length === 0) {
    return { error: "oldStr is required and must not be empty" };
  }
  if (typeof newStr !== "string") {
    return { error: "newStr is required (use an empty string to delete)" };
  }

  const gate = resolveWritePath(rootPath, filePath);
  if (gate.error) return { error: gate.error };
  const abs = gate.abs!;

  if (!fs.existsSync(abs)) {
    return { error: `File does not exist: ${filePath}. Use create_file for new files.` };
  }
  if (!fs.statSync(abs).isFile()) {
    return { error: `Not a file: ${filePath}` };
  }

  let contents: string;
  try {
    contents = fs.readFileSync(abs, "utf-8");
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const matches = contents.split(oldStr).length - 1;

  if (matches === 0) {
    return {
      error:
        "oldStr not found in " +
        filePath +
        ". The text must match exactly, including whitespace and line breaks. Read the file and copy the text verbatim.",
      matches: 0,
    };
  }

  if (matches > 1) {
    return {
      error:
        "oldStr appears " +
        matches +
        " times in " +
        filePath +
        ". It must be unique — widen it with surrounding lines until only one occurrence matches.",
      matches,
    };
  }

  const updated = contents.replace(oldStr, newStr);

  try {
    fs.writeFileSync(abs, updated, "utf-8");
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const removed = oldStr.split("\n").length;
  const added = newStr === "" ? 0 : newStr.split("\n").length;

  return {
    result:
      "Edited " +
      filePath +
      " — replaced " +
      removed +
      " line" +
      (removed === 1 ? "" : "s") +
      " with " +
      added +
      " line" +
      (added === 1 ? "" : "s") +
      ".",
    written: abs,
    previous: contents,
  };
}

/**
 * Create a file that does not yet exist.
 *
 * Kept separate from editing because the failure modes differ: an edit that
 * cannot find its anchor should retry with a wider one, while a create that
 * finds an existing file should stop and let the caller decide.
 */
export function executeCreateFile(
  rootPath: string,
  params: { filePath: string; contents: string }
): EditResult {
  const { filePath, contents } = params;

  if (!filePath) return { error: "filePath is required" };
  if (typeof contents !== "string") return { error: "contents is required" };

  const gate = resolveWritePath(rootPath, filePath);
  if (gate.error) return { error: gate.error };
  const abs = gate.abs!;

  // An empty file cannot be edited — edit_file needs a non-empty anchor — and
  // could not be created either, because the path exists. It was unwriteable by
  // both tools. Treat a zero-byte file as absent.
  if (fs.existsSync(abs) && fs.statSync(abs).size === 0) {
    try {
      fs.writeFileSync(abs, contents, "utf-8");
      const lines = contents.split("\n").length;
      return { result: "Wrote " + filePath + " (" + lines + " lines, replacing an empty file).", written: abs };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  // An empty file cannot be edited — edit_file needs a non-empty anchor — and
  // could not be created either, because the path exists. It was unwriteable by
  // both tools. Treat a zero-byte file as absent.
  if (fs.existsSync(abs) && fs.statSync(abs).size === 0) {
    try {
      fs.writeFileSync(abs, contents, "utf-8");
      const lines = contents.split("\n").length;
      return { result: "Wrote " + filePath + " (" + lines + " lines, replacing an empty file).", written: abs };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (fs.existsSync(abs)) {
    return {
      error:
        filePath +
        " already exists. Use edit_file to change it, or delete it first if replacing it entirely.",
    };
  }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, "utf-8");
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const lines = contents.split("\n").length;
  return {
    result: "Created " + filePath + " (" + lines + " line" + (lines === 1 ? "" : "s") + ").",
    written: abs,
  };
}

/**
 * Put a file back as it was. Used when verification fails after a write and
 * the caller would rather leave the tree clean than half-changed.
 */
export function restoreFile(absPath: string, previous: string): { error?: string } {
  try {
    fs.writeFileSync(absPath, previous, "utf-8");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
