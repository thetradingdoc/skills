import { Router } from "express";
import path from "path";
import * as fs from "fs";
import { requireUser } from "./middleware/requireUser.js";
const router = Router();
router.post("/scaffold-node", requireUser, async (req, res) => {
    const { projectRoot, archNodeId, relPath, layer, kind } = req.body;
    if (!projectRoot || !archNodeId || !relPath) {
        res.status(400).json({
            error: "projectRoot, archNodeId, and relPath are required.",
        });
        return;
    }
    try {
        const root = path.resolve(projectRoot);
        // Inline scaffold logic to avoid cross-package import issues.
        const absPath = path.join(root, relPath);
        const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
        const targetDir = pathLooksLikeFile ? path.dirname(absPath) : absPath;
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        const indexPath = pathLooksLikeFile
            ? absPath
            : path.join(absPath, "index.ts");
        const header = `// @archNodeId: ${archNodeId}`;
        const boilerplate = `\n\n// TODO: Implement ${kind ?? "module"} for layer ${layer ?? "Uncategorized"}.\n\nexport function TODO_${archNodeId.replace(/[^a-zA-Z0-9_]/g, "_")}() {\n  // implementation pending\n}\n`;
        if (fs.existsSync(indexPath)) {
            const existing = fs.readFileSync(indexPath, "utf-8");
            if (!existing.includes("@archNodeId:")) {
                fs.writeFileSync(indexPath, `${header}\n${existing}`, "utf-8");
            }
        }
        else {
            fs.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
        }
        const rel = path.relative(root, indexPath).replace(/\\/g, "/");
        res.json({ message: `Scaffolded node at ${rel}` });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});
export { router as scaffoldRoutes };
