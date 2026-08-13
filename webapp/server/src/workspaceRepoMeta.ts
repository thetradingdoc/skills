/**
 * Soft-write workspace repo metadata. Some Blanko DBs lack github_full_name
 * (PostgREST PGRST204); never let that abort repo_url / project_root updates.
 */
export type WorkspaceRepoMeta = {
  repo_url?: string | null;
  project_root?: string | null;
  github_full_name?: string | null;
  github_repo_id?: number | null;
  github_installation_id?: number | null;
};

export function isMissingGithubColumnError(err: unknown, column: string): boolean {
  const msg = String(
    (err as { message?: string })?.message ??
      (err as { details?: string })?.details ??
      err ??
      ""
  );
  return (
    new RegExp(column, "i").test(msg) ||
    /PGRST204/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

export function isMissingGithubFullNameError(err: unknown): boolean {
  return isMissingGithubColumnError(err, "github_full_name");
}

export async function updateWorkspaceRepoMeta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: { from: (t: string) => any },
  workspaceId: string,
  meta: WorkspaceRepoMeta
): Promise<{ ok: true; wroteGithubFullName: boolean } | { ok: false; error: string }> {
  const base: Record<string, string | number> = {};
  if (typeof meta.repo_url === "string" && meta.repo_url.trim()) {
    base.repo_url = meta.repo_url.trim();
  }
  if (typeof meta.project_root === "string" && meta.project_root.trim()) {
    base.project_root = meta.project_root.trim();
  }
  const fullName =
    typeof meta.github_full_name === "string" && meta.github_full_name.trim()
      ? meta.github_full_name.trim()
      : null;
  if (typeof meta.github_repo_id === "number" && Number.isFinite(meta.github_repo_id)) {
    base.github_repo_id = meta.github_repo_id;
  }
  if (
    typeof meta.github_installation_id === "number" &&
    Number.isFinite(meta.github_installation_id) &&
    meta.github_installation_id > 0
  ) {
    base.github_installation_id = meta.github_installation_id;
  }

  const withGithub = { ...base } as Record<string, string | number>;
  if (fullName) withGithub.github_full_name = fullName;

  if (Object.keys(withGithub).length > 0) {
    const { error } = await supabaseAdmin
      .from("workspaces")
      .update(withGithub)
      .eq("id", workspaceId);
    if (!error) return { ok: true, wroteGithubFullName: !!fullName };
    // Strip unknown columns progressively
    const retryPayload = { ...withGithub };
    if (isMissingGithubColumnError(error, "github_installation_id")) {
      delete retryPayload.github_installation_id;
    }
    if (isMissingGithubColumnError(error, "github_repo_id")) {
      delete retryPayload.github_repo_id;
    }
    if (isMissingGithubFullNameError(error)) {
      delete retryPayload.github_full_name;
      console.warn(
        "[workspaceRepoMeta] github_full_name missing in schema; retrying without it:",
        error.message
      );
    }
    if (Object.keys(retryPayload).length && JSON.stringify(retryPayload) !== JSON.stringify(withGithub)) {
      const { error: e2 } = await supabaseAdmin
        .from("workspaces")
        .update(retryPayload)
        .eq("id", workspaceId);
      if (!e2) return { ok: true, wroteGithubFullName: !!retryPayload.github_full_name };
      if (!isMissingGithubFullNameError(e2) && !isMissingGithubColumnError(e2, "github_")) {
        return { ok: false, error: e2.message ?? String(e2) };
      }
    } else if (!isMissingGithubFullNameError(error) && !isMissingGithubColumnError(error, "github_")) {
      return { ok: false, error: error.message ?? String(error) };
    }
  }

  if (Object.keys(base).length === 0 && !fullName) {
    return { ok: true, wroteGithubFullName: false };
  }

  const bare: Record<string, string> = {};
  if (typeof base.repo_url === "string") bare.repo_url = base.repo_url;
  if (typeof base.project_root === "string") bare.project_root = base.project_root;
  if (Object.keys(bare).length === 0) return { ok: true, wroteGithubFullName: false };

  const { error: retryErr } = await supabaseAdmin
    .from("workspaces")
    .update(bare)
    .eq("id", workspaceId);
  if (retryErr) return { ok: false, error: retryErr.message ?? String(retryErr) };
  return { ok: true, wroteGithubFullName: false };
}

/**
 * Resolve workspace by GitHub owner/repo when github_full_name column may be absent.
 * Prefer rows that also have github_installation_id when duplicates exist (Gate C dedupe).
 * Falls back to repo_url match.
 */
export async function findWorkspaceIdByGithubFullName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: { from: (t: string) => any },
  fullName: string,
  opts?: { installationId?: number | null }
): Promise<string | null> {
  const name = fullName.trim();
  if (!name) return null;
  const installationId = opts?.installationId;

  const byCol = await supabaseAdmin
    .from("workspaces")
    .select("id, github_installation_id")
    .eq("github_full_name", name)
    .is("archived_at", null)
    .limit(8);

  if (!byCol.error && Array.isArray(byCol.data) && byCol.data.length > 0) {
    const rows = byCol.data as Array<{ id: string; github_installation_id?: number | null }>;
    if (installationId && Number.isFinite(installationId)) {
      const hit = rows.find((r) => Number(r.github_installation_id) === Number(installationId));
      if (hit?.id) return hit.id;
    }
    const withInstall = rows.find((r) => r.github_installation_id != null);
    if (withInstall?.id) return withInstall.id;
    if (rows[0]?.id) return rows[0].id;
  }

  if (byCol.error && !isMissingGithubFullNameError(byCol.error)) {
    console.warn("[workspaceRepoMeta] lookup by github_full_name failed:", byCol.error.message);
  }

  const repoUrl = `https://github.com/${name}`;
  const byUrl = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("repo_url", repoUrl)
    .is("archived_at", null)
    .maybeSingle();

  if (!byUrl.error && byUrl.data?.id) return byUrl.data.id as string;

  const loose = await supabaseAdmin
    .from("workspaces")
    .select("id, repo_url")
    .ilike("repo_url", `%${name}%`)
    .is("archived_at", null)
    .limit(5);

  if (!loose.error && Array.isArray(loose.data)) {
    const hit = loose.data.find((row: { id?: string; repo_url?: string }) => {
      const u = String(row.repo_url ?? "");
      return u.includes(name) || u.includes(`${name}.git`);
    });
    if (hit?.id) return hit.id as string;
  }

  return null;
}

