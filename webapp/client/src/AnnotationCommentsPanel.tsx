import React, { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = "/api";

interface WorkspaceMember {
  id: string;
  user_id: string;
  role: string;
  displayName?: string;
}

interface Comment {
  id: string;
  parent_id?: string | null;
  author_id?: string | null;
  author_name?: string | null;
  content: string;
  created_at: string;
  updated_at?: string;
}

interface Props {
  workspaceId: string | null;
  annotationId: string | null;
  accessToken: string | null;
  onClose: () => void;
}

function buildThreads(comments: Comment[]): Array<Comment & { replies?: Comment[] }> {
  const byId = new Map<string, Comment & { replies?: Comment[] }>();
  for (const c of comments) {
    byId.set(c.id, { ...c, replies: [] });
  }
  const roots: Array<Comment & { replies?: Comment[] }> = [];
  for (const c of comments) {
    const node = byId.get(c.id)!;
    if (!c.parent_id) {
      roots.push(node);
    } else {
      const parent = byId.get(c.parent_id);
      if (parent) (parent.replies ??= []).push(node);
      else roots.push(node);
    }
  }
  roots.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const r of roots) {
    (r.replies ?? []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return roots;
}

/** Renders content with @mentions highlighted. */
function renderContentWithMentions(content: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /@([\w.-]+)/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      parts.push(content.slice(lastIndex, m.index));
    }
    parts.push(
      <span
        key={`${m.index}-${m[1]}`}
        style={{ color: "#58a6ff", fontWeight: 500 }}
        title={`Mention @${m[1]}`}
      >
        @{m[1]}
      </span>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return parts.length > 0 ? <>{parts}</> : content;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function AnnotationCommentsPanel({
  workspaceId,
  annotationId,
  accessToken,
  onClose,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [mentionSelection, setMentionSelection] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionDropdownRef = useRef<HTMLDivElement | null>(null);

  const fetchComments = useCallback(async () => {
    if (!accessToken || !workspaceId || !annotationId) {
      setComments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/annotations/${annotationId}/comments`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load comments");
      setComments(data.comments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId, annotationId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const fetchMembers = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/members`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (res.ok) setMembers(data.members ?? []);
    } catch {
      /* ignore */
    }
  }, [accessToken, workspaceId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const mentionHandle = (m: WorkspaceMember) =>
    (m.displayName ?? m.user_id.slice(0, 8)).replace(/\s+/g, "").slice(0, 32) || m.user_id.slice(0, 8);

  const filteredMentionTargets = mentionFilter
    ? members.filter((m) => mentionHandle(m).toLowerCase().includes(mentionFilter.toLowerCase()))
    : [];

  const insertMention = useCallback(
    (displayName: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const before = newContent.slice(0, start);
      const after = newContent.slice(start);
      const atMatch = before.match(/@(\w*)$/);
      const insertStart = atMatch ? start - atMatch[0].length : start;
      const inserted = (before.slice(0, insertStart) + `@${displayName} ` + before.slice(insertStart)).trimStart() + after;
      setNewContent(inserted);
      setMentionFilter(null);
      setMentionSelection(0);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(insertStart + displayName.length + 2, insertStart + displayName.length + 2);
      }, 0);
    },
    [newContent]
  );

  const handleContentChange = useCallback((value: string, caret?: number) => {
    setNewContent(value);
    const pos = caret ?? textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1] || "");
      setMentionSelection(0);
    } else {
      setMentionFilter(null);
    }
  }, []);

  useEffect(() => {
    if (!mentionFilter || filteredMentionTargets.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelection((s) => Math.min(s + 1, filteredMentionTargets.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelection((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter" && filteredMentionTargets[mentionSelection]) {
        e.preventDefault();
        insertMention(mentionHandle(filteredMentionTargets[mentionSelection]!));
      } else if (e.key === "Escape") {
        setMentionFilter(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mentionFilter, filteredMentionTargets, mentionSelection, insertMention]);

  const handleSubmit = async (parentId?: string | null) => {
    if (!accessToken || !workspaceId || !annotationId || !newContent.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: { content: string; parent_id?: string } = { content: newContent.trim() };
      if (parentId) body.parent_id = parentId;
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/annotations/${annotationId}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add comment");
      setNewContent("");
      setReplyToId(null);
      setMentionFilter(null);
      fetchComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  };

  if (!annotationId) return null;

  const threads = buildThreads(comments);

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
          width: "min(400px, 94vw)",
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
          <span style={{ fontWeight: 600, fontSize: 14 }}>Comments</span>
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

          {loading ? (
            <div style={{ color: "#8b949e", fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {threads.map((t) => (
                <div key={t.id}>
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#0d1117",
                      borderRadius: 6,
                      border: "1px solid #21262d",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
                      {t.author_name ?? "Unknown"} · {formatTime(t.created_at)}
                    </div>
                    <div style={{ fontSize: 12, color: "#e6edf3", whiteSpace: "pre-wrap" }}>
                      {renderContentWithMentions(t.content)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyToId(replyToId === t.id ? null : t.id)}
                      style={{
                        marginTop: 6,
                        background: "none",
                        border: "none",
                        color: "#58a6ff",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Reply
                    </button>
                    {(t.replies ?? []).map((r) => (
                      <div
                        key={r.id}
                        style={{
                          marginTop: 8,
                          marginLeft: 12,
                          padding: "8px 10px",
                          background: "#161b22",
                          borderRadius: 4,
                          borderLeft: "2px solid #30363d",
                        }}
                      >
                        <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 2 }}>
                          {r.author_name ?? "Unknown"} · {formatTime(r.created_at)}
                        </div>
                        <div style={{ fontSize: 11, color: "#e6edf3", whiteSpace: "pre-wrap" }}>
                          {renderContentWithMentions(r.content)}
                        </div>
                      </div>
                    ))}
                    {replyToId === t.id && (
                      <div style={{ marginTop: 8, marginLeft: 12 }}>
                        <div style={{ position: "relative" }}>
                          <textarea
                            ref={textareaRef}
                            value={newContent}
                            onChange={(e) => handleContentChange(e.target.value, e.target.selectionStart)}
                            placeholder="Write a reply… (type @ to mention)"
                          rows={2}
                          style={{
                            width: "100%",
                            padding: 8,
                            background: "#0d1117",
                            border: "1px solid #30363d",
                            borderRadius: 6,
                            color: "#e6edf3",
                            fontSize: 12,
                            resize: "vertical",
                          }}
                          />
                          {mentionFilter !== null && (
                            <div
                              ref={mentionDropdownRef}
                              style={{
                                position: "absolute",
                                bottom: "100%",
                                left: 0,
                                marginBottom: 4,
                                background: "#0d1117",
                                border: "1px solid #30363d",
                                borderRadius: 6,
                                maxHeight: 120,
                                overflow: "auto",
                                zIndex: 10,
                              }}
                            >
                              {filteredMentionTargets.slice(0, 5).map((m, i) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => insertMention(mentionHandle(m))}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "6px 10px",
                                    background: i === mentionSelection ? "#1f6feb" : "transparent",
                                    border: "none",
                                    color: "#e6edf3",
                                    fontSize: 11,
                                    textAlign: "left",
                                    cursor: "pointer",
                                  }}
                                >
                                  @{mentionHandle(m)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <button
                            type="button"
                            onClick={() => handleSubmit(t.id)}
                            disabled={submitting || !newContent.trim()}
                            style={{
                              padding: "6px 12px",
                              background: "#238636",
                              border: "none",
                              borderRadius: 6,
                              color: "white",
                              fontSize: 11,
                              cursor: submitting || !newContent.trim() ? "not-allowed" : "pointer",
                            }}
                          >
                            {submitting ? "…" : "Reply"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setReplyToId(null); setNewContent(""); }}
                            style={{
                              padding: "6px 12px",
                              background: "transparent",
                              border: "1px solid #30363d",
                              borderRadius: 6,
                              color: "#8b949e",
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!replyToId && (
            <div style={{ marginTop: 16, position: "relative" }}>
              <textarea
                ref={textareaRef}
                value={newContent}
                onChange={(e) => handleContentChange(e.target.value, e.target.selectionStart)}
                placeholder="Add a comment… (type @ to mention)"
                rows={3}
                style={{
                  width: "100%",
                  padding: 10,
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  color: "#e6edf3",
                  fontSize: 12,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              {mentionFilter !== null && (
                <div
                  ref={mentionDropdownRef}
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    marginBottom: 4,
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    maxHeight: 120,
                    overflow: "auto",
                    zIndex: 10,
                  }}
                >
                  {filteredMentionTargets.slice(0, 5).map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => insertMention(mentionHandle(m))}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "6px 10px",
                        background: i === mentionSelection ? "#1f6feb" : "transparent",
                        border: "none",
                        color: "#e6edf3",
                        fontSize: 11,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      @{mentionHandle(m)}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={submitting || !newContent.trim()}
                style={{
                  marginTop: 8,
                  padding: "8px 14px",
                  background: "#238636",
                  border: "none",
                  borderRadius: 6,
                  color: "white",
                  fontSize: 12,
                  cursor: submitting || !newContent.trim() ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "…" : "Add comment"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
