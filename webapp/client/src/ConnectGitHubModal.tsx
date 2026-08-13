import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const API_BASE = "/api";

interface Repo {
  full_name: string;
  id: number;
  private: boolean;
}

interface Props {
  workspaceId: string | null;
  accessToken: string | null;
  onClose: () => void;
  onConnected?: (fullName: string) => void;
  /** From OAuth callback: state param to fetch repos */
  oauthState?: string | null;
  /** After App install bind — list repos via installation token */
  installationId?: number | null;
}

type AppConfig = {
  configured: boolean;
  slug: string;
  installUrlTemplate?: string;
};

export function ConnectGitHubModal({
  workspaceId,
  accessToken,
  onClose,
  onConnected,
  oauthState,
  installationId: installationIdProp = null,
}: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(
    installationIdProp && installationIdProp > 0 ? installationIdProp : null
  );

  useEffect(() => {
    if (installationIdProp && installationIdProp > 0) {
      setInstallationId(installationIdProp);
    }
  }, [installationIdProp]);

  useEffect(() => {
    fetch(`${API_BASE}/github/app/config`)
      .then((r) => r.json())
      .then((d) =>
        setAppConfig({
          configured: !!d.configured,
          slug: d.slug || "blanko-lab",
          installUrlTemplate: d.installUrlTemplate,
        })
      )
      .catch(() => setAppConfig({ configured: false, slug: "blanko-lab" }));
  }, []);

  const fetchAppRepos = useCallback(async () => {
    if (!accessToken || !workspaceId) {
      setRepos([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/github/app/repos?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "GITHUB_APP_NOT_INSTALLED") {
          setRepos([]);
          setError(null);
          setInstallationId(null);
          return;
        }
        throw new Error(data.error ?? "Failed to load repos");
      }
      setRepos(data.repos ?? []);
      if (typeof data.installation_id === "number") setInstallationId(data.installation_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load repos");
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  const fetchOAuthRepos = useCallback(async () => {
    if (!accessToken || !workspaceId || !oauthState) {
      setRepos([]);
      return;
    }
    const session = supabase ? (await supabase.auth.getSession()).data?.session : null;
    const providerToken = (session as { provider_token?: string })?.provider_token;
    if (!providerToken) {
      setError("GitHub token not found. Please complete the Connect with GitHub flow.");
      setRepos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/github/repos?state=${encodeURIComponent(oauthState)}&workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Token": providerToken,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load repos");
      setRepos(data.repos ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load repos");
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId, oauthState]);

  useEffect(() => {
    if (installationId && workspaceId && accessToken) {
      void fetchAppRepos();
      return;
    }
    if (oauthState && workspaceId) void fetchOAuthRepos();
  }, [installationId, oauthState, workspaceId, accessToken, fetchAppRepos, fetchOAuthRepos]);

  const handleConnect = async (repo: Repo) => {
    if (!accessToken || !workspaceId) return;
    setConnecting(repo.full_name);
    setError(null);
    try {
      const body: Record<string, string | number> = { github_full_name: repo.full_name };
      if (repo.id) body.github_repo_id = repo.id;
      if (installationId) body.github_installation_id = installationId;
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/connect-repo`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to connect");
      onConnected?.(repo.full_name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(null);
    }
  };

  const startAppInstall = () => {
    if (!workspaceId) return;
    window.location.href = `${API_BASE}/auth/github-app/install?workspaceId=${encodeURIComponent(workspaceId)}`;
  };

  const startOAuth = async () => {
    if (!workspaceId) return;
    setError(null);
    if (supabase) {
      const redirectTo = `${window.location.origin}?github-connect=1&workspaceId=${encodeURIComponent(workspaceId)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo,
          scopes: "read:user user:email repo",
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        return;
      }
      return;
    }
    window.location.href = `${API_BASE}/auth/github-connect?workspaceId=${encodeURIComponent(workspaceId)}`;
  };

  const showRepoList = (installationId != null && installationId > 0) || !!(oauthState && workspaceId);
  const appReady = appConfig?.configured !== false;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "relative",
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          width: "min(440px, 94vw)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #30363d",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>Collaborate · GitHub</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!showRepoList ? (
            <div>
              <p style={{ fontSize: 12, color: "#8b949e", marginBottom: 12, lineHeight: 1.5 }}>
                Install <strong style={{ color: "#e6edf3" }}>Blanko-Lab</strong> on the repo so
                webhooks can fill Rollup last-change. Linking a repo is separate from App install —
                both are needed for live activity.
              </p>
              <button
                type="button"
                onClick={startAppInstall}
                disabled={!workspaceId || !appReady}
                data-testid="connect-install-blanko-lab"
                style={{
                  padding: "10px 16px",
                  background: "#238636",
                  border: "none",
                  borderRadius: 6,
                  color: "white",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: workspaceId && appReady ? "pointer" : "not-allowed",
                  width: "100%",
                  marginBottom: 10,
                }}
              >
                Install Blanko-Lab →
              </button>
              <button
                type="button"
                onClick={startOAuth}
                disabled={!workspaceId}
                style={{
                  padding: "8px 12px",
                  background: "transparent",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  color: "#8b949e",
                  fontSize: 11,
                  cursor: workspaceId ? "pointer" : "not-allowed",
                  width: "100%",
                }}
              >
                List repos via GitHub login (identity only)
              </button>
              {appConfig && !appConfig.configured && (
                <p style={{ fontSize: 11, color: "#f85149", marginTop: 10 }}>
                  GitHub App is not configured on the server (GITHUB_APP_*).
                </p>
              )}
            </div>
          ) : (
            <>
              {installationId ? (
                <p style={{ fontSize: 11, color: "#3fb950", marginBottom: 10 }}>
                  Installed · pick a repo to link this workspace
                </p>
              ) : (
                <p style={{ fontSize: 11, color: "#8b949e", marginBottom: 10 }}>
                  Linked list from GitHub login — install Blanko-Lab for webhooks
                </p>
              )}
              {error && (
                <div
                  style={{
                    padding: 8,
                    background: "rgba(248,81,73,0.15)",
                    border: "1px solid #f85149",
                    borderRadius: 6,
                    color: "#f85149",
                    fontSize: 12,
                    marginBottom: 12,
                  }}
                >
                  {error}
                </div>
              )}
              {loading ? (
                <div style={{ color: "#8b949e", fontSize: 12 }}>Loading repositories…</div>
              ) : repos.length === 0 ? (
                <div style={{ color: "#8b949e", fontSize: 12 }}>
                  No repositories found for this installation. Grant access to the repo in GitHub
                  App settings, then retry.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {repos.slice(0, 50).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleConnect(r)}
                      disabled={connecting !== null}
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        background: "transparent",
                        border: "1px solid #30363d",
                        borderRadius: 6,
                        color: "#e6edf3",
                        fontSize: 12,
                        cursor: connecting ? "not-allowed" : "pointer",
                      }}
                    >
                      {r.full_name}
                      {r.private && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: "#8b949e" }}>private</span>
                      )}
                      {connecting === r.full_name && " …"}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
