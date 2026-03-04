"use strict";
/**
 * write_context_summary — AGENT_ROADMAP v4 §10e
 * Typed schema, validation, allowlist.
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
exports.validateContextSummaryBlock = validateContextSummaryBlock;
exports.writeContextSummary = writeContextSummary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const securityAllowlist_1 = require("./securityAllowlist");
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
function validateContextSummaryBlock(obj) {
    if (!obj || typeof obj !== "object") {
        return { valid: false, error: "Summary must be an object" };
    }
    const o = obj;
    if (typeof o.sessionDate !== "string" || !DATE_REGEX.test(o.sessionDate)) {
        return { valid: false, error: "sessionDate must be YYYY-MM-DD" };
    }
    if (!["create", "modify", "refactor"].includes(o.action)) {
        return { valid: false, error: "action must be create, modify, or refactor" };
    }
    if (typeof o.layer !== "string") {
        return { valid: false, error: "layer must be a string" };
    }
    if (!o.tests || typeof o.tests !== "object") {
        return { valid: false, error: "tests must be an object" };
    }
    const t = o.tests;
    if (t.vitest !== "pass" && t.vitest !== "fail") {
        return { valid: false, error: "tests.vitest must be pass or fail" };
    }
    if (t.playwright !== undefined && t.playwright !== "pass" && t.playwright !== "fail") {
        return { valid: false, error: "tests.playwright must be pass or fail" };
    }
    if (typeof o.fingerprint !== "string") {
        return { valid: false, error: "fingerprint must be a string" };
    }
    return { valid: true };
}
function writeContextSummary(projectRoot, modulePath, summary) {
    const fullPath = path.join(projectRoot, modulePath, ".context.md");
    const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
    const allowed = (0, securityAllowlist_1.checkPathAllowed)(relativePath, { projectRoot });
    if (!allowed.allowed) {
        return { success: false, error: allowed.reason };
    }
    const block = `\n## Agent Session ${summary.sessionDate}
- Action: ${summary.action}
- Layer: ${summary.layer}
- Tests: vitest ${summary.tests.vitest}${summary.tests.playwright ? `, playwright ${summary.tests.playwright}` : ""}
- Fingerprint: ${summary.fingerprint}
`;
    try {
        if (fs.existsSync(fullPath)) {
            fs.appendFileSync(fullPath, block, "utf-8");
        }
        else {
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, block.trimStart(), "utf-8");
        }
        return { success: true };
    }
    catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}
