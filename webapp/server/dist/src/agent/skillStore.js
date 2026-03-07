"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSkillIndex = loadSkillIndex;
exports.saveSkillIndex = saveSkillIndex;
exports.registerSkill = registerSkill;
exports.incrementUsage = incrementUsage;
exports.deprecateSkill = deprecateSkill;
exports.listSkills = listSkills;
exports.formatSkillSummary = formatSkillSummary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getAgentDir(rootPath) {
    return path.join(rootPath, ".agent");
}
function getSkillsDir(rootPath) {
    return path.join(getAgentDir(rootPath), "skills");
}
function getIndexPath(rootPath) {
    return path.join(getAgentDir(rootPath), "skill_index.json");
}
function ensureDirs(rootPath) {
    const agentDir = getAgentDir(rootPath);
    const skillsDir = getSkillsDir(rootPath);
    if (!fs.existsSync(agentDir)) {
        fs.mkdirSync(agentDir, { recursive: true });
    }
    if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
    }
}
function loadSkillIndex(rootPath) {
    ensureDirs(rootPath);
    const indexPath = getIndexPath(rootPath);
    if (!fs.existsSync(indexPath)) {
        const empty = { skills: [] };
        fs.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
        return empty;
    }
    try {
        const raw = fs.readFileSync(indexPath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && Array.isArray(parsed.skills) ? parsed : { skills: [] };
    }
    catch {
        // Corrupt index: back it up and start fresh
        try {
            const backupPath = indexPath.replace(/\.json$/, `.backup.${Date.now()}.json`);
            fs.copyFileSync(indexPath, backupPath);
        }
        catch {
            // ignore backup errors
        }
        const empty = { skills: [] };
        fs.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
        return empty;
    }
}
function saveSkillIndex(rootPath, index) {
    ensureDirs(rootPath);
    const indexPath = getIndexPath(rootPath);
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}
function registerSkill(rootPath, meta) {
    const index = loadSkillIndex(rootPath);
    const existing = index.skills.find((s) => s.id === meta.id);
    const skill = {
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
    }
    else {
        index.skills.push(skill);
    }
    saveSkillIndex(rootPath, index);
    return skill;
}
function incrementUsage(rootPath, id, success) {
    const index = loadSkillIndex(rootPath);
    const skill = index.skills.find((s) => s.id === id);
    if (!skill)
        return;
    const totalUses = skill.usage_count + 1;
    const prevSuccesses = Math.round(skill.success_rate * skill.usage_count);
    const newSuccesses = prevSuccesses + (success ? 1 : 0);
    skill.usage_count = totalUses;
    skill.success_rate = totalUses > 0 ? newSuccesses / totalUses : 0;
    saveSkillIndex(rootPath, index);
}
function deprecateSkill(rootPath, id) {
    const index = loadSkillIndex(rootPath);
    const skill = index.skills.find((s) => s.id === id);
    if (!skill)
        return;
    skill.status = "deprecated";
    saveSkillIndex(rootPath, index);
}
function listSkills(rootPath) {
    const index = loadSkillIndex(rootPath);
    return index.skills;
}
function formatSkillSummary(rootPath, max = 20) {
    const index = loadSkillIndex(rootPath);
    if (!index.skills.length)
        return "";
    const lines = [];
    for (const skill of index.skills.slice(0, max)) {
        const status = skill.status ?? "active";
        const rate = skill.usage_count
            ? `${(skill.success_rate * 100).toFixed(0)}%`
            : "n/a";
        const flagged = skill.usage_count >= 5 && skill.success_rate < 0.4 ? " ⚠ LOW APPROVAL — consider refactor" : "";
        const tags = (skill.tags ?? []).join(", ");
        lines.push(`- ${skill.id} (${status}, used ${skill.usage_count}×, success ${rate})` +
            (tags ? ` [${tags}]` : "") +
            (skill.description ? ` — ${skill.description}` : "") +
            flagged);
    }
    return lines.join("\n");
}
