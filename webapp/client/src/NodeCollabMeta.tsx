/**
 * Who is touching this node, and from where.
 *
 * A claim answers "who owns this" going forward; a last push answers "what
 * just happened to it"; presence answers "who else has this open right now".
 * None of that is visible anywhere else once a node is selected, so this
 * sits beside the inspector rather than replacing it.
 */
import { useEffect, useState, useCallback } from "react";
import { useWorkspacePresence } from "./useWorkspacePresence";
import { SectionRosterBadges } from "./SectionRosterBadges";
import type { SectionClaim } from "./types";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type GithubArchEvent = {
  id: string;
  event_type: "push" | "pull_request" | "scan";
  sha: string | null;
  branch: string | null;
  pr_number: number | null;
  author_login: string | null;
  message: string | null;
  github_url: string | null;
  created_at: string;
};

type CollabMeta = {
  claim: { claimerId: string; claimedAt: string } | null;
  lastPush: GithubArchEvent | null;
  assignees: string[];
};

type NodeUsage = {
  totals: { promptTokens: number; completionTokens: number; costCents: number; eventCount: number };
  claimerNickname: string | null;
  budget: { limitCents: number; period: string; spentCents: number; remainingCents: number } | null;
  migrationPending?: boolean;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

type Props = {
  workspaceId: string | null;
  nodeId: string | null;
  nodeLabel?: string;
  apiBase: string;
  accessToken: string | null;
  /** Offset the panel horizontally so it doesn't overlap another inspector panel. */
  rightOffset?: number;
};

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NodeCollabMeta({ workspaceId, nodeId, nodeLabel, apiBase, accessToken, rightOffset = 0 }: Props) {
  const [meta, setMeta] = useState<CollabMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [claims, setClaims] = useState<SectionClaim[]>([]);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [usage, setUsage] = useState<NodeUsage | null>(null);

  const { users: presenceUsers, trackFocus, currentUserId } = useWorkspacePresence(workspaceId);

  useEffect(() => {
    if (!nodeId) {
      trackFocus(null);
      return;
    }
    trackFocus({ kind: "node", id: nodeId, label: nodeLabel });
    return () => trackFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeLabel]);

  const fetchClaims = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setClaims([]);
      return;
    }
    try {
      const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return;
      const d = await r.json();
      setClaims((d.claims ?? []) as SectionClaim[]);
    } catch {
      /* best-effort */
    }
  }, [apiBase, accessToken, workspaceId]);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  useEffect(() => {
    setMeta(null);
    if (!workspaceId || !nodeId || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(nodeId)}/collab`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setMeta(d as CollabMeta);
      } catch {
        /* best-effort — collab metadata is a nice-to-have, not a blocker */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, accessToken, workspaceId, nodeId]);

  useEffect(() => {
    setUsage(null);
    if (!workspaceId || !nodeId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/usage/node/${encodeURIComponent(nodeId)}?days=30`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setUsage(d as NodeUsage);
      } catch {
        /* best-effort — usage attribution is a nice-to-have here, not a blocker */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, accessToken, workspaceId, nodeId]);

  const nodeClaim = claims.find((c) => c.kind === "node" && c.target_id === nodeId);
  const isMine = !!nodeClaim && nodeClaim.claimer_id === currentUserId;

  const handleClaim = useCallback(async () => {
    if (!workspaceId || !accessToken || !nodeId || claimBusy) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ kind: "node", targetId: nodeId, targetLabel: nodeLabel ?? null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setClaimError(d.error ?? "Could not claim this node.");
        return;
      }
      await fetchClaims();
    } finally {
      setClaimBusy(false);
    }
  }, [apiBase, accessToken, workspaceId, nodeId, nodeLabel, claimBusy, fetchClaims]);

  const handleRelease = useCallback(async () => {
    if (!workspaceId || !accessToken || !nodeClaim || claimBusy) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const r = await fetch(
        `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims/${encodeURIComponent(nodeClaim.id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setClaimError(d.error ?? "Could not release this claim.");
        return;
      }
      await fetchClaims();
    } finally {
      setClaimBusy(false);
    }
  }, [apiBase, accessToken, workspaceId, nodeClaim, claimBusy, fetchClaims]);

  if (!nodeId) return null;

  const canClaim = !!(workspaceId && accessToken);

  return (
    <div
      data-testid="node-collab-meta"
      style={{
        position: "absolute",
        top: 12,
        right: 12 + rightOffset,
        width: 260,
        zIndex: 19,
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 10,
        padding: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        fontFamily: MONO,
      }}
    >
      <div style={{ fontSize: 9, color: "#6e7681", textTransform: "uppercase", letterSpacing: 0.06, marginBottom: 8 }}>
        {nodeLabel ? `${nodeLabel} · activity` : "Activity"}
      </div>

      <div style={{ marginBottom: 10 }}>
        <SectionRosterBadges
          claims={claims}
          presenceUsers={presenceUsers}
          targetKind="node"
          targetId={nodeId}
          excludeUserId={currentUserId}
        />
        <button
          type="button"
          data-testid="node-claim-toggle"
          disabled={!canClaim || claimBusy || (!!nodeClaim && !isMine)}
          onClick={isMine ? handleRelease : handleClaim}
          title={
            !canClaim
              ? "Sign in to a workspace to claim this node"
              : nodeClaim && !isMine
                ? "Already claimed by someone else"
                : undefined
          }
          style={{
            marginTop: 8,
            width: "100%",
            padding: "6px 8px",
            fontSize: 11,
            borderRadius: 6,
            border: `1px solid ${isMine ? "#f85149" : "#a371f7"}`,
            background: "transparent",
            color: !canClaim || (nodeClaim && !isMine) ? "#6e7681" : isMine ? "#ffa198" : "#d2a8ff",
            cursor: !canClaim || claimBusy || (nodeClaim && !isMine) ? "not-allowed" : "pointer",
            opacity: claimBusy ? 0.6 : 1,
          }}
        >
          {!canClaim
            ? "Sign in to claim"
            : claimBusy
              ? "…"
              : isMine
                ? "Release claim"
                : nodeClaim
                  ? "Claimed"
                  : "Claim this"}
        </button>
        {claimError && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: "#f85149" }}>{claimError}</div>
        )}
      </div>

      {usage && !usage.migrationPending && usage.totals.eventCount > 0 && (
        <div
          data-testid="node-usage-burn"
          style={{
            fontSize: 11,
            color: "#c9d1d9",
            marginBottom: 10,
            paddingBottom: 10,
            borderBottom: "1px solid #21262d",
            lineHeight: 1.5,
          }}
        >
          <div>
            Burn (30d): <span style={{ color: "#3fb950", fontWeight: 600 }}>{formatCents(usage.totals.costCents)}</span>{" "}
            · {formatTokens(usage.totals.promptTokens + usage.totals.completionTokens)} tok
          </div>
          <div style={{ color: "#8b949e" }}>
            {usage.claimerNickname ? `@${usage.claimerNickname} owns this` : "Unclaimed"}
            {usage.budget
              ? ` · budget ${formatCents(usage.budget.remainingCents)} left`
              : ""}
          </div>
        </div>
      )}
      {usage && (usage.migrationPending || usage.totals.eventCount === 0) && (
        <div data-testid="node-usage-burn" style={{ fontSize: 10.5, color: "#6e7681", marginBottom: 10 }}>
          No usage attributed yet.
        </div>
      )}

      {loading && !meta && <div style={{ fontSize: 11, color: "#8b949e" }}>Loading…</div>}

      {meta?.lastPush && (
        <div style={{ fontSize: 11.5, color: "#e6edf3" }}>
          <div style={{ color: "#8b949e", marginBottom: 2 }}>
            Last {meta.lastPush.event_type === "pull_request" ? "PR" : meta.lastPush.event_type}
            {meta.lastPush.author_login ? ` by ${meta.lastPush.author_login}` : ""}
          </div>
          {meta.lastPush.message && (
            <div style={{ color: "#c9d1d9", lineHeight: 1.45, marginBottom: 4 }}>
              {meta.lastPush.message.length > 120 ? `${meta.lastPush.message.slice(0, 120)}…` : meta.lastPush.message}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#6e7681" }}>{relative(meta.lastPush.created_at)}</span>
            {meta.lastPush.github_url && (
              <a
                href={meta.lastPush.github_url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 10, color: "#ef32a6", textDecoration: "none" }}
              >
                view →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
