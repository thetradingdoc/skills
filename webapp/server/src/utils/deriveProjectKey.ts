/**
 * Jira project key helpers (inlined for reliable ESM startup; keep in sync with webapp/shared/deriveProjectKey.ts).
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

export const JIRA_PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9_-]{0,9}$/;

export function isValidProjectKey(key: string): boolean {
  const k = key.trim().toUpperCase();
  return JIRA_PROJECT_KEY_REGEX.test(k) && k.length >= 2 && !/[-_]$/.test(k);
}
