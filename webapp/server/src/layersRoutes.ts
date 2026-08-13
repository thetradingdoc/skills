import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { requireUser } from "./middleware/requireUser.js";

/**
 * architecture.layers.apply.json shape, duplicated from
 * scripts/architecture-layers.ts rather than imported — that module pulls in
 * the full agent-layers/agent-inventory detection chain, which is more than
 * this route needs to read and write one small JSON file beside the repo.
 */
type ApplicabilityState = "not_applicable" | "working" | "built_unconnected" | "absent";

type ApplicabilityDoc = {
  version: number;
  layers: Record<
    string,
    { state: ApplicabilityState; reason?: string; updated_at?: string; updated_by?: string }
  >;
};

function applicabilityPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), "architecture.layers.apply.json");
}

function loadApplicability(repoRoot: string): ApplicabilityDoc {
  try {
    const raw = JSON.parse(fs.readFileSync(applicabilityPath(repoRoot), "utf8"));
    if (raw && typeof raw === "object") {
      return {
        version: raw.version ?? 1,
        layers: raw.layers && typeof raw.layers === "object" ? raw.layers : {},
      };
    }
  } catch {
    /* absent or malformed — treat as no declarations yet */
  }
  return { version: 1, layers: {} };
}

function saveApplicability(repoRoot: string, doc: ApplicabilityDoc): void {
  fs.writeFileSync(applicabilityPath(repoRoot), JSON.stringify(doc, null, 2) + "\n", "utf8");
}

const VALID_STATES: ApplicabilityState[] = [
  "not_applicable",
  "working",
  "built_unconnected",
  "absent",
];

/**
 * Re-merge a declared override onto the cached architecture.layers.json so a
 * refetch shows it immediately, without waiting for the next scan to rebuild
 * the whole document. Best-effort: the applicability file already saved is
 * the source of truth, so a failure here is not fatal.
 */
function remergeDeclaredIntoCachedDoc(
  repoRoot: string,
  layerId: string,
  declared: { state: ApplicabilityState; reason?: string }
): void {
  const file = path.join(path.resolve(repoRoot), "architecture.layers.json");
  if (!fs.existsSync(file)) return;

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.layers)) return;

  const layer = parsed.layers.find((l: any) => l?.id === layerId);
  if (!layer) return;

  const detectedState: string = layer.detected?.state ?? layer.state;
  layer.declared = { state: declared.state, reason: declared.reason };

  if (declared.state === "not_applicable") {
    layer.state = "not_applicable";
    layer.summary = declared.reason || `${layer.name ?? layerId} marked not applicable for this system.`;
  } else if (declared.state !== detectedState) {
    layer.state = declared.state;
    layer.summary = `${declared.reason || `Declared ${declared.state}`} (detector saw ${detectedState}).`;
  } else {
    layer.state = detectedState;
  }

  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}

/**
 * The layer assessment, read from the repository being scanned.
 *
 * Hand-written for now. The point of serving it before any detector exists is
 * to find out whether the ten-layer view says more than the findings dashboard
 * does — if it does not, this file is the whole cost of finding out.
 *
 * Kept in the repository rather than the database for the same reason
 * resources.classify.json is: an assessment is a judgement about a codebase and
 * belongs beside it, where it can be reviewed in a diff.
 */

const router = Router();

router.get("/layers", requireUser, (req, res) => {
  const projectRoot = String(req.query.projectRoot || "").trim();

  if (!projectRoot) {
    res.status(400).json({ error: "projectRoot is required" });
    return;
  }

  const file = path.join(path.resolve(projectRoot), "architecture.layers.json");

  if (!fs.existsSync(file)) {
    // Absent is a normal answer, not an error — most repositories will not have
    // one, and the view should say so plainly rather than showing a failure.
    res.json({
      present: false,
      reason: "No architecture.layers.json in this repository.",
    });
    return;
  }

  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.layers)) {
      res.json({
        present: false,
        reason: "architecture.layers.json has no layers array.",
      });
      return;
    }

    res.json({ present: true, ...parsed });
  } catch (err) {
    // A malformed file is worth reporting as malformed. Returning "absent"
    // would hide a typo behind a message that reads as a normal state.
    res.json({
      present: false,
      reason:
        "architecture.layers.json could not be read: " +
        (err instanceof Error ? err.message : String(err)),
    });
  }
});

router.patch("/layers/applicability", requireUser, (req, res) => {
  const projectRoot = String(req.body?.projectRoot || "").trim();
  const layerId = String(req.body?.layerId || "").trim();
  const state = req.body?.state as ApplicabilityState | undefined;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;

  if (!projectRoot) {
    res.status(400).json({ error: "projectRoot is required" });
    return;
  }
  if (!layerId) {
    res.status(400).json({ error: "layerId is required" });
    return;
  }
  if (!state || !VALID_STATES.includes(state)) {
    res.status(400).json({ error: `state must be one of ${VALID_STATES.join(", ")}` });
    return;
  }

  try {
    const doc = loadApplicability(projectRoot);
    doc.layers[layerId] = {
      state,
      reason,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.email ?? req.user?.id,
    };
    saveApplicability(projectRoot, doc);
    try {
      // Best-effort: keeps the cached doc in sync so the client's refetch of
      // GET /api/layers reflects this declaration before the next scan.
      remergeDeclaredIntoCachedDoc(projectRoot, layerId, { state, reason });
    } catch {
      /* architecture.layers.json will still catch up on the next scan */
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error:
        "Could not write architecture.layers.apply.json: " +
        (err instanceof Error ? err.message : String(err)),
    });
  }
});

export { router as layersRoutes };
