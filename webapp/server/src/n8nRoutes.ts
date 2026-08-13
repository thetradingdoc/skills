/**
 * n8n preview (map-only, no persist) — demo path for import → canvas.
 * POST /api/n8n/preview  { workflow | workflows, materializeVariantKey? }
 */
import { Router } from "express";
import {
  detectVariantKey,
  mapWorkflow,
  mapWorkflowVariants,
  toArchGraph,
  type MapWorkflowResult,
} from "./n8n/index.js";
import { evaluateN8nWorkflow } from "./rules/n8n/index.js";

export const n8nRoutes = Router();

n8nRoutes.post("/n8n/preview", (req, res) => {
  try {
    const body = req.body ?? {};
    const materializeVariantKey =
      typeof body.materializeVariantKey === "string"
        ? body.materializeVariantKey
        : undefined;

    let mapped: MapWorkflowResult[] = [];

    if (Array.isArray(body.workflows)) {
      mapped = mapWorkflowVariants(
        body.workflows.map((w: { raw?: unknown; variantKey?: string; workflow?: unknown }) => ({
          raw: w.raw ?? w.workflow ?? w,
          variantKey: w.variantKey,
        })),
        materializeVariantKey
      );
    } else if (body.workflow != null || body.raw != null) {
      const raw = body.workflow ?? body.raw;
      const vk = body.variantKey ?? detectVariantKey(raw);
      mapped = [
        mapWorkflow(raw, {
          variantKey: vk,
          materializeVariantKey: materializeVariantKey ?? vk,
        }),
      ];
    } else {
      res.status(400).json({ error: "Provide workflow or workflows[]" });
      return;
    }

    const graph = toArchGraph(mapped);
    const findings = mapped.flatMap((m) => {
      // Evaluate against original-shaped sanitized raw (still has nodes/connections)
      return evaluateN8nWorkflow(m.sanitizedRaw).map((f) => ({
        ...f,
        variantKey: m.variantKey,
      }));
    });

    res.json({
      graph,
      variants: mapped.map((m) => ({
        workflowId: m.workflowId,
        workflowName: m.workflowName,
        variantKey: m.variantKey,
        materialize: m.materialize,
        versionId: m.versionId,
        nodeCount: m.nodes.length,
        groupCount: m.groups.length,
        edgeCount: m.edges.length,
        integrations: m.integrations,
        unknownTypes: m.unknownTypes,
        // Never return pinData — sanitizedRaw already stripped
        hasPinDataStripped: true,
      })),
      findings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[n8n/preview]", msg);
    res.status(500).json({ error: msg });
  }
});
