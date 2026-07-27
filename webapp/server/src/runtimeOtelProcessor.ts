/**
 * Processes OTLP/OpenTelemetry spans into WorkspaceRuntimeSnapshot format.
 * Maps spans onto graph nodes/edges by archNodeId or service.name.
 */
import type { ArchGraph } from "../../../src/types.js";

export interface ParsedSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  archNodeId?: string;
  serviceName?: string;
  durationMs?: number;
  statusCode?: number;
  statusError?: boolean;
}

function getAttr(sp: { attributes?: Array<{ key?: string; value?: { stringValue?: string; intValue?: string } }> }, key: string): string | undefined {
  const a = sp.attributes?.find((x) => x.key === key);
  return a?.value?.stringValue;
}

function getAttrInt(sp: { attributes?: Array<{ key?: string; value?: { intValue?: string } }> }, key: string): number | undefined {
  const a = sp.attributes?.find((x) => x.key === key);
  const v = a?.value?.intValue;
  return v != null ? parseInt(v, 10) : undefined;
}

/** Extract spans from OTLP resourceSpans with full metadata. */
export function extractSpansFromOtlp(payload: unknown): ParsedSpan[] {
  const out: ParsedSpan[] = [];
  if (!payload || typeof payload !== "object") return out;
  const rs = (payload as { resourceSpans?: unknown[] }).resourceSpans;
  if (!Array.isArray(rs)) return out;
  for (const r of rs) {
    const resource = r as { resource?: { attributes?: Array<{ key?: string; value?: { stringValue?: string } }> }; scopeSpans?: unknown[] };
    const serviceName = resource.resource?.attributes?.find((a) => a.key === "service.name")?.value?.stringValue;
    const ss = resource.scopeSpans;
    if (!Array.isArray(ss)) continue;
    for (const s of ss) {
      const spans = (s as { spans?: unknown[] }).spans;
      if (!Array.isArray(spans)) continue;
      for (const sp of spans) {
        const s = sp as {
          traceId?: string;
          spanId?: string;
          parentSpanId?: string;
          name?: string;
          startTimeUnixNano?: string;
          endTimeUnixNano?: string;
          duration?: string;
          status?: { code?: number; message?: string };
          attributes?: Array<{ key?: string; value?: { stringValue?: string; intValue?: string } }>;
        };
        const archNodeId = getAttr(s, "archNodeId") ?? getAttr(s, "arch.node.id");
        const startNs = s.startTimeUnixNano ? parseInt(String(s.startTimeUnixNano), 10) : undefined;
        const endNs = s.endTimeUnixNano ? parseInt(String(s.endTimeUnixNano), 10) : undefined;
        const durationNs = s.duration ? parseFloat(String(s.duration)) : undefined;
        const durationMs =
          startNs != null && endNs != null
            ? (endNs - startNs) / 1e6
            : durationNs != null
              ? durationNs / 1e6
              : undefined;
        const statusCode = s.status?.code;
        const statusError = statusCode === 1 || (s.status?.message && s.status.message.length > 0);
        out.push({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId && s.parentSpanId !== "" ? s.parentSpanId : undefined,
          name: s.name,
          archNodeId,
          serviceName: archNodeId ? undefined : serviceName,
          durationMs,
          statusCode,
          statusError,
        });
      }
    }
  }
  return out;
}

/** Simplified format. */
export function extractSpansFromSimple(payload: unknown): ParsedSpan[] {
  const s = (payload as { spans?: unknown[] }).spans;
  if (!Array.isArray(s)) return [];
  return s
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const sp = x as Record<string, unknown>;
      return {
        traceId: typeof sp.traceId === "string" ? sp.traceId : undefined,
        spanId: typeof sp.spanId === "string" ? sp.spanId : undefined,
        parentSpanId: typeof sp.parentSpanId === "string" && sp.parentSpanId ? sp.parentSpanId : undefined,
        name: typeof sp.name === "string" ? sp.name : undefined,
        archNodeId: typeof sp.archNodeId === "string" ? sp.archNodeId : undefined,
        serviceName: typeof sp.serviceName === "string" ? sp.serviceName : undefined,
        durationMs: typeof sp.durationMs === "number" ? sp.durationMs : undefined,
        statusCode: typeof sp.statusCode === "number" ? sp.statusCode : undefined,
        statusError: sp.statusError === true,
      };
    });
}

