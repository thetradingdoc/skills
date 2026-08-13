/**
 * Optional Insights/node binding on todo create (Gate E).
 * Pure — used by POST /todos and unit tests.
 */
export function sourceNodeIdFromBody(
  body: Record<string, unknown> | null | undefined
): string | null {
  const raw = body?.sourceNodeId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
