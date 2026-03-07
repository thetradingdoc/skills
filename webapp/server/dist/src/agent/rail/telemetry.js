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
exports.recordCritiqueLoop = recordCritiqueLoop;
exports.recordTokens = recordTokens;
exports.recordLlmCall = recordLlmCall;
exports.recordPlaywrightResult = recordPlaywrightResult;
exports.recordTaskLatency = recordTaskLatency;
exports.getRailTelemetry = getRailTelemetry;
exports.getAllRailTelemetry = getAllRailTelemetry;
exports.recordSkillUsage = recordSkillUsage;
exports.saveSkillPerformance = saveSkillPerformance;
exports.loadSkillPerformance = loadSkillPerformance;
exports.getSkillStats = getSkillStats;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const telemetryByRail = new Map();
function ensure(railId) {
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
function recordCritiqueLoop(railId) {
    const t = ensure(railId);
    t.critiqueLoopCount += 1;
}
function recordTokens(railId, tokens) {
    const t = ensure(railId);
    t.tokenUsage += Math.max(0, tokens);
}
function recordLlmCall(railId) {
    const t = ensure(railId);
    t.llmCallCount += 1;
}
function recordPlaywrightResult(railId, passed) {
    const t = ensure(railId);
    if (passed)
        t.playwrightPasses += 1;
    else
        t.playwrightFailures += 1;
}
function recordTaskLatency(railId, taskId, ms) {
    const t = ensure(railId);
    t.taskLatencies[taskId] = ms;
}
function getRailTelemetry(railId) {
    return ensure(railId);
}
function getAllRailTelemetry() {
    return Array.from(telemetryByRail.values());
}
const skillStats = new Map();
function skillStatsPath(rootPath) {
    return path.join(rootPath, ".agent", "skill_performance.json");
}
function recordSkillUsage(skillId, approved) {
    let s = skillStats.get(skillId);
    if (!s) {
        s = { usageCount: 0, approvalCount: 0, lastUsedAt: 0 };
        skillStats.set(skillId, s);
    }
    s.usageCount += 1;
    if (approved)
        s.approvalCount += 1;
    s.lastUsedAt = Date.now();
}
function saveSkillPerformance(rootPath) {
    const entries = {};
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
function loadSkillPerformance(rootPath) {
    const p = skillStatsPath(rootPath);
    if (!fs.existsSync(p))
        return;
    try {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw);
        skillStats.clear();
        for (const [id, stats] of Object.entries(parsed)) {
            skillStats.set(id, stats);
        }
    }
    catch {
        skillStats.clear();
    }
}
function getSkillStats(skillId) {
    return skillStats.get(skillId);
}
