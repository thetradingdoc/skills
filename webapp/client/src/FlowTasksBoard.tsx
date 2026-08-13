/**
 * Tasks Kanban (Epic U1) — Up next · In progress · Review.
 * Status map: todo | in_progress | needs_review | done; Issues = kind issue.
 * Default columns: Up next · In progress · Review; Completed / Issues behind toggle.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { AgentInventoryResult } from "./types";
import {
  ACCENT,
  BAD,
  CANVAS,
  FONT_MONO,
  FONT_UI,
  GOOD,
  INK,
  LINE,
  PAPER,
  WARN,
} from "./theme/tokens";
import { TRADING_PIPELINE_SEED } from "./flowTradingSeed";
import { canManualAdvanceTodo } from "./todoStatusGate";
import { isSpineRemediationTodo } from "./insightsTodo";

const INFO = "#2563EB";
const SLATE = "#64748B";
const FIRST_RUN_KEY = "blanko-work-firstrun-disclaimer-seen";

type SessionLogEntry = {
  at?: string;
  event?: string;
  type?: string;
  message?: string;
  files?: Array<{ path?: string; added?: number; removed?: number }>;
  summary?: string;
  railId?: string;
  [key: string]: unknown;
};

type TodoRow = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  kind?: string | null;
  agent_file?: string | null;
  layer_id?: string | null;
  assignee_label?: string | null;
  source?: string | null;
  source_path?: string | null;
  rail_id?: string | null;
  session_log?: SessionLogEntry[] | null;
  archived_at?: string | null;
};

type Props = {
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  agentFile?: string | null;
  agents?: AgentInventoryResult;
  onSelectAgent?: (file: string) => void;
  focusTodoId?: string | null;
  notice?: string | null;
  refreshKey?: number;
  onOpenFile?: (path: string) => void;
  fixAgentDisabledReason?: string | null;
  dockMaximized?: boolean;
  hasProjectRoot?: boolean;
  /** After Approve succeeds — parent refreshes badges / rollup (Epic 4). */
  onApproved?: (todoId: string) => void;
  /** Spine-gap todos should open Insights Apply spine, not agent Run. */
  onApplyTradingSpine?: () => void;
  onOpenInsights?: () => void;
};

type BoardFilter = "all" | "mine" | "blockers";
type BoardLane = "active" | "done" | "issues";

function formatAgentApiError(d: { error?: string; code?: string }, fallback: string): string {
  if (d.code === "AGENT_PLAN_REQUIRED") {
    return d.error ?? "Fix with agent requires Pro or Team.";
  }
  if (d.code === "AGENT_KEY_MISSING") {
    return d.error ?? "Agent API key not configured on the server.";
  }
  const msg = d.error ?? fallback;
  if (/Auto-execution limit/i.test(msg) || /execution limit/i.test(msg)) {
    return "Another agent is running in this workspace — wait or Reset.";
  }
  return msg;
}

function normalizeBoardStatus(status: string): string {
  if (status === "pending") return "todo";
  if (status === "completed") return "done";
  return status;
}

function sourceChipLabel(source: string | null | undefined): string {
  const s = (source ?? "").toLowerCase();
  if (s === "insights") return "Insights";
  if (s === "trading-spine" || s === "seed_spine") return "Seeded";
  if (s === "flow-path" || s === "import_from_path") return "Path";
  if (s === "dogfood") return "Dogfood";
  return "Manual";
}

function sourceChipColor(label: string): string {
  if (label === "Insights") return INFO;
  if (label === "Seeded") return ACCENT;
  if (label === "Path") return BAD;
  if (label === "Dogfood") return WARN;
  return SLATE;
}

function isDogfoodTodo(t: TodoRow): boolean {
  if ((t.source ?? "").toLowerCase() === "dogfood") return true;
  return /^\s*\[dogfood\]/i.test(t.title ?? "");
}

function isMineTodo(t: TodoRow): boolean {
  const a = (t.assignee_label ?? "").trim();
  if (!a) return true;
  return /^(cursor|me|you|blanko)$/i.test(a);
}

function isBlockerTodo(t: TodoRow): boolean {
  return t.kind === "issue" || (t.source ?? "").toLowerCase() === "insights";
}

function statusLine(t: TodoRow): string {
  if (t.kind === "issue") return "Flagged issue";
  if (isSpineRemediationTodo(t)) return "Apply trading spine in Insights";
  const s = normalizeBoardStatus(t.status);
  if (s === "todo") return "Ready to run";
  if (s === "in_progress") return hasSessionError(t) ? "Needs retry" : "In progress";
  if (s === "needs_review") return "Ready to approve";
  if (s === "done") return "Completed";
  return s;
}

