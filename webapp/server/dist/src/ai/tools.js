"use strict";
/**
 * tools.ts
 *
 * Tool execution for the ReAct agent loop.
 * readFile and grep enable iterative retrieval and call-chain tracing.
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
exports.executeReadFile = executeReadFile;
exports.executeGrep = executeGrep;
exports.executeRunCommand = executeRunCommand;
exports.executeRunSkill = executeRunSkill;
exports.executeScaffoldNode = executeScaffoldNode;
exports.executeTelemetryTail = executeTelemetryTail;
exports.executeJiraCreateTicket = executeJiraCreateTicket;
exports.executeJiraSearchByArchNodeId = executeJiraSearchByArchNodeId;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const skillStore_1 = require("../agent/skillStore");
const telemetry_1 = require("../agent/rail/telemetry");
const client_1 = require("../jira/client");
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".mjs", ".cjs"]);
const READ_FILE_MAX_CHARS = 3000;
const GREP_MAX_RESULTS = 20;
function walkFiles(root, maxFiles = 2000) {
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
            else if (ALLOWED_EXTENSIONS.has(path.extname(e.name))) {
                out.push(full);
                if (out.length >= maxFiles)
                    return out;
            }
        }
    }
    return out;
}
function isUnderRoot(rootPath, absPath) {
    const rel = path.relative(rootPath, absPath);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}
function executeReadFile(rootPath, filePath) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    const root = path.resolve(rootPath);
    if (!isUnderRoot(root, path.resolve(absPath))) {
        return { error: "Path outside project root" };
    }
    try {
        if (!fs.existsSync(absPath)) {
            return { error: `File not found: ${filePath}` };
        }
        const content = fs.readFileSync(absPath, "utf-8");
        const truncated = content.length > READ_FILE_MAX_CHARS;
        const result = truncated ? content.slice(0, READ_FILE_MAX_CHARS) + "\n\n// ... truncated" : content;
        return { result: `--- ${path.relative(rootPath, absPath).replace(/\\/g, "/")} ---\n${result}` };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
function executeGrep(rootPath, pattern) {
    try {
        const files = walkFiles(rootPath);
        const results = [];
        const relRoot = path.resolve(rootPath);
        for (const file of files) {
            if (results.length >= GREP_MAX_RESULTS)
                break;
            let content;
            try {
                content = fs.readFileSync(file, "utf-8");
            }
            catch {
                continue;
            }
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < GREP_MAX_RESULTS; i++) {
                if (lines[i].includes(pattern)) {
                    const relPath = path.relative(relRoot, file).replace(/\\/g, "/");
                    results.push({ file: relPath, line: i + 1, text: lines[i].trim() });
                }
            }
        }
        return { results };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
/** Allowed command prefixes for runCommand (exact prefix match). */
const RUN_COMMAND_ALLOWLIST = [
    "npx tsc ",
    "npx tsc --noEmit",
    "npx eslint ",
    "npm run ",
    "npm test",
    "npm run test",
    "npx vitest run",
    "npx jest ",
];
/** Shell metacharacters that allow command chaining/injection (&&, |, ;, `, $(, etc.). */
const SHELL_META = /[&|;`$\\]/;
const RUN_STDOUT_MAX = 2000;
const RUN_STDERR_MAX = 500;
function executeRunCommand(rootPath, command) {
    const trimmed = command.trim();
    const allowed = RUN_COMMAND_ALLOWLIST.some((prefix) => trimmed === prefix || trimmed.startsWith(prefix));
    if (!allowed) {
        return { error: "Command not allowed. Use: npx tsc --noEmit, npx eslint, npm test, etc." };
    }
    if (SHELL_META.test(trimmed)) {
        return { error: "Command contains disallowed characters. No &&, |, ;, or shell metacharacters." };
    }
    try {
        const result = (0, child_process_1.spawnSync)(trimmed, {
            shell: true,
            cwd: rootPath,
            encoding: "utf-8",
            timeout: 60000,
        });
        const exitCode = result.status ?? -1;
        const stdout = (result.stdout ?? "").slice(0, RUN_STDOUT_MAX);
        const stderr = (result.stderr ?? "").slice(0, RUN_STDERR_MAX);
        const parts = [
            `exitCode: ${exitCode}`,
            stdout && `stdout:\n${stdout}`,
            stderr && `stderr:\n${stderr}`,
        ].filter(Boolean);
        return { result: parts.join("\n\n") || "Command completed.", exitCode };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
function executeRunSkill(rootPath, skillId, args) {
    const index = (0, skillStore_1.loadSkillIndex)(rootPath);
    const meta = index.skills.find((s) => s.id === skillId);
    if (!meta || !meta.path) {
        return { error: `Skill not found in index: ${skillId}` };
    }
    const skillsRoot = path.join(rootPath);
    const relPath = meta.path;
    const absPath = path.isAbsolute(relPath)
        ? relPath
        : path.join(skillsRoot, relPath);
    if (!fs.existsSync(absPath)) {
        return { error: `Skill file not found on disk: ${absPath}` };
    }
    const ext = path.extname(absPath);
    if (args != null && args !== "" && SHELL_META.test(args)) {
        return { error: "Args contain disallowed characters. No shell metacharacters." };
    }
    const argParts = (args ?? "")
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0);
    let execPath;
    const execArgs = [];
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
        execPath = "node";
        execArgs.push(absPath, ...argParts);
    }
    else if (ext === ".ts" || ext === ".tsx") {
        execPath = "npx";
        execArgs.push("tsx", absPath, ...argParts);
    }
    else if (ext === ".py") {
        execPath = "python3";
        execArgs.push(absPath, ...argParts);
    }
    else if (ext === ".sh") {
        execPath = "bash";
        execArgs.push(absPath, ...argParts);
    }
    else {
        return { error: `Unsupported skill language for path: ${absPath}` };
    }
    try {
        const result = (0, child_process_1.spawnSync)(execPath, execArgs, {
            cwd: rootPath,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
        });
        const exitCode = result.status ?? -1;
        const stdout = result.stdout ?? "";
        const stderr = result.stderr ?? "";
        const outputParts = [
            `exitCode: ${exitCode}`,
            stdout && `stdout:\n${stdout}`,
            stderr && `stderr:\n${stderr}`,
        ].filter(Boolean);
        const success = exitCode === 0;
        // Persist per-skill usage into both the skill index and the rail telemetry
        // so that plan_node can prefer higher-approval skills over time.
        (0, skillStore_1.incrementUsage)(rootPath, skillId, success);
        (0, telemetry_1.recordSkillUsage)(skillId, success);
        (0, telemetry_1.saveSkillPerformance)(rootPath);
        return { result: outputParts.join("\n\n") || "Skill completed with no output." };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
function executeScaffoldNode(rootPath, params) {
    try {
        const root = path.resolve(rootPath);
        const absPath = path.resolve(root, params.relPath);
        if (!isUnderRoot(root, absPath)) {
            return { error: "Path outside project root" };
        }
        // Decide whether relPath is a file or a directory based on extension.
        const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(params.relPath);
        const targetDir = pathLooksLikeFile ? path.dirname(absPath) : absPath;
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        const indexPath = pathLooksLikeFile
            ? absPath
            : path.join(absPath, "index.ts");
        const header = `// @archNodeId: ${params.archNodeId}`;
        const boilerplate = `\n\n// TODO: Implement ${params.kind ?? "module"} for layer ${params.layer ?? "Uncategorized"}.\n\nexport function TODO_${params.archNodeId.replace(/[^a-zA-Z0-9_]/g, "_")}() {\n  // implementation pending\n}\n`;
        if (fs.existsSync(indexPath)) {
            const existing = fs.readFileSync(indexPath, "utf-8");
            if (!existing.includes("@archNodeId:")) {
                fs.writeFileSync(indexPath, `${header}\n${existing}`, "utf-8");
            }
        }
        else {
            fs.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
        }
        const rel = path.relative(rootPath, indexPath).replace(/\\/g, "/");
        return { result: `Scaffolded node at ${rel}` };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
function executeTelemetryTail(rootPath, params) {
    const logPath = process.env.ARCHY_LOG_PATH?.trim() ||
        path.join(rootPath, "logs", "app.log");
    if (!fs.existsSync(logPath)) {
        return {
            error: "Telemetry log file not found. Set ARCHY_LOG_PATH or write logs to logs/app.log.",
        };
    }
    try {
        const raw = fs.readFileSync(logPath, "utf-8");
        const lines = raw.split(/\r?\n/);
        const wantId = params.requestId?.trim();
        const wantRoute = params.route?.trim();
        const matches = lines.filter((line) => {
            if (!line)
                return false;
            let ok = true;
            if (wantId)
                ok = ok && line.includes(wantId);
            if (wantRoute)
                ok = ok && line.includes(wantRoute);
            return ok;
        });
        if (matches.length === 0) {
            return {
                result: "No matching telemetry entries found. Check ARCHY_LOG_PATH, requestId, and route.",
            };
        }
        const tail = matches.slice(-80).join("\n");
        return {
            result: `Telemetry matches from ${path.relative(rootPath, logPath)}:\n${tail}`,
        };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
async function executeJiraCreateTicket(rootPath, input, overrides) {
    const config = overrides?.config ?? (0, client_1.getJiraConfig)();
    if (!config) {
        return {
            error: "Jira not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in environment.",
        };
    }
    const projectKey = (input.projectKey?.trim() || overrides?.projectKey || "").trim();
    if (!projectKey) {
        return {
            error: "projectKey is required. Provide it in the tool input or via workspace Jira project key.",
        };
    }
    try {
        const baseLabels = input.labels ?? [];
        const repoLabel = (() => {
            try {
                const git = (0, child_process_1.spawnSync)("git", ["rev-parse", "--show-toplevel"], {
                    cwd: rootPath,
                    encoding: "utf-8",
                    timeout: 2000,
                });
                const top = git.stdout?.trim();
                return top ? path.basename(top) : undefined;
            }
            catch {
                return undefined;
            }
        })();
        const labels = [...baseLabels];
        if (repoLabel)
            labels.push(repoLabel);
        if (input.archNodeId)
            labels.push(`archNodeId:${input.archNodeId}`);
        const res = await (0, client_1.createIssue)(config, {
            projectKey,
            summary: input.summary,
            description: input.description,
            labels,
        });
        return {
            result: `Created Jira issue ${res.key} in project ${projectKey}`,
        };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
/** Safe charset for archNodeId in JQL — alphanumeric, dash, underscore, slash, dot. */
const ARCH_NODE_ID_SAFE = /^[a-zA-Z0-9_\-.\/]+$/;
async function executeJiraSearchByArchNodeId(_rootPath, archNodeId, maxResults = 10, overrides) {
    const config = overrides?.config ?? (0, client_1.getJiraConfig)();
    if (!config) {
        return {
            error: "Jira not configured. Connect Jira in the web app or set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in environment.",
        };
    }
    if (!ARCH_NODE_ID_SAFE.test(archNodeId)) {
        return {
            error: "archNodeId contains invalid characters. Use only letters, numbers, dash, underscore, slash, dot.",
        };
    }
    const projectKey = (overrides?.projectKey ?? "").trim();
    const label = `archNodeId:${archNodeId}`;
    const jqlBase = projectKey
        ? `project = ${projectKey} AND labels = '${label.replace(/'/g, "''")}'`
        : `labels = '${label.replace(/'/g, "''")}'`;
    const jql = `${jqlBase} ORDER BY updated DESC`;
    try {
        const issues = await (0, client_1.searchIssues)(config, jql, maxResults);
        if (issues.length === 0) {
            return { result: `No Jira issues found for ${label}.` };
        }
        const lines = issues.map((i) => `${i.key} [${i.status}] ${i.type}${i.priority ? ` (${i.priority})` : ""} - ${i.summary}`);
        return { result: lines.join("\n") };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
