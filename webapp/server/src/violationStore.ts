/**
 * violationStore.ts  —  webapp/server/src/violationStore.ts
 *
 * Concurrency-friendly upsert of critic violations into the `violations` table,
 * plus helpers for reading active / blocking violations and marking Jira linkage.
 *
 * Fingerprint contract:
 * - Must uniquely identify a structural invariant violation.
 * - Must change when invariant semantics (ruleset) change.
 * - Must NOT change for internal refactors of the critic implementation.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoredViolation {
  id: string;
  workspace_id: string | null;
  fingerprint: string;
  rules_version: string;
  type: string;
  severity: string;
  source_node_id: string;
  target_node_id: string | null;
  description: string | null;
  suggested_fix: string | null;
  structural_state: "active" | "absent";
  first_seen_at: string;
  last_seen_at: string;
  recurrence_count: number;
  policy_state: "new" | "tracked" | "accepted" | "resolved" | "waived" | "regressed";
  jira_key: string | null;
  jira_status: string | null;
}

interface RawViolation {
  type: string;
  severity: string;
  sourceNodeId: string;
  targetNodeId?: string;
  description?: string;
  suggestedFix?: string;
}

interface UpsertOptions {
  workspaceId: string | null;
  violations: RawViolation[];
  rulesVersion?: string;
  /**
   * If true, mark any active violations NOT in this batch as absent,
   * then auto-resolve them if they were tracked/new/regressed.
   * Only pass true on full-scan runs, not per-chat runs.
   */
  markAbsent?: boolean;
}

export function buildViolationFingerprint(v: RawViolation, rulesVersion: string): string {
  const raw = [rulesVersion, v.type, v.sourceNodeId.trim(), (v.targetNodeId ?? "").trim()]
    .join("|")
    .toLowerCase();
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function buildFingerprint(v: RawViolation, rulesVersion: string): string {
  return buildViolationFingerprint(v, rulesVersion);
}

const SEVERITY_ORDER = ["medium", "high", "critical"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

function escalateSeverity(current: string, newRecurrence: number): string {
  const idx = SEVERITY_ORDER.indexOf(current as Severity);
  if (idx === -1) return current;
  if (newRecurrence >= 15 && idx < 2) return "critical";
  if (newRecurrence >= 5 && idx < 1) return "high";
  return current;
}

export async function upsertViolations(
  db: SupabaseClient,
  opts: UpsertOptions
): Promise<StoredViolation[]> {
  const { workspaceId, violations, rulesVersion, markAbsent = false } = opts;
  if (!workspaceId || !rulesVersion) return [];
  if (violations.length === 0 && !markAbsent) return [];

  const now = new Date().toISOString();
  const seenFingerprints = new Set<string>();

  // Deduplicate within this batch by fingerprint to avoid double-counting
  // the same violation twice in a single critic run.
  const batchByFingerprint = new Map<
    string,
    { violation: RawViolation; fingerprint: string }
  >();
  for (const v of violations) {
    const fp = buildFingerprint(v, rulesVersion);
    const existing = batchByFingerprint.get(fp);
    if (!existing) {
      batchByFingerprint.set(fp, { violation: v, fingerprint: fp });
    } else {
      // keep the worse severity if duplicates disagree
      const existingSev = existing.violation.severity;
      const incomingSev = v.severity;
      const order = ["low", "medium", "high", "critical"];
      const next =
        order.indexOf(incomingSev) > order.indexOf(existingSev) ? v : existing.violation;
      batchByFingerprint.set(fp, { violation: next, fingerprint: fp });
    }
  }

  const { data: existingRows } = await db
    .from("violations")
    .select("id, fingerprint, recurrence_count, policy_state, severity, structural_state, last_seen_at")
    .eq("workspace_id", workspaceId)
    .eq("rules_version", rulesVersion);

  const existingByFingerprint = new Map((existingRows ?? []).map((r: any) => [r.fingerprint, r]));

  const upsertRows: Record<string, unknown>[] = [];

  for (const { violation: v, fingerprint } of batchByFingerprint.values()) {
    seenFingerprints.add(fingerprint);

    const existing = existingByFingerprint.get(fingerprint) as
      | (StoredViolation & { last_seen_at?: string })
      | undefined;

    const lastSeenAt = existing?.last_seen_at;
    const hoursSince =
      lastSeenAt != null ? (Date.now() - new Date(lastSeenAt).getTime()) / 36e5 : Number.POSITIVE_INFINITY;
    const shouldBump = hoursSince >= 4; // 4h window

    const newRecurrence = shouldBump
      ? (existing?.recurrence_count ?? 0) + 1
      : existing?.recurrence_count ?? 1;

    const incomingSeverity = v.severity;
    const escalated = escalateSeverity(incomingSeverity, newRecurrence);
    const existingSeverity = existing?.severity ?? incomingSeverity;
    const severityOrder = ["low", "medium", "high", "critical"];
    const finalSeverity =
      severityOrder.indexOf(escalated) > severityOrder.indexOf(existingSeverity)
        ? escalated
        : existingSeverity;

    const isRegression = existing?.policy_state === "resolved";
    const newPolicyState: string =
      isRegression ? "regressed" : existing?.policy_state ?? "new";

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
      jira_key: (existing as any)?.jira_key ?? null,
      jira_status: (existing as any)?.jira_status ?? null,
    });
  }

  const upserted: StoredViolation[] = [];

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
        p_now: now,
      });
      if (!error && data) {
        upserted.push(data as StoredViolation);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[violationStore] bump_violation rpc error:", err);
    }
  }

  if (markAbsent) {
    const { data: freshActive } = await db
      .from("violations")
      .select("id,fingerprint,structural_state,policy_state")
      .eq("workspace_id", workspaceId)
      .eq("rules_version", rulesVersion)
      .eq("structural_state", "active");

    const activeRows = (freshActive as any[] | null) ?? [];
    const toMarkAbsent = activeRows.filter(
      (r) => !seenFingerprints.has(r.fingerprint)
    );

    if (toMarkAbsent.length > 0) {
      const idsToAbsent = toMarkAbsent.map((r) => r.id);

      await db
        .from("violations")
        .update({ structural_state: "absent" })
        .in("id", idsToAbsent);

      const idsToResolve = toMarkAbsent
        .filter((r) => ["new", "tracked", "regressed"].includes(r.policy_state))
        .map((r) => r.id);

      if (idsToResolve.length > 0) {
        await db
          .from("violations")
          .update({ policy_state: "resolved" })
          .in("id", idsToResolve);
      }
    }
  }

  return upserted;
}

