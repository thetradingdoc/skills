/**
 * Per-user Jira config from integrations table.
 * Every user connects their own Jira via the UI; no shared/env fallback.
 */
import { supabaseAdmin } from "./supabaseAdmin.js";
import { decrypt } from "./utils/crypto.js";
/** Get Jira config for a user from their integrations row. */
export async function getUserJiraConfigWithSource(userId) {
    if (!userId || !supabaseAdmin)
        return null;
    let data = null;
    let queryError = null;
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
    }
    catch (e) {
        queryError = e;
    }
    if (queryError || !data?.api_token)
        return null;
    try {
        const apiToken = decrypt(data.api_token);
        return {
            config: {
                baseUrl: data.base_url ?? "",
                email: data.email ?? "",
                apiToken,
                project: data.default_project ?? null,
            },
            source: "db",
        };
    }
    catch {
        return null;
    }
}
/** Get Jira config for a user from their integrations row. */
export async function getUserJiraConfig(userId) {
    const result = await getUserJiraConfigWithSource(userId);
    return result?.config ?? null;
}
