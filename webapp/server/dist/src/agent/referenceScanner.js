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
exports.scanDocumentReferences = scanDocumentReferences;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function walkMarkdown(root) {
    const out = [];
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === "node_modules" || e.name.startsWith("."))
                    continue;
                stack.push(full);
            }
            else if (e.name.endsWith(".md")) {
                out.push(full);
            }
        }
    }
    return out;
}
function extractReferences(content) {
    const refs = new Set();
    const backtickRe = /`([^`]+)`/g;
    let m;
    while ((m = backtickRe.exec(content))) {
        const ref = m[1].trim();
        if (!ref)
            continue;
        if (/[\\/]/.test(ref) || /\.[a-zA-Z0-9]+$/.test(ref)) {
            refs.add(ref);
        }
    }
    return Array.from(refs);
}
function scanDocumentReferences(rootPath) {
    const findings = [];
    const files = walkMarkdown(rootPath);
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(file, "utf-8");
        }
        catch {
            continue;
        }
        const rel = path.relative(rootPath, file);
        const refs = extractReferences(content);
        for (const ref of refs) {
            const target = path.resolve(rootPath, ref);
            if (!fs.existsSync(target)) {
                findings.push({
                    type: "missing_file",
                    severity: "warning",
                    description: `Documentation references ${ref} but it does not exist`,
                    location: rel,
                    expectedLocation: ref,
                    evidence: [`Reference: \`${ref}\` in ${rel}`],
                });
            }
        }
    }
    return findings;
}
