/**
 * Insights = architecture / workflow / platforms / tools / costs + node briefings.
 * Config-hidden views are always pointed out — blanko must explain where value lives.
 */
import { useEffect, useMemo, useState } from "react";
import type { DesignFinding } from "../designRules";
import { designScore } from "../designRules";
import type { InventoryRow } from "../platformInventory";
import { ProviderIcon } from "../ProviderIcon";
import { DesignInspectPanel } from "../DesignInspectPanel";
import type { ArchGraph, ArchNode } from "../types";
import { NodeCollabSection } from "./NodeCollabSection";
import {
  architectureBrief,
  briefNode,
  briefSubsystem,
  inventoryHeadline,
  orphanPresentationNodes,
  toolsForGraph,
  workflowHops,
} from "../insightsBriefing";
import type { NodeSubsystem } from "../types";
import { insightsTodoSourcePath } from "../insightsTodo";
import type { NodeNextAction } from "../insightsBriefing";
import { BAD, CANVAS, FONT_MONO, FONT_UI, GOOD, INK, LINE, PAPER, SLATE, WARN, ACCENT } from "../theme/tokens";

type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
};

type Props = {
  findings: DesignFinding[];
  inventory: InventoryRow[];
  graph?: ArchGraph | null;
  selectedNode?: ArchNode | null;
  /** Colored cockpit box selection (ingress / strategy / …). */
  selectedSubsystem?: NodeSubsystem | null;
  /** Jump from a module listed inside a subsystem brief. */
  onSelectNode?: (nodeId: string) => void;
  editDetailsOpen?: boolean;
  onEditDetailsOpenChange?: (open: boolean) => void;
  onHighlight: (finding: DesignFinding) => void;
  onFix?: (finding: DesignFinding) => void;
  onAskFix?: (finding: DesignFinding) => void;
  onContinueInChat?: (node: ArchNode) => void;
  /** Prefill chat with an explicit prompt (task / audit). */
  onAskChatPrompt?: (prompt: string) => void;
  /** Track work as a DB todo (no agent run). */
  onAddTask?: (action: NodeNextAction, node: ArchNode) => void | Promise<void>;
  /** Start agent fix for code actions only (create/reuse todo + run). */
  onFixWithAgent?: (action: NodeNextAction, node: ArchNode) => void | Promise<void>;
  /** Why Fix is disabled (sign-in, no repo, …). */
  fixAgentDisabledReason?: string | null;
  /** Open Blanko Tasks dock. */
  onOpenTasks?: () => void;
  showApplyTradingSpine?: boolean;
  onApplyTradingSpine?: () => void;
  /** On architecture spine: restore code-module scan. */
  showCodeScan?: boolean;
  onShowCodeScan?: () => void;
  onOpenConfig?: (view: "flow" | "agents" | "usage" | "platforms") => void;
  onNodeChange?: (
    patch: Partial<
      Pick<
        ArchNode,
        | "label"
        | "layer"
        | "description"
        | "platformBindings"
        | "llmProvider"
        | "cloudProvider"
        | "llmops"
        | "properties"
        | "requiredEnv"
        | "deployHealth"
      >
    >
  ) => void;
  onNodeDelete?: () => void;
  onAddNeighbours?: () => void;
  onOpenFile?: (path: string) => void;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  /** sourcePath → todo status for Tracked/Fixing chips + hide done. */
  todoStatusBySourcePath?: Record<string, string>;
};

function severityColor(s: DesignFinding["severity"]) {
  if (s === "blocker") return BAD;
  if (s === "risk") return WARN;
  return GOOD;
}

function cents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