export async function getActiveViolations(
  db: SupabaseClient,
  workspaceId: string
): Promise<StoredViolation[]> {
  const { data, error } = await db
    .from("violations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("structural_state", "active")
    .not("policy_state", "in", '("resolved","waived","accepted")')
    .order("recurrence_count", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as StoredViolation[];
}

export async function getBlockingViolations(
  db: SupabaseClient,
  workspaceId: string,
  nodeIds: string[]
): Promise<StoredViolation[]> {
  if (nodeIds.length === 0) return [];

  const [bySource, byTarget] = await Promise.all([
    db
      .from("violations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("structural_state", "active")
      .in("policy_state", ["tracked", "regressed"])
      .in("severity", ["critical", "high"])
      .in("source_node_id", nodeIds),
    db
      .from("violations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("structural_state", "active")
      .in("policy_state", ["tracked", "regressed"])
      .in("severity", ["critical", "high"])
      .in("target_node_id", nodeIds),
  ]);

  if (bySource.error || byTarget.error) {
    return [];
  }

  const merged = [...(bySource.data ?? []), ...(byTarget.data ?? [])] as StoredViolation[];
  const byId = new Map<string, StoredViolation>();
  for (const v of merged) {
    byId.set(v.id, v);
  }
  return Array.from(byId.values());
}

export async function getViolationSummariesByNode(
  db: SupabaseClient,
  workspaceId: string
): Promise<Record<string, { highestSeverity: string; count: number; lastSeenAt?: number }>> {
  const { data, error } = await db
    .from("violations")
    .select("source_node_id,severity,last_seen_at,structural_state,policy_state")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  const rows = (data as any[]) ?? [];
  const summaries: Record<string, { highestSeverity: string; count: number; lastSeenAt?: number }> = {};
  const order = ["low", "medium", "high", "critical"];
  for (const r of rows) {
    if (r.structural_state !== "active") continue;
    if (["resolved", "waived", "accepted"].includes(r.policy_state)) continue;
    const nodeId = String(r.source_node_id);
    const sev = String(r.severity || "medium");
    const ts = r.last_seen_at ? Date.parse(r.last_seen_at as string) : undefined;
    const existing = summaries[nodeId];
    if (!existing) {
      summaries[nodeId] = { highestSeverity: sev, count: 1, lastSeenAt: ts };
    } else {
      existing.count += 1;
      if (order.indexOf(sev) > order.indexOf(existing.highestSeverity)) {
        existing.highestSeverity = sev;
      }
      if (ts && (!existing.lastSeenAt || ts > existing.lastSeenAt)) {
        existing.lastSeenAt = ts;
      }
    }
  }
  return summaries;
}

/**
 * Build a human-readable governance notice for the agent given a set of node IDs.
 * This is designed to be injected into the system prompt or question context.
 */
export async function buildGovernanceNotice(
  db: SupabaseClient,
  workspaceId: string,
  nodeIds: string[]
): Promise<string> {
  const blocking = await getBlockingViolations(db, workspaceId, nodeIds);
  if (!blocking.length) return "";

  const lines = blocking.map((v) => {
    const parts: string[] = [];
    parts.push(`[${v.severity.toUpperCase()}] ${v.type}`);
    parts.push(`on ${v.source_node_id}`);
    if (v.target_node_id) parts.push(`→ ${v.target_node_id}`);
    if (v.jira_key) parts.push(`(${v.jira_key})`);
    if (v.policy_state === "regressed") parts.push("REGRESSED");
    return `- ${parts.join(" ")}`;
  });

  return (
    "\n\n⚠ GOVERNANCE NOTICE: The following open high/critical violations exist on " +
    "nodes relevant to this request. Address these before making structural changes:\n" +
    lines.join("\n") +
    "\n"
  );
}

export async function markViolationTracked(
  db: SupabaseClient,
  violationId: string,
  jiraKey: string,
  jiraStatus = "To Do"
): Promise<void> {
  // Fetch current row to capture previous policy_state for audit trail.
  const { data: row } = await db
    .from("violations")
    .select("id, workspace_id, policy_state")
    .eq("id", violationId)
    .single();

  if (row?.workspace_id) {
    try {
      await db.from("violation_policy_events").insert({
        violation_id: violationId,
        workspace_id: row.workspace_id,
        actor_id: null, // caller-specific actor (user id) is not known here
        previous_state: row.policy_state ?? null,
        new_state: "tracked",
        reason: "linked to Jira",
      });
    } catch {
      // non-fatal; proceed to update main row
    }
  }

  await db
    .from("violations")
    .update({ jira_key: jiraKey, jira_status: jiraStatus, policy_state: "tracked" })
    .eq("id", violationId);
}

/** Graph shape from scan-repo: nodes with id/layer, edges with source/target/isLayerViolation/isDrift. */
interface ScanGraph {
  nodes?: Array<{ id?: string; layer?: string }>;
  edges?: Array<{
    source?: string;
    target?: string;
    isLayerViolation?: boolean;
    isDrift?: boolean;
    driftReason?: string;
  }>;
}

/** Extract violations from a scanned graph (layer violations and drift from edges). */
export function extractViolationsFromGraph(graph: ScanGraph): RawViolation[] {
  const violations: RawViolation[] = [];
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
        suggestedFix: "Invert the dependency or move the module to a higher layer.",
      });
    }
    if (e.isDrift) {
      violations.push({
        type: "drift",
        severity: "medium",
        sourceNodeId: src,
        targetNodeId: tgt,
        description: (e as { driftReason?: string }).driftReason ?? `${src} depends on ${tgt} (violates arch rules).`,
        suggestedFix: "Remove the forbidden dependency or update the architecture rules.",
      });
    }
  }
  return violations;
}

/** Run a full violation scan: extract from graph, upsert with markAbsent, record snapshot. */
export async function runViolationScan(
  db: SupabaseClient,
  workspaceId: string,
  graph: ScanGraph,
  rulesVersion: string
): Promise<void> {
  const violations = extractViolationsFromGraph(graph);
  await upsertViolations(db, {
    workspaceId,
    violations,
    rulesVersion,
    markAbsent: true,
  });
  await recordScanSnapshot(db, workspaceId, rulesVersion);
}

export async function recordScanSnapshot(
  db: SupabaseClient,
  workspaceId: string,
  rulesVersion: string
): Promise<void> {
  const { data, error } = await db
    .from("violations")
    .select("severity, policy_state")
    .eq("workspace_id", workspaceId)
    .eq("rules_version", rulesVersion)
    .eq("structural_state", "active");

  if (error) return;
  const rows = (data ?? []) as Array<{ severity: string; policy_state: string }>;

  const violationsCount = rows.length;
  const regressedCount = rows.filter((r) => r.policy_state === "regressed").length;

  const weights: Record<string, number> = {
    low: 0.5,
    medium: 1,
    high: 2,
    critical: 3,
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
    status: "completed",
  });
}


