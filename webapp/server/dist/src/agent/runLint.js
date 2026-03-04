"use strict";
/**
 * run_lint — AGENT_ROADMAP v4 §4c
 * Runs ESLint/TypeScript check on paths. Returns LintOutput.
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
exports.runLint = runLint;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
function runLint(projectRoot, paths) {
    const errors = [];
    // Try tsc first (catches type errors)
    const tscProc = (0, child_process_1.spawnSync)("npx", ["tsc", "--noEmit", "--pretty", "false"], {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 4 * 1024 * 1024,
    });
    if (tscProc.status !== 0 && tscProc.stderr) {
        const root = path.resolve(projectRoot);
        const lines = tscProc.stderr.split("\n");
        for (const line of lines) {
            const match = line.match(/^([^(]+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/);
            if (match) {
                const [, filePath, lineNum, col, message] = match;
                const resolved = path.isAbsolute(filePath?.trim() ?? "")
                    ? filePath.trim()
                    : path.join(root, filePath?.trim() ?? "");
                const rel = path.relative(root, resolved).replace(/\\/g, "/");
                errors.push({
                    filePath: rel,
                    line: parseInt(lineNum ?? "0", 10),
                    column: parseInt(col ?? "0", 10),
                    message: message ?? "",
                    ruleId: "tsc",
                    severity: "error",
                });
            }
        }
    }
    // Try ESLint if configured
    const lintPaths = paths?.length ? paths : ["src"];
    const eslintProc = (0, child_process_1.spawnSync)("npx", ["eslint", ...lintPaths, "--format", "json"], {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 4 * 1024 * 1024,
    });
    // eslint exits 1 on findings, 2 on fatal
    if (eslintProc.stdout) {
        try {
            const out = JSON.parse(eslintProc.stdout);
            const root = path.resolve(projectRoot);
            for (const file of out) {
                const rel = path.relative(root, path.isAbsolute(file.filePath) ? file.filePath : path.join(root, file.filePath)).replace(/\\/g, "/");
                for (const m of file.messages) {
                    errors.push({
                        filePath: rel,
                        line: m.line,
                        column: m.column,
                        message: m.message,
                        ruleId: m.ruleId ?? "unknown",
                        severity: m.severity === 2 ? "error" : "warning",
                    });
                }
            }
        }
        catch {
            // ESLint not configured or output not JSON
        }
    }
    return {
        passed: errors.filter((e) => e.severity === "error").length === 0,
        errors,
    };
}
