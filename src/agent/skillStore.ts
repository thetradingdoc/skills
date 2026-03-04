import * as fs from "fs";
import * as path from "path";

export type SkillStatus = "active" | "deprecated";

export interface SkillMeta {
  id: string;
  description: string;
  path: string;
  usage_count: number;
  success_rate: number;
  language?: string;
  tags?: string[];
  status?: SkillStatus;
}

export interface SkillIndex {
  skills: SkillMeta[];
}

function getAgentDir(rootPath: string): string {
  return path.join(rootPath, ".agent");
}

function getSkillsDir(rootPath: string): string {
  return path.join(getAgentDir(rootPath), "skills");
}

function getIndexPath(rootPath: string): string {
  return path.join(getAgentDir(rootPath), "skill_index.json");
}

function ensureDirs(rootPath: string): void {
  const agentDir = getAgentDir(rootPath);
  const skillsDir = getSkillsDir(rootPath);
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
}

export function loadSkillIndex(rootPath: string): SkillIndex {
  ensureDirs(rootPath);
  const indexPath = getIndexPath(rootPath);
  if (!fs.existsSync(indexPath)) {
    const empty: SkillIndex = { skills: [] };
    fs.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw) as SkillIndex;
    return parsed && Array.isArray(parsed.skills) ? parsed : { skills: [] };
  } catch {
    // Corrupt index: back it up and start fresh
    try {
      const backupPath = indexPath.replace(/\.json$/, `.backup.${Date.now()}.json`);
      fs.copyFileSync(indexPath, backupPath);
    } catch {
      // ignore backup errors
    }
    const empty: SkillIndex = { skills: [] };
    fs.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}

export function saveSkillIndex(rootPath: string, index: SkillIndex): void {
  ensureDirs(rootPath);
  const indexPath = getIndexPath(rootPath);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

export function registerSkill(
  rootPath: string,
  meta: Omit<SkillMeta, "usage_count" | "success_rate" | "status">
): SkillMeta {
  const index = loadSkillIndex(rootPath);
  const existing = index.skills.find((s) => s.id === meta.id);
  const skill: SkillMeta = {
    id: meta.id,
    description: meta.description,
    path: meta.path,
    language: meta.language,
    tags: meta.tags ?? [],
    usage_count: existing?.usage_count ?? 0,
    success_rate: existing?.success_rate ?? 0,
    status: existing?.status ?? "active",
  };

  if (existing) {
    const idx = index.skills.findIndex((s) => s.id === meta.id);
    index.skills[idx] = skill;
  } else {
    index.skills.push(skill);
  }

  saveSkillIndex(rootPath, index);
  return skill;
}

export function incrementUsage(
  rootPath: string,
  id: string,
  success: boolean
): void {
  const index = loadSkillIndex(rootPath);
  const skill = index.skills.find((s) => s.id === id);
  if (!skill) return;
  const totalUses = skill.usage_count + 1;
  const prevSuccesses = Math.round(skill.success_rate * skill.usage_count);
  const newSuccesses = prevSuccesses + (success ? 1 : 0);
  skill.usage_count = totalUses;
  skill.success_rate = totalUses > 0 ? newSuccesses / totalUses : 0;
  saveSkillIndex(rootPath, index);
}

export function deprecateSkill(rootPath: string, id: string): void {
  const index = loadSkillIndex(rootPath);
  const skill = index.skills.find((s) => s.id === id);
  if (!skill) return;
  skill.status = "deprecated";
  saveSkillIndex(rootPath, index);
}

export function listSkills(rootPath: string): SkillMeta[] {
  const index = loadSkillIndex(rootPath);
  return index.skills;
}

export function formatSkillSummary(
  rootPath: string,
  max: number = 20
): string {
  const index = loadSkillIndex(rootPath);
  if (!index.skills.length) return "";
  const lines: string[] = [];
  for (const skill of index.skills.slice(0, max)) {
    const status = skill.status ?? "active";
    const rate = skill.usage_count
      ? `${(skill.success_rate * 100).toFixed(0)}%`
      : "n/a";
    const flagged =
      skill.usage_count >= 5 && skill.success_rate < 0.4 ? " ⚠ LOW APPROVAL — consider refactor" : "";
    const tags = (skill.tags ?? []).join(", ");
    lines.push(
      `- ${skill.id} (${status}, used ${skill.usage_count}×, success ${rate})` +
        (tags ? ` [${tags}]` : "") +
        (skill.description ? ` — ${skill.description}` : "") +
        flagged
    );
  }
  return lines.join("\n");
}

