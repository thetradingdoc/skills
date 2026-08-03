/**
 * Flow view.
 *
 * How a request travels: who can start one, what decides, what runs, what
 * gets touched. The Reach matrix answers "can this tool reach that?" for a
 * thousand pairs; this answers the question a reviewer actually asks first —
 * what happens on a call, and where is the identity check.
 *
 * The gap between column one and column four is the point. If nothing
 * authenticates on that path, the view says so between the columns rather
 * than as a footnote.
 */
import { useMemo, useState } from "react";
import type { AgentInventoryResult, AgentSurface, AgentTool } from "./types";

type Props = {
  agents: AgentInventoryResult | undefined;
  selectedAgentFile?: string | null;
  onSelectAgent?: (file: string) => void;
  /** Evidence is "path: reason". The path half is worth opening. */
  onOpenFile?: (path: string, line?: number) => void;
};

const CLASS_COLOR: Record<string, string> = {
  patient: "#f85149",
  money: "#d29922",
  external: "#58a6ff",
  internal: "#8b949e",
  unclassified: "#6e7681",
  plumbing: "#484f58",
};

const fileName = (f: string) => f.split(/[/\\]/).pop() || f;

const MONO = "JetBrains Mono, ui-monospace, monospace";

function Column({
  step,
  title,
  question,
  children,
}: {
  step: number;
  title: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          borderBottom: "1px solid #30363d",
          paddingBottom: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "#6e7681",
          }}
        >
          {step} · {title}
        </div>
        <div style={{ fontSize: 11.5, color: "#8b949e", marginTop: 3 }}>
          {question}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {children}
      </div>
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
        background: "rgba(22,27,34,0.7)",
        border: "1px solid #30363d",
        borderLeft: "3px solid " + (accent ?? "#30363d"),
        borderRadius: 7,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11.5,
          color: "#e6edf3",
          wordBreak: "break-word",
        }}
      >
        {label}
      </div>
      {sub ? (
        <div style={{ fontSize: 10.5, color: "#6e7681", marginTop: 3 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}


/** Evidence reads "path: reason". Only the path half is worth opening. */
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
          onClick={(e) => { e.stopPropagation(); onOpenFile!(path!); }}
          title={"Open " + path}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            font: "inherit",
            color: "#58a6ff",
            cursor: "pointer",
          }}
        >
          {path}
        </button>
      ) : (
        <span>{path ?? ""}</span>
      )}
      <span>{path ? ":" : ""}{rest}</span>
    </span>
  );
}
export function FlowView({
  onOpenFile,
  agents,
  selectedAgentFile,
  onSelectAgent,
}: Props) {
  const surfaces = useMemo(
    () => (agents?.agents ?? []).filter((a) => a.kind === "agent"),
    [agents]
  );

  const [localPick, setLocalPick] = useState<string | null>(null);
  const pickedFile = selectedAgentFile ?? localPick ?? surfaces[0]?.file ?? null;
  const agent: AgentSurface | undefined = surfaces.find(
    (a) => a.file === pickedFile
  );

  const catalogs = (agents as any)?.toolCatalogs ?? {};
  const toolsOf = (a: AgentSurface): AgentTool[] =>
    Array.isArray(a.tools) && a.tools.length
      ? a.tools
      : (a as any).catalogId
        ? (catalogs[(a as any).catalogId] ?? [])
        : [];

  if (!agents || surfaces.length === 0) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e" }}>
        No agent surfaces found — there is no request path to trace.
      </div>
    );
  }

  const tools = agent ? toolsOf(agent) : [];

  // Column 3: the tools that actually reach something sensitive lead, since
  // those are the ones a reviewer is asking about.
  const rank = (t: AgentTool) => {
    const c: any = (t as any).reach?.cells ?? {};
    return (
      (c.patient?.state === "reaches" ? 2 : 0) +
      (c.money?.state === "reaches" ? 1 : 0)
    );
  };
  const orderedTools = [...tools].sort((a, b) => rank(b) - rank(a));

  // Column 4: distinct resources across all tools, sensitive first.
  const resourceMap = new Map<
    string,
    { name: string; kind: string; cls: string; tools: number }
  >();
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
    (a, b) =>
      order.indexOf(a.cls) - order.indexOf(b.cls) || b.tools - a.tools
  );

  const ingress =
    (agent?.layers as any[] | undefined)?.find((l) => l.id === "ingress")
      ?.components ?? [];
  const reasoning =
    (agent?.layers as any[] | undefined)?.find((l) => l.id === "reasoning")
      ?.components ?? [];

  const authFound = !!agent?.auth?.found;
  const patientCount = tools.filter(
    (t) => (t as any).reach?.cells?.patient?.state === "reaches"
  ).length;
  const moneyCount = tools.filter(
    (t) => (t as any).reach?.cells?.money?.state === "reaches"
  ).length;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "14px 18px 60px" }}>
      {/* agent picker */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "#8b949e" }}>Showing</span>
        <select
          value={pickedFile ?? ""}
          onChange={(e) => {
            setLocalPick(e.target.value);
            onSelectAgent?.(e.target.value);
          }}
          style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 6,
            color: "#e6edf3",
            fontSize: 12,
            fontFamily: MONO,
            padding: "5px 8px",
          }}
        >
          {surfaces.map((a) => (
            <option key={a.file} value={a.file}>
              {fileName(a.file)} ({a.loopKind ?? "unknown"})
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: "#6e7681" }}>
          {tools.length} tools · {patientCount} reach patient data ·{" "}
          {moneyCount} reach money
        </span>
      </div>

      {/* the finding that sits between the columns */}
      {!authFound && (patientCount > 0 || moneyCount > 0) ? (
        <div
          style={{
            border: "1px solid rgba(248,81,73,0.35)",
            background: "rgba(248,81,73,0.06)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 18,
            fontSize: 12.5,
            color: "#e6edf3",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "#f85149", fontWeight: 600 }}>
            No authentication found in these files. Checks in callers or middleware are not detected.
          </strong>{" "}
          A request entering at step 1 reaches the resources in step 4 without
          an identity check.
          {agent?.auth?.evidence ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11.5,
                color: "#8b949e",
                fontFamily: MONO,
              }}
            >
              <EvidenceLink evidence={agent.auth.evidence} onOpenFile={onOpenFile} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 20,
        }}
      >
        <Column step={1} title="A request arrives" question="Who can start one?">
          {ingress.length === 0 ? (
            <Card label="no ingress mapped" sub="nothing was found calling into this agent" />
          ) : (
            ingress.slice(0, 8).map((c: any) => (
              <Card
                key={c.id}
                label={c.label}
                sub={authFound ? undefined : "none found in this file"}
                accent={authFound ? "#3fb950" : "#f85149"}
                title={c.evidence}
              />
            ))
          )}
        </Column>

        <Column step={2} title="The agent decides" question="What runs the turn?">
          {reasoning.length === 0 ? (
            <Card label="no reasoning layer found" />
          ) : (
            reasoning.slice(0, 6).map((c: any) => (
              <Card key={c.id} label={c.label} accent="#a371f7" title={c.evidence} />
            ))
          )}
          <Card
            label={agent?.provider ?? "unknown provider"}
            sub={agent?.model ?? "model not determinable"}
            accent="#a371f7"
          />
        </Column>

        <Column step={3} title="A tool runs" question="What can it call?">
          {orderedTools.length === 0 ? (
            <Card label="no tools declared" />
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
                    sub={
                      p && m
                        ? "patient · money"
                        : p
                          ? "patient"
                          : m
                            ? "money"
                            : undefined
                    }
                    accent={p ? "#f85149" : m ? "#d29922" : "#db6d9d"}
                    title={t.description ?? undefined}
                  />
                );
              })}
              {orderedTools.length > 12 ? (
                <div style={{ fontSize: 11, color: "#6e7681", padding: "2px 4px" }}>
                  + {orderedTools.length - 12} more
                </div>
              ) : null}
            </>
          )}
        </Column>

        <Column step={4} title="Something is touched" question="What does it reach?">
          {resources.length === 0 ? (
            <Card
              label="no resources traced"
              sub="the tracer could not follow this agent's tools"
            />
          ) : (
            <>
              {resources.slice(0, 12).map((r) => (
                <Card
                  key={r.kind + ":" + r.name}
                  label={r.name}
                  sub={r.cls + " · " + r.tools + " tool" + (r.tools === 1 ? "" : "s")}
                  accent={CLASS_COLOR[r.cls] ?? "#30363d"}
                />
              ))}
              {resources.length > 12 ? (
                <div style={{ fontSize: 11, color: "#6e7681", padding: "2px 4px" }}>
                  + {resources.length - 12} more
                </div>
              ) : null}
            </>
          )}
        </Column>
      </div>

      <p
        style={{
          marginTop: 28,
          fontSize: 11.5,
          color: "#484f58",
          maxWidth: "76ch",
          lineHeight: 1.6,
        }}
      >
        Each column is what the scan established, not what the code intends. A
        resource missing from step 4 may still be reached through a path the
        tracer could not follow — check the Reach view for what was left
        untraced.
      </p>
    </div>
  );
}
