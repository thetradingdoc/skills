"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeIntentDriftScore = computeIntentDriftScore;
const openai_1 = require("openai");
async function embedMany(texts, apiKey) {
    const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
    if (!key || texts.length === 0)
        return null;
    const client = new openai_1.OpenAI({ apiKey: key });
    const response = await client.embeddings.create({
        model: "text-embedding-ada-002",
        input: texts,
    });
    const out = [];
    for (const row of response.data ?? []) {
        const vec = row.embedding;
        if (Array.isArray(vec))
            out.push(vec);
    }
    return out.length === texts.length ? out : null;
}
function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const va = a[i] ?? 0;
        const vb = b[i] ?? 0;
        dot += va * vb;
        normA += va * va;
        normB += vb * vb;
    }
    if (!normA || !normB)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
async function computeIntentDriftScore(rail, reasoningSamples, apiKey) {
    const summary = rail.intentSummary ?? rail.frozenOutcome ?? rail.outcome;
    if (!summary.trim() || reasoningSamples.length === 0)
        return null;
    const texts = reasoningSamples.map((r) => r.text).filter((t) => t.trim());
    if (texts.length === 0)
        return null;
    const allTexts = [summary, ...texts];
    const embeddings = await embedMany(allTexts, apiKey);
    if (!embeddings)
        return null;
    const [intentVec, ...reasoningVecs] = embeddings;
    const scores = [];
    for (const v of reasoningVecs) {
        scores.push(cosineSimilarity(intentVec, v));
    }
    if (scores.length === 0)
        return null;
    const avgSim = scores.reduce((a, b) => a + b, 0) / scores.length;
    const drift = 1 - avgSim;
    const clamped = Math.max(0, Math.min(1, drift));
    return clamped;
}
