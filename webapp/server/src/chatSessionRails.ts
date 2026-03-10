/**
 * In-memory session → railIds mapping for chat. Supports "retry rail 2", "cancel rail 1".
 */

const sessionRails = new Map<string, string[]>();

function sessionKey(threadId: string | null | undefined, workspaceId: string | null | undefined, userId: string): string {
  if (threadId && typeof threadId === "string" && threadId.trim()) {
    return `thread:${threadId.trim()}`;
  }
  if (workspaceId) {
    return `ws:${workspaceId}:${userId}`;
  }
  return `user:${userId}`;
}

export function addRailsToSession(
  threadId: string | null | undefined,
  workspaceId: string | null | undefined,
  userId: string,
  railIds: string[]
): void {
  if (railIds.length === 0) return;
  const key = sessionKey(threadId, workspaceId, userId);
  const prev = sessionRails.get(key) ?? [];
  sessionRails.set(key, [...prev, ...railIds]);
}

export function getSessionRails(
  threadId: string | null | undefined,
  workspaceId: string | null | undefined,
  userId: string
): string[] {
  const key = sessionKey(threadId, workspaceId, userId);
  return sessionRails.get(key) ?? [];
}

export function parseRailIntent(question: string): { action: "retry" | "cancel"; index: number } | null {
  const lower = question.toLowerCase().trim();
  const retryMatch = lower.match(/\bretry\s+rail\s+(\d+)\b/);
  if (retryMatch) {
    const n = parseInt(retryMatch[1]!, 10);
    if (n >= 1) return { action: "retry", index: n - 1 };
  }
  const cancelMatch = lower.match(/\bcancel\s+rail\s+(\d+)\b/);
  if (cancelMatch) {
    const n = parseInt(cancelMatch[1]!, 10);
    if (n >= 1) return { action: "cancel", index: n - 1 };
  }
  return null;
}
