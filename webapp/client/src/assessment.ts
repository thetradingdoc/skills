/**
 * The assessment.
 *
 * Eight views tell you what is in a repository. None of them say what the
 * system IS, or which finding matters most. This turns a scan into one
 * document a person can read, export, and hand to someone else.
 *
 * A pure function over data the scan already produced — no new endpoints,
 * and no claim that is not derived from a traced result. Where the tracer
 * could not establish something, the assessment says so rather than
 * treating silence as a clean result.
 */

type Cells = Record<string, { state?: string } | undefined>;
type Tool = { name?: string; reach?: { cells?: Cells } };

type Agent = {
  file: string;
  kind?: string;
  provider?: string;
  model?: string | null;
  loopKind?: string | null;
  catalogId?: string;
  tools?: Tool[];
  auth?: { found?: boolean; location?: string | null };
  layers?: Array<{ id: string; status?: string }>;
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

const base = (p: string): string => p.split("/").pop() ?? p;

const plural = (n: number, one: string, many?: string): string =>
  n === 1 ? one : (many ?? one + "s");

export function buildAssessment(
  graph: any,
  evaluations: EvalRow[] = []
): string {
  const inv = graph?.agents;
  const all: Agent[] = inv?.agents ?? [];
  const catalogs: Record<string, Tool[]> = inv?.toolCatalogs ?? {};

  const toolsOf = (a: Agent): Tool[] =>
    Array.isArray(a.tools)
      ? a.tools
      : a.catalogId
        ? (catalogs[a.catalogId] ?? [])
        : [];

  const agents = all.filter((a) => a.kind === "agent");
  const helpers = all.filter((a) => a.kind === "helper").length;
  const unknownKind = all.filter((a) => a.kind === "unknown").length;

  const reaches = (t: Tool, cls: string): boolean =>
    t?.reach?.cells?.[cls]?.state === "reaches";

  // Distinct tools, not per-agent sums. Several surfaces share one catalog,
  // so summing per agent counts the same tool five times over.
  const patient = new Set<string>();
  const money = new Set<string>();
  let untracedCells = 0;
  let totalCells = 0;
  let agentsWithoutAuth = 0;

  for (const a of agents) {
    const key = a.catalogId || a.file;
    let sensitive = false;

    for (const t of toolsOf(a)) {
      const id = key + "::" + (t.name ?? "");
      if (reaches(t, "patient")) {
        patient.add(id);
        sensitive = true;
      }
      if (reaches(t, "money")) {
        money.add(id);
        sensitive = true;
      }
      // Every class the tracer emitted, including unclassified. Naming a
      // fixed subset understated the untraced share.
      for (const st of Object.values(t?.reach?.cells ?? {})) {
        const state = (st as { state?: string } | undefined)?.state;
        if (!state) continue;
        totalCells++;
        if (state === "not-traced") untracedCells++;
      }
    }

    if (sensitive && !a.auth?.found) agentsWithoutAuth++;
  }

  // Surfaces sharing a tool catalog are one logical agent reachable through
  // several entry points. Presenting them as peers overstates how many
  // distinct agents exist.
  const byCatalog = new Map<string, Agent[]>();
  for (const a of agents) {
    const k = a.catalogId || a.file;
    byCatalog.set(k, [...(byCatalog.get(k) ?? []), a]);
  }
  const logical = [...byCatalog.values()];

  const urlMatch = String(graph?.repoUrl ?? "").match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  const repoMatch = String(graph?.projectRoot ?? "").match(/([\w.-]+)$/);
  const rawName = urlMatch?.[2] ?? graph?.projectName;
  const repo =
    rawName && !/^arch-viz-[0-9a-f-]{8,}/i.test(rawName)
      ? rawName
      : repoMatch?.[1] && !/^arch-viz-/i.test(repoMatch[1])
        ? repoMatch[1]
        : "this repository";

  const failing = evaluations.filter(
    (e) => e.status === "FAIL" && !e.baselined
  );
  const unevaluable = evaluations.filter(
    (e) => e.status === "UNEVALUABLE"
  ).length;
  const untracedPct = totalCells
    ? Math.round((untracedCells / totalCells) * 100)
    : 0;

  const L: string[] = [];

  L.push("# Architecture assessment: " + repo);
  L.push("");
  L.push(
    "_Generated from a scan on " +
      new Date().toISOString().slice(0, 10) +
      ". Every claim below traces to code._"
  );
  L.push("");

  // ─────────────────────────────────────────────────────────────────────
  L.push("## What this system is");
  L.push("");

  if (agents.length === 0) {
    L.push(
      "No agent surfaces were found. Nothing in this repository gives a model tools it can call."
    );
    if (helpers > 0) {
      L.push("");
      L.push(
        helpers +
          " model call " +
          plural(helpers, "site") +
          " " +
          (helpers === 1 ? "was" : "were") +
          " found, but " +
          (helpers === 1 ? "it takes" : "they take") +
          " a prompt and return text — no tools, no reach, nothing to guard."
      );
    }
    return L.join("\n");
  }

  const providers = [
    ...new Set(agents.map((a) => a.provider).filter(Boolean)),
  ] as string[];

  L.push(
    repo +
      " runs **" +
      agents.length +
      " agent " +
      plural(agents.length, "surface") +
      "** on " +
      (providers.length > 1
        ? providers.slice(0, -1).join(", ") + " and " + providers[providers.length - 1]
        : providers[0] ?? "an undetermined provider") +
      (logical.length < agents.length
        ? ", though several share a tool catalog and are one logical agent behind multiple entry points"
        : "") +
      "."
  );

  if (helpers > 0 || unknownKind > 0) {
    L.push("");
    const parts: string[] = [];
    if (helpers > 0) {
      parts.push(
        helpers +
          " single-shot " +
          plural(helpers, "helper") +
          " with no tools and no reach"
      );
    }
    if (unknownKind > 0) {
      parts.push(
        unknownKind +
          " " +
          plural(unknownKind, "surface") +
          " that could not be classified"
      );
    }
    L.push("Alongside these: " + parts.join(", ") + ".");
  }

  L.push("");
  for (const group of logical) {
    const a = group[0];
    const n = toolsOf(a).length;
    const entryPoints =
      group.length > 1
        ? " · reachable through " +
          group.length +
          " entry points (" +
          group.map((g) => base(g.file)).join(", ") +
          ")"
        : "";
    L.push(
      "- **" +
        base(a.file) +
        "** — " +
        (a.provider ?? "unknown provider") +
        ", " +
        (a.loopKind ?? "unknown loop") +
        ", " +
        n +
        " " +
        plural(n, "tool") +
        entryPoints
    );
  }
  L.push("");

  // ─────────────────────────────────────────────────────────────────────
  L.push("## What matters");
  L.push("");

  const findings: string[] = [];

  if (agentsWithoutAuth > 0) {
    findings.push(
      "**No authentication before tool execution** on " +
        agentsWithoutAuth +
        " " +
        plural(agentsWithoutAuth, "agent") +
        " that reach sensitive resources. " +
        patient.size +
        " " +
        plural(patient.size, "tool") +
        " reach patient records and " +
        money.size +
        " reach payment rails, with no identity check established anywhere on that path."
    );
  }

  // A layer empty on every agent is a property of the system, not of one
  // component — worth stating once rather than repeating per agent.
  const emptyAcross = new Map<string, number>();
  for (const a of agents) {
    for (const l of a.layers ?? []) {
      if (l.status === "empty") {
        emptyAcross.set(l.id, (emptyAcross.get(l.id) ?? 0) + 1);
      }
    }
  }

  const systemWideEmpty = [...emptyAcross.entries()]
    .filter(([, n]) => n === agents.length && agents.length > 1)
    .map(([layer]) => layer);

  if (systemWideEmpty.length > 0) {
    findings.push(
      "**No " +
        systemWideEmpty.join(", no ") +
        " on any agent.** Every surface scanned came back empty on " +
        (systemWideEmpty.length === 1 ? "this layer" : "these layers") +
        "."
    );
  }

  if (failing.length > 0) {
    const ruleText = failing
      .slice(0, 3)
      .map((e) => e.rule?.raw)
      .filter(Boolean)
      .join("; ");
    findings.push(
      "**" +
        failing.length +
        " " +
        plural(failing.length, "rule") +
        " failing** against the constraints in reach.rules" +
        (ruleText ? " — " + ruleText : "") +
        "."
    );
  }

  if (findings.length === 0) {
    findings.push(
      "Nothing in this scan crosses a threshold worth flagging. That is a statement about what was traced, not a guarantee."
    );
  }

  findings.slice(0, 4).forEach((f, i) => {
    L.push(i + 1 + ". " + f);
    L.push("");
  });

  // ─────────────────────────────────────────────────────────────────────
  L.push("## What is not known");
  L.push("");
  L.push(
    untracedPct +
      "% of the reach matrix could not be traced (" +
      untracedCells +
      " of " +
      totalCells +
      " cells). The figures above are floors, not totals — a tool with no recorded reach may still touch something the tracer could not follow."
  );

  if (unevaluable > 0) {
    L.push("");
    L.push(
      unevaluable +
        " " +
        plural(unevaluable, "rule") +
        " could not be evaluated at all for the same reason. An unevaluable rule is not a passing rule."
    );
  }

  if (inv?.pythonAgents?.length) {
    L.push("");
    L.push(
      "**Not scanned:** " +
        inv.pythonAgents.length +
        " Python " +
        plural(inv.pythonAgents.length, "file") +
        " importing an agent framework — " +
        inv.pythonAgents.join(", ") +
        ". These are outside the graph entirely."
    );
  }

  L.push("");

  // ─────────────────────────────────────────────────────────────────────
  L.push("## What to do");
  L.push("");

  const todo: string[] = [];

  if (agentsWithoutAuth > 0) {
    todo.push(
      "Establish caller identity before any tool that reaches patient records or payment rails executes."
    );
  }
  if (systemWideEmpty.includes("observability")) {
    todo.push(
      "Add tracing on the agent path — model calls and tool calls as first-class events, not HTTP request logs."
    );
  }
  if (systemWideEmpty.includes("evaluation")) {
    todo.push(
      "Build a test set that exercises these agents, so prompt changes stop shipping unmeasured."
    );
  }
  if (systemWideEmpty.includes("safety")) {
    todo.push(
      "Add an output check. Input sanitising stops bad requests; only an output check stops the agent saying something it should not."
    );
  }
  if (untracedPct > 25) {
    todo.push(
      "Resolve the untraced reach before treating any clean row as clean — at " +
        untracedPct +
        "% unknown, absence of evidence is doing too much work."
    );
  }
  if (todo.length === 0) {
    todo.push("Keep reach.rules current as the system changes.");
  }

  todo.forEach((t) => L.push("- " + t));

  L.push("");
  L.push("---");
  L.push("");
  L.push(
    "_" +
      agents.length +
      " agents · " +
      patient.size +
      " tools reaching patient data · " +
      money.size +
      " reaching money · " +
      untracedPct +
      "% untraced_"
  );

  return L.join("\n");
}
