/**
 * One ordered list of findings.
 *
 * Findings currently live in four places: failing rules in Guard, empty
 * layers in Standard, untraced coverage in Reach, unclassified resources in
 * Resources. Each pile is sorted within itself and nothing compares across
 * them, so there is no answer to "what do I fix first".
 *
 * Severity here is a judgement about exposure, not about which pile a
 * finding came from:
 *
 *   critical  a path exists from an unauthenticated entry point to patient
 *             records or payment rails
 *   high      a control the reference model calls essential is absent on
 *             every agent, or a stated rule is failing
 *   medium    the scan could not establish enough to judge
 *   low       housekeeping that does not change what the system can do
 *
 * Everything here derives from the scan. Where a finding rests on something
 * the tracer could not follow, that is stated in the finding rather than
 * silently discounted.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Which view shows the evidence for this. */
  source: "flow" | "standard" | "guard" | "reach" | "resources";
  /** Agent file, where the finding belongs to one. */
  agent?: string;
};

export type EvalRow = {
  status: "PASS" | "FAIL" | "UNEVALUABLE";
  baselined?: boolean;
  rule?: { raw?: string };
  claim?: {
    agent?: string;
    tool?: string;
    resource?: string;
    class?: string;
  };
};

const RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const fileName = (f: string) => f.split(/[/\\]/).pop() || f;

/** Layers the reference model treats as essential once an agent is sensitive. */
const ESSENTIAL_WHEN_SENSITIVE = [
  "safety",
  "observability",
  "evaluation",
  "ingress",
  "data",
];

const LAYER_WHY: Record<string, string> = {
  safety:
    "Nothing inspects what the agent says before a caller sees it. Input sanitising stops bad requests; only an output check stops bad answers.",
  observability:
    "Model and tool calls leave no trace, so there is no way to reconstruct what an agent did on a given request.",
  evaluation:
    "No test set exercises these agents, so a prompt change ships with no measurement of what it changed.",
  ingress:
    "No entry point was mapped, so it is not possible to say who can invoke the agent or how identity arrives.",
  data: "No stores were traced, so the sensitivity map for this agent is empty rather than clear.",
  memory:
    "Nothing persists between turns, which may be deliberate — but it is currently an accident rather than a decision.",
  knowledge: "No retrieval source, so answers come from the prompt alone.",
  context: "Prompt assembly could not be traced to a versioned source.",
  deployment: "Runtime and secrets handling could not be established.",
  reasoning: "No model client or control loop was found on this agent.",
  tools: "No callable surface was found, so this may not be an agent at all.",
};

