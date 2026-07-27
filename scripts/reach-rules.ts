/**
 * Reach rules engine — evaluate reach.rules against high-confidence claims only.
 */
import * as fs from "fs";
import * as path from "path";
import type { AgentSurface, AgentTool, AgentInventory } from "./agent-inventory";
import {
  RESOURCE_CLASSES,
  type ClaimConfidence,
  type ClassCell,
  type ResourceClass,
} from "./resource-trace";

export type RuleResultStatus = "PASS" | "FAIL" | "UNEVALUABLE";

export type ParsedRule =
  | {
      kind: "may-not-reach";
      agent: string;
      target: string;
      raw: string;
      line: number;
    }
  | {
      kind: "must-authenticate";
      agent: string;
      target: string;
      raw: string;
      line: number;
    }
  | {
      kind: "tools-declared";
      agent: string;
      raw: string;
      line: number;
    }
  | {
      kind: "must-not-co-reach";
      classA: ResourceClass;
      classB: ResourceClass;
      raw: string;
      line: number;
    };

export type CitingClaim = {
  agent: string;
  tool: string;
  class?: ResourceClass;
  resource?: string;
  confidence?: ClaimConfidence;
  depth?: number | null;
  path?: string[] | null;
  evidence?: string;
};

export type RuleEvaluation = {
  rule: ParsedRule;
  status: RuleResultStatus;
  reason: string;
  /** e.g. "FAIL (71% of scope traced)" */
  display: string;
  coveragePercent: number;
  claim?: CitingClaim;
  unevaluableCount?: number;
};

export type ReachBaseline = {
  version: number;
  description?: string;
  baselinedFailures: string[];
};

export type GuardReport = {
  rulesPath: string;
  evaluations: RuleEvaluation[];
  summary: {
    pass: number;
    fail: number;
    failNew: number;
    failBaselined: number;
    unevaluable: number;
  };
  confidenceOfReaches: { high: number; medium: number };
  ciLine: string;
  exitCode: number;
};

function agentShortName(file: string): string {
  const base = file.split(/[/\\]/).pop() || file;
  return base.replace(/\.(js|ts|mjs|tsx)$/, "");
}

function matchAgent(surface: AgentSurface, name: string): boolean {
  const n = name.toLowerCase();
  const short = agentShortName(surface.file).toLowerCase();
  const file = surface.file.toLowerCase();
  return short === n || file.includes(n) || short.includes(n);
}

function cellFor(tool: AgentTool, cls: ResourceClass): ClassCell | null {
  return tool.reach?.cells?.[cls] ?? null;
}

function isSensitivityClass(s: string): s is ResourceClass {
  return (RESOURCE_CLASSES as string[]).includes(s);
}

function agentTools(surface: AgentSurface): AgentTool[] {
  return (surface.tools ?? []).filter((t) => t.name !== "(hosted)");
}

function toolHasHighReach(
  tool: AgentTool,
  target: string
): { hit: boolean; claim?: CitingClaim } {
  if (isSensitivityClass(target)) {
    const cell = cellFor(tool, target);
    if (cell?.state === "reaches" && cell.confidence === "high") {
      const r =
        cell.resources.find((x) => x.confidence === "high") ?? cell.resources[0];
      return {
        hit: true,
        claim: {
          agent: "",
          tool: tool.name,
          class: target,
          resource: r ? `${r.kind}:${r.name}` : target,
          confidence: "high",
          depth: r?.depth ?? cell.depth,
          path: r?.path ?? cell.path,
          evidence: r?.evidence,
        },
      };
    }
    return { hit: false };
  }
  const needle = target.toLowerCase();
  for (const r of tool.reach?.resources ?? []) {
    if (r.class === "plumbing" || r.kind === "db_call") continue;
    const key = `${r.kind}:${r.name}`.toLowerCase();
    if (
      (key === needle || r.name.toLowerCase() === needle) &&
      r.confidence === "high"
    ) {
      return {
        hit: true,
        claim: {
          agent: "",
          tool: tool.name,
          class: r.class,
          resource: key,
          confidence: "high",
          depth: r.depth,
          path: r.path,
          evidence: r.evidence,
        },
      };
    }
  }
  return { hit: false };
}

function countUnevaluableForTarget(tools: AgentTool[], target: string): number {
  let n = 0;
  for (const t of tools) {
    if (isSensitivityClass(target)) {
      const cell = cellFor(t, target);
      if (cell?.state === "not-traced") n++;
    } else if (t.reach?.truncated) {
      const needle = target.toLowerCase();
      const hits = (t.reach?.resources ?? []).filter((r) => {
        const key = `${r.kind}:${r.name}`.toLowerCase();
        return key === needle || r.name.toLowerCase() === needle;
      });
      if (hits.length === 0) n++;
    }
  }
  return n;
}

