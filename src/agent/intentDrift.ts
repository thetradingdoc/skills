/**
 * intentDrift — lightweight intent drift scoring.
 *
 * We avoid embeddings here and use a stable lexical similarity heuristic:
 * drift = 1 - JaccardSimilarity(tokens(intentSummary), tokens(recentReasoning)).
 * Returns a score in [0,1] where 1 = maximum drift.
 */

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  const cleaned = s
    .toLowerCase()
    .replace(/[`"'()[\]{}<>]/g, " ")
    .replace(/[^a-z0-9_\-./\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of cleaned) {
    if (t.length < 3) continue;
    out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function computeIntentDriftScore(intentSummary: string, reasoningSamples: string[]): number {
  const a = tokenize(intentSummary ?? "");
  const b = tokenize(reasoningSamples.join("\n"));
  const sim = jaccard(a, b);
  const drift = Math.max(0, Math.min(1, 1 - sim));
  return drift;
}

