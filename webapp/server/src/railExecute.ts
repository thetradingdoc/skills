/**
 * Shared rail execution logic for use by both POST /rails/:id/execute and auto-rails-and-execute.
 */

import * as path from "path";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getRail, loadRails } from "../../../src/agent/rail/manager.js";
import {
  createTask as createRailTask,
  updateTaskStatus as updateRailTaskStatus,
  updateTaskEvidence as updateRailTaskEvidence,
  updateRailPartial,
} from "../../../src/agent/rail/manager.js";
import { transitionRail } from "../../../src/agent/rail/orchestrator.js";
import { ensureSandbox } from "../../../src/agent/rail/sandbox.js";
import { syncSandboxFromRoot } from "../../../src/agent/rail/executor.js";
import { runTaskAtIndex } from "../../../src/agent/taskRunner.js";
import { classifyTaskAutoCapable } from "../../../src/agent/taskClassifier.js";
import {
  runVerificationPipeline,
  type VerificationResult,
} from "../../../src/agent/verificationPipeline.js";
import {
  createTask,
  setTaskRunning,
  setTaskCompleted,
  setTaskFailed,
  isTaskCancelled,
} from "./tasks.js";
import { ensureProjectRoot } from "./cloneRepo.js";
import type { Rail } from "../../../src/agent/types.js";
import { setTodoStatusByRailId, appendTodoSessionLogByRailId } from "./taskSessionLog.js";
import { computeSandboxDiffSummary } from "./sandboxDiffSummary.js";
import { debugLog } from "./debugLog.js";

const workspaceExecutionCounts = new Map<string, number>();
const MAX_CONCURRENT_PER_WORKSPACE =
  typeof process.env.RAIL_MAX_CONCURRENT === "string" &&
  !Number.isNaN(Number(process.env.RAIL_MAX_CONCURRENT))
    ? Math.max(1, Number(process.env.RAIL_MAX_CONCURRENT))
    : 1;

export type BroadcastRailEvent = (workspaceId: string, payload: unknown) => void;

async function resolveRootFromWorkspace(
  workspaceId: string,
  ownerId: string
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("project_root")
      .eq("id", workspaceId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error || !data) return null;
    const pr = (data as { project_root?: string | null }).project_root;
    return typeof pr === "string" && pr.trim() ? path.resolve(pr.trim()) : null;
  } catch {
    return null;
  }
}

/**
 * Triggers rail execution in the background. Resolves when execution has been kicked off.
 * Throws if validation fails. The actual execution runs asynchronously.
 * Returns taskId for clients that poll execution status.
 */
