/**
 * get_ast — AGENT_ROADMAP v4 §10b
 * Extracts exports, imports, and fingerprint from a source file.
 */

import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { Project, SyntaxKind } from "ts-morph";
import { checkPathAllowed } from "./securityAllowlist";

export interface GetAstOutput {
  path: string;
  fingerprint: string;
  exports: {
    functions: Array<{ name: string; params: string; returnType?: string }>;
    classes: Array<{ name: string; extends?: string }>;
    interfaces: Array<{ name: string }>;
    constants: Array<{ name: string; value?: string }>;
  };
  imports: Array<{ specifier: string; default?: string; named?: string[] }>;
  topLevelDeclarations: string[];
}

export interface GetAstResult {
  success: boolean;
  output?: GetAstOutput;
  error?: string;
}

export function getAst(
  projectRoot: string,
  filePath: string
): GetAstResult {
  const allow = checkPathAllowed(filePath, { projectRoot });
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
    const project = new Project({ skipAddingFilesFromTsConfig: true });
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

    const topLevelDeclarations: string[] = [];
    for (const d of sourceFile.getStatements()) {
      const kind = d.getKindName();
      if (d.getKind() === SyntaxKind.FunctionDeclaration) {
        const fn = d.asKindOrThrow(SyntaxKind.FunctionDeclaration);
        topLevelDeclarations.push(`function ${fn.getName() ?? "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.ClassDeclaration) {
        const cls = d.asKindOrThrow(SyntaxKind.ClassDeclaration);
        topLevelDeclarations.push(`class ${cls.getName() ?? "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.InterfaceDeclaration) {
        const iface = d.asKindOrThrow(SyntaxKind.InterfaceDeclaration);
        topLevelDeclarations.push(`interface ${iface.getName() ?? "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.VariableStatement) {
        const vs = d.asKindOrThrow(SyntaxKind.VariableStatement);
        vs.getDeclarations().forEach((decl) => topLevelDeclarations.push(`const/let ${decl.getName()}`));
      } else {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
