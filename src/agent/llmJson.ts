/**
 * LLM JSON parsing — robust extraction from markdown-wrapped or raw LLM output.
 * Use for plan JSON, tool calls, verification output, etc.
 */

/**
 * Parse JSON object from LLM output. Handles markdown code blocks and extra text.
 * Returns null on parse failure or if result is not an object.
 */
export function parseJsonFromLLM(raw: string): object | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch?.[0]) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