/** Clear installation id on all workspaces for this install (uninstall). */
export async function clearGithubInstallation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: { from: (t: string) => any },
  installationId: number
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .update({ github_installation_id: null })
    .eq("github_installation_id", installationId)
    .select("id");
  if (error) {
    console.warn("[workspaceRepoMeta] clearGithubInstallation:", error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Load workspace id + repo fields; omit github_full_name when schema lacks it.
 */
export async function loadWorkspaceRepoFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: { from: (t: string) => any },
  workspaceId: string
): Promise<{ id: string; repo_url?: string | null; github_full_name?: string | null } | null> {
  const withCol = await supabaseAdmin
    .from("workspaces")
    .select("id, repo_url, github_full_name")
    .eq("id", workspaceId)
    .single();

  if (!withCol.error && withCol.data) {
    return withCol.data as {
      id: string;
      repo_url?: string | null;
      github_full_name?: string | null;
    };
  }

  if (withCol.error && isMissingGithubFullNameError(withCol.error)) {
    const bare = await supabaseAdmin
      .from("workspaces")
      .select("id, repo_url")
      .eq("id", workspaceId)
      .single();
    if (bare.error || !bare.data) return null;
    return { ...(bare.data as { id: string; repo_url?: string | null }), github_full_name: null };
  }

  return null;
}
