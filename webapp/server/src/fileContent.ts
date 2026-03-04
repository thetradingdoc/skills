import { Router } from "express";

const router = Router();

/** Parse owner/repo from GitHub URL */
function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

router.post("/file-content", async (req, res) => {
  const { repoUrl, filePath } = req.body as { repoUrl?: string; filePath?: string };

  if (!repoUrl || typeof repoUrl !== "string" || !filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "repoUrl and filePath are required" });
    return;
  }

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    res.status(400).json({ error: "Invalid GitHub URL" });
    return;
  }

  const { owner, repo } = parsed;
  const branch = "main";
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;

  try {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.raw",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const r = await fetch(rawUrl, { headers });
    if (!r.ok) {
      if (r.status === 404) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      res.status(r.status).json({ error: `Failed to fetch: ${r.statusText}` });
      return;
    }

    const content = await r.text();
    res.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export { router as fileContentRoutes };
