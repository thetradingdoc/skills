/**
 * What changed since the last scan.
 *
 * A single scan tells you the state of a system. Two scans tell you the thing
 * a reviewer actually needs: whether it is getting better or worse, and what
 * specifically moved. "kelly gained three tools and two of them reach patient
 * data" is the sentence that makes this worth running twice.
 *
 * Identity is the whole difficulty. Agents are matched on file path, which
 * survives a tool being added but not a file being moved — so a move would
 * otherwise read as one agent deleted and another appearing. Where a path
 * disappears and an unfamiliar path arrives carrying the same tool catalog,
 * that is reported as a probable rename rather than two unrelated events.
 *
 * Everything here is derived. Where the two scans disagree because the tracer
 * resolved more the second time rather than because the code changed, the
 * change is labelled as such rather than presented as a real movement.
 */

export type ChangeKind =
  | "agent-added"
  | "agent-removed"
  | "agent-renamed"
  | "tool-added"
  | "tool-removed"
  | "reach-gained"
  | "reach-lost"
  | "auth-gained"
  | "auth-lost"
  | "layer-filled"
  | "layer-emptied"
  | "coverage-changed";

export type Change = {
  kind: ChangeKind;
  /** Higher matters more. Used for ordering, not for severity display. */
  weight: number;
  agent?: string;
  summary: string;
  detail?: string;
};

export type ScanDiff = {
  hasBaseline: boolean;
  fromDate?: string;
  toDate?: string;
  changes: Change[];
  /** Counts for a one-line summary. */
  totals: {
    agentsBefore: number;
    agentsAfter: number;
    toolsBefore: number;
    toolsAfter: number;
    patientBefore: number;
    patientAfter: number;
    moneyBefore: number;
    moneyAfter: number;
    untracedPctBefore: number;
    untracedPctAfter: number;
  };
};

type Tool = { name?: string; reach?: { cells?: Record<string, { state?: string }> } };
type Agent = {
  file: string;
  kind?: string;
  catalogId?: string;
  tools?: Tool[];
  auth?: { found?: boolean };
  layers?: Array<{ id: string; status?: string }>;
};

const fileName = (f: string): string => f.split(/[/\\]/).pop() || f;

function toolsOf(a: Agent, catalogs: Record<string, Tool[]>): Tool[] {
  if (Array.isArray(a.tools) && a.tools.length) return a.tools;
  return a.catalogId ? (catalogs[a.catalogId] ?? []) : [];
}

function reaches(t: Tool, cls: string): boolean {
  return t?.reach?.cells?.[cls]?.state === "reaches";
}

type Snapshot = {
  agents: Map<string, Agent>;
  catalogs: Record<string, Tool[]>;
  toolNames: Map<string, Set<string>>;
  patientTools: Map<string, Set<string>>;
  moneyTools: Map<string, Set<string>>;
  layerStatus: Map<string, Map<string, string>>;
  untracedPct: number;
  totalTools: number;
  totalPatient: number;
  totalMoney: number;
};

function snapshot(graph: any): Snapshot {
  const inv = graph?.agents;
  const catalogs: Record<string, Tool[]> = inv?.toolCatalogs ?? {};
  const list: Agent[] = (inv?.agents ?? []).filter(
    (a: Agent) => a.kind === "agent"
  );

  const agents = new Map<string, Agent>();
  const toolNames = new Map<string, Set<string>>();
  const patientTools = new Map<string, Set<string>>();
  const moneyTools = new Map<string, Set<string>>();
  const layerStatus = new Map<string, Map<string, string>>();

  let untraced = 0;
  let cells = 0;
  const allPatient = new Set<string>();
  const allMoney = new Set<string>();
  const allTools = new Set<string>();

  for (const a of list) {
    agents.set(a.file, a);
    const names = new Set<string>();
    const pt = new Set<string>();
    const mn = new Set<string>();
    const key = a.catalogId || a.file;

    for (const t of toolsOf(a, catalogs)) {
      const n = t.name ?? "(unnamed)";
      names.add(n);
      allTools.add(key + "::" + n);
      if (reaches(t, "patient")) {
        pt.add(n);
        allPatient.add(key + "::" + n);
      }
      if (reaches(t, "money")) {
        mn.add(n);
        allMoney.add(key + "::" + n);
      }
      for (const c of Object.values(t?.reach?.cells ?? {})) {
        if (!c?.state) continue;
        cells++;
        if (c.state === "not-traced") untraced++;
      }
    }

    toolNames.set(a.file, names);
    patientTools.set(a.file, pt);
    moneyTools.set(a.file, mn);

    const layers = new Map<string, string>();
    for (const l of a.layers ?? []) layers.set(l.id, l.status ?? "unsearched");
    layerStatus.set(a.file, layers);
  }

  return {
    agents,
    catalogs,
    toolNames,
    patientTools,
    moneyTools,
    layerStatus,
    untracedPct: cells ? Math.round((untraced / cells) * 100) : 0,
    totalTools: allTools.size,
    totalPatient: allPatient.size,
    totalMoney: allMoney.size,
  };
}

