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
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectDrift = detectDrift;
const contextReader_1 = require("./contextReader");
const archRulesReader_1 = require("./archRulesReader");
const path = __importStar(require("path"));
function matchesPattern(moduleId, pattern) {
    if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
        return regex.test(moduleId);
    }
    return moduleId.includes(pattern) || path.basename(moduleId) === pattern;
}
function detectDrift(graph) {
    const archRules = (0, archRulesReader_1.readArchRules)(graph.projectRoot);
    const updatedEdges = graph.edges.map((edge) => {
        const sourceModulePath = path.join(graph.projectRoot, edge.source);
        const context = (0, contextReader_1.readContextFile)(sourceModulePath);
        if (context?.mustNotDependOn) {
            const targetName = path.basename(edge.target);
            const violation = context.mustNotDependOn.find((forbidden) => edge.target.includes(forbidden) || targetName === forbidden);
            if (violation) {
                return {
                    ...edge,
                    isDrift: true,
                    driftReason: `"${path.basename(edge.source)}" must not depend on "${violation}"`,
                };
            }
        }
        for (const rule of archRules) {
            if (matchesPattern(edge.source, rule.sourcePattern) &&
                matchesPattern(edge.target, rule.mustNotImportPattern)) {
                return {
                    ...edge,
                    isDrift: true,
                    driftReason: rule.description,
                };
            }
        }
        return edge;
    });
    const updatedNodes = graph.nodes.map((node) => {
        const modulePath = path.join(graph.projectRoot, node.id);
        const context = (0, contextReader_1.readContextFile)(modulePath);
        const updates = {};
        if (context?.isDeprecated)
            updates.status = "deprecated";
        if (context?.role)
            updates.role = context.role;
        if (context?.rawContent)
            updates.contextRawContent = context.rawContent;
        return { ...node, ...updates };
    });
    const nodesWithDrift = new Set(updatedEdges.filter((e) => e.isDrift).flatMap((e) => [e.source, e.target]));
    const finalNodes = updatedNodes.map((node) => ({
        ...node,
        isDrift: nodesWithDrift.has(node.id),
    }));
    return {
        ...graph,
        nodes: finalNodes,
        edges: updatedEdges,
    };
}
