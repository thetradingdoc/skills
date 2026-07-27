import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, getSupabaseConfigError } from "./supabaseClient";
import { MemoriesPanel } from "./MemoriesPanel";

const API_BASE = "/api";

type Phase1Status = "todo" | "in_progress" | "needs_review" | "done";

type SessionLogEntry = {
  ts: string;
  type: string;
  payload?: Record<string, unknown>;
};

type SoloTask = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  context?: string | null;
  constraints?: string | null;
  acceptance_criteria?: { functional?: string[]; technical?: string[] } | null;
  file_scope?: string[] | null;
  session_log?: SessionLogEntry[];
  rail_id?: string | null;
};

const STATUS_LABELS: Record<Phase1Status, string> = {
  todo: "Todo",
  in_progress: "In progress",
  needs_review: "Needs review",
  done: "Done",
};

const STATUS_COLORS: Record<Phase1Status, string> = {
  todo: "#7d8590",
  in_progress: "#d29922",
  needs_review: "#58a6ff",
  done: "#3fb950",
};

function SessionLogEntryView({ e }: { e: SessionLogEntry }) {
  const p = e.payload ?? {};
  if (e.type === "ready_to_review") {
    const files = Array.isArray(p.files_changed) ? (p.files_changed as string[]) : [];
    return (
      <div
        style={{
          marginTop: 6,
          padding: 10,
          background: "#132f1a",
          border: "1px solid #238636",
          borderRadius: 6,
        }}
      >
        <div style={{ fontWeight: 600, color: "#3fb950", marginBottom: 6 }}>
          Ready to review
          {p.verificationPassed === false ? " (verification had issues)" : ""}
        </div>
        <div style={{ color: "#e6edf3", marginBottom: 6 }}>
          {typeof p.summary === "string" ? p.summary : "Changes in sandbox."}
        </div>
        {files.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, color: "#adbac7" }}>
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (e.type === "tool_call") {
    const file = typeof p.filePath === "string" ? p.filePath : null;
    const msg = typeof p.message === "string" ? p.message : "Tool call";
    return (
      <div style={{ marginTop: 4, color: "#adbac7" }}>
        {file ? (
          <>
            <span style={{ color: "#58a6ff" }}>{file}</span>
            <span style={{ color: "#7d8590" }}> — {msg}</span>
          </>
        ) : (
          msg
        )}
      </div>
    );
  }
  if (e.type === "started") {
    return (
      <div style={{ marginTop: 4, color: "#adbac7" }}>
        Agent run started
        {typeof p.title === "string" ? `: ${p.title}` : ""}
      </div>
    );
  }
  if (e.type === "rejected") {
    return (
      <div style={{ marginTop: 4, color: "#f85149" }}>
        Rejected — returned to {String(p.backTo ?? "todo")}
        {p.cleared_rail_id ? " (new run will create a fresh rail)" : ""}
      </div>
    );
  }
  if (e.type === "error") {
    return (
      <div style={{ marginTop: 4, color: "#f85149" }}>
        {typeof p.message === "string" ? p.message : "Error"}
      </div>
    );
  }
  if (e.type === "approved") {
    return <div style={{ marginTop: 4, color: "#3fb950" }}>Approved and applied to project.</div>;
  }
  if (typeof p.message === "string") {
    return <div style={{ marginTop: 4, color: "#adbac7" }}>{p.message}</div>;
  }
  if (typeof p.summary === "string") {
    return <div style={{ marginTop: 4, color: "#adbac7" }}>{p.summary}</div>;
  }
  return null;
}

function normalizeStatus(s: string): Phase1Status {
  if (s === "pending") return "todo";
  if (s === "completed") return "done";
  if (COLUMNS.some((c) => c.key === s)) return s as Phase1Status;
  return "todo";
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0d1117",
    color: "#e6edf3",
    fontFamily: "system-ui, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    padding: "12px 20px",
    borderBottom: "1px solid #30363d",
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  main: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "1fr 1.1fr 320px",
    gap: 0,
    minHeight: 0,
  },
  col: {
    borderRight: "1px solid #30363d",
    padding: 12,
    overflow: "auto",
  },
};