const setDiff = (a: Set<string>, b: Set<string>): string[] =>
  [...a].filter((x) => !b.has(x));

export function diffScans(
  before: any,
  after: any,
  fromDate?: string,
  toDate?: string
): ScanDiff {
  const A = snapshot(before);
  const B = snapshot(after);
  const changes: Change[] = [];

  const gone = setDiff(new Set(A.agents.keys()), new Set(B.agents.keys()));
  const arrived = setDiff(new Set(B.agents.keys()), new Set(A.agents.keys()));

  // A path that disappeared while an unfamiliar path arrived carrying the same
  // catalog is almost certainly the same agent moved, not two events.
  const renamed = new Map<string, string>();
  for (const g of gone) {
    const oldCatalog = A.agents.get(g)?.catalogId;
    if (!oldCatalog) continue;
    const match = arrived.find((n) => B.agents.get(n)?.catalogId === oldCatalog);
    if (match && !renamed.has(g)) renamed.set(g, match);
  }

  for (const [from, to] of renamed.entries()) {
    changes.push({
      kind: "agent-renamed",
      weight: 20,
      agent: to,
      summary: fileName(from) + " appears to have moved to " + fileName(to),
      detail:
        "Same tool catalog, different path. Matched on the catalog because agent identity is path-derived, so a move would otherwise read as one agent removed and another added.",
    });
  }

  for (const g of gone) {
    if (renamed.has(g)) continue;
    const tools = A.toolNames.get(g)?.size ?? 0;
    changes.push({
      kind: "agent-removed",
      weight: 70,
      agent: g,
      summary: fileName(g) + " is no longer an agent surface",
      detail:
        "It held " +
        tools +
        " tools in the previous scan. It may have been removed, or the scan may no longer recognise it as an agent.",
    });
  }

  for (const n of arrived) {
    if ([...renamed.values()].includes(n)) continue;
    const tools = B.toolNames.get(n)?.size ?? 0;
    const pt = B.patientTools.get(n)?.size ?? 0;
    const mn = B.moneyTools.get(n)?.size ?? 0;
    const risky = pt > 0 || mn > 0;
    changes.push({
      kind: "agent-added",
      weight: risky ? 100 : 60,
      agent: n,
      summary: "New agent surface: " + fileName(n),
      detail:
        tools +
        " tools" +
        (risky
          ? ", of which " +
            pt +
            " reach patient records and " +
            mn +
            " reach payment rails"
          : ", none reaching patient records or payment rails") +
        ".",
    });
  }

  // Agents present in both: what moved inside them.
  for (const [file, agentAfter] of B.agents.entries()) {
    const fileBefore = [...renamed.entries()].find(([, to]) => to === file)?.[0];
    const key = fileBefore ?? file;
    if (!A.agents.has(key)) continue;

    const tBefore = A.toolNames.get(key) ?? new Set();
    const tAfter = B.toolNames.get(file) ?? new Set();
    const added = setDiff(tAfter, tBefore);
    const removed = setDiff(tBefore, tAfter);

    const pBefore = A.patientTools.get(key) ?? new Set();
    const pAfter = B.patientTools.get(file) ?? new Set();
    const mBefore = A.moneyTools.get(key) ?? new Set();
    const mAfter = B.moneyTools.get(file) ?? new Set();

    if (added.length) {
      const sensitive = added.filter((n) => pAfter.has(n) || mAfter.has(n));
      changes.push({
        kind: "tool-added",
        weight: sensitive.length ? 95 : 40,
        agent: file,
        summary:
          fileName(file) +
          " gained " +
          added.length +
          " tool" +
          (added.length === 1 ? "" : "s") +
          (sensitive.length
            ? ", " + sensitive.length + " reaching sensitive resources"
            : ""),
        detail:
          added.join(", ") +
          (sensitive.length ? " — sensitive: " + sensitive.join(", ") : ""),
      });
    }

    if (removed.length) {
      changes.push({
        kind: "tool-removed",
        weight: 30,
        agent: file,
        summary:
          fileName(file) +
          " lost " +
          removed.length +
          " tool" +
          (removed.length === 1 ? "" : "s"),
        detail: removed.join(", "),
      });
    }

    // Reach on tools that existed in both scans: a genuine change in what an
    // existing tool can touch, which is different from a new tool arriving.
    const bothTools = [...tAfter].filter((n) => tBefore.has(n));
    const gainedPatient = bothTools.filter(
      (n) => pAfter.has(n) && !pBefore.has(n)
    );
    const lostPatient = bothTools.filter(
      (n) => pBefore.has(n) && !pAfter.has(n)
    );
    const gainedMoney = bothTools.filter((n) => mAfter.has(n) && !mBefore.has(n));
    const lostMoney = bothTools.filter((n) => mBefore.has(n) && !mAfter.has(n));

    if (gainedPatient.length || gainedMoney.length) {
      const parts: string[] = [];
      if (gainedPatient.length)
        parts.push(gainedPatient.length + " now reach patient records");
      if (gainedMoney.length)
        parts.push(gainedMoney.length + " now reach payment rails");
      changes.push({
        kind: "reach-gained",
        weight: 90,
        agent: file,
        summary:
          "Existing tools on " + fileName(file) + " gained reach: " + parts.join(", "),
        detail:
          [...new Set([...gainedPatient, ...gainedMoney])].join(", ") +
          ". These tools existed in both scans, so either the code changed or the tracer resolved a path it previously could not.",
      });
    }

    if (lostPatient.length || lostMoney.length) {
      changes.push({
        kind: "reach-lost",
        weight: 35,
        agent: file,
        summary:
          "Existing tools on " +
          fileName(file) +
          " no longer show sensitive reach",
        detail:
          [...new Set([...lostPatient, ...lostMoney])].join(", ") +
          ". This may be a real fix, or the tracer may have stopped resolving the path — check before treating it as progress.",
      });
    }

    const authBefore = !!A.agents.get(key)?.auth?.found;
    const authAfter = !!agentAfter.auth?.found;
    if (!authBefore && authAfter) {
      changes.push({
        kind: "auth-gained",
        weight: 85,
        agent: file,
        summary: fileName(file) + " now authenticates before tool execution",
        detail: "No identity check was found on this path in the previous scan.",
      });
    }
    if (authBefore && !authAfter) {
      changes.push({
        kind: "auth-lost",
        weight: 100,
        agent: file,
        summary:
          fileName(file) + " no longer authenticates before tool execution",
        detail:
          "An identity check was found on this path previously and is now absent.",
      });
    }

    const lBefore = A.layerStatus.get(key) ?? new Map();
    const lAfter = B.layerStatus.get(file) ?? new Map();
    for (const [layer, statusAfter] of lAfter.entries()) {
      const statusBefore = lBefore.get(layer);
      if (!statusBefore) continue;
      const wasEmpty = statusBefore === "empty";
      const isEmpty = statusAfter === "empty";
      if (wasEmpty && !isEmpty) {
        changes.push({
          kind: "layer-filled",
          weight: 50,
          agent: file,
          summary: fileName(file) + " now has a " + layer + " layer",
          detail: "Previously empty, now " + statusAfter + ".",
        });
      }
      if (!wasEmpty && isEmpty) {
        changes.push({
          kind: "layer-emptied",
          weight: 75,
          agent: file,
          summary: fileName(file) + " lost its " + layer + " layer",
          detail: "Previously " + statusBefore + ", now empty.",
        });
      }
    }
  }

  // Coverage moving materially changes how much the rest of this can be
  // trusted, so it is reported rather than left implicit.
  if (Math.abs(B.untracedPct - A.untracedPct) >= 5) {
    const better = B.untracedPct < A.untracedPct;
    changes.push({
      kind: "coverage-changed",
      weight: 45,
      summary:
        "Untraced reach " +
        (better ? "fell" : "rose") +
        " from " +
        A.untracedPct +
        "% to " +
        B.untracedPct +
        "%",
      detail: better
        ? "More of the matrix resolved, so some changes above may be the tracer catching up rather than the code moving."
        : "Less of the matrix resolved, so some absences above may be blind spots rather than fixes.",
    });
  }

  changes.sort((a, b) => b.weight - a.weight);

  return {
    hasBaseline: true,
    fromDate,
    toDate,
    changes,
    totals: {
      agentsBefore: A.agents.size,
      agentsAfter: B.agents.size,
      toolsBefore: A.totalTools,
      toolsAfter: B.totalTools,
      patientBefore: A.totalPatient,
      patientAfter: B.totalPatient,
      moneyBefore: A.totalMoney,
      moneyAfter: B.totalMoney,
      untracedPctBefore: A.untracedPct,
      untracedPctAfter: B.untracedPct,
    },
  };
}

/** Rendered when there is only one scan to look at. */
export function noBaseline(): ScanDiff {
  return {
    hasBaseline: false,
    changes: [],
    totals: {
      agentsBefore: 0,
      agentsAfter: 0,
      toolsBefore: 0,
      toolsAfter: 0,
      patientBefore: 0,
      patientAfter: 0,
      moneyBefore: 0,
      moneyAfter: 0,
      untracedPctBefore: 0,
      untracedPctAfter: 0,
    },
  };
}
