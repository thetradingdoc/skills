import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ArchCanvas } from "./ArchCanvas";
import { ChatPanel, type ChatSession, type ChatMessage } from "./ChatPanel";
import DashboardPanel from "./DashboardPanel";
import { AgentPlanPanel, type AgentPlanData } from "./AgentPlanPanel";
import { AgentTracePanel, type AgentTraceEntryData } from "./AgentTracePanel";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { JiraSyncPanel, type JiraSyncMismatch } from "./JiraSyncPanel";
import { vscode } from "./vscode";
import type { ArchGraph, CriticViolation, GraphCommand } from "./types";
import type { EdgeFilter } from "./analysis/graphAnalyser";
import { styles } from "./styles";
import {
  DesignProposalPanel,
  type ArchitectureProposal,
} from "./DesignProposalPanel";

const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 320;
const CHAT_PANEL_HEIGHT = 260;

interface AgentSessionView {
  planState: unknown;
  currentTaskIndex: number;
  sessionTouchedPaths: string[];
  tokenUsage: number;
  llmCallCount: number;
  retryCounts: Record<string, number>;
  activeGate: string | null;
  stagingIds: string[];
}

interface ProjectHealthPanelProps {
  graph: ArchGraph;
  driftEdges: unknown[];
  missingContextNodes: unknown[];
  criticalFindingsCount: number;
  violations: CriticViolation[];
  jiraIssues: Array<{ key: string; summary: string; status: string; type: string; baseUrl: string; labels?: string[] }>;
}

interface RailTelemetrySummary {
  tokenUsage: number;
  critiqueLoopCount: number;
  pathSuccessRate: number;
  retryCount?: number;
  retryLimit?: number;
}

interface RailOverlapSummary {
  railId: string;
  sharedJira: string[];
  sharedNodes: string[];
  outcome?: string;
  state?: string;
}

interface LogicPathStepSummary {
  layer: string;
  nodeId: string;
}

interface RailSummary {
  id: string;
  outcome: string;
  state: string;
  archetype?: string;
  overlapCount?: number;
  overlaps?: RailOverlapSummary[];
  jiraKeys?: string[];
  logicPath?: LogicPathStepSummary[];
  hallucinationIndex?: number;
}

interface TaskSummary {
  id: string;
  railId: string;
  description: string;
  kind: string;
  status: string;
  agent?: string;
  jiraKey?: string;
  files?: string[];
}

