/**
 * Blanko-Lab GitHub App — JWT + installation access tokens (Collaborate Gate B/C).
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import * as jose from "jose";

const APP_ID = process.env.GITHUB_APP_ID?.trim() || "";
const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET?.trim() || "";
const PRIVATE_KEY_RAW = process.env.GITHUB_APP_PRIVATE_KEY?.trim() || "";
const APP_URL = process.env.APP_URL?.trim() || "http://localhost:5174";
const APP_SLUG = process.env.GITHUB_APP_SLUG?.trim() || "blanko-lab";

export function isGithubAppConfigured(): boolean {
  return !!(APP_ID && PRIVATE_KEY_RAW && PRIVATE_KEY_RAW.includes("BEGIN"));
}

function normalizePem(raw: string): string {
  let pem = raw.trim();
  if (
    (pem.startsWith('"') && pem.endsWith('"')) ||
    (pem.startsWith("'") && pem.endsWith("'"))
  ) {
    pem = pem.slice(1, -1);
  }
  return pem.replace(/\\n/g, "\n");
}

let cachedKey: KeyObject | null = null;

function getPrivateKey(): KeyObject {
  if (cachedKey) return cachedKey;
  cachedKey = createPrivateKey(normalizePem(PRIVATE_KEY_RAW));
  return cachedKey;
}

/** Short-lived App JWT for GitHub App API. */
export async function createAppJwt(): Promise<string> {
  if (!isGithubAppConfigured()) {
    throw new Error("GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY).");
  }
  const key = getPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(APP_ID)
    .sign(key);
}

export type InstallationToken = {
  token: string;
  expiresAt: string;
};

const tokenCache = new Map<number, { token: string; expiresAtMs: number }>();

/** Installation access token (cached ~50 min). */
export async function getInstallationToken(installationId: number): Promise<InstallationToken> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return { token: cached.token, expiresAt: new Date(cached.expiresAtMs).toISOString() };
  }
  const jwt = await createAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub installation token failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAtMs = Date.parse(data.expires_at) || Date.now() + 50 * 60_000;
  tokenCache.set(installationId, { token: data.token, expiresAtMs });
  return { token: data.token, expiresAt: data.expires_at };
}

/** User-facing App install URL (state = workspaceId). */
export function buildAppInstallUrl(workspaceId: string): string {
  const state = encodeURIComponent(workspaceId);
  // Prefer slug URL; falls back to app id path if slug wrong — user can set GITHUB_APP_SLUG.
  if (CLIENT_ID) {
    return `https://github.com/apps/${encodeURIComponent(APP_SLUG)}/installations/new?state=${state}`;
  }
  return `https://github.com/apps/${encodeURIComponent(APP_SLUG)}/installations/new?state=${state}`;
}

export function getAppPublicConfig() {
  return {
    configured: isGithubAppConfigured(),
    appId: APP_ID || null,
    clientId: CLIENT_ID || null,
    slug: APP_SLUG,
    installUrlTemplate: `https://github.com/apps/${APP_SLUG}/installations/new`,
    callbackHint: `${APP_URL}?github-app-install=1`,
    hasClientSecret: !!CLIENT_SECRET,
  };
}

export type GhRepo = { full_name: string; id: number; private: boolean };

export async function listInstallationRepos(installationId: number): Promise<GhRepo[]> {
  const { token } = await getInstallationToken(installationId);
  const out: GhRepo[] = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`List installation repos failed: ${res.status} ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      repositories?: Array<{ full_name: string; id: number; private?: boolean }>;
    };
    const batch = data.repositories ?? [];
    for (const r of batch) {
      out.push({ full_name: r.full_name, id: r.id, private: !!r.private });
    }
    if (batch.length < 100) break;
    page += 1;
  }
  return out;
}

/** Resolve installation token for a workspace when github_installation_id is set. */
export async function resolveCloneTokenForWorkspace(opts: {
  githubInstallationId?: number | null;
}): Promise<string | null> {
  const id = opts.githubInstallationId;
  if (id && Number.isFinite(id) && id > 0 && isGithubAppConfigured()) {
    try {
      const { token } = await getInstallationToken(id);
      return token;
    } catch (e) {
      console.warn(
        "[githubApp] installation token failed, falling back to GITHUB_TOKEN:",
        e instanceof Error ? e.message : e
      );
    }
  }
  return process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_ACCESS_TOKEN?.trim() || null;
}

export function clearInstallationTokenCache(installationId?: number): void {
  if (installationId != null) tokenCache.delete(installationId);
  else tokenCache.clear();
}
