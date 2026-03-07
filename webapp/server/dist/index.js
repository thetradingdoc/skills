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

// src/index.ts
import path31 from "path";
import { fileURLToPath as fileURLToPath5 } from "url";
import fs28 from "fs";
import express from "express";
import cors from "cors";

// src/scan.ts
import { Router } from "express";
import { execFileSync } from "child_process";
import * as fs7 from "fs";
import * as path7 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/middleware/optionalUser.ts
import * as jose from "jose";

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
async function jiraFetch(config, path32, options = {}) {
  const url = `${config.baseUrl.replace(/\/$/, "")}${path32}`;
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
function recordTaskLatency(railId, taskId2, ms) {
  const t = ensure(railId);
  t.taskLatencies[taskId2] = ms;
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

// ../../src/agent/traceLogger.ts
var sessionId = "";
var subscriber = null;
var agentSubscriber = null;
var agentTraces = [];
var traceContext = {};
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
function updateTaskEvidence(taskId2, evidence) {
  const existing = inMemoryStore.tasks.get(taskId2);
  if (!existing) return null;
  const updated = { ...existing, evidence };
  inMemoryStore.tasks.set(taskId2, updated);
  const rail = inMemoryStore.rails.get(updated.railId);
  if (rail) {
    const tasks2 = (rail.tasks ?? []).map((t) => t.id === taskId2 ? updated : t);
    const updatedRail = { ...rail, tasks: tasks2, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
    inMemoryStore.rails.set(rail.id, updatedRail);
  }
  return updated;
}
function updateTaskStatus(taskId2, status) {
  const existing = inMemoryStore.tasks.get(taskId2);
  if (!existing) return null;
  const now = Date.now();
  const updated = {
    ...existing,
    status,
    resolvedAt: status === "completed" ? now : existing.resolvedAt
  };
  inMemoryStore.tasks.set(taskId2, updated);
  const rail = inMemoryStore.rails.get(updated.railId);
  if (rail) {
    const tasks2 = (rail.tasks ?? []).map((t) => t.id === taskId2 ? updated : t);
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
  const path32 = [];
  function dfs(node) {
    visited.add(node);
    recStack.add(node);
    path32.push(node);
    for (const n of adj.get(node) ?? []) {
      if (!visited.has(n)) {
        const cycle = dfs(n);
        if (cycle) return cycle;
      } else if (recStack.has(n)) {
        const idx = path32.indexOf(n);
        return path32.slice(idx);
      }
    }
    path32.pop();
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
  const antiWarnings = rootPath && rootPath.trim() ? getAntiPatternWarnings(rootPath, archetype ?? void 0) : [];
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
var router = Router();
function repoNameFromUrl(url) {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}
router.post("/scan", optionalUser, async (req, res) => {
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
  try {
    const result = execFileSync(
      "npx",
      ["tsx", "scripts/scan-repo.ts", trimmed, "--keep"],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env }
      }
    );
    const graph = JSON.parse(result);
    if (isAnonymous) {
      const key = getAnonymousScanKey(req);
      incrementAnonymousCount(key);
    }
    const ownerId = req.user?.id;
    const defaultName = repoNameFromUrl(trimmed) ?? "Imported repository";
    if (ownerId && supabaseAdmin) {
      let workspaceId = null;
      let persistError = null;
      let jiraProjectKey = null;
      try {
        const candidate = typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim() ? requestedWorkspaceId.trim() : null;
        if (candidate) {
          const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id").eq("id", candidate).eq("owner_id", ownerId).maybeSingle();
          if (wsErr) throw wsErr;
          workspaceId = ws?.id ?? null;
        }
        if (!workspaceId) {
          const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").insert({ owner_id: ownerId, name: defaultName }).select("id").single();
          if (wsErr) throw wsErr;
          workspaceId = ws?.id ?? null;
        }
        if (!workspaceId) {
          persistError = "Failed to obtain workspace id after insert.";
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
        const { error: gErr } = await supabaseAdmin.from("graphs").insert({
          workspace_id: workspaceId,
          graph_json: graph,
          repo_url: trimmed
        });
        if (gErr) throw gErr;
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
router.post("/scan/refresh", requireUser, async (req, res) => {
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
  try {
    const result = execFileSync(
      "npx",
      ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep"],
      { cwd: projectRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env } }
    );
    const graph = JSON.parse(result);
    const { error: insErr } = await supabaseAdmin.from("graphs").insert({
      workspace_id: workspaceId,
      graph_json: graph,
      repo_url: repoUrl
    });
    if (insErr) throw insErr;
    embedAndPersistNodes(
      graph,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {
    });
    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {
    });
    res.json({ ...graph, workspaceId });
  } catch (err) {
    const spawnErr = err;
    let message = "Re-scan failed";
    if (spawnErr.code === "ENOENT") message = "Cannot find npx.";
    else if (spawnErr.stderr) message = Buffer.isBuffer(spawnErr.stderr) ? spawnErr.stderr.toString("utf-8").trim() : String(spawnErr.stderr);
    else if (err instanceof Error) message = err.message;
    res.status(500).json({ error: message });
  }
});

// src/chat.ts
import { Router as Router3 } from "express";
import { randomUUID } from "node:crypto";

// ../../src/ai/manager.ts
import * as fs14 from "fs";
import * as path15 from "path";

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
import * as path8 from "path";
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
    const preferred = node.files.filter((f) => /\.(ts|tsx|py)$/.test(f) && !/\.test\.|\.spec\./.test(f)).slice(0, 2);
    for (const f of preferred) {
      const fullPath = path8.join(root, f);
      if (!filesToRead.includes(fullPath)) filesToRead.push(fullPath);
    }
  }
  if (intent === "debug") {
    for (const finding of findings.filter((f) => f.severity === "critical").slice(0, 3)) {
      const loc = path8.isAbsolute(finding.location) ? finding.location : path8.join(root, finding.location);
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

// ../../src/ai/claudeEnricher.ts
import Anthropic2 from "@anthropic-ai/sdk";
import * as fs12 from "fs";
import * as path13 from "path";

// ../../src/agent/sessionPersistence.ts
import * as fs8 from "fs";
import * as path9 from "path";
var SESSION_FILE = ".arch-agent-session.json";
function getSessionPath(projectRoot3) {
  return path9.join(projectRoot3, SESSION_FILE);
}
function saveSession(projectRoot3, session) {
  const p = getSessionPath(projectRoot3);
  fs8.writeFileSync(p, JSON.stringify(session, null, 2), "utf-8");
}
function loadSession(projectRoot3) {
  const p = getSessionPath(projectRoot3);
  if (!fs8.existsSync(p)) return null;
  try {
    const raw = fs8.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function bumpSessionUsage(projectRoot3, delta) {
  const session = loadSession(projectRoot3);
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
  saveSession(projectRoot3, session);
}

// ../../src/agent/skillStore.ts
import * as fs9 from "fs";
import * as path10 from "path";
function getAgentDir(rootPath) {
  return path10.join(rootPath, ".agent");
}
function getSkillsDir(rootPath) {
  return path10.join(getAgentDir(rootPath), "skills");
}
function getIndexPath(rootPath) {
  return path10.join(getAgentDir(rootPath), "skill_index.json");
}
function ensureDirs(rootPath) {
  const agentDir = getAgentDir(rootPath);
  const skillsDir = getSkillsDir(rootPath);
  if (!fs9.existsSync(agentDir)) {
    fs9.mkdirSync(agentDir, { recursive: true });
  }
  if (!fs9.existsSync(skillsDir)) {
    fs9.mkdirSync(skillsDir, { recursive: true });
  }
}
function loadSkillIndex(rootPath) {
  ensureDirs(rootPath);
  const indexPath = getIndexPath(rootPath);
  if (!fs9.existsSync(indexPath)) {
    const empty = { skills: [] };
    fs9.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs9.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.skills) ? parsed : { skills: [] };
  } catch {
    try {
      const backupPath = indexPath.replace(/\.json$/, `.backup.${Date.now()}.json`);
      fs9.copyFileSync(indexPath, backupPath);
    } catch {
    }
    const empty = { skills: [] };
    fs9.writeFileSync(indexPath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}
function saveSkillIndex(rootPath, index) {
  ensureDirs(rootPath);
  const indexPath = getIndexPath(rootPath);
  fs9.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
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

// ../../src/ai/retriever.ts
import * as fs10 from "fs";
import * as path11 from "path";
var MAX_LINES_PER_FILE = 60;
var MAX_TOTAL_CHARS = 6e3;
function resolveFilePath(rootPath, fileOrPath) {
  if (path11.isAbsolute(fileOrPath)) return fileOrPath;
  const normalizedRoot = path11.normalize(rootPath);
  const normalizedFile = path11.normalize(fileOrPath);
  if (normalizedFile.startsWith(normalizedRoot)) {
    return normalizedFile;
  }
  return path11.join(rootPath, fileOrPath);
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
      const fullPath = path11.join(graph.projectRoot, file);
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
      if (!fs10.existsSync(absPath)) {
        filesNotFound.push(absPath);
        console.warn(`[retriever] File not found: ${absPath}`);
        continue;
      }
      content = fs10.readFileSync(absPath, "utf-8");
    } catch {
      filesSkipped += 1;
      continue;
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
    const relPath = path11.relative(rootPath, absPath).replace(/\\/g, "/");
    snippets.push({
      filePath: relPath,
      nodeId: fileToNodeId.get(absPath) ?? path11.dirname(relPath),
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

// ../../src/ai/tools.ts
import { spawnSync } from "child_process";
import * as fs11 from "fs";
import * as path12 from "path";
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
      entries = fs11.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path12.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (ALLOWED_EXTENSIONS.has(path12.extname(e.name))) {
        out.push(full);
        if (out.length >= maxFiles) return out;
      }
    }
  }
  return out;
}
function isUnderRoot(rootPath, absPath) {
  const rel = path12.relative(rootPath, absPath);
  return !rel.startsWith("..") && !path12.isAbsolute(rel);
}
function executeReadFile(rootPath, filePath) {
  const absPath = path12.isAbsolute(filePath) ? filePath : path12.join(rootPath, filePath);
  const root = path12.resolve(rootPath);
  if (!isUnderRoot(root, path12.resolve(absPath))) {
    return { error: "Path outside project root" };
  }
  try {
    if (!fs11.existsSync(absPath)) {
      return { error: `File not found: ${filePath}` };
    }
    const content = fs11.readFileSync(absPath, "utf-8");
    const truncated = content.length > READ_FILE_MAX_CHARS;
    const result = truncated ? content.slice(0, READ_FILE_MAX_CHARS) + "\n\n// ... truncated" : content;
    return { result: `--- ${path12.relative(rootPath, absPath).replace(/\\/g, "/")} ---
${result}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function executeGrep(rootPath, pattern) {
  try {
    const files = walkFiles(rootPath);
    const results = [];
    const relRoot = path12.resolve(rootPath);
    for (const file of files) {
      if (results.length >= GREP_MAX_RESULTS) break;
      let content;
      try {
        content = fs11.readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < GREP_MAX_RESULTS; i++) {
        if (lines[i].includes(pattern)) {
          const relPath = path12.relative(relRoot, file).replace(/\\/g, "/");
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
  const skillsRoot = path12.join(rootPath);
  const relPath = meta.path;
  const absPath = path12.isAbsolute(relPath) ? relPath : path12.join(skillsRoot, relPath);
  if (!fs11.existsSync(absPath)) {
    return { error: `Skill file not found on disk: ${absPath}` };
  }
  const ext = path12.extname(absPath);
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
function executeScaffoldNode(rootPath, params) {
  try {
    const root = path12.resolve(rootPath);
    const absPath = path12.resolve(root, params.relPath);
    if (!isUnderRoot(root, absPath)) {
      return { error: "Path outside project root" };
    }
    const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(params.relPath);
    const targetDir = pathLooksLikeFile ? path12.dirname(absPath) : absPath;
    if (!fs11.existsSync(targetDir)) {
      fs11.mkdirSync(targetDir, { recursive: true });
    }
    const indexPath = pathLooksLikeFile ? absPath : path12.join(absPath, "index.ts");
    const header = `// @archNodeId: ${params.archNodeId}`;
    const boilerplate = `

// TODO: Implement ${params.kind ?? "module"} for layer ${params.layer ?? "Uncategorized"}.

export function TODO_${params.archNodeId.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}() {
  // implementation pending
}
`;
    if (fs11.existsSync(indexPath)) {
      const existing = fs11.readFileSync(indexPath, "utf-8");
      if (!existing.includes("@archNodeId:")) {
        fs11.writeFileSync(indexPath, `${header}
${existing}`, "utf-8");
      }
    } else {
      fs11.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
    }
    const rel = path12.relative(rootPath, indexPath).replace(/\\/g, "/");
    return { result: `Scaffolded node at ${rel}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function executeTelemetryTail(rootPath, params) {
  const logPath = process.env.ARCHY_LOG_PATH?.trim() || path12.join(rootPath, "logs", "app.log");
  if (!fs11.existsSync(logPath)) {
    return {
      error: "Telemetry log file not found. Set ARCHY_LOG_PATH or write logs to logs/app.log."
    };
  }
  try {
    const raw = fs11.readFileSync(logPath, "utf-8");
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
      result: `Telemetry matches from ${path12.relative(
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
  const config = overrides?.config ?? getJiraConfig();
  if (!config) {
    return {
      error: "Jira not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in environment."
    };
  }
  const projectKey = (input.projectKey?.trim() || overrides?.projectKey || "").trim();
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
        return top ? path12.basename(top) : void 0;
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
  const config = overrides?.config ?? getJiraConfig();
  if (!config) {
    return {
      error: "Jira not configured. Connect Jira in the web app or set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in environment."
    };
  }
  if (!ARCH_NODE_ID_SAFE.test(archNodeId)) {
    return {
      error: "archNodeId contains invalid characters. Use only letters, numbers, dash, underscore, slash, dot."
    };
  }
  const projectKey = (overrides?.projectKey ?? "").trim();
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
  const memoryPath = path13.join(root, ".archy.md");
  try {
    if (!fs12.existsSync(memoryPath)) return "";
    const content = fs12.readFileSync(memoryPath, "utf-8").trim();
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
async function executeTool(toolName, toolInput, basePath, graph, availablePaths, keywords, jiraContext) {
  switch (toolName) {
    case "retrieve_files": {
      const files = toolInput.files ?? [];
      const validPaths = files.filter((p) => typeof p === "string" && availablePaths.has(p)).slice(0, 6).map((p) => path13.join(basePath, p));
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
      const skillsDir = path13.join(basePath, ".agent", "skills");
      try {
        if (!fs12.existsSync(skillsDir)) {
          fs12.mkdirSync(skillsDir, { recursive: true });
        }
      } catch (err) {
        return {
          result: `Failed to prepare skills directory: ${err instanceof Error ? err.message : String(err)}`
        };
      }
      const fileName = `${name}${ext}`;
      const absPath = path13.join(skillsDir, fileName);
      const resolved = path13.resolve(absPath);
      const resolvedSkillsDir = path13.resolve(skillsDir);
      if (!resolved.startsWith(resolvedSkillsDir)) {
        return {
          result: "Refused to save skill: resolved path escapes the .agent/skills directory."
        };
      }
      try {
        fs12.writeFileSync(absPath, code, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[save_skill] Failed to write skill file: ${msg}`);
        return {
          result: `Failed to write skill file: ${msg}`
        };
      }
      const relPath = path13.relative(basePath, absPath).replace(/\\/g, "/");
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
      if (!archNodeId || !relPath) {
        return {
          result: "archNodeId and relPath are required to scaffold a node."
        };
      }
      const res = executeScaffoldNode(basePath, {
        archNodeId,
        relPath,
        layer,
        kind
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
    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}
async function askAboutArchitecture(question, graph, nodeId, history, apiKey, findings, rootPath, jiraConfig, jiraProjectKey, rail) {
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
    for (const f of n.files.filter(
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
  const systemPrompt = systemParts.length > 0 ? systemParts + "\n\n" + buildSystemPrompt(graph) : buildSystemPrompt(graph);
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
  const messages = [
    ...railPriorTurns,
    { role: "user", content: contextText }
  ];
  const MAX_STEPS = 6;
  let finalAnswer = "";
  let finalGraphCommand;
  let proposal;
  let usedSaveSkill = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
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
        const { result, proposal: prop } = await executeTool(
          toolUse.name,
          toolUse.input,
          basePath,
          graph,
          availablePaths,
          route.keywords,
          jiraContext
        );
        if (prop) proposal = prop;
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
    return {
      answer: finalAnswer,
      ...finalGraphCommand ? { graphCommand: finalGraphCommand } : {},
      ...proposal ? { proposal } : {},
      ...usedSaveSkill ? { usedSaveSkill: true } : {},
      ...totalInputTokens > 0 || totalOutputTokens > 0 ? { tokenUsage: { input: totalInputTokens, output: totalOutputTokens } } : {}
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
        archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : void 0
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
var GREENFIELD_TOOLS = [
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
              edgeType: { type: "string", enum: ["import", "reexport", "dynamic"] }
            },
            required: ["action"]
          }
        }
      },
      required: ["content"]
    }
  }
];
async function askGreenfield(params) {
  const { question, history = [], apiKeyClaude } = params;
  const client = apiKeyClaude ? new Anthropic3({ apiKey: apiKeyClaude }) : new Anthropic3();
  const historyMessages = (history ?? []).filter((h) => h.role === "user" || h.role === "assistant").map((h) => ({ role: h.role, content: h.content }));
  const messages = historyMessages.length > 0 ? [...historyMessages, { role: "user", content: question }] : [{ role: "user", content: question }];
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: GREENFIELD_SYSTEM_PROMPT,
    messages,
    tools: GREENFIELD_TOOLS,
    tool_choice: { type: "tool", name: "answer" }
  });
  let answer = "";
  const graphCommands = [];
  for (const block of response.content) {
    if (block.type === "text") {
      answer = block.text;
    }
    if (block.type === "tool_use" && block.name === "answer") {
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
  await new Promise((resolve16) => setTimeout(resolve16, 800));
  const { question } = params;
  const { answer, graphCommands } = matchDesign(question);
  return { answer, graphCommands };
}

// ../../src/agent/templateLibrary.ts
import * as fs13 from "fs";
import * as path14 from "path";
function getTemplatePath(rootPath) {
  return path14.join(rootPath, ".agent", "templates.json");
}
function ensureDir2(rootPath) {
  const dir = path14.join(rootPath, ".agent");
  if (!fs13.existsSync(dir)) {
    fs13.mkdirSync(dir, { recursive: true });
  }
}
function loadTemplates(rootPath) {
  ensureDir2(rootPath);
  const p = getTemplatePath(rootPath);
  if (!fs13.existsSync(p)) {
    const empty = { templates: [] };
    fs13.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs13.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.templates) ? parsed : { templates: [] };
  } catch {
    const empty = { templates: [] };
    fs13.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
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
  fs13.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
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
  console.log(`[manager] traceId=${traceId} mode=${mode}`);
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
    rail
  } = params;
  const resolvedRoot = path15.resolve(rootPath);
  const rootExists = fs14.existsSync(resolvedRoot);
  const hasFiles = rootExists && fs14.readdirSync(resolvedRoot, { withFileTypes: true }).some((e) => !e.name.startsWith("."));
  if (!rootExists || !hasFiles) {
    console.warn(
      `[manager] Preflight failed for rootPath=${resolvedRoot} | exists=${rootExists} | hasFiles=${hasFiles}`
    );
    return {
      answer: "ERROR: The source code for this project is missing or has been cleaned up. Please re-scan the repository to regenerate the architecture graph, then try your question again.",
      graphCommand: void 0,
      criticReport: "Preflight check failed: projectRoot directory missing or empty. Manager aborted to avoid hallucinations.",
      criticScore: 0,
      traceId
    };
  }
  console.log(
    `[manager] runAnalysisTask | rootPath=${resolvedRoot} | question="${question.slice(0, 80)}${question.length > 80 ? "\u2026" : ""}"`
  );
  let localHistory = history ?? [];
  try {
    const skillMatches = [...question.matchAll(/skill\s+['"]?([\w-]+)['"]?/gi)];
    for (const m of skillMatches) {
      const skillId = m[1];
      const indexPath = path15.join(resolvedRoot, ".agent", "skill_index.json");
      if (fs14.existsSync(indexPath)) {
        const raw = fs14.readFileSync(indexPath, "utf8");
        const parsed = JSON.parse(raw);
        const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
        const skillMeta = skills.find(
          (s) => s.id === skillId && typeof s.path === "string"
        );
        if (skillMeta?.path) {
          const skillPath = skillMeta.path;
          const absSkillPath = path15.isAbsolute(skillPath) ? skillPath : path15.join(resolvedRoot, skillPath);
          if (fs14.existsSync(absSkillPath)) {
            const skillCode = fs14.readFileSync(absSkillPath, "utf8");
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
  let attempts = 0;
  const maxAttempts = 2;
  let lastAnswer = "";
  let lastGraphCommand;
  let lastCriticReport = "";
  let lastCriticScore = 0;
  let lastProposal;
  let lastViolations = [];
  let lastTokenUsage;
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
      rail ?? void 0
    );
    lastAnswer = claudeResult.answer;
    lastGraphCommand = claudeResult.graphCommand;
    lastProposal = claudeResult.proposal;
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
  return {
    answer: lastAnswer,
    graphCommand: lastGraphCommand,
    criticReport: lastCriticReport,
    criticScore: lastCriticScore,
    proposal: lastProposal,
    violations: lastViolations,
    traceId,
    relevantNodeIds: route.relevantNodeIds,
    ...lastTokenUsage ? { tokenUsage: lastTokenUsage } : {}
  };
}
async function runGreenfieldTask(params) {
  const {
    question,
    history,
    apiKeyOpenAI,
    apiKeyClaude,
    traceId
  } = params;
  console.log(
    `[manager] runGreenfieldTask | traceId=${traceId} | question="${question.slice(0, 80)}${question.length > 80 ? "\u2026" : ""}"`
  );
  try {
    const useMock = process.env.USE_MOCK_GREENFIELD === "1" || process.env.USE_MOCK_GREENFIELD === "true";
    const greenfieldResult = useMock ? await askGreenfieldMock({ question, history }) : await askGreenfield({ question, history, apiKeyClaude });
    const archetype = inferGreenfieldArchetype(params.question);
    const rootPath = params.graph?.projectRoot && typeof params.graph.projectRoot === "string" && params.graph.projectRoot.trim() ? params.graph.projectRoot.trim() : null;
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
    const graphCommands = greenfieldResult.graphCommands ?? (greenfieldResult.graphCommand ? [greenfieldResult.graphCommand] : void 0);
    return {
      answer: greenfieldResult.answer,
      graphCommands,
      graphCommand: graphCommands?.[0],
      criticReport: review.report,
      criticScore: review.score,
      violations: Array.isArray(review.violations) ? review.violations : [],
      traceId,
      acceptanceCriteria: review.acceptanceCriteria,
      archetype
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
        archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : void 0
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
function buildMemoryContextBlock(memories, snapshots, userMemories) {
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
  const taskId2 = crypto.randomUUID();
  const task = {
    taskId: taskId2,
    status: "pending",
    createdAt: Date.now()
  };
  tasks.set(taskId2, task);
  prune();
  return task;
}
function getTask(taskId2) {
  return tasks.get(taskId2);
}
function setTaskRunning(taskId2) {
  const t = tasks.get(taskId2);
  if (t) t.status = "running";
}
function setTaskCompleted(taskId2, result) {
  const t = tasks.get(taskId2);
  if (t && !t.cancelled) {
    t.status = "completed";
    t.result = result;
  }
}
function setTaskFailed(taskId2, error) {
  const t = tasks.get(taskId2);
  if (t) {
    t.status = "failed";
    t.error = error;
  }
}
function cancelTask(taskId2) {
  const t = tasks.get(taskId2);
  if (!t) return false;
  if (t.status === "pending" || t.status === "running") {
    t.cancelled = true;
    t.status = "cancelled";
    return true;
  }
  return false;
}
function isTaskCancelled(taskId2) {
  return tasks.get(taskId2)?.cancelled ?? false;
}

// src/utils/crypto.ts
import crypto3 from "crypto";
import fs15 from "fs";
import path16 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
var __dirname3 = path16.dirname(fileURLToPath3(import.meta.url));
var KEY_FILE = path16.resolve(__dirname3, "../../.encryption-key");
var ALGO = "aes-256-gcm";
var cachedKey = null;
function getOrCreateKey() {
  const envHex = process.env.ENCRYPTION_KEY?.trim();
  if (envHex && envHex.length === 64 && /^[0-9a-fA-F]+$/.test(envHex)) {
    return envHex;
  }
  if (fs15.existsSync(KEY_FILE)) {
    const hex2 = fs15.readFileSync(KEY_FILE, "utf8").trim();
    if (hex2.length === 64 && /^[0-9a-fA-F]+$/.test(hex2)) return hex2;
  }
  const hex = crypto3.randomBytes(32).toString("hex");
  try {
    fs15.writeFileSync(KEY_FILE, hex, { mode: 384 });
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
  } catch {
    return null;
  }
}
async function getUserJiraConfig(userId) {
  const result = await getUserJiraConfigWithSource(userId);
  return result?.config ?? null;
}

// src/jira.ts
import { Router as Router2 } from "express";
var router2 = Router2();
router2.get("/jira-status", requireUser, async (req, res) => {
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
  } catch {
    res.json({ configured: false });
  }
});
function repoNameFromUrl2(url) {
  const m = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:][\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m?.[1] ?? null;
}
async function getWorkspaceProjectKey(workspaceId) {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("workspaces").select("jira_project_key").eq("id", workspaceId).maybeSingle();
  return data?.jira_project_key ?? null;
}
router2.get("/jira-projects", requireUser, async (req, res) => {
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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
async function userOwnsWorkspace(workspaceId, userId) {
  if (!workspaceId || !supabaseAdmin) return !workspaceId;
  const { data } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", userId).single();
  return !!data;
}
router2.get("/jira-issues", requireUser, async (req, res) => {
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
    const issues = await searchIssues(config, jql, 25);
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
      repoName: repoName ?? void 0
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
router2.post("/jira-add-label", requireUser, async (req, res) => {
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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// src/greenfieldDraft.ts
import * as fs16 from "fs";
import * as path17 from "path";
var GREENFIELD_DIR = ".agent/greenfield";
var DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var GC_PROBABILITY = 0.05;
var GC_MIN_INTERVAL_MS = 10 * 60 * 1e3;
function getGreenfieldDir(basePath) {
  return path17.join(basePath, GREENFIELD_DIR);
}
function getDraftPath(basePath, sessionId2) {
  const safe = sessionId2.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 128);
  return path17.join(getGreenfieldDir(basePath), `draft-${safe}.json`);
}
function getBasePath() {
  const base = process.env.PROJECTS_BASE_DIR?.trim() || process.env.PROJECT_ROOT?.trim() || process.cwd();
  return path17.resolve(base);
}
function getDraftTtlMs() {
  const raw = process.env.GREENFIELD_DRAFT_TTL_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DRAFT_TTL_MS;
  return Math.min(n, 30 * 24 * 60 * 60 * 1e3);
}
function getGcStampPath(basePath) {
  return path17.join(getGreenfieldDir(basePath), ".gc-stamp");
}
function canRunGc(basePath) {
  try {
    const stamp = getGcStampPath(basePath);
    if (!fs16.existsSync(stamp)) return true;
    const raw = fs16.readFileSync(stamp, "utf-8").trim();
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
    if (!fs16.existsSync(dir)) fs16.mkdirSync(dir, { recursive: true });
    fs16.writeFileSync(getGcStampPath(basePath), String(Date.now()), "utf-8");
  } catch {
  }
}
function gcDrafts(basePath) {
  const root = basePath ?? getBasePath();
  const dir = getGreenfieldDir(root);
  const ttl = getDraftTtlMs();
  let deleted = 0;
  try {
    if (!fs16.existsSync(dir)) return { deleted };
    const now = Date.now();
    const entries = fs16.readdirSync(dir);
    for (const name of entries) {
      if (!name.startsWith("draft-") || !name.endsWith(".json")) continue;
      const full = path17.join(dir, name);
      try {
        const stat = fs16.statSync(full);
        const age = now - stat.mtimeMs;
        if (age > ttl) {
          fs16.unlinkSync(full);
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
    if (!fs16.existsSync(filePath)) return null;
    const raw = fs16.readFileSync(filePath, "utf-8");
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
  if (!fs16.existsSync(dir)) fs16.mkdirSync(dir, { recursive: true });
  const full = {
    ...draft,
    sessionId: sessionId2,
    nodes: draft.nodes ?? [],
    edges: draft.edges ?? [],
    updatedAt: Date.now()
  };
  const filePath = getDraftPath(root, sessionId2);
  const tmp = `${filePath}.tmp`;
  fs16.writeFileSync(tmp, JSON.stringify(full, null, 2), "utf-8");
  fs16.renameSync(tmp, filePath);
  return full;
}
function deleteDraft(sessionId2, basePath) {
  const root = basePath ?? getBasePath();
  const filePath = getDraftPath(root, sessionId2);
  try {
    if (fs16.existsSync(filePath)) {
      fs16.unlinkSync(filePath);
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

// src/chat.ts
var router3 = Router3();
function maybeCreateAnalysisRail(params) {
  if (params.mode !== "analysis") return;
  if (!params.rootPath) return;
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
  } catch (err) {
    console.error("[chat] maybeCreateAnalysisRail failed", {
      rootPath: params.rootPath,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
router3.post("/chat", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId } = req.body;
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
  const clientMode = req.body?.mode;
  const explicitMode = clientMode === "greenfield" || clientMode === "analysis" ? clientMode : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
  const rootPath = mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== "" ? graph.projectRoot : null;
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
      const [memories, snapshots, userMemories] = await Promise.all([
        getMemoriesForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        getSnapshotsForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        req.user?.id ? getUserMemoriesForContext(supabaseAdmin, req.user.id) : Promise.resolve([])
      ]);
      const memoryBlock = buildMemoryContextBlock(memories, snapshots, userMemories);
      if (memoryBlock) {
        enrichedQuestion = `${memoryBlock}
## Current question
${question}`;
      }
    }
    let jiraConfig;
    let jiraProjectKey;
    if (req.user?.id) {
      const userJira = await getUserJiraConfig(req.user.id);
      if (userJira) {
        jiraConfig = {
          baseUrl: userJira.baseUrl,
          email: userJira.email,
          apiToken: userJira.apiToken
        };
        jiraProjectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? userJira.project ?? void 0;
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
      jiraProjectKey: jiraProjectKey ?? void 0
    });
    const latencyMs = Date.now() - startMs;
    setImmediate(() => {
      try {
        maybeCreateAnalysisRail({
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
          userId: req.user?.id
        });
      } catch {
      }
    });
    const violations = result.violations ?? [];
    if (supabaseAdmin && workspaceId) {
      const client = supabaseAdmin;
      upsertViolations(client, {
        workspaceId,
        violations,
        rulesVersion: ARCH_RULESET_VERSION,
        markAbsent: true
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
            if (supabaseAdmin) await maybePruneWorkspaceMemories(supabaseAdmin, workspaceId);
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
            archNodeId: "archNodeId" in cmd ? cmd.archNodeId : void 0
          });
        }
        if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
          edges.push({ source: cmd.fromId, target: cmd.toId });
        }
      }
      if (nodes.length > 0 || edges.length > 0) {
        try {
          saveDraft(greenfieldSessionId, { nodes, edges, workspaceId: workspaceId ?? void 0 });
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
      }).catch((e) => console.warn("[chat] thread persist:", e instanceof Error ? e.message : e));
    }
    const tokenUsage = result.tokenUsage;
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
      } : {}
    });
  } catch (err) {
    const traceId = err instanceof ArchError ? err.traceId : void 0;
    logArchError(err, traceId, "chat");
    const userMessage = toUserMessage(err, traceId);
    res.status(500).json({ error: userMessage, ...traceId && { traceId } });
  }
});
router3.post("/chat-async", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId } = req.body;
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
  const clientMode = req.body?.mode;
  const explicitMode = clientMode === "greenfield" || clientMode === "analysis" ? clientMode : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
  const rootPath = mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== "" ? graph.projectRoot : null;
  const task = createTask2();
  res.status(202).json({ taskId: task.taskId, status: "pending" });
  setTaskRunning(task.taskId);
  const findings = [];
  let jiraConfig;
  let jiraProjectKey;
  if (req.user?.id) {
    const userJira = await getUserJiraConfig(req.user.id);
    if (userJira) {
      jiraConfig = {
        baseUrl: userJira.baseUrl,
        email: userJira.email,
        apiToken: userJira.apiToken
      };
      jiraProjectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? userJira.project ?? void 0;
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
    jiraProjectKey: jiraProjectKey ?? void 0
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
            archNodeId: "archNodeId" in cmd ? cmd.archNodeId : void 0
          });
        }
        if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
          edges.push({ source: cmd.fromId, target: cmd.toId });
        }
      }
      if (nodes.length > 0 || edges.length > 0) {
        try {
          saveDraft(sessionIdForDraft, { nodes, edges, workspaceId: workspaceId ?? void 0 });
        } catch {
        }
      }
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
      tokenUsage: result.tokenUsage
    });
    setImmediate(() => {
      try {
        maybeCreateAnalysisRail({
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
          userId: req.user?.id
        });
      } catch {
      }
    });
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
      }).catch((e) => console.warn("[chat] thread persist:", e instanceof Error ? e.message : e));
    }
  }).catch((err) => {
    const traceId = err instanceof ArchError ? err.traceId : void 0;
    logArchError(err, traceId, "chat-async");
    try {
      setTaskFailed(task.taskId, toUserMessage(err, traceId));
    } catch {
    }
  });
});

// src/fileContent.ts
import { Router as Router4 } from "express";
var router4 = Router4();
function parseRepoUrl(url) {
  const m = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}
router4.post("/file-content", async (req, res) => {
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
import { Router as Router5 } from "express";
import { spawnSync as spawnSync2 } from "child_process";
import * as path18 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
var __dirname4 = path18.dirname(fileURLToPath4(import.meta.url));
var projectRoot2 = path18.resolve(__dirname4, "../../..");
var router5 = Router5();
router5.post("/validate", async (req, res) => {
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
    const proc = spawnSync2("npx", args, {
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

// src/jiraViolation.ts
import * as crypto4 from "crypto";
import { Router as Router6 } from "express";
var router6 = Router6();
function computeModuleFingerprint(path32, files) {
  const payload = `${path32}:${files.length}:${[...files].sort().join(",")}`;
  return crypto4.createHash("sha256").update(payload).digest("hex").slice(0, 16);
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
function repoNameFromPath(projectRoot3) {
  if (!projectRoot3) return null;
  const parts = projectRoot3.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}
function isJiraOpen(status) {
  return !/done|resolved|closed|complete/i.test(status);
}
async function getWorkspaceProjectKey2(workspaceId) {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("workspaces").select("jira_project_key").eq("id", workspaceId).single();
  return data?.jira_project_key ?? null;
}
router6.post("/jira-violation", requireUser, async (req, res) => {
  const config = await getUserJiraConfig(req.user.id);
  if (!config) {
    res.status(400).json({
      error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app."
    });
    return;
  }
  const { violationId, violation, projectRoot: projectRoot3, projectName, workspaceId, archModulePath, archModuleFiles } = req.body;
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
  } else {
    res.status(400).json({ error: "violationId or violation is required" });
    return;
  }
  if (existingJiraKey) {
    try {
      const existing = await getIssue(config, existingJiraKey);
      if (existing && isJiraOpen(existing.status)) {
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
  const repoName = repoNameFromPath(projectRoot3 ?? "");
  const labels = ["architecture", "littlelabs-auto"];
  if (repoName) labels.push(repoName);
  labels.push(`archNodeId:${vSourceNodeId}`.slice(0, 255));
  const summaryBase = vType.replace(/_/g, " ");
  const pathPart = vTargetNodeId ? `${vSourceNodeId} \u2192 ${vTargetNodeId}` : vSourceNodeId;
  const summary = `[ARCH] ${summaryBase}: ${pathPart}`;
  const modulePath = archModulePath ?? vSourceNodeId;
  const moduleFiles = Array.isArray(archModuleFiles) ? archModuleFiles : [];
  const fingerprint = modulePath && moduleFiles.length > 0 ? computeModuleFingerprint(modulePath, moduleFiles) : null;
  const descriptionLines = [
    "## Architecture Violation \u2014 LittleLabs",
    "",
    `**Type:** ${summaryBase}`,
    `**Severity:** ${vSeverity.toUpperCase()}`,
    `**Detected:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
    projectName ? `**Project:** ${projectName}` : "",
    projectRoot3 ? `**Root:** ${projectRoot3}` : "",
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
    } else if (!storedId && violation && workspaceId && supabaseAdmin) {
      const fp = buildViolationFingerprint(
        { type: vType, severity: vSeverity, sourceNodeId: vSourceNodeId, targetNodeId: vTargetNodeId },
        ARCH_RULESET_VERSION
      );
      const { data: row } = await supabaseAdmin.from("violations").select("id").eq("workspace_id", workspaceId).eq("fingerprint", fp).eq("rules_version", ARCH_RULESET_VERSION).maybeSingle();
      if (row?.id) {
        await markViolationTracked(supabaseAdmin, row.id, issue.key, "To Do");
      }
    }
    res.json({
      key: issue.key,
      url: `${config.baseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
      existing: false
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// src/integrationRoutes.ts
import { Router as Router7 } from "express";
var router7 = Router7();
router7.get("/integrations", requireUser, async (req, res) => {
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
router7.post("/integrations/jira", requireUser, async (req, res) => {
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
router7.delete("/integrations/jira", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  await supabaseAdmin.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "jira");
  res.json({ success: true });
});

// src/scaffold.ts
import { Router as Router8 } from "express";
import path19 from "path";
import * as fs17 from "fs";
var router8 = Router8();
router8.post("/scaffold-node", requireUser, async (req, res) => {
  const { projectRoot: projectRoot3, archNodeId, relPath, layer, kind } = req.body;
  if (!projectRoot3 || !archNodeId || !relPath) {
    res.status(400).json({
      error: "projectRoot, archNodeId, and relPath are required."
    });
    return;
  }
  try {
    const root = path19.resolve(projectRoot3);
    const absPath = path19.join(root, relPath);
    const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
    const targetDir = pathLooksLikeFile ? path19.dirname(absPath) : absPath;
    if (!fs17.existsSync(targetDir)) {
      fs17.mkdirSync(targetDir, { recursive: true });
    }
    const indexPath = pathLooksLikeFile ? absPath : path19.join(absPath, "index.ts");
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
    if (fs17.existsSync(indexPath)) {
      const existing = fs17.readFileSync(indexPath, "utf-8");
      if (!existing.includes("@archNodeId:")) {
        fs17.writeFileSync(indexPath, `${header}
${existing}`, "utf-8");
      }
    } else {
      fs17.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
    }
    const rel = path19.relative(root, indexPath).replace(/\\/g, "/");
    res.json({ message: `Scaffolded node at ${rel}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// src/materialize.ts
import { Router as Router9 } from "express";
import * as fs26 from "fs";
import * as path29 from "path";
import { randomUUID as randomUUID2 } from "node:crypto";

// ../../src/agent/rail/executor.ts
import * as fs18 from "fs";
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
      if (!fs18.existsSync(targetDir)) {
        fs18.mkdirSync(targetDir, { recursive: true });
      }
      const indexPath = pathLooksLikeFile ? absPath : path20.join(absPath, "index.ts");
      const layer = typeof node.layer === "string" ? node.layer : "Uncategorized";
      const header = `// Generated by Arch Visualizer (sandbox). Boilerplate only.
// @archNodeId: ${archNodeId}`;
      const boilerplate = `

// TODO: Implement ${label} (${layer}).

export function TODO_${archNodeId.replace(
        /[^a-zA-Z0-9_]/g,
        "_"
      )}() {
  // implementation pending
}
`;
      if (!fs18.existsSync(indexPath)) {
        fs18.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
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
      if (!fs18.existsSync(src)) continue;
      const dir = path20.dirname(dst);
      if (!fs18.existsSync(dir)) {
        fs18.mkdirSync(dir, { recursive: true });
      }
      fs18.copyFileSync(src, dst);
    } catch {
    }
  }
  return sandboxRoot;
}
function materializeRail(railId, sandboxPath, rootPath) {
  const copiedFiles = [];
  try {
    const sandboxRoot = path20.resolve(sandboxPath);
    const projectRoot3 = path20.resolve(rootPath);
    if (!fs18.existsSync(sandboxRoot)) {
      return { success: false, copiedFiles, error: `Sandbox for rail ${railId} does not exist` };
    }
    const entries = walkDir(sandboxRoot);
    for (const absFile of entries) {
      const rel = path20.relative(sandboxRoot, absFile);
      const target = path20.join(projectRoot3, rel);
      const targetDir = path20.dirname(target);
      if (!fs18.existsSync(targetDir)) {
        fs18.mkdirSync(targetDir, { recursive: true });
      }
      fs18.copyFileSync(absFile, target);
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
    const stat = fs18.statSync(current);
    if (stat.isDirectory()) {
      const children = fs18.readdirSync(current);
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
import * as fs19 from "fs";
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
      if (fs19.existsSync(sandboxPath)) {
        fs19.rmSync(sandboxPath, { recursive: true, force: true });
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
  const acknowledged = !!rail.hallucinationAcknowledgedAt;
  if (hi != null && hi > 0.5 && !acknowledged) {
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

// ../../src/agent/rail/greenfieldSpecGeneration.ts
import * as fs20 from "fs";
import * as path21 from "path";
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
  const fullPath = path21.join(sandboxPath, specRelativePath);
  const dir = path21.dirname(fullPath);
  if (!fs20.existsSync(dir)) {
    fs20.mkdirSync(dir, { recursive: true });
  }
  fs20.writeFileSync(fullPath, content, "utf-8");
  return path21.resolve(fullPath);
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

// ../../src/agent/runPlaywrightTrace.ts
import * as path22 from "path";
import * as fs21 from "fs";
import { spawnSync as spawnSync3 } from "child_process";
var STAGING_TRACES = ".arch-agent-staging/traces";
function collectFailures(suites, tracesDir, traceId) {
  const failures = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === "failed") {
            const screenPath = result.attachments?.find((a) => a.name === "screenshot")?.path ?? path22.join(tracesDir, `${traceId}.png`);
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
function runPlaywrightTrace(projectRoot3, specPath, url, workingDir) {
  const cwd = workingDir ?? projectRoot3;
  const tracesDir = path22.join(cwd, STAGING_TRACES);
  if (!fs21.existsSync(path22.dirname(tracesDir))) {
    fs21.mkdirSync(path22.dirname(tracesDir), { recursive: true });
  }
  if (!fs21.existsSync(tracesDir)) {
    fs21.mkdirSync(tracesDir, { recursive: true });
  }
  const traceId = `pw_${Date.now()}`;
  const tracePath = path22.join(tracesDir, `${traceId}.zip`);
  const jsonOut = path22.join(tracesDir, `${traceId}-results.json`);
  const args = ["playwright", "test", specPath, "--reporter=json"];
  const proc = spawnSync3("npx", args, {
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
    const raw = fs21.existsSync(jsonOut) ? fs21.readFileSync(jsonOut, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    const suites = parsed?.suites ?? [];
    const collected = collectFailures(suites ?? [], tracesDir, traceId);
    if (collected.length > 0) {
      passed = false;
      failures.push(...collected);
    }
    try {
      fs21.unlinkSync(jsonOut);
    } catch {
    }
  } catch {
    if (proc.status !== 0) {
      passed = false;
      failures.push({
        testName: path22.basename(specPath),
        error: (proc.stderr ?? proc.stdout ?? "Playwright failed").slice(0, 500),
        screenshotPath: path22.join(tracesDir, `${traceId}.png`),
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
async function runPlaywrightForRail(railId, projectRoot3, sandboxPath, specs, baseUrl) {
  let allPassed = true;
  const allFailures = [];
  let lastTracePath = "";
  for (const spec of specs) {
    const result = runPlaywrightTrace(projectRoot3, spec, baseUrl, sandboxPath);
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

// ../../src/agent/taskRunner.ts
import * as fs25 from "fs";
import * as path28 from "path";

// ../../src/agent/toolExecutor.ts
import * as fs24 from "fs";
import * as path27 from "path";

// ../../src/agent/securityAllowlist.ts
import * as path23 from "path";
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
function isEnvProtected(basename4) {
  if (basename4 === ".env") return true;
  if (basename4.startsWith(".env.") && !basename4.endsWith(".example") && !basename4.endsWith(".sample")) {
    return true;
  }
  return false;
}
var DEFAULT_ALLOWED_PREFIXES = ["src/", "docs/"];
function checkPathAllowed(filePath, config, mode = "write") {
  const root = path23.resolve(config.projectRoot);
  const resolved = path23.resolve(root, filePath);
  if (!resolved.startsWith(root)) {
    return { allowed: false, reason: "Path outside project root" };
  }
  const relative12 = path23.relative(root, resolved).replace(/\\/g, "/");
  if (relative12.includes("..")) {
    return { allowed: false, reason: "Path traversal not allowed" };
  }
  const ext = path23.extname(resolved);
  const basename4 = path23.basename(resolved);
  if (isEnvProtected(basename4)) {
    return { allowed: false, reason: "Environment files (.env*) are not readable or writable" };
  }
  const isDockerfile = basename4 === "Dockerfile";
  const allowedExts = mode === "read" ? READ_ALLOWED_EXTENSIONS : WRITE_ALLOWED_EXTENSIONS;
  if (!isDockerfile && !allowedExts.has(ext)) {
    return { allowed: false, reason: `Extension ${ext || "<none>"} not allowed for ${mode}` };
  }
  for (const pat of EXCLUDED_PATTERNS) {
    if (pat.test(relative12)) {
      return { allowed: false, reason: `Path matches excluded pattern: ${pat}` };
    }
  }
  const prefixes = config.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const ok = prefixes.some((p) => relative12.startsWith(p));
  if (!ok) {
    return { allowed: false, reason: `Path must be under ${prefixes.join(" or ")}` };
  }
  return { allowed: true };
}

// ../../src/agent/staging.ts
import * as fs22 from "fs";
import * as path24 from "path";
var BUFFER_FILE = "buffer.json";
var stagingDir = "";
var buffer = /* @__PURE__ */ new Map();
function bufferPath() {
  return path24.join(stagingDir, BUFFER_FILE);
}
function saveBuffer() {
  const p = bufferPath();
  const arr = Array.from(buffer.values());
  fs22.writeFileSync(p, JSON.stringify(arr, null, 2), "utf-8");
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
import * as path25 from "path";
import { spawnSync as spawnSync4 } from "child_process";
function runLint(projectRoot3, paths, workingDir) {
  const errors = [];
  const tscProc = spawnSync4("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    cwd: workingDir ?? projectRoot3,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024
  });
  if (tscProc.status !== 0 && tscProc.stderr) {
    const root = path25.resolve(projectRoot3);
    const lines = tscProc.stderr.split("\n");
    for (const line of lines) {
      const match = line.match(/^([^(]+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/);
      if (match) {
        const [, filePath, lineNum, col, message] = match;
        const resolved = path25.isAbsolute(filePath?.trim() ?? "") ? filePath.trim() : path25.join(root, filePath?.trim() ?? "");
        const rel = path25.relative(root, resolved).replace(/\\/g, "/");
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
  const eslintProc = spawnSync4("npx", ["eslint", ...lintPaths, "--format", "json"], {
    cwd: workingDir ?? projectRoot3,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024
  });
  if (eslintProc.stdout) {
    try {
      const out = JSON.parse(eslintProc.stdout);
      const root = path25.resolve(workingDir ?? projectRoot3);
      for (const file of out) {
        const rel = path25.relative(root, path25.isAbsolute(file.filePath) ? file.filePath : path25.join(root, file.filePath)).replace(/\\/g, "/");
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
import * as path26 from "path";
import * as fs23 from "fs";
import { spawnSync as spawnSync5 } from "child_process";
function runVitest(projectRoot3, pattern, workingDir) {
  const cwd = workingDir ?? projectRoot3;
  const jsonFile = path26.join(cwd, ".arch-agent-staging", "vitest-results.json");
  const stagingDir2 = path26.dirname(jsonFile);
  if (!fs23.existsSync(stagingDir2)) {
    fs23.mkdirSync(stagingDir2, { recursive: true });
  }
  const args = ["vitest", "run", "--reporter=json", `--outputFile.json=${jsonFile}`];
  if (pattern) args.push("--testNamePattern", pattern);
  const proc = spawnSync5("npx", args, {
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
    const raw = fs23.existsSync(jsonFile) ? fs23.readFileSync(jsonFile, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    const results = parsed?.testResults ?? parsed?.results;
    if (Array.isArray(results)) {
      for (const file of results) {
        const filePath = path26.relative(cwd, file.name);
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
      fs23.unlinkSync(jsonFile);
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

// ../../src/agent/toolExecutor.ts
var MAX_CONTENT_CHARS = 5e4;
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
    const check = checkPathAllowed(filePath, allowlist, "read");
    if (!check.allowed) {
      const out2 = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("read_file", input, out2.output, `read_file rejected: ${check.reason}`);
      return out2;
    }
    const fullPath = path27.resolve(context.rootPath, filePath);
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
    const check = checkPathAllowed(filePath, allowlist, "write");
    if (!check.allowed) {
      const out2 = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("write_file", input, out2.output, `write_file rejected: ${check.reason}`);
      return out2;
    }
    const fullPath = path27.resolve(context.rootPath, filePath);
    let beforeContent;
    if (fs24.existsSync(fullPath)) {
      beforeContent = fs24.readFileSync(fullPath, "utf-8");
    }
    const stagingId = writeToStaging(filePath, content, { beforeContent });
    const output = { stagingId, path: filePath };
    emitTrace("write_file", { path: filePath }, output, "write_file ok (staged)");
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
var VALID_TOOLS = /* @__PURE__ */ new Set(["write_file", "read_file"]);
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
  }
];
function getTaskFromPlan(plan, taskId2) {
  return plan.tasks.find((t) => t.id === taskId2);
}
function buildUserMessage(ctx) {
  const lines = [
    `Goal: ${ctx.goal}`,
    `Task: ${ctx.taskId} \u2014 ${ctx.taskModule}`,
    ""
  ];
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
  if (ctx.errorOutput) {
    lines.push("Error output (fix these):", ctx.errorOutput, "");
  }
  lines.push(
    "Use write_file for each file you need to create or update. Use read_file if you need to inspect additional context first."
  );
  return lines.join("\n");
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
      emitTrace(
        "llm_call",
        inputForTrace,
        { tool, input: toolUse.input ?? {}, tokens: totalTokens },
        `LLM \u2192 ${tool}`
      );
      return { type: "tool_call", tool, input: toolUse.input ?? {} };
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
var ENTRY_CANDIDATES = ["index.ts", "index.tsx", "index.js", "index.jsx"];
function resolveModuleToFilePath(modulePath, rootPath) {
  const attempted = [];
  const fullDir = path28.resolve(rootPath, modulePath);
  const dirExists = fs25.existsSync(fullDir) && fs25.statSync(fullDir).isDirectory();
  if (dirExists) {
    for (const entry of ENTRY_CANDIDATES) {
      const candidate = path28.join(fullDir, entry);
      attempted.push(path28.relative(rootPath, candidate).replace(/\\/g, "/"));
      if (fs25.existsSync(candidate)) {
        return { path: attempted[attempted.length - 1] };
      }
    }
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${modulePath}${ext}`;
    const full = path28.resolve(rootPath, candidate);
    attempted.push(path28.relative(rootPath, full).replace(/\\/g, "/"));
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
  let filePath;
  let existingContent;
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
    const readResult = await executeTool2("read_file", { path: filePath }, { rootPath });
    if (!readResult.success) {
      return {
        taskId: task.id,
        toolResult: { error: readResult.error, ...readResult.output },
        traceId: getSessionId(),
        error: readResult.error
      };
    }
    existingContent = readResult.output.content;
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
  const MAX_ITER = 20;
  let currentFilePath = filePath;
  let currentFileContent = existingContent;
  let currentError = opts?.errorOutput;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const llmResult = await callLLM({
      role: "code_writer",
      goal: plan.goal,
      plan,
      taskId: task.id,
      taskModule: task.module,
      conversationTurns: opts?.conversationTurns,
      fileContent: currentFileContent,
      filePath: currentFilePath,
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
      const writeResult = await executeTool2("write_file", llmResult.input, { rootPath });
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
      currentFilePath = void 0;
      currentFileContent = void 0;
      currentError = void 0;
      continue;
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
        const secondRead = await executeTool2("read_file", { path: pathToRead }, { rootPath });
        currentFilePath = pathToRead;
        currentFileContent = secondRead.success ? secondRead.output.content : `[Error reading ${pathToRead}: ${secondRead.error}]`;
        lastToolResult = secondRead.success ? secondRead.output : { error: secondRead.error };
      }
      continue;
    }
    if (llmResult.type === "end_turn") {
      lastToolResult = { note: llmResult.content };
      break;
    }
    lastToolResult = { raw: llmResult.raw };
    break;
  }
  return {
    taskId: task.id,
    toolResult: lastToolResult,
    traceId: getSessionId(),
    hasStaging
  };
}

// src/materialize.ts
var router9 = Router9();
var idempotencyCache = /* @__PURE__ */ new Map();
var IDEMPOTENCY_TTL_MS = 60 * 60 * 1e3;
function isPathSafe2(root, relPath) {
  const resolved = path29.resolve(root, relPath);
  const rootNorm = path29.resolve(root);
  return resolved.startsWith(rootNorm) && resolved !== rootNorm;
}
function validateTargetRoot(targetRoot) {
  const root = path29.resolve(targetRoot.trim());
  if (!root || root === "/" || root.length < 2) {
    return { error: "targetRoot must be a valid project directory path." };
  }
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path29.resolve(baseDir);
    if (!root.startsWith(baseNorm + path29.sep) && root !== baseNorm) {
      return { error: "targetRoot must be within the allowed projects directory." };
    }
  }
  return { root };
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
      const absPath = path29.join(root, relPath);
      const pathLooksLikeFile = /\.(ts|tsx|js|jsx)$/.test(relPath);
      const targetDir = pathLooksLikeFile ? path29.dirname(absPath) : absPath;
      if (!fs26.existsSync(targetDir)) {
        fs26.mkdirSync(targetDir, { recursive: true });
      }
      const indexPath = pathLooksLikeFile ? absPath : path29.join(absPath, "index.ts");
      const layer = typeof node.layer === "string" ? node.layer : "Uncategorized";
      const header = `// Generated by Arch Visualizer. Boilerplate only \u2014 implement as needed.
// @archNodeId: ${archNodeId}`;
      const boilerplate = `

// TODO: Implement ${label} (${layer}).

export function TODO_${archNodeId.replace(
        /[^a-zA-Z0-9_]/g,
        "_"
      )}() {
  // implementation pending
}
`;
      if (fs26.existsSync(indexPath)) {
        const existing = fs26.readFileSync(indexPath, "utf-8");
        if (!existing.includes("@archNodeId:")) {
          fs26.writeFileSync(indexPath, `${header}
${existing}`, "utf-8");
        }
      } else {
        fs26.writeFileSync(indexPath, `${header}${boilerplate}`, "utf-8");
      }
      const rel = path29.relative(root, indexPath).replace(/\\/g, "/");
      created.push(rel);
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const success = errors.length === 0;
  if (success && created.length > 0) {
    try {
      const agentDir = path29.join(root, ".agent");
      if (!fs26.existsSync(agentDir)) fs26.mkdirSync(agentDir, { recursive: true });
      const templatesPath = path29.join(agentDir, "design_templates.json");
      const existing = fs26.existsSync(
        templatesPath
      ) ? JSON.parse(fs26.readFileSync(templatesPath, "utf-8")) : { designs: [] };
      const designs = Array.isArray(existing.designs) ? existing.designs : [];
      designs.push({ nodes, createdAt: Date.now() });
      fs26.writeFileSync(templatesPath, JSON.stringify({ designs: designs.slice(-20) }, null, 2), "utf-8");
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
router9.post("/materialize", requireUser, async (req, res) => {
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
router9.post("/materialize/undo", requireUser, async (req, res) => {
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
      const absPath = path29.join(root, trimmed);
      if (fs26.existsSync(absPath)) {
        const stat = fs26.statSync(absPath);
        if (stat.isFile()) {
          fs26.unlinkSync(absPath);
          deleted.push(trimmed);
        } else if (stat.isDirectory()) {
          fs26.rmSync(absPath, { recursive: true, force: true });
          deleted.push(trimmed);
        }
      }
    } catch (err) {
      errors.push(`${trimmed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const dirsToCheck = /* @__PURE__ */ new Set();
  for (const rel of deleted) {
    let d = path29.dirname(rel);
    while (d && d !== ".") {
      dirsToCheck.add(d);
      d = path29.dirname(d);
    }
  }
  const sortedDirs = [...dirsToCheck].sort((a, b) => b.split(path29.sep).length - a.split(path29.sep).length);
  for (const dirRel of sortedDirs) {
    try {
      const absDir = path29.join(root, dirRel);
      if (fs26.existsSync(absDir) && fs26.statSync(absDir).isDirectory()) {
        const entries = fs26.readdirSync(absDir);
        if (entries.length === 0) {
          fs26.rmdirSync(absDir);
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
router9.post("/materialize-async", requireUser, async (req, res) => {
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
        archNodeId: n.archNodeId ?? n.id
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
router9.post("/materialize/approve", requireUser, async (req, res) => {
  const { rootPath, railId } = req.body;
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
  const rail = approveGreenfieldMaterialize(validated.root, railId);
  if (!rail) {
    res.status(404).json({ error: "Rail not found or not a greenfield materialize rail." });
    return;
  }
  res.json({ rail, message: "Materialization complete. Rail archived." });
});

// src/auth.ts
import { Router as Router10 } from "express";
var router10 = Router10();
router10.post("/auth/debug-validate", async (req, res) => {
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
router10.get("/auth/config", (_req, res) => {
  const url = process.env.SUPABASE_URL?.trim();
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = url?.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? null;
  res.json({
    supabaseConfigured: !!(url && hasKey),
    projectRef: projectRef ?? void 0
  });
});
router10.get("/auth/me", requireUser, async (req, res) => {
  res.json({
    user: req.user
  });
});
router10.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

// src/workspaces.ts
import { Router as Router11 } from "express";
var router11 = Router11();
router11.get("/workspaces", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const { data, error } = await supabaseAdmin.from("workspaces").select("id,name,created_at").eq("owner_id", ownerId).order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ workspaces: data ?? [] });
});
router11.post("/workspaces", requireUser, async (req, res) => {
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
  res.json({ workspace: data });
});
router11.get("/workspaces/:workspaceId/load", requireUser, async (req, res) => {
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
  const { data: ws, error: wsErr } = await supabaseAdmin.from("workspaces").select("id, jira_project_key").eq("id", workspaceId).eq("owner_id", ownerId).single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("graph_json, repo_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
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
  res.json({
    graph,
    repoUrl: graphRow.repo_url ?? "",
    jiraProjectKey: ws.jira_project_key ?? null
  });
});
router11.get("/workspaces/:workspaceId/memories", requireUser, async (req, res) => {
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
router11.patch("/workspaces/:workspaceId/memories/:memoryId", requireUser, async (req, res) => {
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
router11.post("/workspaces/:workspaceId/memories", requireUser, async (req, res) => {
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
  void maybePruneWorkspaceMemories(supabaseAdmin, workspaceId);
  return res.status(201).json({ memory: data });
});
router11.delete("/workspaces/:workspaceId/memories/:memoryId", requireUser, async (req, res) => {
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
router11.delete("/workspaces/:workspaceId", requireUser, async (req, res) => {
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
    const { error: delErr } = await supabaseAdmin.from("workspaces").delete().eq("id", workspaceId).eq("owner_id", ownerId);
    if (delErr) {
      console.error("[workspaces] delete: delete failed", {
        workspaceId,
        ownerId,
        error: delErr.message
      });
      res.status(500).json({ error: delErr.message });
      return;
    }
    console.log("[workspaces] delete: success", { workspaceId, ownerId });
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspaces] delete: unexpected error", { workspaceId, ownerId, error: msg });
    res.status(500).json({ error: msg });
  }
});
router11.patch("/workspaces/:workspaceId/jira-project-key", requireUser, async (req, res) => {
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
router11.patch("/workspaces/:workspaceId", requireUser, async (req, res) => {
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
router11.post("/workspaces/:workspaceId/save", requireUser, async (req, res) => {
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
  res.json({ success: true });
});

// src/shareRoutes.ts
import { Router as Router12 } from "express";
import { nanoid } from "nanoid";
if (!process.env.APP_URL) {
  console.warn("[shareRoutes] APP_URL not set \u2014 share links may have incorrect base URL");
}
var router12 = Router12();
router12.post("/workspaces/:workspaceId/share", requireUser, async (req, res) => {
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
router12.get("/shared/:slug", async (req, res) => {
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
import { Router as Router13 } from "express";
var router13 = Router13();
router13.get("/metrics/agent", requireUser, async (req, res) => {
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
router13.get("/metrics", (_req, res) => {
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

// src/taskRoutes.ts
import { Router as Router14 } from "express";
var router14 = Router14();
router14.get("/tasks/:taskId", optionalUser, (req, res) => {
  const { taskId: taskId2 } = req.params;
  const task = getTask(taskId2);
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
router14.post("/tasks/:taskId/cancel", optionalUser, (req, res) => {
  const { taskId: taskId2 } = req.params;
  const cancelled = cancelTask(taskId2);
  if (!cancelled) {
    res.status(404).json({ error: "Task not found or not cancellable" });
    return;
  }
  res.json({ taskId: taskId2, status: "cancelled" });
});

// src/violations.ts
import { Router as Router15 } from "express";
var router15 = Router15();
var scanCooldowns = /* @__PURE__ */ new Map();
router15.get("/violations", requireUser, async (req, res) => {
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
router15.post("/violations/scan", requireUser, async (req, res) => {
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
  const { data: graphRow, error: gErr } = await supabaseAdmin.from("graphs").select("graph_json").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (gErr || !graphRow?.graph_json) {
    res.status(404).json({
      error: gErr?.message ?? "No graph saved for this workspace."
    });
    return;
  }
  try {
    const graph = graphRow.graph_json;
    await runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Violation scan failed"
    });
  }
});
router15.post("/violations/:id/dismiss", requireUser, async (req, res) => {
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
import { Router as Router16 } from "express";
import * as path30 from "path";
import * as fs27 from "fs";
var router16 = Router16();
function walkDir2(dir, base, maxDepth) {
  const out = [];
  if (maxDepth <= 0) return out;
  try {
    const entries = fs27.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path30.relative(base, path30.join(dir, e.name));
      if (e.isDirectory()) {
        out.push(rel + "/");
        out.push(...walkDir2(path30.join(dir, e.name), base, maxDepth - 1));
      } else {
        out.push(rel);
      }
    }
  } catch {
  }
  return out.sort();
}
function resolveRootPath(raw) {
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return { error: "rootPath query is required." };
  }
  const root = path30.resolve(raw.trim());
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path30.resolve(baseDir);
    if (!root.startsWith(baseNorm + path30.sep) && root !== baseNorm) {
      return { error: "rootPath must be within the allowed projects directory." };
    }
  }
  return { root };
}
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
router16.get("/rails", optionalUser, async (req, res) => {
  const rootPath = req.query.rootPath?.trim();
  const workspaceId = req.query.workspaceId?.trim();
  let resolved;
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root. Set project_root or pass rootPath." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  try {
    loadRails(resolved.root);
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
router16.get("/rails/:railId", optionalUser, async (req, res) => {
  const rootPath = req.query.rootPath?.trim();
  const workspaceId = req.query.workspaceId?.trim();
  let resolved;
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    res.status(400).json({ error: "railId is required." });
    return;
  }
  try {
    loadRails(resolved.root);
    const rail = getRail(resolved.root, railId);
    if (!rail) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
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
      tasks: rail.tasks ?? [],
      traces: rail.traces ?? null,
      telemetry: rail.telemetry ?? null
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router16.post("/rails/:railId/state", optionalUser, async (req, res) => {
  const rootPath = req.query.rootPath?.trim();
  const workspaceId = req.query.workspaceId?.trim();
  let resolved;
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const railId = req.params.railId;
  const to = req.body?.state?.trim();
  if (!railId || !to) {
    res.status(400).json({ error: "railId and state are required." });
    return;
  }
  try {
    loadRails(resolved.root);
    const current = getRail(resolved.root, railId);
    if (!current) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    const result = transitionRail(resolved.root, railId, to);
    if (!result.ok || !result.rail) {
      res.status(400).json({ error: result.error ?? "Invalid transition." });
      return;
    }
    updateRailState(resolved.root, railId, result.rail.state);
    res.json({
      id: result.rail.id,
      state: result.rail.state
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router16.post("/rails/:railId/execute", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    res.status(400).json({ error: "workspaceId and auth required." });
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    res.status(400).json({ error: "Workspace has no project_root." });
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    res.status(400).json({ error: "railId required." });
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    if (rail.archetype !== "analysis-chat") {
      res.status(400).json({ error: "Only analysis-chat rails can be executed." });
      return;
    }
    const codeTasks = (rail.tasks ?? []).filter((t) => t.kind === "code_change");
    if (codeTasks.length === 0) {
      res.status(400).json({ error: "Rail has no code_change tasks to run." });
      return;
    }
    if (!["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(rail.state)) {
      res.status(400).json({ error: `Rail must be in PRE_PLANNING, PLANNING, or AWAITING_APPROVAL. Current: ${rail.state}` });
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
      for (let idx = 0; idx < plan.tasks.length && !isTaskCancelled(bgTask.taskId); idx++) {
        const railTask = codeTasks[idx];
        if (railTask) updateTaskStatus(railTask.id, "executing");
        await runTaskAtIndex(plan, idx, sandboxPath, { apiKey });
        if (railTask) updateTaskStatus(railTask.id, "completed");
      }
      const lint = runLint(root, void 0, sandboxPath);
      const vitest = runVitest(root, void 0, sandboxPath);
      const passed = lint.passed && vitest.passed;
      const errorOutput = [
        !lint.passed ? `Lint: ${JSON.stringify(lint.errors.slice(0, 5))}` : "",
        !vitest.passed ? `Vitest: ${JSON.stringify(vitest.failures.slice(0, 3))}` : ""
      ].filter(Boolean).join("\n");
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
      updateTaskEvidence(verificationTaskId, JSON.stringify({ lint, vitest }));
      updateRailPartial(root, railId, {
        lastCritique: {
          source: passed ? "test" : "lint",
          message: passed ? "Lint and Vitest passed." : errorOutput,
          createdAt: Date.now()
        }
      });
      const toState = passed ? "VERIFYING" : "SELF_CORRECTING";
      transitionRail(root, railId, toState);
      setTaskCompleted(bgTask.taskId, {
        message: passed ? "Verification passed. You can approve materialization." : "Verification failed. Review failures in rail detail.",
        railId: rail.id,
        verificationPassed: passed,
        lint: { passed: lint.passed, errors: lint.errors.length },
        vitest: { passed: vitest.passed, failures: vitest.failures.length }
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setTaskFailed(bgTask.taskId, msg);
      updateRailPartial(root, railId, {
        lastCritique: { source: "unknown", message: msg, createdAt: Date.now() }
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
router16.get("/rails/:railId/sandbox/files", requireUser, async (req, res) => {
  const workspaceId = req.query.workspaceId?.trim();
  if (!workspaceId || !req.user?.id) {
    res.status(401).json({ error: "workspaceId and auth required." });
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    res.status(400).json({ error: "Workspace has no project_root." });
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    res.status(400).json({ error: "railId required." });
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs27.existsSync(sandboxPath)) {
      res.json({ paths: [] });
      return;
    }
    const paths = walkDir2(sandboxPath, sandboxPath, 4);
    res.json({ paths });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// src/greenfieldRoutes.ts
import { Router as Router17 } from "express";
import { randomUUID as randomUUID3 } from "node:crypto";
var router17 = Router17();
router17.post("/greenfield/session", requireUser, (req, res) => {
  const sessionId2 = randomUUID3();
  const { workspaceId } = req.body ?? {};
  saveDraft(sessionId2, { nodes: [], edges: [], workspaceId });
  res.status(201).json({ sessionId: sessionId2, mode: "greenfield" });
});
router17.get("/greenfield/draft/:sessionId", requireUser, (req, res) => {
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
router17.put("/greenfield/draft/:sessionId", requireUser, (req, res) => {
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
router17.delete("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId2 = req.params.sessionId;
  if (!sessionId2) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const deleted = deleteDraft(sessionId2);
  res.json({ deleted });
});
router17.post("/greenfield/nodes", requireUser, (req, res) => {
  const { sessionId: sessionId2, node } = req.body;
  if (!sessionId2 || !node?.id) {
    res.status(400).json({ error: "sessionId and node (with id) are required." });
    return;
  }
  const draft = appendDraftNode(sessionId2, node);
  res.status(201).json({ draftNodeId: node.id, draft });
});
router17.patch("/greenfield/nodes/:nodeId", requireUser, (req, res) => {
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
router17.delete("/greenfield/nodes/:nodeId", requireUser, (req, res) => {
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
router17.post("/greenfield/edges", requireUser, (req, res) => {
  const { sessionId: sessionId2, edge } = req.body;
  if (!sessionId2 || !edge?.source || !edge?.target) {
    res.status(400).json({ error: "sessionId and edge (source, target) are required." });
    return;
  }
  const draft = appendDraftEdge(sessionId2, edge);
  res.status(201).json({ draft });
});

// src/chatThreads.ts
import { Router as Router18 } from "express";
var router18 = Router18();
var MESSAGES_LIMIT = 100;
async function verifyWorkspace(workspaceId, ownerId) {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin.from("workspaces").select("id").eq("id", workspaceId).eq("owner_id", ownerId).single();
  return !!data;
}
router18.get("/workspaces/:workspaceId/threads", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
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
router18.post("/workspaces/:workspaceId/threads", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() || "New chat" : "New chat";
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("chat_threads").insert({ workspace_id: workspaceId, title }).select("id, title, created_at, updated_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});
router18.get("/workspaces/:workspaceId/threads/:threadId/messages", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  if (!workspaceId || !threadId) {
    res.status(400).json({ error: "workspaceId and threadId required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
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
router18.post("/workspaces/:workspaceId/threads/:threadId/messages", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!workspaceId || !threadId) {
    res.status(400).json({ error: "workspaceId and threadId required" });
    return;
  }
  if (messages.length === 0) {
    res.status(400).json({ error: "messages array required (at least one {role, content})" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
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
router18.patch("/workspaces/:workspaceId/threads/:threadId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user.id;
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : void 0;
  if (!workspaceId || !threadId || !title) {
    res.status(400).json({ error: "workspaceId, threadId, and title required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin.from("chat_threads").update({ title: title.slice(0, 200), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", threadId).eq("workspace_id", workspaceId).select("id, title, updated_at").single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});
var chatThreadRoutes = router18;

// src/userMemories.ts
import { Router as Router19 } from "express";
var router19 = Router19();
var CONTENT_MAX = 2e3;
router19.get("/user/memories", requireUser, async (req, res) => {
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
router19.post("/user/memories", requireUser, async (req, res) => {
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
router19.delete("/user/memories/:memoryId", requireUser, async (req, res) => {
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
var userMemoriesRoutes = router19;

// src/index.ts
var __dirname5 = path31.dirname(fileURLToPath5(import.meta.url));
var distPath = path31.resolve(__dirname5, "../../client/dist");
if (!fs28.existsSync(distPath)) {
  console.warn(`[static] dist not found at ${distPath} \u2014 run 'npm run build' in the client`);
}
var app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(
  express.json({
    limit: "10mb"
  })
);
var PORT = process.env.PORT ?? 4e3;
app.use("/api", router);
app.use("/api", router3);
app.use("/api", router4);
app.use("/api", router5);
app.use("/api", router2);
app.use("/api", router6);
app.use("/api", router7);
app.use("/api", router15);
app.use("/api", router8);
app.use("/api", router9);
app.use("/api", router10);
app.use("/api", router11);
app.use("/api", chatThreadRoutes);
app.use("/api", userMemoriesRoutes);
app.use("/api", router12);
app.use("/api", router13);
app.use("/api", router14);
app.use("/api", router16);
app.use("/api", router17);
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path31.join(distPath, "index.html"));
});
app.listen(PORT, () => {
  console.log(`Arch Visualizer API running at http://localhost:${PORT}`);
});
