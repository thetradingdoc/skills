"use strict";
/**
 * Trace logger — AGENT_ROADMAP v4 §9
 * Emits trace entries for real-time observation and replay.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTraceLogger = initTraceLogger;
exports.getSessionId = getSessionId;
exports.subscribeTrace = subscribeTrace;
exports.emitTrace = emitTrace;
let sessionId = "";
let subscriber = null;
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
function emitTrace(stepType, input, output, decision, opts) {
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
