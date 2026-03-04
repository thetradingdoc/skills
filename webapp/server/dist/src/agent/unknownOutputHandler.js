"use strict";
/**
 * Unknown LLM output handler — AGENT_ROADMAP v4 §3
 * When model returns output that doesn't parse as a known type.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_OUTPUT_RETRY_PROMPT = void 0;
exports.isKnownOutputType = isKnownOutputType;
exports.UNKNOWN_OUTPUT_RETRY_PROMPT = "Your last response was not a valid tool call or plan. Output only valid JSON matching one of the defined types (tool call, agent_plan, revised_plan, propose_rule_change).";
function isKnownOutputType(obj) {
    if (!obj || typeof obj !== "object")
        return false;
    const o = obj;
    if (o.type === "agent_plan" || o.type === "revised_plan" || o.type === "propose_rule_change") {
        return true;
    }
    if (typeof o.tool === "string" && typeof o.args === "object")
        return true;
    return false;
}
