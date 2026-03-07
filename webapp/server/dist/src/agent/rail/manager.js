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
exports.loadRails = loadRails;
exports.saveRails = saveRails;
exports.createRail = createRail;
exports.resumeRail = resumeRail;
exports.getRail = getRail;
exports.updateRailState = updateRailState;
exports.enterExecutingState = enterExecutingState;
exports.updateRailVersion = updateRailVersion;
exports.createTask = createTask;
exports.getTask = getTask;
exports.updateTaskEvidence = updateTaskEvidence;
exports.updateTaskStatus = updateTaskStatus;
exports.getTasksByRail = getTasksByRail;
exports.getAllRails = getAllRails;
exports.getAllTasks = getAllTasks;
exports.getRailsByJiraKey = getRailsByJiraKey;
exports.archiveRail = archiveRail;
exports.suspendRail = suspendRail;
exports.failRail = failRail;
exports.deleteRail = deleteRail;
exports.loadTemplateForArchetype = loadTemplateForArchetype;
exports.listTemplateArchetypes = listTemplateArchetypes;
exports.loadAntiPatterns = loadAntiPatterns;
exports.getAntiPatternWarnings = getAntiPatternWarnings;
exports.updateRailPartial = updateRailPartial;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("../../jira/client");
const sandbox_1 = require("./sandbox");
const telemetry_1 = require("../rail/telemetry");
const telemetry_2 = require("./telemetry");
const registry_1 = require("./registry");
const traceLogger_1 = require("../traceLogger");
const nodeHistory_1 = require("../nodeHistory");
const inMemoryStore = {
    rails: new Map(),
    tasks: new Map(),
};
const RAILS_DIR = ".agent/rails";
function getRailsDir(rootPath) {
    return path.join(rootPath, RAILS_DIR);
}
function getRailPath(rootPath, railId) {
    return path.join(getRailsDir(rootPath), `${railId}.json`);
}
function atomicWriteJson(filePath, value) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
}
function loadRails(rootPath) {
    // Load rails from disk into memory.
    const railsDir = getRailsDir(rootPath);
    if (!fs.existsSync(railsDir)) {
        // Ensure registry exists even if no rails yet.
        void (0, registry_1.loadRegistry)(rootPath);
        return;
    }
    const files = fs.readdirSync(railsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
        try {
            const raw = fs.readFileSync(path.join(railsDir, f), "utf8");
            const rail = JSON.parse(raw);
            if (rail?.id) {
                inMemoryStore.rails.set(rail.id, rail);
                for (const t of rail.tasks ?? []) {
                    if (t?.id)
                        inMemoryStore.tasks.set(t.id, t);
                }
            }
        }
        catch {
            // ignore corrupt rails for now
        }
    }
    // Rebuild registry from loaded rails to avoid drift.
    let next = {
        version: 1,
        updatedAt: Date.now(),
        index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
        rails: {},
    };
    for (const rail of inMemoryStore.rails.values()) {
        next = (0, registry_1.registerRail)(next, rail);
    }
    (0, registry_1.saveRegistry)(rootPath, next);
}
function saveRails(rootPath) {
    for (const rail of inMemoryStore.rails.values()) {
        atomicWriteJson(getRailPath(rootPath, rail.id), rail);
    }
    let registry = {
        version: 1,
        updatedAt: Date.now(),
        index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
        rails: {},
    };
    for (const rail of inMemoryStore.rails.values()) {
        registry = (0, registry_1.registerRail)(registry, rail);
    }
    (0, registry_1.saveRegistry)(rootPath, registry);
}
function createRail(rootPath, rail) {
    inMemoryStore.rails.set(rail.id, rail);
    atomicWriteJson(getRailPath(rootPath, rail.id), rail);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    const updated = (0, registry_1.registerRail)(registry, rail);
    (0, registry_1.saveRegistry)(rootPath, updated);
    return rail;
}
function resumeRail(_rootPath, rail) {
    // For now, resuming simply means putting the Rail back in memory.
    inMemoryStore.rails.set(rail.id, rail);
    return rail;
}
function getRail(_rootPath, railId) {
    return inMemoryStore.rails.get(railId) ?? null;
}
function updateRailState(rootPath, railId, state) {
    const existing = inMemoryStore.rails.get(railId);
    if (!existing)
        return null;
    const updatedRail = { ...existing, state, updatedAt: Date.now() };
    inMemoryStore.rails.set(railId, updatedRail);
    atomicWriteJson(getRailPath(rootPath, railId), updatedRail);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    const next = (0, registry_1.updateRailInRegistry)(registry, updatedRail);
    (0, registry_1.saveRegistry)(rootPath, next);
    return updatedRail;
}
/**
 * Scope locking helper for first entry into EXECUTING.
 *
 * Captures a frozen snapshot of the outcome, logicPath, and baseline node ids.
 * These are used as the canonical anchor for all subsequent reasoning and
 * drift checks, and must not change after EXECUTING begins.
 */
