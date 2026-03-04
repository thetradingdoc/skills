import * as fs from "fs";
import * as path from "path";

export interface ModuleContext {
  modulePath: string;
  role?: string;
  layer?: string;
  description?: string;
  mustNotDependOn?: string[];
  isDeprecated?: boolean;
  rawContent: string;
}

export function readContextFile(modulePath: string): ModuleContext | null {
  const contextPath = path.join(modulePath, ".context.md");
  if (!fs.existsSync(contextPath)) return null;

  const raw = fs.readFileSync(contextPath, "utf-8");
  const context: ModuleContext = { modulePath, rawContent: raw };

  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const roleMatch = fm.match(/role:\s*(.+)/);
    if (roleMatch) context.role = roleMatch[1].trim();

    const layerMatch = fm.match(/layer:\s*(.+)/);
    if (layerMatch) context.layer = layerMatch[1].trim();

    const descMatch = fm.match(/description:\s*(.+)/);
    if (descMatch) context.description = descMatch[1].trim();

    const depsMatch = fm.match(/must-not-depend-on:\s*\[([^\]]+)\]/);
    if (depsMatch) {
      context.mustNotDependOn = depsMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/['"]/g, ""));
    }

    const deprecatedMatch = fm.match(/deprecated:\s*(true|false)/);
    if (deprecatedMatch) context.isDeprecated = deprecatedMatch[1] === "true";
  }

  return context;
}

export interface WriteContextInput {
  modulePath: string;
  layer?: string;
  description?: string;
  role?: string;
}

export function writeContextFile(input: WriteContextInput): void {
  const contextPath = path.join(input.modulePath, ".context.md");
  const existing = readContextFile(input.modulePath);

  const role = input.role ?? existing?.role ?? "";
  const layer = input.layer ?? existing?.layer ?? "";
  const description = input.description ?? existing?.description ?? "";

  const lines: string[] = ["---"];
  if (role) lines.push(`role: ${role}`);
  if (layer) lines.push(`layer: ${layer}`);
  if (description) lines.push(`description: ${description}`);
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
