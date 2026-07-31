/**
 * The dashboard, as a thing to act on.
 *
 * It was five cards of lists: agents, unscanned files, chat tasks, module-graph
 * filters, and a violations panel the critic no longer fills. Between them they
 * answered "what exists". None of them answered "what should I do", and almost
 * nothing was clickable.
 *
 * Three sections now, and every row goes somewhere. Findings lead because they
 * are the ranked answer to what matters; agents follow because that is the
 * inventory you check against; what could not be scanned comes last because a
 * gap you cannot see is worth stating but not worth leading with.
 *
 * Removed: the module-graph edge and node filters, which belong to a view this
 * dashboard is not about, and the violations card, which the critic used to
 * populate by inventing findings from prose.
 */
import { useMemo } from "react";
import { rankFindings, severityColor, type Finding } from "./findings";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type ViewKey =
  | "assessment"
  | "agents"
  | "files"
  | "reach"
  | "flow"
  | "layers"
  | "standard"
  | "guard"
  | "changes";

type Props = {
  graph?: any;
  evaluations?: any[];
  rulesText?: string;
  onOpenFile: (path: string, line?: number) => void;
  onGoToView: (view: ViewKey) => void;
  /** Selecting an agent so the view you land on is already focused on it. */
  onSelectAgent?: (file: string) => void;
};

const fileName = (p: string): string => p.split(/[/\\]/).pop() || p;

/** Where the evidence for a finding lives. */
const VIEW_FOR: Record<string, { view: ViewKey; label: string }> = {
  flow: { view: "flow", label: "Flow" },
  standard: { view: "standard", label: "Standard" },
  guard: { view: "guard", label: "Guard" },
  reach: { view: "reach", label: "Reach" },
  resources: { view: "reach", label: "Reach" },
};

function Stat({
  value,
  label,
  alarm,
}: {
  value: number;
  label: string;
  alarm?: boolean;
}) {
  if (value === 0) return null;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          color: alarm ? "#f85149" : "#e6edf3",
        }}
      >
        {value}
      </span>{" "}
      <span style={{ fontSize: 11, color: "#8b949e" }}>{label}</span>
    </span>
  );
}

export function DashboardView({
  graph,
  evaluations = [],
  rulesText,
  onOpenFile,
  onGoToView,
  onSelectAgent,
}: Props) {
  const findings = useMemo(
    () => (graph ? rankFindings(graph, evaluations) : []),
    [graph, evaluations]
  );

  const { agents, stats, python } = useMemo(() => {
    const inv = graph?.agents;
    const all: any[] = inv?.agents ?? [];
    const catalogs: Record<string, any[]> = inv?.toolCatalogs ?? {};
    const toolsOf = (a: any): any[] =>
      Array.isArray(a.tools) && a.tools.length
        ? a.tools
        : a.catalogId
          ? (catalogs[a.catalogId] ?? [])
          : [];

    const list = all.filter((a) => a.kind === "agent");
    const patient = new Set<string>();
    const money = new Set<string>();
    let noAuth = 0;

    const rows = list.map((a) => {
      const tools = toolsOf(a);
      const key = a.catalogId || a.file;
      let p = 0;
      let m = 0;
      for (const t of tools) {
        if (t?.reach?.cells?.patient?.state === "reaches") {
          p++;
          patient.add(key + "::" + t.name);
        }
        if (t?.reach?.cells?.money?.state === "reaches") {
          m++;
          money.add(key + "::" + t.name);
        }
      }
      const sensitive = p > 0 || m > 0;
      if (sensitive && !a.auth?.found) noAuth++;
      return {
        file: a.file,
        tools: tools.length,
        patient: p,
        money: m,
        authFound: !!a.auth?.found,
        alarm: sensitive && !a.auth?.found,
      };
    });

    rows.sort((x, y) => Number(y.alarm) - Number(x.alarm) || y.patient - x.patient);

    return {
      agents: rows,
      stats: {
        agents: list.length,
        noAuth,
        patient: patient.size,
        money: money.size,
      },
      python: (inv?.pythonAgents ?? []) as string[],
    };
  }, [graph]);

  if (!graph) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: "#8b949e", lineHeight: 1.65 }}>
        Scan a repository to see what it contains.
      </div>
    );
  }

  const top = findings.slice(0, 5);
  const rest = findings.length - top.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* the four numbers that matter */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          paddingBottom: 12,
          borderBottom: "1px solid #21262d",
        }}
      >
        <Stat value={stats.agents} label={stats.agents === 1 ? "agent" : "agents"} />
        <Stat value={stats.noAuth} label="without auth" alarm />
        <Stat value={stats.patient} label="tools reach patient data" alarm />
        <Stat value={stats.money} label="reach money" />
      </div>

      {/* what needs attention */}
      {findings.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.09em",
                color: "#6e7681",
              }}
            >
              WHAT NEEDS ATTENTION
            </span>
            <button
              type="button"
              onClick={() => onGoToView("assessment")}
              style={{
                marginLeft: "auto",
                fontFamily: MONO,
                fontSize: 10,
                background: "none",
                border: 0,
                color: "#58a6ff",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {rest > 0 ? "all " + findings.length : "assessment"} →
            </button>
          </div>

          {top.map((f: Finding) => {
            const dest = VIEW_FOR[f.source];
            return (
              <button
                key={f.id}
                type="button"
                title={f.detail}
                onClick={() => {
                  if (f.agent) onSelectAgent?.(f.agent);
                  if (dest) onGoToView(dest.view);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "58px 1fr auto",
                  gap: 10,
                  alignItems: "baseline",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: 0,
                  borderBottom: "1px solid #21262d",
                  padding: "7px 2px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: "0.06em",
                    color: severityColor(f.severity),
                    textTransform: "uppercase",
                  }}
                >
                  {f.severity}
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    color: "#e6edf3",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.title}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: "#6e7681",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dest?.label ?? ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* the inventory */}
      {agents.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.09em",
              color: "#6e7681",
              marginBottom: 8,
            }}
          >
            AGENTS
          </div>

          {agents.map((a) => (
            <button
              key={a.file}
              type="button"
              title={"Open " + a.file}
              onClick={() => {
                onSelectAgent?.(a.file);
                onOpenFile(a.file);
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 10,
                alignItems: "baseline",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: 0,
                borderBottom: "1px solid #21262d",
                padding: "7px 2px",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: "#e6edf3",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {fileName(a.file)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6e7681", whiteSpace: "nowrap" }}>
                {a.tools} tools
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  whiteSpace: "nowrap",
                  display: "flex",
                  gap: 7,
                }}
              >
                {!a.authFound && a.alarm ? (
                  <span style={{ color: "#f85149" }}>no auth</span>
                ) : null}
                {a.patient > 0 ? (
                  <span style={{ color: "#f85149" }}>{a.patient}p</span>
                ) : null}
                {a.money > 0 ? (
                  <span style={{ color: "#d29922" }}>{a.money}m</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* what the scan could not see */}
      {python.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.09em",
              color: "#6e7681",
              marginBottom: 6,
            }}
          >
            NOT SCANNED
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.6 }}>
            {python.length} Python{" "}
            {python.length === 1 ? "file imports" : "files import"} an agent
            framework and {python.length === 1 ? "is" : "are"} outside the
            graph — nothing above accounts for{" "}
            {python.length === 1 ? "it" : "them"}.
          </div>
          {python.map((p) => (
            <div
              key={p}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: "#d29922",
                marginTop: 4,
              }}
            >
              {p}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
