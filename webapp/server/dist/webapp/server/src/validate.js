import { Router } from "express";
import { spawnSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
const router = Router();
router.post("/validate", async (req, res) => {
    const { repoUrl, createJira } = req.body;
    if (!repoUrl || typeof repoUrl !== "string") {
        res.status(400).json({ error: "repoUrl is required" });
        return;
    }
    const trimmed = repoUrl.trim();
    if (!trimmed.match(/github\.com[/:]/i)) {
        res.status(400).json({ error: "Use a GitHub URL, e.g. https://github.com/owner/repo" });
        return;
    }
    try {
        const args = ["tsx", "scripts/validate-repo.ts", trimmed];
        if (createJira)
            args.push("--jira");
        const proc = spawnSync("npx", args, {
            cwd: projectRoot,
            encoding: "utf-8",
            maxBuffer: 20 * 1024 * 1024,
            env: { ...process.env },
        });
        if (proc.status !== 0) {
            const errMsg = proc.stderr?.trim() || proc.error?.message || "Validation failed";
            return res.status(500).json({ error: errMsg });
        }
        const data = JSON.parse(proc.stdout?.trim() || "{}");
        res.json(data);
    }
    catch (err) {
        const stderr = err && typeof err === "object" && "stderr" in err
            ? err.stderr
            : null;
        const message = stderr
            ? Buffer.isBuffer(stderr)
                ? stderr.toString()
                : String(stderr)
            : err instanceof Error
                ? err.message
                : String(err);
        res.status(500).json({ error: message || "Validation failed" });
    }
});
export { router as validateRoutes };
