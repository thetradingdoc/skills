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
const getAst_1 = require("./getAst");
const path = __importStar(require("path"));
(0, vitest_1.describe)("getAst", () => {
    const root = path.resolve(__dirname, "../../");
    (0, vitest_1.it)("extracts AST from a TS file", () => {
        const result = (0, getAst_1.getAst)(root, "src/agent/planValidator.ts");
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.output?.path).toBe("src/agent/planValidator.ts");
        (0, vitest_1.expect)(result.output?.fingerprint).toMatch(/^[a-f0-9]+$/);
        (0, vitest_1.expect)(result.output?.exports).toBeDefined();
        (0, vitest_1.expect)(result.output?.imports).toBeDefined();
        (0, vitest_1.expect)(result.output?.topLevelDeclarations).toBeDefined();
    });
    (0, vitest_1.it)("rejects path outside allowlist", () => {
        const result = (0, getAst_1.getAst)(root, ".env");
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toBeDefined();
    });
    (0, vitest_1.it)("rejects non-existent file", () => {
        const result = (0, getAst_1.getAst)(root, "src/nonexistent.ts");
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toContain("not found");
    });
});
