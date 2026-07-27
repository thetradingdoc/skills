/**
 * Persist / evaluate reach.rules and baseline for the Guard view.
 */
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateReachRules,
  generateStarterRules,
  loadBaseline,
  writeBaseline,
  baselineKey,
  type ReachBaseline,
} from "../../../scripts/reach-rules.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RULES_PATH = path.join(REPO_ROOT, "reach.rules");

export const reachRulesRoutes = Router();

reachRulesRoutes.get("/reach/rules", (_req: Request, res: Response) => {
  try {
    const text = fs.existsSync(RULES_PATH)
      ? fs.readFileSync(RULES_PATH, "utf8")
      : "";
    const baseline = loadBaseline(REPO_ROOT);
    res.json({ rules: text, baseline, path: "reach.rules" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

reachRulesRoutes.put("/reach/rules", (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.rules === "string" ? req.body.rules : null;
    if (text == null) {
      res.status(400).json({ error: "rules string required" });
      return;
    }
    fs.writeFileSync(RULES_PATH, text, "utf8");
    res.json({ ok: true, path: "reach.rules" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

reachRulesRoutes.post("/reach/evaluate", (req: Request, res: Response) => {
  try {
    const agents = req.body?.agents;
    if (!agents || !Array.isArray(agents.agents)) {
      res.status(400).json({ error: "agents inventory required" });
      return;
    }
    let rulesText =
      typeof req.body?.rules === "string"
        ? req.body.rules
        : fs.existsSync(RULES_PATH)
          ? fs.readFileSync(RULES_PATH, "utf8")
          : "";
    if (!rulesText.trim()) {
      rulesText = generateStarterRules(agents);
      fs.writeFileSync(RULES_PATH, rulesText, "utf8");
    }
    const report = evaluateReachRules(agents, rulesText, REPO_ROOT);
    const baseline = loadBaseline(REPO_ROOT);
    res.json({
      ...report,
      rules: rulesText,
      baseline,
      evaluations: report.evaluations.map((e) => ({
        ...e,
        baselined:
          e.status === "FAIL" &&
          (baseline.baselinedFailures.includes(e.rule.raw) ||
            baseline.baselinedFailures.includes(baselineKey(e.rule, e.claim))),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

reachRulesRoutes.post("/reach/baseline", (req: Request, res: Response) => {
  try {
    const mode = req.body?.mode;
    const baseline = loadBaseline(REPO_ROOT);
    if (mode === "clear") {
      baseline.baselinedFailures = [];
      writeBaseline(REPO_ROOT, baseline);
      res.json({ ok: true, baseline });
      return;
    }
    // mark current failures as pre-existing
    const keys: string[] = Array.isArray(req.body?.keys) ? req.body.keys : [];
    if (keys.length === 0 && Array.isArray(req.body?.rules)) {
      for (const r of req.body.rules) {
        if (typeof r === "string") baseline.baselinedFailures.push(r);
      }
    } else {
      for (const k of keys) baseline.baselinedFailures.push(k);
    }
    baseline.baselinedFailures = [...new Set(baseline.baselinedFailures)];
    writeBaseline(REPO_ROOT, baseline);
    res.json({ ok: true, baseline });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
