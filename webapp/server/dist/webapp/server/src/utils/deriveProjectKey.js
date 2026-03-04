/**
 * Derive a Jira project key from a repo URL.
 * e.g. github.com/owner/doclittle-platform → DOCLITTLEP
 * Uses alphanumeric only (no hyphen/underscore) to avoid invalid keys like DOCLITTLE-
 */
export function deriveProjectKey(repoUrl) {
    const repoName = (repoUrl.split("/").pop() ?? "").replace(/\.git$/i, "");
    const normalized = repoName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .replace(/^[0-9]+/, "")
        .slice(0, 10);
    return normalized.length >= 2 ? normalized : "PROJ";
}
/** Jira project key validation: 2-10 chars, starts with letter, no trailing hyphen/underscore */
export const JIRA_PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9_-]{0,9}$/;
export function isValidProjectKey(key) {
    const k = key.trim().toUpperCase();
    return JIRA_PROJECT_KEY_REGEX.test(k) && k.length >= 2 && !/[-_]$/.test(k);
}
