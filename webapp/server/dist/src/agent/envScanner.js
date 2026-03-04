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
exports.scanEnvironmentGaps = scanEnvironmentGaps;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function readEnvTemplate(rootPath) {
    const candidates = [".env.example", ".env.sample"];
    const vars = new Set();
    for (const name of candidates) {
        const full = path.join(rootPath, name);
        if (!fs.existsSync(full))
            continue;
        let content;
        try {
            content = fs.readFileSync(full, "utf-8");
        }
        catch {
            continue;
        }
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#"))
                continue;
            const [key] = trimmed.split("=", 1);
            if (key)
                vars.add(key.trim());
        }
    }
    return vars;
}
function walkCodeFiles(root) {
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
            else {
                const ext = path.extname(e.name);
                if ([".ts", ".tsx", ".js", ".jsx", ".py"].includes(ext)) {
                    out.push(full);
                }
            }
        }
    }
    return out;
}
function scanEnvironmentGaps(rootPath) {
    const findings = [];
    const documented = readEnvTemplate(rootPath);
    if (documented.size === 0)
        return findings;
    const used = new Map(); // var -> files
    const files = walkCodeFiles(rootPath);
    const tsEnvRe = /process\.env\.([A-Z0-9_]+)/g;
    const pyEnvRe = /os\.environ\.get\(\s*["']([A-Z0-9_]+)["']/g;
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(file, "utf-8");
        }
        catch {
            continue;
        }
        let m;
        while ((m = tsEnvRe.exec(content))) {
            const key = m[1];
            if (!used.has(key))
                used.set(key, new Set());
            used.get(key).add(path.relative(rootPath, file));
        }
        while ((m = pyEnvRe.exec(content))) {
            const key = m[1];
            if (!used.has(key))
                used.set(key, new Set());
            used.get(key).add(path.relative(rootPath, file));
        }
    }
    // Vars used in code but missing from template
    for (const [key, filesSet] of used) {
        if (!documented.has(key)) {
            findings.push({
                type: "missing_env_var",
                severity: "warning",
                description: `Environment variable ${key} is used in code but not documented in .env.example / .env.sample`,
                location: Array.from(filesSet)[0] ?? "",
                evidence: [`Used in: ${Array.from(filesSet).join(", ")}`],
            });
        }
    }
    // Vars documented but never used
    for (const key of documented) {
        if (!used.has(key)) {
            findings.push({
                type: "config_mismatch",
                severity: "info",
                description: `Environment variable ${key} is listed in .env.example / .env.sample but not referenced in code`,
                location: ".env.example or .env.sample",
                evidence: [],
            });
        }
    }
    return findings;
}
