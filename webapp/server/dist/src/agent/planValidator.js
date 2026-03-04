"use strict";
/**
 * Plan validation — AGENT_ROADMAP v4 §2
 * JSON parse, schema validation, cycle detection, file conflict check, layer rules, module existence.
 */
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
exports.validatePlan = validatePlan;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const llmJson_1 = require("./llmJson");
const VALID_LAYERS = [
    "Presentation",
    "Business Logic",
    "Data Access",
    "Infrastructure",
    "External Services",
    "Utilities",
    "Configuration",
    "Uncategorized",
];
const VALID_ACTIONS = ["create", "modify", "refactor"];
function readArchRulesV2(projectRoot) {
    const p = path.join(projectRoot, ".arch-rules.json");
    if (!fs.existsSync(p))
        return null;
    try {
        const raw = fs.readFileSync(p, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function isValidProposedFile(obj) {
    if (!obj || typeof obj !== "object")
        return false;
    const o = obj;
    return (typeof o.name === "string" &&
        typeof o.purpose === "string" &&
        Array.isArray(o.todos) &&
        o.todos.every((t) => typeof t === "string"));
}
function isValidAgentPlan(obj) {
    if (!obj || typeof obj !== "object")
        return false;
    const o = obj;
    if (typeof o.goal !== "string")
        return false;
    if (!Array.isArray(o.tasks))
        return false;
    for (const t of o.tasks) {
        if (!t || typeof t !== "object")
            return false;
        const task = t;
        if (typeof task.id !== "string")
            return false;
        if (typeof task.module !== "string")
            return false;
        if (!VALID_LAYERS.includes(task.layer))
            return false;
        if (!VALID_ACTIONS.includes(task.action))
            return false;
        if (typeof task.expectedOutput !== "string")
            return false;
        if (task.proposedFiles !== undefined) {
            if (!Array.isArray(task.proposedFiles))
                return false;
            for (const f of task.proposedFiles) {
                if (typeof f !== "string" && !isValidProposedFile(f))
                    return false;
            }
        }
    }
    if (!Array.isArray(o.dependencies))
        return false;
    for (const d of o.dependencies) {
        if (!Array.isArray(d) || d.length !== 2)
            return false;
        if (typeof d[0] !== "string" || typeof d[1] !== "string")
            return false;
    }
    return true;
}
function detectCycle(plan) {
    const edges = new Map();
    const ids = new Set(plan.tasks.map((t) => t.id));
    for (const [a, b] of plan.dependencies) {
        if (!ids.has(a) || !ids.has(b))
            continue;
        if (!edges.has(a))
            edges.set(a, []);
        edges.get(a).push(b);
    }
    const visited = new Set();
    const recursion = new Set();
    const path = [];
    const cycle = [];
    function dfs(u) {
        visited.add(u);
        recursion.add(u);
        path.push(u);
        for (const v of edges.get(u) ?? []) {
            if (!visited.has(v)) {
                if (dfs(v))
                    return true;
            }
            else if (recursion.has(v)) {
                const idx = path.indexOf(v);
                for (let i = idx; i < path.length; i++)
                    cycle.push(path[i]);
                cycle.push(v);
                return true;
            }
        }
        path.pop();
        recursion.delete(u);
        return false;
    }
    for (const id of ids) {
        if (!visited.has(id) && dfs(id))
            return cycle;
    }
    return null;
}
function topoSortTasks(plan) {
    const idToTask = new Map(plan.tasks.map((t) => [t.id, t]));
    const deps = new Map();
    for (const t of plan.tasks)
        deps.set(t.id, new Set());
    for (const [blocker, blocked] of plan.dependencies) {
        if (idToTask.has(blocker) && idToTask.has(blocked)) {
            deps.get(blocked).add(blocker);
        }
    }
    const sorted = [];
    const visited = new Set();
    function visit(id) {
        if (visited.has(id))
            return;
        visited.add(id);
        for (const dep of deps.get(id) ?? [])
            visit(dep);
        sorted.push(id);
    }
    for (const t of plan.tasks)
        visit(t.id);
    return {
        ...plan,
        tasks: sorted.map((id) => idToTask.get(id)),
    };
}
function expandModuleToFilePaths(projectRoot, modulePath) {
    const fullPath = path.isAbsolute(modulePath)
        ? modulePath
        : path.join(projectRoot, modulePath);
    if (!fs.existsSync(fullPath))
        return [modulePath];
    const stat = fs.statSync(fullPath);
    if (stat.isFile())
        return [modulePath];
    const allowed = /\.(ts|tsx|js|jsx|md)$/i;
    const files = [];
    function walk(dir, prefix) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const rel = path.join(prefix, e.name);
            if (e.isDirectory()) {
                if (e.name !== "node_modules" && !e.name.startsWith("."))
                    walk(path.join(dir, e.name), rel);
            }
            else if (allowed.test(e.name)) {
                files.push(path.join(modulePath, rel).replace(/\\/g, "/"));
            }
        }
    }
    walk(fullPath, "");
    return files.length > 0 ? files : [modulePath];
}
function checkFileConflicts(plan, projectRoot) {
    const moduleToFiles = new Map();
    for (const t of plan.tasks) {
        moduleToFiles.set(t.id, expandModuleToFilePaths(projectRoot, t.module));
    }
    const fileToTasks = new Map();
    for (const [taskId, files] of moduleToFiles) {
        for (const f of files) {
            const norm = path.normalize(f).replace(/\\/g, "/");
            if (!fileToTasks.has(norm))
                fileToTasks.set(norm, []);
            fileToTasks.get(norm).push(taskId);
        }
    }
    for (const [file, tasks] of fileToTasks) {
        if (tasks.length > 1) {
            return { taskA: tasks[0], taskB: tasks[1], path: file };
        }
    }
    return null;
}
function checkModuleExists(plan, projectRoot) {
    for (const task of plan.tasks) {
        if (task.action === "create")
            continue; // New module may not exist yet
        const fullPath = path.isAbsolute(task.module)
            ? task.module
            : path.join(projectRoot, task.module);
        if (!fs.existsSync(fullPath)) {
            return { taskId: task.id, module: task.module };
        }
    }
    return null;
}
function checkLayerRules(plan, projectRoot) {
    const rules = readArchRulesV2(projectRoot);
    const directions = rules?.layerDirections;
    if (!directions || directions.length === 0)
        return null;
    for (const task of plan.tasks) {
        const layer = task.layer;
        for (const d of directions) {
            if (d.from === layer && d.allowed === false) {
                return {
                    taskId: task.id,
                    module: task.module,
                    layer,
                    reason: `Layer "${layer}" cannot be used (rule: ${d.from} → ${d.to} disallowed)`,
                };
            }
        }
    }
    return null;
}
/**
 * Validate a plan. On failure, returns error message for model feedback.
 * Layer violation returns layerViolation for routing to Arch Planner.
 */
function validatePlan(raw, projectRoot) {
    const parsed = (0, llmJson_1.parseJsonFromLLM)(raw);
    if (!parsed) {
        return { valid: false, error: "Invalid JSON or no JSON object found in plan output" };
    }
    if (!isValidAgentPlan(parsed)) {
        return {
            valid: false,
            error: "Schema validation failed: required fields (goal, tasks, dependencies) or task fields (id, module, layer, action, expectedOutput) missing or invalid.",
        };
    }
    const plan = parsed;
    const cycle = detectCycle(plan);
    if (cycle) {
        return {
            valid: false,
            error: `Circular dependency detected between tasks: ${cycle.join(" → ")}`,
        };
    }
    const conflict = checkFileConflicts(plan, projectRoot);
    if (conflict) {
        return {
            valid: false,
            error: `Tasks ${conflict.taskA} and ${conflict.taskB} both touch path ${conflict.path}. Split or merge tasks.`,
        };
    }
    const missingModule = checkModuleExists(plan, projectRoot);
    if (missingModule) {
        return {
            valid: false,
            error: `Module does not exist: ${missingModule.module} (task ${missingModule.taskId})`,
        };
    }
    const layerViolation = checkLayerRules(plan, projectRoot);
    if (layerViolation) {
        return {
            valid: false,
            plan,
            layerViolation,
            error: layerViolation.reason,
        };
    }
    return { valid: true, plan: topoSortTasks(plan) };
}
