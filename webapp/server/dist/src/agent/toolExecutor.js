"use strict";
/**
 * Tool executor — AGENT_ROADMAP v4, Execution Plan Phase 0
 * Executes tools, validates against security allowlist, emits trace entries.
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
exports.executeTool = executeTool;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const traceLogger_1 = require("./traceLogger");
const securityAllowlist_1 = require("./securityAllowlist");
const staging_1 = require("./staging");
const runLint_1 = require("./runLint");
const runVitest_1 = require("./runVitest");
const MAX_CONTENT_CHARS = 50000;
async function executeTool(tool, input, context) {
    const allowlist = context.allowlist ?? {
        projectRoot: context.rootPath,
        allowedPrefixes: ["src/", "docs/"],
    };
    if (tool === "read_file") {
        const filePath = typeof input.path === "string" ? input.path : "";
        if (!filePath) {
            const out = { success: false, output: {}, error: "read_file requires path" };
            (0, traceLogger_1.emitTrace)("read_file", input, out.output, "read_file failed: missing path");
            return out;
        }
        const check = (0, securityAllowlist_1.checkPathAllowed)(filePath, allowlist, "read");
        if (!check.allowed) {
            const out = { success: false, output: { reason: check.reason }, error: check.reason };
            (0, traceLogger_1.emitTrace)("read_file", input, out.output, `read_file rejected: ${check.reason}`);
            return out;
        }
        const fullPath = path.resolve(context.rootPath, filePath);
        if (!fs.existsSync(fullPath)) {
            const out = { success: false, output: { path: filePath }, error: "File not found" };
            (0, traceLogger_1.emitTrace)("read_file", input, out.output, "read_file failed: file not found");
            return out;
        }
        let content;
        try {
            content = fs.readFileSync(fullPath, "utf-8");
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const out = { success: false, output: { path: filePath }, error: msg };
            (0, traceLogger_1.emitTrace)("read_file", input, out.output, `read_file failed: ${msg}`);
            return out;
        }
        const truncated = content.length > MAX_CONTENT_CHARS;
        const output = {
            path: filePath,
            content: truncated ? content.slice(0, MAX_CONTENT_CHARS) + "\n...[truncated]" : content,
            truncated,
        };
        (0, traceLogger_1.emitTrace)("read_file", input, output, truncated ? "read_file ok (truncated)" : "read_file ok");
        return { success: true, output };
    }
    if (tool === "write_file") {
        const filePath = typeof input.path === "string" ? input.path : "";
        const content = typeof input.content === "string" ? input.content : "";
        if (!filePath || !content) {
            const out = { success: false, output: {}, error: "write_file requires path and content" };
            (0, traceLogger_1.emitTrace)("write_file", { path: filePath }, out.output, "write_file failed: missing path or content");
            return out;
        }
        const check = (0, securityAllowlist_1.checkPathAllowed)(filePath, allowlist, "write");
        if (!check.allowed) {
            const out = { success: false, output: { reason: check.reason }, error: check.reason };
            (0, traceLogger_1.emitTrace)("write_file", input, out.output, `write_file rejected: ${check.reason}`);
            return out;
        }
        const fullPath = path.resolve(context.rootPath, filePath);
        let beforeContent;
        if (fs.existsSync(fullPath)) {
            beforeContent = fs.readFileSync(fullPath, "utf-8");
        }
        const stagingId = (0, staging_1.writeToStaging)(filePath, content, { beforeContent });
        const output = { stagingId, path: filePath };
        (0, traceLogger_1.emitTrace)("write_file", { path: filePath }, output, "write_file ok (staged)");
        return { success: true, output };
    }
    if (tool === "run_lint") {
        const paths = Array.isArray(input.paths) ? input.paths : undefined;
        const lintResult = (0, runLint_1.runLint)(context.rootPath, paths);
        const output = {
            passed: lintResult.passed,
            errors: lintResult.errors,
        };
        (0, traceLogger_1.emitTrace)("run_lint", input, output, lintResult.passed ? "run_lint pass" : "run_lint fail");
        return { success: lintResult.passed, output };
    }
    if (tool === "run_vitest") {
        const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
        const vitestResult = (0, runVitest_1.runVitest)(context.rootPath, pattern);
        const output = {
            passed: vitestResult.passed,
            summary: vitestResult.summary,
            failures: vitestResult.failures,
        };
        (0, traceLogger_1.emitTrace)("run_vitest", input, output, vitestResult.passed ? "run_vitest pass" : "run_vitest fail");
        return { success: vitestResult.passed, output };
    }
    // All other tools: not implemented
    const out = {
        success: false,
        output: {},
        error: `Tool "${tool}" not implemented`,
    };
    (0, traceLogger_1.emitTrace)("error", { tool, input }, {}, `executeTool: ${tool} not implemented`);
    return out;
}
