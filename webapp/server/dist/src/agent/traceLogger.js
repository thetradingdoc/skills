"use strict";
/**
 * Trace logger — AGENT_ROADMAP v4 §9
 * Emits trace entries for real-time observation and replay.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTraceContext = setTraceContext;
exports.clearTraceContext = clearTraceContext;
exports.getTraceContext = getTraceContext;
exports.initTraceLogger = initTraceLogger;
exports.getSessionId = getSessionId;
exports.subscribeTrace = subscribeTrace;
exports.subscribeAgentTrace = subscribeAgentTrace;
exports.getAgentTraces = getAgentTraces;
exports.collectRecentReasoning = collectRecentReasoning;
exports.emitTrace = emitTrace;
let sessionId = "";
let subscriber = null;
let agentSubscriber = null;
const agentTraces = [];
let traceContext = {};
function setTraceContext(ctx) {
    traceContext = { ...ctx };
}
function clearTraceContext() {
    traceContext = {};
}
function getTraceContext() {
    return { ...traceContext };
}
function generateId() {
    return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
function initTraceLogger(newSessionId) {
    sessionId = newSessionId ?? `sess_${Date.now()}`;
}
function getSessionId() {
    return sessionId;
}
function subscribeTrace(cb) {
    subscriber = cb;
    return () => {
        subscriber = null;
    };
}
function subscribeAgentTrace(cb) {
    agentSubscriber = cb;
    return () => {
        agentSubscriber = null;
    };
}
function emitLegacyTrace(stepType, input, output, decision, opts) {
    const entry = {
        id: generateId(),
        sessionId,
        timestamp: new Date().toISOString(),
        stepType,
        input,
        output,
        decision,
        ...opts,
    };
    subscriber?.(entry);
    return entry;
}
function emitAgentTrace(entry) {
    const merged = {
        ...entry,
        railId: entry.railId ?? traceContext.railId,
        taskId: entry.taskId ?? traceContext.taskId,
        metadata: {
            ...entry.metadata,
            logicPathStep: entry.metadata?.logicPathStep ?? traceContext.logicPathStep,
            filePath: entry.metadata?.filePath ?? traceContext.filePath,
        },
    };
    const full = {
        id: generateId(),
        timestamp: Date.now(),
        ...merged,
    };
    agentTraces.push(full);
    agentSubscriber?.(full);
    return full;
}
function getAgentTraces() {
    return agentTraces.slice();
}
function collectRecentReasoning(railId, windowN) {
    const filtered = agentTraces.filter((t) => t.railId === railId && (t.type === "info" || t.type === "critic_feedback" || t.type === "error"));
    const recent = filtered.slice(-windowN);
    return recent.map((t) => ({
        message: t.message,
        timestamp: t.timestamp,
        role: t.role,
        type: t.type,
    }));
}
function emitTrace(a, b, c, d, e) {
    // New API: emitTrace({ role, type, message, ... })
    if (a && typeof a === "object" && typeof a.message === "string") {
        return emitAgentTrace(a);
    }
    // Legacy API: emitTrace(stepType, input, output, decision, opts?)
    return emitLegacyTrace(a, b ?? {}, c ?? {}, d ?? "", e);
}
