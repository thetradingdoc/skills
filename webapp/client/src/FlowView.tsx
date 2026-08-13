/**
 * Flow view — Path (request forensics) | Tasks (Kanban).
 * Same page Config → Flow used to open; lives under Workspace → Flow.
 */
import { useEffect, useMemo, useState } from "react";
import type { AgentInventoryResult, AgentSurface, AgentTool, ArchGraph } from "./types";
import {
  ACCENT,
  ACCENT_WASH,
  BAD,
  CANVAS,
  FONT_MONO,
  FONT_UI,
  GOOD,
  INK,
  LINE,
  PAPER,
  WARN,
  SLATE,
} from "./theme/tokens";
import { FlowTasksBoard } from "./FlowTasksBoard";

/** Bright accents (not grey) for class / columns */
const INFO = "#2563EB";
const DECIDING = "#7C3AED";

type Props = {
  agents: AgentInventoryResult | undefined;
  /** Optional — unused for path; kept for call-site compatibility. */
  graph?: ArchGraph;
  selectedAgentFile?: string | null;
  onSelectAgent?: (file: string) => void;
  onOpenFile?: (path: string, line?: number) => void;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  /** Open on Path or Tasks (Insights Add/Fix deep-link). */
  initialPane?: "path" | "tasks";
  /** Bump to force Tasks board reload after Add task. */
  tasksRefreshKey?: number;
  focusTodoId?: string | null;
  tasksNotice?: string | null;
  fixAgentDisabledReason?: string | null;
  dockMaximized?: boolean;
  hasProjectRoot?: boolean;
  onTodoApproved?: (todoId: string) => void;
};

const CLASS_COLOR: Record<string, string> = {
  patient: BAD,
  money: WARN,
  external: ACCENT,
  internal: INFO,
  unclassified: DECIDING,
  plumbing: INFO,
};

const fileName = (f: string) => f.split(/[/\\]/).pop() || f;

function Column({
  step,
  title,
  question,
  tipColor,
  children,
}: {
  step: number;
  title: string;
  question: string;
  tipColor: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ flex: "0 0 200px", minWidth: 200 }} data-testid={`flow-path-col-${step}`}>
      <div
        style={{
          borderBottom: `3px solid ${tipColor}`,
          paddingBottom: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: tipColor,
            fontWeight: 700,
          }}
        >
          {step} · {title}
        </div>
        <div style={{ fontSize: 12, color: INK, marginTop: 4, opacity: 0.75 }}>{question}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{children}</div>
    </div>
  );
}

