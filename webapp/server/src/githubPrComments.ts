import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getActiveViolations } from "./violationStore.js";

const router = Router();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_ACCESS_TOKEN?.trim() || null;

/** Resolve a line number for a violation by fetching file content and searching for a relevant line. */
async function resolveLineForComment(
  owner: string,
  repo: string,
  filePath: string,
  commitId: string,
  headers: Record<string, string>,
  node: { path?: string; files?: string[]; label?: string } | undefined,
  violation: { description?: string | null }
): Promise<number> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(commitId)}`,
      { headers: { ...headers, Accept: "application/vnd.github.raw" } }
    );
    if (!res.ok) return 1;
    const content = await res.text();
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) return 1;

    const tokens: string[] = [];
    const lastPart = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
    if (lastPart) tokens.push(lastPart);
    if (node?.label) tokens.push(node.label);
    if (node?.path) {
      const pathLast = String(node.path).split(/[/\\]/).pop();
      if (pathLast && !tokens.includes(pathLast)) tokens.push(pathLast);
    }
    const descWords = (violation.description ?? "")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && /^[\w.-]+$/.test(w))
      .slice(0, 3);
    tokens.push(...descWords);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const t of tokens) {
        if (t.length >= 2 && new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(line)) {
          return i + 1;
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const t of tokens) {
        if (t.length >= 2 && line.includes(t)) return i + 1;
      }
    }
  } catch {
    /* ignore */
  }
  return 1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ViolationRow {
  type: string;
  severity: string;
  source_node_id: string;
  target_node_id?: string | null;
  description?: string | null;
  suggested_fix?: string | null;
}

/** Post architecture violations and drift as PR review comments. */
router.post(
  "/workspaces/:workspaceId/pr-comment",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!GITHUB_TOKEN) {
      res.status(503).json({ error: "GITHUB_TOKEN not configured." });
      return;
    }
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth not configured." });
      return;
    }

    const workspaceId = req.params.workspaceId!;
    const { pullNumber, owner, repo } = req.body as {
      pullNumber?: number;
      owner?: string;
      repo?: string;
    };

    if (typeof pullNumber !== "number" || !owner || !repo) {
      res.status(400).json({
        error: "pullNumber (number), owner, and repo are required.",
      });
      return;
    }

    const { loadWorkspaceRepoFields } = await import("./workspaceRepoMeta.js");
    const ws = await loadWorkspaceRepoFields(supabaseAdmin, workspaceId);

    if (!ws) {
      res.status(404).json({ error: "Workspace not found." });
      return;
    }

    const fullName = ws.github_full_name;
    const repoUrl = ws.repo_url;
    const parts = fullName
      ? fullName.split("/")
      : typeof repoUrl === "string"
        ? repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)?.slice(1)
        : null;
    const effectiveOwner = owner || (parts?.[0] ?? "");
    const effectiveRepo = repo || (parts?.[1] ?? "");
    if (!effectiveOwner || !effectiveRepo) {
      res.status(400).json({ error: "Cannot resolve repo owner/name. Set github_full_name or pass owner+repo." });
      return;
    }

    const violations = await getActiveViolations(
      supabaseAdmin,
      workspaceId
    );

    if (violations.length === 0) {
      res.json({ posted: 0, postedInline: 0, message: "No active violations to post." });
      return;
    }

    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    let postedInline = 0;

    try {
      // Fetch graph for node paths and PR for head sha
      const [graphRes, prRes] = await Promise.all([
        supabaseAdmin
          .from("graphs")
          .select("graph_json")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetch(
          `https://api.github.com/repos/${effectiveOwner}/${effectiveRepo}/pulls/${pullNumber}`,
          { headers }
        ),
      ]);

      const graphJson = (graphRes.data as {
        graph_json?: { nodes?: Array<{ id: string; path?: string; files?: string[]; label?: string }> };
      } | null)?.graph_json;
      const nodeById = new Map<string, { path?: string; files?: string[]; label?: string }>();
      if (graphJson?.nodes) {
        for (const n of graphJson.nodes) {
          nodeById.set(n.id, { path: n.path, files: n.files, label: n.label });
        }
      }

      const pr = prRes.ok ? (await prRes.json()) as { head?: { sha?: string } } : null;
      const commitId = pr?.head?.sha;

      if (commitId && nodeById.size > 0) {
        for (const v of violations.slice(0, 15)) {
          const node = nodeById.get(v.source_node_id);
          const rawPath = node?.files?.[0] ?? node?.path;
          const filePath =
            typeof rawPath === "string" && !rawPath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(rawPath)
              ? rawPath.replace(/\\/g, "/")
              : null;
          if (!filePath) continue;
          const line = await resolveLineForComment(
            effectiveOwner,
            effectiveRepo,
            filePath,
            commitId,
            headers,
            node,
            v
          );
          const body = [
            `**[${v.severity}] ${v.type}**`,
            "",
            v.description ?? "",
            v.suggested_fix ? `\n**Fix:** ${v.suggested_fix}` : "",
          ].join("").slice(0, 60000);

          const commentRes = await fetch(
            `https://api.github.com/repos/${effectiveOwner}/${effectiveRepo}/pulls/${pullNumber}/comments`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                body,
                path: filePath,
                commit_id: commitId,
                line,
                side: "RIGHT",
              }),
            }
          );
          if (commentRes.ok) postedInline += 1;
        }
      }

      const summaryBody = [
        "## Architecture violations",
        "",
        "| Severity | Type | Description | Fix |",
        "|----------|------|-------------|-----|",
        ...violations.slice(0, 20).map((v: ViolationRow) =>
          [
            "|",
            v.severity,
            "|",
            v.type,
            "|",
            (v.description ?? "").replace(/\|/g, "\\|").slice(0, 80),
            "|",
            (v.suggested_fix ?? "").replace(/\|/g, "\\|").slice(0, 60),
            "|",
          ].join(" ")
        ),
        "",
        `_Reported by Arch Visualizer (${violations.length} violation${violations.length === 1 ? "" : "s"})${postedInline > 0 ? ` — ${postedInline} inline comment${postedInline === 1 ? "" : "s"} posted_` : "_"}`,
      ].join("\n");

      const r = await fetch(
        `https://api.github.com/repos/${effectiveOwner}/${effectiveRepo}/issues/${pullNumber}/comments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ body: summaryBody }),
        }
      );

      if (!r.ok) {
        const err = await r.text();
        res.status(r.status).json({ error: `GitHub API error: ${err}`, postedInline });
        return;
      }

      res.json({ posted: 1, postedInline, violationsCount: violations.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

export { router as githubPrCommentRoutes };
