/**
 * Persist resource classification decisions to resources.classify.json.
 */
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLASSIFY_PATH = path.join(REPO_ROOT, "resources.classify.json");
const PUBLIC_COPY = path.join(
  REPO_ROOT,
  "webapp/client/public/resources.classify.json"
);

const CLASSES = new Set([
  "patient",
  "money",
  "external",
  "internal",
  "plumbing",
  "unclassified",
]);

type ClassifyFile = {
  version: number;
  description?: string;
  heuristics: Record<string, string[]>;
  resources: Record<string, string>;
  guesses?: Record<string, string>;
  unclassified: string[];
  noise?: string[];
};

function readClassify(): ClassifyFile {
  const raw = JSON.parse(fs.readFileSync(CLASSIFY_PATH, "utf8"));
  return {
    version: raw.version ?? 2,
    description: raw.description,
    heuristics: raw.heuristics ?? {},
    resources: raw.resources ?? {},
    guesses: raw.guesses ?? {},
    unclassified: Array.isArray(raw.unclassified) ? raw.unclassified : [],
    noise: Array.isArray(raw.noise) ? raw.noise : [],
  };
}

function writeClassify(cfg: ClassifyFile): void {
  const sorted = {
    ...cfg,
    unclassified: [...new Set(cfg.unclassified)].sort(),
    noise: [...new Set(cfg.noise ?? [])].sort(),
    resources: Object.fromEntries(
      Object.entries(cfg.resources).sort(([a], [b]) => a.localeCompare(b))
    ),
    guesses: Object.fromEntries(
      Object.entries(cfg.guesses ?? {}).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
  const text = JSON.stringify(sorted, null, 2) + "\n";
  fs.writeFileSync(CLASSIFY_PATH, text, "utf8");
  try {
    fs.mkdirSync(path.dirname(PUBLIC_COPY), { recursive: true });
    fs.writeFileSync(PUBLIC_COPY, text, "utf8");
  } catch {
    /* optional */
  }
}

export const resourceClassifyRoutes = Router();

resourceClassifyRoutes.get("/resources/classify", (_req: Request, res: Response) => {
  try {
    res.json(readClassify());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

resourceClassifyRoutes.post("/resources/classify", (req: Request, res: Response) => {
  try {
    const updates = req.body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: "updates: [{ key, class }] required" });
      return;
    }
    const cfg = readClassify();
    if (!cfg.guesses) cfg.guesses = {};
    for (const u of updates) {
      const key = typeof u?.key === "string" ? u.key.toLowerCase() : "";
      const cls = u?.class;
      if (!key || !CLASSES.has(cls)) continue;
      cfg.resources[key] = cls;
      delete cfg.guesses[key];
      cfg.unclassified = cfg.unclassified.filter((k) => k !== key);
    }
    writeClassify(cfg);
    res.json({ ok: true, classify: cfg });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