function coveragePercent(traced: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((traced / total) * 100);
}

function coverageAgentTarget(
  surfaces: AgentSurface[],
  target: string
): number {
  let traced = 0;
  let total = 0;
  for (const a of surfaces) {
    for (const t of agentTools(a)) {
      if (!isSensitivityClass(target)) {
        total++;
        if (!t.reach?.truncated) traced++;
        continue;
      }
      total++;
      const cell = cellFor(t, target);
      if (cell && cell.state !== "not-traced") traced++;
    }
  }
  return coveragePercent(traced, total);
}

function coverageCoReach(inventory: AgentInventory): number {
  let traced = 0;
  let total = 0;
  for (const a of (inventory.agents ?? []).filter((x) => x.kind === "agent")) {
    for (const t of agentTools(a)) {
      total++;
      const ca = cellFor(t, "patient");
      const cb = cellFor(t, "money");
      if (ca && cb && ca.state !== "not-traced" && cb.state !== "not-traced") {
        traced++;
      }
    }
  }
  return coveragePercent(traced, total);
}

function coverageToolsDeclared(surfaces: AgentSurface[]): number {
  let traced = 0;
  let total = 0;
  for (const a of surfaces) {
    for (const t of agentTools(a)) {
      total++;
      if (t.handler) traced++;
    }
  }
  return coveragePercent(traced, total);
}

function pack(
  rule: ParsedRule,
  status: RuleResultStatus,
  reason: string,
  cov: number,
  extra: { claim?: CitingClaim; unevaluableCount?: number } = {}
): RuleEvaluation {
  return {
    rule,
    status,
    reason,
    display: `${status} (${cov}% of scope traced)`,
    coveragePercent: cov,
    claim: extra.claim,
    unevaluableCount: extra.unevaluableCount,
  };
}

export function parseReachRules(text: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith("#")) continue;

    let m = /^agent\s+(\S+)\s+may\s+not\s+reach\s+(\S+)\s*$/i.exec(raw);
    if (m) {
      rules.push({
        kind: "may-not-reach",
        agent: m[1]!,
        target: m[2]!,
        raw,
        line: i + 1,
      });
      continue;
    }
    m = /^agent\s+(\S+)\s+must\s+authenticate\s+before\s+(\S+)\s*$/i.exec(raw);
    if (m) {
      rules.push({
        kind: "must-authenticate",
        agent: m[1]!,
        target: m[2]!,
        raw,
        line: i + 1,
      });
      continue;
    }
    m = /^agent\s+(\S+)\s+tools\s+must\s+be\s+declared\s+in\s+this\s+repository\s*$/i.exec(
      raw
    );
    if (m) {
      rules.push({
        kind: "tools-declared",
        agent: m[1]!,
        raw,
        line: i + 1,
      });
      continue;
    }
    m =
      /^any\s+agent\s+must\s+not\s+reach\s+(\S+)\s+and\s+(\S+)\s+in\s+one\s+tool\s*$/i.exec(
        raw
      );
    if (m) {
      const a = m[1]!.toLowerCase();
      const b = m[2]!.toLowerCase();
      if (!isSensitivityClass(a) || !isSensitivityClass(b)) continue;
      rules.push({
        kind: "must-not-co-reach",
        classA: a,
        classB: b,
        raw,
        line: i + 1,
      });
    }
  }
  return rules;
}

