"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateArchRules = generateArchRules;
const openai_1 = __importDefault(require("openai"));
function getClient(apiKey) {
    const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
    return key ? new openai_1.default({ apiKey: key }) : null;
}
async function generateArchRules(graph, apiKey) {
    const client = getClient(apiKey);
    if (!client) {
        throw new Error("OpenAI API key not configured. Set archVisualizer.openaiApiKey or OPENAI_API_KEY.");
    }
    const layers = [...new Set(graph.nodes.map((n) => n.layer ?? "Uncategorized"))];
    const edges = graph.edges.slice(0, 50).map((e) => {
        const s = graph.nodes.find((n) => n.id === e.source);
        const t = graph.nodes.find((n) => n.id === e.target);
        return `${s?.layer ?? "?"} [${e.source}] → ${t?.layer ?? "?"} [${e.target}]`;
    });
    const prompt = `You are a software architect. Given this architecture graph with confirmed layers, generate an .arch-rules.json file.

Layers (top to bottom): Presentation, Business Logic, External Services, Data Access, Infrastructure, Utilities, Configuration, Uncategorized.

Rule: dependencies must flow downward. A lower layer must NOT import a higher layer.

Current modules and layers:
${graph.nodes.map((n) => `- ${n.id} [${n.layer ?? "Uncategorized"}]`).join("\n")}

Sample edges:
${edges.join("\n")}

Generate rules for layer pairs where a dependency would violate clean architecture. Use layer names or glob patterns for sourcePattern and mustNotImportPattern.

Return ONLY valid JSON — no markdown, no explanation:
{
  "rules": [
    {
      "id": "no-data-to-presentation",
      "description": "Data Access must not import Presentation",
      "sourcePattern": "*Data Access*",
      "mustNotImportPattern": "*Presentation*",
      "severity": "error"
    }
  ]
}

Create 3-8 rules based on the layer hierarchy. Use * as glob wildcard.`;
    const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed.rules || !Array.isArray(parsed.rules)) {
        throw new Error("Invalid rules format from model");
    }
    return parsed;
}
