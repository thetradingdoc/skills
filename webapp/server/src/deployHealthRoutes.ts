/**
 * Post-V1 — deploy/CI/env health routes.
 * Read-only compute endpoint: takes the client's current graph nodes (design
 * or scan), optionally runs the live env scanner against a project root, and
 * returns per-node deployHealth plus a hotspot list.
 */
import { Router } from "express";
import fs from "fs";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { buildDeployHealth, type CiStatus, type DeployHealthNode, type EnvGap } from "./deployHealth.js";

const router = Router();

type ScannerFinding = {
  type: string;
  description: string;
  location: string;
  evidence?: string[];
};

/** Map envScanner's missing_env_var findings to the { varName, files } shape buildDeployHealth expects. */
function findingsToEnvGaps(findings: ScannerFinding[]): EnvGap[] {
  const gaps: EnvGap[] = [];
  for (const f of findings) {
    if (f.type !== "missing_env_var") continue;
    const m = /Environment variable (\S+) is used/.exec(f.description);
    const varName = m?.[1];
    if (!varName) continue;
    const evidenceLine = (f.evidence ?? []).find((e) => e.startsWith("Used in:"));
    const files = evidenceLine
      ? evidenceLine
          .replace(/^Used in:\s*/, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : f.location
        ? [f.location]
        : [];
    gaps.push({ varName, files });
  }
  return gaps;
}

router.post(
  "/workspaces/:workspaceId/deploy-health",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    const bodyNodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
    const nodes: DeployHealthNode[] = bodyNodes.map((n: any) => ({
      id: n.id,
      label: n.label,
      path: n.path ?? null,
      files: Array.isArray(n.files) ? n.files : [],
      requiredEnv: Array.isArray(n.requiredEnv) ? n.requiredEnv : [],
    }));

    const projectRoot =
      typeof req.body?.projectRoot === "string" ? req.body.projectRoot.trim() : "";
    const ciByNode: Record<string, CiStatus> =
      req.body?.ciByNode && typeof req.body.ciByNode === "object" ? req.body.ciByNode : {};

    let envGaps: EnvGap[] = [];
    let scanError: string | null = null;

    if (projectRoot) {
      try {
        if (fs.existsSync(projectRoot)) {
          const { scanEnvironmentGaps } = await import("../../../src/agent/envScanner.js");
          envGaps = findingsToEnvGaps(scanEnvironmentGaps(projectRoot) as ScannerFinding[]);
        } else {
          scanError = "projectRoot does not exist on this server; skipping live env scan.";
        }
      } catch (e) {
        // Soft-fail — the scanner is best-effort; still return CI/requiredEnv-derived health.
        scanError = e instanceof Error ? e.message : String(e);
      }
    }

    try {
      const result = buildDeployHealth({ nodes, envGaps, ciByNode });
      res.json({ ...result, scanError });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

export { router as deployHealthRoutes };
