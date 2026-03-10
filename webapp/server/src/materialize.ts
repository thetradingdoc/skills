/**
 * Materialize Architecture — Permissioned Construction Loop
 * Creates folders and index files for proposed greenfield nodes.
 * Requires user consent (button in chat) and target path.
 */

import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { requireUser } from "./middleware/requireUser.js";
import { recordMaterializeMetrics } from "../../../src/ai/metrics.js";
import { createTask, setTaskRunning, setTaskCompleted, setTaskFailed, isTaskCancelled } from "./tasks.js";
import {
  materializeGreenfieldRail,
  approveGreenfieldMaterialize,
} from "../../../src/agent/rail/greenfieldMaterialize.js";
import { getSandboxPath } from "../../../src/agent/rail/sandbox.js";
import { runPlaywrightForRail } from "../../../src/agent/runPlaywrightTrace.js";
import {
  createTask as createRailTask,
  updateTaskStatus as updateRailTaskStatus,
  updateTaskEvidence as updateRailTaskEvidence,
  updateRailPartial,
  getRail,
} from "../../../src/agent/rail/manager.js";
import { runTaskAtIndex } from "../../../src/agent/taskRunner.js";
import { completeTodosForRail } from "./todos.js";

interface ProposedNode {
  id: string;
  label: string;
  layer?: string;
  archNodeId?: string;
}

const router = Router();

/** Idempotency cache: key -> { result, expiresAt } */
const idempotencyCache = new Map<
  string,
  { result: { message: string; created: string[]; errors?: string[] }; expiresAt: number }
>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Ensure relPath does not escape root (no path traversal) */
function isPathSafe(root: string, relPath: string): boolean {
  const resolved = path.resolve(root, relPath);
  const rootNorm = path.resolve(root);
  return resolved.startsWith(rootNorm) && resolved !== rootNorm;
}

/** Validate and resolve targetRoot; returns root or error. */
function validateTargetRoot(targetRoot: string): { root: string } | { error: string } {
  const root = path.resolve(targetRoot.trim());
  if (!root || root === "/" || root.length < 2) {
    return { error: "targetRoot must be a valid project directory path." };
  }
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path.resolve(baseDir);
    if (!root.startsWith(baseNorm + path.sep) && root !== baseNorm) {
      return { error: "targetRoot must be within the allowed projects directory." };
    }
  }
  return { root };
}

const MATERIALIZE_MAX_CHANGED_FILES =
  typeof process.env.MATERIALIZE_MAX_CHANGED_FILES === "string" &&
  !Number.isNaN(Number(process.env.MATERIALIZE_MAX_CHANGED_FILES))
    ? Math.max(1, Number(process.env.MATERIALIZE_MAX_CHANGED_FILES))
    : 200;

const MATERIALIZE_MAX_TOTAL_BYTES =
  typeof process.env.MATERIALIZE_MAX_TOTAL_BYTES === "string" &&
  !Number.isNaN(Number(process.env.MATERIALIZE_MAX_TOTAL_BYTES))
    ? Math.max(10_000, Number(process.env.MATERIALIZE_MAX_TOTAL_BYTES))
    : 500_000;

function computeSandboxDiffSize(root: string, railId: string): {
  changedFiles: number;
  totalBytes: number;
} {
  const sandboxPath = getSandboxPath(root, railId);
  if (!fs.existsSync(sandboxPath)) {
    return { changedFiles: 0, totalBytes: 0 };
  }
  let changedFiles = 0;
  let totalBytes = 0;
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(sandboxPath, full);
        if (!rel || rel.endsWith("/")) continue;
        const sandboxFile = full;
        const rootFile = path.join(root, rel);
        let before: string | undefined;
        let after: string | undefined;
        try {
          if (fs.existsSync(rootFile) && fs.statSync(rootFile).isFile()) {
            before = fs.readFileSync(rootFile, "utf-8");
          }
        } catch {
          // ignore
        }
        try {
          after = fs.readFileSync(sandboxFile, "utf-8");
        } catch {
          // ignore
        }
        if (before === after) continue;
        changedFiles += 1;
        if (after) {
          totalBytes += Buffer.byteLength(after, "utf-8");
        }
      }
    }
  };
  try {
    walk(sandboxPath);
  } catch {
    // best-effort; if diff size fails, fall back to allowing approval
    return { changedFiles: 0, totalBytes: 0 };
  }
  return { changedFiles, totalBytes };
}

