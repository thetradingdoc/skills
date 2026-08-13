/**
 * Detect config variants of the same n8n workflow (shared id, different versionId / params).
 */

import { DEFAULT_VARIANT_KEY } from "./identity.js";

const TZ_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /Australia\/Sydney|\+11:00|AEST/i, key: "AEST" },
  { re: /America\/New_York|America\/Toronto|\-0[45]:00|EST\b|EDT\b/i, key: "EST" },
  { re: /America\/Los_Angeles|PST\b|PDT\b|\-0[78]:00/i, key: "PST" },
  { re: /Europe\/London|GMT\b|BST\b/i, key: "GMT" },
  { re: /UTC|Z["'\s]/i, key: "UTC" },
];

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/** Infer a stable variant key from workflow content (timezone forks, etc.). */
export function detectVariantKey(raw: unknown, hint?: string): string {
  if (hint && hint.trim()) return hint.trim();
  if (!raw || typeof raw !== "object") return DEFAULT_VARIANT_KEY;
  const wf = raw as { name?: string; nodes?: unknown[] };
  const blob: string[] = [];
  if (wf.name) blob.push(wf.name);
  if (Array.isArray(wf.nodes)) {
    for (const n of wf.nodes) {
      if (n && typeof n === "object") {
        collectStrings((n as { parameters?: unknown }).parameters, blob);
      }
    }
  }
  const text = blob.join("\n");
  // Count hits — timezone forks often leave leftover strings from the sibling variant.
  const scores = new Map<string, number>();
  for (const { re, key } of TZ_PATTERNS) {
    const matches = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
    const n = matches?.length ?? 0;
    if (n > 0) scores.set(key, (scores.get(key) ?? 0) + n);
  }
  if (scores.size === 0) return DEFAULT_VARIANT_KEY;
  let best = DEFAULT_VARIANT_KEY;
  let bestN = -1;
  for (const [key, n] of scores) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return best;
}

export type ParamDelta = {
  nodeName: string;
  nodeId: string;
  fields: string[];
};

/** Diff parameters between two workflows that share structure (same node ids/names). */
export function configDelta(
  primary: unknown,
  secondary: unknown
): ParamDelta[] {
  const aNodes = Array.isArray((primary as { nodes?: unknown[] })?.nodes)
    ? ((primary as { nodes: Array<Record<string, unknown>> }).nodes)
    : [];
  const bNodes = Array.isArray((secondary as { nodes?: unknown[] })?.nodes)
    ? ((secondary as { nodes: Array<Record<string, unknown>> }).nodes)
    : [];
  const bById = new Map(bNodes.map((n) => [String(n.id), n]));
  const deltas: ParamDelta[] = [];
  for (const a of aNodes) {
    const b = bById.get(String(a.id));
    if (!b) continue;
    const ap = JSON.stringify(a.parameters ?? {});
    const bp = JSON.stringify(b.parameters ?? {});
    if (ap === bp) continue;
    // Rough field list: top-level parameter keys that differ
    const aParams = (a.parameters ?? {}) as Record<string, unknown>;
    const bParams = (b.parameters ?? {}) as Record<string, unknown>;
    const fields = new Set<string>([
      ...Object.keys(aParams),
      ...Object.keys(bParams),
    ]);
    const changed: string[] = [];
    for (const f of fields) {
      if (JSON.stringify(aParams[f]) !== JSON.stringify(bParams[f])) changed.push(f);
    }
    deltas.push({
      nodeName: String(a.name ?? a.id),
      nodeId: String(a.id),
      fields: changed,
    });
  }
  return deltas;
}
