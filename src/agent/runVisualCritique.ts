import * as fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

export interface VisualViolation {
  element: string;
  violation: string;
  severity: "high" | "medium" | "low";
}

/**
 * Run a lightweight vision-based critique on a UI screenshot.
 *
 * - Returns an empty array when the Anthropic API key is not configured
 *   or when the model output cannot be parsed as JSON.
 * - Uses claude-sonnet-4-6 to keep costs reasonable for per-rail checks.
 */
export async function runVisualCritique(
  screenshotPath: string,
  outcome: string
): Promise<VisualViolation[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return [];
  if (!fs.existsSync(screenshotPath)) return [];

  const data = fs.readFileSync(screenshotPath);
  const base64 = data.toString("base64");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64,
            },
          },
          {
            type: "text",
            text: `You are a UI quality reviewer.

Intended outcome for this rail:
"${outcome || "Unknown rail outcome"}"

Look at this screenshot and identify any visual violations:
- Overlapping or clipped text
- Misaligned elements
- Broken layouts
- Contrast or readability issues
- Cut-off components

Respond ONLY with JSON, no other text:
[
  { "element": "<short name>", "violation": "<what is wrong>", "severity": "high|medium|low" }
]

If there are no issues, respond with: []`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  try {
    const parsed = JSON.parse(textBlock.text.trim()) as VisualViolation[] | unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is VisualViolation =>
        v &&
        typeof v === "object" &&
        typeof (v as any).element === "string" &&
        typeof (v as any).violation === "string" &&
        ["high", "medium", "low"].includes((v as any).severity)
    );
  } catch {
    return [];
  }
}

