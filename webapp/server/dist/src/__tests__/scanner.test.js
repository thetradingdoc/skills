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
const scanner_1 = require("../analyzer/scanner");
const driftDetector_1 = require("../analyzer/driftDetector");
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/sample-project");
(0, vitest_1.describe)("scanner", () => {
    (0, vitest_1.it)("scans fixture project and produces graph", async () => {
        const graph = await (0, scanner_1.scanProject)(FIXTURE_PATH);
        (0, vitest_1.expect)(graph.nodes.length).toBeGreaterThanOrEqual(5);
        (0, vitest_1.expect)(graph.edges.length).toBeGreaterThanOrEqual(4);
        (0, vitest_1.expect)(graph.projectRoot).toBe(FIXTURE_PATH);
    });
    (0, vitest_1.it)("resolves path aliases (@/, #lib/, ~/utils/)", async () => {
        const graph = await (0, scanner_1.scanProject)(FIXTURE_PATH);
        const nodeIds = graph.nodes.map((n) => n.id);
        (0, vitest_1.expect)(nodeIds).toContain("src/auth");
        (0, vitest_1.expect)(nodeIds).toContain("src/shared");
        (0, vitest_1.expect)(nodeIds).toContain("lib");
        const hasAliasEdge = graph.edges.some((e) => e.source === "src/auth" && e.target === "src/shared") ||
            graph.edges.some((e) => e.source === "src/api" && e.target === "lib");
        (0, vitest_1.expect)(hasAliasEdge).toBe(true);
    });
});
(0, vitest_1.describe)("driftDetector", () => {
    (0, vitest_1.it)("marks auth->api edge as drift", async () => {
        let graph = await (0, scanner_1.scanProject)(FIXTURE_PATH);
        // Auth imports api via session.ts -> ../../api/client
        const authToApiEdge = graph.edges.find((e) => e.source === "src/auth" && e.target === "src/api");
        (0, vitest_1.expect)(authToApiEdge).toBeDefined();
        graph = (0, driftDetector_1.detectDrift)(graph);
        const driftEdges = graph.edges.filter((e) => e.isDrift);
        const authToApi = driftEdges.find((e) => e.source === "src/auth" && e.target === "src/api");
        (0, vitest_1.expect)(authToApi).toBeDefined();
        (0, vitest_1.expect)(authToApi?.driftReason).toBeDefined();
    });
    (0, vitest_1.it)("marks src/scripts as deprecated", async () => {
        let graph = await (0, scanner_1.scanProject)(FIXTURE_PATH);
        graph = (0, driftDetector_1.detectDrift)(graph);
        const scripts = graph.nodes.find((n) => n.id === "src/scripts");
        (0, vitest_1.expect)(scripts?.status).toBe("deprecated");
    });
});
