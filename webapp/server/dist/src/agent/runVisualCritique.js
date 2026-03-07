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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVisualCritique = runVisualCritique;
const fs = __importStar(require("fs"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
/**
 * Run a lightweight vision-based critique on a UI screenshot.
 *
 * - Returns an empty array when the Anthropic API key is not configured
 *   or when the model output cannot be parsed as JSON.
 * - Uses claude-sonnet-4-6 to keep costs reasonable for per-rail checks.
 */
async function runVisualCritique(screenshotPath, outcome) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey)
        return [];
    if (!fs.existsSync(screenshotPath))
        return [];
    const data = fs.readFileSync(screenshotPath);
    const base64 = data.toString("base64");
    const client = new sdk_1.default({ apiKey });
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
    if (!textBlock || textBlock.type !== "text")
        return [];
    try {
        const parsed = JSON.parse(textBlock.text.trim());
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((v) => v &&
            typeof v === "object" &&
            typeof v.element === "string" &&
            typeof v.violation === "string" &&
            ["high", "medium", "low"].includes(v.severity));
    }
    catch {
        return [];
    }
}