export function evaluateRule(
  rule: ParsedRule,
  inventory: AgentInventory
): RuleEvaluation {
  const agents = (inventory.agents ?? []).filter((a) => a.kind === "agent");

  if (rule.kind === "may-not-reach") {
    const matched = agents.filter((a) => matchAgent(a, rule.agent));
    const cov = coverageAgentTarget(matched, rule.target);
    if (matched.length === 0) {
      return pack(rule, "UNEVALUABLE", `no agent matched '${rule.agent}'`, 0, {
        unevaluableCount: 1,
      });
    }
    for (const a of matched) {
      for (const t of agentTools(a)) {
        const { hit, claim } = toolHasHighReach(t, rule.target);
        if (hit && claim) {
          return pack(rule, "FAIL", `high-confidence reach of ${rule.target}`, cov, {
            claim: { ...claim, agent: a.file },
          });
        }
      }
    }
    let uneval = 0;
    for (const a of matched) {
      uneval += countUnevaluableForTarget(agentTools(a), rule.target);
    }
    if (uneval > 0) {
      return pack(
        rule,
        "UNEVALUABLE",
        `${uneval} not-traced cell(s) cover '${rule.target}' — cannot clear the rule`,
        cov,
        { unevaluableCount: uneval }
      );
    }
    return pack(rule, "PASS", `no high-confidence reach of ${rule.target}`, cov);
  }

  if (rule.kind === "must-authenticate") {
    const matched = agents.filter((a) => matchAgent(a, rule.agent));
    const cov = coverageAgentTarget(matched, rule.target);
    if (matched.length === 0) {
      return pack(rule, "UNEVALUABLE", `no agent matched '${rule.agent}'`, 0, {
        unevaluableCount: 1,
      });
    }
    for (const a of matched) {
      if (a.auth?.found) {
        return pack(rule, "PASS", `auth found at ${a.auth.location}`, cov);
      }
      for (const t of agentTools(a)) {
        const { hit, claim } = toolHasHighReach(t, rule.target);
        if (hit && claim) {
          return pack(
            rule,
            "FAIL",
            `high-confidence ${rule.target} reach with no authentication before tools`,
            cov,
            { claim: { ...claim, agent: a.file } }
          );
        }
      }
    }
    let uneval = 0;
    for (const a of matched) {
      uneval += countUnevaluableForTarget(agentTools(a), rule.target);
    }
    if (uneval > 0) {
      return pack(
        rule,
        "UNEVALUABLE",
        `${uneval} not-traced cell(s) for '${rule.target}' — cannot confirm auth is unnecessary`,
        cov,
        { unevaluableCount: uneval }
      );
    }
    return pack(
      rule,
      "PASS",
      `no high-confidence ${rule.target} reach (auth gap not proven against a confident claim)`,
      cov
    );
  }

  if (rule.kind === "tools-declared") {
    const matched = agents.filter((a) => matchAgent(a, rule.agent));
    const cov = coverageToolsDeclared(matched);
    if (matched.length === 0) {
      return pack(rule, "UNEVALUABLE", `no agent matched '${rule.agent}'`, 0, {
        unevaluableCount: 1,
      });
    }
    for (const a of matched) {
      for (const t of agentTools(a)) {
        if (!t.handler) {
          return pack(
            rule,
            "FAIL",
            `tool '${t.name}' has no file:line handler in this repository`,
            cov,
            {
              claim: {
                agent: a.file,
                tool: t.name,
                evidence: t.note ?? "no handler",
              },
            }
          );
        }
      }
    }
    return pack(rule, "PASS", "all tools have resolvable handlers", cov);
  }

  // must-not-co-reach
  const cov = coverageCoReach(inventory);
  for (const a of agents) {
    for (const t of agentTools(a)) {
      const ca = cellFor(t, rule.classA);
      const cb = cellFor(t, rule.classB);
      if (
        ca?.state === "reaches" &&
        ca.confidence === "high" &&
        cb?.state === "reaches" &&
        cb.confidence === "high"
      ) {
        const r =
          ca.resources.find((x) => x.confidence === "high") ?? ca.resources[0];
        return pack(
          rule,
          "FAIL",
          `tool reaches both ${rule.classA} and ${rule.classB} at high confidence`,
          cov,
          {
            claim: {
              agent: a.file,
              tool: t.name,
              class: rule.classA,
              resource: r ? `${r.kind}:${r.name}` : rule.classA,
              confidence: "high",
              depth: r?.depth ?? ca.depth,
              path: r?.path ?? ca.path,
              evidence: r?.evidence,
            },
          }
        );
      }
    }
  }
  let uneval = 0;
  for (const a of agents) {
    for (const t of agentTools(a)) {
      const ca = cellFor(t, rule.classA);
      const cb = cellFor(t, rule.classB);
      const aWeak = ca?.state === "not-traced";
      const bWeak = cb?.state === "not-traced";
      const aHigh = ca?.state === "reaches" && ca.confidence === "high";
      const bHigh = cb?.state === "reaches" && cb.confidence === "high";
      if ((aHigh && bWeak) || (bHigh && aWeak) || (aWeak && bWeak)) uneval++;
    }
  }
  if (uneval > 0) {
    return pack(
      rule,
      "UNEVALUABLE",
      `${uneval} tool(s) have not-traced coverage on ${rule.classA}/${rule.classB}`,
      cov,
      { unevaluableCount: uneval }
    );
  }
  return pack(
    rule,
    "PASS",
    `no high-confidence co-reach of ${rule.classA} and ${rule.classB}`,
    cov
  );
}

export function countReachConfidence(inventory: AgentInventory): {
  high: number;
  medium: number;
} {
  const out = { high: 0, medium: 0 };
  for (const a of inventory.agents ?? []) {
    if (a.kind !== "agent") continue;
    for (const t of agentTools(a)) {
      for (const c of RESOURCE_CLASSES) {
        const cell = cellFor(t, c);
        if (cell?.state !== "reaches") continue;
        const conf = cell.confidence === "high" ? "high" : "medium";
        out[conf]++;
      }
    }
  }
  return out;
}

