"use strict";
/**
 * Stale Jira detection — AGENT_ROADMAP v4 §8
 * Compares stored fingerprints in Jira issues with current module state.
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
exports.extractFingerprintFromDescription = extractFingerprintFromDescription;
exports.descriptionToString = descriptionToString;
exports.detectStaleJira = detectStaleJira;
const crypto = __importStar(require("crypto"));
/**
 * Extract arch-fingerprint and arch-module from Jira description text.
 * Handles both plain text and ADF (recursively extracts text).
 */
function extractFingerprintFromDescription(description) {
    const text = descriptionToString(description);
    if (!text)
        return { fingerprint: null, module: null };
    const fpMatch = text.match(/arch-fingerprint:\s*([a-fA-F0-9]+)/);
    const modMatch = text.match(/arch-module:\s*([^\s\n]+)/);
    return {
        fingerprint: fpMatch?.[1] ?? null,
        module: modMatch?.[1] ?? null,
    };
}
function descriptionToString(d) {
    if (typeof d === "string")
        return d;
    if (!d || typeof d !== "object")
        return "";
    const obj = d;
    if (obj.type === "doc" && Array.isArray(obj.content)) {
        return obj.content.map((c) => descriptionToString(c)).join("");
    }
    if (obj.type === "paragraph" && Array.isArray(obj.content)) {
        return obj.content.map((c) => descriptionToString(c)).join("");
    }
    if (obj.type === "text" && typeof obj.text === "string")
        return obj.text;
    return "";
}
/**
 * Compute a simple fingerprint for a module (path + file count).
 * Phase 3 stub; full implementation uses AST export/import signatures.
 */
function computeModuleFingerprint(node) {
    const payload = `${node.path}:${node.files.length}:${node.files.sort().join(",")}`;
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
/**
 * Detect Jira issues whose stored fingerprint no longer matches the current graph.
 */
function detectStaleJira(graph, issues) {
    const moduleMap = new Map();
    for (const n of graph.nodes) {
        moduleMap.set(n.path, computeModuleFingerprint(n));
    }
    const mismatches = [];
    for (const issue of issues) {
        if (!issue.storedFingerprint)
            continue; // New format, no stored fingerprint
        const storedMod = issue.storedModule;
        if (!storedMod)
            continue;
        const currentFp = moduleMap.get(storedMod) ?? null;
        if (!currentFp) {
            // Module deleted
            mismatches.push({
                key: issue.key,
                summary: issue.summary,
                storedFingerprint: issue.storedFingerprint,
                storedModule: storedMod,
                currentFingerprint: null,
                reason: "orphaned",
            });
        }
        else if (currentFp !== issue.storedFingerprint) {
            // Code changed
            mismatches.push({
                key: issue.key,
                summary: issue.summary,
                storedFingerprint: issue.storedFingerprint,
                storedModule: storedMod,
                currentFingerprint: currentFp,
                reason: "changed",
            });
        }
    }
    return mismatches;
}
