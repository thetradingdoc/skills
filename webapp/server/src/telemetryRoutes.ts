/**
 * Telemetry API — OTLP/OpenTelemetry span ingestion.
 * Accepts OTLP HTTP JSON (v1/traces) and appends to a JSONL file for telemetry_tail.
 */
import { Router } from "express";
import * as fs from "fs";
import * as path from "path";

const router = Router();

function getSpansPath(rootOverride?: string): string {
  const base = process.env.ARCHY_SPANS_PATH?.trim();
  if (base) return base;
  const root = rootOverride ?? process.cwd();
  return path.join(root, "logs", "spans.jsonl");
}

/** Extract spans from OTLP JSON resourceSpans/scopeSpans/spans structure. */
function extractSpansFromOtlp(payload: unknown): Array<{ traceId?: string; spanId?: string; name?: string; archNodeId?: string }> {
  const out: Array<{ traceId?: string; spanId?: string; name?: string; archNodeId?: string }> = [];
  if (!payload || typeof payload !== "object") return out;
  const rs = (payload as { resourceSpans?: unknown[] }).resourceSpans;
  if (!Array.isArray(rs)) return out;
  for (const r of rs) {
    const ss = (r as { scopeSpans?: unknown[] }).scopeSpans;
    if (!Array.isArray(ss)) continue;
    for (const s of ss) {
      const spans = (s as { spans?: unknown[] }).spans;
      if (!Array.isArray(spans)) continue;
      for (const sp of spans) {
        const s = sp as { traceId?: string; spanId?: string; name?: string; attributes?: Array<{ key?: string; value?: { stringValue?: string } }> };
        const archNodeId = s.attributes?.find((a) => a.key === "archNodeId")?.value?.stringValue;
        out.push({
          traceId: s.traceId,
          spanId: s.spanId,
          name: s.name,
          ...(archNodeId ? { archNodeId } : {}),
        });
      }
    }
  }
  return out;
}

/** Simplified format: { spans: [{ traceId, spanId, name, archNodeId? }] } */
function extractSpansFromSimple(payload: unknown): Array<{ traceId?: string; spanId?: string; name?: string; archNodeId?: string }> {
  const s = (payload as { spans?: unknown[] }).spans;
  if (!Array.isArray(s)) return [];
  return s
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const sp = x as Record<string, unknown>;
      return {
        traceId: typeof sp.traceId === "string" ? sp.traceId : undefined,
        spanId: typeof sp.spanId === "string" ? sp.spanId : undefined,
        name: typeof sp.name === "string" ? sp.name : undefined,
        archNodeId: typeof sp.archNodeId === "string" ? sp.archNodeId : undefined,
      };
    });
}

router.post("/telemetry/otlp", (req, res) => {
  try {
    const payload = req.body;
    let spans = extractSpansFromOtlp(payload);
    if (spans.length === 0) {
      spans = extractSpansFromSimple(payload);
    }
    if (spans.length === 0) {
      res.status(400).json({
        error: "No spans found. Send OTLP resourceSpans or { spans: [...] }.",
      });
      return;
    }
    const spansPath = getSpansPath();
    const dir = path.dirname(spansPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const ts = new Date().toISOString();
    for (const sp of spans) {
      const line = JSON.stringify({ ts, ...sp }) + "\n";
      fs.appendFileSync(spansPath, line, "utf-8");
    }
    res.json({ accepted: spans.length, path: spansPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export { router as telemetryRoutes };
