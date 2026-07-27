var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/runtimeOtelProcessor.ts
var runtimeOtelProcessor_exports = {};
__export(runtimeOtelProcessor_exports, {
  extractSpansFromOtlp: () => extractSpansFromOtlp,
  extractSpansFromSimple: () => extractSpansFromSimple,
  processSpansToSnapshot: () => processSpansToSnapshot
});
function getAttr(sp, key) {
  const a = sp.attributes?.find((x) => x.key === key);
  return a?.value?.stringValue;
}
function extractSpansFromOtlp(payload) {
  const out = [];
  if (!payload || typeof payload !== "object") return out;
  const rs = payload.resourceSpans;
  if (!Array.isArray(rs)) return out;
  for (const r of rs) {
    const resource = r;
    const serviceName = resource.resource?.attributes?.find((a) => a.key === "service.name")?.value?.stringValue;
    const ss = resource.scopeSpans;
    if (!Array.isArray(ss)) continue;
    for (const s of ss) {
      const spans = s.spans;
      if (!Array.isArray(spans)) continue;
      for (const sp of spans) {
        const s2 = sp;
        const archNodeId = getAttr(s2, "archNodeId") ?? getAttr(s2, "arch.node.id");
        const startNs = s2.startTimeUnixNano ? parseInt(String(s2.startTimeUnixNano), 10) : void 0;
        const endNs = s2.endTimeUnixNano ? parseInt(String(s2.endTimeUnixNano), 10) : void 0;
        const durationNs = s2.duration ? parseFloat(String(s2.duration)) : void 0;
        const durationMs = startNs != null && endNs != null ? (endNs - startNs) / 1e6 : durationNs != null ? durationNs / 1e6 : void 0;
        const statusCode = s2.status?.code;
        const statusError = statusCode === 1 || s2.status?.message && s2.status.message.length > 0;
        out.push({
          traceId: s2.traceId,
          spanId: s2.spanId,
          parentSpanId: s2.parentSpanId && s2.parentSpanId !== "" ? s2.parentSpanId : void 0,
          name: s2.name,
          archNodeId,
          serviceName: archNodeId ? void 0 : serviceName,
          durationMs,
          statusCode,
          statusError
        });
      }
    }
  }
  return out;
}
function extractSpansFromSimple(payload) {
  const s = payload.spans;
  if (!Array.isArray(s)) return [];
  return s.filter((x) => x && typeof x === "object").map((x) => {
    const sp = x;
    return {
      traceId: typeof sp.traceId === "string" ? sp.traceId : void 0,
      spanId: typeof sp.spanId === "string" ? sp.spanId : void 0,
      parentSpanId: typeof sp.parentSpanId === "string" && sp.parentSpanId ? sp.parentSpanId : void 0,
      name: typeof sp.name === "string" ? sp.name : void 0,
      archNodeId: typeof sp.archNodeId === "string" ? sp.archNodeId : void 0,
      serviceName: typeof sp.serviceName === "string" ? sp.serviceName : void 0,
      durationMs: typeof sp.durationMs === "number" ? sp.durationMs : void 0,
      statusCode: typeof sp.statusCode === "number" ? sp.statusCode : void 0,
      statusError: sp.statusError === true
    };
  });
}
function resolveNodeId(span, graph) {
  const id = span.archNodeId ?? span.serviceName;
  if (!id) return null;
  const byArch = graph.nodes.find((n) => n.archNodeId === id || n.id === id || n.path === id);
  if (byArch) return byArch.id;
  const byPath = graph.nodes.find((n) => n.path?.includes(id) || id?.includes(n.path ?? ""));
  if (byPath) return byPath.id;
  return null;
}
function edgeKey(source, target) {
  return `${source}-->${target}`;
}
function processSpansToSnapshot(spans, graph) {
  const nodeIdBySpanId = /* @__PURE__ */ new Map();
  const spanById = /* @__PURE__ */ new Map();
  for (const sp of spans) {
    if (sp.spanId) spanById.set(sp.spanId, sp);
    const nid = resolveNodeId(sp, graph);
    if (nid && sp.spanId) nodeIdBySpanId.set(sp.spanId, nid);
  }
  const graphNodeIds = new Set(graph.nodes.map((n) => n.id));
  const graphEdgeKeys = new Set(
    graph.edges.map((e) => edgeKey(e.source, e.target))
  );
  const nodeSamples = {};
  const edgeSamples = {};
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
  const nodes = {};
  for (const [nid, s] of Object.entries(nodeSamples)) {
    if (s.total === 0) continue;
    nodes[nid] = {
      errorRate: s.errors / s.total,
      throughputPerMin: s.total
      // simple count; caller can scale by time window
    };
  }
  const edges = {};
  for (const [key, s] of Object.entries(edgeSamples)) {
    if (s.total === 0) continue;
    const latencyMs = s.latencies.length > 0 ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : void 0;
    edges[key] = {
      latencyMs,
      errorRate: s.errors / s.total,
      throughputPerMin: s.total,
      flowKind: "runtime_path"
      // Inferred from OTEL parent-child spans
    };
  }
  return { nodes, edges };
}
var init_runtimeOtelProcessor = __esm({
  "src/runtimeOtelProcessor.ts"() {
    "use strict";
  }
});

// src/loadEnv.ts
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var envPaths = [
  // Prefer server-local env when launched from repo root.
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../../../webapp/server/.env")
];
for (const p of Array.from(new Set(envPaths))) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}
if (process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY.trim();
}

// src/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = process.env.SUPABASE_URL?.trim();
var serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
var supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
}) : null;

// ../../src/agent/traceLogger.ts
var sessionId = "";
var subscriber = null;
var agentSubscriber = null;
var agentTraces = [];
var traceContext = {};
var agentTraceSink = null;
function setAgentTraceSink(cb) {
  agentTraceSink = cb;
}
function getTraceContext() {
  return { ...traceContext };
}
function generateId() {
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
function getSessionId() {
  return sessionId;
}
function emitLegacyTrace(stepType, input, output, decision, opts) {
  const entry = {
    id: generateId(),
    sessionId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    stepType,
    input,
    output,
    decision,
    ...opts
  };
  subscriber?.(entry);
  return entry;
}
function emitAgentTrace(entry) {
  const merged = {
    ...entry,
    railId: entry.railId ?? traceContext.railId,
    taskId: entry.taskId ?? traceContext.taskId,
    metadata: {
      ...entry.metadata,
      logicPathStep: entry.metadata?.logicPathStep ?? traceContext.logicPathStep,
      filePath: entry.metadata?.filePath ?? traceContext.filePath
    }
  };
  const full = {
    id: generateId(),
    timestamp: Date.now(),
    ...merged
  };
  agentTraces.push(full);
  agentSubscriber?.(full);
  agentTraceSink?.(full);
  return full;
}
function getAgentTraces() {
  return agentTraces.slice();
}
function emitTrace(a, b, c, d, e) {
  if (a && typeof a === "object" && typeof a.message === "string") {
    return emitAgentTrace(a);
  }
  return emitLegacyTrace(a, b ?? {}, c ?? {}, d ?? "", e);
}

// src/taskSessionLog.ts
function newEntry(type, payload) {
  return { ts: (/* @__PURE__ */ new Date()).toISOString(), type, payload };
}
async function appendTodoSessionLog(todoId, type, payload) {
  if (!supabaseAdmin) return;
  const entry = newEntry(type, payload);
  try {
    const { error } = await supabaseAdmin.rpc("append_todo_session_log", {
      p_todo_id: todoId,
      p_entry: entry
    });
    if (!error) return;
  } catch {
  }
  try {
    const { data } = await supabaseAdmin.from("todos").select("session_log").eq("id", todoId).maybeSingle();
    const prev = Array.isArray(data?.session_log) ? data.session_log : [];
    await supabaseAdmin.from("todos").update({ session_log: [...prev, entry] }).eq("id", todoId);
  } catch {
  }
}
async function appendTodoSessionLogByRailId(railId, type, payload) {
  if (!supabaseAdmin) return;
  try {
    const { data } = await supabaseAdmin.from("todos").select("id").eq("rail_id", railId).maybeSingle();
    if (data?.id) await appendTodoSessionLog(data.id, type, payload);
  } catch {
  }
}
async function setTodoStatusByRailId(railId, status, extra) {
  if (!supabaseAdmin) return;
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await supabaseAdmin.from("todos").update({ status, updated_at: now }).eq("rail_id", railId);
    await appendTodoSessionLogByRailId(railId, "status_change", { status, ...extra });
  } catch {
  }
}
function registerTodoSessionLogSink() {
  setAgentTraceSink((trace) => {
    if (!trace.railId) return;
    const type = trace.type === "tool_call" ? "tool_call" : trace.type === "error" ? "error" : trace.type === "critic_feedback" ? "critic" : "agent";
    void appendTodoSessionLogByRailId(trace.railId, type, {
      message: trace.message?.slice(0, 2e3),
      role: trace.role,
      filePath: trace.metadata?.filePath,
      logicPathStep: trace.metadata?.logicPathStep
    });
  });
}

// src/index.ts
import path42 from "path";
import { fileURLToPath as fileURLToPath7 } from "url";
import fs35 from "fs";
import express3 from "express";
import cors from "cors";

// src/scan.ts
import { Router as Router3 } from "express";
import { execFileSync } from "child_process";
import * as fs7 from "fs";
import * as path7 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/middleware/optionalUser.ts
import * as jose from "jose";

// src/authDebug.ts
var DEBUG = process.env.DEBUG_AUTH === "true";
function logAuth(middleware, opts) {
  if (!DEBUG) return;
  const parts = [`[Auth] ${middleware}`];
  if (opts.hasToken) {
    parts.push(`token:${opts.tokenPreview ?? "***"}`);
  } else {
    parts.push("no token");
  }
  if (opts.success !== void 0) {
    parts.push(opts.success ? "ok" : "fail");
  }
  if (opts.userId) parts.push(`user=${opts.userId}`);
  if (opts.method) parts.push(`method=${opts.method}`);
  if (opts.error) parts.push(`error=${opts.error}`);
  if (opts.errorCode) parts.push(`code=${opts.errorCode}`);
  if (opts.networkError) parts.push("network_error");
  console.log(parts.join(" | "));
}

// src/middleware/optionalUser.ts
async function optionalUser(req, _res, next) {
  const supabaseUrl3 = process.env.SUPABASE_URL?.trim();
  const authHeader2 = req.header("authorization") || req.header("Authorization");
  const token = authHeader2?.startsWith("Bearer ") ? authHeader2.slice("Bearer ".length).trim() : "";
  if (!token) {
    logAuth("optionalUser", { hasToken: false });
    req.user = void 0;
    req.accessToken = void 0;
    next();
    return;
  }
  const tokenPreview = token.length >= 20 ? `${token.slice(0, 10)}...${token.slice(-6)}` : "***";
  if (supabaseAdmin) {
    try {
      const result = await supabaseAdmin.auth.getUser(token);
      const { data, error } = result;
      if (!error && data?.user) {
        logAuth("optionalUser", {
          hasToken: true,
          tokenPreview,
          success: true,
          userId: data.user.id,
          method: "getUser"
        });
        req.user = {
          id: data.user.id,
          email: data.user.email ?? void 0,
          user_metadata: data.user.user_metadata ?? void 0
        };
        req.accessToken = token;
        next();
        return;
      }
    } catch {
    }
  }
  if (supabaseUrl3) {
    try {
      const jwksUrl = `${supabaseUrl3}/auth/v1/.well-known/jwks.json`;
      const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: `${supabaseUrl3}/auth/v1`,
        audience: "authenticated"
      });
      const sub = payload.sub;
      if (sub) {
        logAuth("optionalUser", {
          hasToken: true,
          tokenPreview,
          success: true,
          userId: sub,
          method: "JWKS"
        });
        req.user = {
          id: sub,
          email: payload.email,
          user_metadata: payload.user_metadata
        };
        req.accessToken = token;
        next();
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAuth("optionalUser", {
        hasToken: true,
        tokenPreview,
        success: false,
        error: msg,
        method: "JWKS"
      });
    }
  }
  logAuth("optionalUser", { hasToken: true, tokenPreview, success: false });
  req.user = void 0;
  req.accessToken = void 0;
  next();
}

// src/middleware/requireUser.ts
import * as jose2 from "jose";
var supabaseUrl2 = process.env.SUPABASE_URL?.trim();
async function verifyJwtViaJwks(token) {
  if (!supabaseUrl2) return null;
  const jwksUrl = `${supabaseUrl2}/auth/v1/.well-known/jwks.json`;
  try {
    const JWKS = jose2.createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jose2.jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl2}/auth/v1`,
      audience: "authenticated"
    });
    const sub = payload.sub;
    const email = payload.email;
    const user_metadata = payload.user_metadata;
    return sub ? { sub, email, user_metadata } : null;
  } catch {
    return null;
  }
}
async function requireUser(req, res, next) {
  if (!supabaseAdmin && !supabaseUrl2) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const authHeader2 = req.header("authorization") || req.header("Authorization");
  const token = authHeader2?.startsWith("Bearer ") ? authHeader2.slice("Bearer ".length).trim() : "";
  const devBypass = process.env.CHAT_DEV_BYPASS === "1";
  const host = req.get("host") ?? "";
  const remote = req.socket?.remoteAddress ?? req.ip ?? "";
  const fromLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1" || host.startsWith("localhost") || host.startsWith("127.0.0.1") || req.get("x-forwarded-for")?.includes("127.0.0.1");
  if (!token && devBypass && fromLocalhost) {
    logAuth("requireUser", { devBypass: true });
    req.user = { id: "dev-bypass-user", email: "dev@local" };
    next();
    return;
  }
  if (!token) {
    logAuth("requireUser", { hasToken: false });
    res.status(401).json({ error: "Unauthorized: missing Bearer token" });
    return;
  }
  const tokenPreview = token.length >= 20 ? `${token.slice(0, 10)}...${token.slice(-6)}` : "***";
  if (supabaseAdmin) {
    let result;
    try {
      result = await supabaseAdmin.auth.getUser(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause : null;
      const isNetwork = cause?.message?.includes("ENOTFOUND") || msg?.includes("fetch failed");
      logAuth("requireUser", {
        hasToken: true,
        tokenPreview,
        success: false,
        error: msg,
        networkError: isNetwork
      });
      res.status(503).json({
        error: isNetwork ? "Auth service unavailable. Check your connection and Supabase project status." : "Auth service error"
      });
      return;
    }
    const { data, error } = result;
    if (!error && data?.user) {
      logAuth("requireUser", {
        hasToken: true,
        tokenPreview,
        success: true,
        userId: data.user.id
      });
      req.user = {
        id: data.user.id,
        email: data.user.email ?? void 0,
        user_metadata: data.user.user_metadata ?? void 0
      };
      req.accessToken = token;
      next();
      return;
    }
  }
  const jwtPayload = await verifyJwtViaJwks(token);
  if (jwtPayload) {
    logAuth("requireUser", {
      hasToken: true,
      tokenPreview,
      success: true,
      userId: jwtPayload.sub
    });
    req.user = {
      id: jwtPayload.sub,
      email: jwtPayload.email,
      user_metadata: jwtPayload.user_metadata
    };
    req.accessToken = token;
    next();
    return;
  }
  logAuth("requireUser", {
    hasToken: true,
    tokenPreview,
    success: false,
    error: "getUser failed and JWKS verification failed"
  });
  res.status(401).json({ error: "Unauthorized: invalid token" });
}

// ../../src/ai/nodeEmbeddings.ts
function buildNodeText(node) {
  const parts = [
    node.suggestedLabel ?? node.label,
    node.description ?? "",
    (node.semanticSignals?.exports ?? []).join(" ")
  ];
  return parts.filter(Boolean).join(" ").slice(0, 8e3);
}
async function embedAndPersistNodes(graph, workspaceId, supabase, apiKey) {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return { embedded: 0, failed: graph.nodes.length };
  }
  const OpenAI2 = (await import("openai")).default;
  const client = new OpenAI2({ apiKey: key });
  let embedded = 0;
  let failed = 0;
  for (const node of graph.nodes) {
    const text = buildNodeText(node);
    if (!text.trim()) {
      failed++;
      continue;
    }
    try {
      const { data } = await client.embeddings.create({
        model: "text-embedding-ada-002",
        input: text
      });
      const vec = data.data?.[0]?.embedding;
      if (!vec || vec.length !== 1536) {
        failed++;
        continue;
      }
      const { error } = await supabase.from("node_embeddings").upsert(
        {
          workspace_id: workspaceId,
          node_id: node.id,
          embedding: vec
        },
        { onConflict: "workspace_id,node_id" }
      );
      if (error) {
        failed++;
        if (process.env.METRICS_LOG === "1") {
          console.warn(`[embeddings] upsert failed for ${node.id}:`, error.message);
        }
      } else {
        embedded++;
      }
    } catch (err) {
      failed++;
      if (process.env.METRICS_LOG === "1") {
        console.warn(`[embeddings] embed failed for ${node.id}:`, err);
      }
    }
  }
  return { embedded, failed };
}

// src/utils/deriveProjectKey.ts
function deriveProjectKey(repoUrl) {
  const repoName = (repoUrl.split("/").pop() ?? "").replace(/\.git$/i, "");
  const normalized = repoName.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "").slice(0, 10);
  return normalized.length >= 2 ? normalized : "PROJ";
}
var JIRA_PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9_-]{0,9}$/;
function isValidProjectKey(key) {
  const k = key.trim().toUpperCase();
  return JIRA_PROJECT_KEY_REGEX.test(k) && k.length >= 2 && !/[-_]$/.test(k);
}

// src/violationStore.ts
import crypto2 from "crypto";
function buildViolationFingerprint(v, rulesVersion) {
  const raw = [rulesVersion, v.type, v.sourceNodeId.trim(), (v.targetNodeId ?? "").trim()].join("|").toLowerCase();
  return crypto2.createHash("sha256").update(raw).digest("hex").slice(0, 40);
}
function buildFingerprint(v, rulesVersion) {
  return buildViolationFingerprint(v, rulesVersion);
}
var SEVERITY_ORDER = ["medium", "high", "critical"];
function escalateSeverity(current, newRecurrence) {
  const idx = SEVERITY_ORDER.indexOf(current);
  if (idx === -1) return current;
  if (newRecurrence >= 15 && idx < 2) return "critical";
  if (newRecurrence >= 5 && idx < 1) return "high";
  return current;
}
async function upsertViolations(db, opts) {
  const { workspaceId, violations, rulesVersion, markAbsent = false } = opts;
  if (!workspaceId || !rulesVersion) return [];
  if (violations.length === 0 && !markAbsent) return [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const seenFingerprints = /* @__PURE__ */ new Set();
  const batchByFingerprint = /* @__PURE__ */ new Map();
  for (const v of violations) {
    const fp = buildFingerprint(v, rulesVersion);
    const existing = batchByFingerprint.get(fp);
    if (!existing) {
      batchByFingerprint.set(fp, { violation: v, fingerprint: fp });
    } else {
      const existingSev = existing.violation.severity;
      const incomingSev = v.severity;
      const order = ["low", "medium", "high", "critical"];
      const next = order.indexOf(incomingSev) > order.indexOf(existingSev) ? v : existing.violation;
      batchByFingerprint.set(fp, { violation: next, fingerprint: fp });
    }
  }
  const { data: existingRows } = await db.from("violations").select("id, fingerprint, recurrence_count, policy_state, severity, structural_state, last_seen_at").eq("workspace_id", workspaceId).eq("rules_version", rulesVersion);
  const existingByFingerprint = new Map((existingRows ?? []).map((r) => [r.fingerprint, r]));
  const upsertRows = [];
  for (const { violation: v, fingerprint } of batchByFingerprint.values()) {
    seenFingerprints.add(fingerprint);
    const existing = existingByFingerprint.get(fingerprint);
    const lastSeenAt = existing?.last_seen_at;
    const hoursSince = lastSeenAt != null ? (Date.now() - new Date(lastSeenAt).getTime()) / 36e5 : Number.POSITIVE_INFINITY;
    const shouldBump = hoursSince >= 4;
    const newRecurrence = shouldBump ? (existing?.recurrence_count ?? 0) + 1 : existing?.recurrence_count ?? 1;
    const incomingSeverity = v.severity;
    const escalated = escalateSeverity(incomingSeverity, newRecurrence);
    const existingSeverity = existing?.severity ?? incomingSeverity;
    const severityOrder = ["low", "medium", "high", "critical"];
    const finalSeverity = severityOrder.indexOf(escalated) > severityOrder.indexOf(existingSeverity) ? escalated : existingSeverity;
    const isRegression = existing?.policy_state === "resolved";
    const newPolicyState = isRegression ? "regressed" : existing?.policy_state ?? "new";
    upsertRows.push({
      workspace_id: workspaceId,
      fingerprint,
      rules_version: rulesVersion,
      type: v.type,
      severity: finalSeverity,
      source_node_id: v.sourceNodeId,
      target_node_id: v.targetNodeId ?? null,
      description: v.description ?? null,
      suggested_fix: v.suggestedFix ?? null,
      structural_state: "active",
      last_seen_at: now,
      first_seen_at: now,
      recurrence_count: newRecurrence,
      policy_state: newPolicyState,
      jira_key: existing?.jira_key ?? null,
      jira_status: existing?.jira_status ?? null
    });
  }
  const upserted = [];
  for (const row of upsertRows) {
    try {
      const { data, error } = await db.rpc("bump_violation", {
        p_workspace_id: row.workspace_id,
        p_fingerprint: row.fingerprint,
        p_rules_version: row.rules_version,
        p_type: row.type,
        p_severity: row.severity,
        p_source_node_id: row.source_node_id,
        p_target_node_id: row.target_node_id,
        p_description: row.description,
        p_suggested_fix: row.suggested_fix,
        p_now: now
      });
      if (!error && data) {
        upserted.push(data);
      }
    } catch (err) {
      console.error("[violationStore] bump_violation rpc error:", err);
    }
  }
  if (markAbsent) {
    const { data: freshActive } = await db.from("violations").select("id,fingerprint,structural_state,policy_state").eq("workspace_id", workspaceId).eq("rules_version", rulesVersion).eq("structural_state", "active");
    const activeRows = freshActive ?? [];
    const toMarkAbsent = activeRows.filter(
      (r) => !seenFingerprints.has(r.fingerprint)
    );
    if (toMarkAbsent.length > 0) {
      const idsToAbsent = toMarkAbsent.map((r) => r.id);
      await db.from("violations").update({ structural_state: "absent" }).in("id", idsToAbsent);
      const idsToResolve = toMarkAbsent.filter((r) => ["new", "tracked", "regressed"].includes(r.policy_state)).map((r) => r.id);
      if (idsToResolve.length > 0) {
        await db.from("violations").update({ policy_state: "resolved" }).in("id", idsToResolve);
      }
    }
  }
  return upserted;
}
async function getActiveViolations(db, workspaceId) {
  const { data, error } = await db.from("violations").select("*").eq("workspace_id", workspaceId).eq("structural_state", "active").not("policy_state", "in", '("resolved","waived","accepted")').order("recurrence_count", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function getBlockingViolations(db, workspaceId, nodeIds) {
  if (nodeIds.length === 0) return [];
  const [bySource, byTarget] = await Promise.all([
    db.from("violations").select("*").eq("workspace_id", workspaceId).eq("structural_state", "active").in("policy_state", ["tracked", "regressed"]).in("severity", ["critical", "high"]).in("source_node_id", nodeIds),
    db.from("violations").select("*").eq("workspace_id", workspaceId).eq("structural_state", "active").in("policy_state", ["tracked", "regressed"]).in("severity", ["critical", "high"]).in("target_node_id", nodeIds)
  ]);
  if (bySource.error || byTarget.error) {
    return [];
  }
  const merged = [...bySource.data ?? [], ...byTarget.data ?? []];
  const byId = /* @__PURE__ */ new Map();
  for (const v of merged) {
    byId.set(v.id, v);
  }
  return Array.from(byId.values());
}
async function buildGovernanceNotice(db, workspaceId, nodeIds) {
  const blocking = await getBlockingViolations(db, workspaceId, nodeIds);
  if (!blocking.length) return "";
  const lines = blocking.map((v) => {
    const parts = [];
    parts.push(`[${v.severity.toUpperCase()}] ${v.type}`);
    parts.push(`on ${v.source_node_id}`);
    if (v.target_node_id) parts.push(`\u2192 ${v.target_node_id}`);
    if (v.jira_key) parts.push(`(${v.jira_key})`);
    if (v.policy_state === "regressed") parts.push("REGRESSED");
    return `- ${parts.join(" ")}`;
  });
  return "\n\n\u26A0 GOVERNANCE NOTICE: The following open high/critical violations exist on nodes relevant to this request. Address these before making structural changes:\n" + lines.join("\n") + "\n";
}
async function markViolationResolvedFromJira(db, violationId, jiraStatus) {
  const { data: row } = await db.from("violations").select("id, workspace_id, policy_state").eq("id", violationId).single();
  if (!row || row.policy_state === "resolved") return;
  if (row.workspace_id) {
    try {
      await db.from("violation_policy_events").insert({
        violation_id: violationId,
        workspace_id: row.workspace_id,
        actor_id: null,
        previous_state: row.policy_state ?? null,
        new_state: "resolved",
        reason: "Jira ticket resolved/closed"
      });
    } catch {
    }
  }
  await db.from("violations").update({ policy_state: "resolved", jira_status: jiraStatus }).eq("id", violationId);
}
async function markViolationTracked(db, violationId, jiraKey, jiraStatus = "To Do") {
  const { data: row } = await db.from("violations").select("id, workspace_id, policy_state").eq("id", violationId).single();
  if (row?.workspace_id) {
    try {
      await db.from("violation_policy_events").insert({
        violation_id: violationId,
        workspace_id: row.workspace_id,
        actor_id: null,
        // caller-specific actor (user id) is not known here
        previous_state: row.policy_state ?? null,
        new_state: "tracked",
        reason: "linked to Jira"
      });
    } catch {
    }
  }
  await db.from("violations").update({ jira_key: jiraKey, jira_status: jiraStatus, policy_state: "tracked" }).eq("id", violationId);
}
function extractViolationsFromGraph(graph) {
  const violations = [];
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id ?? "", n]));
  for (const e of edges) {
    const src = e.source ?? "";
    const tgt = e.target ?? "";
    const srcNode = nodeMap.get(src);
    const tgtNode = nodeMap.get(tgt);
    const srcLayer = srcNode?.layer ?? "?";
    const tgtLayer = tgtNode?.layer ?? "?";
    if (e.isLayerViolation) {
      violations.push({
        type: "layer_violation",
        severity: "high",
        sourceNodeId: src,
        targetNodeId: tgt,
        description: `${srcLayer} (${src}) should not depend on ${tgtLayer} (${tgt}). Lower layers depend on higher.`,
        suggestedFix: "Invert the dependency or move the module to a higher layer."
      });
    }
    if (e.isDrift) {
      violations.push({
        type: "drift",
        severity: "medium",
        sourceNodeId: src,
        targetNodeId: tgt,
        description: e.driftReason ?? `${src} depends on ${tgt} (violates arch rules).`,
        suggestedFix: "Remove the forbidden dependency or update the architecture rules."
      });
    }
  }
  return violations;
}
async function runViolationScan(db, workspaceId, graph, rulesVersion) {
  const violations = extractViolationsFromGraph(graph);
  await upsertViolations(db, {
    workspaceId,
    violations,
    rulesVersion,
    markAbsent: true
  });
  await recordScanSnapshot(db, workspaceId, rulesVersion);
}
async function recordScanSnapshot(db, workspaceId, rulesVersion) {
  const { data, error } = await db.from("violations").select("severity, policy_state").eq("workspace_id", workspaceId).eq("rules_version", rulesVersion).eq("structural_state", "active");
  if (error) return;
  const rows = data ?? [];
  const violationsCount = rows.length;
  const regressedCount = rows.filter((r) => r.policy_state === "regressed").length;
  const weights = {
    low: 0.5,
    medium: 1,
    high: 2,
    critical: 3
  };
  const healthScore = rows.reduce(
    (sum, r) => sum + (weights[r.severity] ?? 1),
    0
  );
  await db.from("violation_scans").insert({
    workspace_id: workspaceId,
    rules_version: rulesVersion,
    violations_count: violationsCount,
    regressed_count: regressedCount,
    health_score: healthScore,
    status: "completed"
  });
}

// ../../src/ai/critic.ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// ../../src/architecture/layerModel.ts
var LAYER_ORDER = [
  "Presentation",
  "Orchestration",
  "Reasoning",
  "Business Logic",
  "Memory",
  "Data Access",
  "Safety",
  "External Services",
  "Infrastructure",
  "Utilities",
  "Configuration",
  "Uncategorized"
];
var LAYER_INDEX = new Map(
  LAYER_ORDER.map((l, i) => [l, i])
);

// ../../src/agent/rail/greenfieldCriticPlaybook.ts
var GREENFIELD_CRITIC_PLAYBOOK = `
## Greenfield design review rules

1. **Layer boundaries**
   - Presentation must not depend on Data Access or Infrastructure.
   - Business Logic may depend on Data Access; Data Access must not depend on Business Logic.
   - External Services and Infrastructure are lowest; dependencies must point upward only.

2. **Archetype validation**
   - If the user asked for a "SaaS web app", expect Presentation, API/Orchestration, and at least one Business Logic layer.
   - If "API service", expect no Presentation or a thin gateway only; focus on API and downstream layers.
   - If "data pipeline", expect clear flow from ingestion through processing to output; no circular data flow.

3. **Node count and depth**
   - Prefer 5\u201315 modules for a focused design; flag if >25 without clear justification.
   - Each layer should have at least one node; avoid single-node layers unless it's a gateway.

4. **Naming and coherence**
   - Node IDs and labels should be PascalCase or kebab-case; no spaces or special characters in IDs.
   - Names should reflect responsibility (e.g. AuthService, not Module1).

5. **Circular dependencies**
   - No cycle in the dependency graph. If A\u2192B\u2192C\u2192A, the design is invalid.

6. **Negative examples (avoid)**
   - Monolithic "God" node that does everything.
   - Presentation directly calling Infrastructure.
   - Missing clear API/orchestration layer between UI and backend.
`.trim();
function getGreenfieldCriticSystemSnippet(antiPatternWarnings) {
  if (antiPatternWarnings.length === 0) return GREENFIELD_CRITIC_PLAYBOOK;
  return GREENFIELD_CRITIC_PLAYBOOK + "\n\n## Past failures to avoid\n" + antiPatternWarnings.map((w) => `- ${w}`).join("\n");
}

// ../../src/agent/rail/manager.ts
import * as fs6 from "fs";
import * as path6 from "path";

// ../../src/jira/client.ts
function getJiraConfig() {
  const baseUrl = process.env.JIRA_BASE_URL?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl, email, apiToken };
}
function authHeader(config) {
  const encoded = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  return `Basic ${encoded}`;
}
async function jiraFetch(config, path43, options = {}) {
  const url = `${config.baseUrl.replace(/\/$/, "")}${path43}`;
  return fetch(url, {
    ...options,
    headers: {
      "Authorization": authHeader(config),
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}
async function listProjects(config) {
  const res = await jiraFetch(config, "/rest/api/3/project");
  if (!res.ok) throw new Error(`Jira projects ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.map((p) => ({ key: p.key, name: p.name }));
}
async function getProjectIssueTypes(config, projectKey) {
  const res = await jiraFetch(
    config,
    `/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`
  );
  if (!res.ok) return ["Task"];
  const data = await res.json();
  const types = data.projects?.[0]?.issuetypes ?? [];
  return types.map((t) => t.name);
}
async function createIssue(config, input) {
  let issueType = input.issueType ?? process.env.JIRA_ISSUE_TYPE ?? "Task";
  const validTypes = await getProjectIssueTypes(config, input.projectKey);
  if (!validTypes.includes(issueType)) {
    issueType = validTypes[0] ?? "Task";
  }
  const fields = {
    project: { key: input.projectKey },
    summary: input.summary,
    issuetype: { name: issueType }
  };
  if (input.priority) {
    fields.priority = { name: input.priority };
  }
  if (input.description) {
    fields.description = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: input.description }] }] };
  }
  if (input.labels && input.labels.length > 0) {
    fields.labels = input.labels;
  }
  const res = await jiraFetch(config, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira create issue ${res.status}: ${body}`);
  }
  const data = await res.json();
  return { key: data.key };
}
async function searchIssues(config, jql, maxResults = 20, opts) {
  const fields = ["summary", "status", "issuetype", "priority", "updated", "labels"];
  if (opts?.includeDescription) fields.push("description");
  const res = await jiraFetch(config, "/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify({
      jql,
      maxResults,
      fields
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira search ${res.status}: ${body}`);
  }
  const data = await res.json();
  const issues = data.values ?? data.issues ?? [];
  return issues.map((i) => ({
    key: i.key,
    summary: i.fields?.summary ?? "",
    status: i.fields?.status?.name ?? "Unknown",
    type: i.fields?.issuetype?.name ?? "Unknown",
    priority: i.fields?.priority?.name,
    updated: i.fields?.updated,
    description: i.fields?.description,
    labels: i.fields?.labels
  }));
}
async function getIssue(config, issueKey) {
  const res = await jiraFetch(config, `/rest/api/3/issue/${issueKey}?fields=summary,status,issuetype,description`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    key: data.key,
    summary: data.fields?.summary ?? "",
    status: data.fields?.status?.name ?? "Unknown",
    type: data.fields?.issuetype?.name ?? "Unknown",
    description: data.fields?.description
  };
}
async function addLabel(config, issueKey, label) {
  try {
    const res = await jiraFetch(config, `/rest/api/3/issue/${issueKey}?fields=labels`);
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Jira get issue ${res.status}: ${body}` };
    }
    const data = await res.json();
    const current = data.fields?.labels ?? [];
    if (current.includes(label)) return { success: true };
    const labels = [...current, label];
    const putRes = await jiraFetch(config, `/rest/api/3/issue/${issueKey}`, {
      method: "PUT",
      body: JSON.stringify({ fields: { labels } })
    });
    if (!putRes.ok) {
      const body = await putRes.text();
      return { success: false, error: `Jira add label ${putRes.status}: ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ../../src/agent/rail/sandbox.ts
import * as path2 from "path";
import * as fs2 from "fs";
function getSandboxPath(rootPath, railId) {
  return path2.join(rootPath, ".agent", "sandboxes", `rail-${railId}`);
}
function ensureSandbox(rootPath, railId) {
  const sandboxPath = getSandboxPath(rootPath, railId);
  if (!fs2.existsSync(sandboxPath)) {
    fs2.mkdirSync(sandboxPath, { recursive: true });
  }
  return sandboxPath;
}
function removeSandbox(rootPath, railId) {
  const sandboxPath = getSandboxPath(rootPath, railId);
  try {
    if (fs2.existsSync(sandboxPath)) {
      fs2.rmSync(sandboxPath, { recursive: true, force: true });
    }
  } catch {
  }
}
function cleanupOrphanSandboxes(rootPath, workspaceId) {
  const base = path2.join(rootPath, ".agent", "sandboxes");
  if (!fs2.existsSync(base)) return;
  const rails = new Set(
    getAllRails().filter((r) => !workspaceId || r.workspaceId === workspaceId).map((r) => r.id)
  );
  const entries = fs2.readdirSync(base, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (!name.startsWith("rail-")) continue;
    const railId = name.slice("rail-".length);
    if (!rails.has(railId)) {
      const dir = path2.join(base, name);
      try {
        fs2.rmSync(dir, { recursive: true, force: true });
      } catch {
      }
    }
  }
}

// ../../src/agent/rail/telemetry.ts
import * as fs3 from "fs";
import * as path3 from "path";
var telemetryByRail = /* @__PURE__ */ new Map();
function ensure(railId) {
  let t = telemetryByRail.get(railId);
  if (!t) {
    t = {
      railId,
      critiqueLoopCount: 0,
      tokenUsage: 0,
      llmCallCount: 0,
      playwrightPasses: 0,
      playwrightFailures: 0,
      pathSuccessRate: 0,
      taskLatencies: {}
    };
    telemetryByRail.set(railId, t);
  }
  return t;
}
function recordTokens(railId, tokens) {
  const t = ensure(railId);
  t.tokenUsage += Math.max(0, tokens);
}
function recordLlmCall(railId) {
  const t = ensure(railId);
  t.llmCallCount += 1;
}
function recordTaskLatency(railId, taskId, ms) {
  const t = ensure(railId);
  t.taskLatencies[taskId] = ms;
}
function getRailTelemetry(railId) {
  return ensure(railId);
}
var skillStats = /* @__PURE__ */ new Map();
function skillStatsPath(rootPath) {
  return path3.join(rootPath, ".agent", "skill_performance.json");
}
function recordSkillUsage(skillId, approved) {
  let s = skillStats.get(skillId);
  if (!s) {
    s = { usageCount: 0, approvalCount: 0, lastUsedAt: 0 };
    skillStats.set(skillId, s);
  }
  s.usageCount += 1;
  if (approved) s.approvalCount += 1;
  s.lastUsedAt = Date.now();
}
function saveSkillPerformance(rootPath) {
  const entries = {};
  for (const [id, stats] of skillStats.entries()) {
    entries[id] = stats;
  }
  const p = skillStatsPath(rootPath);
  const dir = path3.dirname(p);
  if (!fs3.existsSync(dir)) {
    fs3.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${p}.tmp`;
  fs3.writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
  fs3.renameSync(tmp, p);
}

// ../../src/agent/rail/registry.ts
import * as fs4 from "fs";
import * as path4 from "path";
var REGISTRY_FILENAME = ".agent/rail_registry.json";
function getRegistryPath(rootPath) {
  return path4.join(rootPath, REGISTRY_FILENAME);
}
function loadRegistry(rootPath) {
  const filePath = getRegistryPath(rootPath);
  if (!fs4.existsSync(filePath)) {
    return {
      version: 1,
      updatedAt: Date.now(),
      index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
      rails: {}
    };
  }
  try {
    const raw = fs4.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return {
      version: 1,
      updatedAt: Date.now(),
      index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
      rails: {}
    };
  }
}
function saveRegistry(rootPath, registry) {
  const filePath = getRegistryPath(rootPath);
  const dir = path4.dirname(filePath);
  if (!fs4.existsSync(dir)) {
    fs4.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  fs4.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf8");
  fs4.renameSync(tmpPath, filePath);
}
function registerRail(registry, rail) {
  const next = {
    ...registry,
    updatedAt: Date.now(),
    rails: {
      ...registry.rails,
      [rail.id]: {
        id: rail.id,
        outcome: rail.outcome,
        state: rail.state,
        jiraKeys: rail.jiraKeys,
        updatedAt: Date.now()
      }
    }
  };
  for (const key of rail.jiraKeys) {
    const list = next.index.byJira[key] ?? [];
    if (!list.includes(rail.id)) next.index.byJira[key] = [...list, rail.id];
  }
  for (const step of rail.logicPath) {
    const list = next.index.byNode[step.nodeId] ?? [];
    if (!list.includes(rail.id)) next.index.byNode[step.nodeId] = [...list, rail.id];
  }
  const stateList = next.index.byState[rail.state] ?? [];
  if (!stateList.includes(rail.id)) next.index.byState[rail.state] = [...stateList, rail.id];
  const sessionList = next.index.bySession[rail.sessionId] ?? [];
  if (!sessionList.includes(rail.id)) next.index.bySession[rail.sessionId] = [...sessionList, rail.id];
  return next;
}
function deregisterRail(registry, railId) {
  const railMeta = registry.rails[railId];
  if (!railMeta) return registry;
  const next = {
    ...registry,
    updatedAt: Date.now(),
    rails: { ...registry.rails }
  };
  delete next.rails[railId];
  for (const [key, ids] of Object.entries(next.index.byJira)) {
    next.index.byJira[key] = ids.filter((id) => id !== railId);
  }
  for (const [key, ids] of Object.entries(next.index.byNode)) {
    next.index.byNode[key] = ids.filter((id) => id !== railId);
  }
  for (const [state, ids] of Object.entries(next.index.byState)) {
    next.index.byState[state] = ids.filter(
      (id) => id !== railId
    );
  }
  for (const [session, ids] of Object.entries(next.index.bySession)) {
    next.index.bySession[session] = ids.filter((id) => id !== railId);
  }
  return next;
}
function updateRailInRegistry(registry, rail) {
  const without = deregisterRail(registry, rail.id);
  return registerRail(without, rail);
}

// ../../src/agent/nodeHistory.ts
import * as fs5 from "fs";
import * as path5 from "path";
function getNodeHistoryPath(rootPath) {
  return path5.join(rootPath, ".agent", "nodes", "history.json");
}
function ensureDir(rootPath) {
  const dir = path5.join(rootPath, ".agent", "nodes");
  if (!fs5.existsSync(dir)) {
    fs5.mkdirSync(dir, { recursive: true });
  }
}
function loadNodeHistory(rootPath) {
  ensureDir(rootPath);
  const p = getNodeHistoryPath(rootPath);
  if (!fs5.existsSync(p)) {
    const empty = { version: 1, nodes: {} };
    fs5.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs5.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.nodes) {
      return { version: 1, nodes: {} };
    }
    return parsed;
  } catch {
    return { version: 1, nodes: {} };
  }
}
function saveNodeHistory(rootPath, store) {
  ensureDir(rootPath);
  const p = getNodeHistoryPath(rootPath);
  const tmp = `${p}.tmp`;
  fs5.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs5.renameSync(tmp, p);
}
function nodeIdsFromLogicPath(logicPath) {
  const ids = /* @__PURE__ */ new Set();
  for (const s of logicPath) {
    if (s.nodeId && typeof s.nodeId === "string") {
      ids.add(s.nodeId);
    }
  }
  return Array.from(ids);
}
function recordRailCompletion(rootPath, rail, state) {
  const store = loadNodeHistory(rootPath);
  const finishedAt = Date.now();
  const nodeIds = nodeIdsFromLogicPath(rail.logicPath ?? []);
  for (const nodeId of nodeIds) {
    const existing = store.nodes[nodeId] ?? {
      nodeId,
      successCount: 0,
      failureCount: 0,
      rails: []
    };
    const next = {
      ...existing,
      rails: [
        ...existing.rails,
        {
          railId: rail.id,
          outcome: rail.outcome,
          archetype: rail.archetype,
          state,
          finishedAt
        }
      ].slice(-20)
    };
    if (state === "ARCHIVED") {
      next.successCount += 1;
      next.lastSuccessAt = finishedAt;
    } else {
      next.failureCount += 1;
      next.lastFailureAt = finishedAt;
    }
    store.nodes[nodeId] = next;
  }
  saveNodeHistory(rootPath, store);
}

// ../../src/agent/rail/manager.ts
var inMemoryStore = {
  rails: /* @__PURE__ */ new Map(),
  tasks: /* @__PURE__ */ new Map()
};
var RAILS_DIR = ".agent/rails";
function getRailsDir(rootPath) {
  return path6.join(rootPath, RAILS_DIR);
}
function getRailPath(rootPath, railId) {
  return path6.join(getRailsDir(rootPath), `${railId}.json`);
}
function atomicWriteJson(filePath, value) {
  const dir = path6.dirname(filePath);
  if (!fs6.existsSync(dir)) fs6.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs6.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs6.renameSync(tmp, filePath);
}
function loadRails(rootPath) {
  const railsDir = getRailsDir(rootPath);
  if (!fs6.existsSync(railsDir)) {
    void loadRegistry(rootPath);
    return;
  }
  const files = fs6.readdirSync(railsDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const raw = fs6.readFileSync(path6.join(railsDir, f), "utf8");
      const rail = JSON.parse(raw);
      if (rail?.id) {
        inMemoryStore.rails.set(rail.id, rail);
        for (const t of rail.tasks ?? []) {
          if (t?.id) inMemoryStore.tasks.set(t.id, t);
        }
      }
    } catch {
    }
  }
  let next = {
    version: 1,
    updatedAt: Date.now(),
    index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
    rails: {}
  };
  for (const rail of inMemoryStore.rails.values()) {
    next = registerRail(next, rail);
  }
  saveRegistry(rootPath, next);
}
function createRail(rootPath, rail) {
  inMemoryStore.rails.set(rail.id, rail);
  atomicWriteJson(getRailPath(rootPath, rail.id), rail);
  const registry = loadRegistry(rootPath);
  const updated = registerRail(registry, rail);
  saveRegistry(rootPath, updated);
  return rail;
}
function getRail(_rootPath, railId) {
  return inMemoryStore.rails.get(railId) ?? null;
}
function updateRailState(rootPath, railId, state) {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;
  const updatedRail = { ...existing, state, updatedAt: Date.now() };
  inMemoryStore.rails.set(railId, updatedRail);
  atomicWriteJson(getRailPath(rootPath, railId), updatedRail);
  const registry = loadRegistry(rootPath);
  const next = updateRailInRegistry(registry, updatedRail);
  saveRegistry(rootPath, next);
  return updatedRail;
}
function enterExecutingState(rootPath, railId) {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;
  const alreadyExecuting = existing.state === "EXECUTING";
  const frozenOutcome = existing.frozenOutcome ?? existing.outcome;
  const frozenLogicPath = existing.frozenLogicPath ?? existing.logicPath;
  const baselineNodeIds = existing.baselineNodeIds ?? Array.from(
    new Set(
      (existing.logicPath ?? []).map((step) => step.nodeId).filter((id) => typeof id === "string" && id.length > 0)
    )
  );
  const nextState = "EXECUTING";
  const updated = {
    ...existing,
    state: alreadyExecuting ? existing.state : nextState,
    frozenOutcome,
    frozenLogicPath,
    baselineNodeIds,
    updatedAt: Date.now()
  };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  const registry = loadRegistry(rootPath);
  const next = updateRailInRegistry(registry, updated);
  saveRegistry(rootPath, next);
  return updated;
}
function createTask(task) {
  inMemoryStore.tasks.set(task.id, task);
  const rail = inMemoryStore.rails.get(task.railId);
  if (rail) {
    const updatedRail = {
      ...rail,
      tasks: [...rail.tasks ?? [], task],
      updatedAt: Date.now(),
      version: (rail.version ?? 0) + 1
    };
    inMemoryStore.rails.set(task.railId, updatedRail);
  }
  return task;
}
function updateTaskEvidence(taskId, evidence) {
  const existing = inMemoryStore.tasks.get(taskId);
  if (!existing) return null;
  const updated = { ...existing, evidence };
  inMemoryStore.tasks.set(taskId, updated);
  const rail = inMemoryStore.rails.get(updated.railId);
  if (rail) {
    const tasks2 = (rail.tasks ?? []).map((t) => t.id === taskId ? updated : t);
    const updatedRail = { ...rail, tasks: tasks2, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
    inMemoryStore.rails.set(rail.id, updatedRail);
  }
  return updated;
}
function updateTaskStatus(taskId, status) {
  const existing = inMemoryStore.tasks.get(taskId);
  if (!existing) return null;
  const now = Date.now();
  const updated = {
    ...existing,
    status,
    resolvedAt: status === "completed" ? now : existing.resolvedAt
  };
  inMemoryStore.tasks.set(taskId, updated);
  const rail = inMemoryStore.rails.get(updated.railId);
  if (rail) {
    const tasks2 = (rail.tasks ?? []).map((t) => t.id === taskId ? updated : t);
    const updatedRail = { ...rail, tasks: tasks2, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
    inMemoryStore.rails.set(rail.id, updatedRail);
    if (status === "completed" && typeof updated.createdAt === "number") {
      const latencyMs = now - updated.createdAt;
      recordTaskLatency(updated.railId, updated.id, latencyMs);
    }
  }
  return updated;
}
function getAllRails() {
  return Array.from(inMemoryStore.rails.values());
}
function archiveRail(rootPath, railId) {
  const rail = inMemoryStore.rails.get(railId);
  if (!rail) return null;
  const allTraces = getAgentTraces();
  const railTraces = allTraces.filter((t) => t.railId === railId);
  const telemetry = getRailTelemetry(railId);
  const updated = {
    ...rail,
    state: "ARCHIVED",
    updatedAt: Date.now(),
    version: (rail.version ?? 0) + 1,
    snapshotPath: getRailPath(rootPath, railId),
    traces: railTraces,
    telemetry
  };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  removeSandbox(rootPath, railId);
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, updateRailInRegistry(registry, updated));
  recordRailCompletion(rootPath, updated, "ARCHIVED");
  const issueKeys = (updated.jiraKeys ?? []).filter((k) => /^[A-Z][A-Z0-9]*-[0-9]+$/.test(k));
  if (issueKeys.length > 0) {
    const config = getJiraConfig();
    if (config) {
      for (const issueKey of issueKeys) {
        try {
          void addLabel(config, issueKey, `arch-rail-${updated.id}`);
        } catch {
        }
      }
    }
  }
  if (updated.archetype) {
    const verifTasks = (updated.tasks ?? []).filter((t) => t.kind === "verification");
    const allVerifCompleted = verifTasks.length === 0 || verifTasks.every((t) => t.status === "completed");
    if (allVerifCompleted) {
      const tmplDir = path6.join(rootPath, ".agent", "rails", "templates");
      const tmplPath = path6.join(tmplDir, `${updated.archetype}.json`);
      const tmpl = {
        archetype: updated.archetype,
        outcome: updated.outcome,
        logicPath: updated.logicPath,
        tasks: updated.tasks?.map((t) => ({
          kind: t.kind,
          description: t.description
        })),
        telemetry
      };
      if (!fs6.existsSync(tmplDir)) {
        fs6.mkdirSync(tmplDir, { recursive: true });
      }
      const tmp = `${tmplPath}.tmp`;
      fs6.writeFileSync(tmp, JSON.stringify(tmpl, null, 2), "utf8");
      fs6.renameSync(tmp, tmplPath);
    }
  }
  return updated;
}
function loadAntiPatterns(rootPath, archetype) {
  const antiDir = path6.join(rootPath, ".agent", "rails", "anti-patterns");
  try {
    if (!fs6.existsSync(antiDir)) return [];
    const files = fs6.readdirSync(antiDir).filter((f) => f.endsWith(".json"));
    const results = [];
    for (const f of files) {
      try {
        const raw = fs6.readFileSync(path6.join(antiDir, f), "utf8");
        const o = JSON.parse(raw);
        const railId = typeof o.railId === "string" ? o.railId : "";
        const outcome = typeof o.outcome === "string" ? o.outcome : "";
        const a = o.archetype;
        const archetypeVal = a === null || a === void 0 ? null : typeof a === "string" ? a : null;
        const logicPath = Array.isArray(o.logicPath) ? o.logicPath : [];
        const reason = typeof o.reason === "string" ? o.reason : "";
        if (archetype != null && archetype !== void 0 && archetypeVal !== archetype) continue;
        results.push({ railId, outcome, archetype: archetypeVal, logicPath, reason });
      } catch {
      }
    }
    return results;
  } catch {
    return [];
  }
}
function getAntiPatternWarnings(rootPath, archetype) {
  const patterns = loadAntiPatterns(rootPath, archetype);
  if (patterns.length === 0) return [];
  return patterns.map((p) => `Avoid: ${p.reason} (from outcome: "${p.outcome}")`);
}
function updateRailPartial(rootPath, railId, partial) {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;
  const scopeLockedStates = [
    "EXECUTING",
    "AWAITING_HITL",
    "VERIFYING",
    "SELF_CORRECTING",
    "MATERIALIZING",
    "ARCHIVED",
    "SUSPENDED",
    "FAILED"
  ];
  const isScopeLocked = scopeLockedStates.includes(existing.state);
  const safePartial = isScopeLocked ? (() => {
    const { logicPath, outcome, ...rest } = partial;
    return rest;
  })() : partial;
  const updated = { ...existing, ...safePartial, updatedAt: Date.now() };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, updateRailInRegistry(registry, updated));
  return updated;
}

// ../../src/ai/critic.ts
var ARCH_RULESET_VERSION = "v1";
var LAYER_INDEX2 = LAYER_ORDER.reduce(
  (acc, layer, idx) => {
    acc[layer] = idx;
    return acc;
  },
  {}
);
function getOpenAIClient(apiKey) {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  return key ? new OpenAI({ apiKey: key }) : null;
}
function getAnthropicKey(apiKeyClaude) {
  const key = apiKeyClaude ?? process.env.ANTHROPIC_API_KEY?.trim();
  return key || null;
}
async function callCriticLLM(prompt, apiKey, apiKeyClaude) {
  const openai = getOpenAIClient(apiKey);
  if (openai) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    });
    return completion.choices[0]?.message?.content ?? null;
  }
  const anthropicKey = getAnthropicKey(apiKeyClaude);
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : null;
  }
  return null;
}
async function reviewArchitectureAnswer(params) {
  const openai = getOpenAIClient(params.apiKey);
  const anthropicKey = getAnthropicKey(params.apiKeyClaude);
  if (!openai && !anthropicKey) {
    return {
      approved: true,
      score: 10,
      report: "No OpenAI or Anthropic API key; auto-approved.",
      violations: []
    };
  }
  const { question, answer, graph, findings } = params;
  const graphSummary = graph.nodes.slice(0, 40).map((n) => `- ${n.suggestedLabel ?? n.label} (${n.layer ?? "?"}) [${n.id}]`).join("\n");
  const findingsSummary = findings && findings.length > 0 ? findings.slice(0, 20).map((f) => `- [${f.severity}] ${f.type} at ${f.location}: ${f.description}`).join("\n") : "None.";
  const isUtilityTask = /script|skill|helper|tool|snippet|utility/i.test(question) || /write a|create a|build a|generate a/i.test(question);
  const taskContext = isUtilityTask ? "\nThis is a utility script/skill creation or usage task. Judge primarily on correctness, usefulness, and alignment with the request. Do NOT penalize for missing unit tests, exhaustive edge-case handling, or theoretical circular-dependency concerns unless they are explicitly in scope." : "";
  const MAX_ANSWER_CHARS = 8e3;
  const truncatedAnswer = answer.length > MAX_ANSWER_CHARS ? answer.slice(0, MAX_ANSWER_CHARS) + `

[Answer truncated for review; original length ${answer.length} chars.]` : answer;
  const prompt = `You are a senior software architect acting as a strict code and architecture reviewer.${taskContext}

Question:
${question}

Proposed answer:
${truncatedAnswer}

Architecture (truncated):
${graphSummary}

Static analysis findings:
${findingsSummary}

Evaluate the proposed answer ONLY on:
- Architectural fit (layers, boundaries, dependencies),
- Code correctness and safety at a high level (given the description),
- Completeness with respect to the question.

Your task:
- Judge whether the assistant's answer is acceptable.
- Assign a numeric score from 1-10.
- Extract any concrete architecture violations as structured JSON.

Respond with STRICT JSON (no markdown) in this shape:
{
  "approved": boolean,
  "score": number,        // integer 1-10
  "report": string,       // one-paragraph human-readable summary
  "violations": [
    {
      "type": "layer_violation" | "drift" | "missing_context" | "circular_dep" | "god_module",
      "severity": "critical" | "high" | "medium",
      "sourceNodeId": "exact ArchNode.id from the graph",
      "targetNodeId": "exact ArchNode.id from the graph or omit if N/A",
      "description": "plain-English description of what is wrong",
      "suggestedFix": "plain-English recommendation for how to fix it"
    }
  ]
}

If there are no violations, return "violations": [].
Do not include any additional fields. Do not wrap the JSON in markdown.`;
  try {
    const raw = await callCriticLLM(prompt, params.apiKey, params.apiKeyClaude) ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let parsed = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        approved: true,
        score: 10,
        report: cleaned || "Critic returned non-JSON output; treating as approved.",
        violations: []
      };
    }
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? parsed.score : 5;
    const approved = parsed.approved === true && score >= 7;
    const report = typeof parsed.report === "string" && parsed.report.trim().length > 0 ? parsed.report : approved ? "APPROVED" : "Not approved; no specific issues provided.";
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    return { approved, score, report, violations };
  } catch (err) {
    return {
      approved: true,
      score: 10,
      report: `Critic error; treating as approved: ${err instanceof Error ? err.message : String(err)}`,
      violations: []
    };
  }
}
function buildProposedGraph(graphCommands) {
  const nodes = [];
  const edges = [];
  const cmds = graphCommands ? Array.isArray(graphCommands) ? graphCommands : [graphCommands] : [];
  for (const cmd of cmds) {
    if (cmd.action === "create_node") {
      nodes.push({
        id: cmd.id,
        layer: cmd.layer,
        label: "label" in cmd && typeof cmd.label === "string" ? cmd.label : void 0
      });
    }
    if (cmd.action === "connect") {
      edges.push({ source: cmd.fromId, target: cmd.toId });
    }
  }
  return { nodes, edges };
}
function detectCycle(edges) {
  const adj = /* @__PURE__ */ new Map();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const visited = /* @__PURE__ */ new Set();
  const recStack = /* @__PURE__ */ new Set();
  const path43 = [];
  function dfs(node) {
    visited.add(node);
    recStack.add(node);
    path43.push(node);
    for (const n of adj.get(node) ?? []) {
      if (!visited.has(n)) {
        const cycle = dfs(n);
        if (cycle) return cycle;
      } else if (recStack.has(n)) {
        const idx = path43.indexOf(n);
        return path43.slice(idx);
      }
    }
    path43.pop();
    recStack.delete(node);
    return null;
  }
  for (const src of adj.keys()) {
    if (!visited.has(src)) {
      const cycle = dfs(src);
      if (cycle) return cycle;
    }
  }
  return null;
}
function checkLayering(nodes, edges) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const violations = [];
  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) continue;
    const srcOrder = LAYER_INDEX2[src.layer ?? "Uncategorized"] ?? LAYER_ORDER.length;
    const tgtOrder = LAYER_INDEX2[tgt.layer ?? "Uncategorized"] ?? LAYER_ORDER.length;
    if (srcOrder > tgtOrder) {
      violations.push({
        type: "layer_violation",
        severity: "high",
        sourceNodeId: e.source,
        targetNodeId: e.target,
        description: `${src.layer ?? "?"} (${e.source}) should not depend on ${tgt.layer ?? "?"} (${e.target}). Lower layers depend on higher.`,
        suggestedFix: "Invert the dependency or move the module to a higher layer."
      });
    }
  }
  return violations;
}
function checkGreenfieldCollisions(proposedNodes, existingGraph) {
  if (!existingGraph?.nodes?.length) return [];
  const existingIds = new Set(existingGraph.nodes.map((n) => n.id));
  const existingLabels = new Set(
    existingGraph.nodes.map((n) => (n.suggestedLabel ?? n.label ?? "").toLowerCase().trim()).filter(Boolean)
  );
  const violations = [];
  for (const n of proposedNodes) {
    if (existingIds.has(n.id)) {
      violations.push({
        type: "layer_violation",
        severity: "high",
        sourceNodeId: n.id,
        description: `Proposed node id "${n.id}" already exists in the graph. Choose a different id or remove the existing module first.`,
        suggestedFix: "Rename the proposed node or remove the existing one from the design."
      });
    }
    const label = "label" in n ? n.label : void 0;
    if (typeof label === "string" && label.trim()) {
      const lower = label.toLowerCase().trim();
      if (existingLabels.has(lower)) {
        violations.push({
          type: "layer_violation",
          severity: "high",
          sourceNodeId: n.id,
          description: `Proposed label "${label}" conflicts with an existing node. Use a distinct name.`,
          suggestedFix: "Rename the proposed node to avoid collision."
        });
      }
    }
  }
  return violations;
}
async function reviewGreenfieldAnswer(params) {
  const { question, answer, graphCommands, graphCommand, apiKey, apiKeyClaude, existingGraph, rootPath, archetype } = params;
  const commands = graphCommands ?? (graphCommand ? [graphCommand] : []);
  const { nodes, edges } = buildProposedGraph(commands);
  const MAX_NODES = 30;
  const MAX_EDGES = 100;
  if (nodes.length > MAX_NODES) {
    return {
      approved: false,
      score: 4,
      report: `Too many nodes (${nodes.length}). Keep designs focused (\u2264${MAX_NODES} nodes).`,
      violations: [
        {
          type: "god_module",
          severity: "medium",
          sourceNodeId: nodes[0]?.id ?? "",
          description: `Design has ${nodes.length} nodes; limit is ${MAX_NODES}.`,
          suggestedFix: "Consolidate or remove modules."
        }
      ]
    };
  }
  if (edges.length > MAX_EDGES) {
    return {
      approved: false,
      score: 4,
      report: `Too many edges (${edges.length}). Simplify dependencies (\u2264${MAX_EDGES}).`,
      violations: []
    };
  }
  const cycle = detectCycle(edges);
  if (cycle && cycle.length > 0) {
    return {
      approved: false,
      score: 3,
      report: `Circular dependency detected: ${cycle.join(" \u2192 ")}.`,
      violations: [
        {
          type: "circular_dep",
          severity: "critical",
          sourceNodeId: cycle[0],
          targetNodeId: cycle[cycle.length - 1],
          description: `Cycle: ${cycle.join(" \u2192 ")}.`,
          suggestedFix: "Break the cycle by introducing an abstraction or inverting a dependency."
        }
      ]
    };
  }
  const layerViolations = checkLayering(nodes, edges);
  if (layerViolations.length > 0) {
    return {
      approved: false,
      score: 5,
      report: `Layer violations: ${layerViolations.map((v) => v.description).join("; ")}`,
      violations: layerViolations
    };
  }
  const collisionViolations = checkGreenfieldCollisions(nodes, existingGraph);
  if (collisionViolations.length > 0) {
    return {
      approved: false,
      score: 4,
      report: `Collision with existing graph: ${collisionViolations.map((v) => v.description).join("; ")}`,
      violations: collisionViolations
    };
  }
  const openai = getOpenAIClient(apiKey);
  const anthropicKey = getAnthropicKey(apiKeyClaude);
  if (!openai && !anthropicKey || nodes.length === 0) {
    return {
      approved: true,
      score: 8,
      report: "Deterministic checks passed. No LLM review (empty design or no API key).",
      violations: []
    };
  }
  const graphSummary = nodes.map((n) => `- ${n.id} (${n.layer})`).join("\n");
  const edgeSummary = edges.map((e) => `  ${e.source} \u2192 ${e.target}`).join("\n");
  const baseForAntiPatterns = rootPath && rootPath.trim() ? rootPath : process.env.PROJECTS_BASE_DIR?.trim() || process.env.PROJECT_ROOT?.trim() || process.cwd();
  const antiWarnings = getAntiPatternWarnings(baseForAntiPatterns, archetype ?? void 0);
  const playbookSnippet = getGreenfieldCriticSystemSnippet(antiWarnings);
  const prompt = `${playbookSnippet}

You are a senior software architect reviewing a greenfield design. Apply the playbook rules above.

Question: ${question}

Proposed answer:
${answer.slice(0, 4e3)}

Proposed nodes:
${graphSummary || "(none)"}

Proposed edges:
${edgeSummary || "(none)"}

Evaluate for coherence: Are responsibilities clear? Is layering sensible? Are dependencies logical?
Extract acceptance criteria the design should satisfy (functional, visual, architectural).
Respond with STRICT JSON only, no markdown:
{
  "approved": boolean,
  "score": 1-10,
  "report": "one paragraph",
  "violations": [],
  "acceptanceCriteria": {
    "functional": ["criterion 1", "criterion 2"],
    "visual": ["criterion 1"],
    "architectural": ["criterion 1"]
  }
}`;
  try {
    const raw = await callCriticLLM(prompt, apiKey, apiKeyClaude) ?? "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? parsed.score : 7;
    const approved = parsed.approved === true && score >= 6;
    const report = typeof parsed.report === "string" ? parsed.report : approved ? "APPROVED" : "Not approved.";
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    const acceptanceCriteria = parsed.acceptanceCriteria && typeof parsed.acceptanceCriteria === "object" && Array.isArray(parsed.acceptanceCriteria.functional) ? {
      functional: parsed.acceptanceCriteria.functional.filter((s) => typeof s === "string"),
      visual: Array.isArray(parsed.acceptanceCriteria.visual) ? parsed.acceptanceCriteria.visual.filter((s) => typeof s === "string") : [],
      architectural: Array.isArray(parsed.acceptanceCriteria.architectural) ? parsed.acceptanceCriteria.architectural.filter((s) => typeof s === "string") : []
    } : void 0;
    return { approved, score, report, violations, acceptanceCriteria };
  } catch {
    return {
      approved: true,
      score: 7,
      report: "Deterministic checks passed. LLM review failed; treating as approved.",
      violations: []
    };
  }
}

// src/systemModelRoutes.ts
import { Router } from "express";

// src/systemModel.ts
var DOMAIN_KEYWORDS = {
  auth: ["auth", "login", "logout", "session", "token", "oauth", "jwt", "identity"],
  payments: ["payment", "billing", "invoice", "stripe", "checkout", "subscription"],
  users: ["user", "account", "profile", "member", "customer"],
  analytics: ["analytics", "metrics", "tracking", "events", "logging"],
  notifications: ["notification", "email", "push", "sms", "alert"],
  api: ["api", "rest", "graphql", "rpc"],
  admin: ["admin", "dashboard", "management"],
  shared: ["shared", "common", "lib", "utils"],
  root: ["root"]
};
function inferDomain(node) {
  const path43 = (node.path ?? node.id ?? "").replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase();
  const label = (node.suggestedLabel ?? node.label ?? "").toLowerCase();
  const tags = (node.tags ?? []).map((t) => String(t).toLowerCase());
  const combined = `${path43} ${label} ${tags.join(" ")}`;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (domain === "root") continue;
    for (const kw of keywords) {
      if (combined.includes(kw)) return domain;
    }
  }
  const parts = path43.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, 2).join("/");
}
function inferRuntimeRoles(node) {
  const roles = [];
  const label = (node.suggestedLabel ?? node.label ?? "").toLowerCase();
  const path43 = (node.path ?? node.id ?? "").toLowerCase();
  const layer = (node.layer ?? "").toLowerCase();
  const tags = (node.tags ?? []).map((t) => String(t).toLowerCase());
  const role = (node.role ?? "").toLowerCase();
  const combined = `${label} ${path43} ${layer} ${tags.join(" ")} ${role}`;
  const exports = (node.semanticSignals?.exports ?? []).map((e) => e.toLowerCase()).join(" ");
  const patterns = [
    { role: "controller", patterns: ["controller", "route", "handler", "endpoint", "api"] },
    { role: "service", patterns: ["service", "manager", "processor", "workflow", "logic", "business"] },
    { role: "repository", patterns: ["repository", "repo", "dao", "data access", "storage"] },
    { role: "worker", patterns: ["worker", "job", "task", "consumer", "processor"] },
    { role: "scheduler", patterns: ["scheduler", "cron", "queue", "job runner"] },
    { role: "event-consumer", patterns: ["event consumer", "listener", "subscriber", "handler"] },
    { role: "gateway", patterns: ["gateway", "proxy", "bff"] },
    { role: "client", patterns: ["client", "sdk", "adapter"] }
  ];
  for (const { role: r, patterns: pats } of patterns) {
    for (const p of pats) {
      if ((combined.includes(p) || exports.includes(p)) && !roles.includes(r)) {
        roles.push(r);
        break;
      }
    }
  }
  if (layer.includes("data") && !roles.includes("repository")) roles.push("repository");
  if (layer.includes("orchestration") && !roles.includes("service")) roles.push("service");
  return roles.length > 0 ? roles : ["service"];
}
function inferTier(node, nodeById, edges, domain) {
  const inDegree = edges.filter((e) => e.target === node.id).length;
  const outDegree = edges.filter((e) => e.source === node.id).length;
  const totalDegree = inDegree + outDegree;
  const isInAuthOrPayments = ["auth", "payments"].includes(domain);
  const isEntryPoint = !!node.isEntryPoint;
  const criticalInfraLayers = ["memory", "data access", "external services", "infrastructure"];
  const isCriticalInfra = criticalInfraLayers.some(
    (l) => (node.layer ?? "").toLowerCase().includes(l.toLowerCase())
  );
  const fanOutToCritical = edges.filter((e) => e.source === node.id).some((e) => {
    const tgt = nodeById.get(e.target);
    return tgt && criticalInfraLayers.some((l) => (tgt.layer ?? "").toLowerCase().includes(l.toLowerCase()));
  });
  if (isEntryPoint || isInAuthOrPayments && totalDegree >= 2 || isCriticalInfra && inDegree >= 2) {
    return "core";
  }
  if (fanOutToCritical || totalDegree >= 4 || isInAuthOrPayments) {
    return "supporting";
  }
  return "peripheral";
}
function buildSystemModel(graph, options) {
  const nodeById = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) nodeById.set(n.id, n);
  const nodes = graph.nodes.map((node) => {
    const domain = inferDomain(node);
    const runtimeRoles = inferRuntimeRoles(node);
    const tier = inferTier(node, nodeById, graph.edges, domain);
    return {
      ...node,
      domain,
      runtimeRoles,
      tier
    };
  });
  const domains = [...new Set(nodes.map((n) => n.domain))].sort();
  return {
    nodes,
    edges: graph.edges,
    domains,
    generatedAt: graph.generatedAt,
    projectRoot: graph.projectRoot ?? "",
    projectName: graph.projectName,
    graphId: options?.graphId
  };
}

// src/workspaceAccess.ts
async function assertWorkspaceAccess(supabase, workspaceId, userId) {
  if (!supabase) {
    throw Object.assign(new Error("Auth service not configured."), { statusCode: 503 });
  }
  if (!workspaceId) {
    throw Object.assign(new Error("workspaceId is required"), { statusCode: 400 });
  }
  if (!userId) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  const { data: ws, error } = await supabase.from("workspaces").select("id, owner_id, archived_at").eq("id", workspaceId).maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message), { statusCode: 500 });
  }
  if (!ws) {
    throw Object.assign(new Error("Workspace not found."), { statusCode: 404 });
  }
  const isOwner = ws.owner_id === userId;
  if (isOwner) {
    if (ws.archived_at) {
      throw Object.assign(new Error("Workspace is archived."), { statusCode: 403 });
    }
    try {
      await supabase.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: userId, role: "owner" },
        { onConflict: "workspace_id,user_id", ignoreDuplicates: true }
      );
    } catch {
    }
    return ws;
  }
  let member = null;
  try {
    const { data: data2, error: error2 } = await supabase.from("workspace_members").select("id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    if (!error2) member = data2;
  } catch {
  }
  if (!member) {
    throw Object.assign(new Error("Workspace not found or access denied."), { statusCode: 404 });
  }
  const data = ws;
  if (data.archived_at) {
    throw Object.assign(new Error("Workspace is archived."), { statusCode: 403 });
  }
  return data;
}

// src/systemModelRoutes.ts
var router = Router();
router.get("/workspaces/:id/system-model", requireUser, async (req, res) => {
  const workspaceId = req.params.id;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_system_models").select("id, system_model_json, graph_id, updated_at").eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data?.system_model_json) {
    res.status(404).json({ error: "No SystemModel found. Run a scan to build one." });
    return;
  }
  const model = data.system_model_json;
  model.snapshotId = data.id;
  res.json(model);
});
router.post("/workspaces/:id/system-model/refresh", requireUser, async (req, res) => {
  const workspaceId = req.params.id;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  const { data: graphRow } = await supabaseAdmin.from("graphs").select("id, graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!graphRow?.graph_json) {
    res.status(404).json({ error: "No graph found. Run a scan first." });
    return;
  }
  const graph = graphRow.graph_json;
  const graphId = graphRow.id;
  await upsertSystemModel(workspaceId, graph, graphId);
  res.json({ ok: true, message: "SystemModel refreshed." });
});
async function upsertSystemModel(workspaceId, graph, graphId) {
  const systemModel = buildSystemModel(graph, { graphId: graphId ?? void 0 });
  const payload = {
    workspace_id: workspaceId,
    graph_id: graphId ?? null,
    system_model_json: systemModel,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { error } = await supabaseAdmin.from("workspace_system_models").upsert(payload, {
    onConflict: "workspace_id"
  });
  if (error) console.error("[systemModel] upsert error:", error.message);
}

// src/scanHistory.ts
import { Router as Router2 } from "express";

// src/middleware/requireWorkspaceAccess.ts
async function requireWorkspaceAccess(req, res, next) {
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  try {
    const ws = await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
    req.workspace = {
      id: ws.id,
      owner_id: ws.owner_id
    };
    next();
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 403).json({ error: err.message ?? "Access denied" });
  }
}

// src/scanHistory.ts
var router2 = Router2();
router2.get(
  "/workspaces/:workspaceId/scan-history",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const limit = Math.min(parseInt(String(req.query.limit ?? 30), 10) || 30, 100);
    const { data, error } = await supabaseAdmin.from("scan_history").select(
      "id, status, branch, commit_sha, ref, trigger, error_message, node_count, edge_count, started_at, completed_at"
    ).eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(limit);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ scans: data ?? [] });
  }
);
async function insertScanHistory(params) {
  if (!supabaseAdmin) return null;
  const row = {
    workspace_id: params.workspaceId,
    status: params.status,
    branch: params.branch ?? null,
    commit_sha: params.commitSha ?? null,
    ref: params.ref ?? null,
    trigger: params.trigger ?? "manual",
    error_message: params.errorMessage ?? null,
    node_count: params.nodeCount ?? null,
    edge_count: params.edgeCount ?? null,
    completed_at: params.completedAt ?? null,
    graph_id: params.graphId ?? null
  };
  const { data, error } = await supabaseAdmin.from("scan_history").insert(row).select("id").single();
  if (error) {
    console.warn("[scanHistory] insert failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}
async function updateScanHistory(id, updates) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("scan_history").update(updates).eq("id", id);
}

// src/scan.ts
var __dirname2 = path7.dirname(fileURLToPath2(import.meta.url));
var projectRoot = process.env.PROJECT_ROOT?.trim() || path7.resolve(__dirname2, "../../..");
var ANON_SCAN_LIMIT = Math.max(1, parseInt(process.env.ANON_SCAN_LIMIT ?? "2", 10));
var ANON_SCAN_WINDOW_MS = 24 * 60 * 60 * 1e3;
var anonScanCounts = /* @__PURE__ */ new Map();
function getAnonymousScanKey(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
function checkAnonymousLimit(key) {
  const now = Date.now();
  const entry = anonScanCounts.get(key);
  if (!entry) return true;
  if (now - entry.firstAt > ANON_SCAN_WINDOW_MS) {
    anonScanCounts.delete(key);
    return true;
  }
  return entry.count < ANON_SCAN_LIMIT;
}
function incrementAnonymousCount(key) {
  const now = Date.now();
  const entry = anonScanCounts.get(key);
  if (!entry) {
    anonScanCounts.set(key, { count: 1, firstAt: now });
    return;
  }
  if (now - entry.firstAt > ANON_SCAN_WINDOW_MS) {
    anonScanCounts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}
if (!fs7.existsSync(path7.join(projectRoot, "package.json"))) {
  console.warn(`[scan] projectRoot=${projectRoot} does not look like the repo root`);
}
var router3 = Router3();
function repoNameFromUrl(url) {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}
router3.post("/scan", optionalUser, async (req, res) => {
  const { repoUrl, workspaceId: requestedWorkspaceId } = req.body;
  if (!repoUrl || typeof repoUrl !== "string") {
    res.status(400).json({ error: "repoUrl is required" });
    return;
  }
  const trimmed = repoUrl.trim();
  if (!trimmed.match(/github\.com[/:]/i)) {
    res.status(400).json({ error: "Use a GitHub URL, e.g. https://github.com/owner/repo" });
    return;
  }
  const isAnonymous = !req.user;
  const isSignedIn = !!req.user;
  if (process.env.METRICS_LOG === "1") {
    console.log("[scan] auth context", {
      hasUser: isSignedIn,
      hasAccessToken: !!req.accessToken,
      supabaseAdminConfigured: !!supabaseAdmin
    });
  }
  if (isSignedIn && !supabaseAdmin) {
    res.status(503).json({
      error: "Auth service is not configured on the server. Signed-in scans cannot be persisted. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set for the webapp server.",
      workspaceId: null
    });
    return;
  }
  if (isAnonymous) {
    const key = getAnonymousScanKey(req);
    if (!checkAnonymousLimit(key)) {
      res.status(403).json({
        error: "Sign up to continue scanning.",
        code: "SIGNUP_REQUIRED",
        limit: ANON_SCAN_LIMIT
      });
      return;
    }
  }
  let workspaceIdForScan = null;
  const ownerId = req.user?.id;
  const defaultName = repoNameFromUrl(trimmed) ?? "Imported repository";
  if (ownerId && supabaseAdmin) {
    const candidate = typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim() ? requestedWorkspaceId.trim() : null;
    if (candidate) {
      const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", candidate).eq("owner_id", ownerId).is("archived_at", null).maybeSingle();
      if (!wsErr && ws?.id) workspaceIdForScan = ws.id;
    }
    if (!workspaceIdForScan) {
      const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").insert({ owner_id: ownerId, name: defaultName }).select("id").single();
      if (!wsErr && ws?.id) workspaceIdForScan = ws.id;
    }
  }
  const scanArgs = ["tsx", "scripts/scan-repo.ts", trimmed, "--keep"];
  if (workspaceIdForScan) {
    scanArgs.push("--workspace-id", workspaceIdForScan);
  }
  let scanHistoryId = null;
  if (ownerId && workspaceIdForScan && supabaseAdmin) {
    scanHistoryId = await insertScanHistory({
      workspaceId: workspaceIdForScan,
      status: "started",
      trigger: "manual"
    });
  }
  try {
    const result = execFileSync("npx", scanArgs, {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env }
    });
    const graph = JSON.parse(result);
    if (isAnonymous) {
      const key = getAnonymousScanKey(req);
      incrementAnonymousCount(key);
    }
    if (ownerId && supabaseAdmin) {
      const workspaceId = workspaceIdForScan;
      let persistError = null;
      let jiraProjectKey = null;
      try {
        if (!workspaceId) {
          persistError = "Failed to obtain workspace id.";
          throw new Error(persistError);
        }
        const { data: wsRow } = await supabaseAdmin.from("workspaces").select("jira_project_key").eq("id", workspaceId).single();
        if (!wsRow?.jira_project_key && trimmed) {
          const key = deriveProjectKey(trimmed);
          await supabaseAdmin.from("workspaces").update({ jira_project_key: key }).eq("id", workspaceId);
          jiraProjectKey = key;
        } else if (wsRow?.jira_project_key) {
          jiraProjectKey = wsRow.jira_project_key;
        }
        const { data: graphInsert, error: gErr } = await supabaseAdmin.from("graphs").insert({
          workspace_id: workspaceId,
          graph_json: graph,
          repo_url: trimmed
        }).select("id").single();
        if (gErr) throw gErr;
        const githubFullName = repoNameFromUrl(trimmed);
        await supabaseAdmin.from("workspaces").update({
          repo_url: trimmed,
          github_full_name: githubFullName
        }).eq("id", workspaceId);
        if (scanHistoryId) {
          const nodeCount2 = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
          const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
          await updateScanHistory(scanHistoryId, {
            status: "completed",
            node_count: nodeCount2,
            edge_count: edgeCount,
            completed_at: (/* @__PURE__ */ new Date()).toISOString(),
            graph_id: graphInsert?.id ?? null
          });
        }
        embedAndPersistNodes(
          graph,
          workspaceId,
          supabaseAdmin,
          process.env.OPENAI_API_KEY?.trim()
        ).catch((e) => {
          if (process.env.METRICS_LOG === "1") {
            console.warn("[scan] node_embeddings failed:", e instanceof Error ? e.message : e);
          }
        });
        runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch((e) => {
          console.warn("[scan] violation scan failed:", e instanceof Error ? e.message : e);
        });
      } catch (e) {
        persistError = e?.message ? String(e.message) : String(e);
        if (scanHistoryId) {
          await updateScanHistory(scanHistoryId, {
            status: "failed",
            error_message: persistError,
            completed_at: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        console.error("[scan] workspace persistence failed:", {
          ownerId,
          requestedWorkspaceId,
          error: persistError
        });
        res.status(500).json({ error: persistError || "Failed to persist workspace.", workspaceId: null });
        return;
      }
      res.json({ ...graph, workspaceId, jiraProjectKey, persistError: null });
      return;
    }
    const anonError = !ownerId ? "Sign up to save your workspaces." : "Auth service not configured.";
    res.json({ ...graph, workspaceId: null, persistError: anonError });
  } catch (err) {
    if (scanHistoryId) {
      const msg = err instanceof Error ? err.message : String(err);
      void updateScanHistory(scanHistoryId, {
        status: "failed",
        error_message: msg,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const spawnErr = err;
    let message = "Scan failed";
    if (spawnErr.code === "ENOENT") {
      message = "Cannot find npx. Ensure Node.js and npm are installed and on PATH.";
    } else if (spawnErr.stderr) {
      message = Buffer.isBuffer(spawnErr.stderr) ? spawnErr.stderr.toString("utf-8").trim() : String(spawnErr.stderr).trim();
    } else if (err instanceof Error) {
      message = err.message;
    }
    res.status(500).json({ error: message || "Scan failed" });
  }
});
router3.post("/scan/refresh", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const { workspaceId } = req.body;
  if (!workspaceId || typeof workspaceId !== "string") {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (gErr || !graphRow?.repo_url) {
    res.status(404).json({ error: "No graph or repo_url for this workspace." });
    return;
  }
  const repoUrl = graphRow.repo_url.trim();
  if (!repoUrl.match(/github\.com[/:]/i)) {
    res.status(400).json({ error: "Workspace repo_url is not a GitHub URL." });
    return;
  }
  const scanHistoryId = await insertScanHistory({
    workspaceId,
    status: "started",
    trigger: "manual"
  });
  const scanArgs = ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId];
  try {
    const result = execFileSync(
      "npx",
      scanArgs,
      { cwd: projectRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env } }
    );
    const graph = JSON.parse(result);
    const { error: insErr } = await supabaseAdmin.from("graphs").insert({
      workspace_id: workspaceId,
      graph_json: graph,
      repo_url: repoUrl
    });
    if (insErr) throw insErr;
    const githubFullName = repoNameFromUrl(repoUrl);
    await supabaseAdmin.from("workspaces").update({ repo_url: repoUrl, github_full_name: githubFullName }).eq("id", workspaceId);
    const { data: gRow } = await supabaseAdmin.from("graphs").select("id").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).single();
    const graphId = gRow?.id ?? null;
    if (scanHistoryId) {
      const nodeCount2 = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
      const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
      await updateScanHistory(scanHistoryId, {
        status: "completed",
        node_count: nodeCount2,
        edge_count: edgeCount,
        completed_at: (/* @__PURE__ */ new Date()).toISOString(),
        graph_id: graphId
      });
    }
    const graphTyped = graph;
    upsertSystemModel(workspaceId, graphTyped, graphId ?? void 0).catch((e) => console.warn("[scan] SystemModel upsert:", e));
    embedAndPersistNodes(
      graphTyped,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {
    });
    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {
    });
    res.json({ ...graph, workspaceId });
  } catch (err) {
    if (scanHistoryId) {
      const msg = err instanceof Error ? err.message : String(err);
      void updateScanHistory(scanHistoryId, {
        status: "failed",
        error_message: msg,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const spawnErr = err;
    let message = "Re-scan failed";
    if (spawnErr.code === "ENOENT") message = "Cannot find npx.";
    else if (spawnErr.stderr) message = Buffer.isBuffer(spawnErr.stderr) ? spawnErr.stderr.toString("utf-8").trim() : String(spawnErr.stderr);
    else if (err instanceof Error) message = err.message;
    res.status(500).json({ error: message });
  }
});

// src/chat.ts
import { Router as Router7 } from "express";
import { randomUUID } from "node:crypto";

// ../../src/ai/manager.ts
import * as fs15 from "fs";
import * as path16 from "path";

// ../../src/ai/logger.ts
import * as fs8 from "fs";
import * as path8 from "path";
function logArchEvent(level, message, context = {}) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const entry = {
    ts,
    level,
    message,
    archNodeId: context.archNodeId ?? null,
    filePath: context.filePath ?? null,
    requestId: context.requestId ?? null,
    workspaceId: context.workspaceId ?? null,
    ...context
  };
  const base = `[arch][${level}] ${ts} \u2013 ${message}`;
  const extra = entry.archNodeId || entry.requestId ? ` (${JSON.stringify({
    archNodeId: entry.archNodeId,
    requestId: entry.requestId
  })})` : "";
  console.log(base + extra);
  try {
    const root = process.cwd();
    const logPath = process.env.ARCHY_LOG_PATH?.trim() || path8.join(root, "logs", "app.log");
    const dir = path8.dirname(logPath);
    if (!fs8.existsSync(dir)) {
      fs8.mkdirSync(dir, { recursive: true });
    }
    fs8.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
  }
}

// ../../src/ai/errors.ts
var ErrorCode = {
  VALIDATION: "VALIDATION",
  CRITIC_REJECTION: "CRITIC_REJECTION",
  LLM_PARSE_FAILURE: "LLM_PARSE_FAILURE",
  RATE_LIMIT: "RATE_LIMIT",
  TRANSIENT: "TRANSIENT",
  PREFLIGHT_FAILED: "PREFLIGHT_FAILED",
  NO_API_KEY: "NO_API_KEY",
  UNKNOWN: "UNKNOWN"
};
var ArchError = class extends Error {
  code;
  userMessage;
  traceId;
  internal;
  constructor(details) {
    super(details.userMessage);
    this.name = "ArchError";
    this.code = details.code;
    this.userMessage = details.userMessage;
    this.traceId = details.traceId;
    this.internal = details.internal;
  }
  toJSON() {
    return {
      error: this.userMessage,
      code: this.code,
      traceId: this.traceId
    };
  }
};
function toUserMessage(err, traceId) {
  if (err instanceof ArchError) {
    return err.userMessage;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("rate") || lower.includes("429") || lower.includes("overloaded") || lower.includes("capacity")) {
    return "The AI service is temporarily overloaded. Please try again in a few moments.";
  }
  if (lower.includes("api key") || lower.includes("authentication") || lower.includes("401")) {
    return "API key is missing or invalid. Please check your configuration.";
  }
  if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("econnrefused") || lower.includes("network")) {
    return "A network or timeout error occurred. Please check your connection and try again.";
  }
  if (lower.includes("invalid") || lower.includes("parse") || lower.includes("json")) {
    return "The AI response could not be interpreted. Please try rephrasing your question.";
  }
  return "An unexpected error occurred. Please try again. If the problem persists, check your configuration.";
}
function logArchError(err, traceId, context) {
  const prefix = traceId ? `[manager] traceId=${traceId}` : "[manager]";
  const ctx = context ? ` ${context}` : "";
  if (err instanceof ArchError && err.internal) {
    console.error(`${prefix}${ctx}`, err.code, err.internal);
  } else if (err instanceof Error) {
    console.error(`${prefix}${ctx}`, err.message);
  } else {
    console.error(`${prefix}${ctx}`, String(err));
  }
}

// ../../src/ai/questionRouter.ts
import * as path9 from "path";
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s\-_./]/g, " ").split(/\s+/).filter((t) => t.length > 2);
}
function scoreNode(node, keywords) {
  const haystack = [
    node.id,
    node.label,
    node.suggestedLabel ?? "",
    node.description ?? "",
    node.layer ?? "",
    ...node.semanticSignals?.exports ?? []
  ].join(" ").toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += kw.length;
  }
  return score;
}
function scoreFinding(finding, keywords) {
  const haystack = `${finding.description} ${finding.location} ${finding.evidence.join(" ")}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += 1;
  }
  return score;
}
function classifyIntent(question) {
  const q = question.toLowerCase();
  if (/bug|broken|not work|fail|error|missing|why isn|issue|wrong/.test(q)) return "debug";
  if (/violat/.test(q)) return "violations";
  if (/drift/.test(q)) return "drift";
  if (/how.*reach|flow|trace|path from|end.to.end|request.*response/.test(q)) return "trace_flow";
  if (/show|filter|highlight|layer/.test(q)) return "show_layer";
  if (/overview|architecture|structure|what does.*repo|what is this/.test(q)) return "overview";
  if (/what does|tell me about|explain|describe/.test(q)) return "explain_node";
  return "general";
}
function routeQuestion(question, graph, findings, focusedNodeId, history) {
  const intent = classifyIntent(question);
  const historyKeywords = (history ?? []).slice(-3).flatMap((h) => tokenize(h.content)).slice(0, 20);
  const keywords = [...tokenize(question), ...historyKeywords];
  const forcedNodes = focusedNodeId ? graph.nodes.filter((n) => n.id === focusedNodeId) : [];
  const scored = graph.nodes.map((n) => ({ node: n, score: scoreNode(n, keywords) }));
  scored.sort((a, b) => b.score - a.score);
  const MAX_NODES = 6;
  const topNodes = scored.filter((s) => s.score > 0 && !forcedNodes.some((f) => f.id === s.node.id)).slice(0, MAX_NODES).map((s) => s.node);
  const relevantNodes = [...forcedNodes, ...topNodes];
  let neighbourNodes = [];
  if (intent === "debug" || intent === "trace_flow") {
    const relevantIds = new Set(relevantNodes.map((n) => n.id));
    const neighbourIds = /* @__PURE__ */ new Set();
    for (const edge of graph.edges) {
      if (relevantIds.has(edge.source)) neighbourIds.add(edge.target);
      if (relevantIds.has(edge.target)) neighbourIds.add(edge.source);
    }
    neighbourNodes = graph.nodes.filter(
      (n) => neighbourIds.has(n.id) && !relevantIds.has(n.id)
    );
  }
  const allRelevantNodes = [...relevantNodes, ...neighbourNodes].slice(0, 10);
  const root = graph.projectRoot;
  const filesToRead = [];
  for (const node of allRelevantNodes.slice(0, 4)) {
    const preferred = (node.files ?? []).filter((f) => /\.(ts|tsx|py)$/.test(f) && !/\.test\.|\.spec\./.test(f)).slice(0, 2);
    for (const f of preferred) {
      const fullPath = path9.join(root, f);
      if (!filesToRead.includes(fullPath)) filesToRead.push(fullPath);
    }
  }
  if (intent === "debug") {
    for (const finding of findings.filter((f) => f.severity === "critical").slice(0, 3)) {
      const loc = path9.isAbsolute(finding.location) ? finding.location : path9.join(root, finding.location);
      if (!filesToRead.includes(loc)) filesToRead.push(loc);
    }
  }
  const scoredFindings = findings.map((f) => ({ finding: f, score: scoreFinding(f, keywords) }));
  scoredFindings.sort((a, b) => {
    if (a.finding.severity === "critical" && b.finding.severity !== "critical") return -1;
    if (b.finding.severity === "critical" && a.finding.severity !== "critical") return 1;
    return b.score - a.score;
  });
  const relevantFindings = intent === "debug" || intent === "general" ? scoredFindings.slice(0, 15).map((s) => s.finding) : scoredFindings.filter((s) => s.score > 0).slice(0, 8).map((s) => s.finding);
  return {
    intent,
    relevantNodeIds: allRelevantNodes.map((n) => n.id),
    filesToRead: filesToRead.slice(0, 6),
    relevantFindings,
    keywords
  };
}

// ../../src/ai/retriever.ts
import * as fs9 from "fs";
import * as path10 from "path";

// ../../src/analyzer/driftDetector.ts
function redactSecrets(raw) {
  if (!raw) return raw;
  let out = raw;
  out = out.replace(
    /^([A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD|PWD)[A-Z0-9_]*\s*=\s*)(.+)$/gim,
    "$1[REDACTED]"
  );
  out = out.replace(
    /(["']?(apiKey|api_key|secret|token|password|pwd)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi,
    "$1[REDACTED]$4"
  );
  out = out.replace(
    /\b([A-Za-z0-9+/_-]{32,}|[A-Fa-f0-9]{40,})\b/g,
    "[REDACTED]"
  );
  return out;
}

// ../../src/ai/retriever.ts
var MAX_LINES_PER_FILE = 60;
var MAX_TOTAL_CHARS = 6e3;
function resolveFilePath(rootPath, fileOrPath) {
  if (path10.isAbsolute(fileOrPath)) return fileOrPath;
  const normalizedRoot = path10.normalize(rootPath);
  const normalizedFile = path10.normalize(fileOrPath);
  if (normalizedFile.startsWith(normalizedRoot)) {
    return normalizedFile;
  }
  return path10.join(rootPath, fileOrPath);
}
function extractSignificantLines(content, maxLines, questionKeywords = []) {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  const scored = lines.map((line, i) => {
    const l = line.trim();
    const lower = l.toLowerCase();
    let score = 0;
    if (/^export\s/.test(l)) score += 10;
    if (/^(class|function|const|interface|type)\s/.test(l)) score += 8;
    if (/\b(app|router)\.(get|post|put|delete|patch|use)\s*\(/.test(l)) score += 12;
    if (/^import\s/.test(l)) score += 3;
    if (/\/\/\s*(TODO|FIXME|NOTE|HACK)/.test(l)) score += 5;
    if (l.length === 0) score -= 2;
    score += Math.max(0, (100 - i) / 20);
    for (const kw of questionKeywords) {
      if (kw.length > 2 && lower.includes(kw.toLowerCase())) score += 15;
    }
    return { line, score, index: i };
  });
  const alwaysInclude = new Set(Array.from({ length: Math.min(10, lines.length) }, (_, i) => i));
  const remaining = scored.filter((s) => !alwaysInclude.has(s.index)).sort((a, b) => b.score - a.score).slice(0, maxLines - 10).map((s) => s.index).sort((a, b) => a - b);
  const selectedIndices = [...alwaysInclude, ...remaining].sort((a, b) => a - b);
  const result = [];
  let prev = -1;
  for (const idx of selectedIndices) {
    if (prev !== -1 && idx > prev + 1) result.push("  // ...");
    result.push(lines[idx]);
    prev = idx;
  }
  return result.join("\n");
}
function retrieveFileSnippets(rootPath, filePaths, graph, questionKeywords = []) {
  const snippets = [];
  let totalChars = 0;
  const filesNotFound = [];
  let filesSkipped = 0;
  const fileToNodeId = /* @__PURE__ */ new Map();
  for (const node of graph.nodes) {
    for (const file of node.files) {
      const fullPath = path10.join(graph.projectRoot, file);
      fileToNodeId.set(fullPath, node.id);
    }
    fileToNodeId.set(node.path, node.id);
  }
  for (const filePath of filePaths) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      filesSkipped += 1;
      continue;
    }
    const absPath = resolveFilePath(rootPath, filePath);
    let content;
    try {
      if (!fs9.existsSync(absPath)) {
        filesNotFound.push(absPath);
        console.warn(`[retriever] File not found: ${absPath}`);
        continue;
      }
      content = fs9.readFileSync(absPath, "utf-8");
    } catch {
      filesSkipped += 1;
      continue;
    }
    const basename6 = path10.basename(absPath).toLowerCase();
    if (basename6.startsWith(".env") || basename6.includes("config") || /\.(config|env|secret|credentials)\.(json|yaml|yml|toml)$/i.test(absPath)) {
      content = redactSecrets(content);
    }
    const extracted = extractSignificantLines(
      content,
      MAX_LINES_PER_FILE,
      questionKeywords
    );
    const truncated = content.split("\n").length > MAX_LINES_PER_FILE;
    const remaining = MAX_TOTAL_CHARS - totalChars;
    const finalContent = extracted.slice(0, remaining);
    totalChars += finalContent.length;
    const relPath = path10.relative(rootPath, absPath).replace(/\\/g, "/");
    snippets.push({
      filePath: relPath,
      nodeId: fileToNodeId.get(absPath) ?? path10.dirname(relPath),
      content: finalContent,
      truncated,
      lineCount: content.split("\n").length
    });
  }
  const formatted = snippets.length === 0 ? "" : "Relevant code (read from filesystem for this question):\n\n" + snippets.map(
    (s) => `--- ${s.filePath} (${s.lineCount} lines${s.truncated ? ", truncated" : ""}) ---
${s.content}`
  ).join("\n\n");
  const telemetry = filesNotFound.length > 0 || filesSkipped > 0 ? { filesNotFound, filesSkipped } : void 0;
  return { snippets, formatted, ...telemetry && { telemetry } };
}

// ../../src/agent/skillStore.ts
import * as fs10 from "fs";
import * as path11 from "path";
function getAgentDir(rootPath) {
  return path11.join(rootPath, ".agent");
}
function getSkillsDir(rootPath) {
  return path11.join(getAgentDir(rootPath), "skills");
}
function getIndexPath(rootPath) {
  return path11.join(getAgentDir(rootPath), "skill_index.json");
}
function ensureDirs(rootPath) {
  const agentDir = getAgentDir(rootPath);
  const skillsDir = getSkillsDir(rootPath);
  if (!fs10.existsSync(agentDir)) {
    fs10.mkdirSync(agentDir, { recursive: true });
  }
  if (!fs10.existsSync(skillsDir)) {
    fs10.mkdirSync(skillsDir, { recursive: true });
  }
}
function loadSkillIndex(rootPath) {
  ensureDirs(rootPath);
  const indexPath = getIndexPath(rootPath);
  if (!fs10.existsSync(indexPath)) {
    const empty = { skills: [] };
    fs10.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs10.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.skills) ? parsed : { skills: [] };
  } catch {
    try {
      const backupPath = indexPath.replace(/\.json$/, `.backup.${Date.now()}.json`);
      fs10.copyFileSync(indexPath, backupPath);
    } catch {
    }
    const empty = { skills: [] };
    fs10.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}
function saveSkillIndex(rootPath, index) {
  ensureDirs(rootPath);
  const indexPath = getIndexPath(rootPath);
  fs10.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}
function registerSkill(rootPath, meta) {
  const index = loadSkillIndex(rootPath);
  const existing = index.skills.find((s) => s.id === meta.id);
  const skill = {
    id: meta.id,
    description: meta.description,
    path: meta.path,
    language: meta.language,
    tags: meta.tags ?? [],
    usage_count: existing?.usage_count ?? 0,
    success_rate: existing?.success_rate ?? 0,
    status: existing?.status ?? "active"
  };
  if (existing) {
    const idx = index.skills.findIndex((s) => s.id === meta.id);
    index.skills[idx] = skill;
  } else {
    index.skills.push(skill);
  }
  saveSkillIndex(rootPath, index);
  return skill;
}
function incrementUsage(rootPath, id, success) {
  const index = loadSkillIndex(rootPath);
  const skill = index.skills.find((s) => s.id === id);
  if (!skill) return;
  const totalUses = skill.usage_count + 1;
  const prevSuccesses = Math.round(skill.success_rate * skill.usage_count);
  const newSuccesses = prevSuccesses + (success ? 1 : 0);
  skill.usage_count = totalUses;
  skill.success_rate = totalUses > 0 ? newSuccesses / totalUses : 0;
  saveSkillIndex(rootPath, index);
}
function formatSkillSummary(rootPath, max = 20) {
  const index = loadSkillIndex(rootPath);
  if (!index.skills.length) return "";
  const lines = [];
  for (const skill of index.skills.slice(0, max)) {
    const status = skill.status ?? "active";
    const rate = skill.usage_count ? `${(skill.success_rate * 100).toFixed(0)}%` : "n/a";
    const flagged = skill.usage_count >= 5 && skill.success_rate < 0.4 ? " \u26A0 LOW APPROVAL \u2014 consider refactor" : "";
    const tags = (skill.tags ?? []).join(", ");
    lines.push(
      `- ${skill.id} (${status}, used ${skill.usage_count}\xD7, success ${rate})` + (tags ? ` [${tags}]` : "") + (skill.description ? ` \u2014 ${skill.description}` : "") + flagged
    );
  }
  return lines.join("\n");
}

// ../../src/ai/claudeEnricher.ts
import Anthropic2 from "@anthropic-ai/sdk";
import * as fs13 from "fs";
import * as path14 from "path";

// ../../src/agent/sessionPersistence.ts
import * as fs11 from "fs";
import * as path12 from "path";
var SESSION_FILE = ".arch-agent-session.json";
function getSessionPath(projectRoot5) {
  return path12.join(projectRoot5, SESSION_FILE);
}
function saveSession(projectRoot5, session) {
  const p = getSessionPath(projectRoot5);
  fs11.writeFileSync(p, JSON.stringify(session, null, 2), "utf-8");
}
function loadSession(projectRoot5) {
  const p = getSessionPath(projectRoot5);
  if (!fs11.existsSync(p)) return null;
  try {
    const raw = fs11.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function bumpSessionUsage(projectRoot5, delta) {
  const session = loadSession(projectRoot5);
  if (!session) return;
  const ctx = getTraceContext();
  if (typeof delta.tokenUsage === "number" && Number.isFinite(delta.tokenUsage)) {
    session.tokenUsage += delta.tokenUsage;
    if (ctx.railId) {
      recordTokens(ctx.railId, delta.tokenUsage);
    }
  }
  if (typeof delta.llmCallCount === "number" && Number.isFinite(delta.llmCallCount)) {
    session.llmCallCount += delta.llmCallCount;
    if (ctx.railId) {
      recordLlmCall(ctx.railId);
    }
  }
  saveSession(projectRoot5, session);
}

// ../../src/ai/tools.ts
import { spawnSync } from "child_process";
import * as fs12 from "fs";
import * as path13 from "path";
var ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".mjs", ".cjs"]);
var READ_FILE_MAX_CHARS = 3e3;
var GREP_MAX_RESULTS = 20;
function walkFiles(root, maxFiles = 2e3) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs12.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path13.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (ALLOWED_EXTENSIONS.has(path13.extname(e.name))) {
        out.push(full);
        if (out.length >= maxFiles) return out;
      }
    }
  }
  return out;
}
function isUnderRoot(rootPath, absPath) {
  const rel = path13.relative(rootPath, absPath);
  return !rel.startsWith("..") && !path13.isAbsolute(rel);
}
function executeReadFile(rootPath, filePath) {
  const absPath = path13.isAbsolute(filePath) ? filePath : path13.join(rootPath, filePath);
  const root = path13.resolve(rootPath);
  if (!isUnderRoot(root, path13.resolve(absPath))) {
    return { error: "Path outside project root" };
  }
  const base = path13.basename(absPath);
  if (base === ".env" || base.startsWith(".env.") && !base.endsWith(".example") && !base.endsWith(".sample")) {
    return { error: "Environment files (.env*) are not readable" };
  }
  try {
    if (!fs12.existsSync(absPath)) {
      return { error: `File not found: ${filePath}` };
    }
    const content = fs12.readFileSync(absPath, "utf-8");
    const truncated = content.length > READ_FILE_MAX_CHARS;
    const result = truncated ? content.slice(0, READ_FILE_MAX_CHARS) + "\n\n// ... truncated" : content;
    return { result: `--- ${path13.relative(rootPath, absPath).replace(/\\/g, "/")} ---
${result}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function executeGrep(rootPath, pattern) {
  try {
    const files = walkFiles(rootPath);
    const results = [];
    const relRoot = path13.resolve(rootPath);
    for (const file of files) {
      if (results.length >= GREP_MAX_RESULTS) break;
      let content;
      try {
        content = fs12.readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < GREP_MAX_RESULTS; i++) {
        if (lines[i].includes(pattern)) {
          const relPath = path13.relative(relRoot, file).replace(/\\/g, "/");
          results.push({ file: relPath, line: i + 1, text: lines[i].trim() });
        }
      }
    }
    return { results };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
var RUN_COMMAND_ALLOWLIST = [
  "npx tsc ",
  "npx tsc --noEmit",
  "npx eslint ",
  "npm run ",
  "npm test",
  "npm run test",
  "npx vitest run",
  "npx jest "
];
var SHELL_META = /[&|;`$\\]/;
var RUN_STDOUT_MAX = 2e3;
var RUN_STDERR_MAX = 500;
function executeRunCommand(rootPath, command) {
  const trimmed = command.trim();
  const root = path13.resolve(rootPath);
  if (!fs12.existsSync(root) || !fs12.statSync(root).isDirectory()) {
    return { error: "Invalid project root" };
  }
  const allowed = RUN_COMMAND_ALLOWLIST.some(
    (prefix) => trimmed === prefix || trimmed.startsWith(prefix)
  );
  if (!allowed) {
    return { error: "Command not allowed. Use: npx tsc --noEmit, npx eslint, npm test, etc." };
  }
  if (SHELL_META.test(trimmed)) {
    return { error: "Command contains disallowed characters. No &&, |, ;, or shell metacharacters." };
  }
  try {
    const result = spawnSync(trimmed, {
      shell: true,
      cwd: rootPath,
      encoding: "utf-8",
      timeout: 6e4
    });
    const exitCode = result.status ?? -1;
    const stdout = (result.stdout ?? "").slice(0, RUN_STDOUT_MAX);
    const stderr = (result.stderr ?? "").slice(0, RUN_STDERR_MAX);
    const parts = [
      `exitCode: ${exitCode}`,
      stdout && `stdout:
${stdout}`,
      stderr && `stderr:
${stderr}`
    ].filter(Boolean);
    return { result: parts.join("\n\n") || "Command completed.", exitCode };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function executeRunSkill(rootPath, skillId, args) {
  const index = loadSkillIndex(rootPath);
  const meta = index.skills.find((s) => s.id === skillId);
  if (!meta || !meta.path) {
    return { error: `Skill not found in index: ${skillId}` };
  }
  const skillsRoot = path13.join(rootPath);
  const relPath = meta.path;
  const absPath = path13.isAbsolute(relPath) ? relPath : path13.join(skillsRoot, relPath);
  const skillsDir = path13.join(rootPath, ".agent", "skills");
  const absNorm = path13.resolve(absPath);
  const skillsNorm = path13.resolve(skillsDir);
  if (!absNorm.startsWith(skillsNorm + path13.sep) && absNorm !== skillsNorm) {
    return { error: "Skill path is outside .agent/skills (blocked)" };
  }
  if (!fs12.existsSync(absPath)) {
    return { error: `Skill file not found on disk: ${absPath}` };
  }
  const ext = path13.extname(absPath);
  if (args != null && args !== "" && SHELL_META.test(args)) {
    return { error: "Args contain disallowed characters. No shell metacharacters." };
  }
  const argParts = (args ?? "").trim().split(/\s+/).filter((s) => s.length > 0);
  let execPath;
  const execArgs = [];
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    execPath = "node";
    execArgs.push(absPath, ...argParts);
  } else if (ext === ".ts" || ext === ".tsx") {
    execPath = "npx";
    execArgs.push("tsx", absPath, ...argParts);
  } else if (ext === ".py") {
    execPath = "python3";
    execArgs.push(absPath, ...argParts);
  } else if (ext === ".sh") {
    execPath = "bash";
    execArgs.push(absPath, ...argParts);
  } else {
    return { error: `Unsupported skill language for path: ${absPath}` };
  }
  try {
    const result = spawnSync(execPath, execArgs, {
      cwd: rootPath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 6e4
    });
    const exitCode = result.status ?? -1;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const outputParts = [
      `exitCode: ${exitCode}`,
      stdout && `stdout:
${stdout}`,
      stderr && `stderr:
${stderr}`
    ].filter(Boolean);
    const success = exitCode === 0;
    incrementUsage(rootPath, skillId, success);
    recordSkillUsage(skillId, success);
    saveSkillPerformance(rootPath);
    return { result: outputParts.join("\n\n") || "Skill completed with no output." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function isSafeRelPath(relPath) {
  return !/\.\.|\\\\|\/\//.test(relPath);
}
function scaffoldNodeInline(rootPath, params) {
  const { archNodeId, relPath, layer, kind, template, readme, test } = params;
  if (!archNodeId || !relPath) {
    return { error: "archNodeId and relPath are required" };
  }
  if (!isSafeRelPath(relPath)) {
    return { error: "Invalid relPath: path traversal blocked" };
  }
  const root = path13.resolve(rootPath);
  const absPath = path13.resolve(root, relPath);
  const rel = path13.relative(root, absPath);
  if (rel.startsWith("..") || path13.isAbsolute(rel)) {
    return { error: "Path outside project root (blocked)" };
  }
  const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
  const targetDir = pathLooksLikeFile ? path13.dirname(absPath) : absPath;
  try {
    if (!fs12.existsSync(targetDir)) fs12.mkdirSync(targetDir, { recursive: true });
    const indexPath = pathLooksLikeFile ? absPath : path13.join(absPath, "index.ts");
    const header = `// @archNodeId: ${archNodeId}`;
    const layerStr = layer ?? "Uncategorized";
    const kindStr = kind ?? "module";
    let boilerplate;
    if (template === "api_route") {
      boilerplate = `

import { Request, Response } from "express";

export async function handle(req: Request, res: Response): Promise<void> {
  res.json({ ok: true });
}
`;
    } else if (template === "service") {
      boilerplate = `

export async function execute(): Promise<unknown> {
  return null;
}
`;
    } else {
      boilerplate = `

// TODO: Implement ${kindStr} for layer ${layerStr}.

export function TODO_${archNodeId.replace(/[^a-zA-Z0-9_]/g, "_")}() {
  // implementation pending
}
`;
    }
    if (fs12.existsSync(indexPath)) {
      const existing = fs12.readFileSync(indexPath, "utf-8");
      if (!existing.includes("@archNodeId:")) {
        fs12.writeFileSync(indexPath, `${header}
${existing}`, "utf-8");
      }
    } else {
      fs12.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
    }
    if (readme) {
      const modName = path13.basename(targetDir);
      fs12.writeFileSync(
        path13.join(targetDir, "README.md"),
        `# ${modName}

Architecture node: \`${archNodeId}\`

## Purpose

TODO: Describe this module.
`,
        "utf-8"
      );
    }
    if (test) {
      const baseName = pathLooksLikeFile ? path13.basename(absPath, path13.extname(absPath)) : "index";
      fs12.writeFileSync(
        path13.join(targetDir, `${baseName}.test.ts`),
        `// @archNodeId: ${archNodeId}

import { describe, it, expect } from "vitest";

describe("${archNodeId}", () => {
  it("should pass", () => {
    expect(true).toBe(true);
  });
});
`,
        "utf-8"
      );
    }
    const out = path13.relative(rootPath, indexPath).replace(/\\/g, "/");
    return { result: `Scaffolded node at ${out}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function executeScaffoldNode(rootPath, params) {
  const encode = (s) => s ? s.trim().replace(/\s+/g, "__") : "";
  const flagParts = [];
  if (params.readme) flagParts.push("--readme");
  if (params.test) flagParts.push("--test");
  if (params.template) flagParts.push(`--template=${params.template}`);
  const args = [
    params.archNodeId,
    params.relPath,
    encode(params.layer),
    encode(params.kind),
    ...flagParts
  ].filter((x) => x && x.length > 0).join(" ");
  const skillResult = executeRunSkill(rootPath, "scaffold-node", args);
  if (skillResult.error && /skill not found|Skill not found/i.test(skillResult.error)) {
    return scaffoldNodeInline(rootPath, params);
  }
  return skillResult;
}
function executeTelemetryTail(rootPath, params) {
  const logPath = process.env.ARCHY_LOG_PATH?.trim() || path13.join(rootPath, "logs", "app.log");
  if (!fs12.existsSync(logPath)) {
    return {
      error: "Telemetry log file not found. Set ARCHY_LOG_PATH or write logs to logs/app.log."
    };
  }
  try {
    const raw = fs12.readFileSync(logPath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const wantId = params.requestId?.trim();
    const wantRoute = params.route?.trim();
    const matches = lines.filter((line) => {
      if (!line) return false;
      let ok = true;
      if (wantId) ok = ok && line.includes(wantId);
      if (wantRoute) ok = ok && line.includes(wantRoute);
      return ok;
    });
    if (matches.length === 0) {
      return {
        result: "No matching telemetry entries found. Check ARCHY_LOG_PATH, requestId, and route."
      };
    }
    const tail = matches.slice(-80).join("\n");
    return {
      result: `Telemetry matches from ${path13.relative(
        rootPath,
        logPath
      )}:
${tail}`
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
async function executeJiraCreateTicket(rootPath, input, overrides) {
  const config = overrides?.config;
  if (!config) {
    return {
      error: "Jira not configured. Connect Jira in the Governance panel (web app)."
    };
  }
  const projectKey = (input.projectKey?.trim() || overrides?.projectKey || config.project?.trim() || "").trim();
  if (!projectKey) {
    return {
      error: "projectKey is required. Provide it in the tool input or via workspace Jira project key."
    };
  }
  try {
    const baseLabels = input.labels ?? [];
    const repoLabel = (() => {
      try {
        const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
          cwd: rootPath,
          encoding: "utf-8",
          timeout: 2e3
        });
        const top = git.stdout?.trim();
        return top ? path13.basename(top) : void 0;
      } catch {
        return void 0;
      }
    })();
    const labels = [...baseLabels];
    if (repoLabel) labels.push(repoLabel);
    if (input.archNodeId) labels.push(`archNodeId:${input.archNodeId}`);
    const res = await createIssue(config, {
      projectKey,
      summary: input.summary,
      description: input.description,
      labels
    });
    return {
      result: `Created Jira issue ${res.key} in project ${projectKey}`
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
var ARCH_NODE_ID_SAFE = /^[a-zA-Z0-9_\-.\/]+$/;
async function executeJiraSearchByArchNodeId(_rootPath, archNodeId, maxResults = 10, overrides) {
  const config = overrides?.config;
  if (!config) {
    return {
      error: "Jira not configured. Connect Jira in the Governance panel to enable searches."
    };
  }
  if (!ARCH_NODE_ID_SAFE.test(archNodeId)) {
    return {
      error: "archNodeId contains invalid characters. Use only letters, numbers, dash, underscore, slash, dot."
    };
  }
  const projectKey = (overrides?.projectKey ?? config.project?.trim() ?? "").trim();
  const label = `archNodeId:${archNodeId}`;
  const jqlBase = projectKey ? `project = ${projectKey} AND labels = '${label.replace(/'/g, "''")}'` : `labels = '${label.replace(/'/g, "''")}'`;
  const jql = `${jqlBase} ORDER BY updated DESC`;
  try {
    const issues = await searchIssues(config, jql, maxResults);
    if (issues.length === 0) {
      return { result: `No Jira issues found for ${label}.` };
    }
    const lines = issues.map(
      (i) => `${i.key} [${i.status}] ${i.type}${i.priority ? ` (${i.priority})` : ""} - ${i.summary}`
    );
    return { result: lines.join("\n") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ../../src/ai/graphCommandMatcher.ts
var NAVIGATION_TRIGGERS = [
  "show me",
  "show the",
  "find",
  "where is",
  "where are",
  "highlight",
  "focus on",
  "zoom to",
  "navigate to",
  "look at",
  "go to",
  "display",
  "architecture of",
  "what is the architecture of"
];
var LAYER_ALIASES = {
  Presentation: ["ui", "frontend", "front-end", "view", "page", "component", "screen", "presentation"],
  "Business Logic": ["business", "service", "logic", "domain", "core", "use case", "usecase"],
  "Data Access": ["data", "database", "db", "repository", "repo", "persistence", "storage", "dao"],
  Infrastructure: ["infra", "infrastructure", "config", "server", "deploy", "devops", "ci", "cd"],
  "External Services": ["external", "third party", "third-party", "api", "integration", "client", "provider"],
  Utilities: ["util", "utility", "helper", "shared", "common", "lib"],
  Configuration: ["config", "configuration", "settings", "env", "environment"]
};
function normalize2(s) {
  return s.toLowerCase().replace(/[-_/\\\.]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenize2(s) {
  return normalize2(s).split(" ").filter(Boolean);
}
function scoreNode2(node, queryTokens) {
  const labelTokens = tokenize2(node.suggestedLabel ?? node.label ?? node.id);
  const idTokens = tokenize2(node.id);
  const descTokens = tokenize2(node.description ?? "");
  const roleTokens = tokenize2(node.role ?? "");
  let score = 0;
  for (const qt of queryTokens) {
    if (qt.length < 3) continue;
    if (labelTokens.includes(qt)) score += 10;
    else if (labelTokens.some((lt) => lt.includes(qt) || qt.includes(lt))) score += 5;
    if (idTokens.some((it) => it.includes(qt) || qt.includes(it))) score += 4;
    if (roleTokens.some((rt) => rt.includes(qt) || qt.includes(rt))) score += 3;
    if (descTokens.some((dt) => dt.includes(qt) || qt.includes(dt))) score += 1;
  }
  const fullQuery = queryTokens.join(" ");
  const fullLabel = labelTokens.join(" ");
  if (fullLabel.includes(fullQuery)) score += 15;
  if (fullQuery.includes(fullLabel) && fullLabel.length > 3) score += 8;
  return score;
}
function matchLayer(queryTokens) {
  for (const [layer, aliases] of Object.entries(LAYER_ALIASES)) {
    for (const alias of aliases) {
      const aliasTokens = tokenize2(alias);
      if (aliasTokens.every((at) => queryTokens.includes(at))) {
        return layer;
      }
    }
  }
  return null;
}
function extractSubject(query) {
  const lower = query.toLowerCase();
  let subject = lower;
  for (const trigger of NAVIGATION_TRIGGERS.sort((a, b) => b.length - a.length)) {
    const idx = lower.indexOf(trigger);
    if (idx !== -1) {
      subject = lower.slice(idx + trigger.length).trim();
      break;
    }
  }
  return subject.replace(/^(the|a|an|this|that)\s+/i, "").trim();
}
function matchQueryToGraph(query, graph) {
  const lower = query.toLowerCase();
  const isNavigation = NAVIGATION_TRIGGERS.some((t) => lower.includes(t));
  if (!isNavigation) {
    return { isNavigation: false, matchedNodeIds: [], reason: "no navigation trigger" };
  }
  const subject = extractSubject(query);
  const subjectTokens = tokenize2(subject);
  if (subjectTokens.length === 0) {
    return { isNavigation: true, matchedNodeIds: [], reason: "no subject after trigger" };
  }
  const matchedLayer = matchLayer(subjectTokens);
  if (matchedLayer) {
    const layerNodes = graph.nodes.filter((n) => n.layer === matchedLayer);
    return {
      isNavigation: true,
      matchedNodeIds: layerNodes.map((n) => n.id),
      reason: `layer match: "${matchedLayer}"`
    };
  }
  const scored = graph.nodes.map((n) => ({ node: n, score: scoreNode2(n, subjectTokens) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return { isNavigation: true, matchedNodeIds: [], reason: "no nodes matched subject" };
  }
  const topScore = scored[0].score;
  const threshold = topScore * 0.6;
  const topNodes = scored.filter((x) => x.score >= threshold).slice(0, 5);
  return {
    isNavigation: true,
    matchedNodeIds: topNodes.map((x) => x.node.id),
    reason: `matched ${topNodes.length} node(s) for subject "${subject}" (top score: ${topScore})`
  };
}
function matchNodeByLabel(query, graph) {
  const q = query.trim();
  if (!q || graph.nodes.length === 0) return null;
  const subjectTokens = tokenize2(q);
  if (subjectTokens.length === 0) return null;
  const scored = graph.nodes.map((n) => ({ node: n, score: scoreNode2(n, subjectTokens) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.length > 0 ? scored[0].node.id : null;
}
function formatMatchedNodesForPrompt(matchedNodeIds, graph) {
  if (matchedNodeIds.length === 0) return "";
  const lines = [
    "Nodes most likely relevant to this query (use these IDs in graphCommand):"
  ];
  for (const id of matchedNodeIds) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) continue;
    const label = node.suggestedLabel ?? node.label ?? id;
    lines.push(`  - id: "${id}" | label: "${label}" | layer: ${node.layer}`);
    if (node.description) lines.push(`    description: ${node.description}`);
  }
  return lines.join("\n");
}

// ../../src/agent/tokenBudget.ts
var CONTEXT_WINDOW_SAFE = 18e4;
var TIER2_FRACTION = 0.8;

// ../../src/agent/rail/context.ts
function asTokenEstimate(text) {
  return Math.ceil(text.length / 4);
}
function summarizeMessages(messages) {
  if (messages.length === 0) return "";
  const last = messages[messages.length - 1];
  const prefix = messages.length > 1 ? `(${messages.length} turns) Latest:
` : "";
  return `${prefix}${last.role}: ${last.content.slice(0, 800)}`;
}
function buildRailContext(rail, fullHistory, tokenBudget) {
  const result = [];
  const effectiveOutcome = rail.frozenOutcome ?? rail.outcome;
  const effectiveLogicPath = rail.frozenLogicPath ?? rail.logicPath;
  const logicPathSummary = effectiveLogicPath.length > 0 ? effectiveLogicPath.map((s) => `${s.layer}:${s.nodeId}`).slice(0, 8).join(" \u2192 ") : "unknown";
  const railSummary = [
    `RAIL OUTCOME: ${effectiveOutcome}`,
    `RAIL STATE: ${rail.state}`,
    `LOGIC PATH: ${logicPathSummary}`
  ].join("\n");
  result.push({
    role: "system",
    content: railSummary
  });
  let tokensUsed = asTokenEstimate(railSummary);
  const sessionHistory = fullHistory.filter((m) => {
    const any = m;
    const msgRailId = any.railId;
    const msgSessionId = any.sessionId;
    if (msgRailId && msgRailId === rail.id) return true;
    if (!msgRailId && (msgSessionId === rail.sessionId || !msgSessionId)) return true;
    return false;
  });
  const MAX_RECENT = 12;
  const recent = sessionHistory.slice(-MAX_RECENT);
  const recentMessages = [];
  for (const msg of recent) {
    const t = asTokenEstimate(msg.content);
    if (tokensUsed + t > tokenBudget * TIER2_FRACTION) {
      break;
    }
    recentMessages.push(msg);
    tokensUsed += t;
  }
  const droppedCount = recent.length - recentMessages.length;
  if (droppedCount > 0) {
    const digest = summarizeMessages(recent);
    let digestText = `RAIL HISTORY DIGEST:
${digest}`;
    let digestTokens = asTokenEstimate(digestText);
    if (tokensUsed + digestTokens > tokenBudget) {
      const available = Math.max(tokenBudget - tokensUsed, 0);
      const maxChars = available * 4;
      digestText = digestText.slice(0, Math.max(maxChars, 0));
      digestTokens = asTokenEstimate(digestText);
    }
    if (digestTokens > 0 && tokensUsed + digestTokens <= tokenBudget) {
      result.push({
        role: "system",
        content: digestText
      });
      tokensUsed += digestTokens;
    }
  } else {
    result.push(...recentMessages);
  }
  return result;
}

// ../../src/ai/contextTrim.ts
function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}
function trimHistoryToBudget(messages, budget, fractionForRecent = 0.8) {
  const targetBudget = Math.floor(budget * fractionForRecent);
  let tokensUsed = 0;
  const recent = [];
  for (let i = messages.length - 1; i >= 0 && tokensUsed < targetBudget; i--) {
    const m = messages[i];
    const t = estimateTokens(m.content);
    if (tokensUsed + t <= targetBudget) {
      recent.unshift(m);
      tokensUsed += t;
    } else break;
  }
  const droppedCount = messages.length - recent.length;
  if (droppedCount <= 0) return recent;
  const last = messages[messages.length - 1];
  const digest = `(Prior ${messages.length} turns, latest): ${last.role}: ${last.content.slice(0, 600)}`;
  const digestTokens = estimateTokens(digest);
  if (digestTokens + tokensUsed <= budget) {
    return [{ role: "system", content: `HISTORY DIGEST: ${digest}` }, ...recent];
  }
  return recent;
}
function trimTextToBudget(text, budget) {
  const est = estimateTokens(text);
  if (est <= budget) return text;
  const maxChars = Math.max(0, budget * 4);
  return text.slice(0, maxChars) + "\n[Truncated for context limit.]";
}

// ../../src/ai/claudeEnricher.ts
var VALID_LAYERS = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized"
];
function isValidLayer(v) {
  return VALID_LAYERS.includes(v);
}
function parseGraphCommand(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const o = raw;
  if (o.action === "highlight_nodes" && Array.isArray(o.nodeIds)) {
    const nodeIds = o.nodeIds.filter((id) => typeof id === "string");
    if (nodeIds.length > 0) return { action: "highlight_nodes", nodeIds };
  }
  if (o.action === "filter_layer" && typeof o.layer === "string" && isValidLayer(o.layer)) {
    return { action: "filter_layer", layer: o.layer };
  }
  if (o.action === "filter_edge_type" && typeof o.edgeType === "string") {
    const edgeType = o.edgeType;
    if (["arch", "drift", "violations", "all"].includes(edgeType)) {
      return { action: "filter_edge_type", edgeType };
    }
  }
  if (o.action === "focus_node" && typeof o.nodeId === "string") {
    return { action: "focus_node", nodeId: o.nodeId };
  }
  if (o.action === "reset") return { action: "reset" };
  if (o.action === "create_node" && typeof o.id === "string" && typeof o.label === "string" && typeof o.layer === "string" && isValidLayer(o.layer)) {
    return {
      action: "create_node",
      id: o.id,
      label: o.label,
      layer: o.layer,
      description: typeof o.description === "string" ? o.description : void 0,
      archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : void 0
    };
  }
  if (o.action === "connect" && typeof o.fromId === "string" && typeof o.toId === "string") {
    const edgeType = typeof o.edgeType === "string" ? o.edgeType : void 0;
    return {
      action: "connect",
      fromId: o.fromId,
      toId: o.toId,
      edgeType
    };
  }
  if (o.action === "trace_path" && Array.isArray(o.nodeIds)) {
    const nodeIds = o.nodeIds.filter((id) => typeof id === "string");
    if (nodeIds.length > 0) {
      return {
        action: "trace_path",
        nodeIds,
        intensity: typeof o.intensity === "number" ? o.intensity : void 0
      };
    }
  }
  return void 0;
}
var TOOLS = [
  {
    name: "retrieve_files",
    description: "Retrieve source file contents to answer questions about the codebase. Use this when you need to see actual code, not just module summaries.",
    input_schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "File paths relative to project root. Max 6 per call. Use paths from the available_paths list only."
        },
        reason: {
          type: "string",
          description: "Why you need these files \u2014 what you expect to find."
        }
      },
      required: ["files"]
    }
  },
  {
    name: "scaffold_node",
    description: "Create or update a module scaffold on disk for a proposed architecture node. Use this after a new node design is confirmed.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: {
          type: "string",
          description: "Stable archNodeId to write into file headers (e.g. 'routes/auth')."
        },
        relPath: {
          type: "string",
          description: "Directory or file path relative to project root where the scaffold should live (e.g. 'services/cache')."
        },
        layer: {
          type: "string",
          description: "Optional layer name (Presentation, Business Logic, etc.)."
        },
        kind: {
          type: "string",
          description: "Optional module kind (service, route, adapter, etc.)."
        },
        template: {
          type: "string",
          enum: ["api_route", "service"],
          description: "Optional scaffold template: api_route for Express handlers, service for service layer."
        },
        readme: {
          type: "boolean",
          description: "If true, create a README.md in the scaffolded directory."
        },
        test: {
          type: "boolean",
          description: "If true, create a .test.ts stub file."
        }
      },
      required: ["archNodeId", "relPath"]
    }
  },
  {
    name: "telemetry_tail",
    description: "Tail structured logs to inspect runtime behavior for a specific requestId or route. Use this when the user asks to trace a live/request flow.",
    input_schema: {
      type: "object",
      properties: {
        requestId: {
          type: "string",
          description: "Optional request ID or correlation ID to filter logs."
        },
        route: {
          type: "string",
          description: "Optional route or path fragment to filter logs."
        }
      }
    }
  },
  {
    name: "jira_create_ticket",
    description: "Create a Jira issue for an architectural violation or bug, tagging it with archNodeId so it links back to the graph.",
    input_schema: {
      type: "object",
      properties: {
        projectKey: {
          type: "string",
          description: "Jira project key (e.g. ARCH, ENG)."
        },
        summary: {
          type: "string",
          description: "Short summary of the issue."
        },
        description: {
          type: "string",
          description: "Longer description, including findings and context."
        },
        archNodeId: {
          type: "string",
          description: "archNodeId for the affected node, used as a label."
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional extra labels."
        }
      },
      required: ["projectKey", "summary"]
    }
  },
  {
    name: "jira_search_by_archNodeId",
    description: "Search Jira for issues tagged with a given archNodeId label. Use this to connect the graph to existing tickets.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: {
          type: "string",
          description: "Label value archNodeId:<id> that was used when creating tickets."
        },
        maxResults: {
          type: "integer",
          description: "Maximum number of issues to return (default 10)."
        }
      },
      required: ["archNodeId"]
    }
  },
  {
    name: "jira_watch",
    description: 'Check the latest Jira issues for a given archNodeId label. Call this periodically to "watch" an issue or module over time.',
    input_schema: {
      type: "object",
      properties: {
        archNodeId: {
          type: "string",
          description: "archNodeId for the module you want to watch (labels are stored as archNodeId:<id>)."
        },
        maxResults: {
          type: "integer",
          description: "Maximum number of issues to return (default 5)."
        }
      },
      required: ["archNodeId"]
    }
  },
  {
    name: "run_skill",
    description: "Execute a previously saved skill from the .agent/skills folder and return its output. Use this when the user asks to USE a skill (e.g. summarize routes) rather than to create one.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Skill ID (e.g. 'map-routes'). Must match an id in skill_index.json."
        },
        args: {
          type: "string",
          description: "Optional CLI arguments to pass to the skill (e.g. '--json')."
        }
      },
      required: ["id"]
    }
  },
  {
    name: "save_skill",
    description: "Persist a small reusable script or plan into the Skill Library under .agent/skills. Use this when you create a general-purpose helper that will likely be useful in future tasks.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short identifier for the skill, used as the file base name. Use letters, numbers, and underscores only."
        },
        description: {
          type: "string",
          description: "One sentence describing what this skill does and when to use it."
        },
        language: {
          type: "string",
          enum: ["typescript", "python", "bash", "other"],
          description: "Language of the code snippet. Determines file extension."
        },
        code: {
          type: "string",
          description: "The full source code for the skill."
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for this skill, e.g. ['refactor','typescript','git']. Helps with future lookup."
        }
      },
      required: ["name", "description", "language", "code"]
    }
  },
  {
    name: "grep_codebase",
    description: "Search for a string or pattern across all source files. Use to find callers, implementations, or usages of a function/route/class.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "String to search for (exact match, case-sensitive)."
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "read_file",
    description: "Read a single file's full contents.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to project root."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "run_command",
    description: "Run an allowed command and see its output. Use for type-checking (npx tsc --noEmit), linting, or tests.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to run. Allowed: npx tsc --noEmit, npx eslint src, npm test, npm run <script>"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "propose_architecture",
    description: "Propose new architectural components before writing any code. Use this when the user asks to BUILD, ADD, or CREATE something new.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              layer: { type: "string", enum: VALID_LAYERS },
              description: { type: "string" },
              files: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    purpose: { type: "string" },
                    todos: { type: "array", items: { type: "string" } }
                  },
                  required: ["name", "purpose", "todos"]
                }
              },
              connectsTo: { type: "array", items: { type: "string" } }
            },
            required: ["id", "label", "layer", "description", "files", "connectsTo"]
          }
        },
        reuses: { type: "array", items: { type: "string" } },
        rationale: { type: "string" }
      },
      required: ["summary", "nodes", "reuses", "rationale"]
    }
  },
  {
    name: "answer",
    description: "Provide the final answer to the user's question.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        graphCommand: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "filter_layer",
                "filter_edge_type",
                "highlight_nodes",
                "focus_node",
                "reset",
                "create_node",
                "connect",
                "trace_path"
              ]
            },
            layer: { type: "string" },
            edgeType: { type: "string" },
            nodeIds: { type: "array", items: { type: "string" } },
            nodeId: { type: "string" },
            id: { type: "string" },
            label: { type: "string" },
            description: { type: "string" },
            archNodeId: { type: "string" },
            fromId: { type: "string" },
            toId: { type: "string" },
            intensity: { type: "number" }
          },
          required: ["action"]
        }
      },
      required: ["content"]
    }
  }
];
function loadProjectMemory(graph) {
  const root = graph.projectRoot ?? "";
  if (!root) return "";
  const memoryPath = path14.join(root, ".archy.md");
  try {
    if (!fs13.existsSync(memoryPath)) return "";
    const content = fs13.readFileSync(memoryPath, "utf-8").trim();
    if (!content) return "";
    return `

## Project memory (.archy.md)
${content}`;
  } catch {
    return "";
  }
}
function buildSystemPrompt(graph) {
  const base = `You are a senior software architect embedded in the ${graph.projectName ?? "this"} codebase.

You reason in layers, understand module boundaries, and use tools to inspect real code before making claims.

When the user asks to build something new, always propose_architecture first before any code is written.

## Response formatting rules
- Use **bold** for section titles and emphasis, never ## markdown headers
- Use \`inline code\` for file paths, function names, variable names, and commands
- Use plain bullet points (\u2014) for lists, not markdown bullets
- Write in clear prose paragraphs where possible, not just bullet lists
- Keep tables for structured comparisons only \u2014 not for simple lists
- Lead with the most important insight, then supporting detail

You have a persistent Skill Library under .agent/skills and an index in .agent/skill_index.json.
- When you create a small, reusable helper script or code-based tool, call save_skill with a clear name, description, language, code, and optional tags.
- When the user asks to USE a skill (e.g. "use map-routes to summarize routes", "run the list-interfaces skill", "summarize all routes"), you MUST call the run_skill tool with that skill's id, then call the answer tool with a concise summary of the tool output. Do not reply with "I was unable to formulate" when the skill is listed in the Skill Library \u2014 execute it and report.
- Prefer reusing existing skills via the run_skill tool over re-implementing the same logic in every conversation.
- IMPORTANT: If the user explicitly says "save it as a skill called X" or similar, you MUST:
  1) Implement the script or helper, and
  2) Call save_skill with name "X" (or the exact name they gave) and the code, instead of only replying with code in text.`;
  const memory = loadProjectMemory(graph);
  const navInstructions = `

## Canvas navigation
When the user asks to show, find, highlight, or navigate to something:
- ALWAYS use the answer tool with a graphCommand \u2014 never reply with text only.
- Use focus_node for a single module, highlight_nodes for a set, filter_layer for a whole layer.
- Use exact node IDs from the architecture context, not labels.
- If nothing matches, use graphCommand.action="reset" and explain what wasn't found.

## Convergence rules
1. Every task MUST end with a call to the answer tool. Do not finish a conversation without calling the answer tool at least once.
2. After you successfully save a skill with save_skill, your next and final step is to call the answer tool to summarize what you did for the user and finish the task.
3. For requests that ask to use or run a skill (e.g. "summarize routes using map-routes"), call run_skill with that skill's id, then call answer with a short summary of the output. Do not answer with inability when the skill exists in the Skill Library.
4. If tools such as read_file, retrieve_files, grep_codebase, or run_command fail repeatedly (for example, due to "File not found"), stop searching and instead provide the best possible implementation or explanation based on the architecture context, then call the answer tool.
5. For long enumerations (route maps, interface lists, module summaries): prefer full enumeration per file or section; avoid placeholder text like "(Inspect file for full list)". If output would be very long, list key items and add "... (N more)" or summarize by section so the response is not truncated.`;
  return base + memory + navInstructions;
}
function buildGraphContext(graph, relevantNodeIds, intent, findings, codeContext, focusNodeId, history, question, availablePaths) {
  const isOverview = intent === "overview" || intent === "show_layer" || relevantNodeIds.length === 0;
  const nodesToShow = isOverview ? graph.nodes : graph.nodes.filter((n) => relevantNodeIds.includes(n.id));
  const displayNodes = nodesToShow.length === 0 ? graph.nodes : nodesToShow;
  const nodeLines = displayNodes.map(
    (n) => `- ${n.suggestedLabel ?? n.label} (${n.layer ?? "?"}) [${n.id}]: ${n.description ?? ""}`
  ).join("\n");
  const relevantIds = new Set(displayNodes.map((n) => n.id));
  const edgeLines = graph.edges.filter((e) => relevantIds.has(e.source) || relevantIds.has(e.target)).slice(0, 25).map((e) => {
    const src = graph.nodes.find((n) => n.id === e.source)?.suggestedLabel ?? e.source;
    const tgt = graph.nodes.find((n) => n.id === e.target)?.suggestedLabel ?? e.target;
    return `  ${src} \u2192 ${tgt}${e.isDrift ? " \u26A0 DRIFT" : ""}${e.isLayerViolation ? " \u26D4 VIOLATION" : ""}`;
  }).join("\n");
  const findingLines = findings.length > 0 ? findings.slice(0, 20).map(
    (f) => `- [${f.severity}] ${f.type}: ${f.description} (${f.location})`
  ).join("\n") : "None detected.";
  const focusNode = focusNodeId ? graph.nodes.find((n) => n.id === focusNodeId) : void 0;
  const focusLine = focusNode ? `
User is focused on: ${focusNode.suggestedLabel ?? focusNode.label} [${focusNode.id}] \u2014 ${focusNode.layer}
${focusNode.description ?? ""}` : "";
  const conversationTurns = history?.filter(
    (h) => h.role === "user" || h.role === "assistant"
  ) ?? [];
  const historyLines = conversationTurns.length > 0 ? `
Conversation history:
${conversationTurns.slice(-4).map((h) => `${h.role}: ${h.content.slice(0, 300)}`).join("\n")}
` : "";
  const pathList = [...availablePaths].slice(0, 50).join("\n");
  return `## Architecture
${nodeLines}

## Connections
${edgeLines}

## Static analysis findings
${findingLines}

${codeContext ? `## Retrieved code
${codeContext}
` : ""}${focusLine}

## Available file paths
${pathList}

${historyLines}## Question
${question}`;
}
function formatReasoningStep(toolName, input, result) {
  switch (toolName) {
    case "retrieve_files": {
      const files = (input.files ?? []).slice(0, 3);
      const count = (input.files ?? []).length;
      const names = files.map((f) => path14.basename(f));
      return count > 0 ? `Retrieved code from ${names.join(", ")}${count > 3 ? ` (+${count - 3} more)` : ""}` : "";
    }
    case "grep_codebase":
      return `Searched codebase for "${String(input.pattern ?? "").slice(0, 40)}"`;
    case "read_file":
      return `Read file ${String(input.path ?? "").slice(-60)}`;
    case "run_command":
      return `Ran command: ${String(input.command ?? "").slice(0, 50)}`;
    case "run_skill":
      return `Executed skill "${String(input.id ?? "")}"`;
    case "propose_architecture":
      return `Proposed architecture with ${(input.nodes ?? []).length} new modules`;
    case "save_skill":
      return `Saved skill "${String(input.name ?? "")}"`;
    case "jira_watch":
    case "jira_create_ticket":
      return `Accessed Jira for ${String(input.archNodeId ?? "").slice(0, 30) || "issues"}`;
    default:
      return `Used ${toolName}`;
  }
}
function collectCitations(toolName, input, result, out, relevantNodeIds, graph) {
  if (toolName === "retrieve_files") {
    const files = input.files ?? [];
    for (const f of files) {
      const key = `file:${f}`;
      if (!out.has(key)) {
        const node = graph.nodes.find((n) => n.files?.some((pf) => pf.includes(f) || f.includes(pf)));
        out.set(key, {
          label: path14.basename(f),
          filePath: f,
          nodeId: node?.id
        });
      }
    }
  } else if (toolName === "read_file") {
    const p = String(input.path ?? "");
    if (p) {
      const key = `file:${p}`;
      if (!out.has(key)) {
        const node = graph.nodes.find((n) => n.files?.some((pf) => pf.includes(p) || p.includes(pf)));
        out.set(key, { label: path14.basename(p), filePath: p, nodeId: node?.id });
      }
    }
  }
  for (const nid of relevantNodeIds) {
    const key = `node:${nid}`;
    if (!out.has(key)) {
      const node = graph.nodes.find((n) => n.id === nid);
      out.set(key, {
        label: node?.label ?? node?.path ?? nid,
        nodeId: nid
      });
    }
  }
}
async function executeTool(toolName, toolInput, basePath, graph, availablePaths, keywords, jiraContext) {
  switch (toolName) {
    case "retrieve_files": {
      const files = toolInput.files ?? [];
      const validPaths = files.filter((p) => typeof p === "string" && availablePaths.has(p)).slice(0, 6).map((p) => path14.join(basePath, p));
      if (validPaths.length === 0) {
        return {
          result: "No valid paths provided. Use paths from the available file paths list exactly as shown."
        };
      }
      const retrieved = retrieveFileSnippets(basePath, validPaths, graph, keywords);
      return { result: retrieved.formatted || "Files were empty or not found." };
    }
    case "grep_codebase": {
      const pattern = toolInput.pattern;
      const res = executeGrep(basePath, pattern);
      if (res.results && res.results.length > 0) {
        return {
          result: res.results.slice(0, 30).map((r) => `${r.file}:${r.line} ${r.text}`).join("\n")
        };
      }
      return { result: res.error ?? `No matches found for "${pattern}".` };
    }
    case "read_file": {
      const filePath = toolInput.path;
      const res = executeReadFile(basePath, filePath);
      return { result: res.result ?? `Error: ${res.error}` };
    }
    case "run_command": {
      const command = toolInput.command;
      const res = executeRunCommand(basePath, command);
      if (res.error) return { result: `Error: ${res.error}` };
      return { result: res.result ?? "Command completed with no output." };
    }
    case "run_skill": {
      const id = String(toolInput.id ?? "").trim();
      const args = String(toolInput.args ?? "").trim() || void 0;
      if (!basePath) {
        return {
          result: "Cannot run skill: project root is unknown. Ensure graph.projectRoot is set."
        };
      }
      if (!id) {
        return { result: "Cannot run skill: id is required." };
      }
      const res = executeRunSkill(basePath, id, args);
      if (res.error) {
        return { result: `Error running skill '${id}': ${res.error}` };
      }
      return { result: res.result ?? "Skill completed with no output." };
    }
    case "propose_architecture": {
      return {
        result: `Architecture proposal created with ${(toolInput.nodes ?? []).length} new modules. Awaiting user approval.`,
        proposal: toolInput
      };
    }
    case "save_skill": {
      const name = String(toolInput.name ?? "").trim();
      const description = String(toolInput.description ?? "").trim();
      const language = String(toolInput.language ?? "typescript").trim();
      const code = String(toolInput.code ?? "");
      const tagsInput = toolInput.tags;
      const tags = Array.isArray(tagsInput) && tagsInput.every((t) => typeof t === "string") ? tagsInput : [];
      console.log(
        `[save_skill] Requested skill "${name}" | language=${language} | codeLength=${code.length}`
      );
      if (!basePath) {
        return {
          result: "Cannot save skill: project root is unknown. Ensure graph.projectRoot is set."
        };
      }
      if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
        return {
          result: "Skill name is required and must contain only letters, numbers, underscores, or hyphens."
        };
      }
      if (!code.trim()) {
        return { result: "Cannot save empty skill code." };
      }
      let ext = ".ts";
      if (language === "python") ext = ".py";
      else if (language === "bash") ext = ".sh";
      const skillsDir = path14.join(basePath, ".agent", "skills");
      try {
        if (!fs13.existsSync(skillsDir)) {
          fs13.mkdirSync(skillsDir, { recursive: true });
        }
      } catch (err) {
        return {
          result: `Failed to prepare skills directory: ${err instanceof Error ? err.message : String(err)}`
        };
      }
      const fileName = `${name}${ext}`;
      const absPath = path14.join(skillsDir, fileName);
      const resolved = path14.resolve(absPath);
      const resolvedSkillsDir = path14.resolve(skillsDir);
      if (!resolved.startsWith(resolvedSkillsDir)) {
        return {
          result: "Refused to save skill: resolved path escapes the .agent/skills directory."
        };
      }
      try {
        fs13.writeFileSync(absPath, code, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[save_skill] Failed to write skill file: ${msg}`);
        return {
          result: `Failed to write skill file: ${msg}`
        };
      }
      const relPath = path14.relative(basePath, absPath).replace(/\\/g, "/");
      try {
        registerSkill(basePath, {
          id: name,
          description,
          path: relPath,
          language,
          tags
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[save_skill] Failed to update skill index: ${msg}`);
        return {
          result: `Skill file saved, but failed to update skill index: ${msg}`
        };
      }
      const successMsg = `Skill '${name}' saved successfully at ${relPath}.`;
      return {
        result: `${successMsg}

IMPORTANT: You have fulfilled the skill creation for this request.
- You MUST now call the answer tool to summarize what you did for the user and finish the task.
- Do not call more search tools (retrieve_files, grep_codebase, run_command) unless absolutely necessary.
- Focus on explaining how to use this skill in the future and, if relevant, what it discovered.`
      };
    }
    case "scaffold_node": {
      if (!basePath) {
        return {
          result: "Cannot scaffold node: project root is unknown. Ensure graph.projectRoot is set."
        };
      }
      const archNodeId = String(toolInput.archNodeId ?? "").trim();
      const relPath = String(toolInput.relPath ?? "").trim();
      const layer = typeof toolInput.layer === "string" ? toolInput.layer : void 0;
      const kind = typeof toolInput.kind === "string" ? toolInput.kind : void 0;
      const template = typeof toolInput.template === "string" ? toolInput.template : void 0;
      const readme = toolInput.readme === true || toolInput.readme === "true";
      const test = toolInput.test === true || toolInput.test === "true";
      if (!archNodeId || !relPath) {
        return {
          result: "archNodeId and relPath are required to scaffold a node."
        };
      }
      const res = executeScaffoldNode(basePath, {
        archNodeId,
        relPath,
        layer,
        kind,
        template,
        readme,
        test
      });
      return {
        result: res.result ?? `Error scaffolding node: ${res.error}`
      };
    }
    case "telemetry_tail": {
      const params = {
        requestId: typeof toolInput.requestId === "string" ? toolInput.requestId : void 0,
        route: typeof toolInput.route === "string" ? toolInput.route : void 0
      };
      const res = executeTelemetryTail(basePath, params);
      return {
        result: res.result ?? `Telemetry error: ${res.error}`
      };
    }
    case "jira_create_ticket": {
      const fromInput = String(toolInput.projectKey ?? "").trim();
      const projectKey = fromInput || (jiraContext?.projectKey ?? "");
      const summary = String(toolInput.summary ?? "").trim();
      const description = typeof toolInput.description === "string" ? toolInput.description : void 0;
      const archNodeId = typeof toolInput.archNodeId === "string" ? toolInput.archNodeId : void 0;
      const labelsInput = toolInput.labels;
      const labels = Array.isArray(labelsInput) && labelsInput.every((t) => typeof t === "string") ? labelsInput : void 0;
      if (!projectKey || !summary) {
        return {
          result: "summary is required. projectKey is required (provide in tool input or set workspace Jira project key)."
        };
      }
      const res = await executeJiraCreateTicket(
        basePath,
        { projectKey, summary, description, archNodeId, labels },
        jiraContext
      );
      return {
        result: res.result ?? `Jira error: ${res.error}`
      };
    }
    case "jira_search_by_archNodeId": {
      const archNodeId = String(toolInput.archNodeId ?? "").trim();
      const maxResultsRaw = toolInput.maxResults;
      const maxResults = typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw) ? maxResultsRaw : 10;
      if (!archNodeId) {
        return { result: "archNodeId is required to search Jira issues." };
      }
      const res = await executeJiraSearchByArchNodeId(
        basePath,
        archNodeId,
        maxResults,
        jiraContext
      );
      return {
        result: res.result ?? `Jira search error: ${res.error}`
      };
    }
    case "jira_watch": {
      const archNodeId = String(toolInput.archNodeId ?? "").trim();
      const maxResultsRaw = toolInput.maxResults;
      const maxResults = typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw) ? maxResultsRaw : 5;
      if (!archNodeId) {
        return {
          result: "archNodeId is required to watch Jira issues. Pass the module's archNodeId (e.g. 'services/auth')."
        };
      }
      const res = await executeJiraSearchByArchNodeId(
        basePath,
        archNodeId,
        maxResults,
        jiraContext
      );
      return {
        result: res.result ?? `Jira watch error: ${res.error}`
      };
    }
    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}
async function askAboutArchitecture(question, graph, nodeId, history, apiKey, findings, rootPath, jiraConfig, jiraProjectKey, rail, pdfBase64, pdfFileName, feedbackContext) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return {
      answer: "[No API key] Set ANTHROPIC_API_KEY or archVisualizer.anthropicApiKey to enable Claude reasoning."
    };
  }
  const client = new Anthropic2({ apiKey: key });
  const allFindings = findings ?? [];
  const basePath = rootPath ?? graph.projectRoot;
  const hist = history ?? [];
  const railContext = rail && rail.logicPath?.length ? buildRailContext(rail, hist, 500) : [];
  const route = routeQuestion(question, graph, allFindings, nodeId, history);
  const matchResult = matchQueryToGraph(question, graph);
  const skillSaveMatch = question.match(
    /save (?:it |this )?as a skill(?: called| named)?\s+["']?([\w\-]+)["']?/i
  );
  const forcedSkillName = skillSaveMatch?.[1]?.trim() ?? null;
  const useSkillMatch = question.match(
    /(?:use|run)\s+(?:the\s+)?(?:['"]?([\w\-]+)['"]?\s+)?skill|skill\s+['"]?([\w\-]+)['"]?\s+to\s+(?:summarize|list)/i
  );
  const forcedRunSkillId = (useSkillMatch?.[1] ?? useSkillMatch?.[2])?.trim() ?? null;
  const isUsageRequest = !!forcedRunSkillId || /summarize\s+(?:all\s+)?(?:routes|interfaces|modules)|list\s+(?:all\s+)?(?:routes|interfaces)/i.test(question);
  let codeContext = "";
  if (route.filesToRead.length > 0) {
    const retrieved = retrieveFileSnippets(
      basePath,
      route.filesToRead,
      graph,
      route.keywords
    );
    codeContext = retrieved.formatted;
  }
  const availablePaths = /* @__PURE__ */ new Set();
  for (const n of graph.nodes) {
    for (const f of (n.files ?? []).filter(
      (f2) => /\.(ts|tsx|js|jsx|py|md|json)$/.test(f2) && !/\.test\.|\.spec\./.test(f2)
    )) {
      const norm = f.replace(/\\/g, "/").replace(/^\.\//, "");
      availablePaths.add(norm);
    }
  }
  let contextText = buildGraphContext(
    graph,
    route.relevantNodeIds,
    route.intent,
    route.relevantFindings,
    codeContext,
    nodeId,
    history,
    question,
    availablePaths
  );
  if (basePath) {
    const skillsText = formatSkillSummary(basePath, 20);
    if (skillsText) {
      contextText += `

## Skill Library (from .agent/skill_index.json)
${skillsText}
`;
    }
  }
  if (forcedSkillName) {
    contextText = `INSTRUCTION: The user explicitly asked you to save your solution as a reusable skill named "${forcedSkillName}". You MUST implement the script or helper and then call the save_skill tool with name="${forcedSkillName}". Do not only reply with code in text; persist it via save_skill so it is available in future sessions.

` + contextText;
  }
  if (isUsageRequest && !forcedSkillName) {
    const skillHint = forcedRunSkillId ? `Call run_skill with id="${forcedRunSkillId}" first, then answer with a summary of the output.` : "Call run_skill with the appropriate skill id from the Skill Library (e.g. map-routes, list-interfaces), then answer with a summary of the output.";
    contextText = `INSTRUCTION: The user asked to use a skill to summarize or list. ${skillHint} Do NOT call save_skill for this request.

` + contextText;
  }
  if (matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
    contextText += "\n\n" + formatMatchedNodesForPrompt(matchResult.matchedNodeIds, graph) + `

MATCH REASON: ${matchResult.reason}
Use these exact ids in any graphCommand you emit.`;
  } else if (matchResult.isNavigation) {
    contextText += `

[Navigation intent detected but no nodes matched "${question}". If you cannot confidently identify modules, use graphCommand.action="reset".]`;
  }
  const railSystemContent = railContext.filter((h) => h.role === "system").map((h) => h.content).join("\n\n");
  const systemFromHistory = (history ?? []).filter((h) => h.role === "system").map((h) => h.content).join("\n\n");
  const systemParts = [railSystemContent, systemFromHistory].filter(Boolean).join("\n\n");
  let systemPrompt = systemParts.length > 0 ? systemParts + "\n\n" + buildSystemPrompt(graph) : buildSystemPrompt(graph);
  if (feedbackContext && feedbackContext.trim()) {
    systemPrompt = feedbackContext.trim() + "\n\n" + systemPrompt;
  }
  const railPriorTurns = railContext.filter(
    (h) => h.role === "user" || h.role === "assistant"
  );
  let systemEst = estimateTokens(systemPrompt);
  let contextEst = estimateTokens(contextText);
  const railEst = railPriorTurns.reduce((s, m) => s + estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)), 0);
  const reserveForOutput = 4e3;
  const totalEst = systemEst + contextEst + railEst;
  if (totalEst > CONTEXT_WINDOW_SAFE - reserveForOutput) {
    const toTrim = totalEst - (CONTEXT_WINDOW_SAFE - reserveForOutput);
    contextText = trimTextToBudget(contextText, Math.max(0, contextEst - toTrim));
  }
  const userContent = pdfBase64 && pdfBase64.length > 0 ? [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBase64
      }
    },
    { type: "text", text: contextText }
  ] : contextText;
  const messages = [
    ...railPriorTurns,
    { role: "user", content: userContent }
  ];
  const MAX_STEPS = 6;
  let finalAnswer = "";
  let finalGraphCommand;
  let proposal;
  let usedSaveSkill = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const reasoningSteps = [];
  const citationSet = /* @__PURE__ */ new Map();
  const jiraContext = jiraConfig || jiraProjectKey ? { config: jiraConfig, projectKey: jiraProjectKey ?? void 0 } : void 0;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        temperature: 0.2,
        system: systemPrompt,
        tools: TOOLS,
        // When we know a skill save is required, force save_skill on first step.
        // When the user asked to use a skill (not save), force run_skill on first step.
        ...forcedSkillName && step === 0 ? { tool_choice: { type: "tool", name: "save_skill" } } : isUsageRequest && step === 0 ? { tool_choice: { type: "tool", name: "run_skill" } } : {},
        messages
      });
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      const totalTokens = inputTokens + outputTokens;
      if (basePath) bumpSessionUsage(basePath, { tokenUsage: totalTokens, llmCallCount: 1 });
      if (process.env.METRICS_LOG === "1") {
        console.warn(
          `[metrics] Claude architect step=${step + 1} input=${inputTokens} output=${outputTokens} total=${totalInputTokens + totalOutputTokens}`
        );
      }
      emitTrace(
        "llm_call",
        { role: "architect", step: step + 1, nodeId, question },
        {
          stopReason: response.stop_reason,
          usage: response.usage,
          contentTypes: response.content.map((b) => b.type)
        },
        "Claude architect response"
      );
      const textBlocks = response.content.filter(
        (b) => b.type === "text"
      );
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      );
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "end_turn") {
        const text = textBlocks.map((b) => b.text).join("\n").trim();
        if (text) finalAnswer = text;
        if (!finalGraphCommand && matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
          if (matchResult.matchedNodeIds.length === 1) {
            finalGraphCommand = {
              action: "focus_node",
              nodeId: matchResult.matchedNodeIds[0]
            };
          } else {
            finalGraphCommand = {
              action: "highlight_nodes",
              nodeIds: matchResult.matchedNodeIds
            };
          }
        }
        break;
      }
      if (toolUseBlocks.length === 0) {
        const text = textBlocks.map((b) => b.text).join("\n").trim();
        if (text) finalAnswer = text;
        break;
      }
      const toolResults = [];
      const actionTools = toolUseBlocks.filter((t) => t.name !== "answer");
      const answerTool = toolUseBlocks.find((t) => t.name === "answer");
      for (const toolUse of actionTools) {
        emitTrace(
          "llm_reasoning",
          { tool: toolUse.name, input: toolUse.input, step: step + 1 },
          {},
          "Claude requested tool"
        );
        if (toolUse.name === "save_skill") {
          usedSaveSkill = true;
        }
        const input = toolUse.input;
        const { result, proposal: prop } = await executeTool(
          toolUse.name,
          input,
          basePath,
          graph,
          availablePaths,
          route.keywords,
          jiraContext
        );
        if (prop) proposal = prop;
        const stepLabel = formatReasoningStep(toolUse.name, input, result);
        if (stepLabel) reasoningSteps.push(stepLabel);
        collectCitations(toolUse.name, input, result, citationSet, route.relevantNodeIds ?? [], graph);
        emitTrace(
          "llm_call",
          { tool: toolUse.name, step: step + 1 },
          { result: result.slice(0, 800), proposal: prop ? true : false },
          "Tool executed for Claude"
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.slice(0, 8e3)
        });
      }
      if (answerTool) {
        emitTrace(
          "llm_reasoning",
          { tool: answerTool.name, input: answerTool.input, step: step + 1 },
          {},
          "Claude requested tool"
        );
        const input = answerTool.input;
        finalAnswer = input.content;
        if (input.graphCommand) {
          finalGraphCommand = parseGraphCommand(input.graphCommand);
          reasoningSteps.push(
            `Emitted graph command: ${input.graphCommand?.action ?? "unknown"}`
          );
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: answerTool.id,
          content: "Answer recorded."
        });
      }
      if (finalAnswer) break;
      messages.push({ role: "user", content: toolResults });
    }
    if (!finalAnswer) {
      const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
      if (lastAssistant && Array.isArray(lastAssistant.content)) {
        const texts = lastAssistant.content.filter((b) => b.type === "text").map((b) => b.text);
        finalAnswer = texts.join("\n").trim() || "I was unable to formulate a complete answer. Try asking more specifically.";
      }
    }
    if (!finalGraphCommand && matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
      if (matchResult.matchedNodeIds.length === 1) {
        finalGraphCommand = {
          action: "focus_node",
          nodeId: matchResult.matchedNodeIds[0]
        };
      } else {
        finalGraphCommand = {
          action: "highlight_nodes",
          nodeIds: matchResult.matchedNodeIds
        };
      }
    }
    const citations = Array.from(citationSet.values());
    return {
      answer: finalAnswer,
      ...finalGraphCommand ? { graphCommand: finalGraphCommand } : {},
      ...proposal ? { proposal } : {},
      ...usedSaveSkill ? { usedSaveSkill: true } : {},
      ...totalInputTokens > 0 || totalOutputTokens > 0 ? { tokenUsage: { input: totalInputTokens, output: totalOutputTokens } } : {},
      ...reasoningSteps.length > 0 ? { reasoningTrace: reasoningSteps } : {},
      ...citations.length > 0 ? { citations } : {}
    };
  } catch (err) {
    return {
      answer: `Error: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// ../../src/ai/greenfieldEnricher.ts
import Anthropic3 from "@anthropic-ai/sdk";

// ../../src/ai/validateGraphCommand.ts
var VALID_LAYERS2 = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized"
];
function isValidLayer2(v) {
  return VALID_LAYERS2.includes(v);
}
var ID_PATTERN = /^[a-zA-Z0-9_\-\/\.]+$/;
var PATH_TRAVERSAL = /\.\.|\\\\|\/\//;
function validateNodeId(id) {
  if (id.length > 200) return "Node ID too long";
  if (PATH_TRAVERSAL.test(id)) return "Node ID must not contain path traversal (.. or //)";
  if (!ID_PATTERN.test(id))
    return "Node ID must use only alphanumeric, underscore, hyphen, slash, or dot";
  return null;
}
function validateGraphCommand(raw) {
  if (!raw || typeof raw !== "object") return { valid: false, error: "graphCommand must be an object" };
  const o = raw;
  if (o.action === "create_node") {
    if (typeof o.id !== "string") return { valid: false, error: "create_node requires string id" };
    if (typeof o.label !== "string") return { valid: false, error: "create_node requires string label" };
    if (typeof o.layer !== "string") return { valid: false, error: "create_node requires string layer" };
    if (!isValidLayer2(o.layer))
      return { valid: false, error: `create_node requires valid layer: ${VALID_LAYERS2.join(", ")}` };
    const idErr = validateNodeId(o.id);
    if (idErr) return { valid: false, error: `create_node id: ${idErr}` };
    return {
      valid: true,
      command: {
        action: "create_node",
        id: o.id,
        label: o.label,
        layer: o.layer,
        description: typeof o.description === "string" ? o.description : void 0,
        archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : void 0,
        skeletonCode: typeof o.skeletonCode === "string" ? o.skeletonCode : void 0,
        layoutHint: typeof o.layoutHint === "string" ? o.layoutHint : void 0,
        group: typeof o.group === "string" ? o.group : void 0
      }
    };
  }
  if (o.action === "connect") {
    if (typeof o.fromId !== "string") return { valid: false, error: "connect requires string fromId" };
    if (typeof o.toId !== "string") return { valid: false, error: "connect requires string toId" };
    const fromErr = validateNodeId(o.fromId);
    if (fromErr) return { valid: false, error: `connect fromId: ${fromErr}` };
    const toErr = validateNodeId(o.toId);
    if (toErr) return { valid: false, error: `connect toId: ${toErr}` };
    return {
      valid: true,
      command: {
        action: "connect",
        fromId: o.fromId,
        toId: o.toId,
        edgeType: typeof o.edgeType === "string" ? o.edgeType : void 0
      }
    };
  }
  if (o.action === "reset") return { valid: true, command: { action: "reset" } };
  return { valid: false, error: "graphCommand must have action: create_node, connect, or reset" };
}

// ../../src/ai/greenfieldEnricher.ts
function inferGreenfieldArchetype(question) {
  const q = question.toLowerCase();
  if (/saas|web app|full.?stack|frontend|react|vue|angular|spa/i.test(q)) return "saas-web-app";
  if (/api service|rest api|graphql|microservice|backend only/i.test(q)) return "api-service";
  if (/data pipeline|etl|ingestion|streaming|batch processing/i.test(q)) return "data-pipeline";
  if (/monolith|split|modularize|extract module/i.test(q)) return "monolith-split";
  return "greenfield-materialize";
}
var GREENFIELD_SYSTEM_PROMPT = `You are the Lead Software Architect.

There is no repository yet. Design the full architecture from scratch based on the user's request.

You must:
- Define layers (Presentation, Business Logic, Data Access, Infrastructure, External Services, Utilities, Configuration)
- Define modules (\u2264 20 nodes; keep modules focused)
- Use create_node and connect to draw the initial system on the canvas
- Provide folder structure recommendations in your answer
- Justify design decisions in your answer

ALWAYS use the answer tool with graphCommands: an array of create_node and connect actions for the full architecture.

Rules:
- Do NOT include secrets, shell commands, or executable code in your design.
- Only suggest file names and example skeletons \u2014 no actual file content with secrets.
- Keep node IDs simple (e.g. "src/api", "services/auth", "ui/dashboard").
- For connect, use fromId and toId that match node IDs you created.`;
var JIRA_TOOLS = [
  {
    name: "create_jira_issue",
    description: "Create a Jira issue/epic for a module or design task. Use when the user wants to track design work in Jira.",
    input_schema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Jira project key" },
        summary: { type: "string", description: "Short summary" },
        description: { type: "string", description: "Longer description" },
        archNodeId: { type: "string", description: "archNodeId for the module (used as label)" },
        labels: { type: "array", items: { type: "string" } }
      },
      required: ["projectKey", "summary"]
    }
  },
  {
    name: "jira_search_by_archNodeId",
    description: "Search Jira for issues tagged with archNodeId.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: { type: "string" },
        maxResults: { type: "integer" }
      },
      required: ["archNodeId"]
    }
  }
];
var GREENFIELD_TOOLS_BASE = [
  {
    name: "answer",
    description: "Your final response to the user. Always include a graphCommand with create_node and/or connect actions to draw the proposed architecture on the canvas.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Your architectural explanation, design rationale, folder structure recommendations, and justification."
        },
        graphCommands: {
          type: "array",
          description: "Array of create_node and connect actions. Include one create_node per module, then connect for dependencies.",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["create_node", "connect", "reset"] },
              id: { type: "string", description: "Node ID (e.g. src/api, services/auth)" },
              label: { type: "string", description: "Human-readable label" },
              layer: {
                type: "string",
                enum: VALID_LAYERS2,
                description: "Architectural layer"
              },
              description: { type: "string" },
              archNodeId: { type: "string" },
              fromId: { type: "string" },
              toId: { type: "string" },
              edgeType: { type: "string", enum: ["import", "reexport", "dynamic"] },
              skeletonCode: {
                type: "string",
                description: "Optional minimal skeleton or stub code for this module. Use sparingly; actual implementation comes from implement/materialize."
              },
              layoutHint: {
                type: "string",
                description: "Optional layout hint for canvas (e.g. left, center, right) to influence auto-arrangement."
              },
              group: {
                type: "string",
                description: "Optional group ID to cluster related nodes visually."
              }
            },
            required: ["action"]
          }
        }
      },
      required: ["content"]
    }
  }
];
function buildGreenfieldTools(jiraConfig, jiraProjectKey) {
  if (jiraConfig && (jiraConfig.baseUrl || jiraConfig.apiToken)) {
    return [...GREENFIELD_TOOLS_BASE, ...JIRA_TOOLS];
  }
  return GREENFIELD_TOOLS_BASE;
}
async function askGreenfield(params) {
  const { question, history = [], apiKeyClaude, pdfBase64, pdfFileName, contextBlock, jiraConfig, jiraProjectKey } = params;
  const client = apiKeyClaude ? new Anthropic3({ apiKey: apiKeyClaude }) : new Anthropic3();
  const historyMessages = (history ?? []).filter((h) => h.role === "user" || h.role === "assistant").map((h) => ({ role: h.role, content: h.content }));
  const questionWithContext = contextBlock ? `${contextBlock}

## Question
${question}` : question;
  const lastUserContent = pdfBase64 && pdfBase64.length > 0 ? [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBase64
      }
    },
    { type: "text", text: questionWithContext }
  ] : questionWithContext;
  const messages = historyMessages.length > 0 ? [...historyMessages, { role: "user", content: lastUserContent }] : [{ role: "user", content: lastUserContent }];
  const tools = buildGreenfieldTools(jiraConfig, jiraProjectKey);
  const hasJira = tools.length > GREENFIELD_TOOLS_BASE.length;
  const jiraContext = hasJira && jiraConfig ? { config: jiraConfig, projectKey: jiraProjectKey ?? void 0 } : void 0;
  const basePath = process.cwd();
  const MAX_STEPS = hasJira ? 3 : 1;
  let currentMessages = messages;
  let answer = "";
  let graphCommands = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: GREENFIELD_SYSTEM_PROMPT + (hasJira ? "\n\nWhen Jira is available, you may create issues or epics for modules before providing your final answer." : ""),
      messages: currentMessages,
      tools,
      tool_choice: step === 0 && hasJira ? "auto" : { type: "tool", name: "answer" }
    });
    let toolUseBlocks = [];
    for (const block of response.content) {
      if (block.type === "text") {
        answer = block.text;
      }
      if (block.type === "tool_use") {
        if (block.name === "answer") {
          const input = block.input;
          const content = typeof input.content === "string" ? input.content : "";
          if (content) answer = content;
          const raw = input.graphCommands ?? input.graphCommand;
          if (Array.isArray(raw)) {
            for (const item of raw) {
              const result = validateGraphCommand(item);
              if (result.valid && result.command.action !== "reset") {
                graphCommands.push(result.command);
              } else if (result.valid === false && item) {
                answer = `${answer}

**Validation note:** One command could not be applied: ${result.error}.`;
              }
            }
          } else if (raw && typeof raw === "object") {
            const result = validateGraphCommand(raw);
            if (result.valid && result.command.action !== "reset") {
              graphCommands.push(result.command);
            } else if (result.valid === false) {
              answer = `${answer}

**Validation note:** The proposed graph command could not be applied: ${result.error}. Please try rephrasing your design.`;
            }
          }
        } else {
          toolUseBlocks.push({ id: block.id, name: block.name, input: block.input });
        }
      }
    }
    if (toolUseBlocks.length === 0) break;
    const assistantContent = response.content;
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      let result = "";
      if (tu.name === "create_jira_issue") {
        const r = await executeJiraCreateTicket(basePath, {
          projectKey: String(tu.input.projectKey ?? jiraProjectKey ?? ""),
          summary: String(tu.input.summary ?? ""),
          description: typeof tu.input.description === "string" ? tu.input.description : void 0,
          archNodeId: typeof tu.input.archNodeId === "string" ? tu.input.archNodeId : void 0,
          labels: Array.isArray(tu.input.labels) ? tu.input.labels : void 0
        }, jiraContext);
        result = r.result ?? r.error ?? "Jira create failed.";
      } else if (tu.name === "jira_search_by_archNodeId") {
        const r = await executeJiraSearchByArchNodeId(
          basePath,
          String(tu.input.archNodeId ?? ""),
          typeof tu.input.maxResults === "number" ? tu.input.maxResults : 10,
          jiraContext
        );
        result = r.result ?? r.error ?? "Jira search failed.";
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: toolResults }
    ];
  }
  return {
    answer: answer || "I've designed the architecture. Check the canvas for the proposed modules and connections.",
    graphCommands: graphCommands.length > 0 ? graphCommands : void 0
  };
}
async function askGreenfieldStream(params) {
  const { onTextChunk, jiraConfig, ...rest } = params;
  if (!onTextChunk || jiraConfig && jiraConfig.apiToken) {
    return askGreenfield({ ...rest, jiraConfig });
  }
  const client = rest.apiKeyClaude ? new Anthropic3({ apiKey: rest.apiKeyClaude }) : new Anthropic3();
  const historyMessages = (rest.history ?? []).filter((h) => h.role === "user" || h.role === "assistant").map((h) => ({ role: h.role, content: h.content }));
  const questionWithContext = rest.contextBlock ? `${rest.contextBlock}

## Question
${rest.question}` : rest.question;
  const lastUserContent = rest.pdfBase64 && rest.pdfBase64.length > 0 ? [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: rest.pdfBase64 } },
    { type: "text", text: questionWithContext }
  ] : questionWithContext;
  const messages = historyMessages.length > 0 ? [...historyMessages, { role: "user", content: lastUserContent }] : [{ role: "user", content: lastUserContent }];
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: GREENFIELD_SYSTEM_PROMPT,
    messages,
    tools: GREENFIELD_TOOLS_BASE,
    tool_choice: { type: "tool", name: "answer" }
  });
  stream.on("text", (delta) => onTextChunk(delta));
  const message = await stream.finalMessage();
  let answer = "";
  const graphCommands = [];
  for (const block of message.content) {
    if (block.type === "text") answer = block.text;
    if (block.type === "tool_use" && block.name === "answer") {
      const input = block.input;
      const content = typeof input.content === "string" ? input.content : "";
      if (content) answer = content;
      const raw = input.graphCommands ?? input.graphCommand;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const result = validateGraphCommand(item);
          if (result.valid && result.command.action !== "reset") graphCommands.push(result.command);
        }
      } else if (raw && typeof raw === "object") {
        const result = validateGraphCommand(raw);
        if (result.valid && result.command.action !== "reset") graphCommands.push(result.command);
      }
    }
  }
  return {
    answer: answer || "I've designed the architecture. Check the canvas for the proposed modules and connections.",
    graphCommands: graphCommands.length > 0 ? graphCommands : void 0
  };
}

// ../../src/ai/mockGreenfieldEnricher.ts
var DEFAULT_GRAPH_COMMANDS = [
  { action: "create_node", id: "src/api", label: "API Layer", layer: "Presentation", archNodeId: "api" },
  { action: "create_node", id: "src/services/auth", label: "Auth Service", layer: "Business Logic" },
  { action: "create_node", id: "src/repositories/user", label: "User Repo", layer: "Data Access" },
  { action: "connect", fromId: "src/api", toId: "src/services/auth" },
  { action: "connect", fromId: "src/services/auth", toId: "src/repositories/user" }
];
var DEFAULT_FIXTURE = {
  answer: "Mock design: Here's a typical layered architecture.\n\n- **Presentation:** API layer\n- **Business Logic:** Services\n- **Data Access:** Repositories",
  graphCommands: DEFAULT_GRAPH_COMMANDS
};
var FRONTEND_GRAPH_COMMANDS = [
  { action: "create_node", id: "src/ui/pages", label: "Pages", layer: "Presentation", description: "Route-level pages" },
  { action: "create_node", id: "src/ui/components", label: "Components", layer: "Presentation", description: "Reusable UI components" },
  { action: "create_node", id: "src/store/app", label: "App Store", layer: "Business Logic", description: "Global state" },
  { action: "connect", fromId: "src/ui/pages", toId: "src/ui/components" },
  { action: "connect", fromId: "src/ui/pages", toId: "src/store/app" }
];
function matchDesign(question) {
  const q = question.toLowerCase();
  if (/frontend|react|ui\b|website|web app|webapp/.test(q)) {
    return {
      answer: "I've designed a frontend architecture:\n\n**Layers:** Pages & Components (Presentation), Store (Business Logic).\n**Modules:** Route pages, shared components, app store.",
      graphCommands: FRONTEND_GRAPH_COMMANDS
    };
  }
  if (/backend|api gateway|saas backend/.test(q)) {
    return {
      answer: "I've designed a modular backend architecture:\n\n**Layers:** API (Presentation), Services (Business Logic), Repo (Data Access).\n**Modules:** API gateway, Auth service, User service.",
      graphCommands: [
        { action: "create_node", id: "src/api", label: "API Gateway", layer: "Presentation", description: "REST/GraphQL entry point" },
        { action: "create_node", id: "src/services/auth", label: "Auth Service", layer: "Business Logic" },
        { action: "create_node", id: "src/repositories/user", label: "User Repo", layer: "Data Access" },
        { action: "connect", fromId: "src/api", toId: "src/services/auth" },
        { action: "connect", fromId: "src/services/auth", toId: "src/repositories/user" }
      ]
    };
  }
  return DEFAULT_FIXTURE;
}
async function askGreenfieldMock(params) {
  await new Promise((resolve22) => setTimeout(resolve22, 800));
  const { question } = params;
  const { answer, graphCommands } = matchDesign(question);
  return { answer, graphCommands };
}

// ../../src/agent/templateLibrary.ts
import * as fs14 from "fs";
import * as path15 from "path";
function getTemplatePath(rootPath) {
  return path15.join(rootPath, ".agent", "templates.json");
}
function ensureDir2(rootPath) {
  const dir = path15.join(rootPath, ".agent");
  if (!fs14.existsSync(dir)) {
    fs14.mkdirSync(dir, { recursive: true });
  }
}
function loadTemplates(rootPath) {
  ensureDir2(rootPath);
  const p = getTemplatePath(rootPath);
  if (!fs14.existsSync(p)) {
    const empty = { templates: [] };
    fs14.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs14.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.templates) ? parsed : { templates: [] };
  } catch {
    const empty = { templates: [] };
    fs14.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}
function recordSuccessfulRun(params) {
  const store = loadTemplates(params.rootPath);
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rec = {
    id,
    intent: params.intent,
    model: params.model,
    usedCritic: params.usedCritic,
    score: params.score,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    questionSample: params.question.slice(0, 200)
  };
  store.templates.push(rec);
  const p = getTemplatePath(params.rootPath);
  fs14.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}

// ../../src/ai/metrics.ts
var taskMetrics = [];
var materializeMetrics = [];
var MAX_ENTRIES = 500;
function trim(arr) {
  if (arr.length > MAX_ENTRIES) {
    arr.splice(0, arr.length - MAX_ENTRIES);
  }
}
function recordTaskMetrics(m) {
  taskMetrics.push(m);
  trim(taskMetrics);
  if (process.env.METRICS_LOG === "1") {
    console.log(
      `[metrics] task traceId=${m.traceId} mode=${m.mode} latencyMs=${m.latencyMs ?? "-"} criticScore=${m.criticScore ?? "-"} error=${m.error ?? "-"}`
    );
  }
}
function recordMaterializeMetrics(m) {
  materializeMetrics.push(m);
  trim(materializeMetrics);
  if (process.env.METRICS_LOG === "1") {
    console.log(
      `[metrics] materialize nodeCount=${m.nodeCount} created=${m.createdCount} success=${m.success}`
    );
  }
}
function getTaskMetricsSummary() {
  const greenfield = taskMetrics.filter((m) => m.mode === "greenfield");
  const analysis = taskMetrics.filter((m) => m.mode === "analysis");
  const withLatency = taskMetrics.filter((m) => m.latencyMs != null);
  const withScore = taskMetrics.filter((m) => m.criticScore != null);
  const errors = taskMetrics.filter((m) => m.error);
  return {
    totalTasks: taskMetrics.length,
    greenfieldCount: greenfield.length,
    analysisCount: analysis.length,
    avgLatencyMs: withLatency.length > 0 ? withLatency.reduce((s, m) => s + (m.latencyMs ?? 0), 0) / withLatency.length : null,
    avgCriticScore: withScore.length > 0 ? withScore.reduce((s, m) => s + (m.criticScore ?? 0), 0) / withScore.length : null,
    errorCount: errors.length
  };
}
function getMaterializeMetricsSummary() {
  const success = materializeMetrics.filter((m) => m.success);
  const createdSum = materializeMetrics.reduce((s, m) => s + m.createdCount, 0);
  return {
    totalMaterializes: materializeMetrics.length,
    successCount: success.length,
    avgNodesCreated: materializeMetrics.length > 0 ? createdSum / materializeMetrics.length : 0
  };
}

// ../../src/ai/manager.ts
async function runArchitectureTask(params) {
  const { mode, rootPath, ...rest } = params;
  const traceId = crypto.randomUUID();
  const startMs = Date.now();
  logArchEvent("info", "runArchitectureTask start", {
    traceId,
    mode
  });
  const modeRegistry = {
    analysis: {
      mode: "analysis",
      execute: (p) => !rootPath ? Promise.resolve({
        answer: "ERROR: Analysis mode requires a project root. Please scan a repository first.",
        criticReport: "Mode mismatch: analysis requires rootPath.",
        criticScore: 0,
        traceId
      }) : runAnalysisTask({ ...rest, rootPath, traceId })
    },
    greenfield: {
      mode: "greenfield",
      execute: () => runGreenfieldTask({ ...rest, traceId })
    }
  };
  try {
    const modeImpl = modeRegistry[mode];
    if (!modeImpl) throw new Error(`Unknown mode: ${mode}`);
    const result = await modeImpl.execute({ ...rest, rootPath, traceId });
    recordTaskMetrics({
      traceId,
      mode,
      timestamp: startMs,
      latencyMs: Date.now() - startMs,
      criticScore: result.criticScore
    });
    return result;
  } catch (err) {
    recordTaskMetrics({
      traceId,
      mode,
      timestamp: startMs,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}
async function runAnalysisTask(params) {
  const {
    question,
    graph,
    nodeId,
    history,
    apiKeyOpenAI,
    apiKeyClaude,
    findings,
    rootPath,
    traceId,
    jiraConfig,
    jiraProjectKey,
    rail,
    pdfBase64,
    pdfFileName,
    feedbackContext
  } = params;
  const resolvedRoot = path16.resolve(rootPath);
  const rootExists = fs15.existsSync(resolvedRoot);
  const hasFiles = rootExists && fs15.readdirSync(resolvedRoot, { withFileTypes: true }).some((e) => !e.name.startsWith("."));
  if (!rootExists || !hasFiles) {
    logArchEvent("warn", "manager preflight failed", {
      traceId,
      rootPath: resolvedRoot,
      rootExists,
      hasFiles
    });
    return {
      answer: "ERROR: The source code for this project is missing or has been cleaned up. Please re-scan the repository to regenerate the architecture graph, then try your question again.",
      graphCommand: void 0,
      criticReport: "Preflight check failed: projectRoot directory missing or empty. Manager aborted to avoid hallucinations.",
      criticScore: 0,
      traceId
    };
  }
  logArchEvent("info", "runAnalysisTask", {
    traceId,
    rootPath: resolvedRoot,
    question: question.slice(0, 200)
  });
  let localHistory = history ?? [];
  try {
    const skillMatches = [...question.matchAll(/skill\s+['"]?([\w-]+)['"]?/gi)];
    for (const m of skillMatches) {
      const skillId = m[1];
      const indexPath = path16.join(resolvedRoot, ".agent", "skill_index.json");
      if (fs15.existsSync(indexPath)) {
        const raw = fs15.readFileSync(indexPath, "utf8");
        const parsed = JSON.parse(raw);
        const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
        const skillMeta = skills.find(
          (s) => s.id === skillId && typeof s.path === "string"
        );
        if (skillMeta?.path) {
          const skillPath = skillMeta.path;
          const absSkillPath = path16.isAbsolute(skillPath) ? skillPath : path16.join(resolvedRoot, skillPath);
          if (fs15.existsSync(absSkillPath)) {
            const skillCode = fs15.readFileSync(absSkillPath, "utf8");
            localHistory = [
              ...localHistory,
              {
                role: "system",
                content: `CRITICAL CONTEXT: You are refactoring or using the existing skill '${skillId}'. Here is its current implementation:

\`\`\`
${skillCode}
\`\`\``
              }
            ];
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      `[manager] Librarian pre-hook failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const route = routeQuestion(
    question,
    graph,
    findings ?? [],
    nodeId,
    history
  );
  const HISTORY_BUDGET = 6e4;
  localHistory = trimHistoryToBudget(
    localHistory,
    HISTORY_BUDGET
  );
  let attempts = 0;
  const maxAttempts = 2;
  let lastAnswer = "";
  let lastGraphCommand;
  let lastCriticReport = "";
  let lastCriticScore = 0;
  let lastProposal;
  let lastViolations = [];
  let lastTokenUsage;
  let lastReasoningTrace;
  let lastCitations;
  while (attempts < maxAttempts) {
    const claudeResult = await askAboutArchitecture(
      question,
      graph,
      nodeId,
      localHistory,
      apiKeyClaude,
      findings,
      rootPath,
      jiraConfig,
      jiraProjectKey,
      rail ?? void 0,
      pdfBase64,
      pdfFileName,
      feedbackContext
    );
    lastAnswer = claudeResult.answer;
    lastGraphCommand = claudeResult.graphCommand;
    lastProposal = claudeResult.proposal;
    lastReasoningTrace = claudeResult.reasoningTrace;
    lastCitations = claudeResult.citations;
    const usedSaveSkill = claudeResult.usedSaveSkill === true;
    if (claudeResult.tokenUsage) {
      lastTokenUsage = {
        agentInput: claudeResult.tokenUsage.input,
        agentOutput: claudeResult.tokenUsage.output
      };
    }
    const isNavigationOnly = route.intent === "show_layer" && !!lastGraphCommand && lastAnswer.trim().length < 120;
    const review = isNavigationOnly ? {
      approved: true,
      score: 10,
      report: "Navigation-only query; critic skipped.",
      violations: []
    } : await reviewArchitectureAnswer({
      question,
      answer: claudeResult.answer,
      graph,
      findings,
      apiKey: apiKeyOpenAI,
      apiKeyClaude
    });
    lastCriticReport = review.report;
    lastCriticScore = review.score;
    lastViolations = Array.isArray(review.violations) ? review.violations : [];
    if (lastGraphCommand && lastGraphCommand.action === "filter_layer" && /src\/agent/i.test(question)) {
      const agentNodeIds = graph.nodes.map((n) => n.id).filter(
        (id) => id.replace(/\\/g, "/").replace(/^\.\//, "").startsWith("src/agent")
      );
      if (agentNodeIds.length > 0) {
        lastGraphCommand = {
          action: "highlight_nodes",
          nodeIds: agentNodeIds.slice(0, 12)
        };
      }
    }
    const FALLBACK_MSG = "I was unable to formulate a complete answer.";
    const isUsageRequest = /use\s+(?:the\s+)?(?:['"]?\w+['"]?\s+)?skill|run\s+(?:the\s+)?\w+\s+skill|summarize\s+(?:all\s+)?(?:routes|interfaces|modules)|list\s+(?:all\s+)?(?:routes|interfaces)/i.test(
      question
    );
    if (lastAnswer.includes(FALLBACK_MSG) && attempts < maxAttempts - 1) {
      const chunkingHint = lastAnswer.length > 12e3 ? " Keep your answer concise or summarize by section to avoid truncation." : "";
      const directiveContent = isUsageRequest ? `DIRECTIVE: Your last attempt did not run the requested skill. You have the relevant skill in context (see Skill Library above). IMMEDIATELY call the run_skill tool with the appropriate skill id (e.g. map-routes, list-interfaces), then call the answer tool to summarize the tool output for the user. Do NOT respond with an inability message.${chunkingHint}` : `DIRECTIVE: Your last attempt failed. Critic says:
${review.report}

STOP searching files. IMMEDIATELY write the requested script or answer, use any required tools (such as "save_skill"), and then call the "answer" tool to finish. THIS IS YOUR LAST CHANCE.${chunkingHint}`;
      localHistory = [
        ...localHistory ?? [],
        { role: "assistant", content: lastAnswer },
        { role: "user", content: directiveContent }
      ];
      attempts += 1;
      continue;
    }
    const hasCodeBlock = /```[\s\S]*?```/.test(lastAnswer);
    const askedForCode = /refactor|code|script|implement|write|save.*skill|save as/i.test(question);
    if (askedForCode && !hasCodeBlock && !review.approved && attempts < maxAttempts - 1) {
      localHistory = [
        ...localHistory ?? [],
        { role: "assistant", content: lastAnswer },
        {
          role: "user",
          content: "DIRECTIVE: You provided analysis but no code block. The user explicitly asked for code/script output. Do NOT provide more high-level analysis or tables. IMMEDIATELY output the full implementation in a markdown code block and finish."
        }
      ];
      attempts += 1;
      continue;
    }
    if (askedForCode && usedSaveSkill && !hasCodeBlock && attempts < maxAttempts - 1) {
      localHistory = [
        ...localHistory ?? [],
        { role: "assistant", content: lastAnswer },
        {
          role: "user",
          content: "SYSTEM DIRECTIVE: You successfully saved the skill, but you did NOT show its code. IMMEDIATELY output the full saved implementation in a markdown code block and briefly summarize what it does. Do NOT provide additional analysis, tables, or commentary."
        }
      ];
      attempts += 1;
      continue;
    }
    if (review.approved) {
      recordSuccessfulRun({
        rootPath,
        intent: route.intent,
        model: "claude",
        usedCritic: true,
        score: review.score,
        question
      });
      break;
    }
    if (attempts === maxAttempts - 1) {
      break;
    }
    const chunkingNote = lastAnswer.length > 12e3 ? '\n\nCHUNKING DIRECTIVE: Your previous response was very long and may have been truncated. For this retry, summarize by section, list the most important items first, or add "... (N more)" to avoid truncation.' : "";
    localHistory = [
      ...localHistory ?? [],
      {
        role: "assistant",
        content: `Critic feedback on your previous answer:
${review.report}${chunkingNote}`
      }
    ];
    attempts += 1;
  }
  if (route.intent === "trace_flow" && !lastGraphCommand && lastAnswer && Array.isArray(route.relevantNodeIds) && route.relevantNodeIds.length >= 2) {
    const ids = route.relevantNodeIds.slice(0, 8);
    lastGraphCommand = {
      action: "trace_path",
      nodeIds: ids
    };
    lastAnswer = lastAnswer + "\n\n---\nI have highlighted a `trace_path` across the most relevant nodes so you can inspect the runtime flow on the canvas.";
  }
  if (lastViolations.length > 0) {
    const alreadyAsked = /fix\s+now|track\s+\(create\s+jira\)|track\s+in\s+jira/i.test(lastAnswer);
    if (!alreadyAsked) {
      const top = lastViolations.slice(0, 3);
      const bullets = top.map((v) => {
        const pair = v.targetNodeId ? `${v.sourceNodeId} \u2192 ${v.targetNodeId}` : v.sourceNodeId;
        return `- ${v.severity.toUpperCase()}: ${v.type} (${pair}) \u2014 ${v.description}`;
      }).join("\n");
      lastAnswer = lastAnswer + `

---
**Architectural violations detected. Fix now or track (create Jira)?**

${bullets}

Reply with **Fix** to open a rail/refactor flow, or **Track** to create Jira tickets tagged with \`archNodeId:<id>\`.`;
    }
  }
  const confidenceScore = lastCriticScore != null && lastCriticScore >= 0 ? Math.max(0, Math.min(1, lastCriticScore / 10)) : void 0;
  const suggestedActions = deriveSuggestedActions(lastGraphCommand, route.relevantNodeIds);
  return {
    answer: lastAnswer,
    graphCommand: lastGraphCommand,
    criticReport: lastCriticReport,
    criticScore: lastCriticScore,
    proposal: lastProposal,
    violations: lastViolations,
    traceId,
    relevantNodeIds: route.relevantNodeIds,
    ...lastTokenUsage ? { tokenUsage: lastTokenUsage } : {},
    ...confidenceScore != null ? { confidenceScore } : {},
    ...suggestedActions.length > 0 ? { suggestedActions } : {},
    ...lastReasoningTrace?.length ? { reasoningTrace: lastReasoningTrace } : {},
    ...lastCitations?.length ? { citations: lastCitations } : {}
  };
}
function deriveSuggestedActions(cmd, relevantNodeIds) {
  if (!cmd && (!relevantNodeIds || relevantNodeIds.length === 0)) return [];
  const actions = [];
  if (cmd) {
    switch (cmd.action) {
      case "highlight_nodes":
        actions.push("Highlight these nodes");
        break;
      case "focus_node":
        actions.push("Focus on this node");
        break;
      case "filter_layer":
        actions.push(`Show ${cmd.layer} layer`);
        break;
      case "trace_path":
        actions.push("Show request flow");
        break;
      case "reset":
        actions.push("Reset view");
        break;
      default:
        break;
    }
  }
  if (actions.length === 0 && relevantNodeIds && relevantNodeIds.length > 0) {
    actions.push("Highlight these nodes");
  }
  return actions;
}
async function runGreenfieldTask(params) {
  const {
    question,
    history,
    apiKeyOpenAI,
    apiKeyClaude,
    traceId,
    pdfBase64,
    pdfFileName
  } = params;
  console.log(
    `[manager] runGreenfieldTask | traceId=${traceId} | question="${question.slice(0, 80)}${question.length > 80 ? "\u2026" : ""}"`
  );
  const HISTORY_BUDGET = 6e4;
  let trimmedHistory = trimHistoryToBudget(
    history ?? [],
    HISTORY_BUDGET
  );
  const useMock = process.env.USE_MOCK_GREENFIELD === "1" || process.env.USE_MOCK_GREENFIELD === "true";
  const archetype = inferGreenfieldArchetype(params.question);
  const rootPath = params.graph?.projectRoot && typeof params.graph.projectRoot === "string" && params.graph.projectRoot.trim() ? params.graph.projectRoot.trim() : null;
  let contextBlock;
  if (rootPath && params.graph?.nodes?.length) {
    try {
      const route = routeQuestion(
        question,
        params.graph,
        params.findings ?? [],
        params.nodeId,
        history
      );
      if (route.filesToRead.length > 0) {
        const retrieved = retrieveFileSnippets(
          rootPath,
          route.filesToRead,
          params.graph,
          route.keywords
        );
        if (retrieved.formatted) {
          contextBlock = `## Code context from existing repo
${retrieved.formatted}`;
        }
      }
      try {
        const skillsText = formatSkillSummary(rootPath, 12);
        if (skillsText) {
          contextBlock = (contextBlock ?? "") + `

## Skill Library (from .agent/skill_index.json)
${skillsText}
`;
        }
      } catch {
      }
    } catch {
    }
  }
  const maxAttempts = 2;
  let attempts = 0;
  let lastResult = null;
  let lastReview = null;
  const useStream = !!params.onTextChunk && !params.jiraConfig && !params.jiraProjectKey;
  const askParams = {
    question,
    history: trimmedHistory,
    apiKeyClaude,
    ...pdfBase64 ? { pdfBase64, pdfFileName: pdfFileName ?? "document.pdf" } : {},
    ...contextBlock ? { contextBlock } : {},
    ...params.jiraConfig ? { jiraConfig: params.jiraConfig } : {},
    ...params.jiraProjectKey ? { jiraProjectKey: params.jiraProjectKey } : {},
    ...useStream && params.onTextChunk ? { onTextChunk: params.onTextChunk } : {}
  };
  try {
    while (attempts < maxAttempts) {
      const greenfieldResult = useMock ? await askGreenfieldMock({ question, history: trimmedHistory }) : useStream ? await askGreenfieldStream(askParams) : await askGreenfield(askParams);
      lastResult = greenfieldResult;
      const review = await reviewGreenfieldAnswer({
        question,
        answer: greenfieldResult.answer,
        graphCommands: greenfieldResult.graphCommands,
        graphCommand: greenfieldResult.graphCommand,
        apiKey: apiKeyOpenAI,
        apiKeyClaude,
        existingGraph: params.graph?.nodes?.length ? params.graph : null,
        rootPath,
        archetype
      });
      lastReview = review;
      const approved = review.approved === true && (typeof review.score === "number" ? review.score >= 6 : true);
      if (approved || attempts === maxAttempts - 1) break;
      trimmedHistory = [
        ...trimmedHistory,
        { role: "assistant", content: greenfieldResult.answer },
        {
          role: "user",
          content: `Critic feedback on your previous design:
${review.report}

Please revise the design to address these issues.`
        }
      ];
      attempts += 1;
    }
    const graphCommands = lastResult ? lastResult.graphCommands ?? (lastResult.graphCommand ? [lastResult.graphCommand] : void 0) : void 0;
    const gfScore = lastReview?.score ?? 0;
    const confidenceScore = typeof gfScore === "number" ? Math.max(0, Math.min(1, gfScore / 10)) : void 0;
    const suggestedActions = deriveSuggestedActions(graphCommands?.[0], void 0);
    return {
      answer: lastResult?.answer ?? "Design generation failed.",
      graphCommands,
      graphCommand: graphCommands?.[0],
      criticReport: lastReview?.report ?? "No review.",
      criticScore: gfScore,
      violations: Array.isArray(lastReview?.violations) ? lastReview.violations : [],
      traceId,
      acceptanceCriteria: lastReview?.acceptanceCriteria,
      archetype,
      ...confidenceScore != null ? { confidenceScore } : {},
      ...suggestedActions.length > 0 ? { suggestedActions } : {}
    };
  } catch (err) {
    if (err instanceof ArchError) throw err;
    logArchError(err, traceId, "runGreenfieldTask");
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    let code = ErrorCode.UNKNOWN;
    if (lower.includes("rate") || lower.includes("429")) code = ErrorCode.RATE_LIMIT;
    else if (lower.includes("api key") || lower.includes("401")) code = ErrorCode.NO_API_KEY;
    else if (lower.includes("timeout") || lower.includes("econnreset")) code = ErrorCode.TRANSIENT;
    else if (lower.includes("invalid") || lower.includes("parse")) code = ErrorCode.LLM_PARSE_FAILURE;
    throw new ArchError({
      code,
      userMessage: toUserMessage(err, traceId),
      traceId,
      internal: raw
    });
  }
}

// src/middleware/validateGraphCommand.ts
var VALID_LAYERS3 = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized"
];
var ID_PATTERN2 = /^[a-zA-Z0-9_\-/.]+$/;
var PATH_TRAVERSAL2 = /\.\.|\\\\|\/\//;
function validateNodeId2(id) {
  if (id.length > 200) return "Node ID too long";
  if (PATH_TRAVERSAL2.test(id)) return "Node ID must not contain path traversal (.. or //)";
  if (!ID_PATTERN2.test(id))
    return "Node ID must use only alphanumeric, underscore, hyphen, slash, or dot";
  return null;
}
function validateGraphCommand2(raw) {
  if (!raw || typeof raw !== "object") return { valid: false, error: "graphCommand must be an object" };
  const o = raw;
  if (o.action === "create_node") {
    if (typeof o.id !== "string") return { valid: false, error: "create_node requires string id" };
    if (typeof o.label !== "string") return { valid: false, error: "create_node requires string label" };
    if (typeof o.layer !== "string") return { valid: false, error: "create_node requires string layer" };
    if (!VALID_LAYERS3.includes(o.layer))
      return { valid: false, error: `create_node requires valid layer: ${VALID_LAYERS3.join(", ")}` };
    const idErr = validateNodeId2(o.id);
    if (idErr) return { valid: false, error: `create_node id: ${idErr}` };
    return {
      valid: true,
      command: {
        action: "create_node",
        id: o.id,
        label: o.label,
        layer: o.layer,
        description: typeof o.description === "string" ? o.description : void 0,
        archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : void 0,
        skeletonCode: typeof o.skeletonCode === "string" ? o.skeletonCode : void 0,
        layoutHint: typeof o.layoutHint === "string" ? o.layoutHint : void 0,
        group: typeof o.group === "string" ? o.group : void 0
      }
    };
  }
  if (o.action === "connect") {
    if (typeof o.fromId !== "string") return { valid: false, error: "connect requires string fromId" };
    if (typeof o.toId !== "string") return { valid: false, error: "connect requires string toId" };
    const fromErr = validateNodeId2(o.fromId);
    if (fromErr) return { valid: false, error: `connect fromId: ${fromErr}` };
    const toErr = validateNodeId2(o.toId);
    if (toErr) return { valid: false, error: `connect toId: ${toErr}` };
    return {
      valid: true,
      command: {
        action: "connect",
        fromId: o.fromId,
        toId: o.toId,
        edgeType: typeof o.edgeType === "string" ? o.edgeType : void 0
      }
    };
  }
  if (o.action === "reset") return { valid: true, command: { action: "reset" } };
  return { valid: false, error: "graphCommand must have action: create_node, connect, or reset" };
}
var INVALID_GRAPH_COMMAND = "INVALID_GRAPH_COMMAND";
function validateGraphCommandMiddleware(req, res, next) {
  const raw = req.body?.graphCommand;
  if (raw === void 0 || raw === null) {
    next();
    return;
  }
  const result = validateGraphCommand2(raw);
  if (result.valid) {
    req.validatedGraphCommand = result.command;
    next();
    return;
  }
  res.status(400).json({
    error: result.error,
    code: INVALID_GRAPH_COMMAND
  });
}

// src/memoryHygiene.ts
var PRUNE_EVERY_N_INSERTS = 10;
var insertCountByWorkspace = /* @__PURE__ */ new Map();
var WORKSPACE_MEMORIES_MAX = 200;
var WORKSPACE_MEMORIES_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1e3;
async function pruneWorkspaceMemories(supabase, workspaceId, options = {}) {
  const maxCount = options.maxCount ?? WORKSPACE_MEMORIES_MAX;
  const maxAgeMs = options.maxAgeMs ?? WORKSPACE_MEMORIES_MAX_AGE_MS;
  const cutoff = maxAgeMs > 0 ? new Date(Date.now() - maxAgeMs).toISOString() : null;
  let ttlDeleted = 0;
  if (cutoff) {
    const { data: ttlRows, error: ttlErr } = await supabase.from("workspace_memories").delete().eq("workspace_id", workspaceId).lt("created_at", cutoff).select("id");
    if (!ttlErr && Array.isArray(ttlRows)) ttlDeleted = ttlRows.length;
  }
  const { count, error: countErr } = await supabase.from("workspace_memories").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (countErr) return { pruned: ttlDeleted, reason: ttlDeleted ? "ttl" : "none" };
  const currentCount = count ?? 0;
  let capDeleted = 0;
  if (currentCount > maxCount) {
    const toRemove = currentCount - maxCount;
    const { data: oldRows } = await supabase.from("workspace_memories").select("id").eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(toRemove);
    if (Array.isArray(oldRows) && oldRows.length > 0) {
      const ids = oldRows.map((r) => r.id).filter((id) => Boolean(id));
      if (ids.length > 0) {
        const { data: delRows } = await supabase.from("workspace_memories").delete().in("id", ids).select("id");
        capDeleted = Array.isArray(delRows) ? delRows.length : ids.length;
      }
    }
  }
  const total = ttlDeleted + capDeleted;
  let reason = "none";
  if (total > 0) {
    if (ttlDeleted > 0 && capDeleted > 0) reason = "both";
    else if (ttlDeleted > 0) reason = "ttl";
    else reason = "cap";
  }
  return { pruned: total, reason };
}
async function maybePruneWorkspaceMemories(supabase, workspaceId) {
  const count = (insertCountByWorkspace.get(workspaceId) ?? 0) + 1;
  insertCountByWorkspace.set(workspaceId, count);
  if (count % PRUNE_EVERY_N_INSERTS !== 0) {
    return null;
  }
  return pruneWorkspaceMemories(supabase, workspaceId);
}

// src/memoryRetrieval.ts
var MEMORIES_LIMIT = 20;
var MEMORIES_MAX_AGE_DAYS = 30;
var SNAPSHOTS_LIMIT = 10;
var SNAPSHOTS_MAX_AGE_DAYS = 14;
var USER_MEMORIES_LIMIT = 10;
var USER_MEMORIES_MAX_AGE_DAYS = 90;
async function getMemoriesForContext(db, workspaceId, options = {}) {
  const limit = options.limit ?? MEMORIES_LIMIT;
  const maxAgeDays = options.maxAgeDays ?? MEMORIES_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1e3).toISOString();
  let query = db.from("workspace_memories").select("content, memory_type, created_at").eq("workspace_id", workspaceId).gte("created_at", cutoff).is("superseded_at", null).order("created_at", { ascending: false }).limit(limit);
  if (options.nodeId) {
    query = query.or(`node_id.eq.${options.nodeId},node_id.is.null`);
  }
  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}
async function getSnapshotsForContext(db, workspaceId, options = {}) {
  const limit = options.limit ?? SNAPSHOTS_LIMIT;
  const maxAgeDays = options.maxAgeDays ?? SNAPSHOTS_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1e3).toISOString();
  let query = db.from("conversation_snapshots").select("intent_summary, outcome_summary, created_at").eq("workspace_id", workspaceId).gte("created_at", cutoff).order("created_at", { ascending: false }).limit(limit);
  if (options.nodeId) {
    query = query.or(`node_id.eq.${options.nodeId},node_id.is.null`);
  }
  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}
async function getGraphEvolutionForContext(db, workspaceId, options = {}) {
  const limit = options.limit ?? 10;
  const maxAgeDays = options.maxAgeDays ?? 30;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1e3).toISOString();
  const { data, error } = await db.from("scan_history").select("completed_at, node_count, edge_count").eq("workspace_id", workspaceId).eq("status", "completed").not("completed_at", "is", null).gte("completed_at", cutoff).order("completed_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data ?? [];
}
async function getSystemModelForContext(db, workspaceId) {
  const { data, error } = await db.from("workspace_system_models").select("system_model_json").eq("workspace_id", workspaceId).maybeSingle();
  if (error || !data?.system_model_json) return null;
  const model = data.system_model_json;
  return formatSystemModelSummary(model);
}
function formatSystemModelSummary(model) {
  const domains = model.domains?.slice(0, 12) ?? [];
  const nodes = model.nodes ?? [];
  const byTier = { core: nodes.filter((n) => n.tier === "core"), supporting: nodes.filter((n) => n.tier === "supporting"), peripheral: nodes.filter((n) => n.tier === "peripheral") };
  const coreSample = byTier.core.slice(0, 8).map((n) => `${n.label ?? n.id} (${n.domain}, ${(n.runtimeRoles ?? []).join("/") || "service"})`).join("; ");
  const lines = [
    `Domains: ${domains.join(", ") || "\u2014"}`,
    `Nodes: ${nodes.length} (${byTier.core.length} core, ${byTier.supporting.length} supporting, ${byTier.peripheral.length} peripheral)`
  ];
  if (coreSample) lines.push(`Core: ${coreSample}`);
  return lines.join("\n");
}
async function getUserMemoriesForContext(db, userId, options = {}) {
  const limit = options.limit ?? USER_MEMORIES_LIMIT;
  const maxAgeDays = options.maxAgeDays ?? USER_MEMORIES_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1e3).toISOString();
  const { data, error } = await db.from("user_memories").select("content, memory_type, created_at").eq("user_id", userId).gte("created_at", cutoff).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data ?? [];
}
function relativeAge(createdAt) {
  if (!createdAt) return "";
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1e3));
  const hours = Math.floor(ageMs / (60 * 60 * 1e3));
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  return "<1h ago";
}
function buildMemoryContextBlock(memories, snapshots, userMemories, graphEvolution, systemModelSummary) {
  const parts = [];
  if (userMemories && userMemories.length > 0) {
    const lines = userMemories.map((m) => {
      const age = relativeAge(m.created_at);
      const hint = age ? ` [${age}]` : "";
      return `- ${(m.content ?? "").slice(0, 400)}${(m.content?.length ?? 0) > 400 ? "\u2026" : ""}${hint}`;
    }).join("\n");
    parts.push(`## Your preferences (apply across projects)
${lines}`);
  }
  if (memories.length > 0) {
    const memLines = memories.map((m) => {
      const age = relativeAge(m.created_at);
      const hint = age ? ` [${age}]` : "";
      return `- ${(m.content ?? "").slice(0, 500)}${(m.content?.length ?? 0) > 500 ? "\u2026" : ""}${hint}`;
    }).join("\n");
    parts.push(`## Saved insights (workspace)
${memLines}`);
  }
  if (snapshots.length > 0) {
    const snapLines = snapshots.map((s) => {
      const age = relativeAge(s.created_at);
      const hint = age ? ` [${age}]` : "";
      return `- Q: ${s.intent_summary.slice(0, 150)} \u2192 ${s.outcome_summary.slice(0, 200)}${hint}`;
    }).join("\n");
    parts.push(`## Recent exchanges
${snapLines}`);
  }
  if (graphEvolution && graphEvolution.length > 0) {
    const evoLines = graphEvolution.map((e) => {
      const age = relativeAge(e.completed_at);
      const hint = age ? ` [${age}]` : "";
      return `- Scan: ${e.node_count} nodes, ${e.edge_count} edges${hint}`;
    }).join("\n");
    parts.push(`## Architecture evolution (scans)
${evoLines}`);
  }
  if (systemModelSummary) {
    parts.push(`## SystemModel (current architecture)
${systemModelSummary}`);
  }
  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n") + "\n";
}

// src/tasks.ts
var tasks = /* @__PURE__ */ new Map();
var MAX_AGE_MS = 60 * 60 * 1e3;
function prune() {
  const now = Date.now();
  for (const [id, t] of tasks.entries()) {
    if (now - t.createdAt > MAX_AGE_MS && (t.status === "completed" || t.status === "failed" || t.status === "cancelled")) {
      tasks.delete(id);
    }
  }
}
function createTask2() {
  const taskId = crypto.randomUUID();
  const task = {
    taskId,
    status: "pending",
    createdAt: Date.now()
  };
  tasks.set(taskId, task);
  prune();
  return task;
}
function getTask(taskId) {
  return tasks.get(taskId);
}
function setTaskRunning(taskId) {
  const t = tasks.get(taskId);
  if (t) t.status = "running";
}
function setTaskCompleted(taskId, result) {
  const t = tasks.get(taskId);
  if (t && !t.cancelled) {
    t.status = "completed";
    t.result = result;
  }
}
function setTaskFailed(taskId, error) {
  const t = tasks.get(taskId);
  if (t) {
    t.status = "failed";
    t.error = error;
  }
}
function cancelTask(taskId) {
  const t = tasks.get(taskId);
  if (!t) return false;
  if (t.status === "pending" || t.status === "running") {
    t.cancelled = true;
    t.status = "cancelled";
    return true;
  }
  return false;
}
function isTaskCancelled(taskId) {
  return tasks.get(taskId)?.cancelled ?? false;
}

// src/utils/crypto.ts
import crypto3 from "crypto";
import fs16 from "fs";
import path17 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
var __dirname3 = path17.dirname(fileURLToPath3(import.meta.url));
var KEY_FILE = path17.resolve(__dirname3, "../../.encryption-key");
var ALGO = "aes-256-gcm";
var cachedKey = null;
function getOrCreateKey() {
  const envHex = process.env.ENCRYPTION_KEY?.trim();
  if (envHex && envHex.length === 64 && /^[0-9a-fA-F]+$/.test(envHex)) {
    return envHex;
  }
  if (fs16.existsSync(KEY_FILE)) {
    const hex2 = fs16.readFileSync(KEY_FILE, "utf8").trim();
    if (hex2.length === 64 && /^[0-9a-fA-F]+$/.test(hex2)) return hex2;
  }
  const hex = crypto3.randomBytes(32).toString("hex");
  try {
    fs16.writeFileSync(KEY_FILE, hex, { mode: 384 });
  } catch (e) {
    throw new Error(
      "No ENCRYPTION_KEY in env and could not create .encryption-key file. Set ENCRYPTION_KEY in .env or ensure webapp/server/ is writable."
    );
  }
  return hex;
}
function getKey() {
  if (cachedKey) return cachedKey;
  const hex = getOrCreateKey();
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}
function encrypt(text) {
  const key = getKey();
  const iv = crypto3.randomBytes(16);
  const cipher = crypto3.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
function decrypt(stored) {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }
  const [ivHex, tagHex, encHex] = parts;
  const decipher = crypto3.createDecipheriv(
    ALGO,
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex")).toString("utf8") + decipher.final("utf8");
}

// src/jiraConfig.ts
var JiraDecryptError = class extends Error {
  constructor(userId) {
    super(
      userId ? `Jira token decrypt failed for user ${userId.slice(0, 8)}\u2026 \u2014 reconnect Jira in Governance panel.` : "Jira token could not be decrypted. Please reconnect Jira in the Governance panel."
    );
    this.name = "JiraDecryptError";
  }
};
async function getUserJiraConfigWithSource(userId) {
  if (!userId || !supabaseAdmin) return null;
  let data = null;
  let queryError = null;
  try {
    const result = await supabaseAdmin.from("integrations").select("base_url, email, api_token, default_project, verified").eq("user_id", userId).eq("provider", "jira").eq("verified", true).maybeSingle();
    data = result.data;
    queryError = result.error;
  } catch (e) {
    queryError = e;
  }
  if (queryError || !data?.api_token) return null;
  try {
    const apiToken = decrypt(data.api_token);
    return {
      config: {
        baseUrl: data.base_url ?? "",
        email: data.email ?? "",
        apiToken,
        project: data.default_project ?? null
      },
      source: "db"
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[jira] Decrypt failed; marking integration unverified:", msg);
    try {
      await supabaseAdmin.from("integrations").update({ verified: false }).eq("user_id", userId).eq("provider", "jira");
    } catch {
    }
    throw new JiraDecryptError(userId);
  }
}
async function getUserJiraConfig(userId) {
  const result = await getUserJiraConfigWithSource(userId);
  if (!result?.config) {
    console.warn(
      "[jira] getUserJiraConfig returned null",
      userId ? `(userId=${userId.slice(0, 8)}\u2026)` : "(no userId)"
    );
  }
  return result?.config ?? null;
}

// src/jira.ts
import { Router as Router4 } from "express";

// ../../src/agent/staleJiraDetector.ts
import * as crypto4 from "crypto";
function extractFingerprintFromDescription(description) {
  const text = descriptionToString(description);
  if (!text) return { fingerprint: null, module: null };
  const fpMatch = text.match(/arch-fingerprint:\s*([a-fA-F0-9]+)/);
  const modMatch = text.match(/arch-module:\s*([^\s\n]+)/);
  return {
    fingerprint: fpMatch?.[1] ?? null,
    module: modMatch?.[1] ?? null
  };
}
function descriptionToString(d) {
  if (typeof d === "string") return d;
  if (!d || typeof d !== "object") return "";
  const obj = d;
  if (obj.type === "doc" && Array.isArray(obj.content)) {
    return obj.content.map((c) => descriptionToString(c)).join("");
  }
  if (obj.type === "paragraph" && Array.isArray(obj.content)) {
    return obj.content.map((c) => descriptionToString(c)).join("");
  }
  if (obj.type === "text" && typeof obj.text === "string") return obj.text;
  return "";
}
function computeModuleFingerprint(node) {
  const payload = `${node.path}:${node.files.length}:${node.files.sort().join(",")}`;
  return crypto4.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
function detectStaleJira(graph, issues) {
  const moduleMap = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) {
    moduleMap.set(n.path, computeModuleFingerprint(n));
  }
  const mismatches = [];
  for (const issue of issues) {
    if (!issue.storedFingerprint) continue;
    const storedMod = issue.storedModule;
    if (!storedMod) continue;
    const currentFp = moduleMap.get(storedMod) ?? null;
    if (!currentFp) {
      mismatches.push({
        key: issue.key,
        summary: issue.summary,
        storedFingerprint: issue.storedFingerprint,
        storedModule: storedMod,
        currentFingerprint: null,
        reason: "orphaned"
      });
    } else if (currentFp !== issue.storedFingerprint) {
      mismatches.push({
        key: issue.key,
        summary: issue.summary,
        storedFingerprint: issue.storedFingerprint,
        storedModule: storedMod,
        currentFingerprint: currentFp,
        reason: "changed"
      });
    }
  }
  return mismatches;
}

// src/jira.ts
var router4 = Router4();
router4.get("/jira-status", requireUser, async (req, res) => {
  try {
    const result = await getUserJiraConfigWithSource(req.user.id);
    if (!result) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      project: result.config.project ?? void 0,
      source: result.source
    });
  } catch (e) {
    if (e instanceof JiraDecryptError) {
      res.status(400).json({
        configured: false,
        error: "jira_decrypt_failed",
        message: e.message
      });
      return;
    }
    res.json({ configured: false });
  }
});
function isJiraOpen(status) {
  return !/done|resolved|closed|complete/i.test(status);
}
async function syncViolationsFromJiraStatus(workspaceId, config) {
  if (!supabaseAdmin) return;
  const { data: rows } = await supabaseAdmin.from("violations").select("id, jira_key").eq("workspace_id", workspaceId).in("policy_state", ["tracked", "regressed"]).not("jira_key", "is", null);
  const violations = rows ?? [];
  for (const v of violations) {
    const key = v.jira_key?.trim();
    if (!key) continue;
    try {
      const issue = await getIssue(config, key);
      if (issue && !isJiraOpen(issue.status)) {
        await markViolationResolvedFromJira(supabaseAdmin, v.id, issue.status);
      }
    } catch {
    }
  }
}
function repoNameFromUrl2(url) {
  const m = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:][\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m?.[1] ?? null;
}
async function getWorkspaceProjectKey(workspaceId) {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("workspaces").select("jira_project_key").eq("id", workspaceId).maybeSingle();
  return data?.jira_project_key ?? null;
}
async function getGraphByWorkspaceId(workspaceId) {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data?.graph_json) return null;
  return data.graph_json;
}
router4.get("/jira-projects", requireUser, async (req, res) => {
  try {
    const config = await getUserJiraConfig(req.user.id);
    if (!config) {
      res.status(400).json({
        error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app."
      });
      return;
    }
    const projects = await listProjects(config);
    res.json({ projects });
  } catch (err) {
    if (err instanceof JiraDecryptError) {
      res.status(400).json({ error: err.message, code: "jira_decrypt_failed" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
async function userOwnsWorkspace(workspaceId, userId) {
  if (!workspaceId || !supabaseAdmin) return !workspaceId;
  const { data } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", userId).single();
  return !!data;
}
router4.get("/jira-issues", requireUser, async (req, res) => {
  try {
    const config = await getUserJiraConfig(req.user.id);
    if (!config) {
      res.status(400).json({
        error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app."
      });
      return;
    }
    const workspaceId = (typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : null) || null;
    if (workspaceId && !await userOwnsWorkspace(workspaceId, req.user.id)) {
      res.status(403).json({ error: "Workspace not found or access denied." });
      return;
    }
    const projectKeyOverride = (typeof req.query.projectKey === "string" ? req.query.projectKey.trim().toUpperCase() : null) || null;
    const project = projectKeyOverride && isValidProjectKey(projectKeyOverride) ? projectKeyOverride : await getWorkspaceProjectKey(workspaceId) ?? config.project ?? null;
    if (!project) {
      res.status(422).json({
        error: "project_key_required",
        message: "Set a project key in the sidebar to fetch Jira issues."
      });
      return;
    }
    let jql = `project = "${project}" AND resolution = Unresolved ORDER BY updated DESC`;
    const filterByRepo = req.query.filterByRepo !== "false" && req.query.filterByRepo !== "0";
    const repoUrl = typeof req.query.repoUrl === "string" ? req.query.repoUrl.trim() : "";
    const repoName = repoUrl ? repoNameFromUrl2(repoUrl) : null;
    if (filterByRepo && repoName) {
      const labelClause = ` AND labels = '${repoName.replace(/'/g, "''")}'`;
      jql = /ORDER BY/i.test(jql) ? jql.replace(/\s*ORDER BY\s+/i, `${labelClause} ORDER BY `) : jql + labelClause;
    }
    const includeStaleDetection = req.query.includeStaleDetection === "true" || req.query.includeStaleDetection === "1";
    const issues = await searchIssues(config, jql, 25, {
      includeDescription: includeStaleDetection
    });
    let staleMismatches;
    if (includeStaleDetection && workspaceId) {
      const graph = await getGraphByWorkspaceId(workspaceId);
      if (graph) {
        const issuesWithFp = issues.map((i) => {
          const { fingerprint, module: mod } = extractFingerprintFromDescription(i.description);
          return {
            key: i.key,
            summary: i.summary,
            status: i.status,
            storedFingerprint: fingerprint,
            storedModule: mod
          };
        });
        const mismatches = detectStaleJira(graph, issuesWithFp);
        staleMismatches = mismatches.map((m) => ({
          key: m.key,
          summary: m.summary,
          reason: m.reason,
          storedModule: m.storedModule
        }));
      }
    }
    if (workspaceId) {
      setImmediate(() => {
        syncViolationsFromJiraStatus(workspaceId, config).catch(
          (err) => console.warn("[jira] syncViolationsFromJiraStatus failed:", err instanceof Error ? err.message : err)
        );
      });
    }
    res.json({
      issues: issues.map((i) => ({
        key: i.key,
        summary: i.summary,
        status: i.status,
        type: i.type,
        priority: i.priority,
        baseUrl: config.baseUrl.replace(/\/$/, ""),
        labels: i.labels
      })),
      repoName: repoName ?? void 0,
      ...staleMismatches && staleMismatches.length > 0 ? { staleMismatches } : {}
    });
  } catch (err) {
    if (err instanceof JiraDecryptError) {
      res.status(400).json({ error: err.message, code: "jira_decrypt_failed" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
router4.post("/jira-add-label", requireUser, async (req, res) => {
  try {
    const config = await getUserJiraConfig(req.user.id);
    if (!config) {
      res.status(400).json({ error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app." });
      return;
    }
    const { issueKey, label } = req.body;
    if (!issueKey || !label) {
      res.status(400).json({ error: "issueKey and label required" });
      return;
    }
    if (label.length > 255) {
      res.status(400).json({ error: "label too long (max 255 chars)" });
      return;
    }
    const result = await addLabel(config, issueKey, label);
    if (!result.success) {
      res.status(500).json({ error: result.error ?? "Failed to add label" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof JiraDecryptError) {
      res.status(400).json({ error: err.message, code: "jira_decrypt_failed" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
router4.post("/jira-sync", requireUser, async (req, res) => {
  const { workspaceId } = req.body;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const owned = await userOwnsWorkspace(workspaceId, req.user.id);
  if (!owned) {
    res.status(403).json({ error: "Workspace not found or access denied" });
    return;
  }
  try {
    const config = await getUserJiraConfig(req.user.id);
    if (!config) {
      res.json({ synced: false, message: "Jira not connected" });
      return;
    }
    await syncViolationsFromJiraStatus(workspaceId, config);
    res.json({ synced: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// src/jiraViolation.ts
import * as crypto5 from "crypto";
import { Router as Router5 } from "express";
var router5 = Router5();
async function createJiraTicketForViolation(params) {
  const {
    config,
    projectKey,
    violation,
    projectRoot: projectRoot5,
    projectName,
    workspaceId,
    archModulePath,
    archModuleFiles
  } = params;
  const vSourceNodeId = violation.sourceNodeId;
  const vTargetNodeId = violation.targetNodeId;
  const vType = violation.type;
  const vSeverity = violation.severity;
  const vDescription = violation.description;
  const vSuggestedFix = violation.suggestedFix;
  let storedId = null;
  if (workspaceId && supabaseAdmin) {
    const raw = {
      type: vType,
      severity: vSeverity,
      sourceNodeId: vSourceNodeId,
      targetNodeId: vTargetNodeId,
      description: vDescription,
      suggestedFix: vSuggestedFix
    };
    const upserted = await upsertViolations(supabaseAdmin, {
      workspaceId,
      violations: [raw],
      rulesVersion: ARCH_RULESET_VERSION
    });
    const match = upserted.find(
      (r) => r.source_node_id === vSourceNodeId && r.target_node_id === (vTargetNodeId ?? null) && r.type === vType
    );
    if (match?.id) storedId = match.id;
  }
  const repoName = repoNameFromPath(projectRoot5 ?? "");
  const labels = ["architecture", "littlelabs-auto"];
  if (repoName) labels.push(repoName);
  labels.push(`archNodeId:${vSourceNodeId}`.slice(0, 255));
  const modulePath = archModulePath ?? vSourceNodeId;
  const moduleFiles = Array.isArray(archModuleFiles) ? archModuleFiles : [];
  const fingerprint = modulePath && moduleFiles.length > 0 ? computeModuleFingerprint2(modulePath, moduleFiles) : null;
  const summaryBase = vType.replace(/_/g, " ");
  const pathPart = vTargetNodeId ? `${vSourceNodeId} \u2192 ${vTargetNodeId}` : vSourceNodeId;
  const summary = `[ARCH] ${summaryBase}: ${pathPart}`;
  const descriptionLines = [
    "## Architecture Violation \u2014 LittleLabs",
    "",
    `**Type:** ${summaryBase}`,
    `**Severity:** ${vSeverity.toUpperCase()}`,
    `**Detected:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
    projectName ? `**Project:** ${projectName}` : "",
    projectRoot5 ? `**Root:** ${projectRoot5}` : "",
    "",
    "### What was found",
    vDescription ?? "",
    "",
    "### Affected node(s)",
    `- Source: \`${vSourceNodeId}\``,
    vTargetNodeId ? `- Target: \`${vTargetNodeId}\`` : "",
    "",
    vSuggestedFix ? `### Suggested fix
${vSuggestedFix}` : "",
    fingerprint ? `arch-fingerprint: ${fingerprint}` : "",
    `arch-module: ${modulePath}`,
    "",
    "---",
    "*Auto-generated by LittleLabs Architecture Intelligence*"
  ].filter(Boolean);
  const description = descriptionLines.join("\n");
  try {
    const issue = await createIssue(
      { baseUrl: config.baseUrl, email: config.email, apiToken: config.apiToken },
      {
        projectKey,
        summary,
        description,
        labels,
        issueType: process.env.JIRA_ISSUE_TYPE ?? "Bug",
        priority: triagePriority(vSeverity)
      }
    );
    if (storedId && supabaseAdmin) {
      await markViolationTracked(supabaseAdmin, storedId, issue.key, "To Do");
    } else if (!storedId && workspaceId && supabaseAdmin) {
      const fp = buildViolationFingerprint(
        {
          type: vType,
          severity: vSeverity,
          sourceNodeId: vSourceNodeId,
          targetNodeId: vTargetNodeId
        },
        ARCH_RULESET_VERSION
      );
      const { data: row } = await supabaseAdmin.from("violations").select("id").eq("workspace_id", workspaceId).eq("fingerprint", fp).eq("rules_version", ARCH_RULESET_VERSION).maybeSingle();
      if (row?.id) {
        await markViolationTracked(supabaseAdmin, row.id, issue.key, "To Do");
      }
    }
    return {
      key: issue.key,
      url: `${config.baseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
      existing: false
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
function computeModuleFingerprint2(path43, files) {
  const payload = `${path43}:${files.length}:${[...files].sort().join(",")}`;
  return crypto5.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
function triagePriority(severity) {
  const map = {
    critical: "Highest",
    high: "High",
    medium: "Medium",
    low: "Low"
  };
  return map[severity] ?? "Medium";
}
function repoNameFromPath(projectRoot5) {
  if (!projectRoot5) return null;
  const parts = projectRoot5.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}
function isJiraOpen2(status) {
  return !/done|resolved|closed|complete/i.test(status);
}
async function getWorkspaceProjectKey2(workspaceId) {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("workspaces").select("jira_project_key").eq("id", workspaceId).single();
  return data?.jira_project_key ?? null;
}
router5.post("/jira-violation", requireUser, async (req, res) => {
  let config;
  try {
    config = await getUserJiraConfig(req.user.id);
  } catch (e) {
    if (e instanceof JiraDecryptError) {
      res.status(400).json({
        error: e.message,
        code: "jira_decrypt_failed"
      });
      return;
    }
    throw e;
  }
  if (!config) {
    res.status(400).json({
      error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app."
    });
    return;
  }
  const { violationId, violation, projectRoot: projectRoot5, projectName, workspaceId, archModulePath, archModuleFiles } = req.body;
  const userId = req.user.id;
  if (workspaceId && supabaseAdmin) {
    const { data: ws, error } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", userId).single();
    if (error || !ws) {
      res.status(403).json({ error: "Workspace not found or access denied." });
      return;
    }
  }
  const projectKey = await getWorkspaceProjectKey2(workspaceId ?? null) ?? config.project ?? null;
  if (!projectKey) {
    res.status(422).json({
      error: "project_key_required",
      message: "Set a project key in the sidebar to track violations in Jira."
    });
    return;
  }
  let storedId = null;
  let existingJiraKey = null;
  let vType;
  let vSeverity;
  let vSourceNodeId;
  let vTargetNodeId;
  let vDescription;
  let vSuggestedFix;
  if (violationId && supabaseAdmin) {
    const { data: row, error } = await supabaseAdmin.from("violations").select("*").eq("id", violationId).single();
    if (error || !row) {
      res.status(404).json({ error: "Violation not found" });
      return;
    }
    storedId = row.id;
    existingJiraKey = row.jira_key ?? null;
    vType = row.type;
    vSeverity = row.severity;
    vSourceNodeId = row.source_node_id;
    vTargetNodeId = row.target_node_id ?? void 0;
    vDescription = row.description ?? void 0;
    vSuggestedFix = row.suggested_fix ?? void 0;
  } else if (violation) {
    vType = violation.type;
    vSeverity = violation.severity;
    vSourceNodeId = violation.sourceNodeId;
    vTargetNodeId = violation.targetNodeId;
    vDescription = violation.description;
    vSuggestedFix = violation.suggestedFix;
    if (workspaceId && supabaseAdmin) {
      const raw = {
        type: vType,
        severity: vSeverity,
        sourceNodeId: vSourceNodeId,
        targetNodeId: vTargetNodeId,
        description: vDescription,
        suggestedFix: vSuggestedFix
      };
      const upserted = await upsertViolations(supabaseAdmin, {
        workspaceId,
        violations: [raw],
        rulesVersion: ARCH_RULESET_VERSION
      });
      const match = upserted.find(
        (r) => r.source_node_id === vSourceNodeId && r.target_node_id === (vTargetNodeId ?? null) && r.type === vType
      );
      if (match?.id) storedId = match.id;
    }
  } else {
    res.status(400).json({ error: "violationId or violation is required" });
    return;
  }
  if (existingJiraKey) {
    try {
      const existing = await getIssue(config, existingJiraKey);
      if (existing && isJiraOpen2(existing.status)) {
        res.json({
          key: existingJiraKey,
          existing: true,
          status: existing.status
        });
        return;
      }
    } catch {
    }
  }
  const violationObj = {
    type: vType,
    severity: vSeverity,
    sourceNodeId: vSourceNodeId,
    targetNodeId: vTargetNodeId,
    description: vDescription ?? "",
    suggestedFix: vSuggestedFix
  };
  const result = await createJiraTicketForViolation({
    config,
    projectKey,
    violation: violationObj,
    projectRoot: projectRoot5,
    projectName,
    workspaceId,
    archModulePath,
    archModuleFiles
  });
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    key: result.key,
    url: result.url,
    existing: result.existing ?? false
  });
});

// src/greenfieldDraft.ts
import * as fs17 from "fs";
import * as path18 from "path";
var GREENFIELD_DIR = ".agent/greenfield";
var DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var GC_PROBABILITY = 0.05;
var GC_MIN_INTERVAL_MS = 10 * 60 * 1e3;
function getGreenfieldDir(basePath) {
  return path18.join(basePath, GREENFIELD_DIR);
}
function getDraftPath(basePath, sessionId2) {
  const safe = sessionId2.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 128);
  return path18.join(getGreenfieldDir(basePath), `draft-${safe}.json`);
}
function getBasePath() {
  const base = process.env.PROJECTS_BASE_DIR?.trim() || process.env.PROJECT_ROOT?.trim() || process.cwd();
  return path18.resolve(base);
}
function getDraftTtlMs() {
  const raw = process.env.GREENFIELD_DRAFT_TTL_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DRAFT_TTL_MS;
  return Math.min(n, 30 * 24 * 60 * 60 * 1e3);
}
function getGcStampPath(basePath) {
  return path18.join(getGreenfieldDir(basePath), ".gc-stamp");
}
function canRunGc(basePath) {
  try {
    const stamp = getGcStampPath(basePath);
    if (!fs17.existsSync(stamp)) return true;
    const raw = fs17.readFileSync(stamp, "utf-8").trim();
    const last = raw ? Number(raw) : NaN;
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > GC_MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}
function markGcRan(basePath) {
  try {
    const dir = getGreenfieldDir(basePath);
    if (!fs17.existsSync(dir)) fs17.mkdirSync(dir, { recursive: true });
    fs17.writeFileSync(getGcStampPath(basePath), String(Date.now()), "utf-8");
  } catch {
  }
}
function gcDrafts(basePath) {
  const root = basePath ?? getBasePath();
  const dir = getGreenfieldDir(root);
  const ttl = getDraftTtlMs();
  let deleted = 0;
  try {
    if (!fs17.existsSync(dir)) return { deleted };
    const now = Date.now();
    const entries = fs17.readdirSync(dir);
    for (const name of entries) {
      if (!name.startsWith("draft-") || !name.endsWith(".json")) continue;
      const full = path18.join(dir, name);
      try {
        const stat = fs17.statSync(full);
        const age = now - stat.mtimeMs;
        if (age > ttl) {
          fs17.unlinkSync(full);
          deleted++;
        }
      } catch {
      }
    }
  } catch {
  }
  return { deleted };
}
function maybeGc(basePath) {
  const root = basePath ?? getBasePath();
  if (Math.random() > GC_PROBABILITY) return;
  if (!canRunGc(root)) return;
  markGcRan(root);
  gcDrafts(root);
}
function loadDraft(sessionId2, basePath) {
  const root = basePath ?? getBasePath();
  maybeGc(root);
  const filePath = getDraftPath(root, sessionId2);
  try {
    if (!fs17.existsSync(filePath)) return null;
    const raw = fs17.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.sessionId || !Array.isArray(parsed.nodes)) return null;
    return {
      ...parsed,
      nodes: parsed.nodes ?? [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch {
    return null;
  }
}
function saveDraft(sessionId2, draft, basePath) {
  const root = basePath ?? getBasePath();
  maybeGc(root);
  const dir = getGreenfieldDir(root);
  if (!fs17.existsSync(dir)) fs17.mkdirSync(dir, { recursive: true });
  const full = {
    ...draft,
    sessionId: sessionId2,
    nodes: draft.nodes ?? [],
    edges: draft.edges ?? [],
    updatedAt: Date.now()
  };
  const filePath = getDraftPath(root, sessionId2);
  const tmp = `${filePath}.tmp`;
  fs17.writeFileSync(tmp, JSON.stringify(full, null, 2), "utf-8");
  fs17.renameSync(tmp, filePath);
  return full;
}
function deleteDraft(sessionId2, basePath) {
  const root = basePath ?? getBasePath();
  const filePath = getDraftPath(root, sessionId2);
  try {
    if (fs17.existsSync(filePath)) {
      fs17.unlinkSync(filePath);
      return true;
    }
  } catch {
  }
  return false;
}
function appendDraftNode(sessionId2, node, basePath) {
  const existing = loadDraft(sessionId2, basePath);
  const nodes = existing ? [...existing.nodes] : [];
  const idx = nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) nodes[idx] = node;
  else nodes.push(node);
  return saveDraft(sessionId2, {
    nodes,
    edges: existing?.edges ?? [],
    workspaceId: existing?.workspaceId
  }, basePath);
}
function removeDraftNode(sessionId2, nodeId, basePath) {
  const existing = loadDraft(sessionId2, basePath);
  if (!existing) return null;
  const nodes = existing.nodes.filter((n) => n.id !== nodeId);
  const edges = existing.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return saveDraft(sessionId2, {
    nodes,
    edges,
    workspaceId: existing.workspaceId
  }, basePath);
}
function updateDraftNode(sessionId2, nodeId, updates, basePath) {
  const existing = loadDraft(sessionId2, basePath);
  if (!existing) return null;
  const idx = existing.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) return null;
  const nodes = [...existing.nodes];
  nodes[idx] = { ...nodes[idx], ...updates };
  return saveDraft(sessionId2, {
    nodes,
    edges: existing.edges,
    workspaceId: existing.workspaceId
  }, basePath);
}
function appendDraftEdge(sessionId2, edge, basePath) {
  const existing = loadDraft(sessionId2, basePath);
  const edges = existing ? [...existing.edges] : [];
  if (!edges.some((e) => e.source === edge.source && e.target === edge.target)) {
    edges.push(edge);
  }
  return saveDraft(sessionId2, {
    nodes: existing?.nodes ?? [],
    edges,
    workspaceId: existing?.workspaceId
  }, basePath);
}

// src/cloneRepo.ts
import * as fs18 from "fs";
import * as path19 from "path";
import { homedir } from "os";
import { simpleGit } from "simple-git";
var CLONES_BASE = process.env.ARCH_VIZ_CLONES_DIR?.trim() || path19.join(homedir(), ".arch-viz", "repos");
var recloneLocks = /* @__PURE__ */ new Map();
function getClonesDir() {
  return CLONES_BASE;
}
function authUrl(url) {
  const trimmed = url.trim();
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
  if (!token) return trimmed;
  const match = trimmed.match(/^(https?:\/\/)(github\.com\/[\w.-]+\/[\w.-]+?)(\.git)?\/?$/i);
  if (!match) return trimmed;
  const [, scheme, repoPath] = match;
  return `${scheme}${token}@${repoPath}`;
}
function isCloneValid(dir) {
  const gitDir = path19.join(dir, ".git");
  try {
    return fs18.existsSync(gitDir) && fs18.statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}
async function cloneToStablePath(repoUrl, workspaceId) {
  const stableDir = path19.join(getClonesDir(), workspaceId);
  if (fs18.existsSync(stableDir)) {
    if (!isCloneValid(stableDir)) {
      fs18.rmSync(stableDir, { recursive: true, force: true });
    } else {
      return stableDir;
    }
  }
  fs18.mkdirSync(path19.dirname(stableDir), { recursive: true });
  const cloneUrl = authUrl(repoUrl);
  try {
    await simpleGit().clone(cloneUrl, stableDir, ["--depth", "1"]);
  } catch (err) {
    if (fs18.existsSync(stableDir)) {
      try {
        fs18.rmSync(stableDir, { recursive: true, force: true });
      } catch {
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth|401|403|permission|denied/i.test(msg)) {
      throw new Error(
        "Clone failed (auth). Private repositories require GITHUB_TOKEN or GITHUB_ACCESS_TOKEN. Set one in your environment."
      );
    }
    throw err;
  }
  return stableDir;
}
function isExistingDir(dir) {
  try {
    return fs18.existsSync(dir) && fs18.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
async function ensureProjectRoot(workspaceId, graph, repoUrl) {
  const stored = graph.projectRoot?.trim();
  if (stored) {
    const resolved = path19.resolve(stored);
    if (isCloneValid(resolved)) return { rootPath: resolved };
    if (isExistingDir(resolved)) {
      const clonesBase = path19.resolve(getClonesDir());
      const rel = path19.relative(clonesBase, resolved);
      const underClones = !rel.startsWith("..") && !path19.isAbsolute(rel);
      if (!underClones) {
        return { rootPath: resolved };
      }
      try {
        fs18.rmSync(resolved, { recursive: true, force: true });
      } catch {
      }
    }
  }
  const trimmedRepo = typeof repoUrl === "string" ? repoUrl.trim() : "";
  if (!trimmedRepo) {
    return {
      rootPath: null,
      error: "Source code unavailable and no repo URL stored. Please re-scan once to register the repository."
    };
  }
  let existing = recloneLocks.get(workspaceId);
  if (existing) {
    const result2 = await existing;
    return result2 !== null ? { rootPath: result2 } : { rootPath: null, error: "Reclone failed." };
  }
  const run = async () => {
    try {
      const stableDir = await cloneToStablePath(trimmedRepo, workspaceId);
      const admin = supabaseAdmin;
      if (admin) {
        setImmediate(() => {
          void admin.from("workspaces").update({ project_root: stableDir }).eq("id", workspaceId).then(
            () => void 0,
            (e) => console.warn(
              "[cloneRepo] Failed to update workspace project_root:",
              e instanceof Error ? e.message : e
            )
          );
          const updated = { ...graph, projectRoot: stableDir };
          void admin.from("graphs").select("id").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
            if (data?.id) {
              admin.from("graphs").update({ graph_json: updated }).eq("id", data.id).then(
                () => void 0,
                (e) => console.warn("[cloneRepo] Failed to update graph projectRoot:", e instanceof Error ? e.message : e)
              );
            }
          }).then(void 0, () => void 0);
        });
      }
      return stableDir;
    } catch (err) {
      console.warn(
        "[cloneRepo] Reclone failed:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    } finally {
      recloneLocks.delete(workspaceId);
    }
  };
  const promise = run();
  recloneLocks.set(workspaceId, promise);
  const result = await promise;
  return result !== null ? { rootPath: result } : { rootPath: null, error: "Reclone failed." };
}
async function bootstrapProjectRoot(targetPath) {
  const root = path19.resolve(targetPath.trim());
  if (!root || root === "/" || root.length < 2) {
    return { rootPath: "", error: "Invalid target path." };
  }
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path19.resolve(baseDir);
    if (!root.startsWith(baseNorm + path19.sep) && root !== baseNorm) {
      return { rootPath: "", error: "Target path must be within the allowed projects directory." };
    }
  }
  try {
    if (!fs18.existsSync(root)) {
      fs18.mkdirSync(root, { recursive: true });
    }
    if (!isCloneValid(root)) {
      await simpleGit(root).init();
    }
    return { rootPath: root };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rootPath: "", error: `Bootstrap failed: ${msg}` };
  }
}
function deleteWorkspaceClone(workspaceId) {
  const stableDir = path19.join(getClonesDir(), workspaceId);
  try {
    if (fs18.existsSync(stableDir)) {
      fs18.rmSync(stableDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(
      "[cloneRepo] Failed to delete clone:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// src/todos.ts
import { Router as Router6 } from "express";

// src/railExecute.ts
import * as path30 from "path";

// ../../src/agent/rail/orchestrator.ts
import * as fs20 from "fs";

// ../../src/agent/rail/executor.ts
import * as fs19 from "fs";
import * as path20 from "path";
function isPathSafe(root, relPath) {
  const resolved = path20.resolve(root, relPath);
  const rootNorm = path20.resolve(root);
  return resolved.startsWith(rootNorm) && resolved !== rootNorm;
}
function writeProposedNodesToSandbox(sandboxPath, nodes) {
  const created = [];
  const errors = [];
  const root = path20.resolve(sandboxPath);
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : "";
    const label = typeof node.label === "string" ? node.label : id;
    const archNodeId = typeof node.archNodeId === "string" ? node.archNodeId : id;
    const relPath = id || archNodeId || label.replace(/\s+/g, "-").toLowerCase();
    if (!relPath || /\.\.|\\\\|\/\//.test(relPath)) {
      errors.push(`Invalid path for node ${label}: ${relPath}`);
      continue;
    }
    if (!isPathSafe(root, relPath)) {
      errors.push(`Path traversal blocked for ${label}`);
      continue;
    }
    try {
      const absPath = path20.join(root, relPath);
      const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
      const targetDir = pathLooksLikeFile ? path20.dirname(absPath) : absPath;
      if (!fs19.existsSync(targetDir)) {
        fs19.mkdirSync(targetDir, { recursive: true });
      }
      const indexPath = pathLooksLikeFile ? absPath : path20.join(absPath, "index.ts");
      const layer = typeof node.layer === "string" ? node.layer : "Uncategorized";
      const header = `// Generated by Arch Visualizer (sandbox). Boilerplate only.
// @archNodeId: ${archNodeId}`;
      const hasSkeleton = typeof node.skeletonCode === "string" && node.skeletonCode.trim().length > 0;
      const body = hasSkeleton ? `

${node.skeletonCode.trim()}
` : `

// TODO: Implement ${label} (${layer}).

export function TODO_${archNodeId.replace(
        /[^a-zA-Z0-9_]/g,
        "_"
      )}() {
  // implementation pending
}
`;
      if (!fs19.existsSync(indexPath)) {
        fs19.writeFileSync(indexPath, `${header}${body}`, "utf-8");
      }
      const rel = path20.relative(root, indexPath).replace(/\\/g, "/");
      created.push(rel);
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { created, errors };
}
function syncSandboxFromRoot(rootPath, railId, paths) {
  const sandboxRoot = ensureSandbox(rootPath, railId);
  for (const rel of paths) {
    const src = path20.join(rootPath, rel);
    const dst = path20.join(sandboxRoot, rel);
    try {
      if (!fs19.existsSync(src)) continue;
      const dir = path20.dirname(dst);
      if (!fs19.existsSync(dir)) {
        fs19.mkdirSync(dir, { recursive: true });
      }
      fs19.copyFileSync(src, dst);
    } catch {
    }
  }
  return sandboxRoot;
}
function materializeRail(railId, sandboxPath, rootPath) {
  const copiedFiles = [];
  try {
    const sandboxRoot = path20.resolve(sandboxPath);
    const projectRoot5 = path20.resolve(rootPath);
    if (!fs19.existsSync(sandboxRoot)) {
      return { success: false, copiedFiles, error: `Sandbox for rail ${railId} does not exist` };
    }
    const entries = walkDir(sandboxRoot);
    for (const absFile of entries) {
      const rel = path20.relative(sandboxRoot, absFile);
      const target = path20.join(projectRoot5, rel);
      const targetDir = path20.dirname(target);
      if (!fs19.existsSync(targetDir)) {
        fs19.mkdirSync(targetDir, { recursive: true });
      }
      fs19.copyFileSync(absFile, target);
      copiedFiles.push(rel.replace(/\\/g, "/"));
    }
    return { success: true, copiedFiles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, copiedFiles, error: message };
  }
}
function walkDir(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs19.statSync(current);
    if (stat.isDirectory()) {
      const children = fs19.readdirSync(current);
      for (const child of children) {
        stack.push(path20.join(current, child));
      }
    } else if (stat.isFile()) {
      result.push(current);
    }
  }
  return result;
}

// ../../src/agent/rail/orchestrator.ts
var VALID_TRANSITIONS = {
  PRE_PLANNING: /* @__PURE__ */ new Set(["PLANNING", "AWAITING_APPROVAL", "SUSPENDED", "FAILED"]),
  PLANNING: /* @__PURE__ */ new Set(["AWAITING_APPROVAL", "SUSPENDED", "FAILED"]),
  AWAITING_APPROVAL: /* @__PURE__ */ new Set(["EXECUTING", "SUSPENDED", "FAILED"]),
  EXECUTING: /* @__PURE__ */ new Set(["AWAITING_HITL", "VERIFYING", "SELF_CORRECTING", "SUSPENDED", "FAILED"]),
  AWAITING_HITL: /* @__PURE__ */ new Set(["EXECUTING", "SUSPENDED", "FAILED"]),
  VERIFYING: /* @__PURE__ */ new Set(["MATERIALIZING", "SELF_CORRECTING", "SUSPENDED", "FAILED"]),
  SELF_CORRECTING: /* @__PURE__ */ new Set(["EXECUTING", "AWAITING_HITL", "SUSPENDED", "FAILED"]),
  MATERIALIZING: /* @__PURE__ */ new Set(["ARCHIVED", "SUSPENDED", "FAILED"]),
  SUSPENDED: /* @__PURE__ */ new Set(["AWAITING_APPROVAL", "EXECUTING"]),
  FAILED: /* @__PURE__ */ new Set(),
  // terminal
  ARCHIVED: /* @__PURE__ */ new Set()
  // terminal
};
function canTransition(from, to, _ctx) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  if (!allowed.has(to)) return false;
  if (to === "EXECUTING" && from === "AWAITING_APPROVAL") {
    return _ctx?.planApproved === true;
  }
  if (to === "MATERIALIZING" && from === "VERIFYING") {
    return _ctx?.reviewerPassed === true;
  }
  if (to === "ARCHIVED" && from === "MATERIALIZING") {
    return _ctx?.materializationApproved === true;
  }
  if (to === "SUSPENDED") {
    return from !== "ARCHIVED" && from !== "FAILED";
  }
  if (to === "FAILED") {
    return from !== "ARCHIVED";
  }
  return true;
}
function transitionRail(rootPath, railId, to, ctx) {
  const rail = getRail(rootPath, railId);
  if (!rail) {
    return { ok: false, rail: null, error: "Rail not found" };
  }
  const from = rail.state;
  if (from === to) {
    return { ok: true, rail };
  }
  if (!canTransition(from, to, ctx)) {
    return {
      ok: false,
      rail: null,
      error: `Invalid transition: ${from} -> ${to} (guards may have failed)`
    };
  }
  if (to === "EXECUTING") {
    ensureSandbox(rootPath, railId);
  }
  if (to === "ARCHIVED" || to === "FAILED") {
    const sandboxPath = getSandboxPath(rootPath, railId);
    try {
      if (fs20.existsSync(sandboxPath)) {
        fs20.rmSync(sandboxPath, { recursive: true, force: true });
      }
    } catch {
    }
  }
  const updated = to === "EXECUTING" ? enterExecutingState(rootPath, railId) : updateRailState(rootPath, railId, to);
  return { ok: !!updated, rail: updated ?? null };
}
function completeMaterializeAndArchive(rootPath, railId) {
  const rail = getRail(rootPath, railId);
  if (!rail) return null;
  if (rail.state !== "VERIFYING" && rail.state !== "MATERIALIZING") {
    return null;
  }
  const hi = rail.hallucinationIndex;
  const intent = rail.intentDriftScore;
  const acknowledged = !!rail.hallucinationAcknowledgedAt;
  if (hi != null && hi > 0.5 && !acknowledged || intent != null && intent > 0.6 && !acknowledged) {
    return null;
  }
  const sandboxPath = getSandboxPath(rootPath, railId);
  const mat = materializeRail(railId, sandboxPath, rootPath);
  const canProceed = mat.success || mat.error?.includes("does not exist");
  if (!canProceed) {
    return rail;
  }
  if (rail.state === "VERIFYING") {
    updateRailState(rootPath, railId, "MATERIALIZING");
  }
  return archiveRail(rootPath, railId);
}

// ../../src/agent/taskRunner.ts
import * as fs25 from "fs";
import * as path27 from "path";

// ../../src/agent/toolExecutor.ts
import * as fs24 from "fs";
import * as path26 from "path";

// ../../src/agent/securityAllowlist.ts
import * as path21 from "path";
var READ_ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".env.example",
  ".env.sample",
  ".sh"
]);
var WRITE_ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".md"]);
var EXCLUDED_PATTERNS = [
  /node_modules/,
  /\.config\./,
  /\.lock$/
];
function isEnvProtected(basename6) {
  if (basename6 === ".env") return true;
  if (basename6.startsWith(".env.") && !basename6.endsWith(".example") && !basename6.endsWith(".sample")) {
    return true;
  }
  return false;
}
var DEFAULT_ALLOWED_PREFIXES = ["src/", "docs/"];
function checkPathAllowed(filePath, config, mode = "write") {
  const root = path21.resolve(config.projectRoot);
  const resolved = path21.resolve(root, filePath);
  if (!resolved.startsWith(root)) {
    return { allowed: false, reason: "Path outside project root" };
  }
  const relative17 = path21.relative(root, resolved).replace(/\\/g, "/");
  if (relative17.includes("..")) {
    return { allowed: false, reason: "Path traversal not allowed" };
  }
  const ext = path21.extname(resolved);
  const basename6 = path21.basename(resolved);
  if (isEnvProtected(basename6)) {
    return { allowed: false, reason: "Environment files (.env*) are not readable or writable" };
  }
  const isDockerfile = basename6 === "Dockerfile";
  const allowedExts = mode === "read" ? READ_ALLOWED_EXTENSIONS : WRITE_ALLOWED_EXTENSIONS;
  if (!isDockerfile && !allowedExts.has(ext)) {
    return { allowed: false, reason: `Extension ${ext || "<none>"} not allowed for ${mode}` };
  }
  for (const pat of EXCLUDED_PATTERNS) {
    if (pat.test(relative17)) {
      return { allowed: false, reason: `Path matches excluded pattern: ${pat}` };
    }
  }
  const prefixes = config.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const ok = prefixes.some((p) => relative17.startsWith(p));
  if (!ok) {
    return { allowed: false, reason: `Path must be under ${prefixes.join(" or ")}` };
  }
  return { allowed: true };
}

// ../../src/agent/staging.ts
import * as fs21 from "fs";
import * as path22 from "path";
var BUFFER_FILE = "buffer.json";
var stagingDir = "";
var buffer = /* @__PURE__ */ new Map();
function bufferPath() {
  return path22.join(stagingDir, BUFFER_FILE);
}
function saveBuffer() {
  const p = bufferPath();
  const arr = Array.from(buffer.values());
  fs21.writeFileSync(p, JSON.stringify(arr, null, 2), "utf-8");
}
function writeToStaging(filePath, content, opts) {
  const id = `stg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  buffer.set(filePath, {
    path: filePath,
    content,
    beforeContent: opts?.beforeContent,
    taskId: opts?.taskId
  });
  saveBuffer();
  return id;
}

// ../../src/agent/runLint.ts
import * as path23 from "path";
import { spawnSync as spawnSync2 } from "child_process";
function runLint(projectRoot5, paths, workingDir) {
  const errors = [];
  const tscProc = spawnSync2("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    cwd: workingDir ?? projectRoot5,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024
  });
  if (tscProc.status !== 0 && tscProc.stderr) {
    const root = path23.resolve(projectRoot5);
    const lines = tscProc.stderr.split("\n");
    for (const line of lines) {
      const match = line.match(/^([^(]+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/);
      if (match) {
        const [, filePath, lineNum, col, message] = match;
        const resolved = path23.isAbsolute(filePath?.trim() ?? "") ? filePath.trim() : path23.join(root, filePath?.trim() ?? "");
        const rel = path23.relative(root, resolved).replace(/\\/g, "/");
        errors.push({
          filePath: rel,
          line: parseInt(lineNum ?? "0", 10),
          column: parseInt(col ?? "0", 10),
          message: message ?? "",
          ruleId: "tsc",
          severity: "error"
        });
      }
    }
  }
  const lintPaths = paths?.length ? paths : ["src"];
  const eslintProc = spawnSync2("npx", ["eslint", ...lintPaths, "--format", "json"], {
    cwd: workingDir ?? projectRoot5,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024
  });
  if (eslintProc.stdout) {
    try {
      const out = JSON.parse(eslintProc.stdout);
      const root = path23.resolve(workingDir ?? projectRoot5);
      for (const file of out) {
        const rel = path23.relative(root, path23.isAbsolute(file.filePath) ? file.filePath : path23.join(root, file.filePath)).replace(/\\/g, "/");
        for (const m of file.messages) {
          errors.push({
            filePath: rel,
            line: m.line,
            column: m.column,
            message: m.message,
            ruleId: m.ruleId ?? "unknown",
            severity: m.severity === 2 ? "error" : "warning"
          });
        }
      }
    } catch {
    }
  }
  return {
    passed: errors.filter((e) => e.severity === "error").length === 0,
    errors
  };
}

// ../../src/agent/runVitest.ts
import * as path24 from "path";
import * as fs22 from "fs";
import { spawnSync as spawnSync3 } from "child_process";
function runVitest(projectRoot5, pattern, workingDir) {
  const cwd = workingDir ?? projectRoot5;
  const jsonFile = path24.join(cwd, ".arch-agent-staging", "vitest-results.json");
  const stagingDir2 = path24.dirname(jsonFile);
  if (!fs22.existsSync(stagingDir2)) {
    fs22.mkdirSync(stagingDir2, { recursive: true });
  }
  const args = ["vitest", "run", "--reporter=json", `--outputFile.json=${jsonFile}`];
  if (pattern) args.push("--testNamePattern", pattern);
  const proc = spawnSync3("npx", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024
  });
  const failures = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  try {
    const raw = fs22.existsSync(jsonFile) ? fs22.readFileSync(jsonFile, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    const results = parsed?.testResults ?? parsed?.results;
    if (Array.isArray(results)) {
      for (const file of results) {
        const filePath = path24.relative(cwd, file.name);
        for (const t of file.assertionResults ?? []) {
          total++;
          if (t.status === "passed") passed++;
          else if (t.status === "skipped") skipped++;
          else {
            failed++;
            failures.push({
              testName: t.fullName,
              filePath,
              error: t.failureMessages?.[0] ?? "Test failed",
              stackTrace: t.failureMessages?.join("\n") ?? ""
            });
          }
        }
      }
    }
    try {
      fs22.unlinkSync(jsonFile);
    } catch {
    }
  } catch {
    if (proc.status !== 0) {
      failures.push({
        testName: pattern ?? "vitest run",
        filePath: ".",
        error: (proc.stderr ?? proc.stdout ?? "Vitest failed").slice(0, 500),
        stackTrace: ""
      });
      failed = 1;
      total = 1;
    }
  }
  return {
    passed: failed === 0,
    summary: { total, passed, failed, skipped },
    failures
  };
}

// ../../src/agent/getAst.ts
import * as path25 from "path";
import * as fs23 from "fs";
import * as crypto6 from "crypto";
import { Project, SyntaxKind } from "ts-morph";
function getAst(projectRoot5, filePath) {
  const allow = checkPathAllowed(filePath, { projectRoot: projectRoot5 });
  if (!allow.allowed) {
    return { success: false, error: allow.reason ?? "Path not allowed" };
  }
  const fullPath = path25.resolve(projectRoot5, filePath);
  if (!fs23.existsSync(fullPath)) {
    return { success: false, error: "File not found" };
  }
  const ext = path25.extname(fullPath);
  if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    return { success: false, error: "Unsupported file type for AST extraction" };
  }
  try {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(fullPath);
    const exports = {
      functions: sourceFile.getFunctions().map((f) => ({
        name: f.getName() ?? "",
        params: f.getParameters().map((p) => `${p.getName()}: ${p.getType().getText()}`).join(", "),
        returnType: f.getReturnType().getText() || void 0
      })),
      classes: sourceFile.getClasses().map((c) => ({
        name: c.getName() ?? "",
        extends: c.getExtends()?.getText()
      })),
      interfaces: sourceFile.getInterfaces().map((i) => ({
        name: i.getName() ?? ""
      })),
      constants: sourceFile.getVariableStatements().map((v) => {
        const decl = v.getDeclarations()[0];
        return {
          name: decl?.getName() ?? "",
          value: decl?.getInitializer()?.getText()?.slice(0, 80)
        };
      })
    };
    const imports = sourceFile.getImportDeclarations().map((imp) => {
      const def = imp.getDefaultImport();
      const named = imp.getNamedImports().map((n) => n.getName());
      return {
        specifier: imp.getModuleSpecifierValue(),
        default: def?.getText(),
        named: named.length > 0 ? named : void 0
      };
    });
    const topLevelDeclarations = [];
    for (const d of sourceFile.getStatements()) {
      const kind = d.getKindName();
      if (d.getKind() === SyntaxKind.FunctionDeclaration) {
        const fn = d.asKindOrThrow(SyntaxKind.FunctionDeclaration);
        topLevelDeclarations.push(`function ${fn.getName() ?? "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.ClassDeclaration) {
        const cls = d.asKindOrThrow(SyntaxKind.ClassDeclaration);
        topLevelDeclarations.push(`class ${cls.getName() ?? "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.InterfaceDeclaration) {
        const iface = d.asKindOrThrow(SyntaxKind.InterfaceDeclaration);
        topLevelDeclarations.push(`interface ${iface.getName() ?? "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.VariableStatement) {
        const vs = d.asKindOrThrow(SyntaxKind.VariableStatement);
        vs.getDeclarations().forEach((decl) => topLevelDeclarations.push(`const/let ${decl.getName()}`));
      } else {
        topLevelDeclarations.push(kind);
      }
    }
    const payload = JSON.stringify({ exports, imports, topLevelDeclarations });
    const fingerprint = crypto6.createHash("sha256").update(payload).digest("hex").slice(0, 16);
    return {
      success: true,
      output: {
        path: filePath,
        fingerprint,
        exports,
        imports,
        topLevelDeclarations
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ../../src/agent/toolExecutor.ts
var MAX_CONTENT_CHARS = 5e4;
function isInPlanScope(filePath, plan) {
  if (!plan) return { ok: true };
  const norm = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const bases = plan.tasks.map((t) => t.module.replace(/\\/g, "/").replace(/\/+$/, ""));
  const ok = bases.some((b) => norm === b || norm.startsWith(b + "/"));
  if (!ok) {
    return {
      ok: false,
      reason: `Path is outside approved plan scope. Allowed modules: ${bases.join(", ")}`
    };
  }
  return { ok: true };
}
async function executeTool2(tool, input, context) {
  const allowlist = context.allowlist ?? {
    projectRoot: context.rootPath,
    allowedPrefixes: ["src/", "docs/"]
  };
  if (tool === "read_file") {
    const filePath = typeof input.path === "string" ? input.path : "";
    if (!filePath) {
      const out2 = { success: false, output: {}, error: "read_file requires path" };
      emitTrace("read_file", input, out2.output, "read_file failed: missing path");
      return out2;
    }
    const scope = isInPlanScope(filePath, context.plan);
    if (!scope.ok) {
      const out2 = { success: false, output: { reason: scope.reason }, error: scope.reason };
      emitTrace("read_file", input, out2.output, `read_file rejected: ${scope.reason}`);
      return out2;
    }
    const check = checkPathAllowed(filePath, allowlist, "read");
    if (!check.allowed) {
      const out2 = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("read_file", input, out2.output, `read_file rejected: ${check.reason}`);
      return out2;
    }
    const fullPath = path26.resolve(context.rootPath, filePath);
    if (!fs24.existsSync(fullPath)) {
      const out2 = { success: false, output: { path: filePath }, error: "File not found" };
      emitTrace("read_file", input, out2.output, "read_file failed: file not found");
      return out2;
    }
    let content;
    try {
      content = fs24.readFileSync(fullPath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const out2 = { success: false, output: { path: filePath }, error: msg };
      emitTrace("read_file", input, out2.output, `read_file failed: ${msg}`);
      return out2;
    }
    const truncated = content.length > MAX_CONTENT_CHARS;
    const output = {
      path: filePath,
      content: truncated ? content.slice(0, MAX_CONTENT_CHARS) + "\n...[truncated]" : content,
      truncated
    };
    emitTrace("read_file", input, output, truncated ? "read_file ok (truncated)" : "read_file ok");
    return { success: true, output };
  }
  if (tool === "write_file") {
    const filePath = typeof input.path === "string" ? input.path : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (!filePath || !content) {
      const out2 = { success: false, output: {}, error: "write_file requires path and content" };
      emitTrace("write_file", { path: filePath }, out2.output, "write_file failed: missing path or content");
      return out2;
    }
    const scope = isInPlanScope(filePath, context.plan);
    if (!scope.ok) {
      const out2 = { success: false, output: { reason: scope.reason }, error: scope.reason };
      emitTrace("write_file", input, out2.output, `write_file rejected: ${scope.reason}`);
      return out2;
    }
    const check = checkPathAllowed(filePath, allowlist, "write");
    if (!check.allowed) {
      const out2 = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("write_file", input, out2.output, `write_file rejected: ${check.reason}`);
      return out2;
    }
    const fullPath = path26.resolve(context.rootPath, filePath);
    let beforeContent;
    if (fs24.existsSync(fullPath)) {
      beforeContent = fs24.readFileSync(fullPath, "utf-8");
    }
    const stagingId = writeToStaging(filePath, content, { beforeContent, taskId: context.taskId });
    const output = { stagingId, path: filePath };
    emitTrace("write_file", { path: filePath }, output, "write_file ok (staged)");
    return { success: true, output };
  }
  if (tool === "get_ast") {
    const filePath = typeof input.path === "string" ? input.path : "";
    if (!filePath) {
      const out2 = { success: false, output: {}, error: "get_ast requires path" };
      emitTrace("get_ast", input, out2.output, "get_ast failed: missing path");
      return out2;
    }
    const scope = isInPlanScope(filePath, context.plan);
    if (!scope.ok) {
      const out2 = { success: false, output: { reason: scope.reason }, error: scope.reason };
      emitTrace("get_ast", input, out2.output, `get_ast rejected: ${scope.reason}`);
      return out2;
    }
    const check = checkPathAllowed(filePath, allowlist, "read");
    if (!check.allowed) {
      const out2 = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("get_ast", input, out2.output, `get_ast rejected: ${check.reason}`);
      return out2;
    }
    const res = getAst(context.rootPath, filePath);
    if (!res.success || !res.output) {
      const out2 = { success: false, output: { path: filePath }, error: res.error ?? "get_ast failed" };
      emitTrace("get_ast", input, out2.output, `get_ast failed: ${out2.error}`);
      return out2;
    }
    const output = res.output;
    emitTrace("get_ast", input, output, "get_ast ok");
    return { success: true, output };
  }
  if (tool === "run_lint") {
    const paths = Array.isArray(input.paths) ? input.paths : void 0;
    const lintResult = runLint(context.rootPath, paths);
    const output = {
      passed: lintResult.passed,
      errors: lintResult.errors
    };
    emitTrace("run_lint", input, output, lintResult.passed ? "run_lint pass" : "run_lint fail");
    return { success: lintResult.passed, output };
  }
  if (tool === "run_vitest") {
    const pattern = typeof input.pattern === "string" ? input.pattern : void 0;
    const vitestResult = runVitest(context.rootPath, pattern);
    const output = {
      passed: vitestResult.passed,
      summary: vitestResult.summary,
      failures: vitestResult.failures
    };
    emitTrace("run_vitest", input, output, vitestResult.passed ? "run_vitest pass" : "run_vitest fail");
    return { success: vitestResult.passed, output };
  }
  if (tool === "list_files") {
    let walk2 = function(dir) {
      const entries = fs24.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path26.join(dir, entry.name);
        const rel = path26.relative(context.rootPath, abs).replace(/\\/g, "/");
        if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
        if (entry.isDirectory()) {
          walk2(abs);
        } else if (entry.isFile()) {
          const scope = isInPlanScope(rel, context.plan);
          if (!scope.ok) continue;
          const check = checkPathAllowed(rel, allowlist, "read");
          if (!check.allowed) continue;
          results.push(rel);
        }
      }
    };
    var walk = walk2;
    const base = typeof input.base === "string" ? input.base : "";
    const baseRel = base.replace(/\\/g, "/").replace(/^\/+/, "");
    const startDir = path26.resolve(context.rootPath, baseRel || ".");
    const results = [];
    try {
      if (fs24.existsSync(startDir)) {
        walk2(startDir);
      }
      const output = { files: results };
      emitTrace("read_file", input, output, "list_files ok");
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const out2 = { success: false, output: {}, error: msg };
      emitTrace("error", { tool: "list_files", input }, out2.output, msg);
      return out2;
    }
  }
  if (tool === "search_files") {
    let searchFile2 = function(rel, abs) {
      const scope = isInPlanScope(rel, context.plan);
      if (!scope.ok) return;
      const check = checkPathAllowed(rel, allowlist, "read");
      if (!check.allowed) return;
      let content;
      try {
        content = fs24.readFileSync(abs, "utf-8");
      } catch {
        return;
      }
      const lines = content.split(/\r?\n/);
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(query)) {
          matches.push({ line: i + 1, text: lines[i] });
          if (matches.length >= 5) break;
        }
      }
      if (matches.length) {
        results.push({ path: rel, lines: matches });
      }
    }, walk2 = function(dir) {
      if (results.length >= maxMatches) return;
      const entries = fs24.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxMatches) break;
        const abs = path26.join(dir, entry.name);
        const rel = path26.relative(context.rootPath, abs).replace(/\\/g, "/");
        if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
        if (entry.isDirectory()) {
          walk2(abs);
        } else if (entry.isFile()) {
          searchFile2(rel, abs);
        }
      }
    };
    var searchFile = searchFile2, walk = walk2;
    const query = typeof input.query === "string" ? input.query : "";
    const base = typeof input.base === "string" ? input.base : "";
    const baseRel = base.replace(/\\/g, "/").replace(/^\/+/, "");
    const startDir = path26.resolve(context.rootPath, baseRel || ".");
    const maxMatches = typeof input.maxMatches === "number" && input.maxMatches > 0 ? input.maxMatches : 50;
    const results = [];
    if (!query) {
      const out2 = {
        success: false,
        output: {},
        error: "search_files requires query"
      };
      emitTrace("error", { tool: "search_files", input }, out2.output, out2.error);
      return out2;
    }
    try {
      if (fs24.existsSync(startDir)) {
        walk2(startDir);
      }
      const output = { matches: results };
      emitTrace("read_file", input, output, "search_files ok");
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const out2 = { success: false, output: {}, error: msg };
      emitTrace("error", { tool: "search_files", input }, out2.output, msg);
      return out2;
    }
  }
  const out = {
    success: false,
    output: {},
    error: `Tool "${tool}" not implemented`
  };
  emitTrace("error", { tool, input }, {}, `executeTool: ${tool} not implemented`);
  return out;
}

// ../../src/agent/llmClient.ts
import Anthropic4 from "@anthropic-ai/sdk";
var VALID_TOOLS = /* @__PURE__ */ new Set(["write_file", "read_file", "get_ast"]);
var CODE_WRITER_SYSTEM = `You are a code writer.

You MUST use tools to act:
- Use write_file to write or update code.
- Use read_file to read additional files when needed.

Constraints:
- Only operate within the planned task/module scope.
- Do not propose architecture. Do not change rules.
- Prefer minimal, targeted edits that make tests pass.
- Paths must be project-root-relative (e.g. "src/foo/bar.ts").
- When creating new files, create all files listed in the spec.
- When a file spec includes todos, implement them all.`;
var CODE_WRITER_TOOLS = [
  {
    name: "read_file",
    description: "Read a single file's full contents (project-root-relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write a file's full contents (project-root-relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "get_ast",
    description: "Extract imports/exports fingerprint for a file (project-root-relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  }
];
function getTaskFromPlan(plan, taskId) {
  return plan.tasks.find((t) => t.id === taskId);
}
function buildUserMessage(ctx) {
  const lines = [
    `Goal: ${ctx.goal}`,
    `Task: ${ctx.taskId} \u2014 ${ctx.taskModule}`,
    ""
  ];
  if (ctx.projectRoot && ctx.rail?.archetype) {
    const anti = loadAntiPatterns(ctx.projectRoot, ctx.rail.archetype);
    if (anti.length > 0) {
      lines.push("Anti-patterns to avoid (from prior failed rails):");
      for (const p of anti.slice(-6)) {
        lines.push(`- Avoid: ${p.reason}`);
      }
      lines.push("");
    }
  }
  if (ctx.conversationTurns && ctx.conversationTurns.length > 0) {
    lines.push("Recent conversation (most recent last):");
    for (const t of ctx.conversationTurns.slice(-4)) {
      lines.push(`${t.role.toUpperCase()}: ${t.content}`);
    }
    lines.push("");
  }
  const task = getTaskFromPlan(ctx.plan, ctx.taskId);
  if (task?.proposedFiles && task.proposedFiles.length > 0) {
    lines.push("Files to create for this module (implement all of them):");
    for (const f of task.proposedFiles) {
      if (typeof f === "string") {
        lines.push(`- ${f}`);
      } else {
        lines.push(`
### ${f.name}`);
        lines.push(`Purpose: ${f.purpose}`);
        if (f.todos.length > 0) {
          lines.push("Todos:");
          for (const todo of f.todos) {
            lines.push(`  - ${todo}`);
          }
        }
      }
    }
    lines.push("");
  }
  if (ctx.filePath && ctx.fileContent !== void 0) {
    lines.push(`File ${ctx.filePath}:`, "```", ctx.fileContent.slice(0, 3e4), "```", "");
  }
  if (ctx.astSummary) {
    lines.push(
      "Module signals (from get_ast):",
      `- fingerprint: ${ctx.astSummary.fingerprint}`,
      `- imports: ${ctx.astSummary.importCount}`,
      `- exports: functions=${ctx.astSummary.exportFunctionCount}, classes=${ctx.astSummary.exportClassCount}, interfaces=${ctx.astSummary.exportInterfaceCount}, consts=${ctx.astSummary.exportConstCount}`,
      ""
    );
  }
  if (ctx.moduleSignals) {
    const ms = ctx.moduleSignals;
    lines.push(
      "Structural module signals:",
      `- moduleId: ${ms.moduleId}`,
      `- fan-in: ${ms.fanIn}`,
      `- fan-out: ${ms.fanOut}`,
      `- external imports: ${ms.externalImportCount}`,
      `- export count: ${ms.exportCount}`,
      `- file count: ${ms.fileCount}`,
      `- health: ${ms.health}`,
      ms.healthReasons.length ? `- healthReasons: ${ms.healthReasons.join("; ")}` : "",
      ""
    );
  }
  if (ctx.errorOutput) {
    lines.push("Error output (fix these):", ctx.errorOutput, "");
  }
  lines.push(
    "Use write_file for each file you need to create or update. Use read_file if you need to inspect additional context first."
  );
  return lines.join("\n");
}
function validateToolInput(tool, input) {
  if (tool === "read_file" || tool === "get_ast") {
    const p = typeof input.path === "string" ? input.path.trim() : "";
    if (!p) return { ok: false, reason: `${tool} requires non-empty "path" string` };
    if (p.length > 500) return { ok: false, reason: `${tool} path too long` };
    return { ok: true };
  }
  if (tool === "write_file") {
    const p = typeof input.path === "string" ? input.path.trim() : "";
    const c = typeof input.content === "string" ? input.content : "";
    if (!p) return { ok: false, reason: 'write_file requires non-empty "path" string' };
    if (!c) return { ok: false, reason: 'write_file requires non-empty "content" string' };
    if (p.length > 500) return { ok: false, reason: "write_file path too long" };
    return { ok: true };
  }
  return { ok: false, reason: `Unknown tool: ${tool}` };
}
async function callLLM(context) {
  const apiKey = context.apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    const err = "Anthropic API key not configured. Set archVisualizer.anthropicApiKey or ANTHROPIC_API_KEY.";
    emitTrace("error", { role: context.role, goal: context.goal }, { error: err }, err);
    return { type: "no_api_key", error: err };
  }
  const userMsg = buildUserMessage(context);
  const inputForTrace = {
    role: context.role,
    goal: context.goal,
    taskId: context.taskId,
    filePath: context.filePath
  };
  try {
    const client = new Anthropic4({ apiKey });
    let system = CODE_WRITER_SYSTEM;
    let messages = [{ role: "user", content: userMsg }];
    if (context.rail) {
      const railHistory = buildRailContext(
        context.rail,
        context.railHistory ?? [],
        500
      );
      const systemRail = `You are executing rail ${context.rail.id}.
Frozen outcome: ${context.rail.frozenOutcome ?? context.rail.outcome}.
Do not change the outcome; every step must move toward this outcome only.
Do not introduce new goals, alter the specification, or expand scope beyond this rail.
`;
      const systemMessages = railHistory.filter((m) => m.role === "system").map((m) => m.content);
      system = [systemRail, ...systemMessages, CODE_WRITER_SYSTEM].filter(Boolean).join("\n\n");
      const priorTurns = railHistory.filter(
        (m) => m.role === "user" || m.role === "assistant"
      );
      messages = [
        ...priorTurns,
        { role: "user", content: userMsg }
      ];
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      temperature: 0,
      system,
      tools: CODE_WRITER_TOOLS,
      messages
    });
    const usage = response.usage;
    const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    if (context.projectRoot) {
      bumpSessionUsage(context.projectRoot, { tokenUsage: totalTokens, llmCallCount: 1 });
    }
    emitTrace("llm_call", inputForTrace, { tokens: totalTokens }, "Code writer reasoning step");
    const toolUse = response.content.find(
      (b) => b.type === "tool_use"
    );
    if (toolUse) {
      const tool = toolUse.name;
      if (!VALID_TOOLS.has(tool)) {
        emitTrace(
          "error",
          inputForTrace,
          { tool, tokens: totalTokens },
          `Unknown tool: ${tool}`
        );
        return { type: "unknown_output", raw: `Model requested unknown tool: ${tool}` };
      }
      const toolInput = toolUse.input ?? {};
      const ok = validateToolInput(tool, toolInput);
      if (!ok.ok) {
        emitTrace(
          "error",
          inputForTrace,
          { tool, input: toolInput, tokens: totalTokens },
          `Invalid tool call: ${ok.reason}`
        );
        return { type: "unknown_output", raw: `Invalid tool call: ${ok.reason}` };
      }
      emitTrace(
        "llm_call",
        inputForTrace,
        { tool, input: toolInput, tokens: totalTokens },
        `LLM \u2192 ${tool}`
      );
      return { type: "tool_call", tool, input: toolInput };
    }
    const texts = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (response.stop_reason === "end_turn") {
      emitTrace(
        "llm_call",
        inputForTrace,
        { stopReason: response.stop_reason, tokens: totalTokens, text: texts.slice(0, 800) },
        "LLM \u2192 end_turn"
      );
      return { type: "end_turn", content: texts };
    }
    emitTrace(
      "error",
      inputForTrace,
      { stopReason: response.stop_reason, tokens: totalTokens, text: texts.slice(0, 800) },
      "unknown_llm_output"
    );
    return { type: "unknown_output", raw: texts || `stop_reason=${response.stop_reason ?? "unknown"}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitTrace("error", inputForTrace, { error: msg }, `LLM failed: ${msg}`);
    return { type: "unknown_output", raw: msg };
  }
}

// ../../src/agent/taskRunner.ts
var RAIL_TOKEN_BUDGET = typeof process.env.RAIL_TOKEN_BUDGET === "string" && !Number.isNaN(Number(process.env.RAIL_TOKEN_BUDGET)) ? Math.max(1e4, Math.min(18e4, Number(process.env.RAIL_TOKEN_BUDGET))) : 1e5;
var ENTRY_CANDIDATES = ["index.ts", "index.tsx", "index.js", "index.jsx"];
function resolveModuleToFilePath(modulePath, rootPath) {
  const attempted = [];
  const fullDir = path27.resolve(rootPath, modulePath);
  const dirExists = fs25.existsSync(fullDir) && fs25.statSync(fullDir).isDirectory();
  if (dirExists) {
    for (const entry of ENTRY_CANDIDATES) {
      const candidate = path27.join(fullDir, entry);
      attempted.push(path27.relative(rootPath, candidate).replace(/\\/g, "/"));
      if (fs25.existsSync(candidate)) {
        return { path: attempted[attempted.length - 1] };
      }
    }
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${modulePath}${ext}`;
    const full = path27.resolve(rootPath, candidate);
    attempted.push(path27.relative(rootPath, full).replace(/\\/g, "/"));
    if (fs25.existsSync(full)) {
      return { path: attempted[attempted.length - 1] };
    }
  }
  return { error: `Could not resolve module "${modulePath}" to a file`, attempted };
}
async function runTaskAtIndex(plan, taskIndex, rootPath, opts) {
  const task = plan.tasks[taskIndex];
  if (!task) {
    return {
      taskId: "",
      toolResult: {},
      traceId: getSessionId(),
      error: "No task at index"
    };
  }
  const isCreate = task.action === "create";
  const requiresStagingWrite = (task.successChecks ?? []).some((c) => c.kind === "staging_write" && c.required === true) || isCreate;
  let filePath;
  let existingContent;
  let astSummary;
  if (!isCreate) {
    const resolved = resolveModuleToFilePath(task.module, rootPath);
    if ("error" in resolved) {
      return {
        taskId: task.id,
        toolResult: { error: resolved.error, attempted: resolved.attempted },
        traceId: getSessionId(),
        error: `${resolved.error}. Tried: ${resolved.attempted.join(", ")}`
      };
    }
    filePath = resolved.path;
    const readResult = await executeTool2(
      "read_file",
      { path: filePath },
      { rootPath, plan, taskId: task.id }
    );
    if (!readResult.success) {
      return {
        taskId: task.id,
        toolResult: { error: readResult.error, ...readResult.output },
        traceId: getSessionId(),
        error: readResult.error
      };
    }
    existingContent = readResult.output.content;
    const astResult = await executeTool2(
      "get_ast",
      { path: filePath },
      { rootPath, plan, taskId: task.id }
    );
    if (astResult.success) {
      const o = astResult.output;
      astSummary = {
        path: String(o.path ?? filePath),
        fingerprint: String(o.fingerprint ?? ""),
        importCount: Array.isArray(o.imports) ? o.imports.length : 0,
        exportFunctionCount: Array.isArray(o.exports?.functions) ? o.exports.functions.length : 0,
        exportClassCount: Array.isArray(o.exports?.classes) ? o.exports.classes.length : 0,
        exportInterfaceCount: Array.isArray(o.exports?.interfaces) ? o.exports.interfaces.length : 0,
        exportConstCount: Array.isArray(o.exports?.constants) ? o.exports.constants.length : 0
      };
    }
  }
  if (opts?.skipLLM || !opts?.apiKey) {
    return {
      taskId: task.id,
      toolResult: existingContent ? { content: existingContent } : {},
      traceId: getSessionId()
    };
  }
  let hasStaging = false;
  let lastToolResult = {};
  let readHops = 0;
  const MAX_READ_HOPS = 4;
  const MAX_ITER = typeof process.env.AGENT_MAX_ITER === "string" && !Number.isNaN(Number(process.env.AGENT_MAX_ITER)) ? Math.max(1, Math.min(50, Number(process.env.AGENT_MAX_ITER))) : 20;
  let currentFilePath = filePath;
  let currentFileContent = existingContent;
  let currentError = opts?.errorOutput;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (opts?.rail?.id) {
      const telemetry = getRailTelemetry(opts.rail.id);
      if (telemetry.tokenUsage >= RAIL_TOKEN_BUDGET) {
        return {
          taskId: task.id,
          toolResult: lastToolResult,
          traceId: getSessionId(),
          error: `Rail token budget exceeded (${telemetry.tokenUsage}/${RAIL_TOKEN_BUDGET}). Set RAIL_TOKEN_BUDGET to increase.`,
          hasStaging
        };
      }
    }
    const llmResult = await callLLM({
      role: "code_writer",
      goal: plan.goal,
      plan,
      taskId: task.id,
      taskModule: task.module,
      conversationTurns: opts?.conversationTurns,
      fileContent: currentFileContent,
      filePath: currentFilePath,
      astSummary,
      moduleSignals: opts?.moduleSignals,
      errorOutput: currentError,
      projectRoot: rootPath,
      apiKey: opts.apiKey,
      rail: opts?.rail,
      railHistory: opts?.railHistory
    });
    if (llmResult.type === "no_api_key") {
      return {
        taskId: task.id,
        toolResult: lastToolResult,
        traceId: getSessionId(),
        error: llmResult.error,
        hasStaging
      };
    }
    if (llmResult.type === "tool_call" && llmResult.tool === "write_file") {
      const writeResult = await executeTool2("write_file", llmResult.input, {
        rootPath,
        plan,
        taskId: task.id
      });
      if (!writeResult.success) {
        return {
          taskId: task.id,
          toolResult: { error: writeResult.error },
          traceId: getSessionId(),
          error: writeResult.error,
          hasStaging
        };
      }
      hasStaging = true;
      lastToolResult = writeResult.output;
      break;
    }
    if (llmResult.type === "tool_call" && llmResult.tool === "read_file") {
      if (readHops >= MAX_READ_HOPS) {
        return {
          taskId: task.id,
          toolResult: lastToolResult,
          traceId: getSessionId(),
          error: `LLM exceeded ${MAX_READ_HOPS} read_file calls without writing`,
          hasStaging
        };
      }
      readHops++;
      const pathToRead = typeof llmResult.input.path === "string" ? llmResult.input.path : "";
      if (pathToRead) {
        const secondRead = await executeTool2(
          "read_file",
          { path: pathToRead },
          { rootPath, plan, taskId: task.id }
        );
        currentFilePath = pathToRead;
        currentFileContent = secondRead.success ? secondRead.output.content : `[Error reading ${pathToRead}: ${secondRead.error}]`;
        lastToolResult = secondRead.success ? secondRead.output : { error: secondRead.error };
      }
      continue;
    }
    if (llmResult.type === "tool_call" && llmResult.tool === "get_ast") {
      const pathToRead = typeof llmResult.input.path === "string" ? llmResult.input.path : "";
      if (pathToRead) {
        const r = await executeTool2("get_ast", { path: pathToRead }, { rootPath, plan, taskId: task.id });
        lastToolResult = r.success ? r.output : { error: r.error };
      }
      continue;
    }
    if (llmResult.type === "end_turn") {
      lastToolResult = { note: llmResult.content };
      break;
    }
    if (llmResult.type === "unknown_output") {
      currentError = `Invalid or unparseable model output. Produce only a tool call (read_file/write_file/get_ast) or end_turn.

Output:
${llmResult.raw}`;
      lastToolResult = { raw: llmResult.raw };
      continue;
    }
    lastToolResult = { raw: llmResult.raw };
    break;
  }
  const final = {
    taskId: task.id,
    toolResult: lastToolResult,
    traceId: getSessionId(),
    hasStaging
  };
  if (requiresStagingWrite && !hasStaging) {
    final.error = `Task ${task.id} ended without producing a staging write.`;
  }
  return final;
}

// ../../src/agent/taskClassifier.ts
var AUTO_CAPABLE_KINDS = /* @__PURE__ */ new Set([
  "code_change",
  "verification",
  "lint",
  "test",
  "playwright"
]);
var HITL_PATTERNS = [
  /human.?review|approval|sign.?off|confirm|manual/i,
  /security|auth|credential|secret|production/i,
  /delete|remove|destroy|drop/i,
  /deploy|release|publish/i
];
function classifyTaskAutoCapable(task) {
  if (task.autoCapable === false) return false;
  if (task.autoCapable === true) return true;
  if (!AUTO_CAPABLE_KINDS.has(task.kind)) return false;
  const desc = (task.description ?? "").toLowerCase();
  if (HITL_PATTERNS.some((p) => p.test(desc))) return false;
  return true;
}
function partitionTasksByCapability(tasks2) {
  const autoCapable = [];
  const hitlRequired = [];
  for (const t of tasks2) {
    if (classifyTaskAutoCapable(t)) autoCapable.push(t);
    else hitlRequired.push(t);
  }
  return { autoCapable, hitlRequired };
}

// ../../src/agent/runPlaywrightTrace.ts
import * as path28 from "path";
import * as fs26 from "fs";
import { spawnSync as spawnSync4 } from "child_process";
var STAGING_TRACES = ".arch-agent-staging/traces";
function discoverPlaywrightSpecs(projectRoot5) {
  const candidates = [];
  const roots = ["tests", "playwright", "e2e"];
  const exts = [".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx", ".test.ts", ".test.js"];
  const seen = /* @__PURE__ */ new Set();
  function walk(dir, depth) {
    if (depth <= 0) return;
    let entries;
    try {
      entries = fs26.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path28.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth - 1);
      } else {
        if (exts.some((ext) => e.name.endsWith(ext))) {
          const rel = path28.relative(projectRoot5, full).replace(/\\/g, "/");
          if (!seen.has(rel)) {
            seen.add(rel);
            candidates.push(rel);
          }
        }
      }
    }
  }
  for (const root of roots) {
    const full = path28.join(projectRoot5, root);
    if (fs26.existsSync(full) && fs26.statSync(full).isDirectory()) {
      walk(full, 4);
    }
  }
  return candidates.sort();
}
function parseSpecForRoutes(projectRoot5, specPath) {
  const full = path28.join(projectRoot5, specPath);
  const routes = [];
  const modules = [];
  const rel = specPath.replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  if (parts.length >= 2) {
    modules.push(parts[0]);
    if (parts.length >= 3) modules.push(parts.slice(0, 2).join("/"));
  }
  try {
    const content = fs26.readFileSync(full, "utf-8");
    const gotoMatches = content.matchAll(
      /page\.goto\s*\(\s*[`'"](\/[^`'"]*)[`'"]\s*\)/g
    );
    for (const m of gotoMatches) {
      const route = m[1]?.split("?")[0]?.replace(/\/$/, "") ?? "";
      if (route && !routes.includes(route)) routes.push(route);
    }
    const routeLike = content.matchAll(/[`'"](\/[a-zA-Z0-9/_-]+)[`'"]/g);
    for (const m of routeLike) {
      const r = m[1];
      if (r && r.startsWith("/") && r.length > 1 && !routes.includes(r)) {
        routes.push(r);
      }
    }
  } catch {
  }
  return { spec: specPath, routes, modules };
}
function discoverPlaywrightSpecMappings(projectRoot5) {
  const specs = discoverPlaywrightSpecs(projectRoot5);
  return specs.map((s) => parseSpecForRoutes(projectRoot5, s));
}
function mapSpecsToScope(projectRoot5, options) {
  if (!options?.nodeIds?.length && !options?.routes?.length) {
    return discoverPlaywrightSpecs(projectRoot5);
  }
  const mappings = discoverPlaywrightSpecMappings(projectRoot5);
  const nodeIds = new Set(
    (options.nodeIds ?? []).map((n) => n.replace(/\/$/, ""))
  );
  const routes = new Set(
    (options.routes ?? []).map((r) => r.replace(/\/$/, ""))
  );
  const matched = /* @__PURE__ */ new Set();
  for (const m of mappings) {
    const moduleMatch = nodeIds.size === 0 || m.modules.some(
      (mod) => Array.from(nodeIds).some((n) => mod.includes(n) || n.includes(mod))
    );
    const routeMatch = routes.size === 0 || m.routes.some(
      (r) => Array.from(routes).some((rt) => r === rt || r.startsWith(rt + "/"))
    );
    if (moduleMatch || routeMatch) {
      matched.add(m.spec);
    }
  }
  if (matched.size > 0) return [...matched].sort();
  return discoverPlaywrightSpecs(projectRoot5);
}
function collectFailures(suites, tracesDir, traceId) {
  const failures = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === "failed") {
            const screenPath = result.attachments?.find((a) => a.name === "screenshot")?.path ?? path28.join(tracesDir, `${traceId}.png`);
            failures.push({
              testName: spec.title ?? test.title ?? "unknown",
              error: result.error?.message ?? "Test failed",
              screenshotPath: screenPath,
              domSnapshot: "",
              consoleErrors: [],
              networkFailures: []
            });
          }
        }
      }
    }
  }
  return failures;
}
function runPlaywrightTrace(projectRoot5, specPath, url, workingDir) {
  const cwd = workingDir ?? projectRoot5;
  const tracesDir = path28.join(cwd, STAGING_TRACES);
  if (!fs26.existsSync(path28.dirname(tracesDir))) {
    fs26.mkdirSync(path28.dirname(tracesDir), { recursive: true });
  }
  if (!fs26.existsSync(tracesDir)) {
    fs26.mkdirSync(tracesDir, { recursive: true });
  }
  const traceId = `pw_${Date.now()}`;
  const tracePath = path28.join(tracesDir, `${traceId}.zip`);
  const jsonOut = path28.join(tracesDir, `${traceId}-results.json`);
  const args = ["playwright", "test", specPath, "--reporter=json"];
  const proc = spawnSync4("npx", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      APP_URL: url,
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut
    },
    maxBuffer: 10 * 1024 * 1024
  });
  const failures = [];
  let passed = proc.status === 0;
  try {
    const raw = fs26.existsSync(jsonOut) ? fs26.readFileSync(jsonOut, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    const suites = parsed?.suites ?? [];
    const collected = collectFailures(suites ?? [], tracesDir, traceId);
    if (collected.length > 0) {
      passed = false;
      failures.push(...collected);
    }
    try {
      fs26.unlinkSync(jsonOut);
    } catch {
    }
  } catch {
    if (proc.status !== 0) {
      passed = false;
      failures.push({
        testName: path28.basename(specPath),
        error: (proc.stderr ?? proc.stdout ?? "Playwright failed").slice(0, 500),
        screenshotPath: path28.join(tracesDir, `${traceId}.png`),
        domSnapshot: "",
        consoleErrors: [],
        networkFailures: []
      });
    }
  }
  return {
    passed,
    spec: specPath,
    failures,
    tracePath
  };
}
async function runPlaywrightForRail(railId, projectRoot5, sandboxPath, specs, baseUrl) {
  let allPassed = true;
  const allFailures = [];
  let lastTracePath = "";
  for (const spec of specs) {
    const result = runPlaywrightTrace(projectRoot5, spec, baseUrl, sandboxPath);
    allFailures.push(...result.failures);
    if (!result.passed) {
      allPassed = false;
    }
    lastTracePath = result.tracePath;
    emitTrace({
      role: "reviewer",
      type: result.passed ? "info" : "error",
      message: result.passed ? `Playwright spec ${spec} passed for rail ${railId}` : `Playwright spec ${spec} failed for rail ${railId}`,
      railId,
      metadata: {
        filePath: spec
      }
    });
  }
  return {
    passed: allPassed,
    spec: specs.join(", "),
    failures: allFailures,
    tracePath: lastTracePath
  };
}

// ../../src/agent/verificationPipeline.ts
async function runVerificationPipeline(opts) {
  const { projectRoot: projectRoot5, sandboxPath, railId, baseUrl, specPaths, scope } = opts;
  const url = baseUrl ?? process.env.APP_URL ?? "http://127.0.0.1:4173";
  const lint = runLint(projectRoot5, void 0, sandboxPath);
  const vitest = runVitest(projectRoot5, void 0, sandboxPath);
  const specs = specPaths ?? (scope ? mapSpecsToScope(projectRoot5, scope) : discoverPlaywrightSpecs(projectRoot5));
  let playwright = null;
  if (specs.length > 0) {
    playwright = await runPlaywrightForRail(
      railId ?? "verify",
      projectRoot5,
      sandboxPath,
      specs,
      url
    );
  }
  const passed = lint.passed && vitest.passed && (!playwright || playwright.passed);
  const errorParts = [];
  if (!lint.passed) {
    errorParts.push(
      `Lint errors (${lint.errors.length}):
${lint.errors.slice(0, 8).map((e) => `  ${e.filePath}:${e.line}:${e.column} - ${e.message}`).join("\n")}`
    );
  }
  if (!vitest.passed) {
    errorParts.push(
      `Vitest failures (${vitest.failures.length}):
${vitest.failures.slice(0, 5).map((f) => `  ${f.testName} (${f.filePath}): ${f.error.slice(0, 200)}`).join("\n")}`
    );
  }
  if (playwright && !playwright.passed) {
    errorParts.push(
      `Playwright failures:
${playwright.failures.slice(0, 5).map((f) => `  ${f.testName}: ${f.error.slice(0, 200)}`).join("\n")}`
    );
  }
  const errorFeedback = errorParts.join("\n\n");
  return {
    passed,
    lint,
    vitest,
    playwright,
    errorFeedback
  };
}

// src/sandboxDiffSummary.ts
import * as fs27 from "fs";
import * as path29 from "path";
function computeSandboxDiffSummary(root, railId) {
  const sandboxPath = getSandboxPath(root, railId);
  if (!fs27.existsSync(sandboxPath)) {
    return { changedFiles: 0, totalBytes: 0, files: [], summary: "No sandbox changes." };
  }
  const files = [];
  let totalBytes = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs27.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path29.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path29.relative(sandboxPath, full).replace(/\\/g, "/");
      if (!rel) continue;
      const rootFile = path29.join(root, rel);
      let before = "";
      let after = "";
      const isNew = !fs27.existsSync(rootFile);
      try {
        if (!isNew && fs27.statSync(rootFile).isFile()) {
          before = fs27.readFileSync(rootFile, "utf-8");
        }
      } catch {
      }
      try {
        after = fs27.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      if (before === after) continue;
      const beforeLines = before ? before.split("\n").length : 0;
      const afterLines = after ? after.split("\n").length : 0;
      const added = Math.max(0, afterLines - beforeLines);
      const removed = Math.max(0, beforeLines - afterLines);
      files.push({ path: rel, added, removed, isNew });
      totalBytes += Buffer.byteLength(after, "utf-8");
    }
  };
  try {
    walk(sandboxPath);
  } catch {
    return { changedFiles: 0, totalBytes: 0, files: [], summary: "Could not read sandbox." };
  }
  const summary = files.length === 0 ? "No file changes detected." : files.slice(0, 12).map(
    (f) => f.isNew ? `${f.path} (new, ~${f.added} lines)` : `${f.path} (+${f.added} -${f.removed} lines)`
  ).join("; ") + (files.length > 12 ? ` \u2026 +${files.length - 12} more` : "");
  return { changedFiles: files.length, totalBytes, files, summary };
}

// src/debugLog.ts
import * as fs28 from "fs";
var LOG_PATH = "/Users/ojrichard/Architect/arch-visualizer/.cursor/debug-2a19a3.log";
function debugLog(entry) {
  try {
    const line = JSON.stringify({
      sessionId: "2a19a3",
      timestamp: Date.now(),
      ...entry
    });
    fs28.appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch {
  }
}

// src/railExecute.ts
var workspaceExecutionCounts = /* @__PURE__ */ new Map();
var MAX_CONCURRENT_PER_WORKSPACE = typeof process.env.RAIL_MAX_CONCURRENT === "string" && !Number.isNaN(Number(process.env.RAIL_MAX_CONCURRENT)) ? Math.max(1, Number(process.env.RAIL_MAX_CONCURRENT)) : 1;
async function resolveRootFromWorkspace(workspaceId, ownerId) {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin.from("workspaces").select("project_root").eq("id", workspaceId).eq("owner_id", ownerId).maybeSingle();
    if (error || !data) return null;
    const pr = data.project_root;
    return typeof pr === "string" && pr.trim() ? path30.resolve(pr.trim()) : null;
  } catch {
    return null;
  }
}
async function triggerRailExecution(railId, workspaceId, userId, broadcast) {
  const currentExec = workspaceExecutionCounts.get(workspaceId) ?? 0;
  if (currentExec >= MAX_CONCURRENT_PER_WORKSPACE) {
    throw new Error("Execution limit reached for this workspace. Try again later.");
  }
  let root = await resolveRootFromWorkspace(workspaceId, userId);
  if (!root && supabaseAdmin) {
    const { data: gr } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const graph = gr?.graph_json ?? { nodes: [], edges: [], generatedAt: Date.now(), projectRoot: "" };
    const repoUrl = gr?.repo_url ?? null;
    const { rootPath, error } = await ensureProjectRoot(workspaceId, graph, repoUrl);
    if (rootPath !== null) root = rootPath;
    else throw new Error(error || "Workspace has no project_root. Please scan the repository first.");
  }
  if (!root) throw new Error("Workspace has no project_root.");
  loadRails(root);
  const rail = getRail(root, railId);
  if (!rail) throw new Error("Rail not found.");
  if (rail.archetype !== "analysis-chat") {
    throw new Error("Only analysis-chat rails can be executed.");
  }
  const codeTasks = (rail.tasks ?? []).filter(
    (t) => t.kind === "code_change" && classifyTaskAutoCapable(t)
  );
  if (codeTasks.length === 0) {
    throw new Error("Rail has no code_change tasks to run.");
  }
  if (!["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(rail.state)) {
    throw new Error(
      `Rail must be in PRE_PLANNING, PLANNING, or AWAITING_APPROVAL. Current: ${rail.state}`
    );
  }
  const bgTask = createTask2();
  setTaskRunning(bgTask.taskId);
  workspaceExecutionCounts.set(workspaceId, currentExec + 1);
  const sandboxPath = ensureSandbox(root, rail.id);
  const paths = (rail.logicPath ?? []).map(
    (s) => typeof s === "object" && s && "filePath" in s && typeof s.filePath === "string" ? s.filePath : String(s)
  ).filter(Boolean);
  const syncPaths = paths.length > 0 ? paths : ["src"];
  syncSandboxFromRoot(root, rail.id, syncPaths);
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const goal = rail.outcome ?? rail.trigger?.userMessage ?? "Analysis rail";
  const plan = {
    goal,
    tasks: codeTasks.map((t, i) => ({
      id: t.id,
      module: rail.logicPath?.[i]?.filePath ?? `step-${i + 1}`,
      layer: rail.logicPath?.[i]?.layer ?? "Service",
      action: "modify",
      expectedOutput: t.description ?? `Step ${i + 1}`
    })),
    dependencies: []
  };
  for (let i = 0; i < plan.tasks.length - 1; i++) {
    plan.dependencies.push([plan.tasks[i].id, plan.tasks[i + 1].id]);
  }
  Promise.resolve().then(async () => {
    if (isTaskCancelled(bgTask.taskId)) return;
    const current = getRail(root, railId);
    if (current && (current.state === "PRE_PLANNING" || current.state === "PLANNING")) {
      transitionRail(root, railId, "AWAITING_APPROVAL");
    }
    const tr = transitionRail(root, railId, "EXECUTING", { planApproved: true });
    if (!tr.ok) {
      setTaskFailed(bgTask.taskId, tr.error ?? "Invalid transition.");
      return;
    }
    const attemptHistory = [];
    const maxSelfCorrect = rail.telemetry?.retryLimit ?? (typeof process.env.RAIL_SELF_CORRECT_MAX === "string" && !Number.isNaN(Number(process.env.RAIL_SELF_CORRECT_MAX)) ? Math.max(0, Math.min(5, Number(process.env.RAIL_SELF_CORRECT_MAX))) : 2);
    let lastVerificationFeedback;
    let verification = null;
    let attempt = 0;
    while (attempt <= maxSelfCorrect && !isTaskCancelled(bgTask.taskId)) {
      for (let idx = 0; idx < plan.tasks.length && !isTaskCancelled(bgTask.taskId); idx++) {
        const railTask = codeTasks[idx];
        if (railTask) updateTaskStatus(railTask.id, "executing");
        const result = await runTaskAtIndex(plan, idx, sandboxPath, {
          apiKey,
          errorOutput: lastVerificationFeedback,
          rail,
          railHistory: attemptHistory
        });
        if (result.error) {
          attemptHistory.push({
            role: "assistant",
            content: `Task ${railTask?.id ?? idx} error: ${result.error}`
          });
          if (/token budget exceeded|Token budget exceeded/i.test(result.error)) {
            setTaskFailed(bgTask.taskId, result.error);
            transitionRail(root, railId, "FAILED");
            return;
          }
        }
        if (railTask) updateTaskStatus(railTask.id, "completed");
      }
      const nodeIds = (rail.logicPath ?? []).map((s) => typeof s === "object" && s && "nodeId" in s && typeof s.nodeId === "string" ? s.nodeId : null).filter((x) => !!x);
      verification = await runVerificationPipeline({
        projectRoot: root,
        sandboxPath,
        railId: rail.id,
        baseUrl: process.env.APP_URL || "http://127.0.0.1:4173",
        scope: nodeIds.length > 0 ? { nodeIds } : void 0
      });
      const passed2 = verification.passed;
      lastVerificationFeedback = verification.errorFeedback || void 0;
      if (passed2) break;
      attempt++;
    }
    const { passed, lint, vitest, playwright: playwrightResult } = verification ?? {
      passed: false,
      lint: { passed: false, errors: [] },
      vitest: { passed: false, summary: { total: 0, passed: 0, failed: 0, skipped: 0 }, failures: [] },
      playwright: null
    };
    const errorOutput = lastVerificationFeedback ?? "Verification failed.";
    const verificationTaskId = `verify-${Date.now()}`;
    createTask({
      id: verificationTaskId,
      railId: rail.id,
      kind: "verification",
      description: "Lint + Vitest in sandbox",
      files: [],
      autoCapable: true,
      status: passed ? "completed" : "rejected",
      agent: "reviewer",
      logicStep: 0,
      createdAt: Date.now(),
      resolvedAt: Date.now()
    });
    updateTaskEvidence(verificationTaskId, JSON.stringify({ lint, vitest, playwright: playwrightResult }));
    const attemptNumber = (rail.telemetry?.retryCount ?? 0) + 1;
    const attemptSummary = passed ? "Verification passed." : errorOutput || "Verification failed.";
    updateRailPartial(root, railId, {
      lastCritique: {
        source: passed ? "test" : "lint",
        message: passed ? "Lint, Vitest, and Playwright passed." : errorOutput || "Verification failed.",
        createdAt: Date.now(),
        attempt: attemptNumber,
        totalAttempts: rail.telemetry?.retryLimit ?? 1
      },
      telemetry: {
        ...rail.telemetry ?? {},
        retryCount: (rail.telemetry?.retryCount ?? 0) + (passed ? 0 : 1)
      },
      attemptHistory: [
        ...rail.attemptHistory ?? [],
        { timestamp: Date.now(), summary: attemptSummary.slice(0, 5e3) }
      ]
    });
    const toState = passed ? "VERIFYING" : "SELF_CORRECTING";
    transitionRail(root, railId, toState);
    setTaskCompleted(bgTask.taskId, {
      message: passed ? "Verification passed. You can approve materialization." : "Verification failed. Review failures in rail detail.",
      railId: rail.id,
      verificationPassed: passed,
      lint: { passed: lint.passed, errors: lint.errors.length },
      vitest: { passed: vitest.passed, failures: vitest.failures.length },
      playwright: playwrightResult ? { passed: playwrightResult.passed, failures: playwrightResult.failures.length } : null
    });
    const diff = computeSandboxDiffSummary(root, rail.id);
    await appendTodoSessionLogByRailId(rail.id, "ready_to_review", {
      verificationPassed: passed,
      files_changed: diff.files.map((f) => f.path),
      summary: diff.summary,
      changed_files: diff.changedFiles,
      total_bytes: diff.totalBytes,
      files: diff.files.slice(0, 20)
    });
    debugLog({
      hypothesisId: "H4",
      location: "railExecute.ts:needs_review",
      message: "ready_to_review diff appended",
      data: {
        railId: rail.id,
        passed,
        changedFiles: diff.changedFiles,
        summary: diff.summary.slice(0, 200)
      }
    });
    await setTodoStatusByRailId(rail.id, "needs_review", {
      verificationPassed: passed
    });
    if (!passed) {
      await appendTodoSessionLogByRailId(rail.id, "verification_failed", {
        error: errorOutput?.slice(0, 2e3)
      });
    }
    if (supabaseAdmin && workspaceId) {
      try {
        await supabaseAdmin.from("workspace_memories").insert({
          workspace_id: workspaceId,
          content: passed ? `Rail ${rail.id} verification passed. Outcome: ${rail.outcome ?? ""}` : `Rail ${rail.id} verification failed. See lint, vitest, and Playwright results.`,
          memory_type: "rail_result",
          rail_id: rail.id
        });
      } catch {
      }
    }
    if (!passed && workspaceId && broadcast) {
      broadcast(workspaceId, { type: "rail_hitl", railId: rail.id, reason: "verification_failed" });
    }
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    setTaskFailed(bgTask.taskId, msg);
    updateRailPartial(root, railId, {
      lastCritique: { source: "unknown", message: msg, createdAt: Date.now() }
    });
    void appendTodoSessionLogByRailId(railId, "error", { message: msg });
    void setTodoStatusByRailId(railId, "todo", { failed: true });
  }).finally(() => {
    const cur = workspaceExecutionCounts.get(workspaceId) ?? 0;
    const next = Math.max(0, cur - 1);
    if (next === 0) workspaceExecutionCounts.delete(workspaceId);
    else workspaceExecutionCounts.set(workspaceId, next);
    if (broadcast) broadcast(workspaceId, { type: "rail_execute_complete", railId });
  });
  return { taskId: bgTask.taskId };
}

// src/railMaterializeCore.ts
import * as fs29 from "fs";
import * as path31 from "path";
function walkDir2(dir, base, maxDepth) {
  const out = [];
  if (maxDepth <= 0) return out;
  try {
    const entries = fs29.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path31.relative(base, path31.join(dir, e.name));
      if (e.isDirectory()) {
        out.push(rel + "/");
        out.push(...walkDir2(path31.join(dir, e.name), base, maxDepth - 1));
      } else {
        out.push(rel);
      }
    }
  } catch {
  }
  return out;
}
function materializeAnalysisRail(root, railId) {
  loadRails(root);
  const rail = getRail(root, railId);
  if (!rail) {
    return { ok: false, error: "Rail not found.", status: 404 };
  }
  if (rail.archetype === "greenfield-materialize") {
    return { ok: false, error: "Use greenfield materialize for this rail.", status: 400 };
  }
  const verifTasks = (rail.tasks ?? []).filter((t) => t.kind === "verification");
  const passed = verifTasks.length > 0 && verifTasks.every((t) => t.status === "completed");
  if (!passed) {
    return {
      ok: false,
      error: "Verification has not passed yet.",
      status: 409
    };
  }
  const sandboxPath = getSandboxPath(root, railId);
  if (!fs29.existsSync(sandboxPath)) {
    return { ok: false, error: "Sandbox not found for this rail.", status: 400 };
  }
  const relFiles = walkDir2(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
  const copied = [];
  for (const rel of relFiles) {
    const srcFile = path31.join(sandboxPath, rel);
    const rootFile = path31.join(root, rel);
    try {
      const dir = path31.dirname(rootFile);
      if (!fs29.existsSync(dir)) fs29.mkdirSync(dir, { recursive: true });
      fs29.writeFileSync(rootFile, fs29.readFileSync(srcFile, "utf-8"), "utf-8");
      copied.push(rel);
    } catch {
    }
  }
  const toMat = transitionRail(root, railId, "MATERIALIZING", { reviewerPassed: true });
  if (!toMat.ok || !toMat.rail) {
    return { ok: false, error: toMat.error ?? "Failed to enter MATERIALIZING.", status: 500 };
  }
  updateRailState(root, railId, toMat.rail.state);
  const tr = transitionRail(root, railId, "ARCHIVED", { materializationApproved: true });
  if (!tr.ok || !tr.rail) {
    return { ok: false, error: tr.error ?? "Failed to archive rail.", status: 500 };
  }
  updateRailState(root, railId, tr.rail.state);
  return { ok: true, rail: tr.rail };
}

// src/todoPhase1.ts
var PHASE1_STATUSES = ["todo", "in_progress", "needs_review", "done"];
var TRANSITIONS = {
  todo: ["in_progress"],
  in_progress: ["needs_review", "todo"],
  needs_review: ["done", "in_progress", "todo"],
  done: []
};
function normalizeTodoStatus(status) {
  if (status === "pending") return "todo";
  if (status === "completed") return "done";
  if (PHASE1_STATUSES.includes(status)) return status;
  return "todo";
}
function canTransitionTodo(from, to) {
  const f = normalizeTodoStatus(from);
  const t = normalizeTodoStatus(to);
  return TRANSITIONS[f].includes(t);
}
function isDependencyDone(status) {
  const s = normalizeTodoStatus(status);
  return s === "done";
}
function buildTaskAgentPrompt(row) {
  const parts = [];
  if (row.context?.trim()) parts.push(`## Context
${row.context.trim()}`);
  if (row.constraints?.trim()) parts.push(`## Constraints
${row.constraints.trim()}`);
  const ac = row.acceptance_criteria;
  if (ac && typeof ac === "object") {
    const fn = Array.isArray(ac.functional) ? ac.functional.filter(Boolean) : [];
    const tech = Array.isArray(ac.technical) ? ac.technical.filter(Boolean) : [];
    if (fn.length || tech.length) {
      parts.push(
        `## Acceptance criteria
${[...fn, ...tech].map((x) => `- ${x}`).join("\n")}`
      );
    }
  }
  if (row.file_scope?.length) {
    parts.push(`## File scope
${row.file_scope.map((p) => `- ${p}`).join("\n")}`);
  }
  if (row.description?.trim()) parts.push(`## Notes
${row.description.trim()}`);
  return parts.join("\n\n") || String(row.title ?? "Task");
}

// src/todos.ts
var router6 = Router6();
var AUTO_EXEC_WINDOW_MS = 10 * 6e4;
var AUTO_EXEC_MAX_PER_WINDOW = 10;
var autoExecCounters = /* @__PURE__ */ new Map();
async function completeTodosForRail(railId) {
  if (!supabaseAdmin) return;
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const { data: rows } = await supabaseAdmin.from("todos").select("id, workspace_id").eq("rail_id", railId);
    await supabaseAdmin.from("todos").update({ status: "done", updated_at: now }).eq("rail_id", railId);
    for (const row of rows ?? []) {
      await appendTodoSessionLog(row.id, "done", { railId });
    }
    if (rows && rows.length > 0) {
      const workspaceId = rows[0].workspace_id;
      if (workspaceId) {
        await supabaseAdmin.rpc("unlock_todos_for_workspace", {
          p_workspace_id: workspaceId
        });
      }
    }
  } catch {
  }
}
router6.get("/todos", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const includeArchived = req.query.includeArchived === "true" || req.query.includeArchived === "1";
  let query = supabaseAdmin.from("todos").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (!includeArchived) {
    query = query.is("archived_at", null);
  }
  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ todos: data ?? [] });
});
router6.post("/todos", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.body?.workspaceId?.trim();
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : null;
  const phase = typeof req.body?.phase === "number" ? req.body.phase : typeof req.body?.phase === "string" ? parseInt(req.body.phase, 10) || null : null;
  const dependsOn = Array.isArray(req.body?.dependsOn) ? req.body.dependsOn.filter((x) => typeof x === "string" && x.trim()) : [];
  if (!workspaceId || !title) {
    res.status(400).json({ error: "workspaceId and title are required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (dependsOn.length) {
    const { data: deps, error: depsErr } = await supabaseAdmin.from("todos").select("id, status, depends_on").in("id", dependsOn).eq("workspace_id", workspaceId);
    if (depsErr) {
      res.status(500).json({ error: depsErr.message });
      return;
    }
    if (!deps || deps.length !== dependsOn.length) {
      res.status(400).json({ error: "One or more dependency todos do not exist in this workspace." });
      return;
    }
    const { data: allRows } = await supabaseAdmin.from("todos").select("id, depends_on").eq("workspace_id", workspaceId);
    const byId = new Map((allRows ?? []).map((r) => [r.id, { depends_on: r.depends_on ?? null }]));
    if (hasDependsOnCycle("_new_", dependsOn, byId)) {
      res.status(400).json({ error: "Circular dependency in dependsOn." });
      return;
    }
  }
  const { data, error } = await supabaseAdmin.from("todos").insert({
    workspace_id: workspaceId,
    title,
    description,
    phase,
    depends_on: dependsOn.length ? dependsOn : null,
    status: "todo",
    context: typeof req.body?.context === "string" ? req.body.context.trim() : null,
    constraints: typeof req.body?.constraints === "string" ? req.body.constraints.trim() : null,
    acceptance_criteria: req.body?.acceptanceCriteria && typeof req.body.acceptanceCriteria === "object" ? req.body.acceptanceCriteria : null,
    file_scope: Array.isArray(req.body?.fileScope) ? req.body.fileScope.filter((x) => typeof x === "string" && x.trim()) : null,
    session_log: [],
    source: req.body?.source ?? null,
    source_path: req.body?.sourcePath ?? null
  }).select("*").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ todo: data });
});
function hasDependsOnCycle(nodeId, proposedDependsOn, byId) {
  const graph = new Map(byId);
  graph.set(nodeId, { depends_on: proposedDependsOn });
  const visited = /* @__PURE__ */ new Set();
  const stack = /* @__PURE__ */ new Set();
  function visit(n) {
    if (stack.has(n)) return true;
    if (visited.has(n)) return false;
    visited.add(n);
    stack.add(n);
    const deps = graph.get(n)?.depends_on ?? [];
    for (const d of deps) {
      if (d === nodeId || visit(d)) return true;
    }
    stack.delete(n);
    return false;
  }
  return visit(nodeId);
}
router6.get("/todos/dependencies/ready", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("todos").select("id, depends_on, status").eq("workspace_id", workspaceId).is("archived_at", null);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const rows = data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ready = [];
  for (const row of rows) {
    if (row.status !== "pending") continue;
    const deps = row.depends_on ?? [];
    if (deps.every((id) => {
      const dep = byId.get(id);
      return dep && isDependencyDone(dep.status);
    })) {
      ready.push(row.id);
    }
  }
  res.json({ ready });
});
async function resolveWorkspaceRoot(workspaceId, userId) {
  const { data: graphRow } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const graph = graphRow?.graph_json ?? null;
  const repoUrl = graphRow?.repo_url ?? null;
  const { rootPath, error } = await ensureProjectRoot(
    workspaceId,
    graph ?? { nodes: [], edges: [] },
    repoUrl
  );
  if (rootPath) return { root: rootPath, repoUrl };
  return { error: error || "Workspace has no project_root; scan a repo first." };
}
router6.post("/todos/:id/run", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  try {
    const { data: row } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).maybeSingle();
    if (!row) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    const workspaceId = row.workspace_id;
    const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
    if (!ws) {
      res.status(403).json({ error: "Access denied." });
      return;
    }
    const status = normalizeTodoStatus(row.status);
    if (status !== "todo") {
      res.status(400).json({ error: `Task must be todo to run (current: ${status}).` });
      return;
    }
    const memories = await getMemoriesForContext(supabaseAdmin, workspaceId, {});
    const memoryBlock = buildMemoryContextBlock(memories, [], []);
    await supabaseAdmin.from("todos").update({ status: "in_progress", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", todoId);
    await appendTodoSessionLog(todoId, "started", {
      title: row.title,
      context: row.context,
      constraints: row.constraints,
      file_scope: row.file_scope,
      memories_preview: memoryBlock.slice(0, 1500)
    });
    const { railId } = await todoToRailCore(todoId, req.user.id, memoryBlock);
    const { taskId } = await triggerRailExecution(railId, workspaceId, req.user.id);
    await appendTodoSessionLog(todoId, "execute_triggered", { railId, taskId });
    const { data: updated } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).single();
    res.json({ todo: updated, railId, taskId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendTodoSessionLog(todoId, "error", { message: msg });
    res.status(500).json({ error: msg });
  }
});
router6.post("/todos/:id/approve", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  const force = req.body?.force === true;
  try {
    const { data: row } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).maybeSingle();
    if (!row) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    const status = normalizeTodoStatus(row.status);
    if (status !== "needs_review") {
      res.status(400).json({ error: `Task must be needs_review to approve (current: ${status}).` });
      return;
    }
    const railId = row.rail_id;
    if (!railId) {
      res.status(400).json({ error: "Task has no linked rail." });
      return;
    }
    const workspaceId = row.workspace_id;
    const resolved = await resolveWorkspaceRoot(workspaceId, req.user.id);
    if ("error" in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    void force;
    const result = materializeAnalysisRail(resolved.root, railId);
    if (!result.ok) {
      res.status(result.status ?? 500).json({ error: result.error });
      return;
    }
    await completeTodosForRail(railId);
    await appendTodoSessionLog(todoId, "approved", { railId, copied: true });
    const { data: updated } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).single();
    res.json({ todo: updated, rail: result.rail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router6.post("/todos/:id/reject", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  const backTo = req.body?.backTo === "in_progress" ? "in_progress" : "todo";
  try {
    const { data: row } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).maybeSingle();
    if (!row) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    const status = normalizeTodoStatus(row.status);
    if (status !== "needs_review") {
      res.status(400).json({ error: `Task must be needs_review to reject (current: ${status}).` });
      return;
    }
    if (!canTransitionTodo("needs_review", backTo)) {
      res.status(400).json({ error: "Invalid reject target status." });
      return;
    }
    await supabaseAdmin.from("todos").update({
      status: backTo,
      rail_id: null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", todoId);
    debugLog({
      hypothesisId: "H1",
      location: "todos.ts:reject",
      message: "reject cleared rail_id",
      data: { todoId, backTo, previousRailId: row.rail_id ?? null }
    });
    await appendTodoSessionLog(todoId, "rejected", {
      backTo,
      reason: req.body?.reason ?? null,
      cleared_rail_id: row.rail_id ?? null
    });
    const { data: updated } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).single();
    res.json({ todo: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router6.get("/todos/:id", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  if (!todoId) {
    res.status(400).json({ error: "Todo id is required" });
    return;
  }
  const { data: row, error } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", row.workspace_id).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  res.json({ todo: row });
});
router6.patch("/todos/:id", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  const { data: row, error: fetchErr } = await supabaseAdmin.from("todos").select("id, workspace_id").eq("id", todoId).maybeSingle();
  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", row.workspace_id).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const updates = {};
  if (typeof req.body?.title === "string") {
    updates.title = req.body.title.trim();
  }
  if (typeof req.body?.description === "string") {
    updates.description = req.body.description.trim();
  }
  if (req.body?.phase !== void 0) {
    updates.phase = typeof req.body.phase === "number" ? req.body.phase : typeof req.body.phase === "string" ? parseInt(req.body.phase, 10) || null : null;
  }
  if (Array.isArray(req.body?.dependsOn)) {
    const dependsOn = req.body.dependsOn.filter(
      (x) => typeof x === "string" && x.trim()
    );
    if (dependsOn.length) {
      const { data: allRows } = await supabaseAdmin.from("todos").select("id, depends_on").eq("workspace_id", row.workspace_id);
      const byId = new Map((allRows ?? []).map((r) => [r.id, { depends_on: r.depends_on ?? null }]));
      byId.set(todoId, { depends_on: dependsOn });
      if (hasDependsOnCycle(todoId, dependsOn, byId)) {
        res.status(400).json({ error: "Circular dependency in dependsOn." });
        return;
      }
    }
    updates.depends_on = dependsOn.length ? dependsOn : null;
  }
  if (typeof req.body?.status === "string") {
    const next = normalizeTodoStatus(req.body.status);
    const { data: cur } = await supabaseAdmin.from("todos").select("status").eq("id", todoId).single();
    const from = normalizeTodoStatus(cur?.status);
    if (!canTransitionTodo(from, next)) {
      res.status(400).json({ error: `Invalid status transition: ${from} \u2192 ${next}` });
      return;
    }
    updates.status = next;
  }
  if (typeof req.body?.context === "string") updates.context = req.body.context.trim();
  if (typeof req.body?.constraints === "string") updates.constraints = req.body.constraints.trim();
  if (req.body?.acceptanceCriteria !== void 0) {
    updates.acceptance_criteria = req.body.acceptanceCriteria && typeof req.body.acceptanceCriteria === "object" ? req.body.acceptanceCriteria : null;
  }
  if (Array.isArray(req.body?.fileScope)) {
    updates.file_scope = req.body.fileScope.filter(
      (x) => typeof x === "string" && x.trim()
    );
  }
  if (req.body?.archived === false || req.body?.archived === null) {
    updates.archived_at = null;
  }
  if (req.body?.archived === true) {
    updates.archived_at = (/* @__PURE__ */ new Date()).toISOString();
  }
  const { data, error } = await supabaseAdmin.from("todos").update(updates).eq("id", todoId).select("*").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ todo: data });
});
router6.delete("/todos/:id", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  const hardDelete = req.query.hard === "true" || req.query.hard === "1";
  const { data: row, error: fetchErr } = await supabaseAdmin.from("todos").select("id, workspace_id").eq("id", todoId).maybeSingle();
  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", row.workspace_id).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (hardDelete) {
    const { error: error2 } = await supabaseAdmin.from("todos").delete().eq("id", todoId);
    if (error2) {
      res.status(500).json({ error: error2.message });
      return;
    }
    res.status(204).send();
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { error } = await supabaseAdmin.from("todos").update({ archived_at: now }).eq("id", todoId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).send();
});
async function todoToRailCore(todoId, userId, memoryBlock) {
  if (!supabaseAdmin) throw new Error("Auth service not configured.");
  const { data: todoRow, error: todoErr } = await supabaseAdmin.from("todos").select(
    "id, title, description, context, constraints, acceptance_criteria, file_scope, workspace_id, rail_id, source, source_path"
  ).eq("id", todoId).maybeSingle();
  if (todoErr) throw new Error(todoErr.message);
  if (!todoRow) throw new Error("Todo not found");
  const workspaceId = todoRow.workspace_id;
  if (!workspaceId) throw new Error("Todo has no workspace_id");
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", userId).single();
  if (!ws) throw new Error("Access denied");
  let rootPath = null;
  let repoUrl = null;
  const { data: graphRow } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const graph = graphRow?.graph_json ?? null;
  repoUrl = graphRow?.repo_url ?? null;
  const { rootPath: resolved, error } = await ensureProjectRoot(
    workspaceId,
    graph ?? { nodes: [], edges: [] },
    repoUrl
  );
  if (resolved !== null) rootPath = resolved;
  else if (error) throw new Error(error);
  if (!rootPath) throw new Error("Workspace has no project_root; scan a repo before creating rails.");
  const reusableStates = /* @__PURE__ */ new Set([
    "PRE_PLANNING",
    "PLANNING",
    "AWAITING_APPROVAL",
    "EXECUTING",
    "VERIFYING",
    "SELF_CORRECTING"
  ]);
  if (todoRow.rail_id) {
    loadRails(rootPath);
    const existing = getRail(rootPath, todoRow.rail_id);
    const reuse = existing && reusableStates.has(existing.state);
    debugLog({
      hypothesisId: "H2",
      location: "todos.ts:todoToRailCore",
      message: "rail reuse decision",
      data: {
        todoId,
        existingRailId: todoRow.rail_id,
        railState: existing?.state ?? null,
        reuse,
        newRail: !reuse
      }
    });
    if (reuse) return { railId: todoRow.rail_id };
    await supabaseAdmin.from("todos").update({ rail_id: null }).eq("id", todoId);
  }
  const now = Date.now();
  const railId = `rail-todo-${todoId}-${now}`;
  const agentPrompt = buildTaskAgentPrompt(todoRow);
  const taskDesc = agentPrompt.slice(0, 4e3) || String(todoRow.title ?? "").slice(0, 200) || "Implement todo";
  const fileScope = Array.isArray(todoRow.file_scope) ? todoRow.file_scope.filter((x) => typeof x === "string" && x.trim()) : [];
  const primaryPath = fileScope[0] ?? "src";
  const logicStep = {
    step: 1,
    layer: "Service",
    nodeId: "todo",
    filePath: primaryPath.replace(/\*\*$/, "").replace(/\/$/, "") || "src",
    action: taskDesc.slice(0, 120)
  };
  const ac = todoRow.acceptance_criteria;
  const acceptanceCriteria = ac && typeof ac === "object" ? {
    functional: Array.isArray(ac.functional) ? ac.functional : [],
    visual: Array.isArray(ac.visual) ? ac.visual : [],
    architectural: Array.isArray(ac.architectural) ? ac.architectural : Array.isArray(ac.technical) ? ac.technical : []
  } : void 0;
  const rail = {
    id: railId,
    version: 1,
    outcome: `${String(todoRow.title ?? "").slice(0, 200)}

${memoryBlock ? `${memoryBlock.slice(0, 3e3)}

` : ""}${taskDesc}`.slice(
      0,
      8e3
    ),
    trigger: {
      source: "chat",
      userMessage: `Task: ${String(todoRow.title ?? "").slice(0, 200)}`,
      sessionId: userId ?? "webapp"
    },
    workspaceId,
    repoUrl,
    archetype: "analysis-chat",
    logicPath: [logicStep],
    state: "PRE_PLANNING",
    activeAgent: null,
    tasks: [],
    jiraKeys: [],
    traceIds: [],
    overlaps: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "human",
    sessionId: userId ?? "webapp",
    originSummary: taskDesc.slice(0, 500),
    acceptanceCriteria
  };
  createRail(rootPath, rail);
  const codeTask = {
    id: `task-todo-${todoId}`,
    railId,
    kind: "code_change",
    description: taskDesc,
    files: fileScope,
    autoCapable: true,
    status: "pending",
    agent: "executor",
    logicStep: 1,
    createdAt: now
  };
  createTask(codeTask);
  const { error: linkErr } = await supabaseAdmin.from("todos").update({ rail_id: railId }).eq("id", todoId);
  if (linkErr) throw new Error(linkErr.message);
  return { railId };
}
async function runAutoRailsAndExecute(workspaceId, userId, limit) {
  if (!supabaseAdmin) return { startedRails: [] };
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id, auto_execute_enabled").eq("id", workspaceId).eq("owner_id", userId).single();
  if (!ws || !ws.auto_execute_enabled) {
    return { startedRails: [] };
  }
  const { data, error } = await supabaseAdmin.from("todos").select("id, depends_on, status, archived_at").eq("workspace_id", workspaceId);
  if (error) return { startedRails: [] };
  const rows = data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const readyTodoIds = [];
  for (const row of rows) {
    if (row.archived_at != null || normalizeTodoStatus(row.status) !== "todo") continue;
    const deps = row.depends_on ?? [];
    if (deps.every((id) => isDependencyDone(byId.get(id)?.status))) {
      readyTodoIds.push(row.id);
    }
  }
  const picked = readyTodoIds.slice(0, Math.max(1, limit));
  const startedRails = [];
  for (const todoId of picked) {
    try {
      const { railId } = await todoToRailCore(todoId, userId);
      await triggerRailExecution(railId, workspaceId, userId);
      startedRails.push({ id: railId });
    } catch (err) {
      console.warn("[auto-rails-and-execute] todo", todoId, err instanceof Error ? err.message : err);
    }
  }
  return { startedRails };
}
router6.post("/todos/:id/to-rail", requireUser, async (req, res) => {
  const todoId = req.params.id;
  if (!todoId) {
    res.status(400).json({ error: "todo id is required" });
    return;
  }
  try {
    const { railId } = await todoToRailCore(todoId, req.user.id);
    res.status(201).json({ railId, todoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not configured")) res.status(503).json({ error: msg });
    else if (msg.includes("not found") || msg.includes("Todo not found")) res.status(404).json({ error: msg });
    else if (msg.includes("Access denied")) res.status(403).json({ error: msg });
    else if (msg.includes("required") || msg.includes("workspace")) res.status(400).json({ error: msg });
    else res.status(500).json({ error: msg });
  }
});
router6.post("/todos/auto-rails-and-execute", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.body?.workspaceId?.trim();
  const limitRaw = req.body?.limit;
  const limit = typeof limitRaw === "number" ? limitRaw : typeof limitRaw === "string" ? parseInt(limitRaw, 10) || 3 : 3;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id, auto_execute_enabled").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (!ws.auto_execute_enabled) {
    res.status(403).json({
      error: "Auto-execution is disabled for this workspace.",
      code: "AUTO_EXEC_DISABLED"
    });
    return;
  }
  const { data, error } = await supabaseAdmin.from("todos").select("id, depends_on, status, archived_at").eq("workspace_id", workspaceId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const rows = data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const readyTodoIds = [];
  for (const row of rows) {
    if (row.archived_at != null || normalizeTodoStatus(row.status) !== "todo") continue;
    const deps = row.depends_on ?? [];
    const allCompleted = deps.every((id) => {
      const dep = byId.get(id);
      return dep && dep.status === "completed";
    });
    if (allCompleted) readyTodoIds.push(row.id);
  }
  const picked = readyTodoIds.slice(0, Math.max(1, limit));
  if (picked.length === 0) {
    res.json({ startedRails: [], message: "No dependency-ready todos to execute." });
    return;
  }
  const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user.id, limit);
  res.json({ startedRails, pickedTodoIds: picked });
});
router6.post("/todos/auto-execute-ready", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.body?.workspaceId?.trim();
  const limitRaw = req.body?.limit;
  const limit = typeof limitRaw === "number" ? limitRaw : typeof limitRaw === "string" ? parseInt(limitRaw, 10) || 3 : 3;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const now = Date.now();
  const counter = autoExecCounters.get(workspaceId) ?? { count: 0, windowStart: now };
  if (now - counter.windowStart > AUTO_EXEC_WINDOW_MS) {
    counter.count = 0;
    counter.windowStart = now;
  }
  if (counter.count >= AUTO_EXEC_MAX_PER_WINDOW) {
    autoExecCounters.set(workspaceId, counter);
    res.status(429).json({
      error: "Auto-execution limit reached for this workspace. Try again later.",
      code: "AUTO_EXEC_LIMIT",
      limit: AUTO_EXEC_MAX_PER_WINDOW,
      windowMs: AUTO_EXEC_WINDOW_MS
    });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id, auto_execute_enabled").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (!ws.auto_execute_enabled) {
    res.status(403).json({
      error: "Auto-execution is disabled for this workspace.",
      code: "AUTO_EXEC_DISABLED"
    });
    return;
  }
  const { data, error } = await supabaseAdmin.from("todos").select("id, depends_on, status, archived_at").eq("workspace_id", workspaceId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const rows = data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const readyTodoIds = [];
  for (const row of rows) {
    if (row.archived_at != null || normalizeTodoStatus(row.status) !== "todo") continue;
    const deps = row.depends_on ?? [];
    const allCompleted = deps.every((id) => {
      const dep = byId.get(id);
      return dep && dep.status === "completed";
    });
    if (allCompleted) readyTodoIds.push(row.id);
  }
  const picked = readyTodoIds.slice(0, Math.max(1, limit));
  if (picked.length === 0) {
    res.json({ startedRails: [], message: "No dependency-ready todos to execute." });
    return;
  }
  counter.count += picked.length;
  autoExecCounters.set(workspaceId, counter);
  const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user.id, limit);
  res.json({
    startedRails,
    pickedTodoIds: picked,
    remainingReady: readyTodoIds.length - picked.length
  });
});
router6.post("/todos/from-chat", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.body?.workspaceId?.trim();
  const items = Array.isArray(req.body?.items) ? req.body.items.map((v) => typeof v === "string" ? v.trim() : "").filter(Boolean) : [];
  if (!workspaceId || items.length === 0) {
    res.status(400).json({ error: "workspaceId and at least one todo item are required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const titles = items;
  const { data: existing } = await supabaseAdmin.from("todos").select("title").eq("workspace_id", workspaceId).in("title", titles);
  const existingTitles = new Set((existing ?? []).map((r) => String(r.title)));
  const rows = items.filter((title) => !existingTitles.has(title)).map((title) => ({
    workspace_id: workspaceId,
    title,
    description: null,
    phase: null,
    depends_on: null,
    status: "todo",
    session_log: [],
    source: "chat",
    source_path: null
  }));
  if (rows.length === 0) {
    res.json({ created: [], skipped: items.length });
    return;
  }
  const { data, error } = await supabaseAdmin.from("todos").insert(rows).select("*");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({
    created: data ?? [],
    skipped: items.length - rows.length
  });
});

// src/chatSessionRails.ts
var sessionRails = /* @__PURE__ */ new Map();
function sessionKey(threadId, workspaceId, userId) {
  if (threadId && typeof threadId === "string" && threadId.trim()) {
    return `thread:${threadId.trim()}`;
  }
  if (workspaceId) {
    return `ws:${workspaceId}:${userId}`;
  }
  return `user:${userId}`;
}
function addRailsToSession(threadId, workspaceId, userId, railIds) {
  if (railIds.length === 0) return;
  const key = sessionKey(threadId, workspaceId, userId);
  const prev = sessionRails.get(key) ?? [];
  sessionRails.set(key, [...prev, ...railIds]);
}
function getSessionRails(threadId, workspaceId, userId) {
  const key = sessionKey(threadId, workspaceId, userId);
  return sessionRails.get(key) ?? [];
}
function parseRailIntent(question) {
  const lower = question.toLowerCase().trim();
  const retryMatch = lower.match(/\bretry\s+rail\s+(\d+)\b/);
  if (retryMatch) {
    const n = parseInt(retryMatch[1], 10);
    if (n >= 1) return { action: "retry", index: n - 1 };
  }
  const cancelMatch = lower.match(/\bcancel\s+rail\s+(\d+)\b/);
  if (cancelMatch) {
    const n = parseInt(cancelMatch[1], 10);
    if (n >= 1) return { action: "cancel", index: n - 1 };
  }
  return null;
}

// src/railActions.ts
import * as path32 from "path";
async function resolveRoot(workspaceId, userId) {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin.from("workspaces").select("project_root").eq("id", workspaceId).eq("owner_id", userId).maybeSingle();
    if (error || !data) return null;
    const pr = data.project_root;
    return typeof pr === "string" && pr.trim() ? path32.resolve(pr.trim()) : null;
  } catch {
    return null;
  }
}
async function cancelRail(railId, workspaceId, userId) {
  const root = await resolveRoot(workspaceId, userId);
  if (!root) return { ok: false, error: "Workspace has no project_root." };
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) return { ok: false, error: "Rail not found." };
    if (!["EXECUTING", "VERIFYING", "SELF_CORRECTING", "AWAITING_HITL"].includes(rail.state)) {
      return { ok: false, error: `Rail is not cancellable from state ${rail.state}.` };
    }
    const result = transitionRail(root, railId, "SUSPENDED");
    if (!result.ok || !result.rail) return { ok: false, error: result.error ?? "Invalid transition." };
    updateRailState(root, railId, result.rail.state);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function retryRail(railId, workspaceId, userId) {
  try {
    const { taskId } = await triggerRailExecution(railId, workspaceId, userId);
    return { ok: true, taskId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// src/feedback.ts
import express from "express";
var router7 = express.Router();
async function getRecentFeedbackForUser(userId, options) {
  if (!supabaseAdmin) return { downvoteCount: 0 };
  const limit = options?.limit ?? 10;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString();
  const { data, error } = await supabaseAdmin.from("ai_feedback").select("id").eq("user_id", userId).eq("rating", "down").gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
  if (error) return { downvoteCount: 0 };
  return { downvoteCount: data?.length ?? 0 };
}
router7.post("/chat-feedback", requireUser, async (req, res) => {
  const { taskId, rating, comment, workspaceId } = req.body;
  if (!taskId || rating !== "up" && rating !== "down") {
    res.status(400).json({ error: "taskId and rating ('up' | 'down') are required" });
    return;
  }
  const userId = req.user.id;
  const commentTrimmed = typeof comment === "string" && comment.trim() ? comment.slice(0, 2e3) : null;
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("ai_feedback").insert({
        user_id: userId,
        task_id: taskId,
        rating,
        comment: commentTrimmed,
        workspace_id: workspaceId ?? null
      });
    } catch (e) {
      console.warn("[chat-feedback] insert failed:", e instanceof Error ? e.message : e);
    }
  }
  res.json({ ok: true });
});

// ../../src/analysis/pathSearch.ts
function findPath(graph, sourceId, targetId, direction = "outbound") {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];
  const adj = /* @__PURE__ */ new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const reverseAdj = /* @__PURE__ */ new Map();
  for (const e of graph.edges) {
    if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
    reverseAdj.get(e.target).push(e.source);
  }
  const getNeighbours = (id) => {
    if (direction === "outbound") return adj.get(id) ?? [];
    if (direction === "inbound") return reverseAdj.get(id) ?? [];
    return [...adj.get(id) ?? [], ...reverseAdj.get(id) ?? []];
  };
  const parent = /* @__PURE__ */ new Map();
  const queue = [sourceId];
  parent.set(sourceId, "");
  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr === targetId) {
      const path43 = [];
      let n = targetId;
      while (n) {
        path43.unshift(n);
        n = parent.get(n) || void 0;
      }
      return path43;
    }
    for (const next of getNeighbours(curr)) {
      if (!parent.has(next)) {
        parent.set(next, curr);
        queue.push(next);
      }
    }
  }
  return [];
}

// src/chat.ts
var router8 = Router7();
function maybeCreateAnalysisRail(params) {
  if (params.mode !== "analysis") return null;
  if (!params.rootPath) return null;
  const now = Date.now();
  const railId = `rail-analysis-${now}-${Math.random().toString(16).slice(2, 8)}`;
  const trigger = {
    source: "chat",
    userMessage: params.question.slice(0, 500),
    sessionId: params.userId ?? "webapp"
  };
  const hasViolations = Array.isArray(params.result.violations) && params.result.violations.length > 0;
  const proposal = params.result.proposal;
  const hasProposalNodes = !!proposal && Array.isArray(proposal.nodes) && proposal.nodes.length > 0;
  const logicPath = hasProposalNodes ? proposal.nodes.map((n, idx) => {
    const rawLayer = typeof n.layer === "string" ? n.layer.toLowerCase() : "";
    let layer = "Service";
    if (rawLayer.includes("ui") || rawLayer.includes("frontend") || rawLayer.includes("view")) {
      layer = "UI";
    } else if (rawLayer.includes("api") || rawLayer.includes("controller")) {
      layer = "API";
    } else if (rawLayer.includes("infra") || rawLayer.includes("infrastructure") || rawLayer.includes("devops")) {
      layer = "Infrastructure";
    } else if (rawLayer.includes("external") || rawLayer.includes("integration")) {
      layer = "External";
    }
    const nodeId = typeof n.id === "string" && n.id.trim() ? n.id.trim() : `step-${idx + 1}`;
    const filePath = nodeId;
    return {
      step: idx + 1,
      layer,
      nodeId,
      filePath,
      action: n.description && n.description.trim() ? n.description.trim().slice(0, 120) : "analysis-step"
    };
  }) : [];
  const rail = {
    id: railId,
    version: 1,
    outcome: hasProposalNodes ? typeof proposal.summary === "string" && proposal.summary.trim() ? proposal.summary.trim() : params.question.slice(0, 200) : params.question.slice(0, 200),
    trigger,
    workspaceId: params.workspaceId ?? null,
    repoUrl: params.repoUrl ?? null,
    archetype: "analysis-chat",
    logicPath,
    state: hasProposalNodes ? "PRE_PLANNING" : "ARCHIVED",
    activeAgent: null,
    tasks: [],
    jiraKeys: [],
    traceIds: params.result.traceId ? [params.result.traceId] : [],
    overlaps: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "human",
    sessionId: params.userId ?? "webapp",
    originSummary: params.question.slice(0, 200).trim() || void 0,
    lastCritique: {
      source: "reviewer",
      message: params.result.criticReport ?? "",
      createdAt: now,
      criticScore: params.result.criticScore ?? void 0,
      violations: hasViolations ? params.result.violations.map((v) => ({
        type: v.type,
        severity: v.severity,
        description: v.description
      })) : void 0
    }
  };
  try {
    const created = createRail(params.rootPath, rail);
    const taskId = `task-meta-${randomUUID()}`;
    const task = {
      id: taskId,
      railId: created.id,
      kind: "meta",
      description: "Analysis chat answer recorded.",
      files: [],
      autoCapable: false,
      status: "completed",
      agent: "reviewer",
      logicStep: 0,
      createdAt: now,
      resolvedAt: now
    };
    createTask(task);
    if (hasViolations) {
      const vTaskId = `task-verify-${randomUUID()}`;
      const vTask = {
        id: vTaskId,
        railId: created.id,
        kind: "verification",
        description: "Critic reported violations for analysis answer.",
        files: [],
        autoCapable: false,
        status: "pending",
        agent: "reviewer",
        logicStep: 0,
        createdAt: now
      };
      createTask(vTask);
    }
    if (hasProposalNodes) {
      const nodes = proposal.nodes;
      nodes.forEach((n, idx) => {
        const nodeId = typeof n.id === "string" && n.id.trim() ? n.id.trim() : `step-${idx + 1}`;
        const description = (typeof n.description === "string" && n.description.trim() ? n.description.trim() : `Implement ${n.label ?? nodeId}`) || "Implement planned change";
        const codeTask = {
          id: `task-code-${randomUUID()}`,
          railId: created.id,
          kind: "code_change",
          description,
          files: [],
          autoCapable: true,
          status: "pending",
          agent: "executor",
          logicStep: idx + 1,
          createdAt: now
        };
        createTask(codeTask);
      });
    }
    return created.id;
  } catch (err) {
    console.error("[chat] maybeCreateAnalysisRail failed", {
      rootPath: params.rootPath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : void 0
    });
  }
  return null;
}
router8.post("/chat", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId, pdfBase64, pdfFileName, pendingViolations } = req.body;
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }
  if (question.length > 4e3) {
    res.status(400).json({ error: "Question too long. Max 4000 characters." });
    return;
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({
      error: "graph is required. Please scan a repository first so the architect has context."
    });
    return;
  }
  if (history && Array.isArray(history) && history.length > 50) {
    res.status(400).json({ error: "History too long. Max 50 messages." });
    return;
  }
  if (pdfBase64 != null && (typeof pdfBase64 !== "string" || pdfBase64.length > 5e7)) {
    res.status(400).json({ error: "PDF too large. Max ~25MB." });
    return;
  }
  const railIntent = parseRailIntent(question);
  if (railIntent && workspaceId && req.user?.id) {
    const sessionRailsList = getSessionRails(threadId ?? void 0, workspaceId, req.user.id);
    const railId = sessionRailsList[railIntent.index];
    if (railId) {
      try {
        if (railIntent.action === "cancel") {
          const out = await cancelRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Cancelled rail ${railIntent.index + 1}.`,
              railAction: { action: "cancel", railId, index: railIntent.index + 1 },
              rails: [{ id: railId }]
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Cancel failed." });
          return;
        }
        if (railIntent.action === "retry") {
          const out = await retryRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Retrying rail ${railIntent.index + 1}. Execution started.`,
              railAction: { action: "retry", railId, taskId: out.taskId, index: railIntent.index + 1 },
              rails: [{ id: railId }],
              boardHint: { workspaceId }
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Retry failed." });
          return;
        }
      } catch {
      }
    }
  }
  const trackMatch = /^\s*(track|create\s+jira|track\s+in\s+jira)\s*$/i.test(question.trim());
  if (trackMatch && Array.isArray(pendingViolations) && pendingViolations.length > 0) {
    try {
      const config = await getUserJiraConfig(req.user.id);
      if (!config) {
        res.json({
          answer: "Jira is not connected. Use the Governance panel to connect your Jira account.",
          violations: pendingViolations
        });
        return;
      }
      const projectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? config.project ?? null;
      if (!projectKey) {
        res.json({
          answer: "Set a project key in the sidebar to track violations in Jira.",
          violations: pendingViolations
        });
        return;
      }
      const projectRoot5 = graph?.projectRoot ?? void 0;
      const projectName = graph?.projectName ?? void 0;
      const results = [];
      for (const v of pendingViolations.slice(0, 10)) {
        const srcNode = graph?.nodes?.find((n) => n.id === v.sourceNodeId || n.path === v.sourceNodeId);
        const archModulePath = srcNode?.path ?? v.sourceNodeId;
        const archModuleFiles = srcNode?.files;
        const r = await createJiraTicketForViolation({
          config,
          projectKey,
          violation: v,
          projectRoot: projectRoot5,
          projectName,
          workspaceId: workspaceId ?? void 0,
          archModulePath,
          archModuleFiles
        });
        if (r.error) {
          results.push({ key: "", error: r.error });
        } else {
          results.push({ key: r.key, url: r.url });
        }
      }
      const created = results.filter((x) => x.key);
      const failed = results.filter((x) => x.error);
      let answer = `Created ${created.length} Jira ticket(s) for violations.`;
      if (created.length > 0) {
        const keys = created.map((r) => `[${r.key}](${r.url ?? ""})`).join(", ");
        answer += `

${keys}`;
      }
      if (failed.length > 0) {
        answer += `

${failed.length} failed: ${failed.map((r) => r.error).join("; ")}`;
      }
      const updatedViolations = pendingViolations.map((v, i) => {
        const r = results[i];
        return r?.key ? { ...v, jiraKey: r.key, jiraStatus: "To Do", trackedAt: Date.now() } : v;
      });
      res.json({ answer, violations: updatedViolations });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({
        answer: `Failed to create Jira tickets: ${msg}`,
        violations: pendingViolations
      });
      return;
    }
  }
  const lowered = question.toLowerCase();
  const isExecutionIntent = lowered.includes("start implementing") || lowered.includes("run the tasks") || lowered.includes("go fix these") || lowered.includes("apply the plan") || lowered.includes("execute the rail");
  const looksLikeTodoLine = (line) => /^(\d+\.\s+|-|\*)\s+.+/.test(line.trim());
  const lines = question.split(/\r?\n/);
  const todoLines = lines.filter(looksLikeTodoLine).map((l) => l.replace(/^(\d+\.\s+|-|\*)\s+/, "").trim());
  const isTodoIntent = !!workspaceId && todoLines.length > 0 && (lowered.includes("todo list") || lowered.includes("todos:") || lowered.includes("backlog") || lowered.includes("tasks:"));
  const clientMode = req.body?.mode;
  const explicitMode = clientMode === "greenfield" || clientMode === "analysis" ? clientMode : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
  let rootPath = mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== "" ? graph.projectRoot.trim() : null;
  let repoUrl = null;
  if (mode === "analysis" && workspaceId && supabaseAdmin) {
    const { data: gr } = await supabaseAdmin.from("graphs").select("repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    repoUrl = gr?.repo_url ?? null;
    const { rootPath: resolved, error } = await ensureProjectRoot(
      workspaceId,
      graph,
      repoUrl
    );
    if (resolved !== null) rootPath = resolved;
    else if (error && rootPath === null) {
      res.status(400).json({ error });
      return;
    }
  }
  try {
    const findings = [];
    const startMs = Date.now();
    let enrichedQuestion = question;
    if (supabaseAdmin && workspaceId) {
      const nodeIds = [];
      if (nodeId) nodeIds.push(nodeId);
      const notice = await buildGovernanceNotice(supabaseAdmin, workspaceId, nodeIds);
      if (notice) {
        enrichedQuestion = `${question}${notice}`;
      }
      const [memories, snapshots, userMemories, graphEvolution, systemModelSummary] = await Promise.all([
        getMemoriesForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        getSnapshotsForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        req.user?.id ? getUserMemoriesForContext(supabaseAdmin, req.user.id) : Promise.resolve([]),
        getGraphEvolutionForContext(supabaseAdmin, workspaceId),
        getSystemModelForContext(supabaseAdmin, workspaceId)
      ]);
      const memoryBlock = buildMemoryContextBlock(memories, snapshots, userMemories, graphEvolution, systemModelSummary);
      if (memoryBlock) {
        enrichedQuestion = `${memoryBlock}
## Current question
${question}`;
      }
    }
    let jiraConfig;
    let jiraProjectKey;
    if (req.user?.id) {
      try {
        const userJira = await getUserJiraConfig(req.user.id);
        if (userJira) {
          jiraConfig = {
            baseUrl: userJira.baseUrl,
            email: userJira.email,
            apiToken: userJira.apiToken
          };
          jiraProjectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? userJira.project ?? void 0;
        }
      } catch (e) {
        if (e instanceof JiraDecryptError) {
          res.status(400).json({ error: e.message, code: "jira_decrypt_failed" });
          return;
        }
        throw e;
      }
    }
    if (isTodoIntent && workspaceId && supabaseAdmin && todoLines.length > 0) {
      try {
        const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
        if (!ws) {
          res.status(403).json({ error: "Access denied for workspace." });
          return;
        }
        const { data: existing } = await supabaseAdmin.from("todos").select("title").eq("workspace_id", workspaceId).in("title", todoLines);
        const existingTitles = new Set((existing ?? []).map((r) => String(r.title)));
        const rows = todoLines.filter((title) => !existingTitles.has(title)).map((title) => ({
          workspace_id: workspaceId,
          title,
          description: null,
          phase: null,
          depends_on: null,
          status: "pending",
          source: "chat",
          source_path: null
        }));
        if (rows.length === 0) {
          res.json({
            answer: "Todos already exist for each item in your list.",
            todos: []
          });
          return;
        }
        const { data, error } = await supabaseAdmin.from("todos").insert(rows).select("*");
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({
          answer: "Created todos from your list.",
          todos: data ?? []
        });
        return;
      } catch {
      }
    }
    const pathMatch = /(?:path\s+from|path\s|trace\s+(?:path\s+)?from)\s+(.+?)\s+to\s+(.+)/i.exec(question) || /how\s+does\s+(.+?)\s+connect\s+to\s+(.+)/i.exec(question) || /find\s+path\s+between\s+(.+?)\s+and\s+(.+)/i.exec(question);
    if (pathMatch && graph && graph.nodes.length > 0) {
      const fromPart = pathMatch[1].trim();
      const toPart = pathMatch[2].trim();
      const sourceId = matchNodeByLabel(fromPart, graph);
      const targetId = matchNodeByLabel(toPart, graph);
      if (sourceId && targetId) {
        const nodeIds = findPath(graph, sourceId, targetId);
        res.json({
          answer: nodeIds.length > 0 ? `Found path (${nodeIds.length} nodes): ${nodeIds.join(" \u2192 ")}.` : `No path found between "${fromPart}" and "${toPart}".`,
          graphCommands: nodeIds.length > 0 ? [{ action: "trace_path", nodeIds }] : []
        });
        return;
      }
    }
    const insightsMatch = /\b(insights|hotspots|show\s+insights|graph\s+insights)\b/i.test(question) || /^insights$/i.test(question.trim());
    if (insightsMatch && graph) {
      res.json({
        answer: "Here are the graph insights. Use the insights panel to explore hotspots and dependencies.",
        showInsightsPanel: true
      });
      return;
    }
    const useStream = req.body?.stream === true && mode === "greenfield" && !jiraConfig && !jiraProjectKey;
    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
    }
    let feedbackContextSync;
    if (req.user?.id) {
      try {
        const { downvoteCount } = await getRecentFeedbackForUser(req.user.id);
        if (downvoteCount > 0) {
          feedbackContextSync = `Note: The user has downvoted ${downvoteCount} architecture answer(s) in the last 7 days. Prefer concise, actionable responses and avoid overly long explanations.`;
        }
      } catch {
      }
    }
    const result = await runArchitectureTask({
      question: enrichedQuestion,
      graph,
      nodeId,
      history,
      mode,
      apiKeyOpenAI: process.env.OPENAI_API_KEY,
      apiKeyClaude: process.env.ANTHROPIC_API_KEY,
      findings,
      rootPath,
      jiraConfig,
      jiraProjectKey: jiraProjectKey ?? void 0,
      feedbackContext: feedbackContextSync,
      ...pdfBase64 && typeof pdfBase64 === "string" ? { pdfBase64, pdfFileName: typeof pdfFileName === "string" ? pdfFileName : "document.pdf" } : {},
      ...useStream ? {
        onTextChunk: (chunk) => {
          try {
            res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}

`);
          } catch {
          }
        }
      } : {}
    });
    const latencyMs = Date.now() - startMs;
    const analysisRailId = maybeCreateAnalysisRail({
      mode,
      rootPath,
      question,
      result: {
        answer: result.answer,
        criticScore: result.criticScore ?? null,
        criticReport: result.criticReport ?? null,
        violations: result.violations ?? [],
        traceId: result.traceId ?? null,
        proposal: result.proposal
      },
      userId: req.user?.id,
      workspaceId: workspaceId ?? null,
      repoUrl
    });
    const violations = result.violations ?? [];
    let autoExecution = null;
    let railsFromExecution;
    if (isExecutionIntent && workspaceId && req.user?.id) {
      try {
        const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user.id, 3);
        if (startedRails.length > 0) {
          railsFromExecution = startedRails;
          autoExecution = {
            pickedTodoIds: startedRails.map((r) => r.id),
            startedRails: startedRails.map((r) => r.id)
          };
          addRailsToSession(threadId ?? void 0, workspaceId, req.user.id, startedRails.map((r) => r.id));
        }
      } catch {
      }
    }
    if (analysisRailId) {
      addRailsToSession(threadId ?? void 0, workspaceId ?? void 0, req.user.id, [analysisRailId]);
    }
    if (supabaseAdmin && workspaceId) {
      const client = supabaseAdmin;
      upsertViolations(client, {
        workspaceId,
        violations,
        rulesVersion: ARCH_RULESET_VERSION,
        markAbsent: false
        // Chat returns question-scoped violations only; do not clear others.
      }).then(
        () => recordScanSnapshot(client, workspaceId, ARCH_RULESET_VERSION)
      ).catch((err) => {
        console.error("[violationStore] upsert/scan failed:", err);
      });
    }
    if (supabaseAdmin) {
      (async () => {
        let langsmithUrl = null;
        if (process.env.LANGSMITH_API_KEY && process.env.LANGSMITH_API_KEY.trim()) {
          try {
            const { RunTree } = await import("langsmith");
            const run = new RunTree({
              name: "architecture_chat",
              run_type: "chain",
              inputs: {
                question,
                node_id: nodeId ?? null,
                workspace_id: workspaceId ?? null
              },
              start_time: startMs,
              end_time: Date.now(),
              outputs: {
                answer: result.answer,
                criticScore: result.criticScore ?? null
              },
              metadata: {
                traceId: result.traceId ?? null,
                mode,
                hasGraphCommand: !!(result.graphCommands && result.graphCommands.length) || !!result.graphCommand
              },
              tags: ["architecture-visualizer"]
            });
            await run.postRun();
            const maybeUrl = run.url;
            langsmithUrl = typeof maybeUrl === "string" ? maybeUrl : null;
          } catch (err) {
            if (process.env.METRICS_LOG === "1") {
              console.warn(
                "[metrics] LangSmith logging failed:",
                err instanceof Error ? err.message : String(err)
              );
            }
          }
        }
        try {
          const tokenUsage2 = result.tokenUsage;
          await supabaseAdmin.from("model_traces").insert({
            workspace_id: workspaceId ?? null,
            user_id: req.user?.id ?? null,
            session_id: null,
            question,
            node_id: nodeId ?? null,
            agent_model: "claude-sonnet-4-6",
            critic_model: "gpt-4o-mini",
            agent_latency_ms: latencyMs,
            agent_prompt_tokens: tokenUsage2?.agentInput ?? null,
            agent_completion_tokens: tokenUsage2?.agentOutput ?? null,
            langsmith_url: langsmithUrl,
            agent_graph_commands: result.graphCommands && result.graphCommands.length > 0 ? result.graphCommands : result.graphCommand ? [result.graphCommand] : null,
            agent_violations: Array.isArray(result.violations) ? result.violations : null,
            agent_answer: result.answer,
            critic_latency_ms: null,
            critic_prompt_tokens: null,
            critic_completion_tokens: null,
            critic_score: typeof result.criticScore === "number" ? String(result.criticScore) : null
          }).throwOnError();
        } catch (err) {
          if (process.env.METRICS_LOG === "1") {
            console.warn(
              "[metrics] Failed to insert model_traces:",
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        if (workspaceId && typeof result.criticScore === "number" && result.criticScore >= 7 && result.answer?.trim().length > 50) {
          try {
            await supabaseAdmin.from("workspace_memories").insert({
              workspace_id: workspaceId,
              node_id: nodeId ?? null,
              content: `${question}

${result.answer.slice(0, 2e3)}`,
              memory_type: "arch_insight"
            }).throwOnError();
            if (supabaseAdmin) {
              setImmediate(() => {
                void maybePruneWorkspaceMemories(supabaseAdmin, workspaceId).catch(() => {
                });
              });
            }
          } catch {
            if (process.env.METRICS_LOG === "1") {
              console.warn("[metrics] workspace_memories insert skipped");
            }
          }
        }
        if (workspaceId && result.answer?.trim()) {
          try {
            await supabaseAdmin.from("conversation_snapshots").insert({
              workspace_id: workspaceId,
              node_id: nodeId ?? null,
              intent_summary: question.slice(0, 500),
              outcome_summary: result.answer.slice(0, 500)
            });
          } catch {
            if (process.env.METRICS_LOG === "1") {
              console.warn("[chat] conversation_snapshots insert skipped");
            }
          }
        }
        try {
          await supabaseAdmin.from("agent_traces").insert({
            workspace_id: workspaceId ?? null,
            node_id: nodeId ?? null,
            trace_id: result.traceId ?? null,
            run_type: "chat",
            payload: {
              question: question.slice(0, 500),
              answer_preview: result.answer?.slice(0, 200) ?? null
            }
          }).throwOnError();
        } catch {
          if (process.env.METRICS_LOG === "1") {
            console.warn("[metrics] agent_traces insert skipped (table/schema may differ)");
          }
        }
      })();
    }
    if (mode === "greenfield" && greenfieldSessionId && typeof greenfieldSessionId === "string" && (result.graphCommands?.length || result.graphCommand)) {
      const cmds = result.graphCommands ?? (result.graphCommand ? [result.graphCommand] : []);
      const nodes = [];
      const edges = [];
      for (const cmd of cmds) {
        if (cmd.action === "create_node" && "id" in cmd) {
          nodes.push({
            id: cmd.id,
            label: cmd.label ?? cmd.id,
            layer: "layer" in cmd ? cmd.layer : void 0,
            description: "description" in cmd ? cmd.description : void 0,
            archNodeId: "archNodeId" in cmd ? cmd.archNodeId : void 0,
            skeletonCode: "skeletonCode" in cmd && typeof cmd.skeletonCode === "string" ? cmd.skeletonCode : void 0,
            layoutHint: "layoutHint" in cmd && typeof cmd.layoutHint === "string" ? cmd.layoutHint : void 0,
            group: "group" in cmd && typeof cmd.group === "string" ? cmd.group : void 0
          });
        }
        if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
          edges.push({ source: cmd.fromId, target: cmd.toId });
        }
      }
      if (nodes.length > 0 || edges.length > 0) {
        try {
          saveDraft(greenfieldSessionId, { nodes, edges, workspaceId: workspaceId ?? void 0 });
          if (supabaseAdmin && workspaceId && (result.criticScore ?? 0) >= 6 && (result.answer?.length ?? 0) > 30) {
            const designSummary = `Greenfield design: ${nodes.length} nodes (${nodes.map((n) => n.label || n.id).join(", ")}), ${edges.length} edges. ${(result.answer ?? "").slice(0, 300).replace(/\n/g, " ")}`;
            supabaseAdmin.from("workspace_memories").insert({
              workspace_id: workspaceId,
              content: designSummary,
              memory_type: "greenfield_design",
              node_id: null
            }).then(
              void 0,
              (e) => console.warn("[chat] greenfield memory insert:", e instanceof Error ? e.message : e)
            );
          }
        } catch {
        }
      }
    }
    if (supabaseAdmin && workspaceId && threadId && typeof threadId === "string") {
      const toAppend = [
        { role: "user", content: question },
        { role: "assistant", content: (result.answer ?? "").slice(0, 1e4) }
      ];
      if (result.criticReport?.trim()) {
        toAppend.push({ role: "assistant", content: `Critic: ${result.criticReport}`.slice(0, 1e4) });
      }
      const autoTitle = question.slice(0, 60).trim();
      supabaseAdmin.from("chat_messages").insert(
        toAppend.map((m) => ({
          thread_id: threadId,
          role: m.role,
          content: m.content
        }))
      ).then(async () => {
        if (!supabaseAdmin) return;
        const update = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
        const { data: thread } = await supabaseAdmin.from("chat_threads").select("title").eq("id", threadId).eq("workspace_id", workspaceId).single();
        if (thread?.title === "New chat" && autoTitle) {
          update.title = autoTitle.slice(0, 200);
        }
        await supabaseAdmin.from("chat_threads").update(update).eq("id", threadId).eq("workspace_id", workspaceId);
      }).then(void 0, (e) => console.warn("[chat] thread persist:", e instanceof Error ? e.message : e));
    }
    if (useStream) {
      try {
        res.write(
          `data: ${JSON.stringify({
            type: "done",
            answer: result.answer,
            graphCommands: result.graphCommands,
            graphCommand: result.graphCommand,
            criticReport: result.criticReport,
            criticScore: result.criticScore
          })}

`
        );
        res.end();
      } catch {
        res.end();
      }
      return;
    }
    const tokenUsage = result.tokenUsage;
    if (tokenUsage && (process.env.METRICS_LOG === "1" || process.env.TOKEN_LOG === "1")) {
      const in_ = tokenUsage.agentInput ?? 0;
      const out_ = tokenUsage.agentOutput ?? 0;
      console.log(`[chat] tokens in=${in_} out=${out_} total=${in_ + out_}`);
    }
    const allRails = [
      ...analysisRailId ? [{ id: analysisRailId }] : [],
      ...railsFromExecution ?? [],
      ...Array.isArray(result.rails) ? result.rails : []
    ];
    const railsDeduped = Array.from(new Map(allRails.map((r) => [r.id, r])).values());
    const boardHint = workspaceId && railsDeduped.length > 0 ? { workspaceId } : void 0;
    res.json({
      answer: result.answer,
      graphCommands: result.graphCommands,
      graphCommand: result.graphCommand,
      criticReport: result.criticReport,
      criticScore: result.criticScore,
      acceptanceCriteria: result.acceptanceCriteria,
      archetype: result.archetype,
      violations: result.violations ?? [],
      relevantNodeIds: result.relevantNodeIds ?? void 0,
      ...tokenUsage ? {
        tokenUsage: {
          input: tokenUsage.agentInput ?? 0,
          output: tokenUsage.agentOutput ?? 0,
          total: (tokenUsage.agentInput ?? 0) + (tokenUsage.agentOutput ?? 0),
          /** 180K is the safe limit; warn when >80%. */
          warningThreshold: 144e3
        }
      } : {},
      rails: railsDeduped.length > 0 ? railsDeduped : void 0,
      railIds: railsDeduped.map((r) => r.id),
      boardHint,
      autoExecution: autoExecution ?? void 0
    });
  } catch (err) {
    const traceId = err instanceof ArchError ? err.traceId : void 0;
    logArchError(err, traceId, "chat");
    const userMessage = toUserMessage(err, traceId);
    res.status(500).json({ error: userMessage, ...traceId && { traceId } });
  }
});
router8.post("/chat-async", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId, pdfBase64, pdfFileName, pendingViolations } = req.body;
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }
  if (question.length > 4e3) {
    res.status(400).json({ error: "Question too long. Max 4000 characters." });
    return;
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({
      error: "graph is required. Please scan a repository first so the architect has context."
    });
    return;
  }
  if (history && Array.isArray(history) && history.length > 50) {
    res.status(400).json({ error: "History too long. Max 50 messages." });
    return;
  }
  if (pdfBase64 != null && (typeof pdfBase64 !== "string" || pdfBase64.length > 5e7)) {
    res.status(400).json({ error: "PDF too large. Max ~25MB." });
    return;
  }
  const railIntent = parseRailIntent(question);
  if (railIntent && workspaceId && req.user?.id) {
    const sessionRailsList = getSessionRails(threadId ?? void 0, workspaceId, req.user.id);
    const railId = sessionRailsList[railIntent.index];
    if (railId) {
      try {
        if (railIntent.action === "cancel") {
          const out = await cancelRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Cancelled rail ${railIntent.index + 1}.`,
              railAction: { action: "cancel", railId, index: railIntent.index + 1 },
              rails: [{ id: railId }]
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Cancel failed." });
          return;
        }
        if (railIntent.action === "retry") {
          const out = await retryRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Retrying rail ${railIntent.index + 1}. Execution started.`,
              railAction: { action: "retry", railId, taskId: out.taskId, index: railIntent.index + 1 },
              rails: [{ id: railId }],
              boardHint: { workspaceId }
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Retry failed." });
          return;
        }
      } catch {
      }
    }
  }
  const trackMatch = /^\s*(track|create\s+jira|track\s+in\s+jira)\s*$/i.test(question.trim());
  if (trackMatch && Array.isArray(pendingViolations) && pendingViolations.length > 0) {
    try {
      const config = await getUserJiraConfig(req.user.id);
      if (!config) {
        res.json({
          answer: "Jira is not connected. Use the Governance panel to connect your Jira account.",
          violations: pendingViolations
        });
        return;
      }
      const projectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? config.project ?? null;
      if (!projectKey) {
        res.json({
          answer: "Set a project key in the sidebar to track violations in Jira.",
          violations: pendingViolations
        });
        return;
      }
      const projectRoot5 = graph?.projectRoot ?? void 0;
      const projectName = graph?.projectName ?? void 0;
      const results = [];
      for (const v of pendingViolations.slice(0, 10)) {
        const srcNode = graph?.nodes?.find((n) => n.id === v.sourceNodeId || n.path === v.sourceNodeId);
        const archModulePath = srcNode?.path ?? v.sourceNodeId;
        const archModuleFiles = srcNode?.files;
        const r = await createJiraTicketForViolation({
          config,
          projectKey,
          violation: v,
          projectRoot: projectRoot5,
          projectName,
          workspaceId: workspaceId ?? void 0,
          archModulePath,
          archModuleFiles
        });
        if (r.error) {
          results.push({ key: "", error: r.error });
        } else {
          results.push({ key: r.key, url: r.url });
        }
      }
      const created = results.filter((x) => x.key);
      const failed = results.filter((x) => x.error);
      let answer = `Created ${created.length} Jira ticket(s) for violations.`;
      if (created.length > 0) {
        const keys = created.map((r) => `[${r.key}](${r.url ?? ""})`).join(", ");
        answer += `

${keys}`;
      }
      if (failed.length > 0) {
        answer += `

${failed.length} failed: ${failed.map((r) => r.error).join("; ")}`;
      }
      const updatedViolations = pendingViolations.map((v, i) => {
        const r = results[i];
        return r?.key ? { ...v, jiraKey: r.key, jiraStatus: "To Do", trackedAt: Date.now() } : v;
      });
      res.json({ answer, violations: updatedViolations });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({
        answer: `Failed to create Jira tickets: ${msg}`,
        violations: pendingViolations
      });
      return;
    }
  }
  const lowered = question.toLowerCase();
  const isExecutionIntent = lowered.includes("start implementing") || lowered.includes("run the tasks") || lowered.includes("go fix these") || lowered.includes("apply the plan") || lowered.includes("execute the rail");
  const clientMode = req.body?.mode;
  const explicitMode = clientMode === "greenfield" || clientMode === "analysis" ? clientMode : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
  const task = createTask2();
  res.status(202).json({ taskId: task.taskId, status: "pending" });
  setTaskRunning(task.taskId);
  const findings = [];
  let jiraConfig;
  let jiraProjectKey;
  if (req.user?.id) {
    try {
      const userJira = await getUserJiraConfig(req.user.id);
      if (userJira) {
        jiraConfig = {
          baseUrl: userJira.baseUrl,
          email: userJira.email,
          apiToken: userJira.apiToken
        };
        jiraProjectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? userJira.project ?? void 0;
      }
    } catch (e) {
      if (e instanceof JiraDecryptError) {
        setTaskFailed(task.taskId, e.message);
        return;
      }
      throw e;
    }
  }
  (async () => {
    let rootPath = mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== "" ? graph.projectRoot.trim() : null;
    let repoUrl = null;
    if (mode === "analysis" && workspaceId && supabaseAdmin) {
      const { data: gr } = await supabaseAdmin.from("graphs").select("repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      repoUrl = gr?.repo_url ?? null;
      const { rootPath: resolved, error } = await ensureProjectRoot(
        workspaceId,
        graph,
        repoUrl
      );
      if (resolved !== null) rootPath = resolved;
      else if (error && rootPath === null) {
        setTaskFailed(task.taskId, error);
        return;
      }
    }
    let feedbackContext;
    if (req.user?.id) {
      try {
        const { downvoteCount } = await getRecentFeedbackForUser(req.user.id);
        if (downvoteCount > 0) {
          feedbackContext = `Note: The user has downvoted ${downvoteCount} architecture answer(s) in the last 7 days. Prefer concise, actionable responses and avoid overly long explanations.`;
        }
      } catch {
      }
    }
    const sessionIdForDraft = greenfieldSessionId;
    runArchitectureTask({
      question,
      graph,
      nodeId,
      history,
      mode,
      apiKeyOpenAI: process.env.OPENAI_API_KEY,
      apiKeyClaude: process.env.ANTHROPIC_API_KEY,
      findings,
      rootPath,
      jiraConfig,
      jiraProjectKey: jiraProjectKey ?? void 0,
      feedbackContext,
      ...pdfBase64 && typeof pdfBase64 === "string" ? { pdfBase64, pdfFileName: typeof pdfFileName === "string" ? pdfFileName : "document.pdf" } : {}
    }).then(async (result) => {
      if (isTaskCancelled(task.taskId)) return;
      if (mode === "greenfield" && sessionIdForDraft && typeof sessionIdForDraft === "string" && (result.graphCommands?.length || result.graphCommand)) {
        const cmds = result.graphCommands ?? (result.graphCommand ? [result.graphCommand] : []);
        const nodes = [];
        const edges = [];
        for (const cmd of cmds) {
          if (cmd.action === "create_node" && "id" in cmd) {
            nodes.push({
              id: cmd.id,
              label: cmd.label ?? cmd.id,
              layer: "layer" in cmd ? cmd.layer : void 0,
              description: "description" in cmd ? cmd.description : void 0,
              archNodeId: "archNodeId" in cmd ? cmd.archNodeId : void 0,
              skeletonCode: "skeletonCode" in cmd && typeof cmd.skeletonCode === "string" ? cmd.skeletonCode : void 0,
              layoutHint: "layoutHint" in cmd && typeof cmd.layoutHint === "string" ? cmd.layoutHint : void 0,
              group: "group" in cmd && typeof cmd.group === "string" ? cmd.group : void 0
            });
          }
          if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
            edges.push({ source: cmd.fromId, target: cmd.toId });
          }
        }
        if (nodes.length > 0 || edges.length > 0) {
          try {
            saveDraft(sessionIdForDraft, { nodes, edges, workspaceId: workspaceId ?? void 0 });
            if (supabaseAdmin && workspaceId && (result.criticScore ?? 0) >= 6 && (result.answer?.length ?? 0) > 30) {
              const designSummary = `Greenfield design: ${nodes.length} nodes (${nodes.map((n) => n.label || n.id).join(", ")}), ${edges.length} edges. ${(result.answer ?? "").slice(0, 300).replace(/\n/g, " ")}`;
              supabaseAdmin.from("workspace_memories").insert({
                workspace_id: workspaceId,
                content: designSummary,
                memory_type: "greenfield_design",
                node_id: null
              }).then(
                void 0,
                (e) => console.warn("[chat-async] greenfield memory insert:", e instanceof Error ? e.message : e)
              );
            }
          } catch {
          }
        }
      }
      const tu = result.tokenUsage;
      if (tu && (process.env.METRICS_LOG === "1" || process.env.TOKEN_LOG === "1")) {
        const in_ = tu.agentInput ?? 0;
        const out_ = tu.agentOutput ?? 0;
        console.log(`[chat-async] tokens in=${in_} out=${out_} total=${in_ + out_}`);
      }
      let railsForResult = result.rails;
      if (isExecutionIntent && workspaceId && req.user?.id) {
        try {
          const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user.id, 3);
          if (startedRails.length > 0) {
            railsForResult = startedRails;
            addRailsToSession(threadId ?? void 0, workspaceId, req.user.id, startedRails.map((r) => r.id));
          }
        } catch {
        }
      }
      const analysisRailIdAsync = maybeCreateAnalysisRail({
        mode,
        rootPath,
        question,
        result: {
          answer: result.answer,
          criticScore: result.criticScore ?? null,
          criticReport: result.criticReport ?? null,
          violations: result.violations ?? [],
          traceId: result.traceId ?? null,
          proposal: result.proposal
        },
        userId: req.user?.id,
        workspaceId: workspaceId ?? null,
        repoUrl
      });
      const allRailsAsync = [
        ...analysisRailIdAsync ? [{ id: analysisRailIdAsync }] : [],
        ...railsForResult ?? []
      ];
      const railsDedupedAsync = Array.from(new Map(allRailsAsync.map((r) => [r.id, r])).values());
      if (analysisRailIdAsync && workspaceId && req.user?.id) {
        addRailsToSession(threadId ?? void 0, workspaceId, req.user.id, [analysisRailIdAsync]);
      }
      setTaskCompleted(task.taskId, {
        answer: result.answer,
        graphCommands: result.graphCommands,
        graphCommand: result.graphCommand,
        criticReport: result.criticReport,
        criticScore: result.criticScore,
        acceptanceCriteria: result.acceptanceCriteria,
        archetype: result.archetype,
        violations: result.violations ?? [],
        traceId: result.traceId,
        tokenUsage: tu,
        rails: railsDedupedAsync.length > 0 ? railsDedupedAsync : railsForResult,
        railIds: railsDedupedAsync.map((r) => r.id),
        boardHint: workspaceId && railsDedupedAsync.length > 0 ? { workspaceId } : void 0,
        // Explainability metadata from manager, if present.
        reasoningTrace: result.reasoningTrace,
        citations: result.citations,
        confidenceScore: result.confidenceScore,
        suggestedActions: result.suggestedActions
      });
      if (supabaseAdmin && workspaceId && (result.violations ?? []).length > 0) {
        upsertViolations(supabaseAdmin, {
          workspaceId,
          violations: result.violations ?? [],
          rulesVersion: ARCH_RULESET_VERSION,
          markAbsent: false
          // Chat returns question-scoped violations only; do not clear others.
        }).then(() => recordScanSnapshot(supabaseAdmin, workspaceId, ARCH_RULESET_VERSION)).catch((err) => {
          console.error("[chat-async] violationStore upsert failed:", err);
        });
      }
      if (supabaseAdmin && workspaceId && result.answer?.trim()) {
        try {
          await supabaseAdmin.from("conversation_snapshots").insert({
            workspace_id: workspaceId,
            node_id: nodeId ?? null,
            intent_summary: question.slice(0, 500),
            outcome_summary: result.answer.slice(0, 500)
          });
        } catch {
          if (process.env.METRICS_LOG === "1") {
            console.warn("[chat] conversation_snapshots insert skipped (async)");
          }
        }
      }
      if (supabaseAdmin && workspaceId && threadId && typeof threadId === "string") {
        const toAppend = [
          { role: "user", content: question },
          { role: "assistant", content: (result.answer ?? "").slice(0, 1e4) }
        ];
        if (result.criticReport?.trim()) {
          toAppend.push({ role: "assistant", content: `Critic: ${result.criticReport}`.slice(0, 1e4) });
        }
        const autoTitle = question.slice(0, 60).trim();
        supabaseAdmin.from("chat_messages").insert(
          toAppend.map((m) => ({
            thread_id: threadId,
            role: m.role,
            content: m.content
          }))
        ).then(async () => {
          if (!supabaseAdmin) return;
          const update = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
          const { data: thread } = await supabaseAdmin.from("chat_threads").select("title").eq("id", threadId).eq("workspace_id", workspaceId).single();
          if (thread?.title === "New chat" && autoTitle) {
            update.title = autoTitle.slice(0, 200);
          }
          await supabaseAdmin.from("chat_threads").update(update).eq("id", threadId).eq("workspace_id", workspaceId);
        }).then(void 0, (e) => console.warn("[chat] thread persist:", e instanceof Error ? e.message : e));
      }
    }).catch((err) => {
      const traceId = err instanceof ArchError ? err.traceId : void 0;
      logArchError(err, traceId, "chat-async");
      try {
        setTaskFailed(task.taskId, toUserMessage(err, traceId));
      } catch {
      }
    });
  })();
});

// src/fileContent.ts
import { Router as Router8 } from "express";
var router9 = Router8();
function parseRepoUrl(url) {
  const m = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}
router9.post("/file-content", async (req, res) => {
  const { repoUrl, filePath } = req.body;
  if (!repoUrl || typeof repoUrl !== "string" || !filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "repoUrl and filePath are required" });
    return;
  }
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    res.status(400).json({ error: "Invalid GitHub URL" });
    return;
  }
  const { owner, repo } = parsed;
  const branch = "main";
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
    const headers = {
      Accept: "application/vnd.github.raw"
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(rawUrl, { headers });
    if (!r.ok) {
      if (r.status === 404) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      res.status(r.status).json({ error: `Failed to fetch: ${r.statusText}` });
      return;
    }
    const content = await r.text();
    res.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// src/validate.ts
import { Router as Router9 } from "express";
import { spawnSync as spawnSync5 } from "child_process";
import * as path33 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
var __dirname4 = path33.dirname(fileURLToPath4(import.meta.url));
var projectRoot2 = path33.resolve(__dirname4, "../../..");
var router10 = Router9();
router10.post("/validate", async (req, res) => {
  const { repoUrl, createJira } = req.body;
  if (!repoUrl || typeof repoUrl !== "string") {
    res.status(400).json({ error: "repoUrl is required" });
    return;
  }
  const trimmed = repoUrl.trim();
  if (!trimmed.match(/github\.com[/:]/i)) {
    res.status(400).json({ error: "Use a GitHub URL, e.g. https://github.com/owner/repo" });
    return;
  }
  try {
    const args = ["tsx", "scripts/validate-repo.ts", trimmed];
    if (createJira) args.push("--jira");
    const proc = spawnSync5("npx", args, {
      cwd: projectRoot2,
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env }
    });
    if (proc.status !== 0) {
      const errMsg = proc.stderr?.trim() || proc.error?.message || "Validation failed";
      return res.status(500).json({ error: errMsg });
    }
    const data = JSON.parse(proc.stdout?.trim() || "{}");
    res.json(data);
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? err.stderr : null;
    const message = stderr ? Buffer.isBuffer(stderr) ? stderr.toString() : String(stderr) : err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Validation failed" });
  }
});

// src/integrationRoutes.ts
import { Router as Router10 } from "express";
var router11 = Router10();
router11.get("/integrations", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("integrations").select("id, provider, base_url, email, default_project, verified, verified_at, last_error, created_at").eq("user_id", req.user.id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ integrations: data ?? [] });
});
router11.post("/integrations/jira", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { baseUrl, email, apiToken, defaultProject } = req.body;
  if (!baseUrl || typeof baseUrl !== "string" || !email || typeof email !== "string" || !apiToken || typeof apiToken !== "string") {
    res.status(400).json({ error: "baseUrl, email, and apiToken are required" });
    return;
  }
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
  const projectKey = defaultProject?.trim().toUpperCase() || null;
  if (projectKey && !isValidProjectKey(projectKey)) {
    res.status(400).json({
      error: "Project key must be 2\u201310 chars, start with a letter, no trailing hyphen (e.g. PROJ)"
    });
    return;
  }
  try {
    const testRes = await fetch(`${normalizedBaseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
        Accept: "application/json"
      }
    });
    if (!testRes.ok) {
      const body = await testRes.json().catch(() => ({}));
      const msg = body?.errorMessages?.[0] ?? body?.message ?? "Invalid credentials";
      res.status(400).json({
        error: `Jira auth failed (${testRes.status}): ${msg}`
      });
      return;
    }
    const jiraUser = await testRes.json();
    let encryptedToken;
    try {
      encryptedToken = encrypt(apiToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({
        error: "Server misconfigured: cannot encrypt token. " + msg
      });
      return;
    }
    const { error: upsertErr } = await supabaseAdmin.from("integrations").upsert(
      {
        user_id: req.user.id,
        provider: "jira",
        base_url: normalizedBaseUrl,
        email: email.trim(),
        api_token: encryptedToken,
        default_project: projectKey,
        verified: true,
        verified_at: (/* @__PURE__ */ new Date()).toISOString(),
        last_error: null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      { onConflict: "user_id,provider" }
    );
    if (upsertErr) {
      res.status(500).json({ error: upsertErr.message });
      return;
    }
    res.json({
      success: true,
      jiraUser: { displayName: jiraUser.displayName, accountId: jiraUser.accountId }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    res.status(500).json({ error: message });
  }
});
router11.delete("/integrations/jira", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  await supabaseAdmin.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "jira");
  res.json({ success: true });
});

// src/scaffold.ts
import { Router as Router11 } from "express";
import path34 from "path";
import * as fs30 from "fs";
var router12 = Router11();
router12.post("/scaffold-node", requireUser, async (req, res) => {
  const { projectRoot: projectRoot5, archNodeId, relPath, layer, kind } = req.body;
  if (!projectRoot5 || !archNodeId || !relPath) {
    res.status(400).json({
      error: "projectRoot, archNodeId, and relPath are required."
    });
    return;
  }
  try {
    const root = path34.resolve(projectRoot5);
    const absPath = path34.join(root, relPath);
    const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
    const targetDir = pathLooksLikeFile ? path34.dirname(absPath) : absPath;
    if (!fs30.existsSync(targetDir)) {
      fs30.mkdirSync(targetDir, { recursive: true });
    }
    const indexPath = pathLooksLikeFile ? absPath : path34.join(absPath, "index.ts");
    const header = `// @archNodeId: ${archNodeId}`;
    const boilerplate = `

// TODO: Implement ${kind ?? "module"} for layer ${layer ?? "Uncategorized"}.

export function TODO_${archNodeId.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}() {
  // implementation pending
}
`;
    if (fs30.existsSync(indexPath)) {
      const existing = fs30.readFileSync(indexPath, "utf-8");
      if (!existing.includes("@archNodeId:")) {
        fs30.writeFileSync(indexPath, `${header}
${existing}`, "utf-8");
      }
    } else {
      fs30.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
    }
    const rel = path34.relative(root, indexPath).replace(/\\/g, "/");
    res.json({ message: `Scaffolded node at ${rel}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// src/materialize.ts
import { Router as Router12 } from "express";
import * as fs32 from "fs";
import * as path36 from "path";
import { randomUUID as randomUUID2 } from "node:crypto";

// ../../src/agent/rail/greenfieldSpecGeneration.ts
import * as fs31 from "fs";
import * as path35 from "path";
var MAX_TEST_NAME_LEN = 80;
function truncateAtWord(text, maxLen) {
  const safe = text.replace(/"/g, "'").trim();
  if (safe.length <= maxLen) return safe;
  const cut = safe.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut;
}
function criterionToAssertion(c) {
  const lower = c.toLowerCase().replace(/\n/g, " ");
  if (/\bbutton\b/.test(lower) || /\bclick\b/.test(lower)) {
    const match = c.match(/(?:button|click)\s+["']?([^"'\n]+)["']?/i) ?? c.match(/"([^"]+)"/);
    const label = match?.[1]?.trim() ?? lower.split(/\s+/).filter((w) => w.length > 3).slice(-2)[0] ?? "button";
    return `await expect(page.getByRole('button', { name: /${escapeRe(label)}/i })).toBeVisible();`;
  }
  if (/\blink\b/.test(lower)) {
    const match = c.match(/(?:link|to)\s+["']?([^"'\n]+)["']?/i) ?? c.match(/"([^"]+)"/);
    const label = match?.[1]?.trim() ?? lower.split(/\s+/).filter((w) => w.length > 3).slice(-2)[0] ?? "link";
    return `await expect(page.getByRole('link', { name: /${escapeRe(label)}/i })).toBeVisible();`;
  }
  if (/\bform\b/.test(lower)) {
    return `await expect(page.locator('form')).toBeVisible();`;
  }
  if (/\binput\b/.test(lower) || /\b(?:text|search)\s+field\b/.test(lower)) {
    return `await expect(page.getByRole('textbox').or(page.getByRole('searchbox')).first()).toBeVisible();`;
  }
  const words = lower.split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|can|should|user|page|must|has|have|that|this|with|from|into)$/i.test(w));
  const phrase = words.slice(0, 4).join(" ");
  if (phrase) {
    return `await expect(page.getByText(/${escapeRe(phrase)}/i).first()).toBeVisible();`;
  }
  return `await expect(page.locator('body')).toBeVisible();`;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function generatePlaywrightSpecFromCriteria(acceptanceCriteriaFunctional, options = {}) {
  const baseUrl = options.baseUrl ? `'${options.baseUrl.replace(/'/g, "\\'")}'` : "process.env.APP_URL ?? 'http://localhost:3000'";
  const criteria = acceptanceCriteriaFunctional.filter((c) => typeof c === "string" && c.trim());
  const blocks = criteria.map((c, i) => {
    const testName = truncateAtWord(c, MAX_TEST_NAME_LEN);
    const assertion = criterionToAssertion(c);
    return `  test('${i + 1}. ${testName}', async ({ page }) => {
    const response = await page.goto(${baseUrl});
    expect(response?.ok()).toBeTruthy();
    ${assertion}
  });`;
  });
  return `// Generated by Arch Visualizer from greenfield acceptance criteria. Do not edit by hand.
import { test, expect } from '@playwright/test';

test.describe('Greenfield acceptance (functional)', () => {
${blocks.join("\n\n")}
});
`;
}
var DEFAULT_SPEC_RELATIVE = "scripts/greenfield-generated.spec.ts";
function writeGeneratedSpecToSandbox(sandboxPath, acceptanceCriteriaFunctional, specRelativePath = DEFAULT_SPEC_RELATIVE) {
  const content = generatePlaywrightSpecFromCriteria(acceptanceCriteriaFunctional);
  const fullPath = path35.join(sandboxPath, specRelativePath);
  const dir = path35.dirname(fullPath);
  if (!fs31.existsSync(dir)) {
    fs31.mkdirSync(dir, { recursive: true });
  }
  fs31.writeFileSync(fullPath, content, "utf-8");
  return path35.resolve(fullPath);
}

// ../../src/agent/rail/greenfieldMaterialize.ts
var GREENFIELD_MATERIALIZE_ARCHETYPE = "greenfield-materialize";
function materializeGreenfieldRail(params) {
  const { rootPath, sessionId: sessionId2, outcome, nodes } = params;
  const trigger = {
    source: "chat",
    userMessage: outcome,
    sessionId: sessionId2
  };
  const now = Date.now();
  const railId = `rail-greenfield-${now}`;
  const rail = {
    id: railId,
    version: 1,
    outcome,
    trigger,
    archetype: GREENFIELD_MATERIALIZE_ARCHETYPE,
    logicPath: [],
    state: "PLANNING",
    activeAgent: null,
    tasks: [],
    jiraKeys: [],
    traceIds: [],
    overlaps: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "human",
    sessionId: sessionId2
  };
  createRail(rootPath, rail);
  const toExec = transitionRail(rootPath, railId, "EXECUTING", { planApproved: true });
  if (!toExec.ok || !toExec.rail) return null;
  const sandboxPath = getSandboxPath(rootPath, railId);
  ensureSandbox(rootPath, railId);
  const { created, errors } = writeProposedNodesToSandbox(sandboxPath, nodes);
  if (errors.length > 0 && created.length === 0) {
    return null;
  }
  if (params.acceptanceCriteria?.functional?.length) {
    try {
      writeGeneratedSpecToSandbox(sandboxPath, params.acceptanceCriteria.functional);
    } catch {
    }
  }
  const toVerifying = transitionRail(rootPath, railId, "VERIFYING");
  if (!toVerifying.ok) return getRail(rootPath, railId);
  const current = getRail(rootPath, railId);
  if (!current) return null;
  const partial = {};
  if (params.acceptanceCriteria) partial.acceptanceCriteria = params.acceptanceCriteria;
  if (params.lastCritique) {
    partial.lastCritique = {
      source: "reviewer",
      message: params.lastCritique.message,
      createdAt: now,
      criticScore: params.lastCritique.criticScore,
      violations: Array.isArray(params.lastCritique.violations) ? params.lastCritique.violations.map((v) => {
        const o = v;
        return {
          type: String(o.type ?? ""),
          severity: String(o.severity ?? ""),
          description: String(o.description ?? "")
        };
      }) : void 0
    };
  }
  const updated = Object.keys(partial).length > 0 ? updateRailPartial(rootPath, railId, partial) : current;
  return updated ?? current;
}
function approveGreenfieldMaterialize(rootPath, railId) {
  const rail = getRail(rootPath, railId);
  if (!rail || rail.archetype !== GREENFIELD_MATERIALIZE_ARCHETYPE) return null;
  return completeMaterializeAndArchive(rootPath, railId);
}

// src/materialize.ts
var router13 = Router12();
var idempotencyCache = /* @__PURE__ */ new Map();
var IDEMPOTENCY_TTL_MS = 60 * 60 * 1e3;
function isPathSafe2(root, relPath) {
  const resolved = path36.resolve(root, relPath);
  const rootNorm = path36.resolve(root);
  return resolved.startsWith(rootNorm) && resolved !== rootNorm;
}
function validateTargetRoot(targetRoot) {
  const root = path36.resolve(targetRoot.trim());
  if (!root || root === "/" || root.length < 2) {
    return { error: "targetRoot must be a valid project directory path." };
  }
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path36.resolve(baseDir);
    if (!root.startsWith(baseNorm + path36.sep) && root !== baseNorm) {
      return { error: "targetRoot must be within the allowed projects directory." };
    }
  }
  return { root };
}
var MATERIALIZE_MAX_CHANGED_FILES = typeof process.env.MATERIALIZE_MAX_CHANGED_FILES === "string" && !Number.isNaN(Number(process.env.MATERIALIZE_MAX_CHANGED_FILES)) ? Math.max(1, Number(process.env.MATERIALIZE_MAX_CHANGED_FILES)) : 200;
var MATERIALIZE_MAX_TOTAL_BYTES = typeof process.env.MATERIALIZE_MAX_TOTAL_BYTES === "string" && !Number.isNaN(Number(process.env.MATERIALIZE_MAX_TOTAL_BYTES)) ? Math.max(1e4, Number(process.env.MATERIALIZE_MAX_TOTAL_BYTES)) : 5e5;
function computeSandboxDiffSize(root, railId) {
  const sandboxPath = getSandboxPath(root, railId);
  if (!fs32.existsSync(sandboxPath)) {
    return { changedFiles: 0, totalBytes: 0 };
  }
  let changedFiles = 0;
  let totalBytes = 0;
  const walk = (dir) => {
    const entries = fs32.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path36.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        const rel = path36.relative(sandboxPath, full);
        if (!rel || rel.endsWith("/")) continue;
        const sandboxFile = full;
        const rootFile = path36.join(root, rel);
        let before;
        let after;
        try {
          if (fs32.existsSync(rootFile) && fs32.statSync(rootFile).isFile()) {
            before = fs32.readFileSync(rootFile, "utf-8");
          }
        } catch {
        }
        try {
          after = fs32.readFileSync(sandboxFile, "utf-8");
        } catch {
        }
        if (before === after) continue;
        changedFiles += 1;
        if (after) {
          totalBytes += Buffer.byteLength(after, "utf-8");
        }
      }
    }
  };
  try {
    walk(sandboxPath);
  } catch {
    return { changedFiles: 0, totalBytes: 0 };
  }
  return { changedFiles, totalBytes };
}
function runMaterialize(root, nodes) {
  const created = [];
  const errors = [];
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : "";
    const label = typeof node.label === "string" ? node.label : id;
    const archNodeId = typeof node.archNodeId === "string" ? node.archNodeId : id;
    const relPath = id || archNodeId || label.replace(/\s+/g, "-").toLowerCase();
    if (!relPath || /\.\.|\\\\|\/\//.test(relPath)) {
      errors.push(`Invalid path for node ${label}: ${relPath}`);
      continue;
    }
    if (!isPathSafe2(root, relPath)) {
      errors.push(`Path traversal blocked for ${label}`);
      continue;
    }
    try {
      const absPath = path36.join(root, relPath);
      const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
      const targetDir = pathLooksLikeFile ? path36.dirname(absPath) : absPath;
      if (!fs32.existsSync(targetDir)) {
        fs32.mkdirSync(targetDir, { recursive: true });
      }
      const indexPath = pathLooksLikeFile ? absPath : path36.join(absPath, "index.ts");
      const layer = typeof node.layer === "string" ? node.layer : "Uncategorized";
      const header = `// Generated by Arch Visualizer. Boilerplate only \u2014 implement as needed.
// @archNodeId: ${archNodeId}`;
      const hasSkeleton = typeof node.skeletonCode === "string" && (node.skeletonCode?.trim().length ?? 0) > 0;
      const body = hasSkeleton ? `

${node.skeletonCode.trim()}
` : `

// TODO: Implement ${label} (${layer}).

export function TODO_${archNodeId.replace(
        /[^a-zA-Z0-9_]/g,
        "_"
      )}() {
  // implementation pending
}
`;
      if (fs32.existsSync(indexPath)) {
        const existing = fs32.readFileSync(indexPath, "utf-8");
        if (!existing.includes("@archNodeId:")) {
          fs32.writeFileSync(indexPath, `${header}
${existing}`, "utf-8");
        }
      } else {
        fs32.writeFileSync(indexPath, `${header}${body}`, "utf-8");
      }
      const rel = path36.relative(root, indexPath).replace(/\\/g, "/");
      created.push(rel);
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const success = errors.length === 0;
  if (success && created.length > 0) {
    try {
      const agentDir = path36.join(root, ".agent");
      if (!fs32.existsSync(agentDir)) fs32.mkdirSync(agentDir, { recursive: true });
      const templatesPath = path36.join(agentDir, "design_templates.json");
      const existing = fs32.existsSync(
        templatesPath
      ) ? JSON.parse(fs32.readFileSync(templatesPath, "utf-8")) : { designs: [] };
      const designs = Array.isArray(existing.designs) ? existing.designs : [];
      designs.push({ nodes, createdAt: Date.now() });
      fs32.writeFileSync(templatesPath, JSON.stringify({ designs: designs.slice(-20) }, null, 2), "utf-8");
    } catch {
    }
  }
  recordMaterializeMetrics({
    timestamp: Date.now(),
    nodeCount: nodes.length,
    createdCount: created.length,
    errorCount: errors.length,
    success
  });
  return {
    message: `Materialized ${created.length} node(s).`,
    created,
    errors: errors.length > 0 ? errors : void 0
  };
}
router13.post("/materialize", requireUser, async (req, res) => {
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  const { targetRoot, nodes } = req.body;
  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where the architecture should be created."
    });
    return;
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    res.status(400).json({
      error: "nodes is required and must be a non-empty array of proposed nodes."
    });
    return;
  }
  if (nodes.length > 30) {
    res.status(400).json({
      error: "Maximum 30 nodes per materialize. Split into smaller batches."
    });
    return;
  }
  if (idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.result);
    }
  }
  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;
  const result = runMaterialize(root, nodes);
  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, {
      result,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
    });
    const now = Date.now();
    for (const [k, v] of idempotencyCache.entries()) {
      if (v.expiresAt < now) idempotencyCache.delete(k);
    }
  }
  res.json(result);
});
router13.post("/materialize/undo", requireUser, async (req, res) => {
  const { targetRoot, created } = req.body;
  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where files were materialized."
    });
    return;
  }
  if (!Array.isArray(created) || created.length === 0) {
    res.status(400).json({
      error: "created is required and must be a non-empty array of relative paths to delete."
    });
    return;
  }
  if (created.length > 100) {
    res.status(400).json({
      error: "Maximum 100 paths per undo. Split into smaller batches."
    });
    return;
  }
  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;
  const deleted = [];
  const errors = [];
  for (const rel of created) {
    if (typeof rel !== "string" || !rel.trim()) continue;
    const trimmed = rel.trim().replace(/\\/g, "/");
    if (/\.\.|\\\\|\/\//.test(trimmed)) {
      errors.push(`Invalid path: ${trimmed}`);
      continue;
    }
    if (!isPathSafe2(root, trimmed)) {
      errors.push(`Path traversal blocked: ${trimmed}`);
      continue;
    }
    try {
      const absPath = path36.join(root, trimmed);
      if (fs32.existsSync(absPath)) {
        const stat = fs32.statSync(absPath);
        if (stat.isFile()) {
          fs32.unlinkSync(absPath);
          deleted.push(trimmed);
        } else if (stat.isDirectory()) {
          fs32.rmSync(absPath, { recursive: true, force: true });
          deleted.push(trimmed);
        }
      }
    } catch (err) {
      errors.push(`${trimmed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const dirsToCheck = /* @__PURE__ */ new Set();
  for (const rel of deleted) {
    let d = path36.dirname(rel);
    while (d && d !== ".") {
      dirsToCheck.add(d);
      d = path36.dirname(d);
    }
  }
  const sortedDirs = [...dirsToCheck].sort((a, b) => b.split(path36.sep).length - a.split(path36.sep).length);
  for (const dirRel of sortedDirs) {
    try {
      const absDir = path36.join(root, dirRel);
      if (fs32.existsSync(absDir) && fs32.statSync(absDir).isDirectory()) {
        const entries = fs32.readdirSync(absDir);
        if (entries.length === 0) {
          fs32.rmdirSync(absDir);
        }
      }
    } catch {
    }
  }
  res.json({
    message: `Undid materialization: removed ${deleted.length} path(s).`,
    deleted,
    errors: errors.length > 0 ? errors : void 0
  });
});
router13.post("/materialize-async", requireUser, async (req, res) => {
  const { targetRoot, nodes, useRailFlow, sessionId: sessionId2, outcome, acceptanceCriteria, lastCritique } = req.body;
  if (!targetRoot || typeof targetRoot !== "string" || targetRoot.trim() === "") {
    res.status(400).json({
      error: "targetRoot is required. Provide the folder path where the architecture should be created."
    });
    return;
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    res.status(400).json({
      error: "nodes is required and must be a non-empty array of proposed nodes."
    });
    return;
  }
  if (nodes.length > 30) {
    res.status(400).json({
      error: "Maximum 30 nodes per materialize. Split into smaller batches."
    });
    return;
  }
  const validated = validateTargetRoot(targetRoot);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { root } = validated;
  if (useRailFlow && sessionId2 && typeof sessionId2 === "string" && outcome && typeof outcome === "string") {
    const rail = materializeGreenfieldRail({
      rootPath: root,
      sessionId: sessionId2,
      outcome,
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        layer: n.layer,
        archNodeId: n.archNodeId ?? n.id,
        skeletonCode: n.skeletonCode
      })),
      acceptanceCriteria: acceptanceCriteria ? {
        functional: Array.isArray(acceptanceCriteria.functional) ? acceptanceCriteria.functional : [],
        visual: Array.isArray(acceptanceCriteria.visual) ? acceptanceCriteria.visual : [],
        architectural: Array.isArray(acceptanceCriteria.architectural) ? acceptanceCriteria.architectural : []
      } : void 0,
      lastCritique: lastCritique ? {
        criticScore: lastCritique.criticScore,
        message: lastCritique.message ?? "",
        violations: lastCritique.violations
      } : void 0
    });
    if (!rail) {
      res.status(500).json({ error: "Failed to create greenfield materialize rail." });
      return;
    }
    const task2 = createTask2();
    res.status(202).json({
      taskId: task2.taskId,
      status: "pending",
      railId: rail.id,
      useRailFlow: true
    });
    setTaskRunning(task2.taskId);
    const sandboxPath = getSandboxPath(root, rail.id);
    const specPath = "scripts/greenfield-generated.spec.ts";
    const baseUrl = (process.env.APP_URL?.trim() || "http://localhost:3000").trim();
    const maxRetries = Number(process.env.GREENFIELD_VERIFY_MAX_RETRIES ?? "2") || 2;
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    Promise.resolve().then(async () => {
      if (isTaskCancelled(task2.taskId)) return;
      const verificationTaskId = `verify-${randomUUID2()}`;
      createTask({
        id: verificationTaskId,
        railId: rail.id,
        kind: "verification",
        description: "Run Playwright greenfield-generated spec",
        files: [specPath],
        autoCapable: true,
        status: "executing",
        agent: "reviewer",
        logicStep: 0,
        createdAt: Date.now()
      });
      const attempts = [];
      let attempt = 0;
      let pw = await runPlaywrightForRail(rail.id, root, sandboxPath, [specPath], baseUrl);
      while (!pw.passed && attempt < maxRetries && !isTaskCancelled(task2.taskId) && apiKey) {
        attempts.push({
          attempt: attempt + 1,
          passed: pw.passed,
          failures: pw.failures?.map((f) => ({
            testName: f.testName,
            error: f.error,
            screenshotPath: f.screenshotPath
          })) ?? []
        });
        const errorOutput = JSON.stringify(
          {
            message: "Playwright failures",
            spec: pw.spec,
            failures: pw.failures?.slice(0, 5)
          },
          null,
          2
        );
        const railForFix = getRail(root, rail.id) ?? void 0;
        const firstNode = nodes[0];
        const modulePath = firstNode?.archNodeId ?? firstNode?.id ?? "src";
        const plan = {
          goal: `${outcome} \u2014 fix Playwright failures for greenfield materialize`,
          tasks: [
            {
              id: `gf-fix-${attempt + 1}`,
              module: modulePath,
              layer: "Uncategorized",
              action: "modify",
              expectedOutput: "Update implementation so the generated Playwright spec passes."
            }
          ],
          dependencies: []
        };
        await runTaskAtIndex(plan, 0, sandboxPath, {
          apiKey,
          errorOutput,
          rail: railForFix ?? void 0,
          railHistory: []
        });
        if (isTaskCancelled(task2.taskId)) return;
        pw = await runPlaywrightForRail(rail.id, root, sandboxPath, [specPath], baseUrl);
        attempt += 1;
      }
      const finalPw = pw;
      const evidence = JSON.stringify(
        {
          passed: finalPw.passed,
          spec: finalPw.spec,
          tracePath: finalPw.tracePath,
          failures: finalPw.failures?.map((f) => ({
            testName: f.testName,
            error: f.error,
            screenshotPath: f.screenshotPath
          })),
          attempts
        },
        null,
        2
      );
      updateTaskEvidence(verificationTaskId, evidence);
      updateTaskStatus(verificationTaskId, finalPw.passed ? "completed" : "rejected");
      updateRailPartial(root, rail.id, {
        lastCritique: {
          source: "playwright",
          message: finalPw.passed ? "Playwright verification passed after self-correction." : "Playwright verification failed after self-correction attempts.",
          createdAt: Date.now()
        }
      });
      if (isTaskCancelled(task2.taskId)) return;
      setTaskCompleted(task2.taskId, {
        message: finalPw.passed ? "Verification passed. You can approve materialization to copy changes to your project." : "Verification failed after self-correction attempts. Review the Playwright failures; approval is blocked until verification passes.",
        created: [],
        railId: rail.id,
        verification: finalPw,
        verificationPassed: finalPw.passed,
        verificationAttempts: attempts,
        recommendRescan: true
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      updateRailPartial(root, rail.id, {
        lastCritique: {
          source: "playwright",
          message: `Verification error: ${msg}`,
          createdAt: Date.now()
        }
      });
      setTaskFailed(task2.taskId, msg);
    });
    return;
  }
  const task = createTask2();
  res.status(202).json({ taskId: task.taskId, status: "pending" });
  setTaskRunning(task.taskId);
  Promise.resolve().then(() => runMaterialize(root, nodes)).then((result) => {
    if (isTaskCancelled(task.taskId)) return;
    setTaskCompleted(task.taskId, {
      ...result,
      recommendRescan: true
    });
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    setTaskFailed(task.taskId, msg);
  });
});
router13.post("/materialize/approve", requireUser, async (req, res) => {
  const { rootPath, railId, force } = req.body;
  if (!rootPath || typeof rootPath !== "string" || !railId || typeof railId !== "string") {
    res.status(400).json({ error: "rootPath and railId are required." });
    return;
  }
  const validated = validateTargetRoot(rootPath);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const existing = getRail(validated.root, railId);
  if (!existing) {
    res.status(404).json({ error: "Rail not found or not loaded." });
    return;
  }
  const verifTasks = (existing.tasks ?? []).filter((t) => t.kind === "verification");
  const passed = verifTasks.length > 0 && verifTasks.every((t) => t.status === "completed");
  if (!passed) {
    res.status(409).json({
      error: "Verification has not passed yet. Approval is blocked until verification is completed successfully."
    });
    return;
  }
  if (!force) {
    const { changedFiles, totalBytes } = computeSandboxDiffSize(validated.root, railId);
    if (changedFiles > MATERIALIZE_MAX_CHANGED_FILES || totalBytes > MATERIALIZE_MAX_TOTAL_BYTES) {
      res.status(409).json({
        error: "This materialization would apply a very large diff. Review the changes in your editor and confirm before proceeding.",
        code: "MATERIALIZE_DIFF_TOO_LARGE",
        limits: {
          maxChangedFiles: MATERIALIZE_MAX_CHANGED_FILES,
          maxTotalBytes: MATERIALIZE_MAX_TOTAL_BYTES
        },
        actual: {
          changedFiles,
          totalBytes
        }
      });
      return;
    }
  }
  const rail = approveGreenfieldMaterialize(validated.root, railId);
  if (!rail) {
    res.status(404).json({ error: "Rail not found or not a greenfield materialize rail." });
    return;
  }
  completeTodosForRail(railId).catch(() => {
  });
  res.json({ rail, message: "Materialization complete. Rail archived." });
});

// src/auth.ts
import { Router as Router13 } from "express";
var router14 = Router13();
router14.post("/auth/debug-validate", async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token required in body" });
    return;
  }
  const supabaseUrl3 = process.env.SUPABASE_URL?.trim();
  if (supabaseAdmin) {
    try {
      const result = await supabaseAdmin.auth.getUser(token);
      const { data, error } = result;
      if (!error && data?.user) {
        return res.json({
          valid: true,
          userId: data.user.id,
          email: data.user.email,
          method: "getUser"
        });
      }
    } catch (_e) {
    }
  }
  if (supabaseUrl3) {
    try {
      const jose3 = await import("jose");
      const jwksUrl = `${supabaseUrl3}/auth/v1/.well-known/jwks.json`;
      const JWKS = jose3.createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jose3.jwtVerify(token, JWKS, {
        issuer: `${supabaseUrl3}/auth/v1`,
        audience: "authenticated"
      });
      const sub = payload.sub;
      return res.json({
        valid: true,
        userId: sub,
        email: payload.email,
        method: "JWKS"
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.json({
        valid: false,
        error: { message: msg },
        method: "JWKS"
      });
    }
  }
  res.status(503).json({ error: "Auth not configured", valid: false });
});
router14.get("/auth/config", (_req, res) => {
  const url = process.env.SUPABASE_URL?.trim();
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = url?.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? null;
  res.json({
    supabaseConfigured: !!(url && hasKey),
    projectRef: projectRef ?? void 0
  });
});
router14.get("/auth/me", requireUser, async (req, res) => {
  res.json({
    user: req.user
  });
});
router14.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

// src/workspaces.ts
import { Router as Router15 } from "express";

// src/activityLog.ts
import { Router as Router14 } from "express";
var router15 = Router14();
async function logWorkspaceActivity(supabase, params) {
  if (!supabase) return;
  try {
    await supabase.from("workspace_activity_log").insert({
      workspace_id: params.workspaceId,
      actor_id: params.actorId,
      actor_name: params.actorName ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? null
    });
  } catch {
  }
}
router15.get("/workspaces/:workspaceId/activity", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 100);
  const { data, error } = await supabaseAdmin.from("workspace_activity_log").select("id, actor_id, actor_name, action, entity_type, entity_id, metadata, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ activities: data ?? [] });
});

// src/nodeFileMapping.ts
function buildNodeFileMap(graph) {
  const map = /* @__PURE__ */ new Map();
  const nodes = graph.nodes ?? [];
  for (const n of nodes) {
    if (!n.id) continue;
    const rawFiles = n.files;
    let files;
    if (Array.isArray(rawFiles) && rawFiles.length > 0) {
      files = rawFiles;
    } else {
      const pathVal = n.path;
      files = pathVal ? [pathVal] : [n.id];
    }
    const primaryPath = files[0] ?? n.path ?? n.id;
    map.set(n.id, { nodeId: n.id, files, primaryPath });
  }
  return map;
}
function buildNodeFileMappingArray(graph) {
  return Array.from(buildNodeFileMap(graph).values());
}

// src/workspaces.ts
var router16 = Router15();
router16.get("/workspaces", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user.id;
  const { data: owned } = await supabaseAdmin.from("workspaces").select("id,name,created_at,thumbnail_base64").eq("owner_id", userId).is("archived_at", null).order("created_at", { ascending: false });
  const { data: memberRows } = await supabaseAdmin.from("workspace_members").select("workspace_id").eq("user_id", userId).neq("role", "owner");
  const memberWsIds = [...new Set((memberRows ?? []).map((r) => r.workspace_id))];
  const { data: shared } = memberWsIds.length > 0 ? await supabaseAdmin.from("workspaces").select("id,name,created_at,thumbnail_base64").in("id", memberWsIds).is("archived_at", null).order("created_at", { ascending: false }) : { data: [] };
  const seen = /* @__PURE__ */ new Set();
  const rows = [
    ...owned ?? [],
    ...(shared ?? []).filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    })
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 50);
  if (rows.length === 0) {
    res.json({ workspaces: [] });
    return;
  }
  const workspaceIds = rows.map((w) => w.id);
  const { data: graphRows } = await supabaseAdmin.from("graphs").select("workspace_id, updated_at, graph_json").in("workspace_id", workspaceIds).not("graph_json", "is", null).order("updated_at", { ascending: false });
  const latestByWorkspace = /* @__PURE__ */ new Map();
  for (const row of graphRows ?? []) {
    if (latestByWorkspace.has(row.workspace_id)) continue;
    const nodes = Array.isArray(row.graph_json?.nodes) ? row.graph_json.nodes : [];
    latestByWorkspace.set(row.workspace_id, {
      updated_at: row.updated_at,
      nodeCount: nodes.length
    });
  }
  const { data: violationRows } = await supabaseAdmin.from("violations").select("workspace_id").in("workspace_id", workspaceIds);
  const violationsByWorkspace = /* @__PURE__ */ new Map();
  for (const row of violationRows ?? []) {
    const key = row.workspace_id;
    const prev = violationsByWorkspace.get(key) ?? 0;
    violationsByWorkspace.set(key, prev + 1);
  }
  const enriched = rows.map((w) => {
    const latest = latestByWorkspace.get(w.id);
    const violationCount = violationsByWorkspace.get(w.id) ?? 0;
    const hasGraph = (latest?.nodeCount ?? 0) > 0;
    const healthScore = Math.max(
      0,
      Math.min(100, (hasGraph ? 80 : 20) - violationCount * 8)
    );
    return {
      ...w,
      last_scan_at: latest?.updated_at ?? null,
      node_count: latest?.nodeCount ?? 0,
      violation_count: violationCount,
      health_score: healthScore
    };
  });
  res.json({ workspaces: enriched });
});
router16.get("/workspaces/archived", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const { data, error } = await supabaseAdmin.from("workspaces").select("id,name,created_at,thumbnail_base64,archived_at").eq("owner_id", ownerId).not("archived_at", "is", null).order("archived_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ workspaces: data ?? [] });
});
router16.post("/workspaces", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspaces").insert({ owner_id: ownerId, name }).select("id,name,created_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  await supabaseAdmin.from("workspace_members").upsert(
    { workspace_id: data.id, user_id: ownerId, role: "owner" },
    { onConflict: "workspace_id,user_id" }
  );
  res.json({ workspace: data });
});
router16.get("/workspaces/:workspaceId/load", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, userId);
  } catch {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id, owner_id, jira_project_key, auto_execute_enabled, archived_at").eq("id", workspaceId).single();
  if (!ws || ws.archived_at) {
    res.status(404).json({ error: "Workspace archived." });
    return;
  }
  const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).not("graph_json", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (gErr) {
    res.status(500).json({ error: gErr.message });
    return;
  }
  if (!graphRow?.graph_json) {
    res.status(404).json({ error: "No graph saved for this workspace." });
    return;
  }
  const graph = graphRow.graph_json;
  const nodeIdsWithTraces = /* @__PURE__ */ new Set();
  const { data: traceRows } = await supabaseAdmin.from("model_traces").select("node_id").eq("workspace_id", workspaceId).not("node_id", "is", null);
  for (const row of traceRows ?? []) {
    const id = row.node_id;
    if (typeof id === "string" && id.trim()) nodeIdsWithTraces.add(id.trim());
  }
  if (graph?.nodes && Array.isArray(graph.nodes)) {
    for (const n of graph.nodes) {
      if (n?.id) n.hasTraces = nodeIdsWithTraces.has(n.id);
    }
  }
  const { data: sysModel } = await supabaseAdmin.from("workspace_system_models").select("system_model_json").eq("workspace_id", workspaceId).maybeSingle();
  const sysModelNodes = sysModel?.system_model_json?.nodes;
  if (sysModelNodes && graph?.nodes && Array.isArray(graph.nodes)) {
    const byId = new Map(sysModelNodes.map((m) => [m.id, m]));
    for (const n of graph.nodes) {
      const sm = n?.id ? byId.get(n.id) : void 0;
      if (sm) {
        n.domain = sm.domain;
        n.runtimeRoles = sm.runtimeRoles;
        n.tier = sm.tier;
      }
    }
  }
  const { data: viewsData } = await supabaseAdmin.from("workspace_views").select("slot,preset").eq("workspace_id", workspaceId).order("slot", { ascending: true });
  const { data: annotationsData } = await supabaseAdmin.from("workspace_annotations").select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  const workspaceOwnerId = ws.owner_id ?? null;
  res.json({
    graph,
    repoUrl: graphRow.repo_url ?? "",
    jiraProjectKey: ws.jira_project_key ?? null,
    autoExecuteEnabled: ws.auto_execute_enabled ?? false,
    views: viewsData ?? [],
    annotations: annotationsData ?? [],
    ownerId: workspaceOwnerId,
    isOwner: workspaceOwnerId === userId
  });
});
router16.get("/workspaces/:workspaceId/node-file-mapping", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (gErr || !graphRow?.graph_json) {
    res.status(404).json({ error: "No graph saved for this workspace." });
    return;
  }
  const graph = graphRow.graph_json;
  const mapping = buildNodeFileMappingArray(graph);
  res.json({ mapping });
});
router16.get("/workspaces/:workspaceId/views", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_views").select("slot,preset").eq("workspace_id", workspaceId).order("slot", { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ views: data ?? [] });
});
router16.post("/workspaces/:workspaceId/views", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { slot, preset } = req.body ?? {};
  if (typeof slot !== "number" || slot < 1 || slot > 5) {
    res.status(400).json({ error: "slot (1-5) is required" });
    return;
  }
  if (typeof preset !== "string" || !["top", "front", "side", "iso"].includes(preset)) {
    res.status(400).json({ error: "preset must be one of: top, front, side, iso" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { error } = await supabaseAdmin.from("workspace_views").upsert(
    { workspace_id: workspaceId, slot, preset },
    { onConflict: "workspace_id,slot" }
  );
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId: req.params.workspaceId,
    actorId: req.user?.id ?? null,
    actorName: req.user?.email ?? null,
    action: "view_saved",
    entityType: "view",
    metadata: { slot, preset }
  });
  res.json({ success: true });
});
router16.get("/workspaces/:workspaceId/annotations", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_annotations").select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ annotations: data ?? [] });
});
router16.post("/workspaces/:workspaceId/annotations", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { type, content, node_id, layer, canvas_x, canvas_y } = req.body ?? {};
  if (typeof type !== "string" || !["note", "highlight", "question"].includes(type)) {
    res.status(400).json({ error: "type must be one of: note, highlight, question" });
    return;
  }
  const payload = {
    workspace_id: workspaceId,
    type,
    content: typeof content === "string" ? content : "",
    author_id: req.user?.id ?? null
  };
  if (typeof node_id === "string" && node_id.trim()) payload.node_id = node_id.trim();
  else if (typeof layer === "string" && layer.trim()) payload.layer = layer.trim();
  else if (typeof canvas_x === "number" && typeof canvas_y === "number") {
    payload.canvas_x = canvas_x;
    payload.canvas_y = canvas_y;
  }
  const { data, error } = await supabaseAdmin.from("workspace_annotations").insert(payload).select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const ann = data;
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: req.user?.email ?? null,
    action: "annotation_created",
    entityType: "annotation",
    entityId: ann.id,
    metadata: { type: payload.type }
  });
  res.json({ annotation: data });
});
router16.patch("/workspaces/:workspaceId/annotations/:annotationId", requireUser, async (req, res) => {
  const { workspaceId, annotationId } = req.params;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId || !annotationId) {
    res.status(400).json({ error: "workspaceId and annotationId are required" });
    return;
  }
  const { type, content } = req.body ?? {};
  const updates = {};
  if (typeof type === "string" && ["note", "highlight", "question"].includes(type)) updates.type = type;
  if (typeof content === "string") updates.content = content;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide type and/or content to update" });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_annotations").update(updates).eq("id", annotationId).eq("workspace_id", workspaceId).select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: req.user?.email ?? null,
    action: "annotation_updated",
    entityType: "annotation",
    entityId: annotationId,
    metadata: updates
  });
  res.json({ annotation: data });
});
router16.delete("/workspaces/:workspaceId/annotations/:annotationId", requireUser, async (req, res) => {
  const { workspaceId, annotationId } = req.params;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId || !annotationId) {
    res.status(400).json({ error: "workspaceId and annotationId are required" });
    return;
  }
  const { error } = await supabaseAdmin.from("workspace_annotations").delete().eq("id", annotationId).eq("workspace_id", workspaceId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: req.user?.email ?? null,
    action: "annotation_deleted",
    entityType: "annotation",
    entityId: annotationId
  });
  res.json({ success: true });
});
router16.patch("/workspaces/:workspaceId/auto-execute", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { error: uErr } = await supabaseAdmin.from("workspaces").update({ auto_execute_enabled: enabled }).eq("id", workspaceId);
  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }
  res.json({ success: true, autoExecuteEnabled: enabled });
});
router16.get("/workspaces/:workspaceId/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const nodeId = req.query.nodeId?.trim() || null;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const limitParam = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 200);
  let query = supabaseAdmin.from("workspace_memories").select("id, workspace_id, node_id, content, memory_type, created_at").eq("workspace_id", workspaceId).is("superseded_at", null).order("created_at", { ascending: false }).limit(limitParam);
  if (nodeId) {
    query = query.eq("node_id", nodeId);
  }
  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ memories: data ?? [] });
});
router16.patch("/workspaces/:workspaceId/memories/:memoryId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const memoryId = req.params.memoryId;
  if (!workspaceId || !memoryId) {
    res.status(400).json({ error: "workspaceId and memoryId are required" });
    return;
  }
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : void 0;
  if (content === void 0) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > 5e3) {
    res.status(400).json({ error: "content must be at most 5000 characters" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_memories").update({ content }).eq("id", memoryId).eq("workspace_id", workspaceId).select("id, workspace_id, node_id, content, memory_type, created_at").single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: "Memory not found" });
  }
  return res.json({ memory: data });
});
router16.post("/workspaces/:workspaceId/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : void 0;
  const nodeId = (typeof req.body?.nodeId === "string" ? req.body.nodeId.trim() : void 0) || null;
  const supersedesId = (typeof req.body?.supersedesId === "string" ? req.body.supersedesId.trim() : void 0) || null;
  if (!workspaceId || !content) {
    res.status(400).json({ error: "workspaceId and content are required" });
    return;
  }
  if (content.length > 5e3) {
    res.status(400).json({ error: "content must be at most 5000 characters" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  if (supersedesId) {
    await supabaseAdmin.from("workspace_memories").update({ superseded_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", supersedesId).eq("workspace_id", workspaceId);
  }
  const { data, error } = await supabaseAdmin.from("workspace_memories").insert({
    workspace_id: workspaceId,
    node_id: nodeId || null,
    content: content.slice(0, 5e3),
    memory_type: "user_saved"
  }).select("id, workspace_id, node_id, content, memory_type, created_at").single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  const client = supabaseAdmin;
  setImmediate(() => {
    maybePruneWorkspaceMemories(client, workspaceId).catch(() => {
    });
  });
  return res.status(201).json({ memory: data });
});
router16.delete("/workspaces/:workspaceId/memories/:memoryId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const memoryId = req.params.memoryId;
  if (!workspaceId || !memoryId) {
    res.status(400).json({ error: "workspaceId and memoryId are required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: deleted, error: delErr } = await supabaseAdmin.from("workspace_memories").delete().eq("id", memoryId).eq("workspace_id", workspaceId).select("id");
  if (delErr) {
    return res.status(500).json({ error: delErr.message });
  }
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: "Memory not found" });
  }
  return res.status(204).send();
});
router16.delete("/workspaces/:workspaceId/clone", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  deleteWorkspaceClone(workspaceId);
  res.json({ success: true });
});
router16.delete("/workspaces/:workspaceId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const hard = String(req.query.hard ?? "").toLowerCase() === "true";
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  try {
    const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).maybeSingle();
    if (wsErr) {
      console.error("[workspaces] delete: lookup failed", {
        workspaceId,
        ownerId,
        error: wsErr.message
      });
      res.status(500).json({ error: wsErr.message });
      return;
    }
    if (!ws) {
      res.status(404).json({ error: "Workspace not found or access denied." });
      return;
    }
    deleteWorkspaceClone(workspaceId);
    if (hard) {
      const { error: delErr } = await supabaseAdmin.from("workspaces").delete().eq("id", workspaceId).eq("owner_id", ownerId);
      if (delErr) {
        console.error("[workspaces] delete: hard delete failed", {
          workspaceId,
          ownerId,
          error: delErr.message
        });
        res.status(500).json({ error: delErr.message });
        return;
      }
      console.log("[workspaces] delete: hard delete success", { workspaceId, ownerId });
      res.json({ success: true, hard: true });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const { error: archErr } = await supabaseAdmin.from("workspaces").update({ archived_at: now }).eq("id", workspaceId).eq("owner_id", ownerId);
    if (archErr) {
      console.error("[workspaces] delete: archive failed", {
        workspaceId,
        ownerId,
        error: archErr.message
      });
      res.status(500).json({ error: archErr.message });
      return;
    }
    console.log("[workspaces] delete: archived", { workspaceId, ownerId });
    res.json({ success: true, archivedAt: now, hard: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspaces] delete: unexpected error", { workspaceId, ownerId, error: msg });
    res.status(500).json({ error: msg });
  }
});
router16.post("/workspaces/:workspaceId/restore", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id, archived_at").eq("id", workspaceId).eq("owner_id", ownerId).maybeSingle();
  if (wsErr) {
    res.status(500).json({ error: wsErr.message });
    return;
  }
  if (!ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { error: updErr } = await supabaseAdmin.from("workspaces").update({ archived_at: null }).eq("id", workspaceId).eq("owner_id", ownerId);
  if (updErr) {
    res.status(500).json({ error: updErr.message });
    return;
  }
  res.json({ success: true });
});
router16.patch("/workspaces/:workspaceId/jira-project-key", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const rawKey = req.body?.projectKey;
  const projectKey = rawKey === null || rawKey === "" ? null : typeof rawKey === "string" ? rawKey.trim().toUpperCase() : null;
  if (projectKey !== null && !isValidProjectKey(projectKey)) {
    res.status(400).json({
      error: "Project key must be 2\u201310 chars, start with a letter, no trailing hyphen (e.g. PROJ)"
    });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { error: uErr } = await supabaseAdmin.from("workspaces").update({ jira_project_key: projectKey }).eq("id", workspaceId);
  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }
  res.json({ success: true, projectKey });
});
router16.patch("/workspaces/:workspaceId/connect-repo", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const fullName = typeof req.body?.github_full_name === "string" ? req.body.github_full_name.trim() : null;
  if (!workspaceId || !fullName) {
    res.status(400).json({ error: "workspaceId and github_full_name required." });
    return;
  }
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(fullName)) {
    res.status(400).json({ error: "github_full_name must be owner/repo format." });
    return;
  }
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, userId);
  } catch {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const repoUrl = `https://github.com/${fullName}`;
  const { error } = await supabaseAdmin.from("workspaces").update({ repo_url: repoUrl, github_full_name: fullName }).eq("id", workspaceId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true, repoUrl, github_full_name: fullName });
});
router16.patch("/workspaces/:workspaceId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : void 0;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { error: uErr } = await supabaseAdmin.from("workspaces").update({ name }).eq("id", workspaceId);
  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }
  res.json({ success: true });
});
router16.post("/workspaces/:workspaceId/save", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const graph = typeof req.body?.graph === "object" && req.body.graph !== null ? req.body.graph : null;
  const repoUrl = typeof req.body?.repoUrl === "string" ? req.body.repoUrl : null;
  if (!graph) {
    res.status(400).json({ error: "graph is required" });
    return;
  }
  const { error: gErr } = await supabaseAdmin.from("graphs").insert({
    workspace_id: workspaceId,
    graph_json: graph,
    repo_url: repoUrl
  });
  if (gErr) {
    res.status(500).json({ error: gErr.message });
    return;
  }
  if (repoUrl && repoUrl.trim()) {
    await supabaseAdmin.from("workspaces").update({ project_root: null, repo_url: repoUrl.trim() }).eq("id", workspaceId);
  }
  res.json({ success: true });
});
router16.get("/workspaces/:workspaceId/scenes", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const limitParam = Math.min(parseInt(String(req.query.limit ?? 20), 10) || 20, 50);
  const { data, error } = await supabaseAdmin.from("workspace_scenes").select("id, workspace_id, name, scene_version, created_at, updated_at").eq("workspace_id", workspaceId).order("scene_version", { ascending: false }).limit(limitParam);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ scenes: data ?? [] });
});
router16.get("/workspaces/:workspaceId/scenes/latest", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_scenes").select("id, workspace_id, name, scene_version, scene_json, created_at, updated_at").eq("workspace_id", workspaceId).order("scene_version", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "No scene saved for this workspace." });
    return;
  }
  res.json({ scene: data });
});
router16.post("/workspaces/:workspaceId/scenes", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "Scene";
  const sceneJson = typeof req.body?.scene === "object" && req.body.scene !== null ? req.body.scene : null;
  if (!sceneJson) {
    res.status(400).json({ error: "scene (object) is required" });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data: latest, error: latestErr } = await supabaseAdmin.from("workspace_scenes").select("scene_version").eq("workspace_id", workspaceId).order("scene_version", { ascending: false }).limit(1).maybeSingle();
  if (latestErr) {
    res.status(500).json({ error: latestErr.message });
    return;
  }
  const nextVersion = (latest?.scene_version ?? 0) + 1;
  const { data: inserted, error: insErr } = await supabaseAdmin.from("workspace_scenes").insert({
    workspace_id: workspaceId,
    name: name || "Scene",
    scene_version: nextVersion,
    scene_json: sceneJson
  }).select("id, workspace_id, name, scene_version, scene_json, created_at, updated_at").single();
  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }
  const sceneData = inserted;
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: req.user?.email ?? null,
    action: "scene_saved",
    entityType: "scene",
    entityId: sceneData.id,
    metadata: { version: nextVersion }
  });
  res.status(201).json({ scene: inserted });
});
router16.post("/workspaces/:workspaceId/runtime", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  const snapshot = req.body;
  if (!snapshot || typeof snapshot !== "object") {
    res.status(400).json({ error: "snapshot_json (object) is required" });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_runtime_snapshots").insert({ workspace_id: workspaceId, snapshot_json: snapshot }).select("id, workspace_id, recorded_at, snapshot_json").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ snapshot: data });
});
router16.post("/workspaces/:workspaceId/telemetry/otlp", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "OTLP JSON body required." });
    return;
  }
  const { extractSpansFromOtlp: extractSpansFromOtlp3, extractSpansFromSimple: extractSpansFromSimple3, processSpansToSnapshot: processSpansToSnapshot2 } = await Promise.resolve().then(() => (init_runtimeOtelProcessor(), runtimeOtelProcessor_exports));
  let spans = extractSpansFromOtlp3(payload);
  if (spans.length === 0) spans = extractSpansFromSimple3(payload);
  if (spans.length === 0) {
    res.status(400).json({ error: "No spans found. Send OTLP resourceSpans or { spans: [...] }." });
    return;
  }
  const { data: graphRow } = await supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const graph = graphRow?.graph_json;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({
      error: "Workspace has no graph. Scan a repo first to map spans onto nodes/edges."
    });
    return;
  }
  const { nodes, edges } = processSpansToSnapshot2(spans, graph);
  const snapshot = { nodes, edges };
  const { data, error } = await supabaseAdmin.from("workspace_runtime_snapshots").insert({ workspace_id: workspaceId, snapshot_json: snapshot }).select("id, workspace_id, recorded_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({
    accepted: spans.length,
    snapshot: { id: data.id, workspace_id: data.workspace_id, recorded_at: data.recorded_at },
    metrics: { nodes: Object.keys(nodes).length, edges: Object.keys(edges).length }
  });
});
router16.get("/workspaces/:workspaceId/runtime/latest", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_runtime_snapshots").select("id, workspace_id, recorded_at, snapshot_json").eq("workspace_id", workspaceId).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.json({ snapshot: null });
    return;
  }
  res.json({ snapshot: data });
});

// src/todosImport.ts
import { Router as Router16 } from "express";
var router17 = Router16();
function normalizePhaseToken(token) {
  if (!token) return null;
  const m = token.match(/(\d+)/);
  return m ? parseInt(m[1], 10) || null : null;
}
function parseDocLittleMarkdown(md) {
  const lines = md.split(/\r?\n/);
  let currentPhase = null;
  const todos = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const phaseMatch = line.match(/^##\s*Phase\s+([0-9A-Za-z]+)/i) || line.match(/^###\s*Phase\s+([0-9A-Za-z]+)/i);
    if (phaseMatch) {
      currentPhase = normalizePhaseToken(phaseMatch[1] ?? null);
      continue;
    }
    if (line.startsWith("|") && line.split("|").length >= 4) {
      const parts = line.split("|").map((p) => p.trim());
      const numToken = parts[1] ?? "";
      const titleCell = parts[2] ?? "";
      const detailsCell = parts[3] ?? "";
      const title = titleCell.replace(/^\d+\.\s*/, "").trim();
      if (title && title !== "Task" && title !== "Tasks") {
        todos.push({
          phase: currentPhase,
          title,
          description: detailsCell || null
        });
      }
      continue;
    }
    const numberedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (numberedMatch) {
      const title = numberedMatch[1].trim();
      if (title) {
        todos.push({ phase: currentPhase, title, description: null });
      }
      continue;
    }
    const todoMatch = line.match(/^[-*]\s+\[.\]\s+(.*)$/);
    if (todoMatch) {
      const title = todoMatch[1].trim();
      if (title) {
        todos.push({ phase: currentPhase, title, description: null });
      }
      continue;
    }
  }
  return todos;
}
router17.post("/todos/import/preview", requireUser, async (req, res) => {
  const workspaceId = req.body?.workspaceId?.trim();
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";
  if (!workspaceId || !markdown) {
    res.status(400).json({ error: "workspaceId and markdown are required" });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const parsed = parseDocLittleMarkdown(markdown);
  const byPhase = /* @__PURE__ */ new Map();
  for (const t of parsed) {
    const key = t.phase ?? -1;
    byPhase.set(key, (byPhase.get(key) ?? 0) + 1);
  }
  const phases = Array.from(byPhase.entries()).map(([phase, count]) => ({
    phase: phase === -1 ? null : phase,
    count
  }));
  const warnings = [];
  if (parsed.length === 0) {
    warnings.push("No todos detected. Check that the markdown uses tables, numbered lists, or checkboxes.");
  }
  res.json({
    total: parsed.length,
    phases,
    items: parsed.map((t) => ({ title: t.title, description: t.description, phase: t.phase })),
    warnings
  });
});
router17.post("/todos/import/confirm", requireUser, async (req, res) => {
  const workspaceId = req.body?.workspaceId?.trim();
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";
  if (!workspaceId || !markdown) {
    res.status(400).json({ error: "workspaceId and markdown are required" });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const parsed = parseDocLittleMarkdown(markdown);
  if (parsed.length === 0) {
    res.status(400).json({ error: "No todos detected in markdown." });
    return;
  }
  const titles = parsed.map((t) => t.title);
  const { data: existing } = await supabaseAdmin.from("todos").select("title, phase").eq("workspace_id", workspaceId).in("title", titles);
  const existingSet = new Set(
    (existing ?? []).map((r) => `${r.title}@@${r.phase ?? "null"}`)
  );
  const toInsert = parsed.filter((t) => !existingSet.has(`${t.title}@@${t.phase ?? "null"}`)).map((t) => ({
    workspace_id: workspaceId,
    title: t.title,
    description: t.description,
    phase: t.phase,
    status: "pending",
    source: "doclittle-md",
    source_path: null
  }));
  if (toInsert.length === 0) {
    res.json({ imported: [], skipped: parsed.length });
    return;
  }
  toInsert.sort((a, b) => (a.phase ?? -1) - (b.phase ?? -1));
  const imported = [];
  const batchSize = 500;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const slice = toInsert.slice(i, i + batchSize);
    const { data, error } = await supabaseAdmin.from("todos").insert(slice).select("id, phase, title");
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (data) imported.push(...data);
  }
  const byPhase = /* @__PURE__ */ new Map();
  for (const row of imported) {
    const p = row.phase ?? -1;
    if (!byPhase.has(p)) byPhase.set(p, []);
    byPhase.get(p).push(row.id);
  }
  const phasesAsc = Array.from(byPhase.keys()).sort((a, b) => a - b);
  for (let i = 1; i < phasesAsc.length; i++) {
    const currPhase = phasesAsc[i];
    const depIds = [];
    for (let j = 0; j < i; j++) depIds.push(...byPhase.get(phasesAsc[j]) ?? []);
    const currIds = byPhase.get(currPhase) ?? [];
    for (const id of currIds) {
      await supabaseAdmin.from("todos").update({ depends_on: depIds }).eq("id", id);
    }
  }
  res.json({ imported, skipped: parsed.length - toInsert.length });
});

// src/shareRoutes.ts
import { Router as Router17 } from "express";
import { nanoid } from "nanoid";
if (!process.env.APP_URL) {
  console.warn("[shareRoutes] APP_URL not set \u2014 share links may have incorrect base URL");
}
var router18 = Router17();
router18.post("/workspaces/:workspaceId/share", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const { workspaceId } = req.params;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId required" });
    return;
  }
  const { data: ws, error: wsError } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).maybeSingle();
  if (wsError || !ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const base = process.env.APP_URL ?? req.headers.origin ?? "";
  const { data: existing } = await supabaseAdmin.from("share_links").select("slug").eq("workspace_id", workspaceId).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    const shareUrl2 = `${base.replace(/\/$/, "")}/shared/${existing.slug}`;
    res.json({ url: shareUrl2, slug: existing.slug });
    return;
  }
  const slug = nanoid(10);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3);
  const { data, error } = await supabaseAdmin.from("share_links").insert({ workspace_id: workspaceId, slug, expires_at: expiresAt }).select("slug").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const shareUrl = `${base.replace(/\/$/, "")}/shared/${data.slug}`;
  res.json({ url: shareUrl, slug: data.slug });
});
router18.get("/shared/:slug", async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { slug } = req.params;
  if (!slug) {
    res.status(400).json({ error: "slug required" });
    return;
  }
  const { data: link } = await supabaseAdmin.from("share_links").select("workspace_id, expires_at").eq("slug", slug).maybeSingle();
  if (!link) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  if (link.expires_at && new Date(link.expires_at) < /* @__PURE__ */ new Date()) {
    res.status(410).json({ error: "Link expired" });
    return;
  }
  const { data: graphRow } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", link.workspace_id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!graphRow?.graph_json) {
    res.status(404).json({ error: "No graph for this link" });
    return;
  }
  res.json({
    graph: graphRow.graph_json,
    repoUrl: graphRow.repo_url ?? ""
  });
});

// src/metrics.ts
import { Router as Router18 } from "express";
var router19 = Router18();
router19.get("/metrics/agent", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim() || null;
  const nodeId = req.query.nodeId?.trim() || null;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  if (!supabaseAdmin) {
    return res.json({ traces: [], message: "Supabase not configured" });
  }
  const ownerId = req.user?.id;
  if (!ownerId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { data: workspaces, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("owner_id", ownerId);
    if (wsErr) {
      return res.status(500).json({ error: wsErr.message });
    }
    const allowedIds = (workspaces ?? []).map((w) => w.id);
    if (allowedIds.length === 0) {
      return res.json({ traces: [] });
    }
    let query = supabaseAdmin.from("model_traces").select(
      "id, workspace_id, node_id, question, agent_answer, agent_model, critic_model, agent_latency_ms, critic_score, langsmith_url, created_at"
    ).order("created_at", { ascending: false }).limit(limit).in("workspace_id", allowedIds);
    if (workspaceId) {
      if (!allowedIds.includes(workspaceId)) {
        return res.status(404).json({ traces: [], error: "Workspace not found or access denied." });
      }
      query = query.eq("workspace_id", workspaceId);
    }
    if (nodeId) {
      query = query.eq("node_id", nodeId);
    }
    const { data, error } = await query;
    if (error) {
      return res.status(500).json({
        error: "Failed to fetch agent traces",
        details: error.message
      });
    }
    return res.json({ traces: data ?? [] });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error"
    });
  }
});
router19.get("/metrics", (_req, res) => {
  const tasks2 = getTaskMetricsSummary();
  const materialize = getMaterializeMetricsSummary();
  res.json({
    tasks: {
      totalTasks: tasks2.totalTasks,
      greenfieldCount: tasks2.greenfieldCount,
      analysisCount: tasks2.analysisCount,
      avgLatencyMs: tasks2.avgLatencyMs,
      avgCriticScore: tasks2.avgCriticScore,
      errorCount: tasks2.errorCount
    },
    materialize: {
      totalMaterializes: materialize.totalMaterializes,
      successCount: materialize.successCount,
      avgNodesCreated: materialize.avgNodesCreated
    }
  });
});

// src/dependencyRisks.ts
import express2 from "express";
import { execFileSync as execFileSync2 } from "child_process";
import * as path37 from "path";
var router20 = express2.Router();
router20.post("/workspaces/:workspaceId/dependency-risks", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { tool, source, report } = req.body;
  if (!tool || typeof tool !== "string") {
    res.status(400).json({ error: "tool is required (e.g. 'npm-audit', 'snyk')." });
    return;
  }
  if (report == null || typeof report !== "object") {
    res.status(400).json({ error: "report (JSON object) is required." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspace_dependency_risks").insert({
    workspace_id: workspaceId,
    tool,
    source: source ?? null,
    report_json: report
  }).select("id, workspace_id, created_at, tool, source").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ risk: data });
});
router20.get("/workspaces/:workspaceId/dependency-risks", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? 10), 10) || 10, 50);
  const { data, error } = await supabaseAdmin.from("workspace_dependency_risks").select("id, workspace_id, created_at, tool, source, report_json").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ risks: data ?? [] });
});
router20.post("/workspaces/:workspaceId/run-npm-audit", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e;
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).not("graph_json", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (gErr || !graphRow?.graph_json) {
    res.status(404).json({ error: "No graph for this workspace. Scan first." });
    return;
  }
  const graph = graphRow.graph_json;
  const repoUrl = graphRow.repo_url?.trim() ?? null;
  const { rootPath, error: rootErr } = await ensureProjectRoot(workspaceId, graph, repoUrl);
  if (!rootPath || rootErr) {
    res.status(400).json({
      error: rootErr ?? "Could not resolve project root. Ensure repo is cloned or project_root is set."
    });
    return;
  }
  const packageJsonPath = path37.join(rootPath, "package.json");
  try {
    const fs36 = await import("fs");
    if (!fs36.existsSync(packageJsonPath)) {
      res.status(400).json({ error: "No package.json in project root." });
      return;
    }
  } catch {
    res.status(500).json({ error: "Could not access project files." });
    return;
  }
  let auditJson;
  try {
    const out = execFileSync2("npm", ["audit", "--json"], {
      cwd: rootPath,
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, CI: "1" }
    });
    auditJson = JSON.parse(out);
  } catch (runErr) {
    const err = runErr;
    let raw = "";
    if (err.stdout) raw = Buffer.isBuffer(err.stdout) ? err.stdout.toString("utf-8") : String(err.stdout);
    if (!raw && err.stderr)
      raw = Buffer.isBuffer(err.stderr) ? err.stderr.toString("utf-8") : String(err.stderr);
    try {
      auditJson = raw ? JSON.parse(raw) : { error: "npm audit failed", metadata: { vulnerabilities: 0 } };
    } catch {
      res.status(500).json({ error: "npm audit failed or produced invalid JSON." });
      return;
    }
  }
  const { error: insErr } = await supabaseAdmin.from("workspace_dependency_risks").insert({
    workspace_id: workspaceId,
    tool: "npm-audit",
    source: "package.json",
    report_json: auditJson
  });
  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }
  res.status(201).json({
    ok: true,
    message: "npm audit completed and report saved.",
    report: auditJson
  });
});

// src/telemetryRoutes.ts
import { Router as Router19 } from "express";
import * as fs33 from "fs";
import * as path38 from "path";
var router21 = Router19();
function getSpansPath(rootOverride) {
  const base = process.env.ARCHY_SPANS_PATH?.trim();
  if (base) return base;
  const root = rootOverride ?? process.cwd();
  return path38.join(root, "logs", "spans.jsonl");
}
function extractSpansFromOtlp2(payload) {
  const out = [];
  if (!payload || typeof payload !== "object") return out;
  const rs = payload.resourceSpans;
  if (!Array.isArray(rs)) return out;
  for (const r of rs) {
    const ss = r.scopeSpans;
    if (!Array.isArray(ss)) continue;
    for (const s of ss) {
      const spans = s.spans;
      if (!Array.isArray(spans)) continue;
      for (const sp of spans) {
        const s2 = sp;
        const archNodeId = s2.attributes?.find((a) => a.key === "archNodeId")?.value?.stringValue;
        out.push({
          traceId: s2.traceId,
          spanId: s2.spanId,
          name: s2.name,
          ...archNodeId ? { archNodeId } : {}
        });
      }
    }
  }
  return out;
}
function extractSpansFromSimple2(payload) {
  const s = payload.spans;
  if (!Array.isArray(s)) return [];
  return s.filter((x) => x && typeof x === "object").map((x) => {
    const sp = x;
    return {
      traceId: typeof sp.traceId === "string" ? sp.traceId : void 0,
      spanId: typeof sp.spanId === "string" ? sp.spanId : void 0,
      name: typeof sp.name === "string" ? sp.name : void 0,
      archNodeId: typeof sp.archNodeId === "string" ? sp.archNodeId : void 0
    };
  });
}
router21.post("/telemetry/otlp", (req, res) => {
  try {
    const payload = req.body;
    let spans = extractSpansFromOtlp2(payload);
    if (spans.length === 0) {
      spans = extractSpansFromSimple2(payload);
    }
    if (spans.length === 0) {
      res.status(400).json({
        error: "No spans found. Send OTLP resourceSpans or { spans: [...] }."
      });
      return;
    }
    const spansPath = getSpansPath();
    const dir = path38.dirname(spansPath);
    if (!fs33.existsSync(dir)) {
      fs33.mkdirSync(dir, { recursive: true });
    }
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    for (const sp of spans) {
      const line = JSON.stringify({ ts, ...sp }) + "\n";
      fs33.appendFileSync(spansPath, line, "utf-8");
    }
    res.json({ accepted: spans.length, path: spansPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// src/taskRoutes.ts
import { Router as Router20 } from "express";
var router22 = Router20();
router22.get("/tasks/:taskId", optionalUser, (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({
    taskId: task.taskId,
    status: task.status,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt
  });
});
router22.post("/tasks/:taskId/cancel", optionalUser, (req, res) => {
  const { taskId } = req.params;
  const cancelled = cancelTask(taskId);
  if (!cancelled) {
    res.status(404).json({ error: "Task not found or not cancellable" });
    return;
  }
  res.json({ taskId, status: "cancelled" });
});

// src/violations.ts
import { Router as Router21 } from "express";
var router23 = Router21();
var scanCooldowns = /* @__PURE__ */ new Map();
router23.get("/violations", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  try {
    const violations = await getActiveViolations(supabaseAdmin, workspaceId);
    res.json({
      violations: violations.map((v) => ({
        id: v.id,
        type: v.type,
        severity: v.severity,
        sourceNodeId: v.source_node_id,
        targetNodeId: v.target_node_id ?? void 0,
        description: v.description ?? "",
        suggestedFix: v.suggested_fix ?? "",
        jiraKey: v.jira_key ?? void 0,
        jiraStatus: v.jira_status ?? void 0,
        railId: v.rail_id ?? void 0,
        recurrenceCount: v.recurrence_count,
        firstSeenAt: v.first_seen_at,
        lastSeenAt: v.last_seen_at,
        policyState: v.policy_state
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
var TRIGGER_SECRET = process.env.VIOLATION_SCAN_TRIGGER_SECRET?.trim() || null;
function runScanForWorkspace(workspaceId) {
  return (async () => {
    if (!supabaseAdmin) return { success: false, error: "Auth not configured" };
    const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (gErr || !graphRow?.graph_json) {
      return { success: false, error: gErr?.message ?? "No graph for workspace" };
    }
    const graph = graphRow.graph_json;
    await runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION);
    return { success: true };
  })();
}
router23.post("/violations/scan-trigger", async (req, res) => {
  const secret = req.headers["x-scan-trigger-secret"] ?? (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : void 0);
  if (!TRIGGER_SECRET || secret !== TRIGGER_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const workspaceId = req.body?.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const last = scanCooldowns.get(workspaceId) ?? 0;
  if (Date.now() - last < 6e4) {
    res.status(429).json({ error: "Scan cooldown: wait 60s" });
    return;
  }
  scanCooldowns.set(workspaceId, Date.now());
  try {
    const out = await runScanForWorkspace(workspaceId);
    if (!out.success) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Scan failed" });
  }
});
router23.post("/violations/scan", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.body?.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const last = scanCooldowns.get(workspaceId) ?? 0;
  if (Date.now() - last < 6e4) {
    res.status(429).json({ error: "Scan cooldown: wait 60s between scans." });
    return;
  }
  scanCooldowns.set(workspaceId, Date.now());
  try {
    const out = await runScanForWorkspace(workspaceId);
    if (!out.success) {
      res.status(404).json({ error: out.error ?? "No graph saved for this workspace." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Violation scan failed"
    });
  }
});
router23.post("/violations/:id/dismiss", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const violationId = req.params.id;
  const { data: row } = await supabaseAdmin.from("violations").select("id, workspace_id, policy_state").eq("id", violationId).single();
  if (!row) {
    res.status(404).json({ error: "Violation not found." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", row.workspace_id).eq("owner_id", req.user.id).single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  try {
    await supabaseAdmin.from("violation_policy_events").insert({
      violation_id: violationId,
      workspace_id: row.workspace_id,
      actor_id: req.user.id,
      previous_state: row.policy_state ?? null,
      new_state: "waived",
      reason: "dismissed from UI"
    });
  } catch {
  }
  await supabaseAdmin.from("violations").update({ policy_state: "waived" }).eq("id", violationId);
  res.json({ success: true });
});

// src/railsRoutes.ts
import { Router as Router22 } from "express";
import * as path39 from "path";

// src/apiError.ts
function sendError(res, status, error, meta) {
  const payload = { error };
  if (typeof meta === "string" && meta) {
    payload.code = meta;
  } else if (meta && typeof meta === "object") {
    if (meta.code) payload.code = meta.code;
    if (meta.railId) payload.railId = meta.railId;
    if (meta.traceId) payload.traceId = meta.traceId;
    if (meta.details) payload.details = meta.details;
    if (meta.retryable !== void 0) payload.retryable = meta.retryable;
  }
  return res.status(status).json(payload);
}

// src/railsRoutes.ts
import * as fs34 from "fs";
async function writeRailCompletionMemory(workspaceId, rail) {
  if (!supabaseAdmin) return;
  try {
    const taskCount = rail.tasks?.length ?? 0;
    const completedCount = rail.tasks?.filter((t) => t.status === "completed").length ?? 0;
    const parts = [
      `Rail ${rail.id.slice(0, 8)} archived: ${rail.outcome}`,
      rail.archetype ? `archetype: ${rail.archetype}` : null,
      `tasks: ${completedCount}/${taskCount} completed`
    ].filter(Boolean);
    const content = parts.join(". ").slice(0, 2e3);
    await supabaseAdmin.from("workspace_memories").insert({
      workspace_id: workspaceId,
      node_id: rail.logicPath?.[0]?.nodeId ?? null,
      content,
      memory_type: "rail_completion"
    });
  } catch {
  }
}
var router24 = Router22();
var railEventClients = [];
function broadcastRailEvent(workspaceId, payload) {
  const data = `data: ${JSON.stringify(payload)}

`;
  for (const client of railEventClients.slice()) {
    if (client.workspaceId !== workspaceId) continue;
    try {
      client.res.write(data);
    } catch {
      const idx = railEventClients.indexOf(client);
      if (idx >= 0) railEventClients.splice(idx, 1);
    }
  }
}
var workspaceExecutionCounts2 = /* @__PURE__ */ new Map();
var MAX_CONCURRENT_PER_WORKSPACE2 = typeof process.env.RAIL_MAX_CONCURRENT === "string" && !Number.isNaN(Number(process.env.RAIL_MAX_CONCURRENT)) ? Math.max(1, Number(process.env.RAIL_MAX_CONCURRENT)) : 1;
var STALE_RAIL_MAX_AGE_MS = typeof process.env.RAIL_STALE_MAX_AGE_MS === "string" && !Number.isNaN(Number(process.env.RAIL_STALE_MAX_AGE_MS)) ? Math.max(5 * 6e4, Number(process.env.RAIL_STALE_MAX_AGE_MS)) : 60 * 6e4;
function walkDir3(dir, base, maxDepth) {
  const out = [];
  if (maxDepth <= 0) return out;
  try {
    const entries = fs34.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path39.relative(base, path39.join(dir, e.name));
      if (e.isDirectory()) {
        out.push(rel + "/");
        out.push(...walkDir3(path39.join(dir, e.name), base, maxDepth - 1));
      } else {
        out.push(rel);
      }
    }
  } catch {
  }
  return out.sort();
}
function recoverStaleRails(rootPath, workspaceId) {
  try {
    const now = Date.now();
    const rails = getAllRails();
    for (const rail of rails) {
      if (!rail.updatedAt) continue;
      if (!["EXECUTING", "VERIFYING"].includes(rail.state)) continue;
      if (now - rail.updatedAt < STALE_RAIL_MAX_AGE_MS) continue;
      updateRailState(rootPath, rail.id, "FAILED");
      removeSandbox(rootPath, rail.id);
      if (workspaceId) {
        broadcastRailEvent(workspaceId, {
          type: "rail_stale_recovered",
          railId: rail.id,
          from: rail.state,
          to: "FAILED"
        });
      }
    }
  } catch {
  }
}
function resolveRootPath(raw) {
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return { error: "rootPath query is required." };
  }
  const root = path39.resolve(raw.trim());
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path39.resolve(baseDir);
    if (!root.startsWith(baseNorm + path39.sep) && root !== baseNorm) {
      return { error: "rootPath must be within the allowed projects directory." };
    }
  }
  return { root };
}
async function resolveRootFromWorkspace2(workspaceId, ownerId) {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin.from("workspaces").select("project_root").eq("id", workspaceId).eq("owner_id", ownerId).maybeSingle();
    if (error || !data) return null;
    const pr = data.project_root;
    return typeof pr === "string" && pr.trim() ? path39.resolve(pr.trim()) : null;
  } catch {
    return null;
  }
}
async function resolveRootAndWorkspace(req) {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    return { error: "workspaceId and auth required.", status: 400 };
  }
  const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
  if (!root) {
    return { error: "Workspace has no project_root.", status: 400 };
  }
  return { root, workspaceId };
}
router24.get("/rails", optionalUser, async (req, res) => {
  const rootPath = req.query.rootPath?.trim();
  const workspaceId = req.query.workspaceId?.trim();
  let resolved;
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root. Set project_root or pass rootPath." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    sendError(res, 400, resolved.error);
    return;
  }
  try {
    loadRails(resolved.root);
    cleanupOrphanSandboxes(resolved.root, workspaceId);
    recoverStaleRails(resolved.root, workspaceId);
    const rails = getAllRails();
    res.json({
      rails: rails.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        state: r.state,
        archetype: r.archetype,
        logicPath: r.logicPath,
        sessionId: r.sessionId,
        originSummary: r.originSummary ?? null,
        jiraKeys: r.jiraKeys ?? [],
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
        lastCritique: r.lastCritique ?? null,
        hallucinationIndex: r.hallucinationIndex ?? null,
        acceptanceCriteria: r.acceptanceCriteria ?? null,
        attemptHistory: r.attemptHistory ?? null,
        tasks: (r.tasks ?? []).map((t) => ({
          id: t.id,
          kind: t.kind,
          description: t.description,
          status: t.status,
          createdAt: t.createdAt
        }))
      }))
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router24.post("/rails/from-violation", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    sendError(res, 503, "Auth service not configured.");
    return;
  }
  const workspaceIdBody = req.body?.workspaceId?.trim() || null;
  const violation = req.body?.violation;
  if (!violation) {
    sendError(res, 400, "violation is required in request body.", "VIOLATION_REQUIRED");
    return;
  }
  const violationId = typeof violation.id === "string" && violation.id.trim() ? violation.id.trim() : null;
  try {
    let workspaceId = workspaceIdBody;
    if (violationId) {
      const { data: row } = await supabaseAdmin.from("violations").select("id, workspace_id").eq("id", violationId).maybeSingle();
      if (!row) {
        sendError(res, 404, "Violation not found.", "VIOLATION_NOT_FOUND");
        return;
      }
      workspaceId = row.workspace_id ?? workspaceId;
    }
    if (!workspaceId) {
      sendError(res, 400, "workspaceId is required (in body or via violation record).", "WORKSPACE_REQUIRED");
      return;
    }
    const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).single();
    if (!ws) {
      sendError(res, 403, "Access denied.", "WORKSPACE_FORBIDDEN");
      return;
    }
    const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
    if (!root) {
      sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
      return;
    }
    let repoUrl = null;
    try {
      const { data: graphRow } = await supabaseAdmin.from("graphs").select("repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      repoUrl = graphRow?.repo_url ?? null;
    } catch {
    }
    const now = Date.now();
    const railId = violationId != null ? `rail-violation-${violationId}-${now}` : `rail-violation-${now.toString(16)}`;
    const trigger = violationId ? { source: "governance", violationId } : {
      source: "chat",
      userMessage: (violation.description ?? violation.suggestedFix ?? "Fix architecture violation").slice(0, 200),
      sessionId: req.user.id
    };
    const sourceNodeId = typeof violation.sourceNodeId === "string" && violation.sourceNodeId.trim() ? violation.sourceNodeId.trim() : "unknown-node";
    const logicPath = [
      {
        step: 1,
        layer: "Service",
        nodeId: sourceNodeId,
        filePath: sourceNodeId,
        action: typeof violation.suggestedFix === "string" && violation.suggestedFix.trim().slice(0, 120) || "Fix architecture violation"
      }
    ];
    const outcomeParts = [];
    if (violation.type) outcomeParts.push(String(violation.type));
    if (violation.severity) outcomeParts.push(String(violation.severity));
    outcomeParts.push(violation.description ?? "Architecture violation");
    const rail = {
      id: railId,
      version: 1,
      outcome: outcomeParts.join(" \xB7 ").slice(0, 200),
      trigger,
      workspaceId,
      repoUrl,
      violationId: violationId ?? void 0,
      archetype: "analysis-chat",
      logicPath,
      state: "PRE_PLANNING",
      activeAgent: null,
      tasks: [],
      jiraKeys: [],
      traceIds: [],
      overlaps: [],
      createdAt: now,
      updatedAt: now,
      createdBy: "human",
      sessionId: req.user.id,
      originSummary: (violation.description ?? violation.suggestedFix ?? "Fix architecture violation").slice(0, 200)
    };
    const task = {
      id: `task-code-${now.toString(16)}`,
      railId,
      kind: "code_change",
      description: violation.suggestedFix && violation.suggestedFix.trim() || `Fix ${violation.type ?? "violation"} at ${sourceNodeId}`,
      files: [],
      autoCapable: true,
      status: "pending",
      agent: "executor",
      logicStep: 1,
      createdAt: now
    };
    createRail(root, rail);
    createTask(task);
    if (violationId) {
      try {
        await supabaseAdmin.from("violations").update({ rail_id: railId }).eq("id", violationId);
      } catch {
      }
    }
    res.status(201).json({ railId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_FROM_VIOLATION_ERROR");
  }
});
router24.get("/rails/events", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId) {
    sendError(res, 400, "workspaceId is required.", "WORKSPACE_REQUIRED");
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: ping
data: "connected"

`);
  const client = { workspaceId, res };
  railEventClients.push(client);
  req.on("close", () => {
    const idx = railEventClients.indexOf(client);
    if (idx >= 0) railEventClients.splice(idx, 1);
  });
});
router24.get("/rails/:railId", optionalUser, async (req, res) => {
  const rootPath = req.query.rootPath?.trim();
  const workspaceId = req.query.workspaceId?.trim();
  let resolved;
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    sendError(res, 400, resolved.error);
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId is required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(resolved.root);
    const rail = getRail(resolved.root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const tasks2 = rail.tasks ?? [];
    const { autoCapable, hitlRequired } = partitionTasksByCapability(tasks2);
    res.json({
      id: rail.id,
      outcome: rail.outcome,
      state: rail.state,
      archetype: rail.archetype,
      logicPath: rail.logicPath,
      baselineNodeIds: rail.baselineNodeIds ?? null,
      sessionId: rail.sessionId,
      originSummary: rail.originSummary ?? null,
      jiraKeys: rail.jiraKeys ?? [],
      updatedAt: rail.updatedAt,
      createdAt: rail.createdAt,
      lastCritique: rail.lastCritique ?? null,
      hallucinationIndex: rail.hallucinationIndex ?? null,
      acceptanceCriteria: rail.acceptanceCriteria ?? null,
      tasks: tasks2,
      taskCapability: {
        autoCapableIds: autoCapable.map((t) => t.id),
        hitlRequiredIds: hitlRequired.map((t) => t.id)
      },
      traces: rail.traces ?? null,
      telemetry: rail.telemetry ?? null,
      attemptHistory: rail.attemptHistory ?? null
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});
router24.post("/rails/:railId/state", optionalUser, async (req, res) => {
  const rootPath = req.query.rootPath?.trim();
  const workspaceId = req.query.workspaceId?.trim();
  let resolved;
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    sendError(res, 400, resolved.error);
    return;
  }
  const railId = req.params.railId;
  const to = req.body?.state?.trim();
  if (!railId || !to) {
    sendError(res, 400, "railId and state are required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(resolved.root);
    const current = getRail(resolved.root, railId);
    if (!current) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const result = transitionRail(resolved.root, railId, to);
    if (!result.ok || !result.rail) {
      sendError(res, 400, result.error ?? "Invalid transition.", "RAIL_INVALID_TRANSITION");
      return;
    }
    updateRailState(resolved.root, railId, result.rail.state);
    if (workspaceId) {
      broadcastRailEvent(workspaceId, {
        type: "rail_state",
        railId,
        from: current?.state ?? null,
        to: result.rail.state
      });
      if (result.rail.state === "AWAITING_HITL") {
        broadcastRailEvent(workspaceId, {
          type: "rail_hitl",
          railId,
          reason: "awaiting_human_review"
        });
      }
    }
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from("rail_state_events").insert({
          rail_id: railId,
          workspace_id: workspaceId ?? null,
          from_state: current?.state ?? null,
          to_state: result.rail.state,
          actor_id: req.user?.id ?? null,
          reason: req.body?.reason ?? null
        });
      } catch {
      }
      if (workspaceId && result.rail.state === "ARCHIVED") {
        writeRailCompletionMemory(workspaceId, result.rail).catch(() => {
        });
        completeTodosForRail(railId).catch(() => {
        });
      }
    }
    res.json({
      id: result.rail.id,
      state: result.rail.state
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router24.post("/rails/:railId/execute", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 400, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const currentExec = workspaceExecutionCounts2.get(workspaceId) ?? 0;
  if (currentExec >= MAX_CONCURRENT_PER_WORKSPACE2) {
    sendError(
      res,
      429,
      "Execution limit reached for this workspace. Try again later.",
      "RAIL_EXECUTION_LIMIT"
    );
    return;
  }
  let root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
  if (!root) {
    if (!supabaseAdmin) {
      sendError(res, 503, "Auth service not configured.", "SERVICE_UNAVAILABLE");
      return;
    }
    try {
      const { data: gr } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const graph = gr?.graph_json ?? { nodes: [], edges: [], generatedAt: Date.now(), projectRoot: "" };
      const repoUrl = gr?.repo_url ?? null;
      const { rootPath, error } = await ensureProjectRoot(workspaceId, graph, repoUrl);
      if (rootPath !== null) {
        root = rootPath;
      } else {
        sendError(
          res,
          400,
          error || "Workspace has no project_root. Please scan the repository first.",
          "WORKSPACE_NO_PROJECT_ROOT"
        );
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg, "WORKSPACE_NO_PROJECT_ROOT");
      return;
    }
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    if (rail.archetype !== "analysis-chat") {
      sendError(res, 400, "Only analysis-chat rails can be executed.", "RAIL_WRONG_ARCHETYPE");
      return;
    }
    const codeTasks = (rail.tasks ?? []).filter(
      (t) => t.kind === "code_change" && classifyTaskAutoCapable(t)
    );
    if (codeTasks.length === 0) {
      sendError(res, 400, "Rail has no code_change tasks to run.", "RAIL_NO_CODE_TASKS");
      return;
    }
    if (!["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(rail.state)) {
      sendError(
        res,
        400,
        `Rail must be in PRE_PLANNING, PLANNING, or AWAITING_APPROVAL. Current: ${rail.state}`,
        "RAIL_INVALID_STATE"
      );
      return;
    }
    const bgTask = createTask2();
    res.status(202).json({
      taskId: bgTask.taskId,
      status: "pending",
      railId: rail.id,
      kind: "analysis-execute"
    });
    setTaskRunning(bgTask.taskId);
    workspaceExecutionCounts2.set(workspaceId, currentExec + 1);
    const sandboxPath = ensureSandbox(root, rail.id);
    const paths = (rail.logicPath ?? []).map((s) => typeof s === "object" && s && "filePath" in s && typeof s.filePath === "string" ? s.filePath : String(s)).filter(Boolean);
    const syncPaths = paths.length > 0 ? paths : ["src"];
    syncSandboxFromRoot(root, rail.id, syncPaths);
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    const goal = rail.outcome ?? rail.trigger?.source === "chat" ? rail.trigger.userMessage ?? "" : "Analysis rail";
    const plan = {
      goal,
      tasks: codeTasks.map((t, i) => ({
        id: t.id,
        module: rail.logicPath?.[i]?.filePath ?? `step-${i + 1}`,
        layer: rail.logicPath?.[i]?.layer ?? "Service",
        action: "modify",
        expectedOutput: t.description ?? `Step ${i + 1}`
      })),
      dependencies: []
    };
    for (let i = 0; i < plan.tasks.length - 1; i++) {
      plan.dependencies.push([plan.tasks[i].id, plan.tasks[i + 1].id]);
    }
    Promise.resolve().then(async () => {
      if (isTaskCancelled(bgTask.taskId)) return;
      const current = getRail(root, railId);
      if (current && (current.state === "PRE_PLANNING" || current.state === "PLANNING")) {
        transitionRail(root, railId, "AWAITING_APPROVAL");
      }
      const tr = transitionRail(root, railId, "EXECUTING", { planApproved: true });
      if (!tr.ok) {
        setTaskFailed(bgTask.taskId, tr.error ?? "Invalid transition.");
        return;
      }
      const attemptHistory = [];
      const maxSelfCorrect = rail.telemetry?.retryLimit ?? (typeof process.env.RAIL_SELF_CORRECT_MAX === "string" && !Number.isNaN(Number(process.env.RAIL_SELF_CORRECT_MAX)) ? Math.max(0, Math.min(5, Number(process.env.RAIL_SELF_CORRECT_MAX))) : 2);
      let lastVerificationFeedback;
      let verification = null;
      let attempt = 0;
      while (attempt <= maxSelfCorrect && !isTaskCancelled(bgTask.taskId)) {
        for (let idx = 0; idx < plan.tasks.length && !isTaskCancelled(bgTask.taskId); idx++) {
          const railTask = codeTasks[idx];
          if (railTask) updateTaskStatus(railTask.id, "executing");
          const result = await runTaskAtIndex(plan, idx, sandboxPath, {
            apiKey,
            errorOutput: lastVerificationFeedback,
            rail,
            railHistory: attemptHistory
          });
          if (result.error) {
            attemptHistory.push({
              role: "assistant",
              content: `Task ${railTask?.id ?? idx} error: ${result.error}`
            });
          }
          if (railTask) updateTaskStatus(railTask.id, "completed");
        }
        const nodeIds = (rail.logicPath ?? []).map((s) => typeof s === "object" && s && "nodeId" in s && typeof s.nodeId === "string" ? s.nodeId : null).filter((x) => !!x);
        verification = await runVerificationPipeline({
          projectRoot: root,
          sandboxPath,
          railId: rail.id,
          baseUrl: process.env.APP_URL || "http://127.0.0.1:4173",
          scope: nodeIds.length > 0 ? { nodeIds } : void 0
        });
        const passed2 = verification.passed;
        lastVerificationFeedback = verification.errorFeedback || void 0;
        if (passed2) break;
        attempt++;
      }
      const { passed, lint, vitest, playwright: playwrightResult } = verification ?? {
        passed: false,
        lint: { passed: false, errors: [] },
        vitest: { passed: false, summary: { total: 0, passed: 0, failed: 0, skipped: 0 }, failures: [] },
        playwright: null
      };
      const errorOutput = lastVerificationFeedback ?? "Verification failed.";
      const verificationTaskId = `verify-${Date.now()}`;
      createTask({
        id: verificationTaskId,
        railId: rail.id,
        kind: "verification",
        description: "Lint + Vitest in sandbox",
        files: [],
        autoCapable: true,
        status: passed ? "completed" : "rejected",
        agent: "reviewer",
        logicStep: 0,
        createdAt: Date.now(),
        resolvedAt: Date.now()
      });
      updateTaskEvidence(verificationTaskId, JSON.stringify({ lint, vitest, playwright: playwrightResult }));
      const attemptNumber = (rail.telemetry?.retryCount ?? 0) + 1;
      const attemptSummary = passed ? "Verification passed." : errorOutput || "Verification failed.";
      updateRailPartial(root, railId, {
        lastCritique: {
          source: passed ? "test" : "lint",
          message: passed ? "Lint, Vitest, and Playwright passed." : errorOutput || "Verification failed.",
          createdAt: Date.now(),
          attempt: attemptNumber,
          totalAttempts: rail.telemetry?.retryLimit ?? 1
        },
        telemetry: {
          ...rail.telemetry ?? {},
          retryCount: (rail.telemetry?.retryCount ?? 0) + (passed ? 0 : 1)
        },
        attemptHistory: [
          ...rail.attemptHistory ?? [],
          {
            timestamp: Date.now(),
            summary: attemptSummary.slice(0, 5e3)
          }
        ]
      });
      const toState = passed ? "VERIFYING" : "SELF_CORRECTING";
      transitionRail(root, railId, toState);
      setTaskCompleted(bgTask.taskId, {
        message: passed ? "Verification passed. You can approve materialization." : "Verification failed. Review failures in rail detail.",
        railId: rail.id,
        verificationPassed: passed,
        lint: { passed: lint.passed, errors: lint.errors.length },
        vitest: { passed: vitest.passed, failures: vitest.failures.length },
        playwright: playwrightResult ? { passed: playwrightResult.passed, failures: playwrightResult.failures.length } : null
      });
      if (supabaseAdmin && workspaceId) {
        try {
          await supabaseAdmin.from("workspace_memories").insert({
            workspace_id: workspaceId,
            content: passed ? `Rail ${rail.id} verification passed. Outcome: ${rail.outcome ?? ""}` : `Rail ${rail.id} verification failed. See lint, vitest, and Playwright results.`,
            memory_type: "rail_result",
            rail_id: rail.id
          });
        } catch {
        }
      }
      if (!passed && workspaceId) {
        broadcastRailEvent(workspaceId, {
          type: "rail_hitl",
          railId: rail.id,
          reason: "verification_failed"
        });
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setTaskFailed(bgTask.taskId, msg);
      updateRailPartial(root, railId, {
        lastCritique: { source: "unknown", message: msg, createdAt: Date.now() }
      });
    }).finally(() => {
      const cur = workspaceExecutionCounts2.get(workspaceId) ?? 0;
      const next = Math.max(0, cur - 1);
      if (next === 0) workspaceExecutionCounts2.delete(workspaceId);
      else workspaceExecutionCounts2.set(workspaceId, next);
      broadcastRailEvent(workspaceId, { type: "rail_execute_complete", railId });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_EXECUTE_ERROR");
  }
});
router24.get("/rails/:railId/sandbox/files", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs34.existsSync(sandboxPath)) {
      res.json({ paths: [] });
      return;
    }
    const paths = walkDir3(sandboxPath, sandboxPath, 4);
    res.json({ paths });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});
router24.get("/rails/:railId/diff", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs34.existsSync(sandboxPath)) {
      res.json({ files: [] });
      return;
    }
    const relFiles = walkDir3(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
    const diffs = [];
    for (const rel of relFiles) {
      const sandboxFile = path39.join(sandboxPath, rel);
      const rootFile = path39.join(root, rel);
      let before;
      let after;
      try {
        if (fs34.existsSync(rootFile) && fs34.statSync(rootFile).isFile()) {
          before = fs34.readFileSync(rootFile, "utf-8");
        }
      } catch {
      }
      try {
        after = fs34.readFileSync(sandboxFile, "utf-8");
      } catch {
      }
      if (before === after) continue;
      diffs.push({ path: rel, before, after });
    }
    res.json({ files: diffs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});
router24.get("/rails/:railId/impact", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    const changedFiles = [];
    if (fs34.existsSync(sandboxPath)) {
      const relFiles = walkDir3(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
      for (const rel of relFiles) {
        const sandboxFile = path39.join(sandboxPath, rel);
        const rootFile = path39.join(root, rel);
        let before;
        let after;
        try {
          if (fs34.existsSync(rootFile) && fs34.statSync(rootFile).isFile()) {
            before = fs34.readFileSync(rootFile, "utf-8");
          }
        } catch {
        }
        try {
          after = fs34.readFileSync(sandboxFile, "utf-8");
        } catch {
        }
        if (before !== after) {
          changedFiles.push(rel);
        }
      }
    }
    let nodesToPaths = {};
    const logicNodeIds = (rail.logicPath ?? []).map((s) => typeof s === "object" && s && "nodeId" in s ? s.nodeId : null).filter((id) => !!id);
    const allNodeIds = [.../* @__PURE__ */ new Set([...rail.baselineNodeIds ?? [], ...logicNodeIds])];
    if (supabaseAdmin && allNodeIds.length > 0) {
      const { data: graphRow } = await supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (graphRow?.graph_json) {
        const graph = graphRow.graph_json;
        const nodeMap = buildNodeFileMap(graph);
        for (const nodeId of allNodeIds) {
          const entry = nodeMap.get(nodeId);
          if (entry?.files?.length) nodesToPaths[nodeId] = entry.files;
        }
      }
    }
    res.json({
      railId,
      baselineNodeIds: rail.baselineNodeIds ?? null,
      changedFiles,
      nodesToPaths: Object.keys(nodesToPaths).length > 0 ? nodesToPaths : void 0
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});
router24.get("/rails/:railId/trace", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace2(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    let stateEvents = null;
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from("rail_state_events").select("*").eq("rail_id", railId).order("created_at", { ascending: true });
      stateEvents = data ?? [];
    }
    res.json({
      railId,
      rail,
      stateEvents
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg);
  }
});
router24.post("/rails/:railId/cancel", requireUser, async (req, res) => {
  const resolved = await resolveRootAndWorkspace(req);
  if ("error" in resolved) {
    sendError(res, resolved.status, resolved.error, "WORKSPACE_REQUIRED");
    return;
  }
  const { root, workspaceId } = resolved;
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    if (!["EXECUTING", "VERIFYING", "SELF_CORRECTING", "AWAITING_HITL"].includes(rail.state)) {
      sendError(
        res,
        400,
        `Rail is not cancellable from state ${rail.state}.`,
        "RAIL_INVALID_STATE"
      );
      return;
    }
    const result = transitionRail(root, railId, "SUSPENDED");
    if (!result.ok || !result.rail) {
      sendError(res, 400, result.error ?? "Invalid state transition.", "RAIL_INVALID_TRANSITION");
      return;
    }
    updateRailState(root, railId, result.rail.state);
    broadcastRailEvent(workspaceId, {
      type: "rail_state",
      railId,
      from: rail.state,
      to: result.rail.state
    });
    res.json({ id: railId, state: result.rail.state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, { code: "RAIL_CANCEL_ERROR", railId });
  }
});
router24.post("/rails/:railId/materialize", requireUser, async (req, res) => {
  const resolved = await resolveRootAndWorkspace(req);
  if ("error" in resolved) {
    sendError(res, resolved.status, resolved.error, "WORKSPACE_REQUIRED");
    return;
  }
  const { root, workspaceId } = resolved;
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    if (rail.archetype === "greenfield-materialize") {
      sendError(
        res,
        400,
        "Use /materialize/approve for greenfield materialize rails.",
        "RAIL_WRONG_ARCHETYPE"
      );
      return;
    }
    const verifTasks = (rail.tasks ?? []).filter((t) => t.kind === "verification");
    const passed = verifTasks.length > 0 && verifTasks.every((t) => t.status === "completed");
    if (!passed) {
      sendError(
        res,
        409,
        "Verification has not passed yet. Approval is blocked until verification is completed successfully.",
        { code: "RAIL_VERIFICATION_REQUIRED", railId }
      );
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs34.existsSync(sandboxPath)) {
      sendError(res, 400, "Sandbox not found for this rail.", "RAIL_SANDBOX_MISSING");
      return;
    }
    const relFiles = walkDir3(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
    for (const rel of relFiles) {
      const srcFile = path39.join(sandboxPath, rel);
      const rootFile = path39.join(root, rel);
      try {
        const dir = path39.dirname(rootFile);
        if (!fs34.existsSync(dir)) {
          fs34.mkdirSync(dir, { recursive: true });
        }
        const content = fs34.readFileSync(srcFile, "utf-8");
        fs34.writeFileSync(rootFile, content, "utf-8");
      } catch {
      }
    }
    const toMat = transitionRail(root, railId, "MATERIALIZING", { reviewerPassed: true });
    if (!toMat.ok || !toMat.rail) {
      sendError(
        res,
        500,
        toMat.error ?? "Failed to enter MATERIALIZING after verification.",
        "RAIL_MATERIALIZE_ERROR"
      );
      return;
    }
    updateRailState(root, railId, toMat.rail.state);
    const tr = transitionRail(root, railId, "ARCHIVED", { materializationApproved: true });
    if (!tr.ok || !tr.rail) {
      sendError(res, 500, tr.error ?? "Failed to archive rail after materialize.", "RAIL_MATERIALIZE_ERROR");
      return;
    }
    updateRailState(root, railId, tr.rail.state);
    broadcastRailEvent(workspaceId, {
      type: "rail_state",
      railId,
      from: rail.state,
      to: tr.rail.state
    });
    if (supabaseAdmin) {
      writeRailCompletionMemory(workspaceId, tr.rail).catch(() => {
      });
      completeTodosForRail(railId).catch(() => {
      });
    }
    res.json({ railId, state: tr.rail.state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, { code: "RAIL_MATERIALIZE_ERROR", railId });
  }
});
router24.post("/rails/:railId/rollback", requireUser, async (req, res) => {
  const resolved = await resolveRootAndWorkspace(req);
  if ("error" in resolved) {
    sendError(res, resolved.status, resolved.error, "WORKSPACE_REQUIRED");
    return;
  }
  const { root, workspaceId } = resolved;
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs34.existsSync(sandboxPath)) {
      sendError(res, 400, "Sandbox not found for this rail.", "RAIL_SANDBOX_MISSING");
      return;
    }
    const relFiles = walkDir3(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
    for (const rel of relFiles) {
      const srcFile = path39.join(sandboxPath, rel);
      const rootFile = path39.join(root, rel);
      try {
        if (fs34.existsSync(rootFile) && fs34.statSync(rootFile).isFile()) {
          const before = fs34.readFileSync(rootFile, "utf-8");
          const after = fs34.readFileSync(srcFile, "utf-8");
          if (before !== after) {
            fs34.writeFileSync(rootFile, before, "utf-8");
          }
        }
      } catch {
      }
    }
    broadcastRailEvent(workspaceId, {
      type: "rail_rollback",
      railId
    });
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, { code: "RAIL_ROLLBACK_ERROR", railId });
  }
});

// src/greenfieldRoutes.ts
import { Router as Router23 } from "express";
import { randomUUID as randomUUID3 } from "node:crypto";
function computeTopologicalOrder(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = /* @__PURE__ */ new Map();
  for (const e of edges) {
    const list = outEdges.get(e.target) ?? [];
    list.push(e.source);
    outEdges.set(e.target, list);
  }
  const inDegree = /* @__PURE__ */ new Map();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges)
    inDegree.set(e.source, (inDegree.get(e.source) ?? 0) + 1);
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const to of outEdges.get(id) ?? []) {
      const d = (inDegree.get(to) ?? 1) - 1;
      inDegree.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  const ordered = [];
  for (const id of order) {
    const n = byId.get(id);
    if (n) ordered.push(n);
  }
  for (const n of nodes) {
    if (!ordered.some((o) => o.id === n.id)) ordered.push(n);
  }
  return ordered;
}
var router25 = Router23();
async function resolveImplementRoot(workspaceId, targetRoot, userId) {
  if (!supabaseAdmin) return { rootPath: "", error: "Auth service not configured." };
  const { data: ws } = await supabaseAdmin.from("workspaces").select("project_root").eq("id", workspaceId).eq("owner_id", userId).maybeSingle();
  const stored = ws?.project_root;
  if (typeof stored === "string" && stored.trim()) {
    const root = stored.trim();
    return { rootPath: root };
  }
  if (typeof targetRoot === "string" && targetRoot.trim()) {
    return { rootPath: targetRoot.trim() };
  }
  return {
    rootPath: "",
    error: "Workspace has no project root and no targetRoot provided. Scan a repository or provide targetRoot (path to project directory) for Implement."
  };
}
router25.post("/greenfield/session", requireUser, (req, res) => {
  const sessionId2 = randomUUID3();
  const { workspaceId } = req.body ?? {};
  saveDraft(sessionId2, { nodes: [], edges: [], workspaceId });
  res.status(201).json({ sessionId: sessionId2, mode: "greenfield" });
});
router25.get("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId2 = req.params.sessionId;
  if (!sessionId2) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const draft = loadDraft(sessionId2);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  res.json(draft);
});
router25.get("/greenfield/draft/:sessionId/preview", requireUser, (req, res) => {
  const sessionId2 = req.params.sessionId;
  if (!sessionId2) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const draft = loadDraft(sessionId2);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  const ordered = computeTopologicalOrder(draft.nodes, draft.edges);
  const tree = ordered.map((n) => ({
    path: n.id,
    label: n.label || n.id,
    layer: n.layer,
    hasSkeleton: !!(n.skeletonCode && n.skeletonCode.trim())
  }));
  res.json({ nodes: ordered, folderTree: tree });
});
router25.put("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId2 = req.params.sessionId;
  const body = req.body;
  if (!sessionId2) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const draft = saveDraft(sessionId2, {
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
    workspaceId: body.workspaceId
  });
  res.json(draft);
});
router25.delete("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId2 = req.params.sessionId;
  if (!sessionId2) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const deleted = deleteDraft(sessionId2);
  res.json({ deleted });
});
router25.post("/greenfield/nodes", requireUser, (req, res) => {
  const { sessionId: sessionId2, node } = req.body;
  if (!sessionId2 || !node?.id) {
    res.status(400).json({ error: "sessionId and node (with id) are required." });
    return;
  }
  const draft = appendDraftNode(sessionId2, node);
  res.status(201).json({ draftNodeId: node.id, draft });
});
router25.patch("/greenfield/nodes/:nodeId", requireUser, (req, res) => {
  const nodeId = req.params.nodeId;
  const { sessionId: sessionId2, ...updates } = req.body;
  if (!sessionId2 || !nodeId) {
    res.status(400).json({ error: "sessionId (body) and nodeId (path) are required." });
    return;
  }
  const draft = updateDraftNode(sessionId2, nodeId, updates);
  if (!draft) {
    res.status(404).json({ error: "Draft or node not found." });
    return;
  }
  res.json(draft);
});
router25.delete("/greenfield/nodes/:nodeId", requireUser, (req, res) => {
  const nodeId = req.params.nodeId;
  const sessionId2 = req.query.sessionId?.trim();
  if (!sessionId2 || !nodeId) {
    res.status(400).json({ error: "sessionId (query) and nodeId (path) are required." });
    return;
  }
  const draft = removeDraftNode(sessionId2, nodeId);
  if (!draft) {
    res.status(404).json({ error: "Draft or node not found." });
    return;
  }
  res.json(draft);
});
router25.post("/greenfield/edges", requireUser, (req, res) => {
  const { sessionId: sessionId2, edge } = req.body;
  if (!sessionId2 || !edge?.source || !edge?.target) {
    res.status(400).json({ error: "sessionId and edge (source, target) are required." });
    return;
  }
  const draft = appendDraftEdge(sessionId2, edge);
  res.status(201).json({ draft });
});
router25.post("/greenfield/nodes/:nodeId/to-todo", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const nodeId = req.params.nodeId;
  const { sessionId: sessionId2, workspaceId } = req.body;
  if (!sessionId2 || !nodeId || !workspaceId) {
    res.status(400).json({ error: "sessionId, workspaceId, and nodeId are required." });
    return;
  }
  const draft = loadDraft(sessionId2);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  const node = draft.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).json({ error: "Node not found in draft." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).maybeSingle();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const title = node.label || node.id;
  const description = node.description ?? null;
  const { data, error } = await supabaseAdmin.from("todos").insert({
    workspace_id: workspaceId,
    title,
    description,
    phase: null,
    depends_on: null,
    status: "pending",
    source: "greenfield",
    source_path: node.archNodeId ?? node.id
  }).select("*").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ todo: data });
});
router25.post("/greenfield/nodes/:nodeId/to-rail", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const nodeId = req.params.nodeId;
  const { sessionId: sessionId2, workspaceId } = req.body;
  if (!sessionId2 || !nodeId || !workspaceId) {
    res.status(400).json({ error: "sessionId, workspaceId, and nodeId are required." });
    return;
  }
  const draft = loadDraft(sessionId2);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  const node = draft.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).json({ error: "Node not found in draft." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", req.user.id).maybeSingle();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const title = node.label || node.id;
  const description = node.description ?? null;
  const { data: todoRow, error: todoErr } = await supabaseAdmin.from("todos").insert({
    workspace_id: workspaceId,
    title,
    description,
    phase: null,
    depends_on: null,
    status: "pending",
    source: "greenfield",
    source_path: node.archNodeId ?? node.id
  }).select("id").single();
  if (todoErr || !todoRow) {
    res.status(500).json({ error: todoErr?.message ?? "Failed to create todo." });
    return;
  }
  const todoId = String(todoRow.id);
  try {
    const { railId } = await todoToRailCore(todoId, req.user.id);
    res.status(201).json({ railId, todoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create rail.";
    res.status(500).json({ error: msg });
  }
});
router25.post("/greenfield/implement", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { sessionId: sessionId2, workspaceId, targetRoot, nodeIds, acceptanceCriteria } = req.body;
  if (!sessionId2 || !workspaceId) {
    res.status(400).json({ error: "sessionId and workspaceId are required." });
    return;
  }
  const draft = loadDraft(sessionId2);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id, project_root").eq("id", workspaceId).eq("owner_id", req.user.id).maybeSingle();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  let rootPath;
  const resolved = await resolveImplementRoot(workspaceId, targetRoot, req.user.id);
  if (resolved.error || !resolved.rootPath) {
    if (targetRoot?.trim()) {
      const boot = await bootstrapProjectRoot(targetRoot.trim());
      if (boot.error || !boot.rootPath) {
        res.status(400).json({ error: boot.error ?? "Bootstrap failed." });
        return;
      }
      rootPath = boot.rootPath;
    } else {
      res.status(400).json({ error: resolved.error ?? "Project root required." });
      return;
    }
  } else {
    rootPath = resolved.rootPath;
  }
  const currentRoot = ws.project_root;
  if (!currentRoot || currentRoot.trim() !== rootPath) {
    await supabaseAdmin.from("workspaces").update({ project_root: rootPath }).eq("id", workspaceId);
    const { data: graphRow } = await supabaseAdmin.from("graphs").select("id, graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (graphRow?.graph_json) {
      const graph = graphRow.graph_json;
      await supabaseAdmin.from("graphs").update({ graph_json: { ...graph, projectRoot: rootPath } }).eq("id", graphRow.id);
    }
  }
  const rawNodes = Array.isArray(nodeIds) && nodeIds.length > 0 ? draft.nodes.filter((n) => nodeIds.includes(n.id)) : draft.nodes;
  const nodes = computeTopologicalOrder(rawNodes, draft.edges);
  if (nodes.length === 0) {
    res.status(400).json({ error: "No nodes to implement. Add nodes to the draft first." });
    return;
  }
  if (nodes.length > 20) {
    res.status(400).json({
      error: "Maximum 20 nodes per implement. Select a subset or split into batches."
    });
    return;
  }
  const acLines = (acceptanceCriteria?.functional?.length ?? 0) > 0 ? "\nAcceptance: " + (acceptanceCriteria?.functional ?? []).slice(0, 5).join("; ") : "";
  const nodeIdToTodoId = /* @__PURE__ */ new Map();
  const railIds = [];
  const todoIds = [];
  const errors = [];
  for (const node of nodes) {
    const depIds = draft.edges.filter((e) => e.source === node.id).map((e) => e.target).filter((id) => nodeIdToTodoId.has(id));
    const dependsOn = depIds.map((id) => nodeIdToTodoId.get(id)).filter((id) => !!id);
    const title = node.label || node.id;
    let description = (node.description ?? "").trim() + acLines;
    const designerCtx = [];
    if (node.layer) designerCtx.push(`layer: ${node.layer}`);
    if (node.archNodeId) designerCtx.push(`archNodeId: ${node.archNodeId}`);
    if (node.skeletonCode?.trim()) designerCtx.push(`skeleton:
${node.skeletonCode.trim().slice(0, 2e3)}`);
    if (designerCtx.length > 0) {
      description += `

--- Designer context ---
${designerCtx.join("\n")}`;
    }
    const { data: todoRow, error: todoErr } = await supabaseAdmin.from("todos").insert({
      workspace_id: workspaceId,
      title,
      description: description || null,
      phase: null,
      depends_on: dependsOn.length > 0 ? dependsOn : null,
      status: "pending",
      source: "greenfield",
      source_path: node.archNodeId ?? node.id
    }).select("id").single();
    if (todoErr || !todoRow) {
      errors.push(`${node.label ?? node.id}: ${todoErr?.message ?? "Failed to create todo"}`);
      continue;
    }
    const todoId = String(todoRow.id);
    todoIds.push(todoId);
    nodeIdToTodoId.set(node.id, todoId);
    try {
      const { railId } = await todoToRailCore(todoId, req.user.id);
      railIds.push(railId);
      await triggerRailExecution(railId, workspaceId, req.user.id);
    } catch (err) {
      errors.push(
        `${node.label ?? node.id}: ${err instanceof Error ? err.message : "Failed to create/execute rail"}`
      );
    }
  }
  res.status(201).json({
    ok: true,
    railIds,
    todoIds,
    errors: errors.length > 0 ? errors : void 0
  });
});

// src/chatThreads.ts
import { Router as Router24 } from "express";
var router26 = Router24();
var MESSAGES_LIMIT = 100;
router26.get("/workspaces/:workspaceId/threads", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const q = (typeof req.query.q === "string" ? req.query.q.trim() : "") || null;
  let query = supabaseAdmin.from("chat_threads").select("id, title, created_at, updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(50);
  if (q && q.length > 0) {
    query = query.ilike("title", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ threads: data ?? [] });
});
router26.post("/workspaces/:workspaceId/threads", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() || "New chat" : "New chat";
  const { data, error } = await supabaseAdmin.from("chat_threads").insert({ workspace_id: workspaceId, title }).select("id, title, created_at, updated_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});
router26.get("/workspaces/:workspaceId/threads/:threadId/messages", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  if (!threadId) {
    res.status(400).json({ error: "threadId required" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? MESSAGES_LIMIT), 10) || MESSAGES_LIMIT, 200);
  const { data: thread } = await supabaseAdmin.from("chat_threads").select("id").eq("id", threadId).eq("workspace_id", workspaceId).single();
  if (!thread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("chat_messages").select("id, role, content, created_at").eq("thread_id", threadId).order("created_at", { ascending: true }).limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ messages: data ?? [] });
});
router26.post("/workspaces/:workspaceId/threads/:threadId/messages", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!threadId) {
    res.status(400).json({ error: "threadId required" });
    return;
  }
  if (messages.length === 0) {
    res.status(400).json({ error: "messages array required (at least one {role, content})" });
    return;
  }
  const { data: thread } = await supabaseAdmin.from("chat_threads").select("id").eq("id", threadId).eq("workspace_id", workspaceId).single();
  if (!thread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  const rows = messages.filter((m) => m && typeof m === "object" && "role" in m && "content" in m).slice(0, 10).map((m) => ({
    thread_id: threadId,
    role: ["user", "assistant"].includes(String(m.role)) ? m.role : "user",
    content: String(m.content).slice(0, 1e4)
  }));
  if (rows.length === 0) {
    res.status(400).json({ error: "No valid messages" });
    return;
  }
  const { data, error } = await supabaseAdmin.from("chat_messages").insert(rows).select("id, role, content, created_at");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  await supabaseAdmin.from("chat_threads").update({ updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", threadId);
  res.status(201).json({ messages: data ?? [] });
});
router26.patch("/workspaces/:workspaceId/threads/:threadId", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : void 0;
  if (!threadId || !title) {
    res.status(400).json({ error: "threadId and title required" });
    return;
  }
  const { data, error } = await supabaseAdmin.from("chat_threads").update({ title: title.slice(0, 200), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", threadId).eq("workspace_id", workspaceId).select("id, title, updated_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});
var chatThreadRoutes = router26;

// src/userMemories.ts
import { Router as Router25 } from "express";
var router27 = Router25();
var CONTENT_MAX = 2e3;
router27.get("/user/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user.id;
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 100);
  const { data, error } = await supabaseAdmin.from("user_memories").select("id, content, memory_type, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ memories: data ?? [] });
});
router27.post("/user/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user.id;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : void 0;
  const memoryType = typeof req.body?.memory_type === "string" && req.body.memory_type.trim() ? req.body.memory_type.trim() : "user_preference";
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > CONTENT_MAX) {
    res.status(400).json({ error: `content must be at most ${CONTENT_MAX} characters` });
    return;
  }
  const { data, error } = await supabaseAdmin.from("user_memories").insert({
    user_id: userId,
    content: content.slice(0, CONTENT_MAX),
    memory_type: memoryType
  }).select("id, content, memory_type, created_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});
router27.delete("/user/memories/:memoryId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user.id;
  const memoryId = req.params.memoryId;
  if (!memoryId) {
    res.status(400).json({ error: "memoryId required" });
    return;
  }
  const { data, error } = await supabaseAdmin.from("user_memories").delete().eq("id", memoryId).eq("user_id", userId).select("id").maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }
  res.status(204).send();
});
var userMemoriesRoutes = router27;

// src/annotationComments.ts
import { Router as Router26 } from "express";
var router28 = Router26();
router28.get("/workspaces/:workspaceId/annotations/:annotationId/comments", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { annotationId } = req.params;
  const { data: ann } = await supabaseAdmin.from("workspace_annotations").select("id, workspace_id").eq("id", annotationId).single();
  if (!ann || ann.workspace_id !== req.params.workspaceId) {
    res.status(404).json({ error: "Annotation not found." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("annotation_comments").select("id, parent_id, author_id, author_name, content, created_at, updated_at").eq("annotation_id", annotationId).order("created_at", { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ comments: data ?? [] });
});
router28.post("/workspaces/:workspaceId/annotations/:annotationId/comments", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { annotationId } = req.params;
  const { content, parent_id } = req.body ?? {};
  const { data: ann } = await supabaseAdmin.from("workspace_annotations").select("id, workspace_id").eq("id", annotationId).single();
  if (!ann || ann.workspace_id !== req.params.workspaceId) {
    res.status(404).json({ error: "Annotation not found." });
    return;
  }
  const text = typeof content === "string" ? content.trim().slice(0, 5e3) : "";
  if (!text) {
    res.status(400).json({ error: "content is required." });
    return;
  }
  const { data: profile } = await supabaseAdmin.from("profiles").select("nickname").eq("user_id", req.user.id).maybeSingle();
  const authorName = profile?.nickname ?? req.user.email ?? "User";
  const payload = {
    annotation_id: annotationId,
    author_id: req.user.id,
    author_name: authorName,
    content: text
  };
  if (typeof parent_id === "string" && parent_id.trim()) payload.parent_id = parent_id.trim();
  const { data, error } = await supabaseAdmin.from("annotation_comments").insert(payload).select("id, parent_id, author_id, author_name, content, created_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ comment: data });
});
router28.delete("/workspaces/:workspaceId/annotations/:annotationId/comments/:commentId", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { annotationId, commentId } = req.params;
  const { data: comment } = await supabaseAdmin.from("annotation_comments").select("id, author_id, annotation_id").eq("id", commentId).eq("annotation_id", annotationId).maybeSingle();
  if (!comment) {
    res.status(404).json({ error: "Comment not found." });
    return;
  }
  if (comment.author_id !== req.user.id) {
    res.status(403).json({ error: "You can only delete your own comments." });
    return;
  }
  const { error } = await supabaseAdmin.from("annotation_comments").delete().eq("id", commentId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// src/workspaceMembers.ts
import { Router as Router27 } from "express";
var router29 = Router27();
router29.get("/workspaces/:workspaceId/members", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const { data, error } = await supabaseAdmin.from("workspace_members").select("id, user_id, role, invited_at, invited_by").eq("workspace_id", workspaceId).order("invited_at", { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const memberIds = [...new Set((data ?? []).map((m) => m.user_id))];
  const { data: profiles } = await supabaseAdmin.from("profiles").select("user_id, nickname").in("user_id", memberIds);
  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.nickname]));
  const members = (data ?? []).map((m) => ({
    ...m,
    displayName: profileMap.get(m.user_id) ?? m.user_id.slice(0, 8)
  }));
  res.json({ members });
});
router29.post("/workspaces/:workspaceId/members", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const ws = req.workspace;
  if (!ws || ws.owner_id !== req.user.id) {
    res.status(403).json({ error: "Only the owner can invite members." });
    return;
  }
  const { email, userId: bodyUserId, role } = req.body ?? {};
  const roleVal = typeof role === "string" && ["editor", "viewer"].includes(role) ? role : "viewer";
  let targetUserId;
  if (typeof bodyUserId === "string" && bodyUserId.trim()) {
    targetUserId = bodyUserId.trim();
  } else if (typeof email === "string" && email.trim()) {
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1e3 });
    const target = (listData?.users ?? []).find(
      (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
    );
    if (!target) {
      res.status(404).json({ error: "No user found with that email." });
      return;
    }
    targetUserId = target.id;
  } else {
    res.status(400).json({ error: "email or userId is required." });
    return;
  }
  const { error } = await supabaseAdmin.from("workspace_members").upsert(
    {
      workspace_id: workspaceId,
      user_id: targetUserId,
      role: roleVal,
      invited_by: req.user.id
    },
    { onConflict: "workspace_id,user_id" }
  );
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ ok: true, userId: targetUserId, role: roleVal });
});
router29.patch("/workspaces/:workspaceId/members/:memberId", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ws = req.workspace;
  if (!ws || ws.owner_id !== req.user.id) {
    res.status(403).json({ error: "Only the owner can update roles." });
    return;
  }
  const { workspaceId, memberId } = req.params;
  const { role } = req.body ?? {};
  if (typeof role !== "string" || !["editor", "viewer"].includes(role)) {
    res.status(400).json({ error: "role must be 'editor' or 'viewer'." });
    return;
  }
  const { error } = await supabaseAdmin.from("workspace_members").update({ role }).eq("id", memberId).eq("workspace_id", workspaceId).neq("role", "owner");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true, role });
});
router29.delete("/workspaces/:workspaceId/members/:memberId", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId;
  const memberId = req.params.memberId;
  const ws = req.workspace;
  const { data: member } = await supabaseAdmin.from("workspace_members").select("id, user_id, role").eq("id", memberId).eq("workspace_id", workspaceId).maybeSingle();
  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  const canRemove = ws?.owner_id === req.user.id || member.user_id === req.user.id;
  if (!canRemove) {
    res.status(403).json({ error: "Cannot remove this member." });
    return;
  }
  if (member.role === "owner") {
    res.status(403).json({ error: "Cannot remove the owner." });
    return;
  }
  const { error } = await supabaseAdmin.from("workspace_members").delete().eq("id", memberId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// src/githubWebhook.ts
import crypto7 from "crypto";
import { Router as Router28 } from "express";
import { execFileSync as execFileSync3 } from "child_process";
import * as path40 from "path";
import { fileURLToPath as fileURLToPath5 } from "url";
var __dirname5 = path40.dirname(fileURLToPath5(import.meta.url));
var projectRoot3 = process.env.PROJECT_ROOT?.trim() || path40.resolve(__dirname5, "../../..");
var WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET?.trim() || null;
var router30 = Router28();
function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = "sha256=" + crypto7.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  return crypto7.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
function fullNameFromPayload(payload) {
  const repo = payload.repository;
  const name = repo?.full_name;
  return typeof name === "string" ? name : null;
}
router30.post("/", async (req, res) => {
  if (!WEBHOOK_SECRET) {
    res.status(503).json({ error: "GitHub webhook not configured." });
    return;
  }
  const sig = req.headers["x-hub-signature-256"];
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}), "utf-8");
  if (!verifySignature(body, sig ?? "")) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(body.toString("utf-8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const event = req.headers["x-github-event"];
  const fullName = fullNameFromPayload(payload);
  if (!fullName) {
    res.status(400).json({ error: "Repository full_name not found" });
    return;
  }
  let ref;
  let commitSha;
  if (event === "push") {
    ref = payload.ref;
    commitSha = payload.after;
  } else if (event === "pull_request") {
    const pr = payload.pull_request;
    ref = pr?.head?.ref;
    commitSha = pr?.head?.sha;
  } else {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth not configured" });
    return;
  }
  const { data: ws } = await supabaseAdmin.from("workspaces").select("id").eq("github_full_name", fullName).is("archived_at", null).maybeSingle();
  if (!ws) {
    res.status(200).json({ ok: true, noWorkspace: true });
    return;
  }
  const workspaceId = ws.id;
  const repoUrl = `https://github.com/${fullName}`;
  const branch = typeof ref === "string" ? ref.replace(/^refs\/heads\//, "") : void 0;
  const scanHistoryId = await insertScanHistory({
    workspaceId,
    status: "started",
    branch: branch ?? null,
    commitSha: commitSha ?? null,
    ref: ref ?? null,
    trigger: "webhook"
  });
  try {
    const scanArgs = ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId];
    const result = execFileSync3("npx", scanArgs, {
      cwd: projectRoot3,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env }
    });
    const graph = JSON.parse(result);
    const { data: graphInsert, error: gErr } = await supabaseAdmin.from("graphs").insert({
      workspace_id: workspaceId,
      graph_json: graph,
      repo_url: repoUrl
    }).select("id").single();
    if (gErr) throw gErr;
    await supabaseAdmin.from("workspaces").update({ repo_url: repoUrl, github_full_name: fullName }).eq("id", workspaceId);
    embedAndPersistNodes(
      graph,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {
    });
    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {
    });
    if (scanHistoryId) {
      const nodeCount2 = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
      const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
      await updateScanHistory(scanHistoryId, {
        status: "completed",
        node_count: nodeCount2,
        edge_count: edgeCount,
        completed_at: (/* @__PURE__ */ new Date()).toISOString(),
        graph_id: graphInsert?.id ?? null
      });
    }
    res.status(200).json({ ok: true, workspaceId, nodeCount: nodeCount ?? 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (scanHistoryId) {
      await updateScanHistory(scanHistoryId, {
        status: "failed",
        error_message: msg,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    console.error("[githubWebhook] scan failed:", msg);
    res.status(500).json({ error: msg });
  }
});

// src/graphSnapshots.ts
import { Router as Router29 } from "express";
var router31 = Router29();
router31.get(
  "/workspaces/:workspaceId/graph-snapshots",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const limit = Math.min(parseInt(String(req.query.limit ?? 20), 10) || 20, 100);
    const { data: scans, error: scanErr } = await supabaseAdmin.from("scan_history").select("id, graph_id, node_count, edge_count, completed_at").eq("workspace_id", workspaceId).eq("status", "completed").not("graph_id", "is", null).order("completed_at", { ascending: false }).limit(limit);
    if (scanErr) {
      res.status(500).json({ error: scanErr.message });
      return;
    }
    const summaries = (scans ?? []).map((s) => ({
      id: s.graph_id,
      workspaceId,
      scanId: s.id,
      nodeCount: s.node_count ?? 0,
      edgeCount: s.edge_count ?? 0,
      recordedAt: s.completed_at ?? ""
    }));
    res.json({ snapshots: summaries });
  }
);
router31.get(
  "/workspaces/:workspaceId/graph-diff",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const { fromId, toId } = req.query;
    if (!fromId || !toId) {
      res.status(400).json({ error: "fromId and toId query params required." });
      return;
    }
    const [fromRow, toRow] = await Promise.all([
      supabaseAdmin.from("graphs").select("graph_json").eq("id", fromId).eq("workspace_id", workspaceId).single(),
      supabaseAdmin.from("graphs").select("graph_json").eq("id", toId).eq("workspace_id", workspaceId).single()
    ]);
    if (fromRow.error || !fromRow.data) {
      res.status(404).json({ error: "From snapshot not found." });
      return;
    }
    if (toRow.error || !toRow.data) {
      res.status(404).json({ error: "To snapshot not found." });
      return;
    }
    const fromGraph = fromRow.data.graph_json ?? {};
    const toGraph = toRow.data.graph_json ?? {};
    const fromNodes = new Set((fromGraph.nodes ?? []).map((n) => n.id));
    const toNodes = new Set((toGraph.nodes ?? []).map((n) => n.id));
    const fromEdges = new Set((fromGraph.edges ?? []).map((e) => e.id));
    const toEdges = new Set((toGraph.edges ?? []).map((e) => e.id));
    const nodesAdded = [...toNodes].filter((id) => !fromNodes.has(id));
    const nodesRemoved = [...fromNodes].filter((id) => !toNodes.has(id));
    const edgesAdded = [...toEdges].filter((id) => !fromEdges.has(id));
    const edgesRemoved = [...fromEdges].filter((id) => !toEdges.has(id));
    res.json({
      nodesAdded,
      nodesRemoved,
      edgesAdded,
      edgesRemoved,
      fromNodeCount: fromNodes.size,
      toNodeCount: toNodes.size,
      fromEdgeCount: fromEdges.size,
      toEdgeCount: toEdges.size
    });
  }
);
router31.get(
  "/workspaces/:workspaceId/graphs/:graphId",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const graphId = req.params.graphId;
    const { data, error } = await supabaseAdmin.from("graphs").select("graph_json, repo_url, updated_at").eq("id", graphId).eq("workspace_id", workspaceId).single();
    if (error || !data?.graph_json) {
      res.status(404).json({ error: "Snapshot not found." });
      return;
    }
    res.json({
      graph: data.graph_json,
      repoUrl: data.repo_url ?? null,
      updatedAt: data.updated_at ?? null
    });
  }
);

// src/repoDiff.ts
import { Router as Router30 } from "express";
import { execFileSync as execFileSync4 } from "child_process";
import * as path41 from "path";
import { fileURLToPath as fileURLToPath6 } from "url";
var __dirname6 = path41.dirname(fileURLToPath6(import.meta.url));
var projectRoot4 = process.env.PROJECT_ROOT?.trim() || path41.resolve(__dirname6, "../../..");
var router32 = Router30();
function computeDiff(base, head) {
  const baseNodeIds = new Set((base.nodes ?? []).map((n) => n.id));
  const headNodeIds = new Set((head.nodes ?? []).map((n) => n.id));
  const baseEdgeKeys = new Set(
    (base.edges ?? []).map((e) => `${e.source ?? ""}->${e.target ?? ""}`)
  );
  const headEdgeKeys = new Set(
    (head.edges ?? []).map((e) => `${e.source ?? ""}->${e.target ?? ""}`)
  );
  const nodesAdded = (head.nodes ?? []).filter((n) => !baseNodeIds.has(n.id));
  const nodesRemoved = (base.nodes ?? []).filter((n) => !headNodeIds.has(n.id));
  const edgesAdded = (head.edges ?? []).filter(
    (e) => !baseEdgeKeys.has(`${e.source ?? ""}->${e.target ?? ""}`)
  );
  const edgesRemoved = (base.edges ?? []).filter(
    (e) => !headEdgeKeys.has(`${e.source ?? ""}->${e.target ?? ""}`)
  );
  return {
    nodesAdded: nodesAdded.map((n) => ({ id: n.id, label: n.label, layer: n.layer })),
    nodesRemoved: nodesRemoved.map((n) => ({ id: n.id, label: n.label, layer: n.layer })),
    edgesAdded: edgesAdded.map((e) => ({ source: e.source, target: e.target })),
    edgesRemoved: edgesRemoved.map((e) => ({ source: e.source, target: e.target })),
    summary: {
      nodesAdded: nodesAdded.length,
      nodesRemoved: nodesRemoved.length,
      edgesAdded: edgesAdded.length,
      edgesRemoved: edgesRemoved.length
    }
  };
}
router32.get(
  "/workspaces/:workspaceId/diff",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    const workspaceId = req.params.workspaceId;
    const base = req.query.base?.trim() || "main";
    const head = req.query.head?.trim();
    if (!head) {
      res.status(400).json({ error: "head branch or ref is required" });
      return;
    }
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth not configured." });
      return;
    }
    const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (gErr || !graphRow?.repo_url) {
      res.status(404).json({ error: "No repo linked to this workspace." });
      return;
    }
    const repoUrl = graphRow.repo_url.trim();
    if (!repoUrl.match(/github\.com[/:]/i)) {
      res.status(400).json({ error: "Workspace repo is not a GitHub URL." });
      return;
    }
    try {
      const scanBase = execFileSync4(
        "npx",
        ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId, "--branch", base],
        { cwd: projectRoot4, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env } }
      );
      const graphBase = JSON.parse(scanBase);
      const scanHead = execFileSync4(
        "npx",
        ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId, "--branch", head],
        { cwd: projectRoot4, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env } }
      );
      const graphHead = JSON.parse(scanHead);
      const diff = computeDiff(graphBase, graphHead);
      res.json({ base, head, diff });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Diff failed: ${msg}` });
    }
  }
);

// src/githubPrComments.ts
import { Router as Router31 } from "express";
var router33 = Router31();
var GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_ACCESS_TOKEN?.trim() || null;
async function resolveLineForComment(owner, repo, filePath, commitId, headers, node, violation) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(commitId)}`,
      { headers: { ...headers, Accept: "application/vnd.github.raw" } }
    );
    if (!res.ok) return 1;
    const content = await res.text();
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) return 1;
    const tokens = [];
    const lastPart = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
    if (lastPart) tokens.push(lastPart);
    if (node?.label) tokens.push(node.label);
    if (node?.path) {
      const pathLast = String(node.path).split(/[/\\]/).pop();
      if (pathLast && !tokens.includes(pathLast)) tokens.push(pathLast);
    }
    const descWords = (violation.description ?? "").split(/\s+/).filter((w) => w.length >= 3 && /^[\w.-]+$/.test(w)).slice(0, 3);
    tokens.push(...descWords);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const t of tokens) {
        if (t.length >= 2 && new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(line)) {
          return i + 1;
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const t of tokens) {
        if (t.length >= 2 && line.includes(t)) return i + 1;
      }
    }
  } catch {
  }
  return 1;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
router33.post(
  "/workspaces/:workspaceId/pr-comment",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!GITHUB_TOKEN) {
      res.status(503).json({ error: "GITHUB_TOKEN not configured." });
      return;
    }
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const { pullNumber, owner, repo } = req.body;
    if (typeof pullNumber !== "number" || !owner || !repo) {
      res.status(400).json({
        error: "pullNumber (number), owner, and repo are required."
      });
      return;
    }
    const { data: ws } = await supabaseAdmin.from("workspaces").select("id, repo_url, github_full_name").eq("id", workspaceId).single();
    if (!ws) {
      res.status(404).json({ error: "Workspace not found." });
      return;
    }
    const fullName = ws.github_full_name;
    const repoUrl = ws.repo_url;
    const parts = fullName ? fullName.split("/") : typeof repoUrl === "string" ? repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)?.slice(1) : null;
    const effectiveOwner = owner || (parts?.[0] ?? "");
    const effectiveRepo = repo || (parts?.[1] ?? "");
    if (!effectiveOwner || !effectiveRepo) {
      res.status(400).json({ error: "Cannot resolve repo owner/name. Set github_full_name or pass owner+repo." });
      return;
    }
    const violations = await getActiveViolations(
      supabaseAdmin,
      workspaceId
    );
    if (violations.length === 0) {
      res.json({ posted: 0, postedInline: 0, message: "No active violations to post." });
      return;
    }
    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
    let postedInline = 0;
    try {
      const [graphRes, prRes] = await Promise.all([
        supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        fetch(
          `https://api.github.com/repos/${effectiveOwner}/${effectiveRepo}/pulls/${pullNumber}`,
          { headers }
        )
      ]);
      const graphJson = graphRes.data?.graph_json;
      const nodeById = /* @__PURE__ */ new Map();
      if (graphJson?.nodes) {
        for (const n of graphJson.nodes) {
          nodeById.set(n.id, { path: n.path, files: n.files, label: n.label });
        }
      }
      const pr = prRes.ok ? await prRes.json() : null;
      const commitId = pr?.head?.sha;
      if (commitId && nodeById.size > 0) {
        for (const v of violations.slice(0, 15)) {
          const node = nodeById.get(v.source_node_id);
          const rawPath = node?.files?.[0] ?? node?.path;
          const filePath = typeof rawPath === "string" && !rawPath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(rawPath) ? rawPath.replace(/\\/g, "/") : null;
          if (!filePath) continue;
          const line = await resolveLineForComment(
            effectiveOwner,
            effectiveRepo,
            filePath,
            commitId,
            headers,
            node,
            v
          );
          const body = [
            `**[${v.severity}] ${v.type}**`,
            "",
            v.description ?? "",
            v.suggested_fix ? `
**Fix:** ${v.suggested_fix}` : ""
          ].join("").slice(0, 6e4);
          const commentRes = await fetch(
            `https://api.github.com/repos/${effectiveOwner}/${effectiveRepo}/pulls/${pullNumber}/comments`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                body,
                path: filePath,
                commit_id: commitId,
                line,
                side: "RIGHT"
              })
            }
          );
          if (commentRes.ok) postedInline += 1;
        }
      }
      const summaryBody = [
        "## Architecture violations",
        "",
        "| Severity | Type | Description | Fix |",
        "|----------|------|-------------|-----|",
        ...violations.slice(0, 20).map(
          (v) => [
            "|",
            v.severity,
            "|",
            v.type,
            "|",
            (v.description ?? "").replace(/\|/g, "\\|").slice(0, 80),
            "|",
            (v.suggested_fix ?? "").replace(/\|/g, "\\|").slice(0, 60),
            "|"
          ].join(" ")
        ),
        "",
        `_Reported by Arch Visualizer (${violations.length} violation${violations.length === 1 ? "" : "s"})${postedInline > 0 ? ` \u2014 ${postedInline} inline comment${postedInline === 1 ? "" : "s"} posted_` : "_"}`
      ].join("\n");
      const r = await fetch(
        `https://api.github.com/repos/${effectiveOwner}/${effectiveRepo}/issues/${pullNumber}/comments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ body: summaryBody })
        }
      );
      if (!r.ok) {
        const err = await r.text();
        res.status(r.status).json({ error: `GitHub API error: ${err}`, postedInline });
        return;
      }
      res.json({ posted: 1, postedInline, violationsCount: violations.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

// src/githubConnect.ts
import { Router as Router32 } from "express";
var router34 = Router32();
var SUPABASE_URL = process.env.SUPABASE_URL?.trim();
var APP_URL = process.env.APP_URL?.trim() || "http://localhost:5174";
router34.get("/auth/github-connect", requireUser, (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? "").trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  if (!SUPABASE_URL) {
    res.status(503).json({ error: "Auth not configured." });
    return;
  }
  const redirectTo = `${APP_URL}?github-connect=1&workspaceId=${encodeURIComponent(workspaceId)}`;
  const authorizeUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectTo)}&response_type=code&scope=read:user user:email repo`;
  res.redirect(302, authorizeUrl);
});
router34.get(
  "/github/repos",
  requireUser,
  async (req, res) => {
    const workspaceId = String(req.query.workspaceId ?? "").trim();
    const state = String(req.query.state ?? "").trim();
    const githubToken = req.headers["x-github-token"]?.trim();
    if (!githubToken) {
      res.status(400).json({ error: "X-GitHub-Token header required. Sign in with GitHub to get repo access." });
      return;
    }
    if (!workspaceId || !state) {
      res.status(400).json({ error: "workspaceId and state query params required." });
      return;
    }
    try {
      await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user.id);
    } catch {
      res.status(404).json({ error: "Workspace not found or access denied." });
      return;
    }
    try {
      const ghRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${githubToken}`
        }
      });
      if (!ghRes.ok) {
        const txt = await ghRes.text();
        res.status(502).json({ error: `GitHub API error: ${ghRes.status} ${txt.slice(0, 200)}` });
        return;
      }
      const data = await ghRes.json();
      res.json({
        repos: data.map((r) => ({ full_name: r.full_name, id: r.id, private: !!r.private }))
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch repos." });
    }
  }
);

// src/soloWorkspace.ts
import { Router as Router33 } from "express";
var router35 = Router33();
router35.get("/solo/workspace", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const { data: existing } = await supabaseAdmin.from("workspaces").select("id, name, created_at, project_root").eq("owner_id", ownerId).is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    res.json({ workspace: existing, created: false });
    return;
  }
  const { data, error } = await supabaseAdmin.from("workspaces").insert({ owner_id: ownerId, name: "Solo" }).select("id, name, created_at, project_root").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  await supabaseAdmin.from("workspace_members").upsert(
    { workspace_id: data.id, user_id: ownerId, role: "owner" },
    { onConflict: "workspace_id,user_id" }
  );
  res.json({ workspace: data, created: true });
});

// src/index.ts
registerTodoSessionLogSink();
var __dirname7 = path42.dirname(fileURLToPath7(import.meta.url));
var distPath = path42.resolve(__dirname7, "../../client/dist");
if (!fs35.existsSync(distPath)) {
  console.warn(`[static] dist not found at ${distPath} \u2014 run 'npm run build' in the client`);
}
var app = express3();
app.set("trust proxy", 1);
app.use(cors());
app.use(
  "/api/webhooks/github",
  express3.raw({ type: "application/json", limit: "1mb" }),
  router30
);
app.use(
  express3.json({
    limit: "10mb"
  })
);
var PORT = process.env.PORT ?? 4e3;
app.use("/api", router3);
app.use("/api", router8);
app.use("/api", router9);
app.use("/api", router10);
app.use("/api", router4);
app.use("/api", router5);
app.use("/api", router11);
app.use("/api", router23);
app.use("/api", router12);
app.use("/api", router13);
app.use("/api", router14);
app.use("/api", router16);
app.use("/api", router6);
app.use("/api", router17);
app.use("/api", chatThreadRoutes);
app.use("/api", userMemoriesRoutes);
app.use("/api", router18);
app.use("/api", router15);
app.use("/api", router28);
app.use("/api", router29);
app.use("/api", router2);
app.use("/api", router31);
app.use("/api", router);
app.use("/api", router32);
app.use("/api", router33);
app.use("/api", router34);
app.use("/api", router19);
app.use("/api", router22);
app.use("/api", router25);
app.use("/api", router24);
app.use("/api", router7);
app.use("/api", router20);
app.use("/api", router21);
app.use("/api", router35);
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(express3.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path42.join(distPath, "index.html"));
});
if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`Arch Visualizer API running at http://localhost:${PORT}`);
  });
}
export {
  app
};
