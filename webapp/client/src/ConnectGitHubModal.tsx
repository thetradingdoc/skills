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
}

export function ConnectGitHubModal({
  workspaceId,
  accessToken,
  onClose,
  onConnected,
  oauthState,
}: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
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
    if (oauthState && workspaceId) fetchRepos();
  }, [oauthState, workspaceId, fetchRepos]);

  const handleConnect = async (fullName: string) => {
    if (!accessToken || !workspaceId) return;
    setConnecting(fullName);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/connect-repo`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ github_full_name: fullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to connect");
      onConnected?.(fullName);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(null);
    }
  };

  const startOAuth = () => {
    if (!workspaceId) return;
    window.location.href = `${API_BASE}/auth/github-connect?workspaceId=${encodeURIComponent(workspaceId)}`;
  };

  const hasOAuthState = oauthState && workspaceId;

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
          width: "min(420px, 94vw)",
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
          <span style={{ fontWeight: 600, fontSize: 14 }}>Connect from GitHub</span>
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
          {!hasOAuthState ? (
            <div>
              <p style={{ fontSize: 12, color: "#8b949e", marginBottom: 12 }}>
                Connect this workspace to a GitHub repository from your account. This enables webhooks and PR integration.
              </p>
              <button
                type="button"
                onClick={startOAuth}
                disabled={!workspaceId}
                style={{
                  padding: "10px 16px",
                  background: "#238636",
                  border: "none",
                  borderRadius: 6,
                  color: "white",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: workspaceId ? "pointer" : "not-allowed",
                }}
              >
                Connect with GitHub →
              </button>
            </div>
          ) : (
            <>
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
                <div style={{ color: "#8b949e", fontSize: 12 }}>Loading your repositories…</div>
              ) : repos.length === 0 ? (
                <div style={{ color: "#8b949e", fontSize: 12 }}>No repositories found.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {repos.slice(0, 50).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleConnect(r.full_name)}
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