function enterExecutingState(rootPath, railId) {
    const existing = inMemoryStore.rails.get(railId);
    if (!existing)
        return null;
    const alreadyExecuting = existing.state === "EXECUTING";
    const frozenOutcome = existing.frozenOutcome ?? existing.outcome;
    const frozenLogicPath = existing.frozenLogicPath ?? existing.logicPath;
    const baselineNodeIds = existing.baselineNodeIds ??
        Array.from(new Set((existing.logicPath ?? [])
            .map((step) => step.nodeId)
            .filter((id) => typeof id === "string" && id.length > 0)));
    const nextState = "EXECUTING";
    const updated = {
        ...existing,
        state: alreadyExecuting ? existing.state : nextState,
        frozenOutcome,
        frozenLogicPath,
        baselineNodeIds,
        updatedAt: Date.now(),
    };
    inMemoryStore.rails.set(railId, updated);
    atomicWriteJson(getRailPath(rootPath, railId), updated);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    const next = (0, registry_1.updateRailInRegistry)(registry, updated);
    (0, registry_1.saveRegistry)(rootPath, next);
    return updated;
}
function updateRailVersion(rootPath, railId) {
    const existing = inMemoryStore.rails.get(railId);
    if (!existing)
        return null;
    const updated = { ...existing, version: (existing.version ?? 0) + 1, updatedAt: Date.now() };
    inMemoryStore.rails.set(railId, updated);
    atomicWriteJson(getRailPath(rootPath, railId), updated);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    (0, registry_1.saveRegistry)(rootPath, (0, registry_1.updateRailInRegistry)(registry, updated));
    return updated;
}
function createTask(task) {
    inMemoryStore.tasks.set(task.id, task);
    const rail = inMemoryStore.rails.get(task.railId);
    if (rail) {
        const updatedRail = {
            ...rail,
            tasks: [...(rail.tasks ?? []), task],
            updatedAt: Date.now(),
            version: (rail.version ?? 0) + 1,
        };
        inMemoryStore.rails.set(task.railId, updatedRail);
    }
    return task;
}
function getTask(taskId) {
    return inMemoryStore.tasks.get(taskId) ?? null;
}
function updateTaskEvidence(taskId, evidence) {
    const existing = inMemoryStore.tasks.get(taskId);
    if (!existing)
        return null;
    const updated = { ...existing, evidence };
    inMemoryStore.tasks.set(taskId, updated);
    const rail = inMemoryStore.rails.get(updated.railId);
    if (rail) {
        const tasks = (rail.tasks ?? []).map((t) => (t.id === taskId ? updated : t));
        const updatedRail = { ...rail, tasks, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
        inMemoryStore.rails.set(rail.id, updatedRail);
    }
    return updated;
}
function updateTaskStatus(taskId, status) {
    const existing = inMemoryStore.tasks.get(taskId);
    if (!existing)
        return null;
    const now = Date.now();
    const updated = {
        ...existing,
        status,
        resolvedAt: status === "completed" ? now : existing.resolvedAt,
    };
    inMemoryStore.tasks.set(taskId, updated);
    const rail = inMemoryStore.rails.get(updated.railId);
    if (rail) {
        const tasks = (rail.tasks ?? []).map((t) => (t.id === taskId ? updated : t));
        const updatedRail = { ...rail, tasks, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
        inMemoryStore.rails.set(rail.id, updatedRail);
        if (status === "completed" && typeof updated.createdAt === "number") {
            const latencyMs = now - updated.createdAt;
            (0, telemetry_2.recordTaskLatency)(updated.railId, updated.id, latencyMs);
        }
    }
    return updated;
}
function getTasksByRail(railId) {
    const rail = inMemoryStore.rails.get(railId);
    if (rail?.tasks?.length)
        return rail.tasks;
    return Array.from(inMemoryStore.tasks.values()).filter((t) => t.railId === railId);
}
function getAllRails() {
    return Array.from(inMemoryStore.rails.values());
}
function getAllTasks() {
    return Array.from(inMemoryStore.tasks.values());
}
function getRailsByJiraKey(rootPath, jiraKey) {
    const registry = (0, registry_1.loadRegistry)(rootPath);
    const ids = registry.index.byJira[jiraKey] ?? [];
    return ids.map((id) => inMemoryStore.rails.get(id)).filter(Boolean);
}
function archiveRail(rootPath, railId) {
    const rail = inMemoryStore.rails.get(railId);
    if (!rail)
        return null;
    const allTraces = (0, traceLogger_1.getAgentTraces)();
    const railTraces = allTraces.filter((t) => t.railId === railId);
    const telemetry = (0, telemetry_1.getRailTelemetry)(railId);
    const updated = {
        ...rail,
        state: "ARCHIVED",
        updatedAt: Date.now(),
        version: (rail.version ?? 0) + 1,
        snapshotPath: getRailPath(rootPath, railId),
        traces: railTraces,
        telemetry,
    };
    inMemoryStore.rails.set(railId, updated);
    atomicWriteJson(getRailPath(rootPath, railId), updated);
    (0, sandbox_1.removeSandbox)(rootPath, railId);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    (0, registry_1.saveRegistry)(rootPath, (0, registry_1.updateRailInRegistry)(registry, updated));
    (0, nodeHistory_1.recordRailCompletion)(rootPath, updated, "ARCHIVED");
    // Best-effort: stamp any linked Jira issues with the Rail id (issue keys only; project keys are skipped).
    const issueKeys = (updated.jiraKeys ?? []).filter((k) => /^[A-Z][A-Z0-9]*-[0-9]+$/.test(k));
    if (issueKeys.length > 0) {
        const config = (0, client_1.getJiraConfig)();
        if (config) {
            for (const issueKey of issueKeys) {
                try {
                    void (0, client_1.addLabel)(config, issueKey, `arch-rail-${updated.id}`);
                }
                catch {
                    /* Stamping Jira is best-effort; never block archive. */
                }
            }
        }
    }
    // If this rail has an archetype and verification tasks are all completed, write a template.
    if (updated.archetype) {
        const verifTasks = (updated.tasks ?? []).filter((t) => t.kind === "verification");
        const allVerifCompleted = verifTasks.length === 0 || verifTasks.every((t) => t.status === "completed");
        if (allVerifCompleted) {
            const tmplDir = path.join(rootPath, ".agent", "rails", "templates");
            const tmplPath = path.join(tmplDir, `${updated.archetype}.json`);
            const tmpl = {
                archetype: updated.archetype,
                outcome: updated.outcome,
                logicPath: updated.logicPath,
                tasks: updated.tasks?.map((t) => ({
                    kind: t.kind,
                    description: t.description,
                })),
                telemetry,
            };
            if (!fs.existsSync(tmplDir)) {
                fs.mkdirSync(tmplDir, { recursive: true });
            }
            const tmp = `${tmplPath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(tmpl, null, 2), "utf8");
            fs.renameSync(tmp, tmplPath);
        }
    }
    return updated;
}
function suspendRail(rootPath, railId) {
    return updateRailState(rootPath, railId, "SUSPENDED");
}
function failRail(rootPath, railId, reason) {
    const rail = inMemoryStore.rails.get(railId);
    if (!rail)
        return null;
    const updated = {
        ...rail,
        state: "FAILED",
        updatedAt: Date.now(),
        version: (rail.version ?? 0) + 1,
        tasks: [
            ...(rail.tasks ?? []),
            {
                id: `task_fail_${Date.now()}`,
                railId,
                kind: "meta",
                description: `Rail failed: ${reason}`,
                files: [],
                autoCapable: false,
                status: "awaiting_hitl",
                agent: "reviewer",
                logicStep: 0,
                hitlPrompt: reason,
                createdAt: Date.now(),
            },
        ],
    };
    inMemoryStore.rails.set(railId, updated);
    atomicWriteJson(getRailPath(rootPath, railId), updated);
    (0, sandbox_1.removeSandbox)(rootPath, railId);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    (0, registry_1.saveRegistry)(rootPath, (0, registry_1.updateRailInRegistry)(registry, updated));
    // Persist anti-pattern snapshot for analysis.
    try {
        const antiDir = path.join(rootPath, ".agent", "rails", "anti-patterns");
        if (!fs.existsSync(antiDir)) {
            fs.mkdirSync(antiDir, { recursive: true });
        }
        const ts = Date.now();
        const file = path.join(antiDir, `${ts}-${railId}.json`);
        const anti = {
            railId,
            outcome: updated.outcome,
            archetype: updated.archetype ?? null,
            logicPath: updated.logicPath,
            reason,
            lastCritique: updated.lastCritique ?? null,
            violations: updated.lastCritique?.violations ?? [],
        };
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(anti, null, 2), "utf8");
        fs.renameSync(tmp, file);
    }
    catch {
        // Anti-pattern recording is best-effort; never block failRail.
    }
    (0, nodeHistory_1.recordRailCompletion)(rootPath, updated, "FAILED");
    return updated;
}
function deleteRail(rootPath, railId) {
    inMemoryStore.rails.delete(railId);
    for (const [taskId, task] of inMemoryStore.tasks.entries()) {
        if (task.railId === railId)
            inMemoryStore.tasks.delete(taskId);
    }
    const railPath = getRailPath(rootPath, railId);
    try {
        if (fs.existsSync(railPath))
            fs.unlinkSync(railPath);
    }
    catch {
        /* ignore */
    }
    const registry = (0, registry_1.loadRegistry)(rootPath);
    (0, registry_1.saveRegistry)(rootPath, (0, registry_1.deregisterRail)(registry, railId));
}
function loadTemplateForArchetype(rootPath, archetype) {
    const tmplPath = path.join(rootPath, ".agent", "rails", "templates", `${archetype}.json`);
    try {
        if (!fs.existsSync(tmplPath))
            return null;
        const raw = fs.readFileSync(tmplPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const o = parsed;
        const outcome = typeof o.outcome === "string" ? o.outcome : "";
        const logicPath = Array.isArray(o.logicPath) ? o.logicPath : [];
        const tasks = Array.isArray(o.tasks)
            ? o.tasks.map((t) => ({
                kind: typeof t.kind === "string" ? t.kind : "code_change",
                description: typeof t.description === "string" ? t.description : "",
            }))
            : [];
        return { archetype, outcome, logicPath, tasks };
    }
    catch {
        return null;
    }
}
function listTemplateArchetypes(rootPath) {
    const tmplDir = path.join(rootPath, ".agent", "rails", "templates");
    try {
        if (!fs.existsSync(tmplDir))
            return [];
        return fs.readdirSync(tmplDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    }
    catch {
        return [];
    }
}
function loadAntiPatterns(rootPath, archetype) {
    const antiDir = path.join(rootPath, ".agent", "rails", "anti-patterns");
    try {
        if (!fs.existsSync(antiDir))
            return [];
        const files = fs.readdirSync(antiDir).filter((f) => f.endsWith(".json"));
        const results = [];
        for (const f of files) {
            try {
                const raw = fs.readFileSync(path.join(antiDir, f), "utf8");
                const o = JSON.parse(raw);
                const railId = typeof o.railId === "string" ? o.railId : "";
                const outcome = typeof o.outcome === "string" ? o.outcome : "";
                const a = o.archetype;
                const archetypeVal = a === null || a === undefined ? null : typeof a === "string" ? a : null;
                const logicPath = Array.isArray(o.logicPath) ? o.logicPath : [];
                const reason = typeof o.reason === "string" ? o.reason : "";
                if (archetype != null && archetype !== undefined && archetypeVal !== archetype)
                    continue;
                results.push({ railId, outcome, archetype: archetypeVal, logicPath, reason });
            }
            catch {
                /* skip corrupt files */
            }
        }
        return results;
    }
    catch {
        return [];
    }
}
function getAntiPatternWarnings(rootPath, archetype) {
    const patterns = loadAntiPatterns(rootPath, archetype);
    if (patterns.length === 0)
        return [];
    return patterns.map((p) => `Avoid: ${p.reason} (from outcome: "${p.outcome}")`);
}
// ─── Rail partial update (for template seeding) ────────────────────────────────
function updateRailPartial(rootPath, railId, partial) {
    const existing = inMemoryStore.rails.get(railId);
    if (!existing)
        return null;
    // Once a rail has entered EXECUTING, its high-level scope is locked.
    // Prevent late mutations to outcome/logicPath that would invalidate
    // the frozen anchor and baseline captured on EXECUTING entry.
    const scopeLockedStates = [
        "EXECUTING",
        "AWAITING_HITL",
        "VERIFYING",
        "SELF_CORRECTING",
        "MATERIALIZING",
        "ARCHIVED",
        "SUSPENDED",
        "FAILED",
    ];
    const isScopeLocked = scopeLockedStates.includes(existing.state);
    const safePartial = isScopeLocked
        ? (() => {
            const { logicPath, outcome, ...rest } = partial;
            return rest;
        })()
        : partial;
    const updated = { ...existing, ...safePartial, updatedAt: Date.now() };
    inMemoryStore.rails.set(railId, updated);
    atomicWriteJson(getRailPath(rootPath, railId), updated);
    const registry = (0, registry_1.loadRegistry)(rootPath);
    (0, registry_1.saveRegistry)(rootPath, (0, registry_1.updateRailInRegistry)(registry, updated));
    return updated;
}