/** Core materialize logic — creates folders and index files. */
function runMaterialize(root: string, nodes: ProposedNode[]): {
  message: string;
  created: string[];
  errors?: string[];
} {
  const created: string[] = [];
  const errors: string[] = [];

  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : "";
    const label = typeof node.label === "string" ? node.label : id;
    const archNodeId = typeof node.archNodeId === "string" ? node.archNodeId : id;
    const relPath = id || archNodeId || label.replace(/\s+/g, "-").toLowerCase();

    if (!relPath || /\.\.|\\\\|\/\//.test(relPath)) {
      errors.push(`Invalid path for node ${label}: ${relPath}`);
      continue;
    }

    if (!isPathSafe(root, relPath)) {
      errors.push(`Path traversal blocked for ${label}`);
      continue;
    }

    try {
      const absPath = path.join(root, relPath);
      const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
      const targetDir = pathLooksLikeFile ? path.dirname(absPath) : absPath;

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const indexPath = pathLooksLikeFile ? absPath : path.join(absPath, "index.ts");
      const layer = typeof node.layer === "string" ? node.layer : "Uncategorized";
      const header =
        "// Generated by Arch Visualizer. Boilerplate only — implement as needed.\n" +
        `// @archNodeId: ${archNodeId}`;
      const boilerplate = `\n\n// TODO: Implement ${label} (${layer}).\n\nexport function TODO_${archNodeId.replace(
        /[^a-zA-Z0-9_]/g,
        "_"
      )}() {\n  // implementation pending\n}\n`;

      if (fs.existsSync(indexPath)) {
        const existing = fs.readFileSync(indexPath, "utf-8");
        if (!existing.includes("@archNodeId:")) {
          fs.writeFileSync(indexPath, `${header}\n${existing}`, "utf-8");
        }
      } else {
        fs.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
      }

      const rel = path.relative(root, indexPath).replace(/\\/g, "/");
      created.push(rel);
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const success = errors.length === 0;
  if (success && created.length > 0) {
    try {
      const agentDir = path.join(root, ".agent");
      if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
      const templatesPath = path.join(agentDir, "design_templates.json");
      const existing: { designs?: Array<{ nodes: ProposedNode[]; createdAt: number }> } = fs.existsSync(
        templatesPath
      )
        ? JSON.parse(fs.readFileSync(templatesPath, "utf-8"))
        : { designs: [] };
      const designs = Array.isArray(existing.designs) ? existing.designs : [];
      designs.push({ nodes, createdAt: Date.now() });
      fs.writeFileSync(templatesPath, JSON.stringify({ designs: designs.slice(-20) }, null, 2), "utf-8");
    } catch {
      // Non-fatal: template save failed
    }
  }
  recordMaterializeMetrics({
    timestamp: Date.now(),
    nodeCount: nodes.length,
    createdCount: created.length,
    errorCount: errors.length,
    success,
  });

  return {
    message: `Materialized ${created.length} node(s).`,
    created,
    errors: errors.length > 0 ? errors : undefined,
  };
}

router.post("/materialize", requireUser, async (req, res) => {
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  const { targetRoot, nodes } = req.body as {
    targetRoot?: string;
    nodes?: ProposedNode[];
  };

  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where the architecture should be created.",
    });
    return;
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    res.status(400).json({
      error: "nodes is required and must be a non-empty array of proposed nodes.",
    });
    return;
  }

  if (nodes.length > 30) {
    res.status(400).json({
      error: "Maximum 30 nodes per materialize. Split into smaller batches.",
    });
    return;
  }

  if (idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.result);
    }
  }

  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;

  const result = runMaterialize(root, nodes);

  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, {
      result,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
    // Prune old entries
    const now = Date.now();
    for (const [k, v] of idempotencyCache.entries()) {
      if (v.expiresAt < now) idempotencyCache.delete(k);
    }
  }

  res.json(result);
});

