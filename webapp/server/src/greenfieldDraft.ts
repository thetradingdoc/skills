/**
 * Greenfield draft persistence — proposed nodes/edges per session.
 * Stored under PROJECT_ROOT or a configured base so server owns draft state.
 */

import * as fs from "fs";
import * as path from "path";

const GREENFIELD_DIR = ".agent/greenfield";
const DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GC_PROBABILITY = 0.05; // best-effort; keep cheap
const GC_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface DraftNode {
  id: string;
  label: string;
  layer?: string;
  description?: string;
  archNodeId?: string;
  /** Optional minimal skeleton code proposed by designer */
  skeletonCode?: string;
  /** Optional layout hint for canvas auto-arrangement */
  layoutHint?: string;
  /** Optional group ID to cluster nodes visually */
  group?: string;
}

export interface DraftEdge {
  source: string;
  target: string;
}

export interface GreenfieldDraft {
  sessionId: string;
  workspaceId?: string;
  nodes: DraftNode[];
  edges: DraftEdge[];
  updatedAt: number;
}

function getGreenfieldDir(basePath: string): string {
  return path.join(basePath, GREENFIELD_DIR);
}

function getDraftPath(basePath: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 128);
  return path.join(getGreenfieldDir(basePath), `draft-${safe}.json`);
}

function getBasePath(): string {
  const base =
    process.env.PROJECTS_BASE_DIR?.trim() ||
    process.env.PROJECT_ROOT?.trim() ||
    process.cwd();
  return path.resolve(base);
}

function getDraftTtlMs(): number {
  const raw = process.env.GREENFIELD_DRAFT_TTL_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DRAFT_TTL_MS;
  return Math.min(n, 30 * 24 * 60 * 60 * 1000); // cap at 30 days
}

function getGcStampPath(basePath: string): string {
  return path.join(getGreenfieldDir(basePath), ".gc-stamp");
}

function canRunGc(basePath: string): boolean {
  try {
    const stamp = getGcStampPath(basePath);
    if (!fs.existsSync(stamp)) return true;
    const raw = fs.readFileSync(stamp, "utf-8").trim();
    const last = raw ? Number(raw) : NaN;
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > GC_MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markGcRan(basePath: string): void {
  try {
    const dir = getGreenfieldDir(basePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getGcStampPath(basePath), String(Date.now()), "utf-8");
  } catch {
    // ignore
  }
}

export function gcDrafts(basePath?: string): { deleted: number } {
  const root = basePath ?? getBasePath();
  const dir = getGreenfieldDir(root);
  const ttl = getDraftTtlMs();
  let deleted = 0;
  try {
    if (!fs.existsSync(dir)) return { deleted };
    const now = Date.now();
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (!name.startsWith("draft-") || !name.endsWith(".json")) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        const age = now - stat.mtimeMs;
        if (age > ttl) {
          fs.unlinkSync(full);
          deleted++;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return { deleted };
}

function maybeGc(basePath?: string): void {
  const root = basePath ?? getBasePath();
  if (Math.random() > GC_PROBABILITY) return;
  if (!canRunGc(root)) return;
  markGcRan(root);
  gcDrafts(root);
}

export function loadDraft(sessionId: string, basePath?: string): GreenfieldDraft | null {
  const root = basePath ?? getBasePath();
  maybeGc(root);
  const filePath = getDraftPath(root, sessionId);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as GreenfieldDraft;
    if (!parsed.sessionId || !Array.isArray(parsed.nodes)) return null;
    return {
      ...parsed,
      nodes: parsed.nodes ?? [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return null;
  }
}

export function saveDraft(
  sessionId: string,
  draft: Omit<GreenfieldDraft, "sessionId" | "updatedAt">,
  basePath?: string
): GreenfieldDraft {
  const root = basePath ?? getBasePath();
  maybeGc(root);
  const dir = getGreenfieldDir(root);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const full: GreenfieldDraft = {
    ...draft,
    sessionId,
    nodes: draft.nodes ?? [],
    edges: draft.edges ?? [],
    updatedAt: Date.now(),
  };
  const filePath = getDraftPath(root, sessionId);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(full, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
  return full;
}

export function deleteDraft(sessionId: string, basePath?: string): boolean {
  const root = basePath ?? getBasePath();
  const filePath = getDraftPath(root, sessionId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function appendDraftNode(
  sessionId: string,
  node: DraftNode,
  basePath?: string
): GreenfieldDraft {
  const existing = loadDraft(sessionId, basePath);
  const nodes = existing ? [...existing.nodes] : [];
  const idx = nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) nodes[idx] = node;
  else nodes.push(node);
  return saveDraft(sessionId, {
    nodes,
    edges: existing?.edges ?? [],
    workspaceId: existing?.workspaceId,
  }, basePath);
}

export function removeDraftNode(
  sessionId: string,
  nodeId: string,
  basePath?: string
): GreenfieldDraft | null {
  const existing = loadDraft(sessionId, basePath);
  if (!existing) return null;
  const nodes = existing.nodes.filter((n) => n.id !== nodeId);
  const edges = existing.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return saveDraft(sessionId, {
    nodes,
    edges,
    workspaceId: existing.workspaceId,
  }, basePath);
}

export function updateDraftNode(
  sessionId: string,
  nodeId: string,
  updates: Partial<DraftNode>,
  basePath?: string
): GreenfieldDraft | null {
  const existing = loadDraft(sessionId, basePath);
  if (!existing) return null;
  const idx = existing.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) return null;
  const nodes = [...existing.nodes];
  nodes[idx] = { ...nodes[idx], ...updates };
  return saveDraft(sessionId, {
    nodes,
    edges: existing.edges,
    workspaceId: existing.workspaceId,
  }, basePath);
}

export function appendDraftEdge(
  sessionId: string,
  edge: DraftEdge,
  basePath?: string
): GreenfieldDraft {
  const existing = loadDraft(sessionId, basePath);
  const edges = existing ? [...existing.edges] : [];
  if (!edges.some((e) => e.source === edge.source && e.target === edge.target)) {
    edges.push(edge);
  }
  return saveDraft(sessionId, {
    nodes: existing?.nodes ?? [],
    edges,
    workspaceId: existing?.workspaceId,
  }, basePath);
}