/** Resolve span's archNodeId/serviceName to graph node id. */
function resolveNodeId(span: ParsedSpan, graph: ArchGraph): string | null {
  const id = span.archNodeId ?? span.serviceName;
  if (!id) return null;
  const byArch = graph.nodes.find((n) => n.archNodeId === id || n.id === id || n.path === id);
  if (byArch) return byArch.id;
  const byPath = graph.nodes.find((n) => n.path?.includes(id) || id?.includes(n.path ?? ""));
  if (byPath) return byPath.id;
  return null;
}

/** Build edge key to match scanner format (source-->target). */
function edgeKey(source: string, target: string): string {
  return `${source}-->${target}`;
}

export interface RuntimeSnapshotResult {
  nodes: Record<string, { errorRate?: number; throughputPerMin?: number }>;
  edges: Record<string, { latencyMs?: number; errorRate?: number; throughputPerMin?: number; flowKind?: "dependency" | "runtime_path" | "event" | "job" }>;
}

/**
 * Process parsed spans and merge with static graph to produce runtime snapshot.
 * - Maps archNodeId/serviceName to graph node ids
 * - Infers edges from parent→child span relations (runtime service map sync)
 * - Only includes metrics for nodes/edges that exist in the graph
 */
export function processSpansToSnapshot(
  spans: ParsedSpan[],
  graph: ArchGraph
): RuntimeSnapshotResult {
  const nodeIdBySpanId = new Map<string, string>();
  const spanById = new Map<string, ParsedSpan>();

  for (const sp of spans) {
    if (sp.spanId) spanById.set(sp.spanId, sp);
    const nid = resolveNodeId(sp, graph);
    if (nid && sp.spanId) nodeIdBySpanId.set(sp.spanId, nid);
  }

  const graphNodeIds = new Set(graph.nodes.map((n) => n.id));
  const graphEdgeKeys = new Set(
    graph.edges.map((e) => edgeKey(e.source, e.target))
  );

  const nodeSamples: Record<string, { errors: number; total: number }> = {};
  const edgeSamples: Record<string, { latencies: number[]; errors: number; total: number }> = {};

  for (const sp of spans) {
    const nid = sp.spanId ? nodeIdBySpanId.get(sp.spanId) : resolveNodeId(sp, graph);
    if (!nid || !graphNodeIds.has(nid)) continue;

    if (!nodeSamples[nid]) nodeSamples[nid] = { errors: 0, total: 0 };
    nodeSamples[nid].total += 1;
    if (sp.statusError || sp.statusCode === 1) nodeSamples[nid].errors += 1;

    if (sp.parentSpanId) {
      const parentNid = nodeIdBySpanId.get(sp.parentSpanId);
      if (parentNid && parentNid !== nid && graphNodeIds.has(parentNid)) {
        const key = edgeKey(parentNid, nid);
        if (graphEdgeKeys.has(key)) {
          if (!edgeSamples[key]) edgeSamples[key] = { latencies: [], errors: 0, total: 0 };
          edgeSamples[key].total += 1;
          if (sp.durationMs != null) edgeSamples[key].latencies.push(sp.durationMs);
          if (sp.statusError || sp.statusCode === 1) edgeSamples[key].errors += 1;
        }
      }
    }
  }

  const nodes: Record<string, { errorRate?: number; throughputPerMin?: number }> = {};
  for (const [nid, s] of Object.entries(nodeSamples)) {
    if (s.total === 0) continue;
    nodes[nid] = {
      errorRate: s.errors / s.total,
      throughputPerMin: s.total, // simple count; caller can scale by time window
    };
  }

  const edges: Record<string, { latencyMs?: number; errorRate?: number; throughputPerMin?: number; flowKind?: "runtime_path" }> = {};
  for (const [key, s] of Object.entries(edgeSamples)) {
    if (s.total === 0) continue;
    const latencyMs =
      s.latencies.length > 0
        ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length
        : undefined;
    edges[key] = {
      latencyMs,
      errorRate: s.errors / s.total,
      throughputPerMin: s.total,
      flowKind: "runtime_path", // Inferred from OTEL parent-child spans
    };
  }

  return { nodes, edges };
}
