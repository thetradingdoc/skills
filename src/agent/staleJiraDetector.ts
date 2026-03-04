/**
 * Stale Jira detection — AGENT_ROADMAP v4 §8
 * Compares stored fingerprints in Jira issues with current module state.
 */

import * as crypto from "crypto";
import type { ArchGraph } from "../types";

export interface JiraIssueWithFingerprint {
  key: string;
  summary: string;
  status: string;
  storedFingerprint: string | null;
  storedModule: string | null;
}

export interface StaleJiraMismatch {
  key: string;
  summary: string;
  storedFingerprint: string | null;
  storedModule: string | null;
  currentFingerprint: string | null;
  reason: "changed" | "orphaned" | "missing_stored";
}

/**
 * Extract arch-fingerprint and arch-module from Jira description text.
 * Handles both plain text and ADF (recursively extracts text).
 */
export function extractFingerprintFromDescription(description: unknown): {
  fingerprint: string | null;
  module: string | null;
} {
  const text = descriptionToString(description);
  if (!text) return { fingerprint: null, module: null };
  const fpMatch = text.match(/arch-fingerprint:\s*([a-fA-F0-9]+)/);
  const modMatch = text.match(/arch-module:\s*([^\s\n]+)/);
  return {
    fingerprint: fpMatch?.[1] ?? null,
    module: modMatch?.[1] ?? null,
  };
}

export function descriptionToString(d: unknown): string {
  if (typeof d === "string") return d;
  if (!d || typeof d !== "object") return "";
  const obj = d as Record<string, unknown>;
  if (obj.type === "doc" && Array.isArray(obj.content)) {
    return (obj.content as unknown[]).map((c) => descriptionToString(c)).join("");
  }
  if (obj.type === "paragraph" && Array.isArray(obj.content)) {
    return (obj.content as unknown[]).map((c) => descriptionToString(c)).join("");
  }
  if (obj.type === "text" && typeof obj.text === "string") return obj.text;
  return "";
}

/**
 * Compute a simple fingerprint for a module (path + file count).
 * Phase 3 stub; full implementation uses AST export/import signatures.
 */
function computeModuleFingerprint(node: { path: string; files: string[] }): string {
  const payload = `${node.path}:${node.files.length}:${node.files.sort().join(",")}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Detect Jira issues whose stored fingerprint no longer matches the current graph.
 */
export function detectStaleJira(
  graph: ArchGraph,
  issues: JiraIssueWithFingerprint[]
): StaleJiraMismatch[] {
  const moduleMap = new Map<string, string>();
  for (const n of graph.nodes) {
    moduleMap.set(n.path, computeModuleFingerprint(n));
  }

  const mismatches: StaleJiraMismatch[] = [];

  for (const issue of issues) {
    if (!issue.storedFingerprint) continue; // New format, no stored fingerprint
    const storedMod = issue.storedModule;
    if (!storedMod) continue;
    const currentFp = moduleMap.get(storedMod) ?? null;
    if (!currentFp) {
      // Module deleted
      mismatches.push({
        key: issue.key,
        summary: issue.summary,
        storedFingerprint: issue.storedFingerprint,
        storedModule: storedMod,
        currentFingerprint: null,
        reason: "orphaned",
      });
    } else if (currentFp !== issue.storedFingerprint) {
      // Code changed
      mismatches.push({
        key: issue.key,
        summary: issue.summary,
        storedFingerprint: issue.storedFingerprint,
        storedModule: storedMod,
        currentFingerprint: currentFp,
        reason: "changed",
      });
    }
  }

  return mismatches;
}
