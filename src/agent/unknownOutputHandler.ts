/**
 * Unknown LLM output handler — AGENT_ROADMAP v4 §3
 * When model returns output that doesn't parse as a known type.
 */

export const UNKNOWN_OUTPUT_RETRY_PROMPT =
  "Your last response was not a valid tool call or plan. Output only valid JSON matching one of the defined types (tool call, agent_plan, revised_plan, propose_rule_change).";

export function isKnownOutputType(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (o.type === "agent_plan" || o.type === "revised_plan" || o.type === "propose_rule_change") {
    return true;
  }
  if (typeof o.tool === "string" && typeof o.args === "object") return true;
  return false;
}
