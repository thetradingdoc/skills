"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchQueryToGraph = matchQueryToGraph;
exports.formatMatchedNodesForPrompt = formatMatchedNodesForPrompt;
const NAVIGATION_TRIGGERS = [
    "show me",
    "show the",
    "find",
    "where is",
    "where are",
    "highlight",
    "focus on",
    "zoom to",
    "navigate to",
    "look at",
    "go to",
    "display",
    "architecture of",
    "what is the architecture of",
];
const LAYER_ALIASES = {
    Presentation: ["ui", "frontend", "front-end", "view", "page", "component", "screen", "presentation"],
    "Business Logic": ["business", "service", "logic", "domain", "core", "use case", "usecase"],
    "Data Access": ["data", "database", "db", "repository", "repo", "persistence", "storage", "dao"],
    Infrastructure: ["infra", "infrastructure", "config", "server", "deploy", "devops", "ci", "cd"],
    "External Services": ["external", "third party", "third-party", "api", "integration", "client", "provider"],
    Utilities: ["util", "utility", "helper", "shared", "common", "lib"],
    Configuration: ["config", "configuration", "settings", "env", "environment"],
};
function normalize(s) {
    return s.toLowerCase().replace(/[-_/\\\.]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenize(s) {
    return normalize(s).split(" ").filter(Boolean);
}
function scoreNode(node, queryTokens) {
    const labelTokens = tokenize(node.suggestedLabel ?? node.label ?? node.id);
    const idTokens = tokenize(node.id);
    const descTokens = tokenize(node.description ?? "");
    const roleTokens = tokenize(node.role ?? "");
    let score = 0;
    for (const qt of queryTokens) {
        // Ignore very short tokens to avoid over-matching common words like "a", "in", "to"
        if (qt.length < 3)
            continue;
        if (labelTokens.includes(qt))
            score += 10;
        else if (labelTokens.some((lt) => lt.includes(qt) || qt.includes(lt)))
            score += 5;
        if (idTokens.some((it) => it.includes(qt) || qt.includes(it)))
            score += 4;
        if (roleTokens.some((rt) => rt.includes(qt) || qt.includes(rt)))
            score += 3;
        if (descTokens.some((dt) => dt.includes(qt) || qt.includes(dt)))
            score += 1;
    }
    const fullQuery = queryTokens.join(" ");
    const fullLabel = labelTokens.join(" ");
    if (fullLabel.includes(fullQuery))
        score += 15;
    if (fullQuery.includes(fullLabel) && fullLabel.length > 3)
        score += 8;
    return score;
}
function matchLayer(queryTokens) {
    for (const [layer, aliases] of Object.entries(LAYER_ALIASES)) {
        for (const alias of aliases) {
            const aliasTokens = tokenize(alias);
            if (aliasTokens.every((at) => queryTokens.includes(at))) {
                return layer;
            }
        }
    }
    return null;
}
function extractSubject(query) {
    const lower = query.toLowerCase();
    let subject = lower;
    for (const trigger of NAVIGATION_TRIGGERS.sort((a, b) => b.length - a.length)) {
        const idx = lower.indexOf(trigger);
        if (idx !== -1) {
            subject = lower.slice(idx + trigger.length).trim();
            break;
        }
    }
    return subject.replace(/^(the|a|an|this|that)\s+/i, "").trim();
}
function matchQueryToGraph(query, graph) {
    const lower = query.toLowerCase();
    const isNavigation = NAVIGATION_TRIGGERS.some((t) => lower.includes(t));
    if (!isNavigation) {
        return { isNavigation: false, matchedNodeIds: [], reason: "no navigation trigger" };
    }
    const subject = extractSubject(query);
    const subjectTokens = tokenize(subject);
    if (subjectTokens.length === 0) {
        return { isNavigation: true, matchedNodeIds: [], reason: "no subject after trigger" };
    }
    const matchedLayer = matchLayer(subjectTokens);
    if (matchedLayer) {
        const layerNodes = graph.nodes.filter((n) => n.layer === matchedLayer);
        return {
            isNavigation: true,
            matchedNodeIds: layerNodes.map((n) => n.id),
            reason: `layer match: "${matchedLayer}"`,
        };
    }
    const scored = graph.nodes
        .map((n) => ({ node: n, score: scoreNode(n, subjectTokens) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
        return { isNavigation: true, matchedNodeIds: [], reason: "no nodes matched subject" };
    }
    const topScore = scored[0].score;
    const threshold = topScore * 0.6;
    const topNodes = scored.filter((x) => x.score >= threshold).slice(0, 5);
    return {
        isNavigation: true,
        matchedNodeIds: topNodes.map((x) => x.node.id),
        reason: `matched ${topNodes.length} node(s) for subject "${subject}" (top score: ${topScore})`,
    };
}
function formatMatchedNodesForPrompt(matchedNodeIds, graph) {
    if (matchedNodeIds.length === 0)
        return "";
    const lines = [
        "Nodes most likely relevant to this query (use these IDs in graphCommand):",
    ];
    for (const id of matchedNodeIds) {
        const node = graph.nodes.find((n) => n.id === id);
        if (!node)
            continue;
        const label = node.suggestedLabel ?? node.label ?? id;
        lines.push(`  - id: "${id}" | label: "${label}" | layer: ${node.layer}`);
        if (node.description)
            lines.push(`    description: ${node.description}`);
    }
    return lines.join("\n");
}
