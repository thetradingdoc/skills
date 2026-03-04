"use strict";
/**
 * get_ast — AGENT_ROADMAP v4 §10b
 * Extracts exports, imports, and fingerprint from a source file.
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
exports.getAst = getAst;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const ts_morph_1 = require("ts-morph");
const securityAllowlist_1 = require("./securityAllowlist");
function getAst(projectRoot, filePath) {
    const allow = (0, securityAllowlist_1.checkPathAllowed)(filePath, { projectRoot });
    if (!allow.allowed) {
        return { success: false, error: allow.reason ?? "Path not allowed" };
    }
    const fullPath = path.resolve(projectRoot, filePath);
    if (!fs.existsSync(fullPath)) {
        return { success: false, error: "File not found" };
    }
    const ext = path.extname(fullPath);
    if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
        return { success: false, error: "Unsupported file type for AST extraction" };
    }
    try {
        const project = new ts_morph_1.Project({ skipAddingFilesFromTsConfig: true });
        const sourceFile = project.addSourceFileAtPath(fullPath);
        const exports = {
            functions: sourceFile.getFunctions().map((f) => ({
                name: f.getName() ?? "",
                params: f.getParameters().map((p) => `${p.getName()}: ${p.getType().getText()}`).join(", "),
                returnType: f.getReturnType().getText() || undefined,
            })),
            classes: sourceFile.getClasses().map((c) => ({
                name: c.getName() ?? "",
                extends: c.getExtends()?.getText(),
            })),
            interfaces: sourceFile.getInterfaces().map((i) => ({
                name: i.getName() ?? "",
            })),
            constants: sourceFile.getVariableStatements().map((v) => {
                const decl = v.getDeclarations()[0];
                return {
                    name: decl?.getName() ?? "",
                    value: decl?.getInitializer()?.getText()?.slice(0, 80),
                };
            }),
        };
        const imports = sourceFile.getImportDeclarations().map((imp) => {
            const def = imp.getDefaultImport();
            const named = imp.getNamedImports().map((n) => n.getName());
            return {
                specifier: imp.getModuleSpecifierValue(),
                default: def?.getText(),
                named: named.length > 0 ? named : undefined,
            };
        });
        const topLevelDeclarations = [];
        for (const d of sourceFile.getStatements()) {
            const kind = d.getKindName();
            if (d.getKind() === ts_morph_1.SyntaxKind.FunctionDeclaration) {
                const fn = d.asKindOrThrow(ts_morph_1.SyntaxKind.FunctionDeclaration);
                topLevelDeclarations.push(`function ${fn.getName() ?? "anonymous"}`);
            }
            else if (d.getKind() === ts_morph_1.SyntaxKind.ClassDeclaration) {
                const cls = d.asKindOrThrow(ts_morph_1.SyntaxKind.ClassDeclaration);
                topLevelDeclarations.push(`class ${cls.getName() ?? "anonymous"}`);
            }
            else if (d.getKind() === ts_morph_1.SyntaxKind.InterfaceDeclaration) {
                const iface = d.asKindOrThrow(ts_morph_1.SyntaxKind.InterfaceDeclaration);
                topLevelDeclarations.push(`interface ${iface.getName() ?? "anonymous"}`);
            }
            else if (d.getKind() === ts_morph_1.SyntaxKind.VariableStatement) {
                const vs = d.asKindOrThrow(ts_morph_1.SyntaxKind.VariableStatement);
                vs.getDeclarations().forEach((decl) => topLevelDeclarations.push(`const/let ${decl.getName()}`));
            }
            else {
                topLevelDeclarations.push(kind);
            }
        }
        const payload = JSON.stringify({ exports, imports, topLevelDeclarations });
        const fingerprint = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
        return {
            success: true,
            output: {
                path: filePath,
                fingerprint,
                exports,
                imports,
                topLevelDeclarations,
            },
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
    }
}
