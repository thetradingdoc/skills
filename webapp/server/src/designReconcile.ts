/**
 * P1 assisted design loop — reconciliation between a design graph and a scanned graph.
 *
 * Pure function, no network/DB calls: given the design ArchGraph a user authored
 * (nodes carry `buildStatus`/`position`, edges carry `relation`) and the ArchGraph
 * produced by scanning the actual repository, work out which planned modules were
 * actually built (`matched`), which were planned but never built (`missing`), and
 * which code exists in the repo but was never part of the design (`unplanned`).
 *
 * This intentionally does NOT depend on `webapp/client/src/designRules.ts`
 * (`evaluateDesign`) — that module stays client-side as the single source of
 * truth for design-time linting/findings shown in the UI. Reconciliation is a
 * different concern (design-vs-reality diffing) and only needs `ArchGraph`
 * shapes, so it lives here as its own pure module. If a future server-side
 * feature needs the rule engine itself, prefer importing
 * `../../client/src/designRules.ts` by relative path (as
 * `scripts/test-design-rules.ts` already does) rather than forking it.
 */

import type { ArchGraph, ArchNode } from "../../../src/types.js";

export type ReconcileMatchMethod = "exact_id" | "label_fuzzy" | "layer_label" | "path_similarity";

export interface ReconciliationMatch {
  designNodeId: string;
  scanNodeId: string;
  /** 0-1 confidence in this match. 1 = exact id/path match. */
  confidence: number;
  method: ReconcileMatchMethod;
}

export interface ReconciliationMissingNode {
  designNodeId: string;
  label: string;
  layer?: string;
}

export interface ReconciliationUnplannedNode {
  scanNodeId: string;
  label: string;
  layer?: string;
}

export interface ReconciliationResult {
  /** Design nodes found in the scanned repo — planned and built. */
  matched: ReconciliationMatch[];
  /** Design nodes not found in the scan — planned but not (yet) built. */
  missing: ReconciliationMissingNode[];
  /** Scanned nodes with no corresponding design node — built but not planned. */
  unplanned: ReconciliationUnplannedNode[];
}

const MIN_MATCH_CONFIDENCE = 0.5;

function normalize(s: string | undefined | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePath(s: string | undefined | null): string {
  return normalize((s ?? "").replace(/\.[a-z0-9]+$/i, ""));
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

/** Jaccard-style overlap of word tokens, 0-1. */
function tokenOverlap(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Classic edit-distance DP. Small strings only (node labels/paths), so O(n*m) is fine. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** 1 - normalized edit distance, 0-1. */
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function layerOf(node: ArchNode): string {
  return normalize(typeof node.layer === "string" ? node.layer : "");
}

interface Candidate {
  score: number;
  method: ReconcileMatchMethod;
}

/** Every normalized path-like identifier a node carries (path and archNodeId can each be authoritative). */
function pathIdentifiers(node: ArchNode): string[] {
  const raw = [node.path, node.archNodeId].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return [...new Set(raw.map(normalizePath).filter(Boolean))];
}

/** Best pairwise similarity between two sets of path-like identifiers, 0-1. */
function bestPathSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      best = Math.max(best, stringSimilarity(x, y));
    }
  }
  return best;
}

/** Best single-method score for a (design, scan) node pair, or null if no method applies. */
function bestCandidate(design: ArchNode, scan: ArchNode): Candidate | null {
  const candidates: Candidate[] = [];

  // 1. Exact id — same node id, or same normalized path/archNodeId across graphs
  // (either side's `path` or `archNodeId` can be the authoritative identifier).
  if (design.id === scan.id) {
    candidates.push({ score: 1, method: "exact_id" });
  }
  const designPaths = pathIdentifiers(design);
  const scanPaths = pathIdentifiers(scan);
  const hasExactPathMatch = designPaths.some((d) => scanPaths.includes(d));
  if (hasExactPathMatch) {
    candidates.push({ score: 0.97, method: "exact_id" });
  }

  // 2. Label fuzzy — same or near-identical label text.
  const designLabel = normalize(design.label);
  const scanLabel = normalize(scan.label);
  if (designLabel && scanLabel) {
    if (designLabel === scanLabel) {
      candidates.push({ score: 0.9, method: "label_fuzzy" });
    } else {
      const overlap = tokenOverlap(design.label, scan.label);
      const sim = stringSimilarity(designLabel, scanLabel);
      const best = Math.max(overlap, sim);
      if (best >= 0.5) {
        candidates.push({ score: 0.5 + 0.35 * best, method: "label_fuzzy" });
      }
    }
  }

  // 3. Layer + label — same architectural layer plus some label overlap.
  const dLayer = layerOf(design);
  const sLayer = layerOf(scan);
  if (dLayer && sLayer && dLayer === sLayer) {
    const overlap = tokenOverlap(design.label, scan.label);
    if (overlap >= 0.3) {
      candidates.push({ score: 0.4 + 0.3 * overlap, method: "layer_label" });
    }
  }

  // 4. Path similarity — fuzzy match on file/module path.
  if (designPaths.length > 0 && scanPaths.length > 0 && !hasExactPathMatch) {
    const sim = bestPathSimilarity(designPaths, scanPaths);
    if (sim >= 0.5) {
      candidates.push({ score: 0.3 + 0.4 * sim, method: "path_similarity" });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!;
}

/**
 * Reconcile a design graph against a scanned graph.
 *
 * Greedy 1:1 matching: score every (design node, scan node) pair, then assign
 * highest-confidence pairs first so no node is claimed twice. Anything left
 * unmatched on the design side is `missing` (planned, not built); anything
 * left unmatched on the scan side is `unplanned` (built, not planned).
 */
export function reconcileDesignToScan(design: ArchGraph, scanned: ArchGraph): ReconciliationResult {
  const designNodes = design?.nodes ?? [];
  const scanNodes = scanned?.nodes ?? [];

  const pairs: Array<{ designNodeId: string; scanNodeId: string; score: number; method: ReconcileMatchMethod }> = [];
  for (const d of designNodes) {
    for (const s of scanNodes) {
      const candidate = bestCandidate(d, s);
      if (candidate && candidate.score >= MIN_MATCH_CONFIDENCE) {
        pairs.push({ designNodeId: d.id, scanNodeId: s.id, score: candidate.score, method: candidate.method });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const matchedDesignIds = new Set<string>();
  const matchedScanIds = new Set<string>();
  const matched: ReconciliationMatch[] = [];
  for (const pair of pairs) {
    if (matchedDesignIds.has(pair.designNodeId) || matchedScanIds.has(pair.scanNodeId)) continue;
    matchedDesignIds.add(pair.designNodeId);
    matchedScanIds.add(pair.scanNodeId);
    matched.push({
      designNodeId: pair.designNodeId,
      scanNodeId: pair.scanNodeId,
      confidence: Math.round(pair.score * 100) / 100,
      method: pair.method,
    });
  }

  const missing: ReconciliationMissingNode[] = designNodes
    .filter((n) => !matchedDesignIds.has(n.id))
    .map((n) => ({ designNodeId: n.id, label: n.label, layer: typeof n.layer === "string" ? n.layer : undefined }));

  const unplanned: ReconciliationUnplannedNode[] = scanNodes
    .filter((n) => !matchedScanIds.has(n.id))
    .map((n) => ({ scanNodeId: n.id, label: n.label, layer: typeof n.layer === "string" ? n.layer : undefined }));

  return { matched, missing, unplanned };
}
