import * as fs from "fs";
import * as path from "path";
import type { RailId, RailTelemetry, TaskId } from "../types";

const telemetryByRail: Map<RailId, RailTelemetry> = new Map();

function ensure(railId: RailId): RailTelemetry {
  let t = telemetryByRail.get(railId);
  if (!t) {
    t = {
      railId,
      critiqueLoopCount: 0,
      tokenUsage: 0,
      llmCallCount: 0,
      playwrightPasses: 0,
      playwrightFailures: 0,
      pathSuccessRate: 0,
      taskLatencies: {},
    };
    telemetryByRail.set(railId, t);
  }
  return t;
}

export function recordCritiqueLoop(railId: RailId): void {
  const t = ensure(railId);
  t.critiqueLoopCount += 1;
}

export function recordTokens(railId: RailId, tokens: number): void {
  const t = ensure(railId);
  t.tokenUsage += Math.max(0, tokens);
}

export function recordLlmCall(railId: RailId): void {
  const t = ensure(railId);
  t.llmCallCount += 1;
}

export function recordPlaywrightResult(railId: RailId, passed: boolean): void {
  const t = ensure(railId);
  if (passed) t.playwrightPasses += 1;
  else t.playwrightFailures += 1;
}

export function recordTaskLatency(railId: RailId, taskId: TaskId, ms: number): void {
  const t = ensure(railId);
  t.taskLatencies[taskId] = ms;
}

export function getRailTelemetry(railId: RailId): RailTelemetry {
  return ensure(railId);
}

export function getAllRailTelemetry(): RailTelemetry[] {
  return Array.from(telemetryByRail.values());
}

// ─── Skill performance (institutional memory) ────────────────────────────────

interface SkillStats {
  usageCount: number;
  approvalCount: number;
  lastUsedAt: number;
}

const skillStats: Map<string, SkillStats> = new Map();

function skillStatsPath(rootPath: string): string {
  return path.join(rootPath, ".agent", "skill_performance.json");
}

export function recordSkillUsage(skillId: string, approved: boolean): void {
  let s = skillStats.get(skillId);
  if (!s) {
    s = { usageCount: 0, approvalCount: 0, lastUsedAt: 0 };
    skillStats.set(skillId, s);
  }
  s.usageCount += 1;
  if (approved) s.approvalCount += 1;
  s.lastUsedAt = Date.now();
}

export function saveSkillPerformance(rootPath: string): void {
  const entries: Record<string, SkillStats> = {};
  for (const [id, stats] of skillStats.entries()) {
    entries[id] = stats;
  }
  const p = skillStatsPath(rootPath);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function loadSkillPerformance(rootPath: string): void {
  const p = skillStatsPath(rootPath);
  if (!fs.existsSync(p)) return;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Record<string, SkillStats>;
    skillStats.clear();
    for (const [id, stats] of Object.entries(parsed)) {
      skillStats.set(id, stats);
    }
  } catch {
    skillStats.clear();
  }
}

export function getSkillStats(skillId: string): SkillStats | undefined {
  return skillStats.get(skillId);
}

