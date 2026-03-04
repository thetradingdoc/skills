"use strict";
/**
 * Durable staging buffer — AGENT_ROADMAP v4 §5c, §6
 * write_file → .arch-agent-staging/, commit_file applies after approval.
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
exports.initStaging = initStaging;
exports.writeToStaging = writeToStaging;
exports.getStagingEntries = getStagingEntries;
exports.getStagingById = getStagingById;
exports.commitStaging = commitStaging;
exports.rejectStaging = rejectStaging;
exports.clearStaging = clearStaging;
exports.getStagingDir = getStagingDir;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function isPathUnderRoot(projectRoot, filePath) {
    const root = path.resolve(projectRoot);
    const resolved = path.resolve(root, filePath);
    const relative = path.relative(root, resolved).replace(/\\/g, "/");
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}
const sessionTouchedPaths_1 = require("./sessionTouchedPaths");
const STAGING_DIR = ".arch-agent-staging";
const BUFFER_FILE = "buffer.json";
let stagingDir = "";
const buffer = new Map();
function initStaging(projectRoot) {
    stagingDir = path.join(projectRoot, STAGING_DIR);
    if (!fs.existsSync(stagingDir)) {
        fs.mkdirSync(stagingDir, { recursive: true });
    }
    loadBuffer();
}
function bufferPath() {
    return path.join(stagingDir, BUFFER_FILE);
}
function loadBuffer() {
    buffer.clear();
    const p = bufferPath();
    if (fs.existsSync(p)) {
        try {
            const raw = fs.readFileSync(p, "utf-8");
            const arr = JSON.parse(raw);
            for (const e of arr)
                buffer.set(e.path, e);
        }
        catch {
            buffer.clear();
        }
    }
}
function saveBuffer() {
    const p = bufferPath();
    const arr = Array.from(buffer.values());
    fs.writeFileSync(p, JSON.stringify(arr, null, 2), "utf-8");
}
function writeToStaging(filePath, content, opts) {
    const id = `stg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    buffer.set(filePath, {
        path: filePath,
        content,
        beforeContent: opts?.beforeContent,
        taskId: opts?.taskId,
    });
    saveBuffer();
    return id;
}
function getStagingEntries() {
    return Array.from(buffer.values());
}
function getStagingById(id) {
    for (const e of buffer.values()) {
        if (id.startsWith("stg_"))
            return e;
    }
    return buffer.values().next().value ?? null;
}
function commitStaging(pathsToCommit, projectRoot) {
    const root = path.resolve(projectRoot);
    for (const p of pathsToCommit) {
        if (!isPathUnderRoot(projectRoot, p)) {
            return { success: false, error: `Path outside project root: ${p}` };
        }
        const e = buffer.get(p);
        if (!e)
            continue;
        const fullPath = path.join(root, p);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, e.content, "utf-8");
        buffer.delete(p);
    }
    saveBuffer();
    (0, sessionTouchedPaths_1.addTouchedPaths)(pathsToCommit);
    return { success: true };
}
function rejectStaging(pathsToReject) {
    for (const p of pathsToReject)
        buffer.delete(p);
    saveBuffer();
}
function clearStaging() {
    buffer.clear();
    if (stagingDir && fs.existsSync(bufferPath())) {
        fs.writeFileSync(bufferPath(), "[]", "utf-8");
    }
}
function getStagingDir() {
    return stagingDir;
}
