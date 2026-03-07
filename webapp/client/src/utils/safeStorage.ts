/**
 * LocalStorage wrapper that handles unavailable storage (private browsing, quota exceeded).
 * Silently falls back to in-memory Map when localStorage throws.
 */

let fallback: Map<string, string> | null = null;

function getFallback(): Map<string, string> {
  if (!fallback) fallback = new Map();
  return fallback;
}

export function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return getFallback().get(key) ?? null;
  }
}

export function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    getFallback().set(key, value);
  }
}

export function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    getFallback().delete(key);
  }
}
