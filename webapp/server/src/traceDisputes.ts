/**
 * Persist reach-matrix disputes to trace-disputes.json (local file, no accounts).
 */
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DISPUTES_PATH = path.join(REPO_ROOT, "trace-disputes.json");
const PUBLIC_COPY = path.join(REPO_ROOT, "webapp/client/public/trace-disputes.json");

export type TraceDispute = {
  tool: string;
  resource: string;
  claim: string;
  agent?: string;
  class?: string;
  reason?: string;
  at: string;
};

type DisputesFile = {
  version: number;
  description: string;
  disputes: TraceDispute[];
};

function readDisputes(): DisputesFile {
  if (!fs.existsSync(DISPUTES_PATH)) {
    return {
      version: 1,
      description:
        "Human disputes of Reach matrix claims. Highest-value accuracy signal — no accounts.",
      disputes: [],
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DISPUTES_PATH, "utf8"));
    return {
      version: raw.version ?? 1,
      description: raw.description ?? "",
      disputes: Array.isArray(raw.disputes) ? raw.disputes : [],
    };
  } catch {
    return {
      version: 1,
      description: "Human disputes of Reach matrix claims.",
      disputes: [],
    };
  }
}

function writeDisputes(file: DisputesFile): void {
  const text = JSON.stringify(file, null, 2) + "\n";
  fs.writeFileSync(DISPUTES_PATH, text, "utf8");
  try {
    fs.mkdirSync(path.dirname(PUBLIC_COPY), { recursive: true });
    fs.writeFileSync(PUBLIC_COPY, text, "utf8");
  } catch {
    /* optional */
  }
}

export const traceDisputesRoutes = Router();

traceDisputesRoutes.get("/resources/disputes", (_req: Request, res: Response) => {
  try {
    res.json(readDisputes());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

traceDisputesRoutes.post("/resources/disputes", (req: Request, res: Response) => {
  try {
    const tool = typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
    const resource =
      typeof req.body?.resource === "string" ? req.body.resource.trim() : "";
    const claim = typeof req.body?.claim === "string" ? req.body.claim.trim() : "";
    if (!tool || !resource || !claim) {
      res.status(400).json({ error: "tool, resource, and claim are required" });
      return;
    }
    const file = readDisputes();
    const entry: TraceDispute = {
      tool,
      resource,
      claim,
      agent: typeof req.body?.agent === "string" ? req.body.agent : undefined,
      class: typeof req.body?.class === "string" ? req.body.class : undefined,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      at: new Date().toISOString(),
    };
    file.disputes.push(entry);
    writeDisputes(file);
    res.json({ ok: true, disputes: file });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
