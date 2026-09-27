import { useEffect, useState } from "react";
import type { AgentHarnessConfig, ArchGraph } from "../types";
import { ACCENT, ACCENT_WASH, CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

type Page = "overview" | "loop" | "graph" | "memory" | "tools" | "database" | "ops" | "models" | "behaviour";
type Section = "Build" | "Knowledge & tools" | "Safety" | "Runs";
const SECTIONS: { id: Section; pages: Page[] }[] = [
  { id: "Build", pages: ["overview", "loop", "graph"] },
  { id: "Knowledge & tools", pages: ["memory", "tools", "database"] },
  { id: "Safety", pages: ["models", "behaviour"] },
  { id: "Runs", pages: ["ops"] },
];
const PAGES: { id: Page; title: string; summary: string }[] = [
  { id: "overview", title: "Overview", summary: "See what is configured and what still needs connecting." },
  { id: "loop", title: "Agent loop", summary: "The repeatable think → act → observe cycle and its limits." },
  { id: "graph", title: "Workflow", summary: "The connected components that define how this agent works." },
  { id: "memory", title: "Memory", summary: "Context the agent can retain and retrieve." },
  { id: "tools", title: "Tools", summary: "Capabilities the agent is allowed to call." },
  { id: "database", title: "Data", summary: "Repository and data connections used by this workspace." },
  { id: "ops", title: "Run history", summary: "Run history, trace visibility, and release readiness." },
  { id: "models", title: "Models", summary: "Choose the reasoning model and fallback." },
  { id: "behaviour", title: "Rules & guardrails", summary: "Set the agent's instructions, safety limits, and tool policy." },
];

type Config = AgentHarnessConfig;
type MongoStatus = { connectionScope?: "server" | "workspace"; configured: boolean; connected: boolean; host?: string; database?: string; embeddingProviderConfigured?: boolean; vectorIndexVerified?: boolean; vectorSearchReady?: boolean; vectorSearchNote?: string; probeFailed?: boolean };
type RunResponse = { output?: string; trace?: Array<{ kind: string; label: string; detail?: string; at: string }>; proposal?: { changes: Partial<Config>; reason: string } | null; error?: string; iterations?: number; traceSaved?: boolean; traceSaveNote?: string; promptVersion?: string; promptHash?: string; buildTaskRailId?: string };
type SavedTrace = { id: string; summary?: string | null; status?: string; created_at?: string };
const DEFAULT_CONFIG: Config = {
  rules: "Follow the user's goal. Explain important decisions in plain language.",
  context: "Use the current task and connected repository as context. Prefer relevant files over unrelated history.",
  guardrails: "Ask before external or destructive actions. Never expose secrets. Keep a trace of each run.",
  toolAccess: "Repository read: allowed\nRepository write: review before applying\nExternal services: connect explicitly",
  behaviour: "Be direct, helpful, and careful. If evidence is missing, say so instead of guessing.",
  model: "",
};
const INPUT_STYLE = { width: "100%", boxSizing: "border-box" as const, minHeight: 84, resize: "vertical" as const, border: `1px solid ${LINE}`, borderRadius: 10, padding: 11, font: `12px/1.55 ${FONT_UI}`, color: INK, background: CANVAS };

type Props = { graph: ArchGraph; workspaceId?: string | null; accessToken?: string | null; apiBase?: string; onPlace: (id: string) => void; onOpenTasks: () => void; onOpenComponents: () => void; onConfigChange: (config: Config) => void; onLayoutModeChange?: (mode: "elk") => void };

export function HarnessDock({ graph, workspaceId, accessToken, apiBase = "/api", onPlace, onOpenTasks, onOpenComponents, onConfigChange, onLayoutModeChange }: Props) {
  const [page, setPage] = useState<Page>("overview");
  const [section, setSection] = useState<Section>("Build");
  const [config, setConfig] = useState<Config>(() => ({ ...DEFAULT_CONFIG, ...graph.harnessConfig }));
  const [saved, setSaved] = useState(true);
  const [runInput, setRunInput] = useState("");
  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [savedTraces, setSavedTraces] = useState<SavedTrace[]>([]);
  const [mongoStatus, setMongoStatus] = useState<MongoStatus | null>(null);
  const [mongoStatusLoading, setMongoStatusLoading] = useState(false);
  const [buildPaths, setBuildPaths] = useState("");
  const [buildTaskLoading, setBuildTaskLoading] = useState(false);
  const [buildTaskError, setBuildTaskError] = useState("");
  useEffect(() => {
    setConfig({ ...DEFAULT_CONFIG, ...graph.harnessConfig });
    setSaved(true);
  }, [graph.harnessConfig]);
  const nodes = graph.nodes ?? [];
  // Match the server's executable-agent check. Repository modules with names
  // like "Agent Status" are architecture evidence, not runnable Harness blocks.
  const agentNode = nodes.find((node) => node.id.startsWith("design-agent-") || node.properties?.harnessRole === "agent");
  const componentCount = nodes.length;
  const edgeCount = graph.edges?.length ?? 0;
  useEffect(() => {
    if (!workspaceId || !accessToken || (page !== "overview" && page !== "database")) return;
    let cancelled = false;
    setMongoStatusLoading(true);
    fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/harness/mongodb/status`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((response) => response.ok ? response.json() as Promise<MongoStatus> : null)
      .then((status) => { if (!cancelled) setMongoStatus(status); })
      .catch(() => { if (!cancelled) setMongoStatus(null); })
      .finally(() => { if (!cancelled) setMongoStatusLoading(false); });
    return () => { cancelled = true; };
  }, [page, workspaceId, accessToken, apiBase]);
  useEffect(() => {
    if (page !== "ops" || !workspaceId || !accessToken || !agentNode) return;
    let cancelled = false;
    fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(agentNode.id)}/llmops`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && Array.isArray(data?.traces)) setSavedTraces(data.traces as SavedTrace[]); })
      .catch(() => { if (!cancelled) setSavedTraces([]); });
    return () => { cancelled = true; };
  }, [page, workspaceId, accessToken, apiBase, agentNode?.id]);
  const ready = Boolean(agentNode);
  const active = PAGES.find((p) => p.id === page)!;
  const visiblePages = SECTIONS.find((item) => item.id === section)!.pages.map((id) => PAGES.find((p) => p.id === id)!);
  const navigateToPage = (next: Page) => {
    const nextSection = SECTIONS.find((item) => item.pages.includes(next));
    if (nextSection) setSection(nextSection.id);
    setPage(next);
  };
  const selectSection = (next: Section) => {
    setSection(next);
    const nextPages = SECTIONS.find((item) => item.id === next)!.pages;
    if (!nextPages.includes(page)) navigateToPage(nextPages[0]);
  };
  const edit = (field: keyof Config, value: string) => { setConfig((prev) => ({ ...prev, [field]: value })); setSaved(false); };
  const save = () => { onConfigChange(config); setSaved(true); };
  const runAgent = async () => {
    if (!workspaceId || !accessToken || !runInput.trim() || runLoading) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      const response = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/harness/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: runInput.trim(), graph: { ...graph, harnessConfig: config } }),
      });
      const data = await response.json().catch(() => ({})) as RunResponse;
      if (!response.ok) throw new Error(data.error || `Run failed (${response.status})`);
      setRunResult(data);
    } catch (error) {
      setRunResult({ error: error instanceof Error ? error.message : String(error) });
    } finally { setRunLoading(false); }
  };
  const createBuildTask = async () => {
    if (!workspaceId || !accessToken || !runResult?.output || buildTaskLoading) return;
    const paths = [...new Set(buildPaths.split(/[\n,]/).map((value) => value.trim()).filter(Boolean))];
    if (!paths.length || paths.length > 3) { setBuildTaskError("Enter one to three existing repository file paths."); return; }
    setBuildTaskLoading(true);
    setBuildTaskError("");
    try {
      const proposedChange = runResult.proposal
        ? `${runResult.proposal.reason}\n\nProposed harness settings:\n${JSON.stringify(runResult.proposal.changes, null, 2)}`
        : runResult.output;
      const goal = [
        "Implement the reviewed Harness finding in the selected files only. The task runner supplies the current contents of the selected file; do not call read_file for that file. Use write_file to make the requested change and preserve unrelated content.",
        "Keep the change scoped to the connected repository and the selected paths. Do not alter broker execution, trading, risk, order, authentication, or security behavior, and do not perform live trading or external side effects.",
        `Finding to implement:\n${proposedChange}`,
      ].join("\n\n").slice(0, 2000);
      const response = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/harness/build-task`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ goal, paths }),
      });
      const data = await response.json().catch(() => ({})) as { railId?: string; error?: string };
      if (!response.ok || !data.railId) throw new Error(data.error || `Could not create build task (${response.status}).`);
      setRunResult((current) => current ? { ...current, buildTaskRailId: data.railId } : current);
      onOpenTasks();
    } catch (error) {
      setBuildTaskError(error instanceof Error ? error.message : String(error));
    } finally { setBuildTaskLoading(false); }
  };
  const field = (label: string, name: keyof Config, hint: string) => <label key={name} style={{ display: "block", margin: "14px 0" }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5, color: INK }}>{label}</span><span style={{ display: "block", color: SLATE, fontSize: 12, marginBottom: 7 }}>{hint}</span><textarea aria-label={label} value={config[name]} onChange={(e) => edit(name, e.target.value)} style={INPUT_STYLE} /></label>;
  const card = (title: string, text: string, action?: () => void, actionLabel?: string) => <div key={title} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 13, marginBottom: 9, background: CANVAS }}><div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{title}</div><div style={{ fontSize: 12, lineHeight: 1.5, color: SLATE, marginTop: 5 }}>{text}</div>{action && <button onClick={action} style={buttonStyle}>{actionLabel ?? "Open"}</button>}</div>;
  return <div data-testid="blanko-harness-dock" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, fontFamily: FONT_UI, color: INK }}>
    <div style={{ display: "flex", gap: 0, minHeight: 0, flex: 1 }}>
      <nav aria-label="Agent harness sections" style={{ width: 148, flexShrink: 0, padding: "10px 7px", borderRight: `1px solid ${LINE}`, overflowY: "auto", background: "#fafafa" }}>
        <div style={{ display: "grid", gap: 4, marginBottom: 12 }}>
          {SECTIONS.map((item) => <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => selectSection(item.id)} style={{ display: "block", width: "100%", textAlign: "left", border: `1px solid ${section === item.id ? ACCENT : "transparent"}`, borderRadius: 8, padding: "8px", background: section === item.id ? ACCENT_WASH : "transparent", color: section === item.id ? ACCENT : INK, font: `650 12px ${FONT_UI}`, cursor: "pointer" }}>{item.id}</button>)}
        </div>
        <div style={{ height: 1, background: LINE, margin: "8px 4px 10px" }} />
        {visiblePages.map((p) => <button key={p.id} type="button" aria-current={page === p.id ? "page" : undefined} onClick={() => navigateToPage(p.id)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: 8, padding: "8px", margin: "2px 0", background: page === p.id ? "#fff" : "transparent", color: page === p.id ? ACCENT : INK, font: `600 12px ${FONT_UI}`, cursor: "pointer", boxShadow: page === p.id ? `inset 2px 0 ${ACCENT}` : "none" }}>{p.title}</button>)}
      </nav>
      <main style={{ flex: 1, overflow: "auto", padding: 16, minWidth: 0 }}>
        <div style={{ fontSize: 18, letterSpacing: "-.03em", fontWeight: 750 }}>{active.title}</div><div style={{ fontSize: 12, lineHeight: 1.5, color: SLATE, marginTop: 5, marginBottom: 14 }}>{active.summary}</div>
        {page === "overview" && <>
          {card("Agent workflow", ready ? `${agentNode!.label} is available · ${componentCount} canvas blocks · ${edgeCount} connections.` : `${componentCount} scanned canvas blocks, but no Agent block is configured. A repository map alone cannot run as an agent.`, onOpenComponents, ready ? "Add components" : "Add an Agent")}
          {card("Harness settings", "Rules and context are saved with this design. Runtime permissions depend on connected blocks and server-side checks.", () => navigateToPage("behaviour"), "Configure rules")}
          {card("Connected repository", graph.projectRoot ? graph.projectRoot : "No repository root is attached to this canvas yet.", () => navigateToPage("database"), "Repository & data")}
          {card("MongoDB Atlas", mongoStatusLoading ? "Checking the server's Atlas connection…" : mongoStatus?.probeFailed ? "Could not check MongoDB status. The server did not return a usable status." : mongoStatus?.connected ? `Connected · ${mongoStatus.database || "database not reported"} · ${mongoStatus.host || "Atlas host"}. Embeddings ${mongoStatus.embeddingProviderConfigured ? "configured" : "not configured"}; Vector Search index ${mongoStatus.vectorIndexVerified ? "verified" : "not verified"}.` : mongoStatus?.configured ? "Connection is configured on the server, but Atlas could not be reached." : "No MongoDB URI is configured in the server environment.", () => navigateToPage("database"), "View data")}
          {card("Request entry", "Start with chat, an API, or a webhook. Add its component from Components, then connect it to the Agent.", onOpenComponents, "Browse components")}
          <section style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 13, marginBottom: 9, background: CANVAS }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Run this agent</div>
            <div style={{ color: SLATE, fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>Runs this workflow through a bounded model/tool loop. Repository tools are read-only; harness changes are returned for your review.</div>
            <textarea aria-label="Agent request" placeholder="What should this agent do?" value={runInput} onChange={(e) => setRunInput(e.target.value)} style={{ ...INPUT_STYLE, minHeight: 72, marginTop: 10 }} />
            <button disabled={!workspaceId || !accessToken || !agentNode || !runInput.trim() || runLoading} onClick={() => void runAgent()} style={{ ...buttonStyle, background: ACCENT, color: "white", opacity: !workspaceId || !accessToken || !agentNode || !runInput.trim() || runLoading ? 0.5 : 1, cursor: runLoading ? "wait" : "pointer" }}>{runLoading ? "Running…" : "Run agent"}</button>
            {!agentNode ? <div role="status" style={{ color: SLATE, fontSize: 11, marginTop: 7 }}>Add an Agent block to this canvas before running. Scanned repository modules are context, not an executable harness.</div> : null}
            {!workspaceId || !accessToken ? <div style={{ color: SLATE, fontSize: 11, marginTop: 7 }}>Sign in and open a saved workspace to run.</div> : null}
          </section>
          {runResult ? <RunResultCard result={runResult} onApply={(changes) => { const next = { ...config, ...changes }; setConfig(next); onConfigChange(next); setSaved(true); }} buildPaths={buildPaths} onBuildPathsChange={setBuildPaths} onCreateBuildTask={() => void createBuildTask()} buildTaskLoading={buildTaskLoading} buildTaskError={buildTaskError} /> : null}
          {card("Repository code agent", "Use Tasks for Blanko's existing code-agent task and approval flow.", onOpenTasks, "Open Tasks")}
        </>}
        {page === "loop" && <>{card("Agent cycle", "The runtime now runs a bounded think → act → observe loop, checks connected tool blocks, and stops after eight model turns.", () => onPlace("agent"), "Add agent block")}{card("Iteration limit", "Hard limit: 8 model/tool turns per request. Read-only repository tools run only when connected to an Agent block.")}{field("Context policy", "context", "What information should enter each model turn?")}{field("Safety limits", "guardrails", "What must the agent stop or ask permission for?")}</>}
        {page === "graph" && <>{card("Canvas composition", `${componentCount} blocks · ${edgeCount} connections. Select Edit in the canvas toolbar, then drag from a component handle to connect the workflow.`, onOpenComponents, "Browse components")}{onLayoutModeChange && <section style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 13, marginBottom: 9, background: CANVAS }}><div style={{ fontSize: 13, fontWeight: 700 }}>Canvas layout</div><div style={{ color: SLATE, fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>Arrange connected steps from left to right for a workflow view.</div><button type="button" onClick={() => onLayoutModeChange("elk")} style={{ ...buttonStyle, background: ACCENT, color: "white" }}>Arrange left to right</button></section>}</>}
        {page === "memory" && <>{card("Memory policy", "The runner can retrieve and save agent-scoped memories when an Agent is connected to a Vector DB / MongoDB block and the server has MongoDB and embedding-provider credentials. Atlas must also have the expected vector index configured.")}{field("Context policy", "context", "Define which task and repository context the agent should use.")}{card("Canvas blocks", "Connect a Memory or Vector DB block to an Agent to enable the corresponding runtime memory tools.", () => onPlace("memory"), "Add memory block")}</>}
        {page === "tools" && <>{field("Tool access policy", "toolAccess", "List allowed tools and the approval required for sensitive actions.")}{card("Repository tool blocks", "These read-only components become available to the Agent when you connect them on the canvas. They use this workspace’s connected repository.", () => onPlace("repo-list-files"), "＋ List files")}{card("Search repository", "Connects text search in approved source and documentation files to the Agent.", () => onPlace("repo-search-files"), "＋ Search files")}{card("Read repository file", "Connects safe, read-only file access to the Agent. Environment files and unsupported file types are blocked.", () => onPlace("repo-read-file"), "＋ Read file")}{card("Other integrations", "For other services, place an integration component. A visual connection does not create credentials or grant access until a runtime adapter is configured.", () => onOpenComponents(), "Browse components")}</>}
        {page === "database" && <>{card("Repository", graph.projectRoot || "No repository is attached. Connect a repo to ground the agent in files.", onOpenComponents, "Browse connections")}{card("MongoDB Atlas", mongoStatusLoading ? "Checking the server's Atlas connection…" : mongoStatus?.probeFailed ? "Could not check MongoDB status. The server did not return a usable status." : mongoStatus?.connected ? `Connected to ${mongoStatus.host || "Atlas"} · database ${mongoStatus.database || "not reported"}. Embedding provider ${mongoStatus.embeddingProviderConfigured ? "configured" : "not configured"}; Vector Search index ${mongoStatus.vectorIndexVerified ? "verified" : "not verified"}.` : mongoStatus?.configured ? "MongoDB is configured on the server, but Atlas did not respond to the connection check." : "No MongoDB URI is configured in the server environment.")}{card("Data components", "Connect a Vector DB / MongoDB block to an Agent to make its database tools available in the harness. Atlas connection status alone does not prove a vector index or news-ingestion pipeline is ready.", onOpenComponents, "Browse data blocks")}{card("Providers and services", "Credentials stay in connected services; placing a component models a connection but does not create credentials.", onOpenComponents, "Browse integrations")}</>}
        {page === "ops" && <>{runResult ? <RunResultCard result={runResult} onApply={(changes) => { const next = { ...config, ...changes }; setConfig(next); onConfigChange(next); setSaved(true); }} buildPaths={buildPaths} onBuildPathsChange={setBuildPaths} onCreateBuildTask={() => void createBuildTask()} buildTaskLoading={buildTaskLoading} buildTaskError={buildTaskError} /> : null}{savedTraces.length ? <section style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 13, marginBottom: 9 }}><div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7 }}>Recent agent runs</div>{savedTraces.slice(0, 10).map((trace) => <div key={trace.id} style={{ borderTop: `1px solid ${LINE}`, padding: "8px 0", fontSize: 11 }}><div style={{ color: SLATE }}>{trace.created_at ? new Date(trace.created_at).toLocaleString() : "Saved trace"} · {trace.status ?? "ok"}</div><div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{trace.summary}</div></div>)}</section> : card("Run history", workspaceId ? "No saved runs yet for this Agent block." : "Open a saved workspace to view its run history.")}{card("Evaluations", "Compare runnable agent versions against examples before sharing. Evaluation runs are not available in this panel yet.")}{card("Repository agent tasks", "Use Tasks for Blanko's existing code-agent task and approval flow.", onOpenTasks, "Open Tasks")}{card("Current design", `${componentCount} blocks and ${edgeCount} links.`)}</>}
        {page === "models" && <>{field("Model preference", "model", "Set a model name here, or connect an LLM component. Credentials are configured through the provider connection; keys are never stored in this design.")}{card("Provider connections", "Choose an integration from Components and configure its credentials in workspace setup.", onOpenComponents, "Browse integrations")}</>}
        {page === "behaviour" && <>{field("Agent rules", "rules", "Instructions included in each model turn.")}{field("Context policy", "context", "What context the agent should use for each request.")}{field("Guardrails", "guardrails", "Rules included with each request. Runtime permission limits remain enforced separately.")}{field("Tool access", "toolAccess", "Describe allowed capabilities. Repository tools are additionally limited by connected blocks and server-side path rules.")}</>}
      </main>
    </div>
    <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 12px", borderTop: `1px solid ${LINE}`, fontSize: 11, color: SLATE }}><span>{saved ? "Applied to canvas · use Save above to persist" : "Unsaved harness changes"}</span><button onClick={save} style={{ ...buttonStyle, margin: 0, fontSize: "11px", background: saved ? CANVAS : ACCENT, color: saved ? INK : "white" }}>Apply to canvas</button></footer>
  </div>;
}

const buttonStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, background: CANVAS, color: INK, padding: "7px 9px", font: "600 11px -apple-system, BlinkMacSystemFont, sans-serif", marginTop: 9, marginRight: 6, cursor: "pointer" };

function RunResultCard({ result, onApply, buildPaths, onBuildPathsChange, onCreateBuildTask, buildTaskLoading, buildTaskError }: { result: RunResponse; onApply: (changes: Partial<Config>) => void; buildPaths: string; onBuildPathsChange: (value: string) => void; onCreateBuildTask: () => void; buildTaskLoading: boolean; buildTaskError: string }) {
  return <section style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 13, margin: "10px 0", background: CANVAS }}>
    <div style={{ fontSize: 12, fontWeight: 700 }}>{result.error ? "Run needs attention" : "Run result"}</div>
    {result.error ? <div role="alert" style={{ color: "#b42318", fontSize: 11, marginTop: 6 }}>{result.error}</div> : <div style={{ fontSize: 11, whiteSpace: "pre-wrap", lineHeight: 1.5, marginTop: 7, color: INK }}>{result.output}</div>}
    {result.iterations != null ? <div style={{ color: SLATE, fontSize: 10, marginTop: 8 }}>{result.iterations} model turns{result.traceSaved ? " · trace saved" : ""}</div> : null}
    {result.promptVersion ? <div style={{ color: SLATE, fontSize: 10, marginTop: 5 }}>Policy {result.promptVersion}{result.promptHash ? ` · ${result.promptHash.slice(0, 12)}` : ""}</div> : null}
    {result.traceSaveNote ? <div style={{ color: SLATE, fontSize: 10, marginTop: 5 }}>{result.traceSaveNote}</div> : null}
    {!result.error && result.output && !result.buildTaskRailId ? <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 10, paddingTop: 9 }}><div style={{ fontSize: 11, fontWeight: 700 }}>Build from this finding</div><div style={{ color: SLATE, fontSize: 10, lineHeight: 1.45, marginTop: 4 }}>Choose 1–3 existing source or documentation files. Blanko will create a task in its isolated builder; nothing runs or changes until you start it from Tasks.</div><textarea aria-label="Files for isolated build task" placeholder="Example: docs/trading/TRADING_OS.md" value={buildPaths} onChange={(event) => onBuildPathsChange(event.target.value)} style={{ ...INPUT_STYLE, minHeight: 56, marginTop: 8 }} /><button disabled={buildTaskLoading} onClick={onCreateBuildTask} style={{ ...buttonStyle, background: ACCENT, color: "white", opacity: buildTaskLoading ? 0.6 : 1 }}>{buildTaskLoading ? "Creating task…" : "Create isolated build task"}</button>{buildTaskError ? <div role="alert" style={{ color: "#b42318", fontSize: 10, marginTop: 5 }}>{buildTaskError}</div> : null}</div> : null}
    {result.buildTaskRailId ? <div role="status" style={{ color: ACCENT, fontSize: 11, marginTop: 8 }}>Build task created · {result.buildTaskRailId}. Open Tasks to review it before starting.</div> : null}
    {result.proposal ? <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 10, paddingTop: 9 }}><div style={{ fontSize: 11, fontWeight: 700 }}>Harness change proposed</div><div style={{ color: SLATE, fontSize: 10, marginTop: 4 }}>{result.proposal.reason}</div><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 10, background: "#f7f7f8", padding: 8, borderRadius: 8 }}>{JSON.stringify(result.proposal.changes, null, 2)}</pre><button onClick={() => onApply(result.proposal!.changes)} style={{ ...buttonStyle, background: ACCENT, color: "white" }}>Apply proposed settings</button><span style={{ color: SLATE, fontSize: 10, marginLeft: 6 }}>You can still review before saving the graph.</span></div> : null}
    {result.trace?.length ? <details style={{ marginTop: 10 }}><summary style={{ cursor: "pointer", fontSize: 10, color: SLATE }}>Show run steps ({result.trace.length})</summary>{result.trace.map((step, i) => <div key={`${step.at}-${i}`} style={{ borderLeft: `2px solid ${step.kind === "error" ? "#b42318" : ACCENT}`, padding: "4px 0 5px 8px", marginTop: 6 }}><div style={{ fontSize: 10, fontWeight: 650 }}>{step.label}</div>{step.detail ? <div style={{ fontSize: 10, whiteSpace: "pre-wrap", color: SLATE, marginTop: 3 }}>{step.detail}</div> : null}</div>)}</details> : null}
  </section>;
}