export function rankFindings(
  graph: any,
  evaluations: EvalRow[] = []
): Finding[] {
  const inv = graph?.agents;
  const all: any[] = inv?.agents ?? [];
  const catalogs: Record<string, any[]> = inv?.toolCatalogs ?? {};
  const agents = all.filter((a) => a.kind === "agent");

  const toolsOf = (a: any): any[] =>
    Array.isArray(a.tools) && a.tools.length
      ? a.tools
      : a.catalogId
        ? (catalogs[a.catalogId] ?? [])
        : [];

  const out: Finding[] = [];
  const openPaths: any[] = [];

  // ── critical: an open path to something sensitive ─────────────────────
  for (const a of agents) {
    const tools = toolsOf(a);
    const patient = tools.filter(
      (t) => t?.reach?.cells?.patient?.state === "reaches"
    ).length;
    const money = tools.filter(
      (t) => t?.reach?.cells?.money?.state === "reaches"
    ).length;
    if ((patient > 0 || money > 0) && !a.auth?.found) {
      const parts: string[] = [];
      if (patient) parts.push(patient + " reaching patient records");
      if (money) parts.push(money + " reaching payment rails");
      openPaths.push({ file: a.file, catalog: a.catalogId || a.file, tools: tools.length, parts });
    }
  }

  // ── high: essential controls missing everywhere ───────────────────────
  const byCatalog = new Map<string, any[]>();
  for (const p of openPaths) {
    byCatalog.set(p.catalog, [...(byCatalog.get(p.catalog) ?? []), p]);
  }
  for (const g of byCatalog.values()) {
    const lead = g[0];
    const doors = g.length > 1
      ? " Reachable through " + g.length + " entry points: " + g.map((x: any) => fileName(x.file)).join(", ") + "."
      : "";
    out.push({
      // Keyed on the lead file, not the catalog hash: the hash changes when
      // any tool is added, which would orphan every decision attached to this
      // finding. A file path survives that. It does not survive a rename —
      // that is the identity problem this inherits knowingly.
      id: "auth:" + lead.file,
      severity: "critical",
      title: "No authentication before tool execution" + (g.length > 1 ? " (" + g.length + " entry points)" : ""),
      detail: fileName(lead.file) + " runs " + lead.tools + " tools, " + lead.parts.join(" and ") + ", with no identity check on the path into tool execution." + doors,
      source: "flow",
      agent: lead.file,
    });
  }
  const emptyAcross = new Map<string, number>();
  for (const a of agents) {
    for (const l of a.layers ?? []) {
      if (l.status === "empty") {
        emptyAcross.set(l.id, (emptyAcross.get(l.id) ?? 0) + 1);
      }
    }
  }
  for (const [layer, count] of emptyAcross.entries()) {
    if (!ESSENTIAL_WHEN_SENSITIVE.includes(layer)) continue;
    if (agents.length === 0) continue;
    const everywhere = count === agents.length;
    out.push({
      id: "layer:" + layer,
      severity: everywhere ? "high" : "medium",
      title:
        "No " +
        layer +
        (everywhere
          ? " on any agent"
          : " on " + count + " of " + agents.length + " agents"),
      detail: LAYER_WHY[layer] ?? "This layer came back empty.",
      source: "standard",
    });
  }

  // ── high: stated rules failing ────────────────────────────────────────
  const failing = evaluations.filter(
    (e) => e.status === "FAIL" && !e.baselined
  );
  for (const e of failing) {
    out.push({
      id: "rule:" + (e.rule?.raw ?? Math.random()),
      severity: "high",
      title: "Rule failing: " + (e.rule?.raw ?? "unnamed rule"),
      detail: e.claim
        ? "Claimed by " +
          (e.claim.tool ?? "a tool") +
          " reaching " +
          (e.claim.resource ?? e.claim.class ?? "a resource") +
          "."
        : "A constraint written in reach.rules is not holding.",
      source: "guard",
      agent: e.claim?.agent,
    });
  }

  // ── medium: the scan could not establish enough ───────────────────────
  let untraced = 0;
  let cells = 0;
  for (const a of agents) {
    for (const t of toolsOf(a)) {
      for (const c of Object.values(t?.reach?.cells ?? {}) as any[]) {
        if (!c?.state) continue;
        cells++;
        if (c.state === "not-traced") untraced++;
      }
    }
  }
  const pct = cells ? Math.round((untraced / cells) * 100) : 0;
  if (pct > 20) {
    out.push({
      id: "untraced",
      severity: pct > 40 ? "medium" : "low",
      title: pct + "% of reach could not be traced",
      detail:
        untraced +
        " of " +
        cells +
        " cells are unresolved, so every finding above is a floor rather than a total. A clean row may be clean, or may be a path the tracer could not follow.",
      source: "reach",
    });
  }

  const unevaluable = evaluations.filter(
    (e) => e.status === "UNEVALUABLE"
  ).length;
  if (unevaluable > 0) {
    out.push({
      id: "unevaluable",
      severity: "medium",
      title:
        unevaluable +
        " rule" +
        (unevaluable === 1 ? "" : "s") +
        " could not be evaluated",
      detail:
        "The scope these rules cover is too untraced to judge. An unevaluable rule is not a passing rule.",
      source: "guard",
    });
  }

  if (inv?.pythonAgents?.length) {
    out.push({
      id: "python",
      severity: "medium",
      title:
        inv.pythonAgents.length +
        " agent file" +
        (inv.pythonAgents.length === 1 ? "" : "s") +
        " not scanned",
      detail:
        inv.pythonAgents.join(", ") +
        " import an agent framework but sit outside the graph, so nothing above accounts for them.",
      source: "reach",
    });
  }

  // ── low: housekeeping ─────────────────────────────────────────────────
  const unclassified = new Set<string>();
  for (const a of agents) {
    for (const t of toolsOf(a)) {
      for (const r of (t?.reach?.resources ?? []) as any[]) {
        if (r?.class === "unclassified" && r?.name) {
          unclassified.add(r.kind + ":" + r.name);
        }
      }
    }
  }
  if (unclassified.size > 0) {
    out.push({
      id: "unclassified",
      severity: "low",
      title: unclassified.size + " resources still unclassified",
      detail:
        "Until these are decided, reach involving them cannot be judged sensitive or safe — they are counted as neither.",
      source: "resources",
    });
  }

  const unknownKind = all.filter((a) => a.kind === "unknown").length;
  if (unknownKind > 0) {
    out.push({
      id: "unknown-kind",
      severity: "low",
      title:
        unknownKind +
        " surface" +
        (unknownKind === 1 ? "" : "s") +
        " could not be classified",
      detail:
        "These call a model but the scan could not tell whether they hold tools. They are excluded from every count above.",
      source: "reach",
    });
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

export function severityColor(s: Severity): string {
  return s === "critical"
    ? "#f85149"
    : s === "high"
      ? "#d29922"
      : s === "medium"
        ? "#58a6ff"
        : "#6e7681";
}
