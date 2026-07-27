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
  claim?: CitingClaim;
  unevaluableCount?: number;
};

export type ReachBaseline = {
  version: number;
  description?: string;
  /** Fingerprints of baselined FAIL rules: raw rule text or hash */
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
  confidenceOfReaches: { high: number; medium: number; low: number };
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

function toolHasHighReach(
  tool: AgentTool,
  target: string
): { hit: boolean; claim?: CitingClaim; agentFile?: string } {
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
  // specific resource key like db:patient_document_extracts or patient_document_extracts
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
    if (t.name === "(hosted)") continue;
    if (isSensitivityClass(target)) {
      const cell = cellFor(t, target);
      if (!cell) continue;
      if (cell.state === "not-traced") n++;
      else if (cell.state === "reaches" && cell.confidence === "low") n++;
    } else {
      const needle = target.toLowerCase();
      const hits = (t.reach?.resources ?? []).filter((r) => {
        const key = `${r.kind}:${r.name}`.toLowerCase();
        return key === needle || r.name.toLowerCase() === needle;
      });
      if (hits.some((r) => r.confidence === "low")) n++;
      else if (
        hits.length === 0 &&
        t.reach?.truncated &&
        isSensitivityClass("unclassified")
      ) {
        /* skip */
      }
      if (t.reach?.truncated && hits.length === 0) {
        // truncated walk may have missed the resource
        n++;
      }
    }
  }
  return n;
}

export function parseReachRules(text: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith("#")) continue;

    let m =
      /^agent\s+(\S+)\s+may\s+not\s+reach\s+(\S+)\s*$/i.exec(raw) ||
      null;
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
      if (!isSensitivityClass(a) || !isSensitivityClass(b)) {
        continue;
      }
      rules.push({
        kind: "must-not-co-reach",
        classA: a,
        classB: b,
        raw,
        line: i + 1,
      });
      continue;
    }
  }
  return rules;
}

function agentTools(surface: AgentSurface): AgentTool[] {
  return (surface.tools ?? []).filter((t) => t.name !== "(hosted)");
}

export function evaluateRule(
  rule: ParsedRule,
  inventory: AgentInventory
): RuleEvaluation {
  const agents = (inventory.agents ?? []).filter((a) => a.kind === "agent");

  if (rule.kind === "may-not-reach") {
    const matched = agents.filter((a) => matchAgent(a, rule.agent));
    if (matched.length === 0) {
      return {
        rule,
        status: "UNEVALUABLE",
        reason: `no agent matched '${rule.agent}'`,
        unevaluableCount: 1,
      };
    }
    for (const a of matched) {
      for (const t of agentTools(a)) {
        const { hit, claim } = toolHasHighReach(t, rule.target);
        if (hit && claim) {
          return {
            rule,
            status: "FAIL",
            reason: `high-confidence reach of ${rule.target}`,
            claim: { ...claim, agent: a.file },
          };
        }
      }
    }
    let uneval = 0;
    for (const a of matched) {
      uneval += countUnevaluableForTarget(agentTools(a), rule.target);
    }
    if (uneval > 0) {
      return {
        rule,
        status: "UNEVALUABLE",
        reason: `${uneval} not-traced or low-confidence cell(s) cover '${rule.target}' — cannot clear the rule`,
        unevaluableCount: uneval,
      };
    }
    return {
      rule,
      status: "PASS",
      reason: `no high-confidence reach of ${rule.target}`,
    };
  }

  if (rule.kind === "must-authenticate") {
    const matched = agents.filter((a) => matchAgent(a, rule.agent));
    if (matched.length === 0) {
      return {
        rule,
        status: "UNEVALUABLE",
        reason: `no agent matched '${rule.agent}'`,
        unevaluableCount: 1,
      };
    }
    for (const a of matched) {
      if (a.auth?.found) {
        return {
          rule,
          status: "PASS",
          reason: `auth found at ${a.auth.location}`,
        };
      }
      for (const t of agentTools(a)) {
        const { hit, claim } = toolHasHighReach(t, rule.target);
        if (hit && claim) {
          return {
            rule,
            status: "FAIL",
            reason: `high-confidence ${rule.target} reach with no authentication before tools`,
            claim: { ...claim, agent: a.file },
          };
        }
      }
    }
    let uneval = 0;
    for (const a of matched) {
      uneval += countUnevaluableForTarget(agentTools(a), rule.target);
    }
    if (uneval > 0) {
      return {
        rule,
        status: "UNEVALUABLE",
        reason: `${uneval} not-traced/low-confidence cell(s) for '${rule.target}' — cannot confirm auth is unnecessary`,
        unevaluableCount: uneval,
      };
    }
    return {
      rule,
      status: "PASS",
      reason: `no high-confidence ${rule.target} reach (auth gap not proven against a confident claim)`,
    };
  }

  if (rule.kind === "tools-declared") {
    const matched = agents.filter((a) => matchAgent(a, rule.agent));
    if (matched.length === 0) {
      return {
        rule,
        status: "UNEVALUABLE",
        reason: `no agent matched '${rule.agent}'`,
        unevaluableCount: 1,
      };
    }
    for (const a of matched) {
      for (const t of agentTools(a)) {
        if (!t.handler) {
          return {
            rule,
            status: "FAIL",
            reason: `tool '${t.name}' has no file:line handler in this repository`,
            claim: {
              agent: a.file,
              tool: t.name,
              evidence: t.note ?? "no handler",
            },
          };
        }
      }
    }
    return {
      rule,
      status: "PASS",
      reason: "all tools have resolvable handlers",
    };
  }

  // must-not-co-reach
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
        const r = ca.resources[0];
        return {
          rule,
          status: "FAIL",
          reason: `tool reaches both ${rule.classA} and ${rule.classB} at high confidence`,
          claim: {
            agent: a.file,
            tool: t.name,
            class: rule.classA,
            resource: r ? `${r.kind}:${r.name}` : rule.classA,
            confidence: "high",
            depth: ca.depth,
            path: ca.path,
            evidence: r?.evidence,
          },
        };
      }
    }
  }
  let uneval = 0;
  for (const a of agents) {
    for (const t of agentTools(a)) {
      const ca = cellFor(t, rule.classA);
      const cb = cellFor(t, rule.classB);
      const aWeak =
        ca?.state === "not-traced" ||
        (ca?.state === "reaches" && ca.confidence === "low");
      const bWeak =
        cb?.state === "not-traced" ||
        (cb?.state === "reaches" && cb.confidence === "low");
      const aHigh = ca?.state === "reaches" && ca.confidence === "high";
      const bHigh = cb?.state === "reaches" && cb.confidence === "high";
      // One side high and the other unevaluable → cannot clear co-reach rule
      if ((aHigh && bWeak) || (bHigh && aWeak) || (aWeak && bWeak)) uneval++;
    }
  }
  if (uneval > 0) {
    return {
      rule,
      status: "UNEVALUABLE",
      reason: `${uneval} tool(s) have not-traced/low-confidence coverage on ${rule.classA}/${rule.classB}`,
      unevaluableCount: uneval,
    };
  }
  return {
    rule,
    status: "PASS",
    reason: `no high-confidence co-reach of ${rule.classA} and ${rule.classB}`,
  };
}

