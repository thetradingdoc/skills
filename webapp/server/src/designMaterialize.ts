/**
 * Post-V1: Materialize a design-mode graph (nodes drawn on the canvas, no
 * scan behind them yet) into real files on disk — folders + a boilerplate
 * index file per node, tagged with @archNodeId so a later scan can
 * reconcile back to the design.
 *
 * Distinct from materialize.ts (greenfield rail flow with sandbox/verify
 * loop) and scaffold.ts (single-node scaffold via chat tool call): this is
 * the "materialize this whole design" button in the design-mode toolbar,
 * with no rail/session and no HTTP self-call — scaffold logic runs inline.
 */
import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { requireUser } from "./middleware/requireUser.js";

const router = Router();

interface DesignMaterializeNodeInput {
  id: string;
  label?: string;
  layer?: string;
  techKind?: string;
  kind?: string;
  path?: string;
}

/** Ensure relPath does not escape root (no path traversal). */
function isPathSafe(root: string, relPath: string): boolean {
  const resolved = path.resolve(root, relPath);
  const rootNorm = path.resolve(root);
  return resolved.startsWith(rootNorm) && resolved !== rootNorm;
}

/** Validate and resolve targetRoot; returns root or error. Same rules as materialize.ts. */
export function validateTargetRoot(targetRoot: string): { root: string } | { error: string } {
  const root = path.resolve(targetRoot.trim());
  if (!root || root === "/" || root.length < 2) {
    return { error: "targetRoot must be a valid project directory path." };
  }
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path.resolve(baseDir);
    if (!root.startsWith(baseNorm + path.sep) && root !== baseNorm) {
      return { error: "targetRoot must be within the allowed projects directory." };
    }
  }
  return { root };
}

/** Slugify a label into a filesystem-safe path segment. */
export function slug(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "node";
}

/**
 * Derive the relative path for a design node: prefer an existing node.path
 * when it looks like a safe project-relative path, otherwise fall back to
 * src/<slug>/index.ts.
 */
export function relPathForDesignNode(node: { id: string; label?: string; path?: string }): string {
  const rawPath = typeof node.path === "string" ? node.path.trim().replace(/\\/g, "/") : "";
  const looksSafeProjectRelative =
    rawPath.length > 0 &&
    !rawPath.startsWith("/") &&
    !rawPath.includes("..") &&
    !/^[a-zA-Z]:/.test(rawPath);
  if (looksSafeProjectRelative) return rawPath;
  return `src/${slug(node.label || node.id)}/index.ts`;
}

router.post("/design-materialize", requireUser, async (req, res) => {
  const { targetRoot, nodes } = req.body as {
    targetRoot?: string;
    nodes?: DesignMaterializeNodeInput[];
  };

  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where the design should be materialized.",
    });
    return;
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    res.status(400).json({
      error: "nodes is required and must be a non-empty array of design nodes.",
    });
    return;
  }

  if (nodes.length > 50) {
    res.status(400).json({
      error: "Maximum 50 nodes per materialize. Split into smaller batches.",
    });
    return;
  }

  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const node of nodes) {
    const id = typeof node?.id === "string" ? node.id : "";
    const label = typeof node?.label === "string" && node.label.trim() ? node.label : id;
    if (!id && !label) {
      errors.push("Node missing id/label; skipped.");
      continue;
    }

    const relPath = relPathForDesignNode(node);
    if (!relPath || /\.\.|\\\\|\/\//.test(relPath)) {
      errors.push(`Invalid path for node ${label || id}: ${relPath}`);
      continue;
    }
    if (!isPathSafe(root, relPath)) {
      errors.push(`Path traversal blocked for ${label || id}`);
      continue;
    }

    try {
      // Inline scaffold logic (mirrors scaffold.ts/materialize.ts) — no HTTP self-call.
      const absPath = path.join(root, relPath);
      const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
      const targetDir = pathLooksLikeFile ? path.dirname(absPath) : absPath;

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const indexPath = pathLooksLikeFile ? absPath : path.join(absPath, "index.ts");
      const archNodeId = id || label;
      const layer = typeof node.layer === "string" && node.layer.trim() ? node.layer : "Uncategorized";
      const kind =
        (typeof node.kind === "string" && node.kind.trim() && node.kind) ||
        (typeof node.techKind === "string" && node.techKind.trim() && node.techKind) ||
        "module";
      const rel = path.relative(root, indexPath).replace(/\\/g, "/");
      const header =
        "// Generated by Arch Visualizer. Boilerplate only — implement as needed.\n" +
        `// @archNodeId: ${archNodeId}`;

      if (fs.existsSync(indexPath)) {
        const existing = fs.readFileSync(indexPath, "utf-8");
        if (existing.includes("@archNodeId:")) {
          // Already materialized by a previous run — idempotent no-op.
          skipped.push(rel);
          continue;
        }
        fs.writeFileSync(indexPath, `${header}\n${existing}`, "utf-8");
      } else {
        const body = `\n\n// TODO: Implement ${label || id} (${layer} / ${kind}).\n\nexport function TODO_${archNodeId.replace(
          /[^a-zA-Z0-9_]/g,
          "_"
        )}() {\n  // implementation pending\n}\n`;
        fs.writeFileSync(indexPath, `${header}${body}`, "utf-8");
      }

      created.push(rel);
    } catch (err) {
      errors.push(`${label || id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ created, skipped, errors });
});

export { router as designMaterializeRoutes };
