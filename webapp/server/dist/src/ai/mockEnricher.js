"use strict";
/**
 * Mock enricher — used when no OpenAI key is configured.
 * Uses the actual graph summary and findings so responses are meaningful
 * even without an API key. Not a replacement for the live enricher,
 * but no longer returns generic "I don't have access" responses.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichGraph = enrichGraph;
exports.askAboutArchitecture = askAboutArchitecture;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const FIXTURES_DIR = path.join(__dirname, "..", "..", "fixtures");
function loadJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function enrichGraph(graph) {
    const enrichment = loadJson(path.join(FIXTURES_DIR, "mock-enrichment.json"));
    if (!enrichment)
        return graph;
    return {
        ...graph,
        nodes: graph.nodes.map((node) => {
            const suggestedLabel = node.suggestedLabel ??
                enrichment.suggestedLabels?.[node.id] ??
                enrichment.roles?.[node.id];
            const layer = node.layer ?? enrichment.layers?.[node.id];
            const description = node.description ?? enrichment.descriptions?.[node.id];
            const role = node.role ?? enrichment.roles?.[node.id] ?? suggestedLabel;
            return {
                ...node,
                role: role ?? suggestedLabel ?? node.label,
                suggestedLabel: suggestedLabel ?? node.label,
                layer: layer || "Uncategorized",
                description: description ?? "",
                status: (enrichment.status?.[node.id] ?? node.status),
            };
        }),
    };
}
const LAYER_ORDER = [
    "Presentation",
    "Business Logic",
    "Data Access",
    "Infrastructure",
    "External Services",
    "Utilities",
    "Configuration",
    "Uncategorized",
];
function parseGraphCommandFromQuestion(question, graph) {
    const q = question.toLowerCase();
    for (const layer of LAYER_ORDER) {
        if (q.includes(layer.toLowerCase())) {
            return { action: "filter_layer", layer };
        }
    }
    if (q.includes("violat"))
        return { action: "filter_edge_type", edgeType: "violations" };
    if (q.includes("drift"))
        return { action: "filter_edge_type", edgeType: "drift" };
    if (q.includes("all edge") || q.includes("show all"))
        return { action: "reset" };
    const nodeMatch = graph.nodes.find((n) => q.includes((n.suggestedLabel ?? n.label).toLowerCase()) ||
        q.includes(n.id.toLowerCase()));
    if (nodeMatch && (q.includes("focus") || q.includes("show") || q.includes("where"))) {
        const neighbours = graph.edges
            .filter((e) => e.source === nodeMatch.id || e.target === nodeMatch.id)
            .flatMap((e) => [e.source, e.target]);
        return {
            action: "highlight_nodes",
            nodeIds: [nodeMatch.id, ...neighbours].filter((id, i, arr) => arr.indexOf(id) === i),
        };
    }
    return undefined;
}
async function askAboutArchitecture(question, graph, nodeId, history, _apiKey, findings) {
    const q = question.toLowerCase();
    const nodeCount = graph.nodes.length;
    const edgeCount = graph.edges.length;
    const driftCount = graph.edges.filter((e) => e.isDrift).length;
    const violationCount = graph.edges.filter((e) => e.isLayerViolation).length;
    const missingContext = graph.nodes.filter((n) => !n.health?.hasContext).length;
    const layerGroups = {};
    for (const n of graph.nodes) {
        const layer = (n.layer ?? "Uncategorized");
        if (!layerGroups[layer])
            layerGroups[layer] = [];
        layerGroups[layer].push(n.suggestedLabel ?? n.label ?? n.id);
    }
    const layerSummary = LAYER_ORDER.filter((l) => layerGroups[l]?.length)
        .map((l) => `  ${l}: ${layerGroups[l].join(", ")}`)
        .join("\n");
    const criticalFindings = (findings ?? []).filter((f) => f.severity === "critical");
    const warningFindings = (findings ?? []).filter((f) => f.severity === "warning");
    const focusNode = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;
    const graphCommand = parseGraphCommandFromQuestion(question, graph);
    if (q.includes("bug") ||
        q.includes("issue") ||
        q.includes("broken") ||
        q.includes("wrong") ||
        q.includes("problem") ||
        q.includes("error")) {
        const parts = [];
        if (criticalFindings.length > 0) {
            parts.push(`**${criticalFindings.length} critical issue${criticalFindings.length > 1 ? "s" : ""}:**\n` +
                criticalFindings
                    .slice(0, 8)
                    .map((f) => `• ${f.description} (${f.location})`)
                    .join("\n"));
        }
        if (warningFindings.length > 0) {
            parts.push(`**${warningFindings.length} warning${warningFindings.length > 1 ? "s" : ""}:**\n` +
                warningFindings
                    .slice(0, 5)
                    .map((f) => `• ${f.description}`)
                    .join("\n"));
        }
        if (driftCount > 0) {
            parts.push(`**${driftCount} drift edge${driftCount > 1 ? "s" : ""}** — modules importing across unexpected boundaries.`);
        }
        if (violationCount > 0) {
            parts.push(`**${violationCount} layer violation${violationCount > 1 ? "s" : ""}** — e.g. Data Access importing from Presentation.`);
        }
        if (missingContext > 0) {
            parts.push(`**${missingContext} module${missingContext > 1 ? "s" : ""} with no context** — no .context.md file, so layer/role may be misclassified.`);
        }
        if (parts.length === 0) {
            return {
                answer: `No issues detected by static analysis in this graph (${nodeCount} modules, ${edgeCount} connections). ` +
                    `Enable the live enricher (set OPENAI_API_KEY) for deeper reasoning.`,
            };
        }
        return {
            answer: parts.join("\n\n"),
            ...(graphCommand
                ? { graphCommand }
                : violationCount > 0
                    ? { graphCommand: { action: "filter_edge_type", edgeType: "violations" } }
                    : {}),
        };
    }
    if (q.includes("show") || q.includes("filter") || q.includes("highlight")) {
        if (graphCommand) {
            const layerName = graphCommand.action === "filter_layer"
                ? graphCommand.layer
                : graphCommand.action === "filter_edge_type"
                    ? graphCommand.edgeType
                    : null;
            return {
                answer: layerName
                    ? `Filtering to ${layerName}. ${layerGroups[layerName]?.join(", ") ?? ""}`
                    : "Applying filter.",
                graphCommand,
            };
        }
    }
    if (focusNode) {
        const incoming = graph.edges.filter((e) => e.target === focusNode.id);
        const outgoing = graph.edges.filter((e) => e.source === focusNode.id);
        const inNames = incoming
            .map((e) => graph.nodes.find((n) => n.id === e.source)?.suggestedLabel ?? e.source)
            .join(", ");
        const outNames = outgoing
            .map((e) => graph.nodes.find((n) => n.id === e.target)?.suggestedLabel ?? e.target)
            .join(", ");
        return {
            answer: `**${focusNode.suggestedLabel ?? focusNode.label}** (${focusNode.layer ?? "Uncategorized"})\n` +
                `${focusNode.description ?? ""}\n\n` +
                (inNames ? `Imported by: ${inNames}\n` : "") +
                (outNames ? `Imports: ${outNames}` : ""),
            graphCommand: graphCommand ??
                {
                    action: "highlight_nodes",
                    nodeIds: [
                        focusNode.id,
                        ...incoming.map((e) => e.source),
                        ...outgoing.map((e) => e.target),
                    ],
                },
        };
    }
    if (q.includes("layer") ||
        q.includes("architecture") ||
        q.includes("overview") ||
        q.includes("structure")) {
        return {
            answer: `**Architecture — ${nodeCount} modules across ${Object.keys(layerGroups).length} layers:**\n\n` +
                layerSummary +
                (driftCount > 0 ? `\n\n⚠ ${driftCount} drift edges detected.` : "") +
                (violationCount > 0 ? `\n⚠ ${violationCount} layer violations detected.` : ""),
            graphCommand,
        };
    }
    const findingLine = criticalFindings.length > 0
        ? `\n\n⚠ ${criticalFindings.length} critical finding${criticalFindings.length > 1 ? "s" : ""} from static analysis — ask "what bugs have you found" for details.`
        : "";
    return {
        answer: `This repo has **${nodeCount} modules** and **${edgeCount} connections**.\n\n` +
            layerSummary +
            findingLine +
            `\n\nSet OPENAI_API_KEY for full AI reasoning. Current answers are based on static analysis only.`,
        graphCommand,
    };
}