/** Undo materialization — delete created files within targetRoot. */
router.post("/materialize/undo", requireUser, async (req, res) => {
  const { targetRoot, created } = req.body as {
    targetRoot?: string;
    created?: string[];
  };

  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where files were materialized.",
    });
    return;
  }

  if (!Array.isArray(created) || created.length === 0) {
    res.status(400).json({
      error: "created is required and must be a non-empty array of relative paths to delete.",
    });
    return;
  }

  if (created.length > 100) {
    res.status(400).json({
      error: "Maximum 100 paths per undo. Split into smaller batches.",
    });
    return;
  }

  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;

  const deleted: string[] = [];
  const errors: string[] = [];

  for (const rel of created) {
    if (typeof rel !== "string" || !rel.trim()) continue;
    const trimmed = rel.trim().replace(/\\/g, "/");
    if (/\.\.|\\\\|\/\//.test(trimmed)) {
      errors.push(`Invalid path: ${trimmed}`);
      continue;
    }
    if (!isPathSafe(root, trimmed)) {
      errors.push(`Path traversal blocked: ${trimmed}`);
      continue;
    }
    try {
      const absPath = path.join(root, trimmed);
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        if (stat.isFile()) {
          fs.unlinkSync(absPath);
          deleted.push(trimmed);
        } else if (stat.isDirectory()) {
          fs.rmSync(absPath, { recursive: true, force: true });
          deleted.push(trimmed);
        }
      }
    } catch (err) {
      errors.push(`${trimmed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove empty parent directories (bottom-up)
  const dirsToCheck = new Set<string>();
  for (const rel of deleted) {
    let d = path.dirname(rel);
    while (d && d !== ".") {
      dirsToCheck.add(d);
      d = path.dirname(d);
    }
  }
  const sortedDirs = [...dirsToCheck].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const dirRel of sortedDirs) {
    try {
      const absDir = path.join(root, dirRel);
      if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
        const entries = fs.readdirSync(absDir);
        if (entries.length === 0) {
          fs.rmdirSync(absDir);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  res.json({
    message: `Undid materialization: removed ${deleted.length} path(s).`,
    deleted,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/** Async materialize — returns 202 with taskId, client polls GET /api/tasks/:taskId */
router.post("/materialize-async", requireUser, async (req, res) => {
  const { targetRoot, nodes, useRailFlow, sessionId, outcome, acceptanceCriteria, lastCritique } = req.body as {
    targetRoot?: string;
    nodes?: ProposedNode[];
    useRailFlow?: boolean;
    sessionId?: string;
    outcome?: string;
    acceptanceCriteria?: { functional?: string[]; visual?: string[]; architectural?: string[] };
    lastCritique?: { criticScore?: number; message?: string; violations?: unknown[] };
  };

  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where the architecture should be created.",
    });
    return;
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    res.status(400).json({
      error: "nodes is required and must be a non-empty array of proposed nodes.",
    });
    return;
  }

  if (nodes.length > 30) {
    res.status(400).json({
      error: "Maximum 30 nodes per materialize. Split into smaller batches.",
    });
    return;
  }

  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;

  if (useRailFlow && sessionId && typeof sessionId === "string" && outcome && typeof outcome === "string") {
    const rail = materializeGreenfieldRail({
      rootPath: root,
      sessionId,
      outcome,
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        layer: n.layer,
        archNodeId: n.archNodeId ?? n.id,
      })),
      acceptanceCriteria: acceptanceCriteria
        ? {
            functional: Array.isArray(acceptanceCriteria.functional) ? acceptanceCriteria.functional : [],
            visual: Array.isArray(acceptanceCriteria.visual) ? acceptanceCriteria.visual : [],
            architectural: Array.isArray(acceptanceCriteria.architectural) ? acceptanceCriteria.architectural : [],
          }
        : undefined,
      lastCritique: lastCritique
        ? {
            criticScore: lastCritique.criticScore,
            message: lastCritique.message ?? "",
            violations: lastCritique.violations,
          }
        : undefined,
    });
    if (!rail) {
      res.status(500).json({ error: "Failed to create greenfield materialize rail." });
      return;
    }
    const task = createTask();
    res.status(202).json({
      taskId: task.taskId,
      status: "pending",
      railId: rail.id,
      useRailFlow: true,
    });
    setTaskRunning(task.taskId);

    const sandboxPath = getSandboxPath(root, rail.id);
    const specPath = "scripts/greenfield-generated.spec.ts";
    const baseUrl = (process.env.APP_URL?.trim() || "http://localhost:3000").trim();
    const maxRetries = Number(process.env.GREENFIELD_VERIFY_MAX_RETRIES ?? "2") || 2;
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

    Promise.resolve()
      .then(async () => {
        if (isTaskCancelled(task.taskId)) return;

        const verificationTaskId = `verify-${randomUUID()}`;
        createRailTask({
          id: verificationTaskId,
          railId: rail.id,
          kind: "verification",
          description: "Run Playwright greenfield-generated spec",
          files: [specPath],
          autoCapable: true,
          status: "executing",
          agent: "reviewer",
          logicStep: 0,
          createdAt: Date.now(),
        });

        const attempts: Array<{
          attempt: number;
          passed: boolean;
          failures: Array<{ testName: string; error: string; screenshotPath: string }>;
        }> = [];

        let attempt = 0;
        let pw = await runPlaywrightForRail(rail.id, root, sandboxPath, [specPath], baseUrl);

        // Self-correcting loop: modify sandbox code and rerun Playwright on failure.
        while (!pw.passed && attempt < maxRetries && !isTaskCancelled(task.taskId) && apiKey) {
          attempts.push({
            attempt: attempt + 1,
            passed: pw.passed,
            failures: pw.failures?.map((f) => ({
              testName: f.testName,
              error: f.error,
              screenshotPath: f.screenshotPath,
            })) ?? [],
          });

          const errorOutput = JSON.stringify(
            {
              message: "Playwright failures",
              spec: pw.spec,
              failures: pw.failures?.slice(0, 5),
            },
            null,
            2
          );

          const railForFix = getRail(root, rail.id) ?? undefined;

          const firstNode = nodes[0];
          const modulePath =
            (firstNode?.archNodeId as string | undefined) ??
            (firstNode?.id as string | undefined) ??
            "src";

          const plan: any = {
            goal: `${outcome} — fix Playwright failures for greenfield materialize`,
            tasks: [
              {
                id: `gf-fix-${attempt + 1}`,
                module: modulePath,
                layer: "Uncategorized",
                action: "modify",
                expectedOutput: "Update implementation so the generated Playwright spec passes.",
              },
            ],
            dependencies: [],
          };

          await runTaskAtIndex(plan, 0, sandboxPath, {
            apiKey,
            errorOutput,
            rail: railForFix ?? undefined,
            railHistory: [],
          });

          if (isTaskCancelled(task.taskId)) return;

          pw = await runPlaywrightForRail(rail.id, root, sandboxPath, [specPath], baseUrl);
          attempt += 1;
        }

        const finalPw = pw;

        const evidence = JSON.stringify(
          {
            passed: finalPw.passed,
            spec: finalPw.spec,
            tracePath: finalPw.tracePath,
            failures: finalPw.failures?.map((f) => ({
              testName: f.testName,
              error: f.error,
              screenshotPath: f.screenshotPath,
            })),
            attempts,
          },
          null,
          2
        );
        updateRailTaskEvidence(verificationTaskId, evidence);
        updateRailTaskStatus(verificationTaskId, finalPw.passed ? "completed" : "rejected");

        updateRailPartial(root, rail.id, {
          lastCritique: {
            source: "playwright",
            message: finalPw.passed
              ? "Playwright verification passed after self-correction."
              : "Playwright verification failed after self-correction attempts.",
            createdAt: Date.now(),
          },
        });

        if (isTaskCancelled(task.taskId)) return;

        setTaskCompleted(task.taskId, {
          message: finalPw.passed
            ? "Verification passed. You can approve materialization to copy changes to your project."
            : "Verification failed after self-correction attempts. Review the Playwright failures; approval is blocked until verification passes.",
          created: [],
          railId: rail.id,
          verification: finalPw,
          verificationPassed: finalPw.passed,
          verificationAttempts: attempts,
          recommendRescan: true,
        });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        updateRailPartial(root, rail.id, {
          lastCritique: {
            source: "playwright",
            message: `Verification error: ${msg}`,
            createdAt: Date.now(),
          },
        });
        setTaskFailed(task.taskId, msg);
      });
    return;
  }

  const task = createTask();
  res.status(202).json({ taskId: task.taskId, status: "pending" });

  setTaskRunning(task.taskId);

  Promise.resolve()
    .then(() => runMaterialize(root, nodes))
    .then((result) => {
      if (isTaskCancelled(task.taskId)) return;
      setTaskCompleted(task.taskId, {
        ...result,
        recommendRescan: true,
      });
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setTaskFailed(task.taskId, msg);
    });
});

/** Approve greenfield materialize rail — copy sandbox to root and archive. */
router.post("/materialize/approve", requireUser, async (req, res) => {
  const { rootPath, railId, force } = req.body as { rootPath?: string; railId?: string; force?: boolean };
  if (!rootPath || typeof rootPath !== "string" || !railId || typeof railId !== "string") {
    res.status(400).json({ error: "rootPath and railId are required." });
    return;
  }
  const validated = validateTargetRoot(rootPath);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const existing = getRail(validated.root, railId);
  if (!existing) {
    res.status(404).json({ error: "Rail not found or not loaded." });
    return;
  }
  const verifTasks = (existing.tasks ?? []).filter((t) => t.kind === "verification");
  const passed = verifTasks.length > 0 && verifTasks.every((t) => t.status === "completed");
  if (!passed) {
    res.status(409).json({
      error: "Verification has not passed yet. Approval is blocked until verification is completed successfully.",
    });
    return;
  }

  if (!force) {
    const { changedFiles, totalBytes } = computeSandboxDiffSize(validated.root, railId);
    if (changedFiles > MATERIALIZE_MAX_CHANGED_FILES || totalBytes > MATERIALIZE_MAX_TOTAL_BYTES) {
      res.status(409).json({
        error:
          "This materialization would apply a very large diff. Review the changes in your editor and confirm before proceeding.",
        code: "MATERIALIZE_DIFF_TOO_LARGE",
        limits: {
          maxChangedFiles: MATERIALIZE_MAX_CHANGED_FILES,
          maxTotalBytes: MATERIALIZE_MAX_TOTAL_BYTES,
        },
        actual: {
          changedFiles,
          totalBytes,
        },
      });
      return;
    }
  }

  const rail = approveGreenfieldMaterialize(validated.root, railId);
  if (!rail) {
    res.status(404).json({ error: "Rail not found or not a greenfield materialize rail." });
    return;
  }
  completeTodosForRail(railId).catch(() => {});
  res.json({ rail, message: "Materialization complete. Rail archived." });
});

export { router as materializeRoutes };
