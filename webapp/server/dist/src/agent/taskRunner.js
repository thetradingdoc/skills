"use strict";
/**
 * Task runner — Execution Plan Phases 0–3
 * Takes approved plan, runs tasks: read_file → LLM → write_file → staging.
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
exports.runTaskAtIndex = runTaskAtIndex;
exports.runFirstTask = runFirstTask;
exports.runNextTask = runNextTask;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const toolExecutor_1 = require("./toolExecutor");
const llmClient_1 = require("./llmClient");
const traceLogger_1 = require("./traceLogger");
const ENTRY_CANDIDATES = ["index.ts", "index.tsx", "index.js", "index.jsx"];
function resolveModuleToFilePath(modulePath, rootPath) {
    const attempted = [];
    const fullDir = path.resolve(rootPath, modulePath);
    const dirExists = fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory();
    if (dirExists) {
        for (const entry of ENTRY_CANDIDATES) {
            const candidate = path.join(fullDir, entry);
            attempted.push(path.relative(rootPath, candidate).replace(/\\/g, "/"));
            if (fs.existsSync(candidate)) {
                return { path: attempted[attempted.length - 1] };
            }
        }
    }
    for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        const candidate = `${modulePath}${ext}`;
        const full = path.resolve(rootPath, candidate);
        attempted.push(path.relative(rootPath, full).replace(/\\/g, "/"));
        if (fs.existsSync(full)) {
            return { path: attempted[attempted.length - 1] };
        }
    }
    return { error: `Could not resolve module "${modulePath}" to a file`, attempted };
}
async function runTaskAtIndex(plan, taskIndex, rootPath, opts) {
    const task = plan.tasks[taskIndex];
    if (!task) {
        return {
            taskId: "",
            toolResult: {},
            traceId: (0, traceLogger_1.getSessionId)(),
            error: "No task at index",
        };
    }
    const isCreate = task.action === "create";
    let filePath;
    let existingContent;
    if (!isCreate) {
        const resolved = resolveModuleToFilePath(task.module, rootPath);
        if ("error" in resolved) {
            return {
                taskId: task.id,
                toolResult: { error: resolved.error, attempted: resolved.attempted },
                traceId: (0, traceLogger_1.getSessionId)(),
                error: `${resolved.error}. Tried: ${resolved.attempted.join(", ")}`,
            };
        }
        filePath = resolved.path;
        const readResult = await (0, toolExecutor_1.executeTool)("read_file", { path: filePath }, { rootPath });
        if (!readResult.success) {
            return {
                taskId: task.id,
                toolResult: { error: readResult.error, ...readResult.output },
                traceId: (0, traceLogger_1.getSessionId)(),
                error: readResult.error,
            };
        }
        existingContent = readResult.output.content;
    }
    if (opts?.skipLLM || !opts?.apiKey) {
        return {
            taskId: task.id,
            toolResult: existingContent ? { content: existingContent } : {},
            traceId: (0, traceLogger_1.getSessionId)(),
        };
    }
    let hasStaging = false;
    let lastToolResult = {};
    let readHops = 0;
    const MAX_READ_HOPS = 4;
    const MAX_ITER = 20;
    let currentFilePath = filePath;
    let currentFileContent = existingContent;
    let currentError = opts?.errorOutput;
    for (let iter = 0; iter < MAX_ITER; iter++) {
        const llmResult = await (0, llmClient_1.callLLM)({
            role: "code_writer",
            goal: plan.goal,
            plan,
            taskId: task.id,
            taskModule: task.module,
            conversationTurns: opts?.conversationTurns,
            fileContent: currentFileContent,
            filePath: currentFilePath,
            errorOutput: currentError,
            projectRoot: rootPath,
            apiKey: opts.apiKey,
        });
        if (llmResult.type === "no_api_key") {
            return {
                taskId: task.id,
                toolResult: lastToolResult,
                traceId: (0, traceLogger_1.getSessionId)(),
                error: llmResult.error,
                hasStaging,
            };
        }
        if (llmResult.type === "tool_call" && llmResult.tool === "write_file") {
            const writeResult = await (0, toolExecutor_1.executeTool)("write_file", llmResult.input, { rootPath });
            if (!writeResult.success) {
                return {
                    taskId: task.id,
                    toolResult: { error: writeResult.error },
                    traceId: (0, traceLogger_1.getSessionId)(),
                    error: writeResult.error,
                    hasStaging,
                };
            }
            hasStaging = true;
            lastToolResult = writeResult.output;
            currentFilePath = undefined;
            currentFileContent = undefined;
            currentError = undefined;
            continue;
        }
        if (llmResult.type === "tool_call" && llmResult.tool === "read_file") {
            if (readHops >= MAX_READ_HOPS) {
                return {
                    taskId: task.id,
                    toolResult: lastToolResult,
                    traceId: (0, traceLogger_1.getSessionId)(),
                    error: `LLM exceeded ${MAX_READ_HOPS} read_file calls without writing`,
                    hasStaging,
                };
            }
            readHops++;
            const pathToRead = typeof llmResult.input.path === "string" ? llmResult.input.path : "";
            if (pathToRead) {
                const secondRead = await (0, toolExecutor_1.executeTool)("read_file", { path: pathToRead }, { rootPath });
                currentFilePath = pathToRead;
                currentFileContent = secondRead.success
                    ? secondRead.output.content
                    : `[Error reading ${pathToRead}: ${secondRead.error}]`;
                lastToolResult = secondRead.success ? secondRead.output : { error: secondRead.error };
            }
            continue;
        }
        if (llmResult.type === "end_turn") {
            lastToolResult = { note: llmResult.content };
            break;
        }
        lastToolResult = { raw: llmResult.raw };
        break;
    }
    return {
        taskId: task.id,
        toolResult: lastToolResult,
        traceId: (0, traceLogger_1.getSessionId)(),
        hasStaging,
    };
}
async function runFirstTask(plan, rootPath, opts) {
    return runTaskAtIndex(plan, 0, rootPath, opts);
}
async function runNextTask(plan, rootPath, currentTaskIndex, opts) {
    return runTaskAtIndex(plan, currentTaskIndex + 1, rootPath, opts);
}
