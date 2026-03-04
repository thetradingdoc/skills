import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { encrypt } from "./utils/crypto.js";
import { isValidProjectKey } from "./utils/deriveProjectKey.js";

const router = Router();

/** List user's integrations (no tokens returned). */
router.get("/integrations", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id, provider, base_url, email, default_project, verified, verified_at, last_error, created_at")
    .eq("user_id", req.user!.id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ integrations: data ?? [] });
});

/** Save and verify Jira credentials. */
router.post("/integrations/jira", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { baseUrl, email, apiToken, defaultProject } = req.body as {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    defaultProject?: string;
  };

  if (!baseUrl || typeof baseUrl !== "string" || !email || typeof email !== "string" || !apiToken || typeof apiToken !== "string") {
    res.status(400).json({ error: "baseUrl, email, and apiToken are required" });
    return;
  }

  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");

  const projectKey = defaultProject?.trim().toUpperCase() || null;
  if (projectKey && !isValidProjectKey(projectKey)) {
    res.status(400).json({
      error: "Project key must be 2–10 chars, start with a letter, no trailing hyphen (e.g. PROJ)",
    });
    return;
  }

  try {
    const testRes = await fetch(`${normalizedBaseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
        Accept: "application/json",
      },
    });

    if (!testRes.ok) {
      const body = await testRes.json().catch(() => ({}));
      const msg = (body as { errorMessages?: string[] })?.errorMessages?.[0] ?? (body as { message?: string })?.message ?? "Invalid credentials";
      res.status(400).json({
        error: `Jira auth failed (${testRes.status}): ${msg}`,
      });
      return;
    }

    const jiraUser = (await testRes.json()) as { displayName?: string; accountId?: string };

    let encryptedToken: string;
    try {
      encryptedToken = encrypt(apiToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({
        error: "Server misconfigured: cannot encrypt token. " + msg,
      });
      return;
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("integrations")
      .upsert(
        {
          user_id: req.user!.id,
          provider: "jira",
          base_url: normalizedBaseUrl,
          email: email.trim(),
          api_token: encryptedToken,
          default_project: projectKey,
          verified: true,
          verified_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" }
      );

    if (upsertErr) {
      res.status(500).json({ error: upsertErr.message });
      return;
    }

    res.json({
      success: true,
      jiraUser: { displayName: jiraUser.displayName, accountId: jiraUser.accountId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    res.status(500).json({ error: message });
  }
});

/** Disconnect Jira. */
router.delete("/integrations/jira", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  await supabaseAdmin
    .from("integrations")
    .delete()
    .eq("user_id", req.user!.id)
    .eq("provider", "jira");
  res.json({ success: true });
});

export { router as integrationRoutes };
