/**
 * What a change touched, in terms of what that code can reach.
 *
 * This is the part of the tool nobody else has. An editor can tell you a file
 * changed. Only this one can say the file you just edited belongs to an agent
 * that reaches patient records with no authentication in front of it.
 *
 * Two kinds of answer, with very different costs:
 *
 *   Context is free. The scan already knows which agent owns a file, what its
 *   tools reach, and which rules name it. Answering "what is this file part of"
 *   needs no rescan and appears immediately.
 *
 *   Impact is expensive. Answering "what did your change add" means scanning
 *   again — fifteen seconds on a real repository — and comparing. That cannot
 *   run after every keystroke, so it belongs behind a deliberate action.
 *
 * This module is the first. It says what is true of the code you touched, and
 * stops short of claiming to know what your change did to it.
 */

type Cells = Record<string, { state?: string } | undefined>;
type Tool = { name?: string; reach?: { cells?: Cells; resources?: Array<{ name?: string; kind?: string; class?: string }> } };

type Agent = {
  file: string;
  kind?: string;
  provider?: string;
  loopKind?: string | null;
  catalogId?: string;
  tools?: Tool[];
  auth?: { found?: boolean; evidence?: string | null };
  layers?: Array<{ id: string; status?: string }>;
};

export type ReachContext = {
  /** The agent that owns the changed file, if the scan knows of one. */
  agentFile?: string;
  /** How the file relates to that agent. */
  relation: "is-agent" | "reaches-from" | "unknown";
  toolCount?: number;
  patientTools?: number;
  moneyTools?: number;
  authFound?: boolean;
  authEvidence?: string | null;
  /** Layers this agent has nothing in. */
  emptyLayers?: string[];
  /** Rules from reach.rules that name this agent. */
  rules?: string[];
  /** One sentence, or null when there is nothing worth saying. */
  summary: string | null;
  /** True when the tracer could not establish enough to be confident. */
  uncertain?: boolean;
};

const fileName = (f: string): string => f.split(/[/\\]/).pop() || f;

function toolsOf(a: Agent, catalogs: Record<string, Tool[]>): Tool[] {
  if (Array.isArray(a.tools) && a.tools.length) return a.tools;
  return a.catalogId ? (catalogs[a.catalogId] ?? []) : [];
}

/**
 * Which agent, if any, a changed file belongs to.
 *
 * Exact match first: the file IS an agent surface. Then containment: the file
 * sits inside a directory an agent occupies, which is weaker but usually right
 * for a service and its helpers.
 *
 * Deliberately conservative. Claiming a file belongs to an agent when it does
 * not would put a warning on an unrelated change, and a warning that fires
 * wrongly is one people learn to dismiss.
 */
function findOwningAgent(agents: Agent[], changedFile: string): { agent: Agent; relation: ReachContext["relation"] } | null {
  const exact = agents.find((a) => a.file === changedFile);
  if (exact) return { agent: exact, relation: "is-agent" };

  // Same directory as an agent surface — a service and the files beside it.
  const dir = changedFile.split("/").slice(0, -1).join("/");
  if (!dir) return null;

  const sameDir = agents.find((a) => a.file.split("/").slice(0, -1).join("/") === dir);
  if (sameDir) return { agent: sameDir, relation: "reaches-from" };

  return null;
}

export function contextForChange(
  graph: any,
  changedFile: string,
  rulesText?: string
): ReachContext {
  const inv = graph?.agents;
  const all: Agent[] = inv?.agents ?? [];
  const catalogs: Record<string, Tool[]> = inv?.toolCatalogs ?? {};
  const agents = all.filter((a) => a.kind === "agent");

  const owner = findOwningAgent(agents, changedFile);
  if (!owner) {
    return { relation: "unknown", summary: null };
  }

  const { agent, relation } = owner;
  const tools = toolsOf(agent, catalogs);

  const patient = tools.filter((t) => t?.reach?.cells?.patient?.state === "reaches").length;
  const money = tools.filter((t) => t?.reach?.cells?.money?.state === "reaches").length;

  let untraced = 0;
  let cells = 0;
  for (const t of tools) {
    for (const c of Object.values(t?.reach?.cells ?? {})) {
      if (!c?.state) continue;
      cells++;
      if (c.state === "not-traced") untraced++;
    }
  }
  const uncertain = cells > 0 && untraced / cells > 0.4;

  const emptyLayers = (agent.layers ?? [])
    .filter((l) => l.status === "empty")
    .map((l) => l.id);

  // Rules that name this agent by its file stem, which is how reach.rules
  // refers to agents.
  const stem = fileName(agent.file).replace(/\.[jt]sx?$/, "");
  const rules = (rulesText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes(stem));

  const authFound = !!agent.auth?.found;

  // The sentence. Written to be worth reading rather than complete: a wall of
  // qualifications gets skipped, and this only earns attention if it is the
  // thing you needed to know.
  let summary: string | null = null;

  if (patient > 0 || money > 0) {
    const reaches: string[] = [];
    if (patient) reaches.push(patient + " reaching patient records");
    if (money) reaches.push(money + " reaching payment rails");

    summary =
      (relation === "is-agent"
        ? "This file is "
        : "This file sits with ") +
      fileName(agent.file) +
      " — " +
      tools.length +
      " tools, " +
      reaches.join(" and ") +
      (authFound
        ? ", behind an identity check."
        : ", with no identity check before tool execution.");

    if (rules.length) {
      summary +=
        " " +
        rules.length +
        (rules.length === 1 ? " rule in reach.rules names it." : " rules in reach.rules name it.");
    }
    if (uncertain) {
      summary += " " + Math.round((untraced / cells) * 100) + "% of its reach could not be traced, so those figures are floors.";
    }
  } else if (emptyLayers.length && relation === "is-agent") {
    summary =
      "This file is " +
      fileName(agent.file) +
      ", which has no " +
      emptyLayers.slice(0, 3).join(", no ") +
      ".";
  }

  return {
    agentFile: agent.file,
    relation,
    toolCount: tools.length,
    patientTools: patient,
    moneyTools: money,
    authFound,
    authEvidence: agent.auth?.evidence ?? null,
    emptyLayers,
    rules,
    summary,
    uncertain,
  };
}

/** Severity for display. Not a judgement about the change — only about what it touched. */
export function contextSeverity(ctx: ReachContext): "critical" | "warn" | "info" | null {
  if (!ctx.summary) return null;
  if ((ctx.patientTools || ctx.moneyTools) && !ctx.authFound) return "critical";
  if (ctx.patientTools || ctx.moneyTools) return "warn";
  return "info";
}