/** Section 11.5: Expandable collaborator badge with overlapping rails and deep links. */
function RailCollaboratorBadge({
  overlaps,
  allRails,
  onJumpToRail,
}: {
  overlaps: RailOverlapSummary[];
  allRails: RailSummary[];
  onJumpToRail?: (railId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = overlaps.length;
  if (count === 0) return null;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          fontSize: 10,
          borderRadius: 999,
          padding: "1px 6px",
          border: "1px solid rgba(88,166,255,0.4)",
          background: "rgba(88,166,255,0.1)",
          color: "#58a6ff",
          cursor: "pointer",
        }}
        title="Also touched by other rails"
      >
        {count} collaborator{count > 1 ? "s" : ""} {expanded ? "∧" : "∨"}
      </button>
      {expanded && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            minWidth: 180,
            maxWidth: 220,
            padding: 8,
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 6,
            zIndex: 10,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {overlaps.map((o) => {
            const rail = allRails.find((r) => r.id === o.railId);
            const label = rail?.outcome || o.outcome || o.railId;
            return (
              <div
                key={o.railId}
                style={{
                  padding: "4px 0",
                  borderBottom: "1px solid #21262d",
                  fontSize: 10,
                }}
              >
                <div style={{ color: "#e6edf3", fontWeight: 500 }}>{label}</div>
                <div style={{ color: "#8b949e", fontSize: 9 }}>
                  {o.sharedNodes?.slice(0, 2).join(", ")}
                  {o.sharedNodes && o.sharedNodes.length > 2 ? "…" : ""}
                </div>
                {onJumpToRail && (
                  <button
                    onClick={() => {
                      onJumpToRail(o.railId);
                      setExpanded(false);
                    }}
                    style={{
                      marginTop: 4,
                      padding: "2px 6px",
                      fontSize: 9,
                      background: "transparent",
                      border: "1px solid #58a6ff",
                      color: "#58a6ff",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    Jump to rail
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectHealthPanel({
  graph,
  driftEdges,
  missingContextNodes,
  criticalFindingsCount,
  violations,
  jiraIssues,
}: ProjectHealthPanelProps) {
  const highCount = violations.filter((v) => v.severity === "high").length;
  const trackedCount = violations.filter((v) => v.jiraKey).length;
  const untrackedCount = violations.length - trackedCount;

  const cells = [
    {
      val: criticalFindingsCount,
      label: "Critical",
      color: criticalFindingsCount > 0 ? "#f85149" : "#3fb950",
      sub:
        criticalFindingsCount > 0
          ? `↑ ${criticalFindingsCount} active`
          : "none",
      subColor: "#f85149",
    },
    {
      val: highCount,
      label: "High severity",
      color: highCount > 0 ? "#d29922" : "#3fb950",
      sub: highCount > 0 ? `↑ ${highCount} open` : "none",
      subColor: "#d29922",
    },
    {
      val: violations.length,
      label: "Total violations",
      color: "#e6edf3",
      sub: "— all time",
      subColor: "#7d8590",
    },
    {
      val: trackedCount,
      label: "Tracked in Jira",
      color: "#3fb950",
      sub:
        untrackedCount > 0
          ? `↓ ${untrackedCount} untracked`
          : "all tracked",
      subColor: "#3fb950",
    },
  ];

  return (
    <div style={{ ...styles.panel, padding: 0 }}>
      <div
        style={{
          padding: "10px 14px 6px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "#8b949e",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          ⚡ Project health
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderTop: "1px solid #21262d",
        }}
      >
        {cells.map((c, i) => (
          <div
            key={c.label}
            style={{
              padding: "14px 16px",
              borderRight: i % 2 === 0 ? "1px solid #21262d" : "none",
              borderBottom: i < 2 ? "1px solid #21262d" : "none",
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: c.color,
                fontFamily: "monospace",
              }}
            >
              {c.val}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#c9d1d9",
                marginTop: 2,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontSize: 10,
                color: c.subColor,
                marginTop: 4,
              }}
            >
              {c.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GovernancePanelProps {
  jiraIssues: Array<{ key: string; summary: string; status: string; type: string; baseUrl: string; labels?: string[] }>;
  jiraLoading: boolean;
  jiraError: string | null;
  jiraFilterByRepo: boolean;
  jiraRepoName: string | null;
  /** Currently selected Jira project key (e.g. DOCLP), if any. */
  jiraProjectKey: string | null;
  jiraStaleMismatches: JiraSyncMismatch[];
  jiraBaseUrl?: string;
  hasCorrections: boolean;
  graphExists: boolean;
  /** Optional callback when user clicks Settings in Governance panel (wired when modal exists). */
  onOpenSettings?: () => void;
  /** Latest structured violations from the critic, for the Governance Violations tab. */
  violations: CriticViolation[];
  onToggleFilter: () => void;
  onRefresh: () => void;
  onRetag: (key: string) => void;
  onArchive: (key: string) => void;
  onKeep: (key: string) => void;
  onAddLabel: (key: string) => void;
  onGenerateRules: () => void;
}

function GovernancePanel({
  jiraIssues,
  jiraLoading,
  jiraError,
  jiraFilterByRepo,
  jiraRepoName,
  jiraStaleMismatches,
  jiraBaseUrl,
  hasCorrections,
  graphExists,
  onOpenSettings,
  violations,
  jiraProjectKey,
  onToggleFilter,
  onRefresh,
  onRetag,
  onArchive,
  onKeep,
  onAddLabel,
  onGenerateRules,
}: GovernancePanelProps) {
  const isConnected = !!jiraBaseUrl && !jiraError;
  const hasProject = !!jiraProjectKey;

  return (
    <div>
      <div
        style={{
          ...styles.sectionHeader,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        Governance
      </div>

      {/* Connection status pill */}
      <div
        style={{
          marginTop: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 12px",
            borderRadius: 20,
            border: "1px solid #30363d",
            background: isConnected ? "rgba(63,185,80,0.1)" : "#161b22",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: isConnected ? "#3fb950" : "#8b949e",
            }}
          >
            {isConnected ? "● Connected" : "○ Not connected"}
          </span>
        </div>
      </div>

      {/* Project scope row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 0",
          marginBottom: 8,
          fontSize: 12,
        }}
      >
        <span style={{ color: "#8b949e" }}>Project scope</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hasProject ? (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
                border: "1px solid #30363d",
                color: "#e6edf3",
                fontFamily: "monospace",
              }}
            >
              {jiraProjectKey!.toUpperCase()}
            </span>
          ) : (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
                border: "1px dashed #30363d",
                color: "#484f58",
              }}
            >
              No project selected
            </span>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              style={{
                background: "transparent",
                border: "none",
                color: "#58a6ff",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
            >
              {hasProject ? "Change" : "Choose"}
            </button>
          )}
        </div>
      </div>

      {/* Governance metrics */}
      {isConnected && (
      <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 10 }}>
        <div
          style={{
            flex: 1,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #30363d",
            background: "#161b22",
          }}
        >
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "#58a6ff",
                marginBottom: 2,
                fontFamily: "monospace",
              }}
            >
            {jiraIssues.length}
          </div>
          <div style={{ color: "#8b949e" }}>Jira issues</div>
        </div>
        <div
          style={{
            flex: 1,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #30363d",
            background: "#161b22",
          }}
        >
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: jiraStaleMismatches.length > 0 ? "#f0883e" : "#3fb950",
                marginBottom: 2,
                fontFamily: "monospace",
              }}
            >
            {jiraStaleMismatches.length}
          </div>
          <div style={{ color: "#8b949e" }}>Stale mismatches</div>
        </div>
      </div>
      )}

      {jiraError && (
        <div style={{ fontSize: 11, color: "#f85149", marginBottom: 8 }}>{jiraError}</div>
      )}

      {jiraStaleMismatches.length > 0 && isConnected && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 8,
            background: "rgba(210,153,34,0.1)",
            border: "1px solid #9e6a03",
            fontSize: 11,
            color: "#d29922",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <span>△</span>
          <span>
            {jiraStaleMismatches.length} issue{jiraStaleMismatches.length > 1 ? "s" : ""} may be
            stale — module fingerprint has changed.{" "}
            {/* Clicking review will focus the issues list below */}
            <span style={{ color: "#58a6ff", cursor: "pointer" }}>Review</span>
          </span>
        </div>
      )}

      {jiraStaleMismatches.length > 0 && (
        <JiraSyncPanel
          mismatches={jiraStaleMismatches}
          baseUrl={jiraBaseUrl}
          onRetag={onRetag}
          onArchive={onArchive}
          onKeep={onKeep}
        />
      )}
      <div style={{ maxHeight: 140, overflowY: "auto", fontSize: 11 }}>
        {jiraIssues.length === 0 && !jiraLoading && !jiraError && isConnected && hasProject && (
          <div style={{ color: "#7d8590" }}>No unresolved Jira issues for this project</div>
        )}
        {jiraIssues.length === 0 && !jiraLoading && !jiraError && isConnected && !hasProject && (
          <div style={{ color: "#7d8590" }}>
            Choose a project above to fetch Jira issues.
          </div>
        )}
        {jiraIssues.map((j) => {
          const canAddToRepo =
            !jiraFilterByRepo && jiraRepoName && !(j.labels ?? []).includes(jiraRepoName);
          return (
            <div
              key={j.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 0",
                borderBottom: "1px solid #21262d",
              }}
            >
              <a
                href={`${j.baseUrl}/browse/${j.key}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "#58a6ff",
                  textDecoration: "none",
                }}
              >
                <span style={{ color: "#8b949e" }}>{j.key}</span> {j.summary}
                <span style={{ color: "#7d8590", marginLeft: 6 }}>{j.status}</span>
              </a>
              {canAddToRepo && (
                <button
                  onClick={() => onAddLabel(j.key)}
                  style={{
                    ...styles.buttonBase,
                    padding: "2px 6px",
                    fontSize: 10,
                    height: 20,
                    flexShrink: 0,
                  }}
                >
                  + Repo
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Governance actions – primary CTA depends on connection/project state */}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => {
            if (!isConnected && onOpenSettings) {
              onOpenSettings();
              return;
            }
            if (isConnected && !hasProject && onOpenSettings) {
              onOpenSettings();
              return;
            }
            onRefresh();
          }}
          disabled={!isConnected}
        style={{
          ...styles.buttonBase,
          width: "100%",
            background: !isConnected ? "#21262d" : "#238636",
            color: !isConnected ? "#7d8590" : "white",
            border: `1px solid ${!isConnected ? "#30363d" : "#238636"}`,
          }}
        >
          {!isConnected
            ? "Connect Jira"
            : !hasProject
            ? "Choose project"
            : "View issues"}
      </button>
      </div>
    </div>
  );
}

interface JiraSettingsModalProps {
  open: boolean;
  onClose: () => void;
  jiraBaseUrl?: string;
  jiraRepoName: string | null;
  jiraFilterByRepo: boolean;
  /** Currently selected Jira project key, if any. */
  jiraProjectKey: string | null;
  onToggleFilter: () => void;
  /** Persist a new Jira project key and trigger a refresh. */
  onSaveProjectKey: (projectKey: string | null) => void;
}

function JiraSettingsModal({
  open,
  onClose,
  jiraBaseUrl,
  jiraRepoName,
  jiraFilterByRepo,
  jiraProjectKey,
  onToggleFilter,
  onSaveProjectKey,
}: JiraSettingsModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: 12,
          boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #30363d",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Jira settings</span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "14px 16px", fontSize: 12, color: "#c9d1d9" }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>Jira base URL</div>
            <div style={{ fontFamily: "monospace" }}>
              {jiraBaseUrl ?? "Not configured (JIRA_BASE_URL env not set)"}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>Repo label</div>
            <div style={{ fontFamily: "monospace" }}>
              {jiraRepoName ?? "Auto-detected from git remote"}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>Project key</div>
            <input
              defaultValue={jiraProjectKey ?? ""}
              placeholder="e.g. DOCLP"
              onBlur={(e) => {
                const raw = e.target.value.trim();
                onSaveProjectKey(raw ? raw.toUpperCase() : null);
              }}
              style={{
                width: "100%",
                padding: "6px 8px",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#e6edf3",
                fontSize: 12,
                fontFamily: "monospace",
                outline: "none",
              }}
            />
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 4 }}>
              Sets which Jira project to query for issues (e.g. DOCLP).
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #30363d",
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>Filter by this repository</div>
              <div style={{ fontSize: 11, color: "#8b949e" }}>
                When on, only Jira issues labeled with this repo are shown.
              </div>
            </div>
            <button
              onClick={onToggleFilter}
              style={{
                width: 34,
                height: 18,
                borderRadius: 999,
                border: "1px solid #30363d",
                background: jiraFilterByRepo ? "#238636" : "#161b22",
                position: "relative",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: jiraFilterByRepo ? 16 : 2,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#f0f6fc",
                  transition: "left 0.15s ease",
                }}
              />
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            Jira in the extension is configured via environment variables (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).
          </div>
          <button
            onClick={() => {
              vscode.postMessage({ type: "jiraSettingsHelp" });
              onClose();
            }}
            style={{
              ...styles.buttonBase,
              ...styles.buttonSecondary,
              width: "100%",
              marginTop: 4,
            }}
          >
            How do I configure Jira?
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [graph, setGraph] = useState<ArchGraph | null>(null);
  const [loading, setLoading] = useState("Initializing...");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("architectural");
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);
  const [layerFilter, setLayerFilter] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [dividerHover, setDividerHover] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([{ id: "chat-1", label: "Chat 1", history: [] }]);
  const [activeChatId, setActiveChatId] = useState("chat-1");
  const [writeStatus, setWriteStatus] = useState<"idle" | "success" | "error">("idle");
  const [writeError, setWriteError] = useState<string | null>(null);
  const [rulesPreview, setRulesPreview] = useState<{
    rules: { id: string; description: string; severity: string }[];
    raw: string;
  } | null>(null);
  const [rulesEditMode, setRulesEditMode] = useState(false);
  const [generateRulesStatus, setGenerateRulesStatus] = useState<"idle" | "success" | "error">("idle");
  const [fileContentMap, setFileContentMap] = useState<
    Record<string, { content: string | null; error?: string }>
  >({});
  const [chatLoading, setChatLoading] = useState(false);
  const [jiraIssues, setJiraIssues] = useState<
    Array<{ key: string; summary: string; status: string; type: string; baseUrl: string; labels?: string[] }>
  >([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraProjectKey, setJiraProjectKey] = useState<string | null>(null);
  const [agentGoal, setAgentGoal] = useState("");
  const [agentPlan, setAgentPlan] = useState<AgentPlanData | null>(null);
  const [agentPlanError, setAgentPlanError] = useState<string | null>(null);
  const [traceEntries, setTraceEntries] = useState<AgentTraceEntryData[]>([]);
  const [stagingEntries, setStagingEntries] = useState<Array<{ path: string; content: string; taskId?: string }>>([]);
  const [agentSession, setAgentSession] = useState<AgentSessionView | null>(null);
  const [tokenWarning, setTokenWarning] = useState<{ usage: number; budget: number } | null>(null);
  const [sessionRecovery, setSessionRecovery] = useState<unknown>(null);
  const [ruleProposal, setRuleProposal] = useState<{
    category: string;
    currentRule: string;
    proposedRule: string;
    rationale: string;
    affectedModules: string[];
  } | null>(null);
  const [replayEntries, setReplayEntries] = useState<AgentTraceEntryData[] | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [jiraStaleMismatches, setJiraStaleMismatches] = useState<JiraSyncMismatch[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | undefined>();
  const [jiraFilterByRepo, setJiraFilterByRepo] = useState(true);
  const [jiraRepoName, setJiraRepoName] = useState<string | null>(null);
  const [jiraResolvePrompt, setJiraResolvePrompt] = useState<
    Array<{ key: string; summary: string; module: string; baseUrl: string }>
  >([]);
  const [partialPlanFailure, setPartialPlanFailure] = useState<{
    failedTaskIndex: number;
    committedCount: number;
    failedTaskId: string;
  } | null>(null);
  const [architectureProposal, setArchitectureProposal] =
    useState<ArchitectureProposal | null>(null);
  const [showJiraSettings, setShowJiraSettings] = useState(false);
  const [criticViolations, setCriticViolations] = useState<CriticViolation[]>([]);
  const [violationsOpen, setViolationsOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [rails, setRails] = useState<RailSummary[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [railTelemetry, setRailTelemetry] = useState<Record<string, RailTelemetrySummary>>({});
  const [playwrightHitl, setPlaywrightHitl] = useState<{
    railId: string;
    failures: Array<{ testName: string; error: string; screenshotPath?: string }>;
    tracePath?: string;
    spec: string;
  } | null>(null);
  const [costGate, setCostGate] = useState<{
    gate: "token_budget_exceeded" | "session_llm_limit";
    tokenUsage: number;
    tokenBudget: number;
    llmCallCount: number;
    llmLimit: number;
  } | null>(null);
  const [failedRailHitl, setFailedRailHitl] = useState<{ railId: string; reason: string } | null>(null);
  const [focusedRailId, setFocusedRailId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [agentActive, setAgentActive] = useState(true);
  const tasksPanelRef = useRef<HTMLDivElement>(null);
  const failedRailsSeenRef = useRef<Set<string>>(new Set());
  const selectedNodeData = graph?.nodes.find((n) => n.id === selectedNode);

  const openVerificationTasks = useMemo(
    () => tasks.filter((t) => t.kind === "verification" && t.status !== "completed"),
    [tasks]
  );
  const hitlPendingTasks = useMemo(
    () => tasks.filter((t) => t.status === "awaiting_hitl"),
    [tasks]
  );
  const collaboratorWarnings = useMemo(
    () => rails.filter((r) => (r.overlapCount ?? 0) > 0),
    [rails]
  );
  const [dismissedVisualRailIds, setDismissedVisualRailIds] = useState<string[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"dashboard" | "chat">("dashboard");
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const dashboardScrollRef = useRef(0);
  const chatScrollRef = useRef(0);
  const [dashboardLastSeenViolations, setDashboardLastSeenViolations] = useState(0);
  const [activeRailOverrideId, setActiveRailOverrideId] = useState<string | null>(null);
  const [activeRailOpen, setActiveRailOpen] = useState(true);

  // ── Zone 1: Command strip derived labels ───────────────────────────────────
  const tokenUsageValue =
    agentSession?.tokenUsage ??
    tokenWarning?.usage ??
    costGate?.tokenUsage ??
    null;
  const tokenBudgetValue =
    tokenWarning?.budget ??
    costGate?.tokenBudget ??
    null;
  const tokenLabel =
    tokenUsageValue == null
      ? "Tokens: —"
      : sidebarWidth < 300
        ? `Tokens: ${Math.round(tokenUsageValue / 1000)}k`
        : tokenBudgetValue != null
          ? `Tokens: ${tokenUsageValue.toLocaleString()} / ${tokenBudgetValue.toLocaleString()}`
          : `Tokens: ${tokenUsageValue.toLocaleString()}`;
  const projectLabel = jiraProjectKey ?? jiraRepoName ?? "No project";

  // ── Zone 3: Active rail selection ──────────────────────────────────────────
  const activeRailId = useMemo(() => {
    if (!rails.length) return null;
    if (activeRailOverrideId && rails.some((r) => r.id === activeRailOverrideId)) {
      return activeRailOverrideId;
    }
    const byState = (state: string) => rails.find((r) => r.state === state);
    const failedOrAwaiting =
      byState("AWAITING_HITL") ||
      byState("FAILED");
    if (failedOrAwaiting) return failedOrAwaiting.id;
    const executing = byState("EXECUTING");
    if (executing) return executing.id;
    return rails[0]?.id ?? null;
  }, [rails, activeRailOverrideId]);

  const activeRail = useMemo(
    () => (activeRailId ? rails.find((r) => r.id === activeRailId) ?? null : null),
    [rails, activeRailId]
  );

  const activeRailTasks = useMemo(
    () => (activeRail ? tasks.filter((t) => t.railId === activeRail.id) : []),
    [activeRail, tasks]
  );

  const hasAttentionItems =
    !!failedRailHitl ||
    hitlPendingTasks.length > 0 ||
    !!costGate ||
    !!playwrightHitl ||
    collaboratorWarnings.length > 0;

  const [projectHealthOpen, setProjectHealthOpen] = useState<boolean>(() => !(hasAttentionItems || !!activeRail));
  const [governanceOpen, setGovernanceOpen] = useState<boolean>(() => !(hasAttentionItems || !!activeRail));

  // Keyboard shortcuts for top-priority attention item (Enter/Esc)
  const hasFetchedJiraTestsRef = useRef(false);

  useEffect(() => {
    if (!hasAttentionItems) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      const items: {
        kind:
          | "failed_rail"
          | "hitl_gate"
          | "cost_gate"
          | "playwright_hitl"
          | "visual_critique"
          | "collaborator_overlap";
        priority: number;
      }[] = [];
      if (failedRailHitl) {
        items.push({ kind: "failed_rail", priority: 0 });
      }
      if (hitlPendingTasks.length > 0) {
        items.push({ kind: "hitl_gate", priority: 1 });
      }
      if (costGate) {
        items.push({ kind: "cost_gate", priority: 2 });
      }
      const hasPlaywright = !!playwrightHitl;
      const hasVisualWithinPlaywright =
        !!playwrightHitl &&
        playwrightHitl.failures.some(
          (f) => f.testName.includes("[VISUAL]") || f.error.includes("[VISUAL]")
        );
      if (hasPlaywright) {
        items.push({ kind: "playwright_hitl", priority: 3 });
      }
      if (
        hasVisualWithinPlaywright &&
        playwrightHitl &&
        !dismissedVisualRailIds.includes(playwrightHitl.railId)
      ) {
        items.push({ kind: "visual_critique", priority: 4 });
      }
      if (collaboratorWarnings.length > 0) {
        items.push({ kind: "collaborator_overlap", priority: 5 });
      }
      if (!items.length) return;
      const top = items.sort((a, b) => a.priority - b.priority)[0];
      if (!top) return;
      e.preventDefault();
      if (top.kind === "failed_rail" && failedRailHitl) {
        if (e.key === "Enter") {
          setFocusedRailId(failedRailHitl.railId);
          setFailedRailHitl(null);
        } else if (e.key === "Escape") {
          vscode.postMessage({
            type: "failRailHitlAction",
            railId: failedRailHitl.railId,
            action: "abandon",
          });
          setFailedRailHitl(null);
        }
      } else if (top.kind === "hitl_gate" && hitlPendingTasks.length > 0) {
        if (e.key === "Enter" && tasksPanelRef.current) {
          tasksPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } else if (top.kind === "cost_gate" && costGate) {
        if (e.key === "Enter") {
          vscode.postMessage({
            type: "agentCostGateAction",
            action: "extend",
            amount: 20_000,
          });
          setCostGate(null);
        } else if (e.key === "Escape") {
          vscode.postMessage({
            type: "agentCostGateAction",
            action: "abort",
          });
          setCostGate(null);
        }
      } else if (top.kind === "playwright_hitl" && playwrightHitl) {
        if (e.key === "Enter") {
          vscode.postMessage({
            type: "playwrightHitlAction",
            railId: playwrightHitl.railId,
            action: "retry",
          });
          setPlaywrightHitl(null);
        } else if (e.key === "Escape") {
          vscode.postMessage({
            type: "playwrightHitlAction",
            railId: playwrightHitl.railId,
            action: "suspend",
          });
          setPlaywrightHitl(null);
        }
      } else if (top.kind === "visual_critique" && playwrightHitl) {
        if (e.key === "Enter") {
          vscode.postMessage({
            type: "playwrightHitlAction",
            railId: playwrightHitl.railId,
            action: "create_jira",
          });
          setPlaywrightHitl(null);
        } else if (e.key === "Escape") {
          setDismissedVisualRailIds((prev) =>
            prev.includes(playwrightHitl.railId) ? prev : [...prev, playwrightHitl.railId]
          );
        }
      } else if (top.kind === "collaborator_overlap" && collaboratorWarnings.length > 0) {
        if (e.key === "Enter") {
          setFocusedRailId(collaboratorWarnings[0].id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    hasAttentionItems,
    failedRailHitl,
    hitlPendingTasks.length,
    costGate,
    playwrightHitl,
    collaboratorWarnings,
    dismissedVisualRailIds,
  ]);

  useEffect(() => {
    if (!focusedRailId && !focusedTaskId) return;
    const el = focusedTaskId
      ? document.querySelector(`[data-task-id="${focusedTaskId}"]`)
      : document.querySelector(`[data-rail-id="${focusedRailId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const t = setTimeout(() => {
      setFocusedRailId(null);
      setFocusedTaskId(null);
    }, 2000);
    return () => clearTimeout(t);
  }, [focusedRailId, focusedTaskId]);

  const handleSaveContext = useCallback(
    (layer: string, description: string) => {
      if (!selectedNode) return;
      vscode.postMessage({
        type: "writeContext",
        nodeId: selectedNode,
        layer,
        description: description || undefined,
        role: selectedNodeData?.suggestedLabel ?? selectedNodeData?.role ?? undefined,
      });
    },
    [selectedNode, selectedNodeData]
  );

  const missingContextNodes = graph?.nodes.filter((n) => !n.health?.hasContext) ?? [];
  const hasCorrections = graph?.nodes.some((n) => n.layer && n.layer !== "Uncategorized") ?? false;
  const driftEdges = graph?.edges.filter((e) => e.isDrift) ?? [];
  const criticalFindingsCount =
    graph?.findings?.filter((f) => f.severity === "critical").length ?? 0;
  const modulesCount = graph?.nodes.length ?? 0;
  const noContextCount = missingContextNodes.length;
  const activeViolationsCount = criticViolations.length;

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "graph" || msg.type === "graphUpdate") {
        setGraph(msg.data);
        setLoading("");
      } else if (msg.type === "loading") {
        setLoading(msg.message);
      } else if (msg.type === "error") {
        setLoading(`Error: ${msg.message}`);
      } else if (msg.type === "violations") {
        if (Array.isArray(msg.violations)) {
          setCriticViolations(msg.violations as CriticViolation[]);
        } else {
          setCriticViolations([]);
        }
      } else if (msg.type === "aiResponse") {
        setChatLoading(false);
        setChats((prev) =>
          prev.map((c) =>
            c.id === activeChatId
              ? { ...c, history: [...c.history, { role: "assistant", content: msg.answer }] }
              : c
          )
        );
        if (msg.proposal) {
          setArchitectureProposal(msg.proposal as ArchitectureProposal);
        } else {
          setArchitectureProposal(null);
        }
        if (Array.isArray(msg.violations)) {
          setCriticViolations(msg.violations as CriticViolation[]);
        } else {
          setCriticViolations([]);
        }
        const cmd = msg.graphCommand as GraphCommand | undefined;
        if (cmd) {
          if (cmd.action === "filter_edge_type") {
            const map: Record<string, EdgeFilter> = {
              arch: "architectural",
              drift: "drift",
              violations: "violations",
              all: "all",
            };
            setEdgeFilter(map[cmd.edgeType] ?? "architectural");
            setHighlightedNodeIds([]);
            setLayerFilter(null);
          } else if (cmd.action === "filter_layer") {
            setLayerFilter(cmd.layer);
            setHighlightedNodeIds([]);
          } else if (cmd.action === "highlight_nodes") {
            setHighlightedNodeIds(cmd.nodeIds);
            setLayerFilter(null);
          } else if (cmd.action === "focus_node") {
            setSelectedNode(cmd.nodeId);
            setHighlightedNodeIds([]);
          } else if (cmd.action === "reset") {
            setEdgeFilter("architectural");
            setSelectedNode(null);
            setHighlightedNodeIds([]);
            setLayerFilter(null);
          }
        }
      } else if (msg.type === "writeContextResult") {
        setWriteStatus(msg.success ? "success" : "error");
        setWriteError(msg.error ?? null);
      } else if (msg.type === "rulesPreview") {
        setRulesPreview({ rules: msg.rules, raw: msg.raw });
        setRulesEditMode(false);
        setGenerateRulesStatus("idle");
      } else if (msg.type === "generateRulesResult") {
        setGenerateRulesStatus(msg.success ? "success" : "error");
        if (msg.success) setRulesPreview(null);
        if (msg.error) setWriteError(msg.error);
      } else if (msg.type === "fileContent") {
        setFileContentMap((prev) => ({
          ...prev,
          [msg.filePath]: { content: msg.content, error: msg.error },
        }));
      } else if (msg.type === "validationResult") {
        setLoading("");
      }
      if (msg.type === "jiraIssues") {
        setJiraLoading(false);
        setJiraError(null);
        setJiraIssues(msg.issues);
        setJiraStaleMismatches(msg.staleMismatches ?? []);
        setJiraBaseUrl(msg.issues[0]?.baseUrl);
        setJiraRepoName(msg.repoName ?? null);
        setJiraProjectKey(msg.projectKey ?? null);
      } else if (msg.type === "jiraIssuesError") {
        setJiraLoading(false);
        setJiraError(msg.error);
        setJiraIssues([]);
      }
      if (msg.type === "tasksSnapshot") {
        const rs: RailSummary[] = Array.isArray(msg.rails)
          ? msg.rails.map((r: any) => ({
              id: String(r.id),
              outcome: String(r.outcome ?? ""),
              state: String(r.state ?? ""),
              archetype: r.archetype,
              overlapCount: Array.isArray(r.overlaps) ? r.overlaps.length : 0,
              logicPath: Array.isArray(r.logicPath)
                ? r.logicPath.map((s: any) => ({ layer: String(s.layer ?? ""), nodeId: String(s.nodeId ?? "") }))
                : undefined,
              hallucinationIndex: typeof r.hallucinationIndex === "number" ? r.hallucinationIndex : undefined,
              overlaps: Array.isArray(r.overlaps)
                ? r.overlaps.map((o: any) => ({
                    railId: String(o.railId ?? ""),
                    sharedJira: Array.isArray(o.sharedJira) ? o.sharedJira : [],
                    sharedNodes: Array.isArray(o.sharedNodes) ? o.sharedNodes : [],
                    outcome: o.outcome,
                    state: o.state,
                  }))
                : undefined,
              jiraKeys: Array.isArray(r.jiraKeys) ? r.jiraKeys : [],
            }))
          : [];
        const ts: TaskSummary[] = Array.isArray(msg.tasks)
          ? msg.tasks.map((t: any) => ({
              id: String(t.id),
              railId: String(t.railId),
              description: String(t.description ?? ""),
              kind: String(t.kind ?? ""),
              status: String(t.status ?? ""),
              agent: t.agent,
              jiraKey: t.jiraKey,
              files: Array.isArray(t.files) ? t.files : undefined,
            }))
          : [];
        const tel = msg.telemetry && typeof msg.telemetry === "object" ? (msg.telemetry as Record<string, RailTelemetrySummary>) : {};
        setRails(rs);
        setTasks(ts);
        setRailTelemetry(tel);

        // HITL escalation when a rail enters FAILED with a meta HITL task.
        const unseenFailed = rs.find((r) => r.state === "FAILED" && !failedRailsSeenRef.current.has(r.id));
        if (unseenFailed) {
          failedRailsSeenRef.current.add(unseenFailed.id);
          const failTask = ts.find(
            (t) =>
              t.railId === unseenFailed.id &&
              t.kind === "meta" &&
              t.status === "awaiting_hitl"
          );
          if (failTask) {
            setFailedRailHitl({
              railId: unseenFailed.id,
              reason: failTask.description || "Rail failed",
            });
          }
        }
      }
      if (msg.type === "taskUpdate") {
        const { taskId, update } = msg as { taskId: string; update: Partial<TaskSummary> };
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...update } : t))
        );
      }
      if (msg.type === "railUpdate") {
        const { railId, update } = msg as { railId: string; update: Partial<RailSummary> };
        setRails((prev) =>
          prev.map((r) => (r.id === railId ? { ...r, ...update } : r))
        );
      }
      if (msg.type === "agentPlan") {
        setAgentPlan(msg.plan);
        setAgentPlanError(null);
      } else if (msg.type === "agentPlanValidationError") {
        setAgentPlan(null);
        setAgentPlanError(msg.error);
      } else if (msg.type === "agentTrace") {
        setTraceEntries((prev) => [...prev, msg.entry]);
      } else if (msg.type === "agentTraceBatch") {
        setTraceEntries((prev) => [...prev, ...msg.entries]);
      }
      if (msg.type === "agentStagingEntries") {
        setStagingEntries(msg.entries);
      }
      if (msg.type === "agentJiraAddLabelResult" && msg.success && msg.label) {
        setJiraIssues((prev) =>
          prev.map((i) =>
            i.key === msg.key
              ? { ...i, labels: [...(i.labels ?? []), msg.label] }
              : i
          )
        );
      }
      if (msg.type === "agentTokenWarning") {
        setTokenWarning({ usage: msg.usage, budget: msg.budget });
      }
      if (msg.type === "agentSessionRecovery") {
        setSessionRecovery(msg.session);
      }
      if (msg.type === "agentSessionUpdate") {
        setAgentSession(msg.session as AgentSessionView);
      }
      if (msg.type === "agentJiraResolvePrompt") {
        setJiraResolvePrompt(msg.issues ?? []);
      }
      if (msg.type === "agentPartialPlanFailure") {
        setPartialPlanFailure({
          failedTaskIndex: msg.failedTaskIndex,
          committedCount: msg.committedCount,
          failedTaskId: msg.failedTaskId,
        });
      }
      if (msg.type === "agentProposeRuleChange") {
        setRuleProposal(msg.proposal);
      }
      if (msg.type === "agentTraceExport") {
        const blob = new Blob([msg.json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `agent-trace-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      if (msg.type === "playwrightHitl") {
        setPlaywrightHitl({
          railId: msg.railId,
          failures: msg.failures ?? [],
          tracePath: msg.tracePath,
          spec: msg.spec ?? "",
        });
      }
      if (msg.type === "agentActive") {
        setAgentActive(msg.active);
      }
      if (msg.type === "agentCostGate") {
        setCostGate({
          gate: msg.gate,
          tokenUsage: msg.tokenUsage,
          tokenBudget: msg.tokenBudget,
          llmCallCount: msg.llmCallCount,
          llmLimit: msg.llmLimit,
        });
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, [activeChatId]);

  const handleRequestPlan = useCallback(() => {
    if (!agentGoal.trim()) return;
    setAgentPlan(null);
    setAgentPlanError(null);
    vscode.postMessage({ type: "requestPlan", goal: agentGoal.trim() });
  }, [agentGoal]);

  const fetchJiraTests = useCallback(
    (filterByRepo?: boolean, projectKeyOverride?: string | null) => {
      setJiraLoading(true);
      setJiraError(null);
      const useFilter = filterByRepo ?? jiraFilterByRepo;
      vscode.postMessage({
        type: "fetchJiraTests",
        filterByRepo: useFilter,
        projectKey: projectKeyOverride ?? jiraProjectKey ?? undefined,
      });
    },
    [jiraFilterByRepo, jiraProjectKey]
  );

  useEffect(() => {
    if (hasFetchedJiraTestsRef.current) return;
    hasFetchedJiraTestsRef.current = true;
    fetchJiraTests();
  }, [fetchJiraTests]);

  const handleAsk = useCallback(
    (message: string, history: ChatMessage[]) => {
      setArchitectureProposal(null);
      setChatLoading(true);
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId
            ? { ...c, history: [...c.history, { role: "user", content: message }] }
            : c
        )
      );
      vscode.postMessage({
        type: "askAI",
        question: message,
        nodeId: selectedNode ?? undefined,
        history,
      });
    },
    [activeChatId, selectedNode]
  );

  const addChat = useCallback(() => {
    const nextNum = chats.length + 1;
    const id = `chat-${nextNum}`;
    setChats((prev) => [...prev, { id, label: `Chat ${nextNum}`, history: [] }]);
    setActiveChatId(id);
  }, [chats.length]);

  const handleMouseDown = useCallback(() => setResizing(true), []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const w = typeof window !== "undefined" ? e.clientX : SIDEBAR_DEFAULT;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
    };
    const onUp = () => setResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  // Restore per-tab scroll position when switching tabs
  useEffect(() => {
    if (!sidebarRef.current) return;
    if (sidebarTab === "dashboard") {
      sidebarRef.current.scrollTop = dashboardScrollRef.current;
    } else {
      sidebarRef.current.scrollTop = chatScrollRef.current;
    }
  }, [sidebarTab]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {jiraResolvePrompt.length > 0 && (
          <div
            style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 480,
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 12 }}>
              Committed to module(s) with open Jira issues
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 12 }}>
              Resolve, keep open, or dismiss each:
            </div>
            {jiraResolvePrompt.map((issue) => (
              <div
                key={issue.key}
              style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #21262d",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div>
                  <a
                    href={`${issue.baseUrl}/browse/${issue.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#58a6ff" }}
                  >
                    {issue.key}
                  </a>
                  <span style={{ color: "#7d8590", marginLeft: 8 }}>{issue.summary}</span>
            </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => {
                      vscode.postMessage({ type: "agentJiraResolveAction", key: issue.key, action: "resolve" });
                      setJiraResolvePrompt((p) => p.filter((x) => x.key !== issue.key));
                    }}
                    style={{ ...styles.buttonBase, ...styles.buttonPrimary, padding: "4px 8px", fontSize: 11 }}
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => {
                      vscode.postMessage({ type: "agentJiraResolveAction", key: issue.key, action: "keep" });
                      setJiraResolvePrompt((p) => p.filter((x) => x.key !== issue.key));
                    }}
                    style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => {
                      vscode.postMessage({ type: "agentJiraResolveAction", key: issue.key, action: "dismiss" });
                      setJiraResolvePrompt((p) => p.filter((x) => x.key !== issue.key));
                    }}
                    style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 11 }}
                  >
                    Dismiss
                  </button>
                </div>
                </div>
              ))}
            </div>
          </div>
        )}
      {costGate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 420,
            }}
          >
            <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 12 }}>
              {costGate.gate === "token_budget_exceeded"
                ? "Token budget exceeded"
                : "Session LLM limit exceeded"}
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16 }}>
              Usage: {costGate.tokenUsage.toLocaleString()} / {costGate.tokenBudget.toLocaleString()} tokens
              {costGate.gate === "session_llm_limit" && (
                <> · LLM calls: {costGate.llmCallCount} / {costGate.llmLimit}</>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentCostGateAction", action: "extend", amount: 20_000 });
                  setCostGate(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonPrimary }}
              >
                Extend budget (+20k tokens / +20 LLM calls)
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentCostGateAction", action: "create_jira" });
                  setCostGate(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Create Jira to continue later
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentCostGateAction", action: "abort" });
                  setCostGate(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Abort session
              </button>
            </div>
            </div>
          </div>
        )}
      {partialPlanFailure && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 420,
            }}
          >
            <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 12 }}>
              Task {partialPlanFailure.failedTaskId} failed
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16 }}>
              Tasks 1–{partialPlanFailure.committedCount} are committed. Options:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentPartialPlanFailureAction", action: "abort" });
                  setPartialPlanFailure(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonPrimary }}
              >
                Keep commits and abort plan
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentPartialPlanFailureAction", action: "revert" });
                  setPartialPlanFailure(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Revert manually (use git)
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentPartialPlanFailureAction", action: "create_jira" });
                  setPartialPlanFailure(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Create Jira for partial completion
              </button>
              </div>
          </div>
          </div>
        )}
      {ruleProposal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 480,
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 12 }}>
              Proposed rule change ({ruleProposal.category})
          </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>{ruleProposal.rationale}</div>
            <pre
              style={{
                background: "#0d1117",
                padding: 12,
                borderRadius: 6,
                fontSize: 10,
                overflow: "auto",
                marginBottom: 12,
              }}
            >
              {ruleProposal.proposedRule}
            </pre>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentRuleProposalAction", action: "accept" });
                  setRuleProposal(null);
                }}
                style={{ flex: 1, ...styles.buttonBase, ...styles.buttonPrimary }}
              >
                Accept
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentRuleProposalAction", action: "reject" });
                  setRuleProposal(null);
                }}
                style={{ flex: 1, ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Reject
              </button>
            </div>
          </div>
            </div>
          )}
      {sessionRecovery != null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 360,
            }}
          >
            <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 16 }}>
              Recovered agent session from last run. Restore or discard?
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentSessionRestore" });
                  setSessionRecovery(null);
                }}
                style={{ flex: 1, ...styles.buttonBase, ...styles.buttonPrimary }}
              >
                Restore
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({ type: "agentSessionDiscard" });
                  setSessionRecovery(null);
                }}
                style={{ flex: 1, ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
      {failedRailHitl && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 440,
            }}
          >
            <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 8 }}>
              Rail {failedRailHitl.railId} failed
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16, whiteSpace: "pre-wrap" }}>
              {failedRailHitl.reason}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => {
                  setFocusedRailId(failedRailHitl.railId);
                  setFailedRailHitl(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Investigate manually
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({
                    type: "failRailHitlAction",
                    railId: failedRailHitl.railId,
                    action: "create_jira",
                  });
                  setFailedRailHitl(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
              >
                Create Jira
              </button>
              <button
                onClick={() => {
                  vscode.postMessage({
                    type: "failRailHitlAction",
                    railId: failedRailHitl.railId,
                    action: "abandon",
                  });
                  setFailedRailHitl(null);
                }}
                style={{ ...styles.buttonBase, ...styles.buttonSecondary, color: "#f85149" }}
              >
                Abandon rail
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Top row: sidebar (left) + divider + canvas */}
      {/* Jira settings modal */}
      <JiraSettingsModal
        open={showJiraSettings}
        onClose={() => setShowJiraSettings(false)}
        jiraBaseUrl={jiraBaseUrl}
        jiraRepoName={jiraRepoName}
        jiraFilterByRepo={jiraFilterByRepo}
         jiraProjectKey={jiraProjectKey}
        onToggleFilter={() => {
          setJiraFilterByRepo((v) => {
            const next = !v;
            fetchJiraTests(next);
            return next;
          });
        }}
        onSaveProjectKey={(key) => {
          setJiraProjectKey(key);
          fetchJiraTests(undefined, key);
        }}
      />

      {/* Playwright HITL modal */}
      {playwrightHitl && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPlaywrightHitl(null);
          }}
        >
          <div
            style={{
              width: 480,
              maxWidth: "90vw",
              maxHeight: "80vh",
              overflow: "auto",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 12,
              boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #30363d",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Playwright tests failed</span>
                {playwrightHitl.failures.some((f) =>
                  f.testName.includes("[VISUAL]") || f.testName.includes("@visual")
                ) && (
                  <span style={{ fontSize: 11, color: "#f59e0b" }}>
                    Visual constraint failure — layout / overlap / visibility issue.
                  </span>
                )}
              </div>
              <button
                onClick={() => setPlaywrightHitl(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8b949e",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "14px 16px", fontSize: 12, color: "#c9d1d9" }}>
              <div style={{ marginBottom: 8, fontSize: 11, color: "#8b949e" }}>
                Spec: <code style={{ fontFamily: "monospace" }}>{playwrightHitl.spec}</code>
              </div>
              <ul
                style={{
                  margin: "0 0 16px 0",
                  paddingLeft: 18,
                  maxHeight: 200,
                  overflow: "auto",
                }}
              >
                {playwrightHitl.failures.map((f, i) => (
                  <li key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: "#e6edf3" }}>{f.testName}</div>
                    <div style={{ fontSize: 11, color: "#8b949e", whiteSpace: "pre-wrap" }}>
                      {f.error}
                    </div>
                    {f.screenshotPath && (
                      <button
                        onClick={() => {
                          vscode.postMessage({ type: "openPlaywrightScreenshot", path: f.screenshotPath! });
                        }}
                        style={{
                          marginTop: 6,
                          padding: "4px 8px",
                          fontSize: 11,
                          background: "#21262d",
                          color: "#58a6ff",
                          border: "1px solid #30363d",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Open screenshot
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <button
                  onClick={() => {
                    vscode.postMessage({
                      type: "playwrightHitlAction",
                      railId: playwrightHitl.railId,
                      action: "retry",
                    });
                    setPlaywrightHitl(null);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#238636",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    vscode.postMessage({
                      type: "playwrightHitlAction",
                      railId: playwrightHitl.railId,
                      action: "suspend",
                    });
                    setPlaywrightHitl(null);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#21262d",
                    color: "#c9d1d9",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Suspend rail
                </button>
                <button
                  onClick={() => {
                    vscode.postMessage({
                      type: "playwrightHitlAction",
                      railId: playwrightHitl.railId,
                      action: "create_jira",
                    });
                    setPlaywrightHitl(null);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#21262d",
                    color: "#c9d1d9",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Create Jira
                </button>
                <button
                  onClick={() => {
                    vscode.postMessage({
                      type: "playwrightHitlAction",
                      railId: playwrightHitl.railId,
                      action: "investigate",
                      tracePath: playwrightHitl.tracePath,
                    });
                    setPlaywrightHitl(null);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#21262d",
                    color: "#c9d1d9",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Investigate in UI
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar (left) */}
        <div
          ref={sidebarRef}
          style={{
            width: sidebarWidth,
            minWidth: SIDEBAR_MIN,
            maxWidth: SIDEBAR_MAX,
            ...styles.sidebar.container,
          }}
        >
          {/* Zone 1 — Command strip (always visible) */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              marginBottom: 16,
              padding: "8px 12px",
              background: "#161b22",
              borderBottom: "1px solid #30363d",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* Agent toggle */}
                  <button
              onClick={() => vscode.postMessage({ type: "setAgentActive", active: !agentActive })}
                    style={{
                padding: "4px 10px",
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 999,
                border: "1px solid " + (agentActive ? "#238636" : "#30363d"),
                background: agentActive ? "rgba(35,134,54,0.15)" : "#21262d",
                color: agentActive ? "#3fb950" : "#7d8590",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
              }}
              title={agentActive ? "Agent is active" : "Agent is suspended"}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: agentActive ? "#3fb950" : "#6e7681",
                }}
              />
              <span style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                Agent {agentActive ? "ON" : "OFF"}
              </span>
                  </button>

            {/* Token usage */}
            <span
              style={{
                fontSize: 10,
                color: "#8b949e",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tokenLabel}
            </span>

            {/* Project / Jira context */}
            <span
              style={{
                fontSize: 10,
                color: jiraProjectKey ? "#e6edf3" : "#7d8590",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}
              title={
                jiraProjectKey
                  ? jiraRepoName
                    ? `${jiraProjectKey} • ${jiraRepoName}`
                    : jiraProjectKey
                  : "No Jira project selected"
              }
            >
              {jiraProjectKey ? jiraProjectKey.toUpperCase() : "No project"}
              {jiraRepoName ? ` · ${jiraRepoName}` : ""}
            </span>
              </div>

          {/* Sidebar tabs: Dashboard / Chat */}
          <div
                  style={{
              display: "flex",
              gap: 6,
              padding: "6px 12px 8px",
              borderBottom: "1px solid #30363d",
                    marginBottom: 8,
            }}
          >
          <button
              onClick={() => {
                if (sidebarRef.current) {
                  chatScrollRef.current = sidebarRef.current.scrollTop;
                }
                setDashboardLastSeenViolations(criticViolations.length);
                setSidebarTab("dashboard");
              }}
                  style={{
                flex: 1,
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border:
                  sidebarTab === "dashboard"
                    ? "1px solid #58a6ff"
                    : "1px solid #30363d",
                background:
                  sidebarTab === "dashboard" ? "#1f2937" : "#161b22",
                color: sidebarTab === "dashboard" ? "#e6edf3" : "#8b949e",
                cursor: "pointer",
                position: "relative",
              }}
            >
              Dashboard
              {criticViolations.length > dashboardLastSeenViolations && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: 10,
                    minWidth: 14,
                    height: 14,
                    padding: "0 4px",
                    borderRadius: 999,
                    background: "#da3633",
                    color: "white",
                    fontSize: 9,
                    fontFamily: "monospace",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {Math.min(
                    criticViolations.length - dashboardLastSeenViolations,
                    9
                  )}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                if (sidebarRef.current) {
                  dashboardScrollRef.current = sidebarRef.current.scrollTop;
                }
                setSidebarTab("chat");
              }}
              style={{
                flex: 1,
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border:
                  sidebarTab === "chat"
                    ? "1px solid #58a6ff"
                    : "1px solid #30363d",
                background: sidebarTab === "chat" ? "#1f2937" : "#161b22",
                color: sidebarTab === "chat" ? "#e6edf3" : "#8b949e",
                cursor: "pointer",
              }}
            >
              Chat
            </button>
              </div>

          {/* Dashboard tab content (prototype using mock data for now) */}
          {sidebarTab === "dashboard" && (
            <div style={{ marginBottom: 12 }}>
              <DashboardPanel
                violations={criticViolations}
                jiraIssues={jiraIssues}
                jiraConnected={!!jiraBaseUrl}
                projectKey={jiraProjectKey}
                repoName={jiraRepoName}
                staleMismatches={
                  jiraStaleMismatches?.map((m) => ({
                    key: m.key,
                    reason: m.reason,
                    summary: m.summary,
                  })) ?? []
                }
                onRefreshIssues={() => fetchJiraTests()}
                onOpenJiraSettings={() => setShowJiraSettings(true)}
                onCreateViolationJira={(v) => {
                    vscode.postMessage({
                    type: "createViolationJira",
                    violation: v,
                    });
                  }}
              />
            </div>
          )}

          {/* Zone 2 — Attention required (only when there is something) */}
          {(() => {
            type AttentionKind =
              | "failed_rail"
              | "hitl_gate"
              | "cost_gate"
              | "playwright_hitl"
              | "visual_critique"
              | "collaborator_overlap";
            interface AttentionItem {
              kind: AttentionKind;
              priority: number;
              title: string;
              railId?: string;
            }
            const items: AttentionItem[] = [];

            if (failedRailHitl) {
              items.push({
                kind: "failed_rail",
                priority: 0,
                title: `Rail ${failedRailHitl.railId} failed`,
                railId: failedRailHitl.railId,
              });
            }
            if (hitlPendingTasks.length > 0) {
              items.push({
                kind: "hitl_gate",
                priority: 1,
                title: `${hitlPendingTasks.length} HITL task${
                  hitlPendingTasks.length > 1 ? "s" : ""
                } need review`,
              });
            }
            if (costGate) {
              items.push({
                kind: "cost_gate",
                priority: 2,
                title:
                  costGate.gate === "token_budget_exceeded"
                    ? "Token budget exceeded"
                    : "Session LLM limit exceeded",
              });
            }
            const hasPlaywright = !!playwrightHitl;
            const hasVisualWithinPlaywright =
              !!playwrightHitl &&
              playwrightHitl.failures.some(
                (f) => f.testName.includes("[VISUAL]") || f.error.includes("[VISUAL]")
              );
            if (hasPlaywright) {
              items.push({
                kind: "playwright_hitl",
                priority: 3,
                title: `Playwright failed for rail ${playwrightHitl!.railId}`,
                railId: playwrightHitl!.railId,
              });
            }
            if (
              hasVisualWithinPlaywright &&
              playwrightHitl &&
              !dismissedVisualRailIds.includes(playwrightHitl.railId)
            ) {
              items.push({
                kind: "visual_critique",
                priority: 4,
                title: "Visual critique found UI issues",
                railId: playwrightHitl.railId,
              });
            }
            if (collaboratorWarnings.length > 0) {
              items.push({
                kind: "collaborator_overlap",
                priority: 5,
                title: `${collaboratorWarnings.length} rail${
                  collaboratorWarnings.length > 1 ? "s" : ""
                } share modules with others`,
              });
            }
            const attentionItems = items.sort((a, b) => a.priority - b.priority);

            return attentionItems.length > 0 ? (
              <div
                style={{
                  ...styles.panel,
                  padding: 10,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#fbbf24",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>⚠ Needs your attention</span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "#fbbf241f",
                        border: "1px solid #fbbf24",
                        color: "#fbbf24",
                      }}
                    >
                      {attentionItems.length} item{attentionItems.length > 1 ? "s" : ""}
                    </span>
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                  {attentionItems.map((item, idx) => {
                    if (item.kind === "failed_rail" && failedRailHitl) {
                      return (
                        <div
                          key={`attn-${item.kind}-${idx}`}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #f85149",
                            background: "rgba(248,81,73,0.08)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#f85149", marginBottom: 4 }}>
                            Rail {failedRailHitl.railId} failed
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#8b949e",
                              marginBottom: 6,
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {failedRailHitl.reason}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <button
                              onClick={() => {
                                setFocusedRailId(failedRailHitl.railId);
                                setFailedRailHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Investigate manually
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "failRailHitlAction",
                                  railId: failedRailHitl.railId,
                                  action: "create_jira",
                                });
                                setFailedRailHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Create Jira
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "failRailHitlAction",
                                  railId: failedRailHitl.railId,
                                  action: "abandon",
                                });
                                setFailedRailHitl(null);
                              }}
                              style={{
                                ...styles.buttonBase,
                                ...styles.buttonSecondary,
                                height: 26,
                                fontSize: 10,
                                color: "#f85149",
                              }}
                            >
                              Abandon rail
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === "hitl_gate" && hitlPendingTasks.length > 0) {
                      return (
                        <div
                          key={`attn-${item.kind}-${idx}`}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #d29922",
                            background: "rgba(210,153,34,0.08)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#d29922", marginBottom: 4 }}>
                            HITL Gate — {hitlPendingTasks.length} task
                            {hitlPendingTasks.length > 1 ? "s" : ""} need review
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
                            Review pending human-in-the-loop tasks before the agent can continue.
                          </div>
                          <button
                            onClick={() => {
                              if (tasksPanelRef.current) {
                                tasksPanelRef.current.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                });
                              }
                            }}
                            style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                          >
                            View tasks
                          </button>
                        </div>
                      );
                    }
                    if (item.kind === "cost_gate" && costGate) {
                      return (
                        <div
                          key={`attn-${item.kind}-${idx}`}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #58a6ff",
                            background: "rgba(88,166,255,0.08)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#58a6ff", marginBottom: 4 }}>
                            {costGate.gate === "token_budget_exceeded"
                              ? "Token budget exceeded"
                              : "Session LLM limit exceeded"}
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
                            Usage: {costGate.tokenUsage.toLocaleString()} /{" "}
                            {costGate.tokenBudget.toLocaleString()} tokens
                            {costGate.gate === "session_llm_limit" && (
                              <>
                                {" "}
                                · LLM calls: {costGate.llmCallCount} / {costGate.llmLimit}
                              </>
                            )}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "agentCostGateAction",
                                  action: "extend",
                                  amount: 20_000,
                                });
                                setCostGate(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonPrimary, height: 26, fontSize: 10 }}
                            >
                              Extend budget (+20k)
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "agentCostGateAction",
                                  action: "create_jira",
                                });
                                setCostGate(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Create Jira
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "agentCostGateAction",
                                  action: "abort",
                                });
                                setCostGate(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Abort session
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === "playwright_hitl" && playwrightHitl) {
                      return (
                        <div
                          key={`attn-${item.kind}-${idx}`}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #58a6ff",
                            background: "rgba(88,166,255,0.05)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#58a6ff", marginBottom: 4 }}>
                            Playwright HITL — Rail {playwrightHitl.railId}
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
                            {playwrightHitl.failures.length} failing check
                            {playwrightHitl.failures.length > 1 ? "s" : ""}.{" "}
                            {hasVisualWithinPlaywright &&
                              "Visual constraint failure — layout/overlap/visibility issue."}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "playwrightHitlAction",
                                  railId: playwrightHitl.railId,
                                  action: "retry",
                                });
                                setPlaywrightHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Retry
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "playwrightHitlAction",
                                  railId: playwrightHitl.railId,
                                  action: "suspend",
                                });
                                setPlaywrightHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Suspend rail
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "playwrightHitlAction",
                                  railId: playwrightHitl.railId,
                                  action: "create_jira",
                                });
                                setPlaywrightHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Create Jira
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === "visual_critique" && playwrightHitl) {
                      const visualFailure =
                        playwrightHitl.failures.find(
                          (f) =>
                            f.testName.includes("[VISUAL]") || f.error.includes("[VISUAL]")
                        ) ?? playwrightHitl.failures[0];
                      return (
                        <div
                          key={`attn-${item.kind}-${idx}`}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #f97316",
                            background: "rgba(249,115,22,0.06)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#f97316", marginBottom: 4 }}>
                            Visual Critique — layout / overlap / visibility
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
                            {visualFailure.error}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "playwrightHitlAction",
                                  railId: playwrightHitl.railId,
                                  action: "create_jira",
                                });
                                setPlaywrightHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Create Jira
                            </button>
                            <button
                              onClick={() => {
                                vscode.postMessage({
                                  type: "playwrightHitlAction",
                                  railId: playwrightHitl.railId,
                                  action: "investigate",
                                  tracePath: playwrightHitl.tracePath,
                                });
                                setPlaywrightHitl(null);
                              }}
                              style={{ ...styles.buttonBase, ...styles.buttonSecondary, height: 26, fontSize: 10 }}
                            >
                              Investigate
                            </button>
                            <button
                              onClick={() => {
                                setDismissedVisualRailIds((prev) =>
                                  prev.includes(playwrightHitl.railId)
                                    ? prev
                                    : [...prev, playwrightHitl.railId]
                                );
                              }}
                              style={{
                                ...styles.buttonBase,
                                ...styles.buttonSecondary,
                                height: 26,
                                fontSize: 10,
                                color: "#8b949e",
                              }}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === "collaborator_overlap" && collaboratorWarnings.length > 0) {
                      return (
                        <div
                          key={`attn-${item.kind}-${idx}`}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid rgba(88,166,255,0.6)",
                            background: "rgba(88,166,255,0.06)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#58a6ff", marginBottom: 4 }}>
                            Collaborator overlap — other rails on same modules
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
                            {collaboratorWarnings.length} rail
                            {collaboratorWarnings.length > 1 ? "s" : ""} share Jira keys or nodes
                            with the active rail. Consider coordinating to avoid conflicts.
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {collaboratorWarnings.slice(0, 2).map((r) => (
                              <button
                                key={r.id}
                                onClick={() => setFocusedRailId(r.id)}
                                style={{
                                  textAlign: "left",
                                  padding: "2px 6px",
                                  fontSize: 10,
                                  background: "transparent",
                                  border: "1px solid #30363d",
                                  borderRadius: 4,
                                  color: "#8b949e",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={r.outcome || r.id}
                              >
                                Jump to rail: {r.outcome || r.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ) : null;
          })()}

          {/* Zone 3 — Active rail (one rail at a time) */}
          {activeRail && (
            <div style={{ ...styles.panel, marginBottom: 12 }}>
              <button
                onClick={() => setActiveRailOpen((o) => !o)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: 0,
                  margin: 0,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#e6edf3",
                  fontSize: 13,
                }}
              >
                <span style={styles.sectionHeader}>Active rail</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                  <span
                    style={{
                      fontSize: 10,
                      borderRadius: 999,
                      padding: "1px 6px",
                      border: "1px solid #30363d",
                      color: "#8b949e",
                    }}
                  >
                    {activeRail.state}
                  </span>
                  <span>{activeRailOpen ? "▼" : "▶"}</span>
                </span>
              </button>
              {activeRailOpen && (
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  {/* Rail outcome / title */}
                <div
                  style={{
                    fontSize: 12,
                      color: "#e6edf3",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      marginBottom: 4,
                    }}
                  >
                    {activeRail.outcome || activeRail.id}
                  </div>

                  {/* Logic path breadcrumb with active step + drift indicator (Z3.8) */}
                  {activeRail.logicPath && activeRail.logicPath.length > 0 && (
                    <div
                      style={{
                        fontSize: 10,
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                      title={activeRail.logicPath.map((s) => `${s.layer}:${s.nodeId}`).join(" → ")}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          flexWrap: "wrap",
                        }}
                      >
                        {(() => {
                          const completedCount = activeRailTasks.filter(
                            (t) => t.status === "completed"
                          ).length;
                          const executingIndex = activeRailTasks.findIndex(
                            (t) => t.status === "executing"
                          );
                          const firstPendingIndex = activeRailTasks.findIndex(
                            (t) => t.status !== "completed"
                          );
                          const activeIndex =
                            executingIndex >= 0
                              ? executingIndex
                              : firstPendingIndex >= 0
                                ? firstPendingIndex
                                : -1;
                          return activeRail.logicPath!.map((step, idx) => {
                            const isActive = idx === activeIndex;
                            return (
                              <span
                                key={`${step.layer}:${step.nodeId}:${idx}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  color: isActive ? "#58a6ff" : "#7d8590",
                                  fontWeight: isActive ? 600 : 400,
                                }}
                              >
                                {idx > 0 && (
                                  <span style={{ color: "#4b5563" }}>→</span>
                                )}
                                <span>{step.layer}</span>
                              </span>
                            );
                          });
                        })()}
                      </div>
                      {typeof activeRail.hallucinationIndex === "number" &&
                        activeRail.hallucinationIndex > 0.5 && (
                          <span
                            style={{
                              fontSize: 9,
                              padding: "1px 6px",
                              borderRadius: 999,
                              background: "rgba(248,81,73,0.1)",
                              border: "1px solid #f85149",
                              color: "#f85149",
                              textTransform: "uppercase",
                              letterSpacing: 0.8,
                            }}
                            title="Executor touched nodes outside the intended logic path (high drift)."
                          >
                            Drift
                          </span>
                        )}
                </div>
              )}

                  {/* Task list for active rail (Z3.5) */}
                  {activeRailTasks.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      {activeRailTasks.map((t) => {
                        const isCompleted = t.status === "completed";
                        const isExecuting = t.status === "executing";
                        const isHitl = t.status === "awaiting_hitl";
                        const bullet = isCompleted ? "✓" : isExecuting ? "⟳" : "○";
                        return (
                          <div
                            key={t.id}
                            data-task-id={t.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "2px 0",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                width: 12,
                                color: isCompleted ? "#3fb950" : isHitl ? "#d29922" : "#7d8590",
                              }}
                            >
                              {bullet}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 11,
                                color: isCompleted ? "#7d8590" : "#c9d1d9",
                                textDecoration: isCompleted ? "line-through" : "none",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={t.description}
                            >
                              {t.description}
                            </span>
                            {t.agent && (
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: "1px 4px",
                                  borderRadius: 4,
                                  border: "1px solid #30363d",
                                  color: "#8b949e",
                                }}
                              >
                                {t.agent}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Telemetry line (Z3.6) */}
                  {(() => {
                    const tel = activeRail ? railTelemetry[activeRail.id] : undefined;
                    const visualCount =
                      playwrightHitl && playwrightHitl.railId === activeRail?.id
                        ? playwrightHitl.failures.filter(
                            (f) =>
                              f.testName.includes("[VISUAL]") || f.error.includes("[VISUAL]")
                          ).length
                        : 0;
                    const retryCount = tel?.retryCount ?? 0;
                    const retryLimit = tel?.retryLimit ?? 3;
                    return (
                      <div style={{ fontSize: 10, color: "#7d8590" }}>
                        Tokens:{" "}
                        {tel?.tokenUsage != null
                          ? tel.tokenUsage.toLocaleString()
                          : "—"}
                        {"  |  "}
                        Critique loops: {tel?.critiqueLoopCount ?? 0}
                        {"  |  "}
                        Visual: {visualCount}
                        {"  |  "}
                        Retry: {retryCount}/{retryLimit}
                      </div>
                    );
                  })()}

                  {/* Rail switcher when multiple rails (Z3.2 / Z3.7 entry point) */}
                  {rails.length > 1 && (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                      }}
                    >
                      {rails.map((r) => {
                        const isActive = r.id === activeRail.id;
                        return (
                          <button
                            key={r.id}
                            onClick={() => setActiveRailOverrideId(r.id)}
                            style={{
                              padding: "2px 6px",
                              fontSize: 10,
                              borderRadius: 999,
                              border: `1px solid ${
                                isActive ? "#238636" : "#30363d"
                              }`,
                              background: isActive ? "rgba(35,134,54,0.18)" : "#21262d",
                              color: isActive ? "#3fb950" : "#8b949e",
                              cursor: "pointer",
                              maxWidth: "100%",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={r.outcome || r.id}
                          >
                            {r.outcome || r.id}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {graph && (
            <>
              {/* Zone 4 — Project health (collapsible) */}
              <div style={{ ...styles.panel, marginBottom: 12 }}>
                <button
                  onClick={() => setProjectHealthOpen((o) => !o)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: 0,
                    margin: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#e6edf3",
                    fontSize: 13,
                  }}
                >
                  <span style={styles.sectionHeader}>Project health</span>
                  <span style={{ fontSize: 10, color: "#8b949e" }}>
                    {modulesCount} modules{"  |  "}
                    {noContextCount > 0 ? `⚠ ${noContextCount} no-context` : "0 no-context"}{"  |  "}
                    {activeViolationsCount} violations
                  </span>
                  <span style={{ fontSize: 10 }}>{projectHealthOpen ? "▼" : "▶"}</span>
                </button>
                {projectHealthOpen && (
                  <div style={{ marginTop: 8 }}>
              <ProjectHealthPanel
                graph={graph}
                driftEdges={driftEdges}
                missingContextNodes={missingContextNodes}
                criticalFindingsCount={criticalFindingsCount}
                violations={criticViolations}
                jiraIssues={jiraIssues}
              />
                  </div>
                )}
              </div>

              {/* ─── 3. EDGES (graph filter) ───────────────────────────────── */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...styles.sectionHeader, marginBottom: 6 }}>Edges</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    { v: "architectural" as const, l: "Arch" },
                    { v: "all" as const, l: "All" },
                    { v: "violations" as const, l: "Violations" },
                    { v: "drift" as const, l: "Drift" },
                    { v: "jira" as const, l: "Jira" },
                  ].map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => setEdgeFilter(v)}
                      style={{
                        ...styles.buttonBase,
                        padding: "4px 10px",
                        height: 28,
                        fontSize: 11,
                        background: edgeFilter === v ? "#238636" : "#21262d",
                        color: edgeFilter === v ? "white" : "#7d8590",
                        border: `1px solid ${edgeFilter === v ? "#238636" : "#30363d"}`,
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* ─── 4. VIOLATIONS ─────────────────────────────────────────── */}
              {criticViolations.length > 0 && (
                <div style={{ ...styles.panel, padding: 0, marginBottom: 8 }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    onClick={() => setViolationsOpen((v) => !v)}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: "#8b949e",
                          letterSpacing: 1,
                          textTransform: "uppercase",
                        }}
                      >
                        ⊘ Violations
                      </span>
                      <span
                        style={{
                          background: "#da3633",
                          color: "white",
                          borderRadius: "50%",
                          width: 18,
                          height: 18,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {criticViolations.length}
                      </span>
                    </div>
                    <span style={{ color: "#484f58", fontSize: 12 }}>
                      {violationsOpen ? "∧" : "∨"}
                    </span>
                  </div>
                  {violationsOpen &&
                    criticViolations.map((v, i) => {
                      const dotColor =
                        v.severity === "critical"
                          ? "#f85149"
                          : v.severity === "high"
                          ? "#d29922"
                          : "#58a6ff";
                      return (
                        <div
                          key={v.traceId ?? i}
                          style={{
                            padding: "10px 14px",
                            borderTop: "1px solid #21262d",
                            position: "relative",
                          }}
                        >
                          <button
                            onClick={() =>
                              setCriticViolations((prev) =>
                                prev.filter((x) => x !== v)
                              )
                            }
                            style={{
                              position: "absolute",
                              top: 8,
                              right: 10,
                              background: "transparent",
                              border: "none",
                              color: "#484f58",
                              cursor: "pointer",
                              fontSize: 14,
                            }}
                          >
                            ×
                          </button>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: dotColor,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 10,
                                letterSpacing: 1,
                                color: "#8b949e",
                                fontFamily: "monospace",
                              }}
                            >
                              {v.type.replace(/_/g, " ").toUpperCase()}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#e6edf3",
                              marginBottom: 8,
                              paddingLeft: 16,
                            }}
                          >
                            {v.description}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              paddingLeft: 16,
                            }}
                          >
                            {v.jiraKey ? (
                              <span
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  background: "rgba(88,166,255,0.1)",
                                  border: "1px solid #388bfd",
                                  color: "#58a6ff",
                                  fontFamily: "monospace",
                                  cursor: "pointer",
                                }}
                              >
                                ● {v.jiraKey}
                                {v.jiraStatus ? ` · ${v.jiraStatus}` : ""}
                              </span>
                            ) : (
                              <button
                                onClick={() =>
                                  vscode.postMessage({
                                    type: "createViolationJira",
                                    violation: v,
                                  })
                                }
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  background: "transparent",
                                  border: "1px solid #30363d",
                                  color: "#8b949e",
                                  cursor: "pointer",
                                  fontFamily: "monospace",
                                }}
                                title={
                                  jiraProjectKey
                                    ? `Create Jira ticket in project ${jiraProjectKey}`
                                    : "Create Jira ticket"
                                }
                              >
                                ⊞ Create ticket
                              </button>
                            )}
                            {typeof v.recurrences === "number" &&
                              v.recurrences >= 5 && (
                                <span
                                  style={{
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    background: "rgba(210,153,34,0.15)",
                                    border: "1px solid #9e6a03",
                                    color: "#d29922",
                                  }}
                                >
                                  ×{v.recurrences}
                                </span>
                              )}
                            {v.sourceNodeId && (
                              <span
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  background: "#161b22",
                                  border: "1px solid #30363d",
                                  color: "#8b949e",
                                  fontFamily: "monospace",
                                }}
                              >
                                {v.sourceNodeId}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Zone 5 — Governance (collapsible) */}
              <div style={{ ...styles.panel, marginTop: 12 }}>
                <button
                  onClick={() => setGovernanceOpen((o) => !o)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: 0,
                    margin: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#e6edf3",
                    fontSize: 13,
                  }}
                >
                  <span style={styles.sectionHeader}>Governance</span>
                  <span style={{ fontSize: 10, color: "#8b949e" }}>
                    {jiraBaseUrl ? "● Connected" : "○ Not connected"}
                    {jiraProjectKey ? `  |  ${jiraProjectKey.toUpperCase()}` : "  |  No project"}
                    {`  |  ${jiraIssues.length} issue${jiraIssues.length === 1 ? "" : "s"}`}
                  </span>
                  <span style={{ fontSize: 10 }}>{governanceOpen ? "▼" : "▶"}</span>
                </button>
                {governanceOpen && (
                  <div style={{ marginTop: 8 }}>
              <GovernancePanel
                jiraIssues={jiraIssues}
                jiraLoading={jiraLoading}
                jiraError={jiraError}
                jiraFilterByRepo={jiraFilterByRepo}
                jiraRepoName={jiraRepoName}
                      jiraProjectKey={jiraProjectKey}
                jiraStaleMismatches={jiraStaleMismatches}
                jiraBaseUrl={jiraBaseUrl}
                hasCorrections={hasCorrections}
                graphExists={!!graph && graph.nodes.length > 0}
                violations={criticViolations}
                onOpenSettings={() => setShowJiraSettings(true)}
                onToggleFilter={() => {
                  setJiraFilterByRepo((v) => {
                    const next = !v;
                    fetchJiraTests(next);
                    return next;
                  });
                }}
                onRefresh={() => fetchJiraTests()}
                onRetag={(key) => {
                  const mm = jiraStaleMismatches.find((x) => x.key === key);
                  vscode.postMessage({
                    type: "agentJiraSyncAction",
                    key,
                    action: "retag",
                    newFingerprint: mm?.currentFingerprint ?? undefined,
                    newModule: mm?.storedModule ?? undefined,
                  });
                  setJiraStaleMismatches((m) => m.filter((x) => x.key !== key));
                }}
                onArchive={(key) => {
                  vscode.postMessage({ type: "agentJiraSyncAction", key, action: "archive" });
                  setJiraStaleMismatches((m) => m.filter((x) => x.key !== key));
                }}
                onKeep={(key) => {
                  vscode.postMessage({ type: "agentJiraSyncAction", key, action: "keep" });
                  setJiraStaleMismatches((m) => m.filter((x) => x.key !== key));
                }}
                onAddLabel={(key) => {
                  if (!jiraRepoName) return;
                  vscode.postMessage({
                    type: "agentJiraAddLabel",
                    key,
                    label: jiraRepoName,
                  });
                }}
                onGenerateRules={() => {
                  setRulesPreview(null);
                  vscode.postMessage({ type: "generateRules" });
                }}
              />
                  </div>
                )}
              </div>

              {/* ─── 5. TASKS (rail cards) — collapsible ────────────────────── */}
              {rails.length > 0 && (
                <div style={{ ...styles.panel, marginTop: 12 }}>
                  <button
                    onClick={() => setTasksOpen((o) => !o)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: 0,
                      margin: 0,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#e6edf3",
                      fontSize: 13,
                    }}
                  >
                    <span style={styles.sectionHeader}>Tasks</span>
                    <span style={{ fontSize: 11, color: "#8b949e" }}>
                      {tasks.length} total
                      {hitlPendingTasks.length > 0 && (
                        <span style={{ marginLeft: 4, color: "#d29922" }}>{" · "}{hitlPendingTasks.length} need review</span>
                      )}
                    </span>
                    <span style={{ fontSize: 10 }}>{tasksOpen ? "▼" : "▶"}</span>
                  </button>
                  {tasksOpen && (
                    <div ref={tasksPanelRef} style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", fontSize: 11 }}>
                      {rails.map((r) => {
                        const railTasks = tasks.filter((t) => t.railId === r.id);
                        if (railTasks.length === 0) return null;
                        const completed = railTasks.filter((t) => t.status === "completed").length;
                        const hitlTasks = railTasks.filter((t) => t.status === "awaiting_hitl");
                        const tel = railTelemetry[r.id];
                        return (
                          <div
                            key={r.id}
                            data-rail-id={r.id}
                            style={{ padding: "8px 0", borderBottom: "1px solid #21262d" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                marginBottom: 4,
                                gap: 8,
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "#e6edf3",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {r.outcome || r.id}
                                </div>
                                <div style={{ fontSize: 10, color: "#7d8590", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <span>
                                    {completed}/{railTasks.length} tasks completed
                                    {hitlTasks.length > 0 && (
                                      <span style={{ marginLeft: 4, color: "#d29922" }}>{" · "}{hitlTasks.length} needs review</span>
                                    )}
                                  </span>
                                  {r.archetype && <span style={{ color: "#8b949e" }}>archetype: {r.archetype}</span>}
                                </div>
                                {r.logicPath && r.logicPath.length > 0 && (
                                  <div
                                    style={{
                                      fontSize: 9,
                                      color: "#58a6ff",
                                      marginTop: 4,
                                      fontFamily: "monospace",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                    title={r.logicPath.map((s) => `${s.layer}:${s.nodeId}`).join(" → ")}
                                  >
                                    {r.logicPath.map((s) => `${s.layer}:${s.nodeId}`).join(" → ")}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    borderRadius: 999,
                                    padding: "1px 6px",
                                    border: "1px solid #30363d",
                                    color: "#8b949e",
                                  }}
                                >
                                  {r.state}
                                </span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    borderRadius: 4,
                                    padding: "1px 4px",
                                    border:
                                      r.state === "ARCHIVED" || r.state === "MATERIALIZING"
                                        ? "1px solid #3fb950"
                                        : "1px solid #d29922",
                                    color:
                                      r.state === "ARCHIVED" || r.state === "MATERIALIZING" ? "#3fb950" : "#d29922",
                                    background:
                                      r.state === "ARCHIVED" || r.state === "MATERIALIZING"
                                        ? "rgba(63,185,80,0.1)"
                                        : "rgba(210,153,34,0.1)",
                                  }}
                                  title={
                                    r.state === "ARCHIVED" || r.state === "MATERIALIZING"
                                      ? "Changes materialized to src/"
                                      : "Changes in .agent/sandboxes/"
                                  }
                                >
                                  {r.state === "ARCHIVED" || r.state === "MATERIALIZING" ? "LIVE" : "SANDBOX"}
                                </span>
                                {typeof r.hallucinationIndex === "number" && (
                                  <div
                                    style={{
                                      width: 48,
                                      height: 4,
                                      borderRadius: 2,
                                      background: "#21262d",
                                      overflow: "hidden",
                                      marginTop: 2,
                                    }}
                                    title={`Confidence: ${((1 - r.hallucinationIndex) * 100).toFixed(0)}%`}
                                  >
                                    <div
                                      style={{
                                        width: `${(1 - r.hallucinationIndex) * 100}%`,
                                        height: "100%",
                                        background:
                                          r.hallucinationIndex > 0.5
                                            ? "#f85149"
                                            : r.hallucinationIndex > 0.25
                                              ? "#d29922"
                                              : "#3fb950",
                                      }}
                                    />
                                  </div>
                                )}
                                {r.overlapCount && r.overlapCount > 0 ? (
                                  <RailCollaboratorBadge overlaps={r.overlaps ?? []} allRails={rails} onJumpToRail={setFocusedRailId} />
                                ) : null}
                                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                  {r.state !== "ARCHIVED" && r.state !== "FAILED" && (
                                    <>
                                      {r.state === "SUSPENDED" ? (
                                        <button
                                          onClick={() => vscode.postMessage({ type: "railAction", railId: r.id, action: "resume" })}
                                          style={{ ...styles.buttonBase, padding: "2px 6px", fontSize: 9 }}
                                        >
                                          Resume
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => vscode.postMessage({ type: "railAction", railId: r.id, action: "suspend" })}
                                          style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "2px 6px", fontSize: 9 }}
                                        >
                                          Suspend
                                        </button>
                                      )}
                                      <button
                                        onClick={() => vscode.postMessage({ type: "railAction", railId: r.id, action: "abandon" })}
                                        style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "2px 6px", fontSize: 9, color: "#f85149" }}
                                      >
                                        Abandon
                                      </button>
                                      {r.hallucinationIndex != null &&
                                        r.hallucinationIndex > 0.5 &&
                                        r.state === "VERIFYING" && (
                                          <button
                                            onClick={() =>
                                              vscode.postMessage({
                                                type: "railAction",
                                                railId: r.id,
                                                action: "acknowledge_drift",
                                              })
                                            }
                                            style={{
                                              ...styles.buttonBase,
                                              padding: "2px 6px",
                                              fontSize: 9,
                                              background: "rgba(210,153,34,0.2)",
                                              border: "1px solid #d29922",
                                              color: "#d29922",
                                            }}
                                            title="Acknowledge drift to allow materialize"
                                          >
                                            Acknowledge drift
                                          </button>
                                        )}
                                      {r.state === "VERIFYING" && (
                                        <button
                                          onClick={() =>
                                            vscode.postMessage({ type: "railAction", railId: r.id, action: "materialize" })
                                          }
                                          style={{
                                            ...styles.buttonBase,
                                            padding: "2px 6px",
                                            fontSize: 9,
                                            background: "#238636",
                                            color: "white",
                                            border: "1px solid #238636",
                                          }}
                                          title="Materialize sandbox to src/"
                                        >
                                          Materialize
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {tel && (
                              <div
                                style={{
                                  fontSize: 9,
                                  color: "#8b949e",
                                  marginBottom: 6,
                                  display: "flex",
                                  gap: 12,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span>tokens: {tel.tokenUsage}</span>
                                <span>critique: {tel.critiqueLoopCount}</span>
                                <span>success: {(tel.pathSuccessRate * 100).toFixed(0)}%</span>
                                {r.state === "SELF_CORRECTING" &&
                                  typeof tel.retryCount === "number" &&
                                  typeof tel.retryLimit === "number" && (
                                    <span style={{ color: "#d29922" }}>
                                      Retry {tel.retryCount} of {tel.retryLimit}
                                    </span>
                                  )}
                              </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {railTasks.map((t, idx) => {
                                const isHitl = t.status === "awaiting_hitl";
                                const jiraUrl =
                                  t.jiraKey &&
                                  jiraBaseUrl &&
                                  `${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.jiraKey}`;
                                return (
                                  <div
                                    key={t.id}
                                    data-task-id={t.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 4,
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      border: `1px solid ${isHitl ? "rgba(210,153,34,0.8)" : "#30363d"}`,
                                      background: isHitl ? "rgba(210,153,34,0.12)" : "#161b22",
                                      fontSize: 10,
                                      flexWrap: "wrap",
                                    }}
                                    title={t.description}
                                  >
                                    <span style={{ color: "#7d8590" }}>{idx + 1}.</span>
                                    <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {t.description || t.kind}
                                    </span>
                                    <span style={{ borderRadius: 999, padding: "0 4px", border: "1px solid #30363d", color: "#8b949e" }}>
                                      {t.kind}
                                    </span>
                                    {t.agent && (
                                      <span style={{ borderRadius: 999, padding: "0 4px", background: "#21262d", color: "#58a6ff", fontSize: 9 }}>
                                        {t.agent}
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        borderRadius: 999,
                                        padding: "0 4px",
                                        color:
                                          t.status === "completed" ? "#3fb950" : isHitl ? "#d29922" : "#8b949e",
                                      }}
                                    >
                                      {t.status}
                                    </span>
                                    {Array.isArray(t.files) &&
                                      t.files.slice(0, 2).map((f) => (
                                        <button
                                          key={f}
                                          onClick={() =>
                                            vscode.postMessage({ type: "openTaskFile", filePath: f })
                                          }
                                          style={{
                                            padding: "0 4px",
                                            fontSize: 9,
                                            background: "transparent",
                                            border: "none",
                                            color: "#58a6ff",
                                            cursor: "pointer",
                                            textDecoration: "underline",
                                            maxWidth: 80,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={`Open ${f}`}
                                        >
                                          {f.split("/").pop() ?? f}
                                        </button>
                                      ))}
                                    {jiraUrl && (
                                      <a
                                        href={jiraUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: "#58a6ff", fontSize: 9, marginLeft: 4 }}
                                        title={t.jiraKey}
                                      >
                                        ● {t.jiraKey}
                                      </a>
                                    )}
                                    {isHitl && (
                                      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                                        <button
                                          onClick={() => vscode.postMessage({ type: "taskAction", taskId: t.id, action: "approve" })}
                                          style={{ ...styles.buttonBase, padding: "2px 6px", fontSize: 9 }}
                                        >
                                          Approve
                                        </button>
                                        <button
                                          onClick={() => vscode.postMessage({ type: "taskAction", taskId: t.id, action: "reject" })}
                                          style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "2px 6px", fontSize: 9 }}
                                        >
                                          Reject
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ─── 6. TRACE (Reasoning Timeline) ─────────────────────────── */}
              <AgentTracePanel
                entries={traceEntries}
                activeRailId={activeRailId}
                onExport={() => vscode.postMessage({ type: "agentExportTrace", entries: traceEntries })}
                onJumpToRail={(railId) => setFocusedRailId(railId)}
                onJumpToTask={(railId, taskId) => {
                  setFocusedRailId(railId);
                  setFocusedTaskId(taskId ?? null);
                }}
                replayEntries={replayEntries}
                replayIndex={replayIndex}
                onReplayPrev={() => setReplayIndex((i) => Math.max(0, i - 1))}
                onReplayNext={() =>
                  setReplayIndex((i) =>
                    replayEntries ? Math.min(replayEntries.length - 1, i + 1) : 0
                  )
                }
                onReplayLoad={(json) => {
                  try {
                    const arr = JSON.parse(json);
                    const list = Array.isArray(arr) ? arr : arr?.entries ?? [];
                    setReplayEntries(list);
                    setReplayIndex(0);
                  } catch {
                    // ignore invalid JSON
                  }
                }}
                onReplayClose={() => {
                  setReplayEntries(null);
                  setReplayIndex(0);
                }}
              />

              {/* ─── 7. AGENT (goal + plan) ─────────────────────────────────── */}
              <div style={{ marginTop: 12 }}>
                <div style={styles.panel}>
                  <div style={styles.sectionHeader}>Agent</div>
                  <input
                    type="text"
                    value={agentGoal}
                    onChange={(e) => setAgentGoal(e.target.value)}
                    placeholder="Ask the agent about this architecture"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      marginBottom: 8,
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      color: "#e6edf3",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={handleRequestPlan}
                    disabled={!agentGoal.trim()}
                    style={{
                      width: "100%",
                      ...styles.buttonBase,
                      ...styles.buttonSecondary,
                    }}
                  >
                    Generate plan
                  </button>
                  {agentPlanError && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#f85149" }}>{agentPlanError}</div>
                  )}
                </div>
              </div>

              {architectureProposal && graph && (
                <DesignProposalPanel
                  proposal={architectureProposal}
                  existingNodeLabels={Object.fromEntries(
                    graph.nodes.map((n) => [
                      n.id,
                      n.suggestedLabel ?? n.label,
                    ])
                  )}
                  onApprove={(approved) => {
                    setArchitectureProposal(null);
                    vscode.postMessage({
                      type: "approveDesign",
                      proposal: approved,
                    });
                  }}
                  onReject={() => setArchitectureProposal(null)}
                />
              )}

              {agentPlan && (
                <AgentPlanPanel
                  plan={agentPlan}
                  currentTaskIndex={
                    typeof agentSession?.currentTaskIndex === "number"
                      ? agentSession.currentTaskIndex
                      : undefined
                  }
                  onDismiss={() => {
                    setAgentPlan(null);
                    setAgentPlanError(null);
                  }}
                />
              )}

              <DiffPreviewPanel entries={stagingEntries} />

              {tokenWarning && (
                <div
                  style={{
                    ...styles.panel,
                    borderLeft: "3px solid #f0883e",
                    fontSize: 12,
                    color: "#f0883e",
                  }}
                >
                  Token usage {tokenWarning.usage} / {tokenWarning.budget} (80%+)
                </div>
              )}

              {!rulesPreview && (
                <button
                  onClick={() => {
                    setRulesPreview(null);
                    vscode.postMessage({ type: "generateRules" });
                  }}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    ...styles.buttonBase,
                    ...styles.buttonSecondary,
                  }}
                >
                  Generate rules from scan
                </button>
              )}

              {rulesPreview && (
                <div style={styles.panel}>
                  <div style={{ ...styles.sectionHeader, marginBottom: 10 }}>
                    Suggested .arch-rules.json
                  </div>
                  {!rulesEditMode ? (
                    <>
                      <div style={{ marginBottom: 12, fontSize: 12 }}>
                        {rulesPreview.rules.map((r) => (
                          <div
                            key={r.id}
            style={{
                              marginBottom: 6,
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                            }}
                          >
                            <span style={{ color: r.severity === "error" ? "#f85149" : "#f0883e" }}>
                              {r.severity === "error" ? "⚠" : "ℹ"}
                            </span>
                            <span>
                              {r.description} ({r.severity})
                            </span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => vscode.postMessage({ type: "writeRules", raw: rulesPreview.raw })}
                          style={{ flex: 1, ...styles.buttonBase, ...styles.buttonPrimary }}
                        >
                          Accept and write
          </button>
          <button
                          onClick={() => setRulesEditMode(true)}
                          style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
                        >
                          Edit first
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <textarea
                        value={rulesPreview.raw}
                        onChange={(e) => setRulesPreview((p) => (p ? { ...p, raw: e.target.value } : null))}
                        rows={12}
            style={{
                          width: "100%",
                          padding: 8,
                          background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 6,
                          color: "#e6edf3",
                          fontSize: 11,
                          fontFamily: "monospace",
                          resize: "vertical",
                          outline: "none",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          onClick={() => vscode.postMessage({ type: "writeRules", raw: rulesPreview.raw })}
                          style={{ flex: 1, ...styles.buttonBase, ...styles.buttonPrimary }}
                        >
                          Accept and write
                        </button>
                        <button
                          onClick={() => setRulesEditMode(false)}
                          style={{ ...styles.buttonBase, ...styles.buttonSecondary }}
                        >
                          Back
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {generateRulesStatus === "success" && !rulesPreview && (
                <div style={{ fontSize: 12, color: "#3fb950" }}>✓ Rules saved to .arch-rules.json</div>
              )}

              {/* ─── 8. FOOTER ───────────────────────────────────────────── */}
              <button
                onClick={() => vscode.postMessage({ type: "refresh" })}
                style={{ marginTop: 12, width: "100%", ...styles.buttonBase, ...styles.buttonSecondary }}
          >
            Refresh graph
          </button>
            </>
          )}
        </div>

        {/* Resizable divider */}
        <div
          onMouseDown={handleMouseDown}
          onMouseEnter={() => setDividerHover(true)}
          onMouseLeave={() => setDividerHover(false)}
          style={{
            width: 4,
            background: resizing || dividerHover ? "#238636" : "transparent",
            cursor: "col-resize",
            flexShrink: 0,
          }}
          title="Drag to resize"
        />

        {/* Canvas (center, flex-grow) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading && !graph && (
            <div
              style={{
                color: "#7d8590",
                padding: 32,
                fontFamily: "monospace",
                fontSize: 14,
              }}
            >
              ⟳ {loading}
            </div>
          )}
          {graph && (
            <ArchCanvas
              graph={graph}
              selectedNode={selectedNode}
              selectedNodeData={selectedNodeData}
              onNodeSelect={setSelectedNode}
              onSaveContext={handleSaveContext}
              writeStatus={writeStatus}
              writeError={writeError}
              fileContentMap={fileContentMap}
              onClearFileContent={() => setFileContentMap({})}
              edgeFilter={edgeFilter}
              onFilterChange={setEdgeFilter}
              highlightedNodeIds={highlightedNodeIds}
              layerFilter={layerFilter}
              proposedNodes={architectureProposal?.nodes ?? []}
            />
          )}
        </div>
      </div>

      {/* Bottom: full-width chat panel (kept mounted; visibility toggled by tab) */}
      <div
        style={{
          height: CHAT_PANEL_HEIGHT,
          minHeight: 200,
          flexShrink: 0,
          borderTop: "1px solid #30363d",
          display: sidebarTab === "chat" ? "block" : "none",
        }}
      >
        <ChatPanel
          chats={chats}
          activeChatId={activeChatId}
          onActiveChatChange={setActiveChatId}
          onAddChat={addChat}
          onSend={handleAsk}
          selectedNode={selectedNode}
          loading={chatLoading}
          onCriticCreateJira={(message) => {
            if (!jiraBaseUrl || !jiraProjectKey) {
              vscode.postMessage({
                type: "showInfo",
                message:
                  "Connect Jira and select a project in Governance to create issues from Critic.",
              });
              return;
            }
            const base = jiraBaseUrl.replace(/\/$/, "");
            const summaryLine =
              message.content
                .replace(/^Critic:\s*/i, "")
                .split("\n")[0]
                .slice(0, 120) || "Architecture critique";
            const desc = message.content.replace(/^Critic:\s*/i, "");
            const url =
              base +
              `/secure/CreateIssueDetails!init.jspa?summary=` +
              encodeURIComponent(summaryLine) +
              `&description=` +
              encodeURIComponent(desc) +
              `&labels=` +
              encodeURIComponent("architect-critic");
            window.open(url, "_blank");
          }}
          onCriticCreateTasks={(message) => {
            if (!jiraBaseUrl || !jiraProjectKey) {
              vscode.postMessage({
                type: "showInfo",
                message:
                  "Connect Jira and select a project in Governance to create task issues from Critic.",
              });
              return;
            }
            const base = jiraBaseUrl.replace(/\/$/, "");
            const summaryLine = "Tasks from architect critique";
            const desc =
              "Critic output:\n\n" +
              message.content.replace(/^Critic:\s*/i, "") +
              "\n\n---\nConvert key points into Jira sub-tasks or checklist items.";
            const url =
              base +
              `/secure/CreateIssueDetails!init.jspa?summary=` +
              encodeURIComponent(summaryLine) +
              `&description=` +
              encodeURIComponent(desc) +
              `&labels=` +
              encodeURIComponent("architect-critic,critic-tasks");
            window.open(url, "_blank");
          }}
        />
      </div>
    </div>
  );
}
