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
exports.readContextFile = readContextFile;
exports.writeContextFile = writeContextFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function readContextFile(modulePath) {
    const contextPath = path.join(modulePath, ".context.md");
    if (!fs.existsSync(contextPath))
        return null;
    const raw = fs.readFileSync(contextPath, "utf-8");
    const context = { modulePath, rawContent: raw };
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
        const fm = frontmatterMatch[1];
        const roleMatch = fm.match(/role:\s*(.+)/);
        if (roleMatch)
            context.role = roleMatch[1].trim();
        const layerMatch = fm.match(/layer:\s*(.+)/);
        if (layerMatch)
            context.layer = layerMatch[1].trim();
        const descMatch = fm.match(/description:\s*(.+)/);
        if (descMatch)
            context.description = descMatch[1].trim();
        const depsMatch = fm.match(/must-not-depend-on:\s*\[([^\]]+)\]/);
        if (depsMatch) {
            context.mustNotDependOn = depsMatch[1]
                .split(",")
                .map((s) => s.trim().replace(/['"]/g, ""));
        }
        const deprecatedMatch = fm.match(/deprecated:\s*(true|false)/);
        if (deprecatedMatch)
            context.isDeprecated = deprecatedMatch[1] === "true";
    }
    return context;
}
function writeContextFile(input) {
    const contextPath = path.join(input.modulePath, ".context.md");
    const existing = readContextFile(input.modulePath);
    const role = input.role ?? existing?.role ?? "";
    const layer = input.layer ?? existing?.layer ?? "";
    const description = input.description ?? existing?.description ?? "";
    const lines = ["---"];
    if (role)
        lines.push(`role: ${role}`);
    if (layer)
        lines.push(`layer: ${layer}`);
    if (description)
        lines.push(`description: ${description}`);
    if (existing?.mustNotDependOn?.length) {
        lines.push(`must-not-depend-on: [${existing.mustNotDependOn.join(", ")}]`);
    }
    if (existing?.isDeprecated !== undefined) {
        lines.push(`deprecated: ${existing.isDeprecated}`);
    }
    lines.push("---");
    lines.push("");
    fs.mkdirSync(input.modulePath, { recursive: true });
    fs.writeFileSync(contextPath, lines.join("\n"), "utf-8");
}
