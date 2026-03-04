"use strict";
/**
 * run_playwright_trace — AGENT_ROADMAP v4 §10c
 * Runs Playwright specs, returns PlaywrightOutput (path-referenced screenshots).
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
exports.runPlaywrightTrace = runPlaywrightTrace;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const STAGING_TRACES = ".arch-agent-staging/traces";
function collectFailures(suites, tracesDir, traceId) {
    const failures = [];
    for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                for (const result of test.results ?? []) {
                    if (result.status === "failed") {
                        const screenPath = result.attachments?.find((a) => a.name === "screenshot")?.path ??
                            path.join(tracesDir, `${traceId}.png`);
                        failures.push({
                            testName: spec.title ?? test.title ?? "unknown",
                            error: result.error?.message ?? "Test failed",
                            screenshotPath: screenPath,
                            domSnapshot: "",
                            consoleErrors: [],
                            networkFailures: [],
                        });
                    }
                }
            }
        }
    }
    return failures;
}
function runPlaywrightTrace(projectRoot, specPath, url) {
    const tracesDir = path.join(projectRoot, STAGING_TRACES);
    if (!fs.existsSync(path.dirname(tracesDir))) {
        fs.mkdirSync(path.dirname(tracesDir), { recursive: true });
    }
    if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, { recursive: true });
    }
    const traceId = `pw_${Date.now()}`;
    const tracePath = path.join(tracesDir, `${traceId}.zip`);
    const jsonOut = path.join(tracesDir, `${traceId}-results.json`);
    const args = ["playwright", "test", specPath, "--reporter=json"];
    const proc = (0, child_process_1.spawnSync)("npx", args, {
        cwd: projectRoot,
        encoding: "utf-8",
        env: {
            ...process.env,
            APP_URL: url,
            PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut,
        },
        maxBuffer: 10 * 1024 * 1024,
    });
    const failures = [];
    let passed = proc.status === 0;
    try {
        const raw = fs.existsSync(jsonOut) ? fs.readFileSync(jsonOut, "utf-8") : "{}";
        const parsed = JSON.parse(raw);
        const suites = parsed?.suites ?? [];
        const collected = collectFailures(suites ?? [], tracesDir, traceId);
        if (collected.length > 0) {
            passed = false;
            failures.push(...collected);
        }
        try {
            fs.unlinkSync(jsonOut);
        }
        catch {
            /* ignore */
        }
    }
    catch {
        if (proc.status !== 0) {
            passed = false;
            failures.push({
                testName: path.basename(specPath),
                error: (proc.stderr ?? proc.stdout ?? "Playwright failed").slice(0, 500),
                screenshotPath: path.join(tracesDir, `${traceId}.png`),
                domSnapshot: "",
                consoleErrors: [],
                networkFailures: [],
            });
        }
    }
    return {
        passed,
        spec: specPath,
        failures,
        tracePath,
    };
}