const COLUMNS: Array<{
  id: string;
  title: string;
  tip: string;
  empty: string;
  match: (t: TodoRow) => boolean;
}> = [
  {
    id: "todo",
    title: "Up next",
    tip: INFO,
    empty: "No tasks yet.\nBlockers found during a scan will\nappear here automatically.",
    match: (t) => t.kind !== "issue" && (t.status === "todo" || t.status === "pending"),
  },
  {
    id: "doing",
    title: "In progress",
    tip: ACCENT,
    empty: "Nothing running.\nStart a task from Up next to put an agent to work.",
    match: (t) => t.kind !== "issue" && t.status === "in_progress",
  },
  {
    id: "tested",
    title: "Review",
    tip: WARN,
    empty: "Nothing to review.\nFinished agent runs land here for Approve.",
    match: (t) => t.kind !== "issue" && t.status === "needs_review",
  },
  {
    id: "done",
    title: "Completed",
    tip: GOOD,
    empty: "No completed work yet.\nApproved tasks show up here.",
    match: (t) => t.kind !== "issue" && (t.status === "done" || t.status === "completed"),
  },
  {
    id: "issues",
    title: "Issues",
    tip: BAD,
    empty: "No flagged issues.\nManually flagged problems land in this lane.",
    match: (t) => t.kind === "issue",
  },
];

const NEXT_STATUS: Record<string, string | null> = {
  todo: "in_progress",
  pending: "in_progress",
  in_progress: "needs_review",
  needs_review: "done",
  done: null,
};

const fileName = (f: string) => f.split(/[/\\]/).pop() || f;

function eventLabel(e: SessionLogEntry): string {
  const ev = e.event ?? e.type ?? "event";
  if (ev === "ready_to_review" && e.summary) return `Ready to review · ${e.summary}`;
  if (ev === "error" || ev === "verification_failed") {
    return `${ev}: ${e.message ?? "see log"}`;
  }
  return String(ev);
}

function hasSessionError(t: TodoRow): boolean {
  const log = Array.isArray(t.session_log) ? t.session_log : [];
  return log.some((e) => {
    const ev = e.event ?? e.type;
    return ev === "error" || ev === "verification_failed";
  });
}

function openPathsFromTodo(t: TodoRow): string[] {
  const paths: string[] = [];
  const log = Array.isArray(t.session_log) ? t.session_log : [];
  for (const e of [...log].reverse()) {
    for (const f of e.files ?? []) {
      if (f.path && !paths.includes(f.path)) paths.push(f.path);
    }
    if (paths.length >= 4) break;
  }
  if (t.agent_file && !paths.includes(t.agent_file)) paths.unshift(t.agent_file);
  return paths.slice(0, 4);
}