export function loadBaseline(repoRoot: string): ReachBaseline {
  const p = path.join(repoRoot, "reach-baseline.json");
  if (!fs.existsSync(p)) return { version: 1, baselinedFailures: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      version: raw.version ?? 1,
      description: raw.description,
      baselinedFailures: Array.isArray(raw.baselinedFailures)
        ? raw.baselinedFailures
        : [],
    };
  } catch {
    return { version: 1, baselinedFailures: [] };
  }
}

export function writeBaseline(repoRoot: string, baseline: ReachBaseline): void {
  fs.writeFileSync(
    path.join(repoRoot, "reach-baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n",
    "utf8"
  );
}

export function baselineKey(rule: ParsedRule, claim?: CitingClaim): string {
  if (claim) {
    return `${rule.raw}::${claim.agent}::${claim.tool}::${claim.resource ?? claim.class ?? ""}`;
  }
  return rule.raw;
}

export function evaluateReachRules(
  inventory: AgentInventory,
  rulesText: string,
  repoRoot: string
): GuardReport {
  const rules = parseReachRules(rulesText);
  const baseline = loadBaseline(repoRoot);
  const evaluations = rules.map((r) => evaluateRule(r, inventory));
  const confidenceOfReaches = countReachConfidence(inventory);

  let pass = 0;
  let fail = 0;
  let failNew = 0;
  let failBaselined = 0;
  let unevaluable = 0;

  for (const ev of evaluations) {
    if (ev.status === "PASS") pass++;
    else if (ev.status === "UNEVALUABLE") unevaluable++;
    else {
      fail++;
      const key = baselineKey(ev.rule, ev.claim);
      const baselined =
        baseline.baselinedFailures.includes(ev.rule.raw) ||
        baseline.baselinedFailures.includes(key);
      if (baselined) failBaselined++;
      else failNew++;
    }
  }

  return {
    rulesPath: path.join(repoRoot, "reach.rules"),
    evaluations,
    summary: { pass, fail, failNew, failBaselined, unevaluable },
    confidenceOfReaches,
    ciLine: `${failNew} new failures would block, ${failBaselined} baselined, ${unevaluable} unevaluable.`,
    exitCode: failNew > 0 ? 1 : 0,
  };
}

function hasHighSensitiveReach(a: AgentSurface): boolean {
  return agentTools(a).some((t) => {
    for (const cls of ["patient", "money"] as ResourceClass[]) {
      const c = cellFor(t, cls);
      if (c?.state === "reaches" && c.confidence === "high") return true;
    }
    return false;
  });
}

/**
 * Starter rules from live findings:
 * - auth rule for EVERY agent with high-confidence sensitive reach and no auth
 * - co-reach rule when observed
 */
export function generateStarterRules(inventory: AgentInventory): string {
  const agents = (inventory.agents ?? []).filter((a) => a.kind === "agent");
  const lines: string[] = [
    "# reach.rules — generated from scan findings. Edit freely.",
    "# Rules assert only against high-confidence claims; otherwise UNEVALUABLE.",
    "",
  ];

  const authTargets = agents.filter((a) => !a.auth?.found && hasHighSensitiveReach(a));
  if (authTargets.length === 0) {
    lines.push("# No unauthenticated agents with high-confidence patient/money reach");
    lines.push("");
  } else {
    lines.push(
      `# Auth gap: ${authTargets.length} agent(s) reach sensitive data without authentication`
    );
    for (const a of authTargets) {
      const name = agentShortName(a.file);
      // Prefer patient if they reach it at high confidence, else money
      const patientHigh = agentTools(a).some((t) => {
        const c = cellFor(t, "patient");
        return c?.state === "reaches" && c.confidence === "high";
      });
      const target = patientHigh ? "patient" : "money";
      lines.push(`agent ${name} must authenticate before ${target}`);
    }
    lines.push("");
  }

  let coReachTool: { agent: string; tool: string } | null = null;
  for (const a of agents) {
    for (const t of agentTools(a)) {
      const ca = cellFor(t, "patient");
      const cb = cellFor(t, "money");
      if (
        ca?.state === "reaches" &&
        ca.confidence === "high" &&
        cb?.state === "reaches" &&
        cb.confidence === "high"
      ) {
        coReachTool = { agent: agentShortName(a.file), tool: t.name };
        break;
      }
    }
    if (coReachTool) break;
  }
  if (coReachTool) {
    lines.push(
      `# Observed high-confidence patient+money co-reach: ${coReachTool.agent} / ${coReachTool.tool}`
    );
  } else {
    lines.push(
      "# No high-confidence patient+money co-reach observed yet — rule still declared"
    );
  }
  lines.push("any agent must not reach patient and money in one tool");
  lines.push("");

  return lines.join("\n");
}

export function readReachRules(repoRoot: string): string {
  const p = path.join(repoRoot, "reach.rules");
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

export function writeReachRules(repoRoot: string, text: string): void {
  fs.writeFileSync(path.join(repoRoot, "reach.rules"), text, "utf8");
}
