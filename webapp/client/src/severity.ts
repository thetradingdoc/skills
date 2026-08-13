/**
 * Shared Blanko severity (redesign v2 D3).
 * Single vocabulary for designRules, insightsBriefing, and findings mapping.
 */

export type Severity = "blocker" | "warning" | "soft";

/** Legacy designRules severity → shared. */
export function fromDesignFindingSeverity(
  s: "blocker" | "risk" | "suggestion" | string
): Severity {
  if (s === "blocker") return "blocker";
  if (s === "risk") return "warning";
  return "soft";
}

/** Legacy Insights priority → shared. */
export function fromActionPriority(p: "blocker" | "high" | "medium" | string): Severity {
  if (p === "blocker") return "blocker";
  if (p === "high") return "warning";
  return "soft";
}

/** Shared → badge chrome vocabulary still used by ArchCanvas. */
export function toBadgeChromeSeverity(
  s: Severity
): "blocker" | "risk" | "suggestion" {
  if (s === "blocker") return "blocker";
  if (s === "warning") return "risk";
  return "suggestion";
}

/** workspace_findings DB severity → shared. */
export function fromFindingDbSeverity(
  s: "critical" | "high" | "medium" | "low" | string
): Severity {
  if (s === "critical") return "blocker";
  if (s === "high") return "warning";
  return "soft";
}

export function toFindingDbSeverity(
  s: Severity
): "critical" | "high" | "medium" | "low" {
  if (s === "blocker") return "critical";
  if (s === "warning") return "high";
  return "low";
}

export const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 3,
  warning: 2,
  soft: 1,
};

/** Counts that contribute to canvas badges (D3 / Epic 1). */
export function contributesToBadge(s: Severity): boolean {
  return s === "blocker" || s === "warning";
}
