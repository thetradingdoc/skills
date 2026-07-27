#!/usr/bin/env npx tsx
/**
 * id-decorator skill
 *
 * Thin skill wrapper around the project-level `scripts/id-decorator.ts`.
 * 
 * Usage (from manager via run_skill):
 *   - tool: run_skill
 *   - skillId: "id-decorator"
 *   - args: "<repo-root> <graph.json>"
 *
 * The repo root should be the path that was scanned to produce graph.json.
 */

import path from "path";

async function main() {
  const [, , repoRootArg, graphPathArg] = process.argv;
  if (!repoRootArg || !graphPathArg) {
    console.error(
      "Usage: run_skill id-decorator \"<repo-root> <graph.json-from-scan-repo>\""
    );
    process.exit(1);
  }

  // Resolve paths relative to the workspace root. The skill lives in
  // <root>/.agent/skills, so ".." is the repo root.
  const skillsDir = process.cwd();
  const root = path.resolve(skillsDir, "..");

  // Allow absolute or relative arguments; keep behavior aligned with
  // scripts/id-decorator.ts.
  const repoRoot = path.isAbsolute(repoRootArg)
    ? repoRootArg
    : path.resolve(root, repoRootArg);
  const graphPath = path.isAbsolute(graphPathArg)
    ? graphPathArg
    : path.resolve(root, graphPathArg);

  // Defer to the existing script implementation for the actual work.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = await import(path.resolve(root, "scripts/id-decorator.ts"));
  if (typeof mod.default === "function") {
    await mod.default(repoRoot, graphPath);
  } else if (typeof (mod as any).main === "function") {
    await (mod as any).main(repoRoot, graphPath);
  } else {
    // Fall back to spawning the script via tsx if it does not expose an entry.
    const { spawnSync } = await import("child_process");
    const res = spawnSync(
      "npx",
      ["tsx", path.resolve(root, "scripts/id-decorator.ts"), repoRoot, graphPath],
      { cwd: root, stdio: "inherit" }
    );
    process.exit(res.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