export function FlowTasksBoard({
  workspaceId,
  accessToken,
  apiBase = "",
  agentFile,
  agents,
  onSelectAgent,
  focusTodoId,
  notice,
  refreshKey = 0,
  onOpenFile,
  fixAgentDisabledReason,
  hasProjectRoot = false,
  onApproved,
  onApplyTradingSpine,
  onOpenInsights,
}: Props) {
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localAgent, setLocalAgent] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffTodoId, setDiffTodoId] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [entitlementLine, setEntitlementLine] = useState<string | null>(null);
  const [canUseAiAgent, setCanUseAiAgent] = useState<boolean | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [boardLane, setBoardLane] = useState<BoardLane>("active");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showDogfood, setShowDogfood] = useState(false);
  const [showFirstRunDisclaimer, setShowFirstRunDisclaimer] = useState(() => {
    try {
      return typeof window !== "undefined" && !window.localStorage.getItem(FIRST_RUN_KEY);
    } catch {
      return true;
    }
  });
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const surfaces = useMemo(
    () => (agents?.agents ?? []).filter((a) => a.kind === "agent"),
    [agents]
  );
  const picked = agentFile || localAgent || surfaces[0]?.file || "";

  const base = (apiBase || "/api").replace(/\/$/, "");
  const authed = !!(workspaceId && accessToken);

  const load = useCallback(async () => {
    if (!authed) return;
    setError(null);
    try {
      const q = new URLSearchParams({ workspaceId: workspaceId! });
      const r = await fetch(`${base}/todos?${q}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text.startsWith("<!") ? `Todos API ${r.status}` : text);
      }
      const d = await r.json();
      const all = ((d.todos ?? []) as TodoRow[]).filter((t) => !t.archived_at);
      setTodos(
        all.filter(
          (t) =>
            t.source === "insights" ||
            !t.agent_file ||
            !picked ||
            t.agent_file === picked
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [authed, workspaceId, accessToken, base, picked]);

  const loadEntitlements = useCallback(async () => {
    if (!accessToken) {
      setEntitlementLine(null);
      setCanUseAiAgent(null);
      return;
    }
    if (fixAgentDisabledReason) {
      setEntitlementLine(fixAgentDisabledReason);
      setCanUseAiAgent(fixAgentDisabledReason.includes("Pro") ? false : null);
      return;
    }
    try {
      const r = await fetch(`${base}/billing/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return;
      const d = (await r.json()) as {
        canUseAiAgent?: boolean;
        plan?: string;
        designMessageCredits?: number | null;
        entitlements?: { designMessageCredits?: number | null; canUseAiAgent?: boolean };
      };
      const canAgent = d.canUseAiAgent ?? d.entitlements?.canUseAiAgent ?? false;
      setCanUseAiAgent(canAgent);
      const credits = d.designMessageCredits ?? d.entitlements?.designMessageCredits;
      if (canAgent) {
        setEntitlementLine(`Agent: included (${d.plan ?? "Pro/Team"})`);
      } else if (typeof credits === "number") {
        setEntitlementLine(`Agent: Pro/Team · design credits left: ${credits}`);
      } else {
        setEntitlementLine("Agent: Pro/Team required to Fix");
      }
    } catch {
      /* best-effort */
    }
  }, [accessToken, base, fixAgentDisabledReason]);

  useEffect(() => {
    void load();
    void loadEntitlements();
  }, [load, loadEntitlements, refreshKey, notice]);

  useEffect(() => {
    if (focusTodoId) setExpandedId(focusTodoId);
  }, [focusTodoId]);

  const hasInProgress = todos.some((t) => t.status === "in_progress");
  useEffect(() => {
    if (!hasInProgress || !authed) return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [hasInProgress, authed, load]);

  useEffect(() => {
    if (!actionsOpen && !menuOpenId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (actionsOpen && actionsRef.current && !actionsRef.current.contains(t)) {
        setActionsOpen(false);
      }
      if (menuOpenId && menuRef.current && !menuRef.current.contains(t)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [actionsOpen, menuOpenId]);

  const markFirstRunSeen = () => {
    try {
      window.localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowFirstRunDisclaimer(false);
  };

  async function patchStatus(id: string, status: string, todo: TodoRow) {
    if (!authed) return;
    const gate = canManualAdvanceTodo(todo, status);
    if (!gate.ok) {
      setCardErrors((prev) => ({ ...prev, [id]: gate.reason }));
      return;
    }
    setBusy(true);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const r = await fetch(`${base}/todos/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Todos API ${r.status}`);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardErrors((prev) => ({ ...prev, [id]: msg }));
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const approve = async (todoId: string) => {
    if (!accessToken) return;
    setBusyId(todoId);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    try {
      const r = await fetch(`${base}/todos/${encodeURIComponent(todoId)}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!r.ok) throw new Error(formatAgentApiError(d, "Approve failed"));
      await load();
      setLocalNotice("Approved — task is Completed. Sandbox changes applied to the project.");
      onApproved?.(todoId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardErrors((prev) => ({ ...prev, [todoId]: msg }));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (todoId: string) => {
    if (!accessToken) return;
    setBusyId(todoId);
    setMenuOpenId(null);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    try {
      const r = await fetch(`${base}/todos/${encodeURIComponent(todoId)}/reject`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetStatus: "todo" }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Reject failed");
      await load();
      setLocalNotice("Rejected — sandbox discarded; task back in Up next (disk unchanged).");
      setDiffTodoId(null);
      setDiffText(null);
      setDiffOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardErrors((prev) => ({ ...prev, [todoId]: msg }));
    } finally {
      setBusyId(null);
    }
  };

  const resetToTodo = async (todoId: string) => {
    if (!accessToken) return;
    setBusyId(todoId);
    setMenuOpenId(null);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    try {
      const r = await fetch(`${base}/todos/${encodeURIComponent(todoId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "todo" }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? `Todos API ${r.status}`);
      await load();
      setLocalNotice("Reset to Up next — you can Run again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardErrors((prev) => ({ ...prev, [todoId]: msg }));
    } finally {
      setBusyId(null);
    }
  };

  const retryRun = async (todoId: string) => {
    if (!accessToken) return;
    if (fixAgentDisabledReason) {
      setCardErrors((prev) => ({ ...prev, [todoId]: fixAgentDisabledReason }));
      return;
    }
    setBusyId(todoId);
    setMenuOpenId(null);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    try {
      const row = todos.find((t) => t.id === todoId);
      const status = row ? normalizeBoardStatus(row.status) : "todo";
      if (status !== "todo") {
        const pr = await fetch(`${base}/todos/${encodeURIComponent(todoId)}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "todo" }),
        });
        const pd = (await pr.json().catch(() => ({}))) as { error?: string };
        if (!pr.ok) throw new Error(pd.error ?? `Could not reset to todo (${pr.status})`);
      }
      const r = await fetch(`${base}/todos/${encodeURIComponent(todoId)}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!r.ok) throw new Error(formatAgentApiError(d, "Run failed"));
      await load();
      setLocalNotice("Agent started — status moves to In progress, then Review.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardErrors((prev) => ({ ...prev, [todoId]: msg }));
    } finally {
      setBusyId(null);
    }
  };

  const loadDiff = async (todo: TodoRow) => {
    if (!accessToken || !workspaceId || !todo.rail_id) {
      setCardErrors((prev) => ({
        ...prev,
        [todo.id]: "No rail linked yet — wait for the agent to finish.",
      }));
      return;
    }
    setBusyId(todo.id);
    setMenuOpenId(null);
    setDiffTodoId(todo.id);
    setDiffOpen(true);
    try {
      const r = await fetch(
        `${base}/rails/${encodeURIComponent(todo.rail_id)}/diff?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const d = (await r.json().catch(() => ({}))) as {
        error?: string;
        files?: Array<{ path: string; before?: string; after?: string }>;
      };
      if (!r.ok) throw new Error(d.error ?? "Could not load diff");
      const files = d.files ?? [];
      if (files.length === 0) {
        setDiffText("(no file differences in sandbox)");
      } else {
        setDiffText(
          files
            .map((f) => {
              const beforeLines = (f.before ?? "").split("\n").length;
              const afterLines = (f.after ?? "").split("\n").length;
              const preview = (f.after ?? f.before ?? "").slice(0, 800);
              return `### ${f.path}\n(before ~${beforeLines} lines → after ~${afterLines} lines)\n${preview}${
                (f.after ?? "").length > 800 ? "\n…" : ""
              }`;
            })
            .join("\n\n")
        );
      }
      setCardErrors((prev) => {
        const next = { ...prev };
        delete next[todo.id];
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardErrors((prev) => ({ ...prev, [todo.id]: msg }));
      setDiffText(null);
    } finally {
      setBusyId(null);
    }
  };

  async function seedPipeline() {
    if (!authed) return;
    setBusy(true);
    setError(null);
    setLocalNotice(null);
    setActionsOpen(false);
    markFirstRunSeen();
    try {
      const existing = new Set(todos.map((t) => t.source_path).filter(Boolean));
      let created = 0;
      for (const card of TRADING_PIPELINE_SEED) {
        if (existing.has(card.sourcePath)) continue;
        const r = await fetch(`${base}/todos`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            title: card.title,
            description: card.description,
            agentFile: picked || null,
            layerId: card.layerId,
            assigneeLabel: "Cursor",
            kind: card.kind,
            source: "seed_spine",
            sourcePath: card.sourcePath,
            fileScope: card.fileScope,
            acceptanceCriteria: { functional: [card.acceptanceCriteria] },
          }),
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(text.startsWith("<!") ? `Todos API ${r.status}` : text);
        }
        created += 1;
      }
      await load();
      setLocalNotice(
        created === 0
          ? "Already seeded."
          : `Seeded ${created} checklist card${created === 1 ? "" : "s"} with file scope.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importPathIssues() {
    if (!authed || !picked) return;
    setBusy(true);
    setLocalNotice(null);
    setError(null);
    setActionsOpen(false);
    try {
      const agent = surfaces.find((a) => a.file === picked);
      const catalogs = (agents as { toolCatalogs?: Record<string, unknown[]> } | undefined)?.toolCatalogs ?? {};
      const tools =
        Array.isArray(agent?.tools) && agent!.tools.length
          ? agent!.tools
          : (agent as { catalogId?: string } | undefined)?.catalogId
            ? ((catalogs[(agent as { catalogId: string }).catalogId] ?? []) as Array<{
                reach?: { cells?: { patient?: { state?: string }; money?: { state?: string } } };
              }>)
            : [];
      const toolCount = tools.length;
      const patientCount = tools.filter((t) => t.reach?.cells?.patient?.state === "reaches").length;
      const moneyCount = tools.filter((t) => t.reach?.cells?.money?.state === "reaches").length;
      const authFound = !!agent?.auth?.found;

      if (authFound) {
        setLocalNotice("No auth gap on Path for this agent.");
        return;
      }

      const sourcePath = `flow-path:auth:${picked}`;
      if (todos.some((t) => t.source_path === sourcePath)) {
        setLocalNotice("Already on the board.");
        return;
      }
      const r = await fetch(`${base}/todos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          title: `Auth gap on path: ${fileName(picked)}`,
          description: `Seeded from Flow Path — no auth detected on agent files that reach money/patient resources. Tools: ${toolCount}; money: ${moneyCount}; patient: ${patientCount}.`,
          agentFile: picked,
          layerId: "ingress",
          assigneeLabel: "Cursor",
          kind: "task",
          source: "import_from_path",
          sourcePath,
          fileScope: [picked],
          acceptanceCriteria: {
            functional: [
              "Auth is detectable on the agent ingress path before money/patient tools run.",
            ],
          },
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text.startsWith("<!") ? `Todos API ${r.status}` : text);
      }
      await load();
      setLocalNotice("Imported Path auth gap as a runnable Up next task.");
      setBoardFilter("all");
      markFirstRunSeen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addManualTask() {
    if (!authed) return;
    const title = window.prompt("Task title");
    if (!title?.trim()) return;
    setBusy(true);
    setError(null);
    markFirstRunSeen();
    try {
      const r = await fetch(`${base}/todos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          title: title.trim(),
          agentFile: picked || null,
          assigneeLabel: "Cursor",
          kind: "task",
          source: "manual",
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text.startsWith("<!") ? `Todos API ${r.status}` : text);
      }
      await load();
      setLocalNotice("Added manual task.");
      setBoardLane("active");
      setBoardFilter("all");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const spineSeeded =
    TRADING_PIPELINE_SEED.length > 0 &&
    TRADING_PIPELINE_SEED.every((c) => todos.some((t) => t.source_path === c.sourcePath));

  const filteredTodos = useMemo(() => {
    let list = todos;
    if (!showDogfood) {
      list = list.filter((t) => !isDogfoodTodo(t));
    }
    if (boardFilter === "mine") {
      list = list.filter(isMineTodo);
    } else if (boardFilter === "blockers") {
      list = list.filter(isBlockerTodo);
    }
    return list;
  }, [todos, boardFilter, showDogfood]);

  const openCount = useMemo(
    () =>
      filteredTodos.filter(
        (t) =>
          t.kind !== "issue" &&
          (t.status === "todo" || t.status === "pending" || t.status === "in_progress")
      ).length,
    [filteredTodos]
  );
  const reviewCount = useMemo(
    () =>
      filteredTodos.filter((t) => t.kind !== "issue" && t.status === "needs_review").length,
    [filteredTodos]
  );

  const visibleColumns = useMemo(() => {
    if (boardLane === "done") return COLUMNS.filter((c) => c.id === "done");
    if (boardLane === "issues") return COLUMNS.filter((c) => c.id === "issues");
    return COLUMNS.filter((c) => c.id === "todo" || c.id === "doing" || c.id === "tested");
  }, [boardLane]);

  const runReadinessGaps = useMemo(() => {
    const gaps: string[] = [];
    if (!workspaceId || !accessToken) gaps.push("Signed-in workspace required");
    if (!hasProjectRoot) gaps.push("Scan a repo (project files on disk)");
    if (canUseAiAgent === false || !!fixAgentDisabledReason?.includes("Pro")) {
      gaps.push("Pro or Team plan for Run agent");
    }
    return gaps;
  }, [workspaceId, accessToken, hasProjectRoot, fixAgentDisabledReason, canUseAiAgent]);

  const boardIsEmpty = todos.filter((t) => showDogfood || !isDogfoodTodo(t)).length === 0;

  if (!authed) {
    return (
      <div data-testid="flow-tasks-board" style={{ padding: 24, fontFamily: FONT_UI, color: INK }}>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
          Tasks needs a signed-in workspace. Sign in and open a saved workspace to track tasks on this
          board.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="flow-tasks-board"
      style={{
        height: "100%",
        overflow: "auto",
        padding: "12px 16px 40px",
        fontFamily: FONT_UI,
        background: PAPER,
        color: INK,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Tasks</div>
          <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
            {openCount} open · {reviewCount} in review
          </div>
        </div>
        <div ref={actionsRef} style={{ position: "relative" }}>
          <button
            type="button"
            data-testid="flow-tasks-actions"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((v) => !v)}
            style={{ ...btn(SLATE), fontSize: 12, padding: "6px 10px" }}
          >
            Actions {actionsOpen ? "▴" : "▾"}
          </button>
          {actionsOpen ? (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                zIndex: 20,
                minWidth: 220,
                background: CANVAS,
                border: `1px solid ${LINE}`,
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(18,19,26,0.12)",
                padding: 8,
              }}
            >
              <div style={{ fontSize: 11, color: SLATE, margin: "4px 6px 8px" }}>Agent</div>
              <select
                data-testid="flow-tasks-agent"
                value={picked}
                onChange={(e) => {
                  setLocalAgent(e.target.value);
                  onSelectAgent?.(e.target.value);
                }}
                style={{
                  width: "100%",
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: INK,
                  marginBottom: 8,
                }}
              >
                {surfaces.length === 0 ? (
                  <option value="">(no agents — still seed checklist)</option>
                ) : null}
                {surfaces.map((a) => (
                  <option key={a.file} value={a.file}>
                    {fileName(a.file)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="flow-seed-pipeline"
                disabled={busy || spineSeeded}
                title={
                  spineSeeded
                    ? "Already seeded."
                    : "Adds checklist todo cards for Cursor rails. Does not apply the canvas spine."
                }
                onClick={() => void seedPipeline()}
                style={{
                  ...menuItemBtn,
                  opacity: spineSeeded ? 0.45 : 1,
                }}
              >
                {spineSeeded ? "Already seeded" : "Seed checklist"}
              </button>
              <button
                type="button"
                data-testid="flow-import-path-issues"
                disabled={busy || !picked}
                onClick={() => void importPathIssues()}
                style={menuItemBtn}
              >
                Import from Path
              </button>
              <button
                type="button"
                data-testid="flow-tasks-show-dogfood"
                onClick={() => {
                  setShowDogfood((v) => !v);
                }}
                style={menuItemBtn}
              >
                {showDogfood ? "Hide dogfood/test cards" : "Show dogfood/test cards"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div
        data-testid="flow-tasks-filter"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "12px 0" }}
      >
        <span style={{ fontSize: 11, color: SLATE, marginRight: 2 }}>Filters:</span>
        {(
          [
            ["all", "All"],
            ["mine", "Mine"],
            ["blockers", "Blockers"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`flow-tasks-filter-${id}`}
            onClick={() => setBoardFilter(id)}
            style={{
              ...btn(boardFilter === id ? ACCENT : SLATE),
              fontSize: 11,
              padding: "4px 10px",
              opacity: boardFilter === id ? 1 : 0.7,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        data-testid="flow-tasks-lane-toggle"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}
      >
        {(
          [
            ["active", "Board"],
            ["done", "Completed"],
            ["issues", "Issues"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`flow-tasks-lane-${id}`}
            onClick={() => setBoardLane(id)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: boardLane === id ? 700 : 500,
              color: boardLane === id ? INK : SLATE,
              borderBottom: boardLane === id ? `2px solid ${ACCENT}` : "2px solid transparent",
              padding: "2px 4px",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {runReadinessGaps.length > 0 ? (
        <div
          data-testid="flow-run-readiness"
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${WARN}`,
            background: "#FFFBEB",
            fontSize: 12,
            color: INK,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 700, color: WARN, marginBottom: 4 }}>Run agent not ready</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {runReadinessGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {entitlementLine ? (
        <div data-testid="flow-tasks-entitlements" style={{ fontSize: 11, color: SLATE, marginBottom: 8 }}>
          {entitlementLine}
        </div>
      ) : null}
      {notice || localNotice ? (
        <div data-testid="flow-tasks-notice" style={{ fontSize: 12, color: ACCENT, marginBottom: 8, fontWeight: 600 }}>
          {localNotice ?? notice}
        </div>
      ) : null}

      {error ? (
        <div style={{ color: BAD, fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{error}</div>
      ) : null}

      <div
        data-testid="flow-tasks-kanban"
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 12,
          alignItems: "flex-start",
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {visibleColumns.map((col) => {
          const cards = filteredTodos.filter(col.match);
          return (
            <div
              key={col.id}
              data-testid={`flow-kanban-${col.id}`}
              style={{
                flex: boardLane === "active" ? "1 1 0" : "0 0 280px",
                minWidth: boardLane === "active" ? 200 : 240,
                maxWidth: boardLane === "active" ? undefined : 360,
              }}
            >
              <div
                style={{
                  borderBottom: `3px solid ${col.tip}`,
                  paddingBottom: 8,
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: col.tip,
                  }}
                >
                  {col.title}
                </div>
                <div style={{ fontSize: 12, color: INK, marginTop: 2 }}>{cards.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cards.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1px dashed ${col.tip}`,
                      background: CANVAS,
                      fontSize: 12,
                      color: INK,
                      lineHeight: 1.45,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {col.empty}
                    {col.id === "todo" && showFirstRunDisclaimer && boardIsEmpty ? (
                      <div
                        data-testid="flow-seed-hint"
                        style={{
                          marginTop: 10,
                          fontSize: 11,
                          color: SLATE,
                          lineHeight: 1.45,
                        }}
                      >
                        Seed checklist adds todo cards for Cursor rails. It does not apply the canvas
                        spine (Insights → Apply trading spine).
                      </div>
                    ) : null}
                    {col.id === "todo" ? (
                      <button
                        type="button"
                        data-testid="flow-tasks-add-manual"
                        disabled={busy}
                        onClick={() => void addManualTask()}
                        style={{ ...btn(INFO), marginTop: 10, fontSize: 11, padding: "5px 10px" }}
                      >
                        Add a task manually
                      </button>
                    ) : null}
                  </div>
                ) : (
                  cards.map((t) => {
                    const next = t.kind === "issue" ? null : NEXT_STATUS[t.status] ?? null;
                    const advanceGate = next ? canManualAdvanceTodo(t, next) : { ok: true as const };
                    const expanded = expandedId === t.id;
                    const log = Array.isArray(t.session_log) ? t.session_log : [];
                    const paths = openPathsFromTodo(t);
                    const status = normalizeBoardStatus(t.status);
                    const spineGap = isSpineRemediationTodo(t);
                    const canRun =
                      !spineGap &&
                      t.kind !== "issue" &&
                      (status === "todo" || status === "pending");
                    const canRetry =
                      !spineGap &&
                      t.kind !== "issue" &&
                      hasSessionError(t) &&
                      status !== "todo";
                    const showReset =
                      t.kind !== "issue" &&
                      (status === "in_progress" ||
                        (hasSessionError(t) && status !== "todo"));
                    const showReview =
                      !spineGap &&
                      status === "needs_review" &&
                      !!t.rail_id &&
                      t.kind !== "issue";
                    const sourceLabel = sourceChipLabel(t.source);
                    const menuOpen = menuOpenId === t.id;

                    return (
                      <div
                        key={t.id}
                        data-testid={`flow-task-card-${t.id}`}
                        style={{
                          background: CANVAS,
                          border: `1px solid ${focusTodoId === t.id ? ACCENT : LINE}`,
                          borderLeft: `4px solid ${col.tip}`,
                          borderRadius: 10,
                          padding: "10px 12px",
                          boxShadow: focusTodoId === t.id ? `0 0 0 1px ${ACCENT}` : undefined,
                          position: "relative",
                        }}
                      >
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                          <Chip color={sourceChipColor(sourceLabel)}>{sourceLabel}</Chip>
                          {t.layer_id ? <Chip color={INFO}>{t.layer_id}</Chip> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : t.id)}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "block",
                            width: "100%",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{t.title}</div>
                          <div style={{ fontSize: 11, color: SLATE, marginTop: 4 }}>
                            {statusLine(t)}
                          </div>
                        </button>

                        {cardErrors[t.id] ? (
                          <div
                            data-testid={`flow-task-error-${t.id}`}
                            style={{ fontSize: 11, color: BAD, marginTop: 6, fontWeight: 600 }}
                          >
                            {cardErrors[t.id]}
                          </div>
                        ) : null}

                        {expanded ? (
                          <div style={{ marginTop: 8, fontSize: 11, color: SLATE }}>
                            {t.description ? (
                              <div style={{ marginBottom: 6, color: INK, lineHeight: 1.4 }}>
                                {t.description}
                              </div>
                            ) : null}
                            {log.length > 0 ? (
                              <ul
                                data-testid={`flow-task-log-${t.id}`}
                                style={{ margin: 0, paddingLeft: 16, lineHeight: 1.35 }}
                              >
                                {log.slice(-6).map((e, i) => (
                                  <li key={i}>{eventLabel(e)}</li>
                                ))}
                              </ul>
                            ) : (
                              <div>No session log yet.</div>
                            )}
                          </div>
                        ) : null}

                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 8,
                            alignItems: "center",
                            justifyContent: "flex-end",
                          }}
                        >
                          {spineGap ? (
                            <button
                              type="button"
                              data-testid={`flow-task-apply-spine-${t.id}`}
                              title="Spine gaps are fixed in Insights — not by agent Run/Approve"
                              onClick={() => {
                                if (onApplyTradingSpine) onApplyTradingSpine();
                                else onOpenInsights?.();
                              }}
                              style={{
                                ...btn(ACCENT),
                                fontSize: 11,
                                padding: "4px 10px",
                                marginRight: "auto",
                              }}
                            >
                              {onApplyTradingSpine ? "Apply trading spine" : "Open Insights"}
                            </button>
                          ) : null}
                          {canRun ? (
                            <button
                              type="button"
                              data-testid={`flow-task-run-${t.id}`}
                              disabled={busyId === t.id || !!fixAgentDisabledReason}
                              title={
                                fixAgentDisabledReason ?? "Runs agent in sandbox → review in Tasks"
                              }
                              onClick={() => void retryRun(t.id)}
                              style={{
                                ...btn(ACCENT),
                                fontSize: 11,
                                padding: "4px 10px",
                                opacity: fixAgentDisabledReason ? 0.45 : 1,
                                marginRight: "auto",
                              }}
                            >
                              {busyId === t.id ? "Starting…" : "Run"}
                            </button>
                          ) : null}

                          {showReview ? (
                            <button
                              type="button"
                              data-testid={`flow-task-approve-${t.id}`}
                              disabled={busyId === t.id}
                              title="Apply sandbox changes to the project and mark Completed"
                              onClick={() => void approve(t.id)}
                              style={{
                                ...btn(GOOD),
                                fontSize: 11,
                                padding: "4px 10px",
                                marginRight: "auto",
                              }}
                            >
                              Approve
                            </button>
                          ) : null}

                          {!canRun && !showReview ? (
                            <span
                              style={{
                                fontSize: 11,
                                color: SLATE,
                                marginRight: "auto",
                                fontWeight: 600,
                              }}
                            >
                              {status === "in_progress"
                                ? busyId === t.id
                                  ? "Working…"
                                  : "Running"
                                : status === "done"
                                  ? "Done"
                                  : null}
                            </span>
                          ) : null}

                          <div
                            ref={menuOpen ? menuRef : undefined}
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              data-testid={`flow-task-more-${t.id}`}
                              aria-label="More actions"
                              aria-expanded={menuOpen}
                              onClick={() => setMenuOpenId(menuOpen ? null : t.id)}
                              style={{
                                ...btn(SLATE),
                                fontSize: 14,
                                padding: "2px 8px",
                                lineHeight: 1.2,
                              }}
                            >
                              ⋯
                            </button>
                            {menuOpen ? (
                              <div
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  bottom: "calc(100% + 4px)",
                                  zIndex: 25,
                                  minWidth: 160,
                                  background: CANVAS,
                                  border: `1px solid ${LINE}`,
                                  borderRadius: 10,
                                  boxShadow: "0 8px 24px rgba(18,19,26,0.12)",
                                  padding: 6,
                                }}
                              >
                                {canRetry ? (
                                  <button
                                    type="button"
                                    data-testid={`flow-task-retry-${t.id}`}
                                    disabled={busyId === t.id || !!fixAgentDisabledReason}
                                    onClick={() => void retryRun(t.id)}
                                    style={menuItemBtn}
                                  >
                                    Retry
                                  </button>
                                ) : null}
                                {showReset ? (
                                  <button
                                    type="button"
                                    data-testid={`flow-task-reset-${t.id}`}
                                    disabled={busyId === t.id}
                                    onClick={() => void resetToTodo(t.id)}
                                    style={menuItemBtn}
                                  >
                                    Reset
                                  </button>
                                ) : null}
                                {showReview ? (
                                  <>
                                    <button
                                      type="button"
                                      data-testid={`flow-task-diff-${t.id}`}
                                      disabled={busyId === t.id}
                                      onClick={() => void loadDiff(t)}
                                      style={menuItemBtn}
                                    >
                                      View diff
                                    </button>
                                    <button
                                      type="button"
                                      data-testid={`flow-task-reject-${t.id}`}
                                      disabled={busyId === t.id}
                                      onClick={() => void reject(t.id)}
                                      style={menuItemBtn}
                                    >
                                      Reject
                                    </button>
                                  </>
                                ) : null}
                                {next && advanceGate.ok ? (
                                  <button
                                    type="button"
                                    disabled={busy || busyId === t.id}
                                    data-testid={`flow-task-advance-${t.id}`}
                                    onClick={() => {
                                      setMenuOpenId(null);
                                      void patchStatus(t.id, next, t);
                                    }}
                                    style={menuItemBtn}
                                  >
                                    Move →
                                  </button>
                                ) : null}
                                {next && !advanceGate.ok ? (
                                  <div
                                    data-testid={`flow-task-gate-${t.id}`}
                                    style={{
                                      fontSize: 10,
                                      color: BAD,
                                      padding: "6px 8px",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {advanceGate.reason}
                                  </div>
                                ) : null}
                                {paths.length > 0 ? (
                                  <>
                                    <div
                                      style={{
                                        fontSize: 10,
                                        color: SLATE,
                                        padding: "6px 8px 2px",
                                        fontWeight: 700,
                                      }}
                                    >
                                      Open files
                                    </div>
                                    {paths.map((p) => (
                                      <button
                                        key={p}
                                        type="button"
                                        data-testid={`flow-task-open-file-${t.id}`}
                                        onClick={() => {
                                          setMenuOpenId(null);
                                          onOpenFile?.(p);
                                        }}
                                        style={{
                                          ...menuItemBtn,
                                          fontFamily: FONT_MONO,
                                          fontSize: 10,
                                        }}
                                      >
                                        {p}
                                      </button>
                                    ))}
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {diffOpen ? (
        <div
          data-testid="flow-task-diff-modal"
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(18,19,26,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => {
            setDiffOpen(false);
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              maxHeight: "80vh",
              overflow: "auto",
              background: CANVAS,
              borderRadius: 12,
              border: `1px solid ${LINE}`,
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700 }}>Sandbox diff</div>
              <button
                type="button"
                data-testid="flow-task-diff-close"
                onClick={() => setDiffOpen(false)}
                style={{ ...btn(SLATE), fontSize: 11, padding: "4px 8px" }}
              >
                Close
              </button>
            </div>
            {diffTodoId && diffText ? (
              <pre
                data-testid={`flow-task-diff-body-${diffTodoId}`}
                style={{
                  margin: 0,
                  maxHeight: "60vh",
                  overflow: "auto",
                  fontSize: 11,
                  fontFamily: FONT_MONO,
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 8,
                  padding: 12,
                  whiteSpace: "pre-wrap",
                }}
              >
                {diffText}
              </pre>
            ) : (
              <div style={{ fontSize: 12, color: SLATE }}>
                {busyId ? "Loading diff…" : "No diff loaded."}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        borderRadius: 6,
        padding: "2px 6px",
        background: CANVAS,
        fontFamily: FONT_MONO,
      }}
    >
      {children}
    </span>
  );
}

function btn(color: string): CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 8,
    border: `2px solid ${color}`,
    background: CANVAS,
    color,
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: FONT_UI,
  };
}

const menuItemBtn: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: INK,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: FONT_UI,
};
