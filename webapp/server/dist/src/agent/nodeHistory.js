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
exports.loadNodeHistory = loadNodeHistory;
exports.saveNodeHistory = saveNodeHistory;
exports.recordRailCompletion = recordRailCompletion;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getNodeHistoryPath(rootPath) {
    return path.join(rootPath, ".agent", "nodes", "history.json");
}
function ensureDir(rootPath) {
    const dir = path.join(rootPath, ".agent", "nodes");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
function loadNodeHistory(rootPath) {
    ensureDir(rootPath);
    const p = getNodeHistoryPath(rootPath);
    if (!fs.existsSync(p)) {
        const empty = { version: 1, nodes: {} };
        fs.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
        return empty;
    }
    try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !parsed.nodes) {
            return { version: 1, nodes: {} };
        }
        return parsed;
    }
    catch {
        return { version: 1, nodes: {} };
    }
}
function saveNodeHistory(rootPath, store) {
    ensureDir(rootPath);
    const p = getNodeHistoryPath(rootPath);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmp, p);
}
function nodeIdsFromLogicPath(logicPath) {
    const ids = new Set();
    for (const s of logicPath) {
        if (s.nodeId && typeof s.nodeId === "string") {
            ids.add(s.nodeId);
        }
    }
    return Array.from(ids);
}
function recordRailCompletion(rootPath, rail, state) {
    const store = loadNodeHistory(rootPath);
    const finishedAt = Date.now();
    const nodeIds = nodeIdsFromLogicPath(rail.logicPath ?? []);
    for (const nodeId of nodeIds) {
        const existing = store.nodes[nodeId] ?? {
            nodeId,
            successCount: 0,
            failureCount: 0,
            rails: [],
        };
        const next = {
            ...existing,
            rails: [
                ...existing.rails,
                {
                    railId: rail.id,
                    outcome: rail.outcome,
                    archetype: rail.archetype,
                    state,
                    finishedAt,
                },
            ].slice(-20),
        };
        if (state === "ARCHIVED") {
            next.successCount += 1;
            next.lastSuccessAt = finishedAt;
        }
        else {
            next.failureCount += 1;
            next.lastFailureAt = finishedAt;
        }
        store.nodes[nodeId] = next;
    }
    saveNodeHistory(rootPath, store);
}