export async function triggerRailExecution(
  railId: string,
  workspaceId: string,
  userId: string,
  broadcast?: BroadcastRailEvent
): Promise<{ taskId: string }> {
  const currentExec = workspaceExecutionCounts.get(workspaceId) ?? 0;
  if (currentExec >= MAX_CONCURRENT_PER_WORKSPACE) {
    throw new Error("Execution limit reached for this workspace. Try again later.");
  }

  let root = await resolveRootFromWorkspace(workspaceId, userId);
  if (!root && supabaseAdmin) {
    const { data: gr } = await supabaseAdmin
      .from("graphs")
      .select("graph_json, repo_url")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const graph = (gr?.graph_json ?? { nodes: [], edges: [], generatedAt: Date.now(), projectRoot: "" }) as any;
    const repoUrl = (gr?.repo_url as string | null) ?? null;
    const { rootPath, error } = await ensureProjectRoot(workspaceId, graph, repoUrl);
    if (rootPath !== null) root = rootPath;
    else throw new Error(error || "Workspace has no project_root. Please scan the repository first.");
  }
  if (!root) throw new Error("Workspace has no project_root.");

  loadRails(root);
  const rail = getRail(root, railId);
  if (!rail) throw new Error("Rail not found.");
  if (rail.archetype !== "analysis-chat") {
    throw new Error("Only analysis-chat rails can be executed.");
  }
  const codeTasks = (rail.tasks ?? []).filter(
    (t) => t.kind === "code_change" && classifyTaskAutoCapable(t)
  );
  if (codeTasks.length === 0) {
    throw new Error("Rail has no code_change tasks to run.");
  }
  if (!["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(rail.state)) {
    throw new Error(
      `Rail must be in PRE_PLANNING, PLANNING, or AWAITING_APPROVAL. Current: ${rail.state}`
    );
  }

  const bgTask = createTask();
  setTaskRunning(bgTask.taskId);
  workspaceExecutionCounts.set(workspaceId, currentExec + 1);
  const sandboxPath = ensureSandbox(root, rail.id);
  const paths = (rail.logicPath ?? []).map((s) =>
    typeof s === "object" && s && "filePath" in s && typeof (s as { filePath?: string }).filePath === "string"
      ? (s as { filePath: string }).filePath
      : String(s)
  ).filter(Boolean) as string[];
  const syncPaths = paths.length > 0 ? paths : ["src"];
  syncSandboxFromRoot(root, rail.id, syncPaths);
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const goal =
    rail.outcome ??
    (rail.trigger as { userMessage?: string })?.userMessage ??
    "Analysis rail";
  const plan = {
    goal,
    tasks: codeTasks.map((t, i) => ({
      id: t.id,
      module: (rail.logicPath?.[i] as { filePath?: string })?.filePath ?? `step-${i + 1}`,
      layer: (rail.logicPath?.[i] as { layer?: string })?.layer ?? "Service",
      action: "modify" as const,
      expectedOutput: t.description ?? `Step ${i + 1}`,
    })),
    dependencies: [] as [string, string][],
  };
  for (let i = 0; i < plan.tasks.length - 1; i++) {
    plan.dependencies.push([plan.tasks[i].id, plan.tasks[i + 1].id]);
  }

  Promise.resolve()
    .then(async () => {
      if (isTaskCancelled(bgTask.taskId)) return;
      const current = getRail(root!, railId);
      if (current && (current.state === "PRE_PLANNING" || current.state === "PLANNING")) {
        transitionRail(root!, railId, "AWAITING_APPROVAL" as any);
      }
      const tr = transitionRail(root!, railId, "EXECUTING" as any, { planApproved: true });
      if (!tr.ok) {
        setTaskFailed(bgTask.taskId, tr.error ?? "Invalid transition.");
        return;
      }
      const attemptHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
      const maxSelfCorrect =
        ((rail.telemetry as { retryLimit?: number })?.retryLimit as number | undefined) ??
        (typeof process.env.RAIL_SELF_CORRECT_MAX === "string" &&
        !Number.isNaN(Number(process.env.RAIL_SELF_CORRECT_MAX))
          ? Math.max(0, Math.min(5, Number(process.env.RAIL_SELF_CORRECT_MAX)))
          : 2);

      let lastVerificationFeedback: string | undefined;
      let verification: VerificationResult | null = null;
      let attempt = 0;

      while (attempt <= maxSelfCorrect && !isTaskCancelled(bgTask.taskId)) {
        for (let idx = 0; idx < plan.tasks.length && !isTaskCancelled(bgTask.taskId); idx++) {
          const railTask = codeTasks[idx];
          if (railTask) updateRailTaskStatus(railTask.id, "executing");
          const result = await runTaskAtIndex(plan as any, idx, sandboxPath, {
            apiKey,
            errorOutput: lastVerificationFeedback,
            rail,
            railHistory: attemptHistory,
          });
          if (result.error) {
            attemptHistory.push({
              role: "assistant",
              content: `Task ${railTask?.id ?? idx} error: ${result.error}`,
            });
            if (/token budget exceeded|Token budget exceeded/i.test(result.error)) {
              setTaskFailed(bgTask.taskId, result.error);
              transitionRail(root!, railId, "FAILED" as any);
              return;
            }
          }
          if (railTask) updateRailTaskStatus(railTask.id, "completed");
        }

        const nodeIds = (rail.logicPath ?? [])
          .map((s) => (typeof s === "object" && s && "nodeId" in s && typeof (s as { nodeId?: string }).nodeId === "string"
            ? (s as { nodeId: string }).nodeId
            : null))
          .filter((x): x is string => !!x);

        verification = await runVerificationPipeline({
          projectRoot: root!,
          sandboxPath,
          railId: rail.id as any,
          baseUrl: process.env.APP_URL || "http://127.0.0.1:4173",
          scope: nodeIds.length > 0 ? { nodeIds } : undefined,
        });

        const passed = verification.passed;
        lastVerificationFeedback = verification.errorFeedback || undefined;

        if (passed) break;
        attempt++;
      }

      const { passed, lint, vitest, playwright: playwrightResult } = verification ?? {
        passed: false,
        lint: { passed: false, errors: [] },
        vitest: { passed: false, summary: { total: 0, passed: 0, failed: 0, skipped: 0 }, failures: [] },
        playwright: null,
      };
      const errorOutput = lastVerificationFeedback ?? "Verification failed.";
      const verificationTaskId = `verify-${Date.now()}`;
      createRailTask({
        id: verificationTaskId,
        railId: rail.id,
        kind: "verification",
        description: "Lint + Vitest in sandbox",
        files: [],
        autoCapable: true,
        status: passed ? "completed" : "rejected",
        agent: "reviewer",
        logicStep: 0,
        createdAt: Date.now(),
        resolvedAt: Date.now(),
      });
      updateRailTaskEvidence(verificationTaskId, JSON.stringify({ lint, vitest, playwright: playwrightResult }));
      const attemptNumber =
        (((rail.telemetry as any)?.retryCount as number | undefined) ?? 0) + 1;
      const attemptSummary = passed ? "Verification passed." : errorOutput || "Verification failed.";
      updateRailPartial(root!, railId, {
        lastCritique: {
          source: passed ? "test" : "lint",
          message: passed
            ? "Lint, Vitest, and Playwright passed."
            : errorOutput || "Verification failed.",
          createdAt: Date.now(),
          attempt: attemptNumber,
          totalAttempts: ((rail.telemetry as any)?.retryLimit as number | undefined) ?? 1,
        },
        telemetry: {
          ...(rail.telemetry ?? {}),
          retryCount:
            ((((rail.telemetry as any)?.retryCount as number | undefined) ?? 0) + (passed ? 0 : 1)) as any,
        },
        attemptHistory: [
          ...((rail.attemptHistory as Array<{ timestamp: number; summary: string }> | undefined) ?? []),
          { timestamp: Date.now(), summary: attemptSummary.slice(0, 5000) },
        ],
      } as any);
      const toState = passed ? "VERIFYING" : "SELF_CORRECTING";
      transitionRail(root!, railId, toState as any);
      setTaskCompleted(bgTask.taskId, {
        message: passed
          ? "Verification passed. You can approve materialization."
          : "Verification failed. Review failures in rail detail.",
        railId: rail.id,
        verificationPassed: passed,
        lint: { passed: lint.passed, errors: lint.errors.length },
        vitest: { passed: vitest.passed, failures: vitest.failures.length },
        playwright: playwrightResult
          ? { passed: playwrightResult.passed, failures: playwrightResult.failures.length }
          : null,
      });
      const diff = computeSandboxDiffSummary(root!, rail.id);
      await appendTodoSessionLogByRailId(rail.id, "ready_to_review", {
        verificationPassed: passed,
        files_changed: diff.files.map((f) => f.path),
        summary: diff.summary,
        changed_files: diff.changedFiles,
        total_bytes: diff.totalBytes,
        files: diff.files.slice(0, 20),
      });
      // #region agent log
      debugLog({
        hypothesisId: "H4",
        location: "railExecute.ts:needs_review",
        message: "ready_to_review diff appended",
        data: {
          railId: rail.id,
          passed,
          changedFiles: diff.changedFiles,
          summary: diff.summary.slice(0, 200),
        },
      });
      // #endregion
      await setTodoStatusByRailId(rail.id, "needs_review", {
        verificationPassed: passed,
      });
      if (!passed) {
        await appendTodoSessionLogByRailId(rail.id, "verification_failed", {
          error: errorOutput?.slice(0, 2000),
        });
      }
      if (supabaseAdmin && workspaceId) {
        try {
          await supabaseAdmin.from("workspace_memories").insert({
            workspace_id: workspaceId,
            content: passed
              ? `Rail ${rail.id} verification passed. Outcome: ${rail.outcome ?? ""}`
              : `Rail ${rail.id} verification failed. See lint, vitest, and Playwright results.`,
            memory_type: "rail_result",
            rail_id: rail.id,
          });
        } catch {
          // non-fatal
        }
      }
      if (!passed && workspaceId && broadcast) {
        broadcast(workspaceId, { type: "rail_hitl", railId: rail.id, reason: "verification_failed" });
      }
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setTaskFailed(bgTask.taskId, msg);
      updateRailPartial(root!, railId, {
        lastCritique: { source: "unknown", message: msg, createdAt: Date.now() },
      } as any);
      void appendTodoSessionLogByRailId(railId, "error", { message: msg });
      void setTodoStatusByRailId(railId, "todo", { failed: true });
    })
    .finally(() => {
      const cur = workspaceExecutionCounts.get(workspaceId) ?? 0;
      const next = Math.max(0, cur - 1);
      if (next === 0) workspaceExecutionCounts.delete(workspaceId);
      else workspaceExecutionCounts.set(workspaceId, next);
      if (broadcast) broadcast(workspaceId, { type: "rail_execute_complete", railId });
    });

  return { taskId: bgTask.taskId };
}
