"use strict";
/**
 * Security allowlist — AGENT_ROADMAP v4 §6
 * Path validation for read_file, get_ast, write_file.
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
exports.checkPathAllowed = checkPathAllowed;
const path = __importStar(require("path"));
const READ_ALLOWED_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".env.example",
    ".env.sample",
    ".sh",
]);
const WRITE_ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md"]);
const EXCLUDED_PATTERNS = [
    /node_modules/,
    /\.config\./,
    /\.lock$/,
];
function isEnvProtected(basename) {
    if (basename === ".env")
        return true;
    if (basename.startsWith(".env.") && !basename.endsWith(".example") && !basename.endsWith(".sample")) {
        return true;
    }
    return false;
}
const DEFAULT_ALLOWED_PREFIXES = ["src/", "docs/"];
function checkPathAllowed(filePath, config, mode = "write") {
    const root = path.resolve(config.projectRoot);
    const resolved = path.resolve(root, filePath);
    if (!resolved.startsWith(root)) {
        return { allowed: false, reason: "Path outside project root" };
    }
    const relative = path.relative(root, resolved).replace(/\\/g, "/");
    if (relative.includes("..")) {
        return { allowed: false, reason: "Path traversal not allowed" };
    }
    const ext = path.extname(resolved);
    const basename = path.basename(resolved);
    if (isEnvProtected(basename)) {
        return { allowed: false, reason: "Environment files (.env*) are not readable or writable" };
    }
    const isDockerfile = basename === "Dockerfile";
    const allowedExts = mode === "read" ? READ_ALLOWED_EXTENSIONS : WRITE_ALLOWED_EXTENSIONS;
    if (!isDockerfile && !allowedExts.has(ext)) {
        return { allowed: false, reason: `Extension ${ext || "<none>"} not allowed for ${mode}` };
    }
    for (const pat of EXCLUDED_PATTERNS) {
        if (pat.test(relative)) {
            return { allowed: false, reason: `Path matches excluded pattern: ${pat}` };
        }
    }
    const prefixes = config.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
    const ok = prefixes.some((p) => relative.startsWith(p));
    if (!ok) {
        return { allowed: false, reason: `Path must be under ${prefixes.join(" or ")}` };
    }
    return { allowed: true };
}
