"use strict";
/**
 * run_vitest — AGENT_ROADMAP v4 §4c
 * Runs Vitest. Returns VitestOutput.
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
exports.runVitest = runVitest;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
function runVitest(projectRoot, pattern) {
    const jsonFile = path.join(projectRoot, ".arch-agent-staging", "vitest-results.json");
    const stagingDir = path.dirname(jsonFile);
    if (!fs.existsSync(stagingDir)) {
        fs.mkdirSync(stagingDir, { recursive: true });
    }
    const args = ["vitest", "run", "--reporter=json", `--outputFile.json=${jsonFile}`];
    if (pattern)
        args.push("--testNamePattern", pattern);
    const proc = (0, child_process_1.spawnSync)("npx", args, {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
    });
    const failures = [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    try {
        const raw = fs.existsSync(jsonFile) ? fs.readFileSync(jsonFile, "utf-8") : "{}";
        const parsed = JSON.parse(raw);
        const results = parsed?.testResults ?? parsed?.results;
        if (Array.isArray(results)) {
            for (const file of results) {
                const filePath = path.relative(projectRoot, file.name);
                for (const t of file.assertionResults ?? []) {
                    total++;
                    if (t.status === "passed")
                        passed++;
                    else if (t.status === "skipped")
                        skipped++;
                    else {
                        failed++;
                        failures.push({
                            testName: t.fullName,
                            filePath,
                            error: t.failureMessages?.[0] ?? "Test failed",
                            stackTrace: t.failureMessages?.join("\n") ?? "",
                        });
                    }
                }
            }
        }
        try {
            fs.unlinkSync(jsonFile);
        }
        catch {
            /* ignore */
        }
    }
    catch {
        if (proc.status !== 0) {
            failures.push({
                testName: pattern ?? "vitest run",
                filePath: ".",
                error: (proc.stderr ?? proc.stdout ?? "Vitest failed").slice(0, 500),
                stackTrace: "",
            });
            failed = 1;
            total = 1;
        }
    }
    return {
        passed: failed === 0,
        summary: { total, passed, failed, skipped },
        failures,
    };
}
