import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { requireUser } from "./middleware/requireUser.js";

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

export { router as layersRoutes };
