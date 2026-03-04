import * as fs from "fs";
import * as path from "path";

export interface ArchRule {
  id: string;
  description: string;
  sourcePattern: string;
  mustNotImportPattern: string;
  severity: "error" | "warning";
}

export interface ArchRulesConfig {
  rules: ArchRule[];
}

export function writeArchRules(rootPath: string, config: ArchRulesConfig): void {
  const configPath = path.join(rootPath, ".arch-rules.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function readArchRules(rootPath: string): ArchRule[] {
  const configPath = path.join(rootPath, ".arch-rules.json");
  if (!fs.existsSync(configPath)) return [];

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const config: ArchRulesConfig = JSON.parse(raw);
    return config.rules ?? [];
  } catch {
    return [];
  }
}
