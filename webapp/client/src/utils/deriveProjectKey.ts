/**
 * Derive a Jira project key from a repo URL.
 * e.g. github.com/owner/doclittle-platform → DOCLITTLEP
 * Uses alphanumeric only (no hyphen/underscore) to avoid invalid keys like DOCLITTLE-
 *
 * Must stay in sync with webapp/server/src/utils/deriveProjectKey.ts
 */
export function deriveProjectKey(repoUrl: string): string {
  const repoName = (repoUrl.split("/").pop() ?? "").replace(/\.git$/i, "");
  const normalized = repoName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 10);
  return normalized.length >= 2 ? normalized : "PROJ";
}

export function isValidProjectKey(key: string): boolean {
  const k = key.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_-]{0,9}$/.test(k) && k.length >= 2 && !/[-_]$/.test(k);
}
