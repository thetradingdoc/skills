"use strict";
/**
 * Session persistence — AGENT_ROADMAP v4 §5c
 * AgentSession serialization, crash recovery.
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
exports.getSessionPath = getSessionPath;
exports.saveSession = saveSession;
exports.loadSession = loadSession;
exports.deleteSession = deleteSession;
exports.createEmptySession = createEmptySession;
exports.bumpSessionUsage = bumpSessionUsage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const traceLogger_1 = require("./traceLogger");
const telemetry_1 = require("./rail/telemetry");
const SESSION_FILE = ".arch-agent-session.json";
function getSessionPath(projectRoot) {
    return path.join(projectRoot, SESSION_FILE);
}
function saveSession(projectRoot, session) {
    const p = getSessionPath(projectRoot);
    fs.writeFileSync(p, JSON.stringify(session, null, 2), "utf-8");
}
function loadSession(projectRoot) {
    const p = getSessionPath(projectRoot);
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
function deleteSession(projectRoot) {
    const p = getSessionPath(projectRoot);
    if (fs.existsSync(p))
        fs.unlinkSync(p);
}
function createEmptySession(plan) {
    return {
        planState: plan,
        currentTaskIndex: 0,
        sessionTouchedPaths: [],
        tokenUsage: 0,
        llmCallCount: 0,
        retryCounts: {},
        activeGate: "plan_review",
        stagingIds: [],
    };
}
function bumpSessionUsage(projectRoot, delta) {
    const session = loadSession(projectRoot);
    if (!session)
        return;
    const ctx = (0, traceLogger_1.getTraceContext)();
    if (typeof delta.tokenUsage === "number" && Number.isFinite(delta.tokenUsage)) {
        session.tokenUsage += delta.tokenUsage;
        if (ctx.railId) {
            (0, telemetry_1.recordTokens)(ctx.railId, delta.tokenUsage);
        }
    }
    if (typeof delta.llmCallCount === "number" && Number.isFinite(delta.llmCallCount)) {
        session.llmCallCount += delta.llmCallCount;
        if (ctx.railId) {
            (0, telemetry_1.recordLlmCall)(ctx.railId);
        }
    }
    saveSession(projectRoot, session);
}