function Card({
  label,
  sub,
  accent,
  title,
}: {
  label: string;
  sub?: string;
  accent?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      style={{
        background: CANVAS,
        border: `1px solid ${LINE}`,
        borderLeft: "4px solid " + (accent ?? ACCENT),
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 1px 0 rgba(18,19,26,0.04)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: INK,
          wordBreak: "break-word",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {sub ? (
        <div style={{ fontSize: 11, color: INK, opacity: 0.65, marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  );
}

function EvidenceLink({
  evidence,
  onOpenFile,
}: {
  evidence?: string | null;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  if (!evidence) return null;
  const i = evidence.indexOf(":");
  const path = i > 0 ? evidence.slice(0, i) : null;
  const rest = i > 0 ? evidence.slice(i + 1) : evidence;
  const openable = !!path && !!onOpenFile && /\.[jt]sx?$/.test(path);
  return (
    <span>
      {openable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFile!(path!);
          }}
          title={"Open " + path}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            font: "inherit",
            color: ACCENT,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {path}
        </button>
      ) : (
        <span>{path ?? ""}</span>
      )}
      <span>
        {path ? ":" : ""}
        {rest}
      </span>
    </span>
  );
}

function PathPane({
  agents,
  selectedAgentFile,
  onSelectAgent,
  onOpenFile,
  headerExtra,
}: Props & { headerExtra?: React.ReactNode }) {
  const surfaces = useMemo(
    () => (agents?.agents ?? []).filter((a) => a.kind === "agent"),
    [agents]
  );

  const [localPick, setLocalPick] = useState<string | null>(null);
  const pickedFile = selectedAgentFile ?? localPick ?? surfaces[0]?.file ?? null;
  const agent: AgentSurface | undefined = surfaces.find((a) => a.file === pickedFile);

  const catalogs = (agents as any)?.toolCatalogs ?? {};
  const toolsOf = (a: AgentSurface): AgentTool[] =>
    Array.isArray(a.tools) && a.tools.length
      ? a.tools
      : (a as any).catalogId
        ? (catalogs[(a as any).catalogId] ?? [])
        : [];

  if (!agents || surfaces.length === 0) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: INK, fontFamily: FONT_UI }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          {headerExtra}
        </div>
        No agent surfaces found — there is no request path to trace. Use Tasks to track build work.
      </div>
    );
  }

  const tools = agent ? toolsOf(agent) : [];
  const rank = (t: AgentTool) => {
    const c: any = (t as any).reach?.cells ?? {};
    return (c.patient?.state === "reaches" ? 2 : 0) + (c.money?.state === "reaches" ? 1 : 0);
  };
  const orderedTools = [...tools].sort((a, b) => rank(b) - rank(a));

  const resourceMap = new Map<string, { name: string; kind: string; cls: string; tools: number }>();
  for (const t of tools) {
    for (const r of ((t as any).reach?.resources ?? []) as any[]) {
      if (!r?.name) continue;
      if (r.class === "plumbing") continue;
      const key = r.kind + ":" + r.name;
      const prev = resourceMap.get(key);
      resourceMap.set(key, {
        name: r.name,
        kind: r.kind,
        cls: r.class ?? "unclassified",
        tools: (prev?.tools ?? 0) + 1,
      });
    }
  }
  const order = ["patient", "money", "external", "internal", "unclassified"];
  const resources = [...resourceMap.values()].sort(
    (a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || b.tools - a.tools
  );

  const ingress =
    (agent?.layers as any[] | undefined)?.find((l) => l.id === "ingress")?.components ?? [];
  const reasoning =
    (agent?.layers as any[] | undefined)?.find((l) => l.id === "reasoning")?.components ?? [];

  const authFound = !!agent?.auth?.found;
  const patientCount = tools.filter(
    (t) => (t as any).reach?.cells?.patient?.state === "reaches"
  ).length;
  const moneyCount = tools.filter((t) => (t as any).reach?.cells?.money?.state === "reaches").length;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "14px 18px 60px", fontFamily: FONT_UI }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {headerExtra}
        <span style={{ fontSize: 12, color: INK, fontWeight: 600 }}>Showing</span>
        <select
          data-testid="flow-agent-select"
          value={pickedFile ?? ""}
          onChange={(e) => {
            setLocalPick(e.target.value);
            onSelectAgent?.(e.target.value);
          }}
          style={{
            background: CANVAS,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
            color: INK,
            fontSize: 12,
            fontFamily: FONT_MONO,
            padding: "6px 10px",
          }}
        >
          {surfaces.map((a) => (
            <option key={a.file} value={a.file}>
              {fileName(a.file)} ({a.loopKind ?? "unknown"})
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: INK, opacity: 0.7 }}>
          {tools.length} tools · {patientCount} patient · {moneyCount} money
        </span>
      </div>

      {!authFound && (patientCount > 0 || moneyCount > 0) ? (
        <div
          data-testid="flow-auth-banner"
          style={{
            border: `1px solid ${BAD}`,
            background: "#FEF2F2",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 18,
            fontSize: 13,
            color: INK,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: BAD, fontWeight: 700 }}>
            No authentication found in these files. Checks in callers or middleware are not detected.
          </strong>{" "}
          A request entering at step 1 reaches the resources in step 4 without an identity check.
          {agent?.auth?.evidence ? (
            <div style={{ marginTop: 6, fontSize: 12, fontFamily: FONT_MONO }}>
              <EvidenceLink evidence={agent.auth.evidence} onOpenFile={onOpenFile} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        data-testid="flow-path-columns"
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 20,
          overflowX: "auto",
          paddingBottom: 8,
          alignItems: "flex-start",
        }}
      >
        <Column step={1} title="A request arrives" question="Who can start one?" tipColor={INFO}>
          {ingress.length === 0 ? (
            <Card label="no ingress mapped" sub="nothing was found calling into this agent" accent={INFO} />
          ) : (
            ingress.slice(0, 8).map((c: any) => (
              <Card
                key={c.id}
                label={c.label}
                sub={authFound ? undefined : "none found in this file"}
                accent={authFound ? GOOD : BAD}
                title={c.evidence}
              />
            ))
          )}
        </Column>

        <Column step={2} title="The agent decides" question="What runs the turn?" tipColor={DECIDING}>
          {reasoning.length === 0 ? (
            <Card label="no reasoning layer found" accent={DECIDING} />
          ) : (
            reasoning.slice(0, 6).map((c: any) => (
              <Card key={c.id} label={c.label} accent={DECIDING} title={c.evidence} />
            ))
          )}
          <Card
            label={agent?.provider ?? "unknown provider"}
            sub={agent?.model ?? "model not determinable"}
            accent={DECIDING}
          />
        </Column>

        <Column step={3} title="A tool runs" question="What can it call?" tipColor={ACCENT}>
          {orderedTools.length === 0 ? (
            <Card label="no tools declared" accent={ACCENT} />
          ) : (
            <>
              {orderedTools.slice(0, 12).map((t) => {
                const c: any = (t as any).reach?.cells ?? {};
                const p = c.patient?.state === "reaches";
                const m = c.money?.state === "reaches";
                return (
                  <Card
                    key={t.name}
                    label={t.name ?? "(unnamed)"}
                    sub={p && m ? "patient · money" : p ? "patient" : m ? "money" : undefined}
                    accent={p ? BAD : m ? WARN : ACCENT}
                    title={t.description ?? undefined}
                  />
                );
              })}
              {orderedTools.length > 12 ? (
                <div style={{ fontSize: 12, color: ACCENT, padding: "2px 4px", fontWeight: 600 }}>
                  + {orderedTools.length - 12} more
                </div>
              ) : null}
            </>
          )}
        </Column>

        <Column step={4} title="Something is touched" question="What does it reach?" tipColor={WARN}>
          {resources.length === 0 ? (
            <Card
              label="no resources traced"
              sub="the tracer could not follow this agent's tools"
              accent={WARN}
            />
          ) : (
            <>
              {resources.slice(0, 12).map((r) => (
                <Card
                  key={r.kind + ":" + r.name}
                  label={r.name}
                  sub={r.cls + " · " + r.tools + " tool" + (r.tools === 1 ? "" : "s")}
                  accent={CLASS_COLOR[r.cls] ?? INFO}
                />
              ))}
              {resources.length > 12 ? (
                <div style={{ fontSize: 12, color: WARN, padding: "2px 4px", fontWeight: 600 }}>
                  + {resources.length - 12} more
                </div>
              ) : null}
            </>
          )}
        </Column>
      </div>

      <p style={{ marginTop: 28, fontSize: 12, color: INK, opacity: 0.7, maxWidth: "76ch", lineHeight: 1.6 }}>
        Each column is what the scan established, not what the code intends. Use the Tasks tab to
        track Payment → Broker → Policy → Execution work.
      </p>
    </div>
  );
}

function TabBtn({
  active,
  testId,
  label,
  onClick,
}: {
  active: boolean;
  testId: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        padding: "7px 14px",
        borderRadius: 8,
        border: active ? `2px solid ${ACCENT}` : `1px solid ${LINE}`,
        background: active ? ACCENT_WASH : CANVAS,
        color: active ? ACCENT : INK,
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: FONT_UI,
      }}
    >
      {label}
    </button>
  );
}

export function FlowView(props: Props) {
  const [pane, setPane] = useState<"path" | "tasks">(props.initialPane ?? "path");
  /** When parent opens Path alone (System dock), hide the legacy dual Path|Tasks tab chrome. */
  const dedicated = props.initialPane === "path" || props.initialPane === "tasks";

  useEffect(() => {
    if (props.initialPane) setPane(props.initialPane);
  }, [props.initialPane, props.tasksRefreshKey]);

  const tabs = dedicated ? null : (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }} data-testid="flow-tabs">
      <TabBtn active={pane === "path"} testId="flow-tab-path" label="Path" onClick={() => setPane("path")} />
      <TabBtn
        active={pane === "tasks"}
        testId="flow-tab-tasks"
        label="Tasks"
        onClick={() => setPane("tasks")}
      />
    </div>
  );

  if (pane === "tasks") {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: PAPER }}>
        {tabs ? (
          <div
            style={{
              padding: "12px 18px",
              borderBottom: `1px solid ${LINE}`,
              background: CANVAS,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {tabs}
          </div>
        ) : null}
        <div style={{ flex: 1, minHeight: 0 }} key={props.tasksRefreshKey ?? 0}>
          <FlowTasksBoard
            workspaceId={props.workspaceId}
            accessToken={props.accessToken}
            apiBase={props.apiBase}
            agentFile={props.selectedAgentFile}
            agents={props.agents}
            onSelectAgent={props.onSelectAgent}
            focusTodoId={props.focusTodoId}
            notice={props.tasksNotice}
            refreshKey={props.tasksRefreshKey}
            onOpenFile={props.onOpenFile ? (path) => props.onOpenFile?.(path) : undefined}
            fixAgentDisabledReason={props.fixAgentDisabledReason}
            dockMaximized={props.dockMaximized}
            hasProjectRoot={props.hasProjectRoot}
            onApproved={props.onTodoApproved}
          />
        </div>
      </div>
    );
  }

  const agentCount = props.agents?.agents?.filter((a) => a.kind === "agent").length ?? 0;
  if (agentCount === 0 && dedicated) {
    return (
      <div
        data-testid="blanko-path-empty"
        style={{
          height: "100%",
          padding: 24,
          fontFamily: FONT_UI,
          color: INK,
          background: PAPER,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>No agent surfaces found</div>
        <div style={{ fontSize: 13, color: SLATE, lineHeight: 1.5, maxWidth: "42ch" }}>
          This view needs a scanned code agent. Use Tasks to track build tasks instead.
        </div>
      </div>
    );
  }

  return <PathPane {...props} headerExtra={tabs} />;
}