export function countReachConfidence(
  inventory: AgentInventory
): { high: number; medium: number; low: number } {
  const out = { high: 0, medium: 0, low: 0 };
  for (const a of inventory.agents ?? []) {
    if (a.kind !== "agent") continue;
    for (const t of agentTools(a)) {
      for (const c of RESOURCE_CLASSES) {
        const cell = cellFor(t, c);
        if (cell?.state !== "reaches") continue;
        const conf = cell.confidence ?? "medium";
        out[conf]++;
      }
    }
  }
  return out;
}

export function loadBaseline(repoRoot: string): ReachBaseline {
  const p = path.join(repoRoot, "reach-baseline.json");
  if (!fs.existsSync(p)) {
    return { version: 1, baselinedFailures: [] };
  }
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
  const p = path.join(repoRoot, "reach-baseline.json");
  fs.writeFileSync(p, JSON.stringify(baseline, null, 2) + "\n", "utf8");
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

  const ciLine = `${failNew} new failures would block, ${failBaselined} baselined, ${unevaluable} unevaluable.`;
  return {
    rulesPath: path.join(repoRoot, "reach.rules"),
    evaluations,
    summary: { pass, fail, failNew, failBaselined, unevaluable },
    confidenceOfReaches,
    ciLine,
    exitCode: failNew > 0 ? 1 : 0,
  };
}

/**
 * Generate starter rules from live findings (auth gap + high-confidence patient/money co-reach).
 */
export function generateStarterRules(inventory: AgentInventory): string {
  const agents = (inventory.agents ?? []).filter((a) => a.kind === "agent");
  const lines: string[] = [
    "# reach.rules — generated from scan findings. Edit freely.",
    "# Rules assert only against high-confidence claims; otherwise UNEVALUABLE.",
    "",
  ];

  // Auth gap: pick an agent with high-confidence patient reach and no auth
  let authAgent: AgentSurface | null = null;
  for (const a of agents) {
    if (a.auth?.found) continue;
    const hasHighPatient = agentTools(a).some((t) => {
      const c = cellFor(t, "patient");
      return c?.state === "reaches" && c.confidence === "high";
    });
    if (hasHighPatient) {
      authAgent = a;
      break;
    }
  }
  if (!authAgent) {
    // fall back to first agent without auth
    authAgent = agents.find((a) => !a.auth?.found) ?? agents[0] ?? null;
  }
  if (authAgent) {
    const name = agentShortName(authAgent.file);
    lines.push(
      `# Auth gap: ${name} has no authentication before tool execution`
    );
    lines.push(`agent ${name} must authenticate before patient`);
    lines.push("");
  }

  // Highest-confidence patient+money co-reach → co-reach rule
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
