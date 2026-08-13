/**
 * Post-V1: client helper for materializing a design-mode graph into real
 * files on disk via POST /api/design-materialize.
 */
import type { ArchNode } from "./types";

export interface DesignMaterializeNode {
  id: string;
  label?: string;
  layer?: string;
  techKind?: string;
  kind?: string;
  path?: string;
}

export interface DesignMaterializeResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

/** Slugify a label into a filesystem-safe path segment. Mirrors the server helper. */
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
 * src/<slug>/index.ts. Mirrors webapp/server/src/designMaterialize.ts so the
 * UI can preview what a node will materialize to before submitting.
 */
export function relPathForDesignNode(node: DesignMaterializeNode | ArchNode): string {
  const rawPath = typeof node.path === "string" ? node.path.trim().replace(/\\/g, "/") : "";
  const looksSafeProjectRelative =
    rawPath.length > 0 &&
    !rawPath.startsWith("/") &&
    !rawPath.includes("..") &&
    !/^[a-zA-Z]:/.test(rawPath);
  if (looksSafeProjectRelative) return rawPath;
  return `src/${slug(node.label || node.id)}/index.ts`;
}

/** POST the design graph's nodes to the server to be materialized under targetRoot. */
export async function materializeDesignGraph({
  apiBase,
  token,
  targetRoot,
  nodes,
}: {
  apiBase: string;
  token: string;
  targetRoot: string;
  nodes: DesignMaterializeNode[];
}): Promise<DesignMaterializeResult> {
  const res = await fetch(`${apiBase}/design-materialize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetRoot, nodes }),
  });

  const data: unknown = await res.json().catch(() => ({}));
  const parsed = (data ?? {}) as Partial<DesignMaterializeResult> & { error?: string };

  if (!res.ok) {
    throw new Error(parsed.error ?? `Materialize failed (${res.status})`);
  }

  return {
    created: Array.isArray(parsed.created) ? parsed.created : [],
    skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    errors: Array.isArray(parsed.errors) ? parsed.errors : [],
  };
}