export function InsightsPanel({
  findings,
  inventory,
  graph,
  selectedNode,
  selectedSubsystem,
  onSelectNode,
  editDetailsOpen: editDetailsOpenProp,
  onEditDetailsOpenChange,
  onHighlight,
  onFix,
  onAskFix,
  onContinueInChat,
  onAskChatPrompt,
  onAddTask,
  onFixWithAgent,
  fixAgentDisabledReason,
  onOpenTasks,
  showApplyTradingSpine,
  onApplyTradingSpine,
  showCodeScan,
  onShowCodeScan,
  onOpenConfig,
  onNodeChange,
  onNodeDelete,
  onAddNeighbours,
  onOpenFile,
  workspaceId,
  accessToken,
  apiBase = "/api",
  todoStatusBySourcePath = {},
}: Props) {
  const nodeMode = !!selectedNode;
  const subsystemMode = !nodeMode && !!selectedSubsystem;
  const nodeFindings = selectedNode
    ? findings.filter((f) => f.nodeIds.includes(selectedNode.id))
    : findings;
  const score = designScore(nodeMode ? nodeFindings : findings);
  const [editOpen, setEditOpen] = useState(!!editDetailsOpenProp);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [fixBusyId, setFixBusyId] = useState<string | null>(null);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);
  const linkedFile = selectedNode?.files?.[0];
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [fuelBySubsystem, setFuelBySubsystem] = useState<
    Array<{ subsystem: string; callCount: number; costCents: number }>
  >([]);
  const [usageNote, setUsageNote] = useState<string | null>(null);

  const brief = useMemo(
    () => (selectedNode ? briefNode(graph, selectedNode, nodeFindings) : null),
    [graph, selectedNode, nodeFindings]
  );
  const visibleNextActions = useMemo(() => {
    if (!brief || !selectedNode) return [];
    return brief.nextActions
      .map((a) => {
        const sp = insightsTodoSourcePath(selectedNode.id, a.id);
        const st = todoStatusBySourcePath[sp];
        return { action: a, sourcePath: sp, todoStatus: st };
      })
      .filter((row) => row.todoStatus !== "done" && row.todoStatus !== "completed");
  }, [brief, selectedNode, todoStatusBySourcePath]);
  const [showSoftSuggestions, setShowSoftSuggestions] = useState(false);
  const primaryNextActions = useMemo(
    () => visibleNextActions.filter((row) => row.action.severity !== "soft"),
    [visibleNextActions]
  );
  const softNextActions = useMemo(
    () => visibleNextActions.filter((row) => row.action.severity === "soft"),
    [visibleNextActions]
  );
  const subsystemBrief = useMemo(
    () => (selectedSubsystem ? briefSubsystem(graph, selectedSubsystem) : null),
    [graph, selectedSubsystem]
  );
  const hops = useMemo(
    () => (!nodeMode && !subsystemMode ? workflowHops(graph) : []),
    [graph, nodeMode, subsystemMode]
  );
  const orphans = useMemo(
    () => (!nodeMode && !subsystemMode ? orphanPresentationNodes(graph) : []),
    [graph, nodeMode, subsystemMode]
  );
  const tools = useMemo(
    () => (!nodeMode && !subsystemMode ? toolsForGraph(graph) : []),
    [graph, nodeMode, subsystemMode]
  );
  const archText = useMemo(() => architectureBrief(graph), [graph]);
  const platHeadline = useMemo(() => inventoryHeadline(inventory), [inventory]);

  useEffect(() => {
    if (editDetailsOpenProp !== undefined) setEditOpen(editDetailsOpenProp);
  }, [editDetailsOpenProp, selectedNode?.id]);

  useEffect(() => {
    if (!workspaceId || !accessToken) {
      setUsage(null);
      setFuelBySubsystem([]);
      setUsageNote("Sign in and open Agents → Usage for burn & budgets.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/usage?days=30`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!r.ok) {
          if (!cancelled) {
            setUsage(null);
            setUsageNote("Usage API unavailable — open Agents → Usage when ready.");
          }
          return;
        }
        const d = await r.json();
        if (cancelled) return;
        if (d.migrationPending) {
          setUsage(null);
          setUsageNote("Usage tables pending migration — Agents → Usage.");
          return;
        }
        setUsage(d.totals ?? null);
        setFuelBySubsystem(
          Array.isArray(d.fuelBySubsystem)
            ? d.fuelBySubsystem.map((r: { subsystem: string; callCount: number; costCents: number }) => ({
                subsystem: r.subsystem,
                callCount: r.callCount,
                costCents: r.costCents,
              }))
            : []
        );
        setUsageNote(null);
      } catch {
        if (!cancelled) {
          setUsage(null);
          setUsageNote("Could not load burn — open Agents → Usage.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken, apiBase, graph?.generatedAt]);

  const setEdit = (open: boolean) => {
    setEditOpen(open);
    onEditDetailsOpenChange?.(open);
  };

  const configLink = (view: "flow" | "agents" | "usage" | "platforms", label: string) =>
    onOpenConfig ? (
      <button
        type="button"
        data-testid={`blanko-insights-open-${view}`}
        onClick={() => onOpenConfig(view)}
        style={{ ...linkBtn }}
      >
        {label}
      </button>
    ) : (
      <span style={{ color: ACCENT, fontWeight: 600 }}>{label}</span>
    );

  const codeScanCta =
    showCodeScan && onShowCodeScan ? (
      <div
        data-testid="blanko-show-code-scan-cta"
        style={{
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          padding: 14,
          marginBottom: 14,
          background: PAPER,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 6 }}>
          You’re on the money-path board
        </div>
        <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 10 }}>
          This spine is the intended workflow (Telegram → Agent → Strategy → Policy…), not your code
          folders. View / Edit only locks the canvas — it does not switch maps. Use ← Code map in the
          chrome (or below) to return to the Code map.
        </div>
        <button
          type="button"
          data-testid="blanko-show-code-scan"
          onClick={onShowCodeScan}
          style={primaryBtn}
        >
          ← Code map
        </button>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.4 }}>
          Chrome ← Code map restores your last module map when available; otherwise rescans the
          Import URL or `.blanko-target` local path.
        </div>
      </div>
    ) : null; // leave-spine CTA (single instance at panel top)

  return (
    <div data-testid="blanko-insights" style={{ padding: 14, fontFamily: FONT_UI }}>
      {codeScanCta}
      {nodeMode && selectedNode && brief ? (
        <div
          data-testid="blanko-insights-node"
          style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "100%" }}
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <div style={{ ...monoLabel, marginBottom: 4 }}>Selected piece</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: INK,
                letterSpacing: "-0.02em",
                marginBottom: 2,
              }}
            >
              {selectedNode.label}
            </div>
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 10 }}>
              {brief.headline}
              {selectedNode.buildStatus ? ` · ${selectedNode.buildStatus}` : ""}
            </div>

            <div
              data-testid="blanko-insights-node-role"
              style={{
                fontSize: 13,
                color: INK,
                lineHeight: 1.45,
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: PAPER,
                border: `1px solid ${LINE}`,
              }}
            >
              {brief.role}
              {brief.moneyRule ? (
                <div style={{ marginTop: 8, fontSize: 12, color: ACCENT, fontWeight: 600 }}>
                  {brief.moneyRule}
                </div>
              ) : null}
            </div>

            <div style={{ ...monoLabel, marginBottom: 8 }}>What to do next</div>
            <div data-testid="blanko-insights-next-actions" style={{ marginBottom: 14 }}>
              {primaryNextActions.length === 0 && softNextActions.length === 0 ? (
                <div style={{ fontSize: 12, color: SLATE }}>Nothing open — all tracked or cleared.</div>
              ) : (
                <>
                {primaryNextActions.map(({ action: a, todoStatus }) => {
                  const isSpineSetup = a.kind === "spine";
                  const priorityLabel = isSpineSetup ? "setup" : a.priority;
                  return (
                <div
                  key={a.id}
                  data-testid={`blanko-insights-action-${a.id}`}
                  style={{
                    border: `1px solid ${isSpineSetup ? WARN : a.priority === "blocker" ? ACCENT : LINE}`,
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 8,
                    background: CANVAS,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: isSpineSetup
                          ? WARN
                          : a.priority === "blocker"
                            ? BAD
                            : a.priority === "high"
                              ? WARN
                              : SLATE,
                      }}
                    >
                      {priorityLabel}
                    </span>
                    {todoStatus ? (
                      <span
                        data-testid={`blanko-insights-action-status-${a.id}`}
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color:
                            todoStatus === "needs_review"
                              ? WARN
                              : todoStatus === "in_progress"
                                ? ACCENT
                                : GOOD,
                        }}
                      >
                        {todoStatus === "in_progress"
                          ? "Fixing"
                          : todoStatus === "needs_review"
                            ? "In review"
                            : todoStatus === "todo" || todoStatus === "pending"
                              ? "Tracked"
                              : todoStatus}
                      </span>
                    ) : null}
                    <span style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{a.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.4, marginBottom: 8 }}>
                    {a.detail}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {a.kind === "spine" && onApplyTradingSpine ? (
                      <button
                        type="button"
                        data-testid="blanko-insights-apply-spine"
                        onClick={onApplyTradingSpine}
                        style={{
                          ...primaryBtn,
                          background: ACCENT,
                          color: "#fff",
                          borderColor: ACCENT,
                        }}
                      >
                        Apply trading spine
                      </button>
                    ) : null}
                    {a.kind === "flow" && onOpenConfig ? (
                      <button type="button" onClick={() => onOpenConfig("flow")} style={ghostBtn}>
                        Go to Path
                      </button>
                    ) : null}
                    {a.kind === "code" && a.severity !== "soft" && onFixWithAgent ? (
                      <button
                        type="button"
                        data-testid={`blanko-insights-fix-${a.id}`}
                        disabled={
                          !!fixAgentDisabledReason ||
                          fixBusyId === a.id ||
                          todoStatus === "in_progress" ||
                          todoStatus === "needs_review"
                        }
                        title={
                          fixAgentDisabledReason ??
                          "Runs agent in sandbox → review in Tasks"
                        }
                        onClick={() => {
                          void (async () => {
                            setFixBusyId(a.id);
                            setTaskNotice(null);
                            try {
                              await onFixWithAgent(a, selectedNode);
                              setTaskNotice("Agent started — open Tasks");
                            } catch (e) {
                              setTaskNotice(e instanceof Error ? e.message : String(e));
                            } finally {
                              setFixBusyId(null);
                            }
                          })();
                        }}
                        style={
                          fixAgentDisabledReason
                            ? { ...ghostBtn, opacity: 0.45, cursor: "not-allowed", borderColor: ACCENT, color: ACCENT }
                            : { ...ghostBtn, borderColor: ACCENT, color: ACCENT, fontWeight: 700 }
                        }
                      >
                        {fixBusyId === a.id ? "Starting…" : "Fix"}
                      </button>
                    ) : null}
                    {a.filePath && onOpenFile ? (
                      <button type="button" onClick={() => onOpenFile(a.filePath!)} style={ghostBtn}>
                        Open code
                      </button>
                    ) : null}
                    {(a.chatPrompt || onContinueInChat || onAskChatPrompt) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (a.chatPrompt && onAskChatPrompt) onAskChatPrompt(a.chatPrompt);
                          else if (onContinueInChat) onContinueInChat(selectedNode);
                        }}
                        style={ghostBtn}
                      >
                        Ask chat
                      </button>
                    )}
                    {a.kind !== "spine" &&
                    (a.taskTitle || a.kind === "code" || a.kind === "task") &&
                    onAddTask ? (
                      <button
                        type="button"
                        data-testid={`blanko-insights-add-task-${a.id}`}
                        disabled={taskBusyId === a.id || !!todoStatus}
                        onClick={() => {
                          void (async () => {
                            setTaskBusyId(a.id);
                            setTaskNotice(null);
                            try {
                              await onAddTask(a, selectedNode);
                              setTaskNotice("Added to Tasks");
                            } catch (e) {
                              setTaskNotice(e instanceof Error ? e.message : String(e));
                            } finally {
                              setTaskBusyId(null);
                            }
                          })();
                        }}
                        style={ghostBtn}
                        title="Track in Tasks — does not run the agent"
                      >
                        {taskBusyId === a.id ? "Adding…" : todoStatus ? "Tracked" : "Add task"}
                      </button>
                    ) : null}
                  </div>
                </div>
                  );
                })}
              {softNextActions.length > 0 ? (
                <div data-testid="blanko-insights-soft-suggestions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowSoftSuggestions((v) => !v)}
                    style={{
                      ...ghostBtn,
                      fontSize: 11,
                      marginBottom: showSoftSuggestions ? 8 : 0,
                    }}
                  >
                    {showSoftSuggestions ? "Hide suggestions" : `More suggestions (${softNextActions.length})`}
                  </button>
                  {showSoftSuggestions
                    ? softNextActions.map(({ action: a }) => (
                        <div
                          key={a.id}
                          data-testid={`blanko-insights-action-${a.id}`}
                          style={{
                            border: `1px solid ${LINE}`,
                            borderRadius: 10,
                            padding: 10,
                            marginBottom: 8,
                            background: PAPER,
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{a.title}</div>
                          <div style={{ fontSize: 12, color: SLATE, marginTop: 4 }}>{a.detail}</div>
                        </div>
                      ))
                    : null}
                </div>
              ) : null}
                </>
              )}
            </div>

            {brief.fileRoles.length > 0 ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...monoLabel, marginBottom: 8 }}>Bound files · what to check</div>
                {brief.fileRoles.map((fr) => (
                  <div
                    key={fr.path}
                    style={{
                      marginBottom: 8,
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: `1px solid ${LINE}`,
                      background: PAPER,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>{fr.role}</span>
                      {onOpenFile ? (
                        <button type="button" onClick={() => onOpenFile(fr.path)} style={fileLink}>
                          {fr.path.split("/").slice(-1)[0]}
                        </button>
                      ) : (
                        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: SLATE }}>{fr.path}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.4 }}>{fr.check}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {brief.providers.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...monoLabel, marginBottom: 6 }}>Providers</div>
                {brief.providers.map((p) => (
                  <div
                    key={p.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
                  >
                    <ProviderIcon providerId={p.id} size={16} />
                    <span style={{ fontSize: 13, color: INK, flex: 1 }}>{p.id}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: GOOD }}>{p.status}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {brief.tools.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...monoLabel, marginBottom: 6 }}>Tools on this piece</div>
                <div style={{ fontSize: 12, color: INK, lineHeight: 1.4, marginBottom: 4 }}>
                  {brief.tools.map((t) => t.name).join(" · ")}
                </div>
                <div style={{ fontSize: 11, color: SLATE }}>
                  Catalog → {configLink("agents", "Agents")}
                </div>
              </div>
            ) : null}

            {brief.neighbours.length > 0 ? (
              <div style={{ fontSize: 12, color: SLATE, marginBottom: 12, lineHeight: 1.4 }}>
                <strong style={{ color: INK }}>Connected: </strong>
                {brief.neighbours.join(" · ")}
              </div>
            ) : null}

            {fixAgentDisabledReason && onFixWithAgent ? (
              <div style={{ fontSize: 11, color: SLATE, marginBottom: 8, lineHeight: 1.4 }}>
                Fix: {fixAgentDisabledReason}
              </div>
            ) : null}

            {taskNotice ? (
              <div
                data-testid="blanko-insights-task-notice"
                style={{ fontSize: 12, color: SLATE, marginBottom: 10, lineHeight: 1.4 }}
              >
                {taskNotice}
                {onOpenTasks ? (
                  <>
                    {" · "}
                    <button type="button" onClick={onOpenTasks} style={linkBtn}>
                      Open tasks
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {onAddNeighbours ? (
              <button
                type="button"
                data-testid="design-inspect-add-neighbours"
                onClick={onAddNeighbours}
                style={{ ...ghostBtn, marginBottom: 10 }}
              >
                + Add usual neighbours
              </button>
            ) : null}

            {editOpen && onNodeChange && onNodeDelete && (
              <div
                data-testid="blanko-insights-edit"
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${LINE}`,
                  background: PAPER,
                }}
              >
                <DesignInspectPanel
                  variant="embedded"
                  mode="node"
                  node={selectedNode}
                  onChange={onNodeChange}
                  onDelete={onNodeDelete}
                  onClose={() => setEdit(false)}
                  onAddNeighbours={onAddNeighbours}
                  workspaceId={workspaceId}
                  accessToken={accessToken}
                  apiBase={apiBase}
                />
              </div>
            )}

            <details style={{ marginBottom: 12 }}>
              <summary style={detailsSummary}>
                Findings on this piece
                {nodeFindings.length > 0 ? ` · ${nodeFindings.length}` : ""}
                {score != null ? ` · score ${score}` : ""}
              </summary>
              <div style={{ marginTop: 8 }}>
                {nodeFindings.length === 0 ? (
                  <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45 }}>
                    No design findings — use the checks above.
                  </div>
                ) : (
                  nodeFindings.map((f) => (
                    <div
                      key={f.id}
                      data-testid={`blanko-finding-${f.id}`}
                      style={{
                        border: `1px solid ${LINE}`,
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 8,
                        background: CANVAS,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: severityColor(f.severity),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>
                          {f.title}
                        </span>
                        <span
                          style={{
                            fontFamily: FONT_MONO,
                            fontSize: 10,
                            color: SLATE,
                            textTransform: "uppercase",
                          }}
                        >
                          {f.severity}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 8 }}>
                        {f.whyItMatters}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => onHighlight(f)} style={ghostBtn}>
                          Show on canvas
                        </button>
                        {f.fix && onFix && (
                          <button type="button" onClick={() => onFix(f)} style={primaryBtn}>
                            Propose fix
                          </button>
                        )}
                        {onAskFix && (
                          <button type="button" onClick={() => onAskFix(f)} style={ghostBtn}>
                            Ask chat
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </details>

            <div data-testid="blanko-insights-collab-wrap" style={{ marginBottom: 12 }}>
              <NodeCollabSection
                workspaceId={workspaceId ?? null}
                nodeId={selectedNode.id}
                nodeLabel={selectedNode.label}
                apiBase={apiBase}
                accessToken={accessToken ?? null}
              />
            </div>
          </div>

          <div
            data-testid="blanko-insights-node-footer"
            style={{
              position: "sticky",
              bottom: 0,
              marginTop: 8,
              paddingTop: 12,
              paddingBottom: 4,
              borderTop: `1px solid ${LINE}`,
              background: CANVAS,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {onContinueInChat && (
              <button
                type="button"
                data-testid="blanko-insights-continue-chat"
                onClick={() => onContinueInChat(selectedNode)}
                style={primaryBtn}
              >
                Chat
              </button>
            )}
            {linkedFile && onOpenFile && (
              <button
                type="button"
                data-testid="blanko-insights-open-file"
                onClick={() => onOpenFile(linkedFile)}
                style={ghostBtn}
                title={linkedFile}
              >
                Open code
              </button>
            )}
            <button
              type="button"
              data-testid="blanko-insights-edit-toggle"
              onClick={() => setEdit(!editOpen)}
              style={ghostBtn}
            >
              {editOpen ? "Hide edit" : "Edit"}
            </button>
            {onOpenConfig ? (
              <button type="button" onClick={() => onOpenConfig("flow")} style={ghostBtn}>
                Path
              </button>
            ) : null}
            {onOpenTasks ? (
              <button
                type="button"
                data-testid="blanko-insights-open-tasks"
                onClick={onOpenTasks}
                style={ghostBtn}
              >
                Tasks
              </button>
            ) : null}
          </div>
        </div>
      ) : subsystemMode && subsystemBrief ? (
        <div data-testid="blanko-insights-subsystem" style={{ marginBottom: 16 }}>
          <div style={{ ...monoLabel, marginBottom: 6 }}>Subsystem box</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: INK,
              letterSpacing: "-0.02em",
              marginBottom: 4,
            }}
          >
            {subsystemBrief.label}
          </div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
            {subsystemBrief.modules.length} module
            {subsystemBrief.modules.length === 1 ? "" : "s"} in this box
          </div>
          <div
            data-testid="blanko-insights-subsystem-role"
            style={{
              fontSize: 13,
              color: INK,
              lineHeight: 1.45,
              marginBottom: 8,
              padding: 10,
              borderRadius: 10,
              background: PAPER,
              border: `1px solid ${LINE}`,
            }}
          >
            {subsystemBrief.role}
            {subsystemBrief.moneyRule ? (
              <div style={{ marginTop: 8, fontSize: 12, color: ACCENT, fontWeight: 600 }}>
                {subsystemBrief.moneyRule}
              </div>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 11,
              color: SLATE,
              lineHeight: 1.4,
              marginBottom: 12,
              fontFamily: FONT_MONO,
            }}
          >
            {subsystemBrief.readiness}
          </div>

          <div style={{ ...monoLabel, marginBottom: 6 }}>Currently holds</div>
          {subsystemBrief.modules.length === 0 ? (
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
              No modules classified into this box yet.
            </div>
          ) : (
            <div data-testid="blanko-insights-subsystem-modules" style={{ marginBottom: 12 }}>
              {subsystemBrief.modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`blanko-insights-subsystem-module-${m.id}`}
                  onClick={() => onSelectNode?.(m.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    marginBottom: 6,
                    borderRadius: 10,
                    border: `1px solid ${LINE}`,
                    background: PAPER,
                    cursor: onSelectNode ? "pointer" : "default",
                    fontFamily: FONT_UI,
                  }}
                >
                  <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{m.label}</span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: m.buildStatus === "built" ? GOOD : SLATE,
                    }}
                  >
                    {m.buildStatus ?? "unknown"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {showApplyTradingSpine && onApplyTradingSpine && selectedSubsystem === "ingress" ? (
            <div
              style={{
                border: `2px solid ${WARN}`,
                borderRadius: 12,
                padding: 14,
                marginBottom: 8,
                background: PAPER,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: WARN,
                  marginBottom: 6,
                }}
              >
                Setup
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>
                Switch to money-path board
              </div>
              <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 10 }}>
                Ingress modules are scan surfaces until you apply the trading spine
                (Identity → Agent → Strategy → Policy → Risk → Execution → brokers).
              </div>
              <button type="button" onClick={onApplyTradingSpine} style={primaryBtn}>
                Apply trading spine
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div style={{ ...monoLabel, marginBottom: 6 }}>Architecture</div>
          <div
            data-testid="blanko-insights-summary"
            style={{
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${LINE}`,
              background: PAPER,
              fontSize: 13,
              color: INK,
              lineHeight: 1.45,
              marginBottom: 14,
            }}
          >
            {archText}
          </div>

          {showApplyTradingSpine && onApplyTradingSpine ? (
            <div
              data-testid="blanko-apply-trading-spine-cta"
              style={{
                border: `2px solid ${WARN}`,
                borderRadius: 12,
                padding: 14,
                marginBottom: 14,
                background: PAPER,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: WARN,
                  marginBottom: 6,
                }}
              >
                Setup
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 6 }}>
                Switch to money-path board
              </div>
              <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 10 }}>
                This workspace is still a code map of modules. Apply the trading spine to place
                Payment, Policy, Risk, and Execution and wire ingress into that path.
              </div>
              <button
                type="button"
                data-testid="blanko-apply-trading-spine"
                onClick={onApplyTradingSpine}
                style={primaryBtn}
              >
                Apply trading spine
              </button>
            </div>
          ) : null}

          {orphans.length > 0 && !showApplyTradingSpine ? (
            <div
              data-testid="blanko-insights-orphan-warn"
              style={{
                fontSize: 12,
                color: WARN,
                marginBottom: 12,
                lineHeight: 1.4,
              }}
            >
              Orphan presentation pieces: {orphans.map((n) => n.label).join(", ")}. Wire them or re-apply
              the spine.
            </div>
          ) : null}

          <div style={{ ...monoLabel, marginBottom: 8 }}>Workflow · money path</div>
          <div data-testid="blanko-insights-workflow" style={{ marginBottom: 14 }}>
            {hops.length === 0 ? (
              <div style={{ fontSize: 12, color: SLATE }}>No workflow hops yet.</div>
            ) : (
              hops.map((h) => (
                <div
                  key={h.id}
                  data-testid={`blanko-workflow-hop-${h.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: `1px solid ${LINE}`,
                    fontSize: 12,
                  }}
                >
                  <span style={{ flex: 1, color: INK, fontWeight: 600 }}>{h.label}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: SLATE }}>
                    {h.buildStatus}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: h.degree === 0 ? BAD : GOOD,
                    }}
                  >
                    {h.degree === 0 ? "no edges" : `${h.degree} edges`}
                  </span>
                </div>
              ))
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: SLATE }}>
              Path + Tasks board → {configLink("flow", "System · Path")} / Tasks rail
            </div>
          </div>

          <div style={{ ...monoLabel, marginBottom: 8 }}>Tools · surfaces</div>
          <div data-testid="blanko-insights-tools" style={{ marginBottom: 14, fontSize: 12, color: INK, lineHeight: 1.45 }}>
            {tools.length === 0 ? (
              <span style={{ color: SLATE }}>
                No tool catalog on this graph yet (rescan after agent inventory, or open{" "}
                {configLink("agents", "Agents")}).
              </span>
            ) : (
              <>
                {tools.map((t) => t.name).join(" · ")}
                <div style={{ marginTop: 6, fontSize: 11, color: SLATE }}>
                  Full list → {configLink("agents", "Agents")}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {!nodeMode && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={monoLabel}>Design findings</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: SLATE }}>
              score <span style={{ color: INK, fontWeight: 700 }}>{score}</span>
            </div>
          </div>

          {findings.length === 0 ? (
            <div style={{ fontSize: 13, color: SLATE, marginBottom: 16, lineHeight: 1.45 }}>
              No blockers — watch Platforms and Workflow for cost/risk gaps.
            </div>
          ) : (
            findings.map((f) => (
              <div
                key={f.id}
                data-testid={`blanko-finding-${f.id}`}
                style={{
                  border: `1px solid ${LINE}`,
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 8,
                  background: CANVAS,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: severityColor(f.severity),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{f.title}</span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: SLATE,
                      textTransform: "uppercase",
                    }}
                  >
                    {f.severity}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 8 }}>
                  <strong style={{ color: INK }}>Why it matters: </strong>
                  {f.whyItMatters}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => onHighlight(f)}
                    style={ghostBtn}
                    data-testid={`blanko-finding-focus-${f.id}`}
                  >
                    Show on canvas
                  </button>
                  {f.fix && onFix && (
                    <button
                      type="button"
                      onClick={() => onFix(f)}
                      style={primaryBtn}
                      data-testid={`blanko-finding-fix-${f.id}`}
                    >
                      Propose fix
                    </button>
                  )}
                  {onAskFix && (
                    <button type="button" onClick={() => onAskFix(f)} style={ghostBtn}>
                      Ask chat
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          <div style={{ ...monoLabel, marginTop: 18, marginBottom: 8 }}>Platforms · this board</div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 10, lineHeight: 1.4 }}>{platHeadline}</div>
          {inventory.length === 0 ? (
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
              Nothing bound yet. After Apply spine you should see Alpaca / Kraken here.
            </div>
          ) : (
            inventory.slice(0, 24).map((row) => (
              <div
                key={row.provider.id}
                data-testid={`blanko-platform-${row.provider.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                <ProviderIcon providerId={row.provider.id} size={18} />
                <span style={{ flex: 1, fontSize: 13, color: INK }}>{row.provider.name}</span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color:
                      row.status === "connected"
                        ? GOOD
                        : row.status === "missing_credentials"
                          ? WARN
                          : SLATE,
                  }}
                >
                  {row.status}
                </span>
              </div>
            ))
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: SLATE, marginBottom: 12 }}>
            Bind / credentials UI → {configLink("platforms", "System · Platforms")}
          </div>

          <div style={{ ...monoLabel, marginTop: 8, marginBottom: 8 }}>Usage · burn (30d)</div>
          <div
            data-testid="blanko-insights-usage"
            style={{
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${LINE}`,
              background: PAPER,
              fontSize: 12,
              color: SLATE,
              lineHeight: 1.45,
              marginBottom: 8,
            }}
          >
            {usage ? (
              <div style={{ color: INK }}>
                <strong>{cents(usage.costCents)}</strong> · {usage.promptTokens + usage.completionTokens}{" "}
                tokens · {usage.eventCount} events
              </div>
            ) : (
              usageNote || "No burn data yet."
            )}
            {fuelBySubsystem.length > 0 && (
              <div data-testid="blanko-insights-fuel" style={{ marginTop: 8, color: INK }}>
                <div style={{ fontSize: 10, color: SLATE, marginBottom: 4 }}>Trading fuel by subsystem</div>
                {fuelBySubsystem.map((row) => (
                  <div key={row.subsystem} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{row.subsystem}</span>
                    <span style={{ color: SLATE }}>
                      {row.callCount} calls · {cents(row.costCents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              Budgets &amp; by-node burn → {configLink("usage", "Agents · Usage")}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const monoLabel = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  fontWeight: 600 as const,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: SLATE,
};

const detailsSummary = {
  cursor: "pointer" as const,
  fontFamily: FONT_MONO,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: SLATE,
  listStyle: "none" as const,
};

const ghostBtn = {
  padding: "6px 10px",
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  background: CANVAS,
  color: INK,
  fontFamily: FONT_UI,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtn = {
  ...ghostBtn,
  background: INK,
  color: CANVAS,
  border: "1px solid transparent",
};

const linkBtn = {
  border: "none",
  background: "none",
  padding: 0,
  color: ACCENT,
  fontWeight: 700,
  fontSize: "inherit",
  cursor: "pointer",
  fontFamily: FONT_UI,
};

const fileLink = {
  ...linkBtn,
  fontFamily: FONT_MONO,
  fontSize: 11,
  fontWeight: 500,
  color: INK,
  textAlign: "left" as const,
};
