/**
 * Client copy of P7 rollup aggregator (kept in sync with server managementRollup.ts).
 * Enables design-mode rollup without a workspace.
 */
export type RollupNode = {
  id: string;
  label?: string;
  domain?: string | null;
  layer?: string | null;
  path?: string | null;
  files?: string[];
};

export type RollupClaim = {
  kind: "layer" | "node" | "section";
  target_id: string;
  claimer_id: string;
  nickname?: string | null;
  /** DB row id — required for Release from Rollup. */
  id?: string;
};

export type SectionOwner = {
  userId: string;
  nickname: string | null;
  claimId: string | null;
  claimKind: "layer" | "node" | "section";
};

export type RollupFinding = {
  id: string;
  title?: string;
  severity: string;
  state: string;
  agent_file?: string | null;
  first_seen_at?: string | null;
  node_id?: string | null;
};

export type RollupGithubEvent = {
  created_at: string;
  event_type?: string;
  author_login?: string | null;
  github_url?: string | null;
  matched_node_ids?: string[];
  message?: string | null;
};

export type RollupUsage = { node_id: string | null; cost_cents: number };

export type SectionFindings = {
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  pastDue: number;
};

export type SectionRollup = {
  id: string;
  name: string;
  nodeIds: string[];
  owner: SectionOwner | null;
  findings: SectionFindings;
  lastChange: {
    at: string;
    type: string;
    author: string | null;
    url: string | null;
    message: string | null;
  } | null;
  spend: { costCents: number; days: number };
};

export type ManagementRollup = {
  sections: SectionRollup[];
  hotspots: string[];
  unowned: string[];
  pastDueFindings: Array<{
    findingId: string;
    title: string;
    sectionId: string | null;
    ageDays: number;
  }>;
  generatedAt: string;
  /** Workspace github_full_name when known (routes attach). */
  githubFullName?: string | null;
  /** App installation id when Blanko-Lab is bound to this workspace. */
  githubInstallationId?: number | null;
};

const PAST_DUE_DAYS = 14;

function sectionKeyForNode(n: RollupNode): { id: string; name: string } {
  const name = (n.domain || n.layer || "Uncategorized").trim() || "Uncategorized";
  return { id: `section:${name}`, name };
}

export function findingNodeId(f: RollupFinding, nodes: RollupNode[]): string | null {
  if (f.node_id) return f.node_id;
  const file = (f.agent_file || "").replace(/^\.\//, "");
  if (!file) return null;
  for (const n of nodes) {
    if (n.id === file || n.path === file) return n.id;
    if ((n.files ?? []).some((p) => p === file || p.endsWith("/" + file) || file.endsWith(p))) return n.id;
  }
  return null;
}

function ageDays(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

export function buildManagementRollup(input: {
  nodes: RollupNode[];
  claims?: RollupClaim[];
  findings?: RollupFinding[];
  events?: RollupGithubEvent[];
  usage?: RollupUsage[];
  usageDays?: number;
  now?: Date;
  pastDueDays?: number;
}): ManagementRollup {
  const now = input.now ?? new Date();
  const pastDueThreshold = input.pastDueDays ?? PAST_DUE_DAYS;
  const usageDays = input.usageDays ?? 30;
  const nodes = input.nodes ?? [];
  const claims = input.claims ?? [];
  const findings = input.findings ?? [];
  const events = input.events ?? [];
  const usage = input.usage ?? [];

  const sectionsMap = new Map<string, SectionRollup>();
  const nodeToSection = new Map<string, string>();

  for (const n of nodes) {
    const { id, name } = sectionKeyForNode(n);
    let sec = sectionsMap.get(id);
    if (!sec) {
      sec = {
        id,
        name,
        nodeIds: [],
        owner: null,
        findings: { open: 0, critical: 0, high: 0, medium: 0, low: 0, pastDue: 0 },
        lastChange: null,
        spend: { costCents: 0, days: usageDays },
      };
      sectionsMap.set(id, sec);
    }
    sec.nodeIds.push(n.id);
    nodeToSection.set(n.id, id);
  }

  for (const c of claims) {
    if (c.kind === "section" || c.kind === "layer") {
      let sec =
        sectionsMap.get(c.target_id) ??
        sectionsMap.get(`section:${c.target_id}`) ??
        null;
      if (!sec) {
        for (const s of sectionsMap.values()) {
          if (s.name === c.target_id || s.id === c.target_id) {
            sec = s;
            break;
          }
        }
      }
      if (sec && !sec.owner) {
        sec.owner = {
          userId: c.claimer_id,
          nickname: c.nickname ?? null,
          claimId: c.id ?? null,
          claimKind: c.kind,
        };
      }
    }
  }
  for (const c of claims) {
    if (c.kind !== "node") continue;
    const sid = nodeToSection.get(c.target_id);
    if (!sid) continue;
    const sec = sectionsMap.get(sid);
    if (sec && !sec.owner) {
      sec.owner = {
        userId: c.claimer_id,
        nickname: c.nickname ?? null,
        claimId: c.id ?? null,
        claimKind: "node",
      };
    }
  }

  const pastDueFindings: ManagementRollup["pastDueFindings"] = [];
  for (const f of findings) {
    const nid = findingNodeId(f, nodes);
    const sid = nid ? nodeToSection.get(nid) ?? null : null;
    const sec = sid ? sectionsMap.get(sid) : null;
    const isOpen = f.state === "open";
    if (sec && isOpen) {
      sec.findings.open += 1;
      if (f.severity === "critical") sec.findings.critical += 1;
      else if (f.severity === "high") sec.findings.high += 1;
      else if (f.severity === "medium") sec.findings.medium += 1;
      else sec.findings.low += 1;
    }
    const age = ageDays(f.first_seen_at, now);
    if (isOpen && age >= pastDueThreshold) {
      if (sec) sec.findings.pastDue += 1;
      pastDueFindings.push({
        findingId: f.id,
        title: f.title || f.id,
        sectionId: sid,
        ageDays: age,
      });
    }
  }

  for (const e of events) {
    for (const nid of e.matched_node_ids ?? []) {
      const sid = nodeToSection.get(nid);
      if (!sid) continue;
      const sec = sectionsMap.get(sid);
      if (!sec) continue;
      if (!sec.lastChange || e.created_at > sec.lastChange.at) {
        sec.lastChange = {
          at: e.created_at,
          type: e.event_type || "push",
          author: e.author_login ?? null,
          url: e.github_url ?? null,
          message: e.message ?? null,
        };
      }
    }
  }

  for (const u of usage) {
    if (!u.node_id) continue;
    const sid = nodeToSection.get(u.node_id);
    if (!sid) continue;
    const sec = sectionsMap.get(sid);
    if (sec) sec.spend.costCents += u.cost_cents || 0;
  }

  const sections = [...sectionsMap.values()].sort((a, b) => {
    const risk = (s: SectionRollup) => s.findings.critical * 100 + s.findings.high * 10 + s.findings.open;
    const d = risk(b) - risk(a);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });

  return {
    sections,
    hotspots: sections.filter((s) => s.findings.critical > 0 || s.findings.high > 0).map((s) => s.id),
    unowned: sections.filter((s) => !s.owner).map((s) => s.id),
    pastDueFindings: pastDueFindings.sort((a, b) => b.ageDays - a.ageDays),
    generatedAt: now.toISOString(),
  };
}

export function formatRollupCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
