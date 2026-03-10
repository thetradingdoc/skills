/**
 * Per-user Jira config from integrations table.
 * Every user connects their own Jira via the UI; no shared/env fallback.
 */
import { supabaseAdmin } from "./supabaseAdmin.js";
import { decrypt } from "./utils/crypto.js";

export interface UserJiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  project?: string | null;
}

export type JiraConfigSource = "db";

export interface UserJiraConfigWithSource {
  config: UserJiraConfig;
  source: JiraConfigSource;
}

/** Thrown when stored Jira token cannot be decrypted (rotated key, corrupted data). */
export class JiraDecryptError extends Error {
  constructor(userId?: string) {
    super(
      userId
        ? `Jira token decrypt failed for user ${userId.slice(0, 8)}… — reconnect Jira in Governance panel.`
        : "Jira token could not be decrypted. Please reconnect Jira in the Governance panel."
    );
    this.name = "JiraDecryptError";
  }
}

/** Get Jira config for a user from their integrations row. */
export async function getUserJiraConfigWithSource(
  userId: string | undefined
): Promise<UserJiraConfigWithSource | null> {
  if (!userId || !supabaseAdmin) return null;

  let data: { base_url?: string; email?: string; api_token?: string; default_project?: string | null } | null = null;
  let queryError: unknown = null;
  try {
    const result = await supabaseAdmin
      .from("integrations")
      .select("base_url, email, api_token, default_project, verified")
      .eq("user_id", userId)
      .eq("provider", "jira")
      .eq("verified", true)
      .maybeSingle();
    data = result.data;
    queryError = result.error;
  } catch (e) {
    queryError = e;
  }

  if (queryError || !data?.api_token) return null;

  try {
    const apiToken = decrypt(data.api_token as string);
    return {
      config: {
        baseUrl: (data.base_url as string) ?? "",
        email: (data.email as string) ?? "",
        apiToken,
        project: (data.default_project as string | null) ?? null,
      },
      source: "db",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[jira] Decrypt failed; marking integration unverified:", msg);
    try {
      await supabaseAdmin
        .from("integrations")
        .update({ verified: false })
        .eq("user_id", userId)
        .eq("provider", "jira");
    } catch {
      /* ignore */
    }
    throw new JiraDecryptError(userId);
  }
}

/** Get Jira config for a user from their integrations row. */
export async function getUserJiraConfig(
  userId: string | undefined
): Promise<UserJiraConfig | null> {
  const result = await getUserJiraConfigWithSource(userId);
  if (!result?.config) {
    console.warn(
      "[jira] getUserJiraConfig returned null",
      userId ? `(userId=${userId.slice(0, 8)}…)` : "(no userId)"
    );
  }
  return result?.config ?? null;
}