export function SoloWorkspace() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [tasks, setTasks] = useState<SoloTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMemories, setShowMemories] = useState(false);

  const [formTitle, setFormTitle] = useState("");
  const [formContext, setFormContext] = useState("");
  const [formConstraints, setFormConstraints] = useState("");
  const [formAcceptance, setFormAcceptance] = useState("");
  const [formFileScope, setFormFileScope] = useState("");

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId]
  );

  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    }),
    [accessToken]
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAccessToken(session?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const bootstrap = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    const res = await fetch(`${API_BASE}/solo/workspace`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load workspace");
    setWorkspaceId(data.workspace.id);
    setWorkspaceName(data.workspace.name ?? "Solo");
  }, [accessToken]);

  const loadTasks = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    const res = await fetch(
      `${API_BASE}/todos?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load tasks");
    setTasks(
      (data.todos ?? []).map((t: Record<string, unknown>) => ({
        id: String(t.id),
        title: String(t.title ?? ""),
        description: t.description as string | null,
        status: normalizeStatus(String(t.status ?? "todo")),
        context: t.context as string | null,
        constraints: t.constraints as string | null,
        acceptance_criteria: t.acceptance_criteria as SoloTask["acceptance_criteria"],
        file_scope: t.file_scope as string[] | null,
        session_log: Array.isArray(t.session_log) ? (t.session_log as SessionLogEntry[]) : [],
        rail_id: t.rail_id as string | null,
      }))
    );
  }, [accessToken, workspaceId]);

  useEffect(() => {
    bootstrap().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [bootstrap]);

  useEffect(() => {
    loadTasks().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [loadTasks]);

  useEffect(() => {
    if (!selected) return;
    setFormTitle(selected.title);
    setFormContext(selected.context ?? "");
    setFormConstraints(selected.constraints ?? "");
    const ac = selected.acceptance_criteria;
    const lines = [
      ...(ac?.functional ?? []),
      ...(ac?.technical ?? []),
    ];
    setFormAcceptance(lines.join("\n"));
    setFormFileScope((selected.file_scope ?? []).join("\n"));
  }, [selected?.id]);

  const refreshSelectedTask = useCallback(async (todoId?: string) => {
    const id = todoId ?? selected?.id;
    if (!id || !accessToken) return;
    const res = await fetch(`${API_BASE}/todos/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || !data.todo) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.todo.id
          ? {
              ...t,
              status: normalizeStatus(data.todo.status),
              session_log: Array.isArray(data.todo.session_log)
                ? data.todo.session_log
                : t.session_log,
              rail_id: data.todo.rail_id ?? t.rail_id,
            }
          : t
      )
    );
  }, [selected?.id, accessToken]);

  useEffect(() => {
    if (!selected || !accessToken) return;
    const st = normalizeStatus(selected.status);
    if (st !== "in_progress" && st !== "needs_review") return;

    void refreshSelectedTask();
    if (st !== "in_progress") return;

    const iv = setInterval(() => void refreshSelectedTask(), 3000);
    return () => clearInterval(iv);
  }, [selected?.id, selected?.status, accessToken, refreshSelectedTask]);

  const handleSignIn = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError(null);
    const { error: e } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });
    setAuthBusy(false);
    if (e) setAuthError(e.message);
  };

  const parseAcceptance = (text: string) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? { functional: lines, technical: [] as string[] } : null;
  };

  const parseFileScope = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  const saveTask = async () => {
    if (!accessToken || !workspaceId || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/todos/${selected.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formContext.trim() || null,
          context: formContext.trim() || null,
          constraints: formConstraints.trim() || null,
          acceptanceCriteria: parseAcceptance(formAcceptance),
          fileScope: parseFileScope(formFileScope),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createTask = async () => {
    if (!accessToken || !workspaceId || !formTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/todos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          workspaceId,
          title: formTitle.trim(),
          context: formContext.trim() || null,
          constraints: formConstraints.trim() || null,
          acceptanceCriteria: parseAcceptance(formAcceptance),
          fileScope: parseFileScope(formFileScope),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      await loadTasks();
      if (data.todo?.id) setSelectedId(data.todo.id);
      setFormTitle("");
      setFormContext("");
      setFormConstraints("");
      setFormAcceptance("");
      setFormFileScope("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTask = async () => {
    if (!accessToken || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/todos/${selected.id}/run`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed");
      await loadTasks();
      if (data.todo?.id) {
        setSelectedId(data.todo.id);
        void refreshSelectedTask(data.todo.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const approveTask = async () => {
    if (!accessToken || !selected) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/todos/${selected.id}/approve`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Approve failed");
      await loadTasks();
      if (selected?.id) void refreshSelectedTask(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rejectTask = async () => {
    if (!accessToken || !selected) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/todos/${selected.id}/reject`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ backTo: "todo" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reject failed");
      await loadTasks();
      if (selected?.id) void refreshSelectedTask(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const configErr = getSupabaseConfigError();

  if (configErr) {
    return (
      <div style={{ ...styles.page, padding: 24 }}>
        <p>{configErr}</p>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div style={{ ...styles.page, alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 360, padding: 24 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Solo agent workspace</h1>
          <p style={{ color: "#7d8590", marginBottom: 16, fontSize: 14 }}>
            Sign in to create tasks, run the agent, and approve changes.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            style={{ width: "100%", marginBottom: 8, padding: 8, boxSizing: "border-box" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            style={{ width: "100%", marginBottom: 8, padding: 8, boxSizing: "border-box" }}
          />
          {authError && <p style={{ color: "#f85149", fontSize: 13 }}>{authError}</p>}
          <button
            type="button"
            onClick={handleSignIn}
            disabled={authBusy}
            style={{ padding: "8px 16px", marginTop: 8 }}
          >
            {authBusy ? "Signing in…" : "Sign in"}
          </button>
          <p style={{ marginTop: 16, fontSize: 12, color: "#7d8590" }}>
            <a href="/" style={{ color: "#58a6ff" }}>
              Full app
            </a>
          </p>
        </div>
      </div>
    );
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Phase1Status[] = ["needs_review", "in_progress", "todo", "done"];
    return order.indexOf(normalizeStatus(a.status)) - order.indexOf(normalizeStatus(b.status));
  });

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <strong style={{ fontSize: 16 }}>{workspaceName}</strong>
        <span style={{ color: "#7d8590", fontSize: 13 }}>Phase 1 solo loop</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowMemories((v) => !v)} style={{ fontSize: 13 }}>
          {showMemories ? "Hide memories" : "Memories"}
        </button>
        <a href="/" style={{ color: "#58a6ff", fontSize: 13 }}>
          Full app
        </a>
      </header>
      {error && (
        <div style={{ padding: "8px 20px", background: "#3d130f", color: "#f85149", fontSize: 13 }}>
          {error}
        </div>
      )}
      <div
        style={{
          ...styles.main,
          gridTemplateColumns: showMemories ? "1fr 1.1fr 280px 300px" : "1fr 1.1fr 300px",
        }}
      >
        <div style={styles.col}>
          <h2 style={{ fontSize: 14, margin: "0 0 10px" }}>Tasks ({tasks.length})</h2>
          {sortedTasks.length === 0 && (
            <p style={{ color: "#7d8590", fontSize: 13 }}>No tasks yet.</p>
          )}
          {sortedTasks.map((t) => {
            const st = normalizeStatus(t.status);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 8,
                  padding: "10px 12px",
                  background: selectedId === t.id ? "#21262d" : "#161b22",
                  border:
                    selectedId === t.id ? "1px solid #58a6ff" : "1px solid #30363d",
                  borderRadius: 6,
                  color: "#e6edf3",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: STATUS_COLORS[st],
                    background: "#0d1117",
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: `1px solid ${STATUS_COLORS[st]}`,
                  }}
                >
                  {STATUS_LABELS[st]}
                </span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>{t.title}</span>
              </button>
            );
          })}
        </div>

        <div style={styles.col}>
          <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>
            {selected ? "Edit task" : "New task"}
          </h2>
          <label style={{ fontSize: 11, color: "#7d8590" }}>Title</label>
          <input
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            style={{ width: "100%", marginBottom: 10, padding: 8, boxSizing: "border-box" }}
          />
          <label style={{ fontSize: 11, color: "#7d8590" }}>Context</label>
          <textarea
            value={formContext}
            onChange={(e) => setFormContext(e.target.value)}
            rows={3}
            style={{ width: "100%", marginBottom: 10, padding: 8, boxSizing: "border-box" }}
          />
          <label style={{ fontSize: 11, color: "#7d8590" }}>Constraints</label>
          <textarea
            value={formConstraints}
            onChange={(e) => setFormConstraints(e.target.value)}
            rows={2}
            style={{ width: "100%", marginBottom: 10, padding: 8, boxSizing: "border-box" }}
          />
          <label style={{ fontSize: 11, color: "#7d8590" }}>Acceptance (one per line)</label>
          <textarea
            value={formAcceptance}
            onChange={(e) => setFormAcceptance(e.target.value)}
            rows={3}
            style={{ width: "100%", marginBottom: 10, padding: 8, boxSizing: "border-box" }}
          />
          <label style={{ fontSize: 11, color: "#7d8590" }}>File scope (one per line)</label>
          <textarea
            value={formFileScope}
            onChange={(e) => setFormFileScope(e.target.value)}
            rows={2}
            style={{ width: "100%", marginBottom: 12, padding: 8, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!selected && (
              <button type="button" onClick={createTask} disabled={busy || !formTitle.trim()}>
                Create task
              </button>
            )}
            {selected && (
              <button type="button" onClick={saveTask} disabled={busy}>
                Save
              </button>
            )}
            {selected && normalizeStatus(selected.status) === "todo" && (
              <button type="button" onClick={runTask} disabled={busy}>
                Run agent
              </button>
            )}
            {selected && normalizeStatus(selected.status) === "needs_review" && (
              <>
                <button type="button" onClick={approveTask} disabled={busy}>
                  Approve
                </button>
                <button type="button" onClick={rejectTask} disabled={busy}>
                  Reject
                </button>
              </>
            )}
          </div>
          {selected?.rail_id && (
            <p style={{ fontSize: 11, color: "#7d8590", marginTop: 12 }}>
              Rail: {selected.rail_id}
            </p>
          )}
        </div>

        <div style={{ ...styles.col, borderRight: showMemories ? undefined : "none" }}>
          <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Session log</h2>
          {!selected && (
            <p style={{ color: "#7d8590", fontSize: 13 }}>Select a task to see its log.</p>
          )}
          {selected && (
            <div style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
              {(selected.session_log ?? []).length === 0 && (
                <p style={{ color: "#7d8590" }}>No events yet.</p>
              )}
              {(selected.session_log ?? []).map((e, i) => (
                <div
                  key={`${e.ts}-${i}`}
                  style={{
                    marginBottom: 10,
                    paddingBottom: 10,
                    borderBottom: "1px solid #21262d",
                  }}
                >
                  <div style={{ color: "#7d8590", fontSize: 11 }}>
                    {new Date(e.ts).toLocaleString()} ·{" "}
                    <strong style={{ color: "#58a6ff" }}>{e.type}</strong>
                  </div>
                  <SessionLogEntryView e={e} />
                </div>
              ))}
            </div>
          )}
        </div>

        {showMemories && workspaceId && (
          <div style={{ ...styles.col, borderRight: "none", overflow: "auto" }}>
            <MemoriesPanel workspaceId={workspaceId} accessToken={accessToken} graph={null} />
          </div>
        )}
      </div>
    </div>
  );
}
