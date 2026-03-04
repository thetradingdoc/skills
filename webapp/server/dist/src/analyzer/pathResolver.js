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
exports.loadTsConfigPaths = loadTsConfigPaths;
exports.resolveImportPath = resolveImportPath;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Load and parse tsconfig paths for alias resolution.
 */
function loadTsConfigPaths(rootPath) {
    const candidates = [
        path.join(rootPath, "tsconfig.json"),
        path.join(rootPath, "tsconfig.base.json"),
    ];
    for (const configPath of candidates) {
        if (!fs.existsSync(configPath))
            continue;
        try {
            const content = fs.readFileSync(configPath, "utf-8");
            const json = JSON.parse(content);
            const compilerOptions = json.compilerOptions || {};
            const baseUrl = compilerOptions.baseUrl || ".";
            const paths = compilerOptions.paths || {};
            return { baseUrl: path.resolve(rootPath, baseUrl), paths };
        }
        catch {
            continue;
        }
    }
    return null;
}
/**
 * Resolve an import specifier to an absolute file path.
 * Handles: relative (./, ../), and path aliases from tsconfig.
 */
function resolveImportPath(specifier, fromFile, rootPath) {
    if (specifier.startsWith(".")) {
        return resolveRelative(specifier, fromFile);
    }
    const tsPaths = loadTsConfigPaths(rootPath);
    if (!tsPaths)
        return null;
    for (const [pattern, targets] of Object.entries(tsPaths.paths)) {
        const match = matchPathPattern(specifier, pattern);
        if (!match)
            continue;
        for (const target of targets) {
            const resolved = target.replace(/\*/g, match);
            const absPath = path.resolve(tsPaths.baseUrl, resolved);
            const withExt = tryExtensions(absPath);
            if (withExt)
                return withExt;
        }
    }
    return null;
}
function resolveRelative(specifier, fromFile) {
    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, specifier);
    return tryExtensions(resolved);
}
function matchPathPattern(specifier, pattern) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("^" + escaped.replace(/\\\*/g, "(.*)") + "$");
    const m = specifier.match(regex);
    return m ? m[1] ?? "" : null;
}
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ""];
function tryExtensions(filePath) {
    for (const ext of EXTENSIONS) {
        const candidate = ext ? filePath + ext : filePath;
        if (fs.existsSync(candidate))
            return candidate;
    }
    for (const idx of ["index.ts", "index.tsx", "index.js", "index.jsx"]) {
        const candidate = path.join(filePath, idx);
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
