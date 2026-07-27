import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api";

interface Member {
  id: string;
  user_id: string;
  role: string;
  displayName: string;
  invited_at?: string;
}

interface Props {
  workspaceId: string | null;
  accessToken: string | null;
  isOwner: boolean;
  onClose: () => void;
}

export function WorkspaceMembersPanel({
  workspaceId,
  accessToken,
  isOwner,
  onClose,
}: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviting, setInviting] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!accessToken || !workspaceId) {
      setMembers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/members`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load members");
      setMembers(data.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleInvite = async () => {
    if (!accessToken || !workspaceId || !inviteEmail.trim() || !isOwner) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invite failed");
      setInviteEmail("");
      fetchMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateRole = async (memberId: string, role: "editor" | "viewer") => {
    if (!accessToken || !workspaceId || !isOwner) return;
    setUpdatingRole(memberId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      fetchMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleRemove = async (memberId: string, userId: string) => {
    if (!accessToken || !workspaceId) return;
    setRemoving(memberId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/members/${memberId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Remove failed");
      fetchMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemoving(null);
    }
  };

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
          maxHeight: "85vh",
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
          <span style={{ fontWeight: 600, fontSize: 14 }}>Workspace members</span>
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

          {isOwner && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
                Invite by email
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    color: "#e6edf3",
                    fontSize: 12,
                  }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "editor" | "viewer")
                  }
                  style={{
                    padding: "8px 10px",
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    color: "#e6edf3",
                    fontSize: 12,
                  }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  style={{
                    padding: "8px 12px",
                    background: "#238636",
                    border: "none",
                    borderRadius: 6,
                    color: "white",
                    fontSize: 12,
                    cursor: inviting || !inviteEmail.trim() ? "not-allowed" : "pointer",
                    opacity: inviting || !inviteEmail.trim() ? 0.6 : 1,
                  }}
                >
                  {inviting ? "…" : "Invite"}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: "#8b949e", fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {members.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "#0d1117",
                    borderRadius: 6,
                    border: "1px solid #21262d",
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 12 }}>
                      {m.displayName}
                    </span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        color: "#8b949e",
                        textTransform: "capitalize",
                      }}
                    >
                      {m.role}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isOwner && m.role !== "owner" && (
                      <>
                        <select
                          value={m.role}
                          onChange={(e) =>
                            handleUpdateRole(
                              m.id,
                              e.target.value as "editor" | "viewer"
                            )
                          }
                          disabled={updatingRole === m.id}
                          style={{
                            padding: "4px 8px",
                            background: "#21262d",
                            border: "1px solid #30363d",
                            borderRadius: 4,
                            color: "#e6edf3",
                            fontSize: 11,
                          }}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemove(m.id, m.user_id)}
                          disabled={removing === m.id}
                          title="Remove member"
                          style={{
                            padding: "4px 8px",
                            background: "transparent",
                            border: "1px solid #f85149",
                            borderRadius: 4,
                            color: "#f85149",
                            fontSize: 11,
                            cursor: removing === m.id ? "not-allowed" : "pointer",
                          }}
                        >
                          {removing === m.id ? "…" : "Remove"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
