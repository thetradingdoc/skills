/**
 * Persist resource classification decisions to resources.classify.json.
 */
import { Router, type Request, type Response } from "express";
import { optionalUser } from "./middleware/optionalUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
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

/**
 * A classification is a judgement, and a judgement without an author is not
 * reviewable. The JSON file stays the source of truth for the scanner; this
 * additionally records who decided, when, and why in the same log findings
 * use, so one query answers "what has anyone decided about this system".
 */
async function logClassification(
  workspaceId: string | undefined,
  key: string,
  cls: string,
  rationale: string | undefined,
  actorId: string | undefined,
  actorName: string | undefined
): Promise<void> {
  if (!workspaceId || !supabaseAdmin) return;
  const findingId = "resource:" + key;
  try {
    await supabaseAdmin.rpc("upsert_finding_from_scan", {
      p_workspace_id: workspaceId,
      p_finding_id: findingId,
      p_severity: cls === "patient" || cls === "money" ? "medium" : "low",
      p_title: key + " classified as " + cls,
      p_detail: rationale ?? null,
      p_source: "resources",
      p_agent_file: null,
    });
    await supabaseAdmin.rpc("append_finding_log", {
      p_workspace_id: workspaceId,
      p_finding_id: findingId,
      p_entry: {
        at: new Date().toISOString(),
        actor: actorId ?? null,
        actor_name: actorName ?? "unknown",
        kind: "state",
        from: null,
        to: cls,
        text: rationale ?? null,
      },
    });
  } catch {
    // Classification must not fail because the log is unavailable.
  }
}

resourceClassifyRoutes.post("/resources/classify", optionalUser, async (req: Request, res: Response) => {
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

    const workspaceId = req.body?.workspaceId;
    const rationale = req.body?.rationale;
    const user = (req as any).user;
    for (const u of updates) {
      const key = typeof u?.key === "string" ? u.key.toLowerCase() : "";
      if (!key || !CLASSES.has(u?.class)) continue;
      await logClassification(workspaceId, key, u.class, rationale, user?.id, user?.email);
    }
    res.json({ ok: true, classify: cfg });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
