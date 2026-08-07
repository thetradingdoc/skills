import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { simpleGit } from "simple-git";
import type { ArchGraph } from "../../../src/types.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const CLONES_BASE =
  process.env.ARCH_VIZ_CLONES_DIR?.trim() ||
  path.join(homedir(), ".arch-viz", "repos");

const recloneLocks = new Map<string, Promise<string | null>>();

export function getClonesDir(): string {
  return CLONES_BASE;
}

/** Inject token into HTTPS GitHub URL for private repo access. Returns original URL if no token. */
export function authUrl(url: string): string {
  const trimmed = url.trim();
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
  if (!token) return trimmed;
  const match = trimmed.match(/^(https?:\/\/)(github\.com\/[\w.-]+\/[\w.-]+?)(\.git)?\/?$/i);
  if (!match) return trimmed;
  const [, scheme, repoPath] = match;
  return `${scheme}${token}@${repoPath}`;
}

/** True if dir exists and contains a valid .git directory. */
export function isCloneValid(dir: string): boolean {
  const gitDir = path.join(dir, ".git");
  try {
    return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Bring a kept clone up to date with origin.
 * Rescan used to reuse ~/.arch-viz/repos/<workspaceId> forever without fetch,
 * so GitHub pushes never appeared as new canvas nodes.
 */
export async function refreshStableClone(dir: string): Promise<{ ok: boolean; error?: string }> {
  if (!isCloneValid(dir)) {
    return { ok: false, error: "Not a git clone" };
  }
  try {
    const git = simpleGit(dir);
    // Shallow clones: deepen one tip from origin rather than a full history pull.
    await git.fetch(["origin", "--depth", "1"]);
    let branch = "main";
    try {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim() || "main";
    } catch {
      /* keep main */
    }
    if (branch === "HEAD") {
      // Detached HEAD after prior reset — prefer origin/main then origin/master.
      try {
        await git.reset(["--hard", "origin/main"]);
      } catch {
        await git.reset(["--hard", "origin/master"]);
      }
    } else {
      try {
        await git.reset(["--hard", `origin/${branch}`]);
      } catch {
        await git.reset(["--hard", "FETCH_HEAD"]);
      }
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cloneRepo] refreshStableClone failed:", msg);
    return { ok: false, error: msg };
  }
}

export async function cloneToStablePath(repoUrl: string, workspaceId: string): Promise<string> {
  const stableDir = path.join(getClonesDir(), workspaceId);
  if (fs.existsSync(stableDir)) {
    if (!isCloneValid(stableDir)) {
      fs.rmSync(stableDir, { recursive: true, force: true });
    } else {
      const refreshed = await refreshStableClone(stableDir);
      if (!refreshed.ok) {
        // Stale/corrupt clone — delete and reclone from scratch.
        try {
          fs.rmSync(stableDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      } else {
        return stableDir;
      }
    }
  }
  fs.mkdirSync(path.dirname(stableDir), { recursive: true });
  const cloneUrl = authUrl(repoUrl);
  try {
    await simpleGit().clone(cloneUrl, stableDir, ["--depth", "1"]);
  } catch (err) {
    if (fs.existsSync(stableDir)) {
      try {
        fs.rmSync(stableDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth|401|403|permission|denied/i.test(msg)) {
      throw new Error(
        "Clone failed (auth). Private repositories require GITHUB_TOKEN or GITHUB_ACCESS_TOKEN. " +
          "Set one in your environment."
      );
    }
    throw err;
  }
  return stableDir;
}

/** Returns true if path exists and is a directory (Option A: allow non-git for greenfield). */
function isExistingDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureProjectRoot(
  workspaceId: string,
  graph: ArchGraph,
  repoUrl: string | null
): Promise<{ rootPath: string | null; error?: string }> {
  const stored = graph.projectRoot?.trim();
  if (stored) {
    const resolved = path.resolve(stored);
    if (isCloneValid(resolved)) return { rootPath: resolved };
    if (isExistingDir(resolved)) {
      const clonesBase = path.resolve(getClonesDir());
      const rel = path.relative(clonesBase, resolved);
      const underClones = !rel.startsWith("..") && !path.isAbsolute(rel);
      if (!underClones) {
        return { rootPath: resolved };
      }
      try {
        fs.rmSync(resolved, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  const trimmedRepo = typeof repoUrl === "string" ? repoUrl.trim() : "";
  if (!trimmedRepo) {
    return {
      rootPath: null,
      error:
        "Source code unavailable and no repo URL stored. " +
        "Please re-scan once to register the repository.",
    };
  }

  let existing = recloneLocks.get(workspaceId);
  if (existing) {
    const result = await existing;
    return result !== null ? { rootPath: result } : { rootPath: null, error: "Reclone failed." };
  }

  const run = async (): Promise<string | null> => {
    try {
      const stableDir = await cloneToStablePath(trimmedRepo, workspaceId);
      const admin = supabaseAdmin;
      if (admin) {
        setImmediate(() => {
          // Best-effort: persist project_root for fast subsequent execution runs.
          // (Rails are file-based; root resolution should not depend on client-sent graph.projectRoot.)
          void admin
            .from("workspaces")
            .update({ project_root: stableDir })
            .eq("id", workspaceId)
            .then(
              () => undefined,
              (e: unknown) =>
                console.warn(
                  "[cloneRepo] Failed to update workspace project_root:",
                  e instanceof Error ? e.message : e
                )
            );

          const updated = { ...graph, projectRoot: stableDir };
          void admin
            .from("graphs")
            .select("id")
            .eq("workspace_id", workspaceId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => {
              if (data?.id) {
                admin
                  .from("graphs")
                  .update({ graph_json: updated })
                  .eq("id", data.id)
                  .then(
                    () => undefined,
                    (e: unknown) =>
                      console.warn("[cloneRepo] Failed to update graph projectRoot:", e instanceof Error ? e.message : e)
                  );
              }
            })
            .then(undefined, () => undefined);
        });
      }
      return stableDir;
    } catch (err) {
      console.warn(
        "[cloneRepo] Reclone failed:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    } finally {
      recloneLocks.delete(workspaceId);
    }
  };

  const promise = run();
  recloneLocks.set(workspaceId, promise);
  const result = await promise;
  return result !== null ? { rootPath: result } : { rootPath: null, error: "Reclone failed." };
}

/** Option B: Bootstrap a directory for greenfield — create if missing, run git init. */
export async function bootstrapProjectRoot(targetPath: string): Promise<{ rootPath: string; error?: string }> {
  const root = path.resolve(targetPath.trim());
  if (!root || root === "/" || root.length < 2) {
    return { rootPath: "", error: "Invalid target path." };
  }
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path.resolve(baseDir);
    if (!root.startsWith(baseNorm + path.sep) && root !== baseNorm) {
      return { rootPath: "", error: "Target path must be within the allowed projects directory." };
    }
  }
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    if (!isCloneValid(root)) {
      await simpleGit(root).init();
    }
    return { rootPath: root };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rootPath: "", error: `Bootstrap failed: ${msg}` };
  }
}

export function deleteWorkspaceClone(workspaceId: string): void {
  const stableDir = path.join(getClonesDir(), workspaceId);
  try {
    if (fs.existsSync(stableDir)) {
      fs.rmSync(stableDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(
      "[cloneRepo] Failed to delete clone:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
