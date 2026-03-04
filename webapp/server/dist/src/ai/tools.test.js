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
const tools_1 = require("./tools");
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/sample-project");
(0, vitest_1.describe)("tools", () => {
    (0, vitest_1.describe)("executeReadFile", () => {
        (0, vitest_1.it)("returns file content for existing file", () => {
            const res = (0, tools_1.executeReadFile)(FIXTURE_PATH, "src/auth/index.ts");
            (0, vitest_1.expect)(res.result).toBeDefined();
            (0, vitest_1.expect)(res.error).toBeUndefined();
            (0, vitest_1.expect)(res.result).toContain("---");
        });
        (0, vitest_1.it)("returns error for file not found", () => {
            const res = (0, tools_1.executeReadFile)(FIXTURE_PATH, "src/nonexistent.ts");
            (0, vitest_1.expect)(res.error).toBeDefined();
            (0, vitest_1.expect)(res.result).toBeUndefined();
        });
        (0, vitest_1.it)("rejects path outside project root", () => {
            const res = (0, tools_1.executeReadFile)(FIXTURE_PATH, "../../../etc/passwd");
            (0, vitest_1.expect)(res.error).toBe("Path outside project root");
        });
    });
    (0, vitest_1.describe)("executeGrep", () => {
        (0, vitest_1.it)("returns matching lines", () => {
            const res = (0, tools_1.executeGrep)(FIXTURE_PATH, "export");
            (0, vitest_1.expect)(res.results).toBeDefined();
            (0, vitest_1.expect)(Array.isArray(res.results)).toBe(true);
        });
    });
    (0, vitest_1.describe)("executeRunCommand", () => {
        (0, vitest_1.it)("rejects disallowed commands", () => {
            const res = (0, tools_1.executeRunCommand)(FIXTURE_PATH, "rm -rf /");
            (0, vitest_1.expect)(res.error).toBeDefined();
            (0, vitest_1.expect)(res.error).toContain("not allowed");
            (0, vitest_1.expect)(res.result).toBeUndefined();
        });
        (0, vitest_1.it)("returns result and exitCode for allowed command", () => {
            const res = (0, tools_1.executeRunCommand)(FIXTURE_PATH, "npx tsc --noEmit");
            (0, vitest_1.expect)(res.error).toBeUndefined();
            (0, vitest_1.expect)(res.result).toBeDefined();
            (0, vitest_1.expect)(res.result).toContain("exitCode:");
            (0, vitest_1.expect)(typeof res.exitCode).toBe("number");
        });
    });
});
