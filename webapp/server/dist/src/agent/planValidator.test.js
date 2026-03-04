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
const vitest_1 = require("vitest");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const planValidator_1 = require("./planValidator");
const tmpDir = path.join(os.tmpdir(), `arch-agent-test-${Date.now()}`);
function setupTmpProject() {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "services"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "auth"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "services", "index.ts"), "export {};\n");
    fs.writeFileSync(path.join(tmpDir, "src", "auth", "index.ts"), "export {};\n");
    return tmpDir;
}
(0, vitest_1.describe)("planValidator", () => {
    (0, vitest_1.it)("rejects invalid JSON", () => {
        const root = setupTmpProject();
        const r = (0, planValidator_1.validatePlan)("{ invalid", root);
        (0, vitest_1.expect)(r.valid).toBe(false);
        (0, vitest_1.expect)(r.error).toContain("JSON");
    });
    (0, vitest_1.it)("rejects schema with missing fields", () => {
        const root = setupTmpProject();
        const r = (0, planValidator_1.validatePlan)(JSON.stringify({ goal: "x" }), root);
        (0, vitest_1.expect)(r.valid).toBe(false);
        (0, vitest_1.expect)(r.error).toBeDefined();
    });
    (0, vitest_1.it)("accepts valid plan", () => {
        const root = setupTmpProject();
        const plan = {
            goal: "Add auth",
            tasks: [
                { id: "T1", module: "src/auth", layer: "Business Logic", action: "create", expectedOutput: "Auth module" },
                { id: "T2", module: "src/services", layer: "Business Logic", action: "modify", expectedOutput: "Uses auth" },
            ],
            dependencies: [["T1", "T2"]],
        };
        const r = (0, planValidator_1.validatePlan)(JSON.stringify(plan), root);
        (0, vitest_1.expect)(r.valid).toBe(true);
        (0, vitest_1.expect)(r.plan).toBeDefined();
    });
    (0, vitest_1.it)("detects circular dependencies", () => {
        const root = setupTmpProject();
        const plan = {
            goal: "x",
            tasks: [
                { id: "A", module: "src/auth", layer: "Business Logic", action: "create", expectedOutput: "x" },
                { id: "B", module: "src/services", layer: "Business Logic", action: "create", expectedOutput: "x" },
            ],
            dependencies: [
                ["A", "B"],
                ["B", "A"],
            ],
        };
        const r = (0, planValidator_1.validatePlan)(JSON.stringify(plan), root);
        (0, vitest_1.expect)(r.valid).toBe(false);
        (0, vitest_1.expect)(r.error).toContain("Circular");
    });
    (0, vitest_1.it)("detects file conflicts between tasks", () => {
        const root = setupTmpProject();
        const plan = {
            goal: "x",
            tasks: [
                { id: "T1", module: "src/services", layer: "Business Logic", action: "modify", expectedOutput: "x" },
                { id: "T2", module: "src/services/index.ts", layer: "Business Logic", action: "modify", expectedOutput: "x" },
            ],
            dependencies: [],
        };
        const r = (0, planValidator_1.validatePlan)(JSON.stringify(plan), root);
        (0, vitest_1.expect)(r.valid).toBe(false);
        (0, vitest_1.expect)(r.error).toContain("both touch");
    });
});
