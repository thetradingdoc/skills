import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api";

interface Memory {
  id?: string;
  workspace_id?: string;
  node_id?: string | null;
  content?: string | null;
  memory_type?: string | null;
  created_at?: string | null;
}

interface Props {
  workspaceId: string | null;
  accessToken: string | null;
  graph?: { nodes?: Array<{ id: string; suggestedLabel?: string; label?: string }> } | null;
}

export function MemoriesPanel({
  workspaceId,
  accessToken,
  graph,
}: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [addingMemory, setAddingMemory] = useState(false);
  const [userMemories, setUserMemories] = useState<Array<{ id: string; content: string; created_at?: string }>>([]);
  const [savingAsPreference, setSavingAsPreference] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    if (!accessToken || !workspaceId) {
      setMemories([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/memories?limit=200`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load memories");
      setMemories(data.memories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const nodeLabel = (nodeId: string) => {
    const n = graph?.nodes?.find((x) => x.id === nodeId);
    return n?.suggestedLabel ?? n?.label ?? nodeId;
  };

  const handleEdit = (m: Memory) => {
    setEditingId(m.id ?? null);
    setEditContent(m.content ?? "");
  };

  const handleSaveEdit = async () => {
    if (!accessToken || !workspaceId || !editingId) return;
    setSaving(true);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/memories/${editingId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: editContent }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      setMemories((prev) =>
        prev.map((x) => (x.id === editingId ? { ...x, content: editContent } : x))
      );
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (memoryId: string) => {
    if (!accessToken || !workspaceId) return;
    if (!confirm("Delete this memory?")) return;
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/memories/${memoryId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete");
      }
      setMemories((prev) => prev.filter((x) => x.id !== memoryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const fetchUserMemories = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/user/memories`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setUserMemories(data.memories ?? []);
    } catch {
      setUserMemories([]);
    }
  }, [accessToken]);
  useEffect(() => {
    fetchUserMemories();
  }, [fetchUserMemories]);

  const handleAddMemory = async () => {
    const content = newMemoryContent.trim();
    if (!accessToken || !workspaceId || !content) return;
    setAddingMemory(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: content.slice(0, 5000), nodeId: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setMemories((prev) => [data.memory, ...prev]);
      setNewMemoryContent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setAddingMemory(false);
    }
  };

  const handleSaveAsPreference = async (content: string) => {
    if (!accessToken) return;
    setSavingAsPreference(content.slice(0, 20));
    try {
      const res = await fetch(`${API_BASE}/user/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: content.slice(0, 2000), memory_type: "user_preference" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      await fetchUserMemories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save as preference");
    } finally {
      setSavingAsPreference(null);
    }
  };

  if (!accessToken) {
    return (
      <p style={{ color: "#64748b", fontSize: 12 }}>
        Sign in to view workspace memories.
      </p>
    );
  }
  if (!workspaceId) {
    return (
      <p style={{ color: "#64748b", fontSize: 12 }}>
        Load a workspace to view its memories.
      </p>
    );
  }
  if (loading) {
    return <p style={{ color: "#64748b", fontSize: 12 }}>Loading memories…</p>;
  }
  if (error) {
    return (
      <p style={{ color: "#ef4444", fontSize: 12 }}>{error}</p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ padding: 8, background: "#1e293b", borderRadius: 8, border: "1px solid #334155" }}>
        <p style={{ color: "#64748b", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>
          Remember this
        </p>
        <textarea
          value={newMemoryContent}
          onChange={(e) => setNewMemoryContent(e.target.value)}
          placeholder="Save an insight for this workspace…"
          rows={2}
          style={{
            width: "100%",
            padding: 8,
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#e2e8f0",
            fontSize: 11,
            resize: "vertical",
          }}
        />
        <button
          onClick={handleAddMemory}
          disabled={addingMemory || !newMemoryContent.trim()}
          style={{
            marginTop: 6,
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#238636",
            color: "white",
            fontSize: 11,
            cursor: addingMemory || !newMemoryContent.trim() ? "not-allowed" : "pointer",
          }}
        >
          {addingMemory ? "Saving…" : "Save"}
        </button>
      </div>
      {userMemories.length > 0 && (
        <div style={{ marginBottom: 8, padding: 8, background: "#1e293b", borderRadius: 8, border: "1px solid #334155" }}>
          <p style={{ color: "#64748b", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>
            Your preferences (apply across projects)
          </p>
          {userMemories.slice(0, 5).map((m) => (
            <div key={m.id} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
              {(m.content ?? "").slice(0, 120)}
              {(m.content?.length ?? 0) > 120 ? "…" : ""}
            </div>
          ))}
        </div>
      )}
      <p style={{ color: "#94a3b8", fontSize: 11 }}>
        {memories.length} saved insight{memories.length !== 1 ? "s" : ""}. Edit or delete below.
      </p>
      {memories.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: 12 }}>
          No memories yet. Ask the AI about your architecture; high-quality answers are saved automatically.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflowY: "auto",
            maxHeight: 360,
          }}
        >
          {memories.map((m, i) => (
            <div
              key={m.id ?? i}
              style={{
                padding: 12,
                background: "#1e293b",
                borderRadius: 8,
                border: "1px solid #334155",
                fontSize: 11,
              }}
            >
              {m.node_id && (
                <div
                  style={{
                    color: "#64748b",
                    marginBottom: 6,
                    fontSize: 10,
                  }}
                >
                  Node: {nodeLabel(m.node_id)}
                </div>
              )}
              {editingId === m.id ? (
                <>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={{
                      width: "100%",
                      minHeight: 80,
                      padding: 8,
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      color: "#e2e8f0",
                      fontSize: 11,
                      resize: "vertical",
                    }}
                    placeholder="Memory content"
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 6,
                        border: "1px solid #334155",
                        background: "#238636",
                        color: "white",
                        fontSize: 11,
                        cursor: saving ? "not-allowed" : "pointer",
                      }}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditContent("");
                      }}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 6,
                        border: "1px solid #334155",
                        background: "transparent",
                        color: "#94a3b8",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: "#e2e8f0",
                    }}
                  >
                    {(m.content ?? "").slice(0, 500)}
                    {(m.content?.length ?? 0) > 500 && "…"}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleEdit(m)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid #334155",
                        background: "transparent",
                        color: "#94a3b8",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => m.content && handleSaveAsPreference(m.content)}
                      disabled={!!savingAsPreference}
                      title="Save as preference (applies across all projects)"
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid #334155",
                        background: "transparent",
                        color: "#64748b",
                        fontSize: 10,
                        cursor: savingAsPreference ? "not-allowed" : "pointer",
                      }}
                    >
                      {savingAsPreference ? "…" : "Save as preference"}
                    </button>
                    <button
                      onClick={() => m.id && handleDelete(m.id)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid #475569",
                        background: "transparent",
                        color: "#94a3b8",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
