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
exports.scanContracts = scanContracts;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function walkFiles(root, exts) {
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
            else if (exts.includes(path.extname(e.name))) {
                out.push(full);
            }
        }
    }
    return out;
}
function extractDefinedRoutes(rootPath) {
    const files = walkFiles(rootPath, [".ts", ".tsx", ".js", ".jsx"]);
    const defs = [];
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(file, "utf-8");
        }
        catch {
            continue;
        }
        const routeRegex = /\b(app|router)\.(get|post|put|delete|patch|use)\s*\(\s*["'`]([^"'`]+)["'`]/g;
        let m;
        while ((m = routeRegex.exec(content))) {
            const method = m[2].toUpperCase();
            const p = m[3];
            if (!p.startsWith("/"))
                continue;
            defs.push({ method, path: p, file: path.relative(rootPath, file) });
        }
    }
    return defs;
}
function extractCalledRoutes(rootPath) {
    const files = walkFiles(rootPath, [".ts", ".tsx", ".js", ".jsx", ".py"]);
    const calls = [];
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(file, "utf-8");
        }
        catch {
            continue;
        }
        const fetchRegex = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g;
        const axiosRegex = /\baxios\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/g;
        let m;
        while ((m = fetchRegex.exec(content))) {
            const p = m[1];
            if (!p.startsWith("/"))
                continue;
            calls.push({ method: "GET", path: p, file: path.relative(rootPath, file) });
        }
        while ((m = axiosRegex.exec(content))) {
            const method = m[1].toUpperCase();
            const p = m[2];
            if (!p.startsWith("/") && !p.includes("/api/"))
                continue;
            calls.push({ method, path: p, file: path.relative(rootPath, file) });
        }
    }
    return calls;
}
function scanContracts(rootPath) {
    const findings = [];
    const defs = extractDefinedRoutes(rootPath);
    const calls = extractCalledRoutes(rootPath);
    const defKey = (r) => `${r.method}:${r.path}`;
    const defsByKey = new Map();
    for (const d of defs) {
        const key = defKey(d);
        const arr = defsByKey.get(key) ?? [];
        arr.push(d);
        defsByKey.set(key, arr);
    }
    const callsByKey = new Map();
    for (const c of calls) {
        const key = defKey(c);
        const arr = callsByKey.get(key) ?? [];
        arr.push(c);
        callsByKey.set(key, arr);
    }
    // NOTE: This scanner uses simple regex-based heuristics.
    // It will miss routes composed from variables/template literals
    // and routes mounted via sub-routers (e.g. app.use('/api', router)).
    // Treat findings as hints, not ground truth.
    // Defined but never called
    for (const [key, defList] of defsByKey) {
        if (callsByKey.has(key))
            continue;
        for (const d of defList) {
            findings.push({
                type: "missing_caller",
                severity: "warning",
                description: `Route ${d.method} ${d.path} has no callers in codebase`,
                location: d.file,
                evidence: [`Defined in ${d.file}`],
            });
        }
    }
    // Called but not defined
    for (const [key, callList] of callsByKey) {
        if (defsByKey.has(key))
            continue;
        for (const c of callList) {
            findings.push({
                type: "missing_implementor",
                severity: "critical",
                description: `Route ${c.method} ${c.path} is called but no definition was found`,
                location: c.file,
                evidence: [`Call in ${c.file}`],
            });
        }
    }
    return findings;
}
