/**
 * Blanko-themed claim / usage block for Insights (node context).
 * Collapsed by default — never a floating dark card on select.
 */
import { useCallback, useEffect, useState } from "react";
import { useWorkspacePresence } from "../useWorkspacePresence";
import { SectionRosterBadges } from "../SectionRosterBadges";
import type { SectionClaim } from "../types";
import { ACCENT, BAD, CANVAS, FONT_MONO, FONT_UI, GOOD, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type NodeUsage = {
  totals: { promptTokens: number; completionTokens: number; costCents: number; eventCount: number };
  claimerNickname: string | null;
  budget: { limitCents: number; period: string; spentCents: number; remainingCents: number } | null;
  migrationPending?: boolean;
};

type Props = {
  workspaceId: string | null;
  nodeId: string;
  nodeLabel?: string;
  apiBase: string;
  accessToken: string | null;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function NodeCollabSection({ workspaceId, nodeId, nodeLabel, apiBase, accessToken }: Props) {
  const [open, setOpen] = useState(false);
  const [claims, setClaims] = useState<SectionClaim[]>([]);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [usage, setUsage] = useState<NodeUsage | null>(null);
  const { users: presenceUsers, currentUserId } = useWorkspacePresence(workspaceId);

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
    if (!open) return;
    void fetchClaims();
  }, [open, fetchClaims]);

  useEffect(() => {
    if (!open || !workspaceId || !accessToken) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/usage/node/${encodeURIComponent(nodeId)}?days=30`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!r.ok || cancelled) return;
        setUsage((await r.json()) as NodeUsage);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, nodeId, accessToken, apiBase]);

  const nodeClaim = claims.find((c) => c.kind === "node" && c.target_id === nodeId);
  const isMine = !!(nodeClaim && currentUserId && nodeClaim.claimer_id === currentUserId);
  const canClaim = !!(workspaceId && accessToken);

  const handleClaim = async () => {
    if (!canClaim || claimBusy || !workspaceId) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "node", targetId: nodeId, targetLabel: nodeLabel ?? null }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not claim");
      }
      await fetchClaims();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaimBusy(false);
    }
  };

  const handleRelease = async () => {
    if (!canClaim || claimBusy || !workspaceId || !nodeClaim) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const r = await fetch(
        `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims/${encodeURIComponent(nodeClaim.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not release");
      }
      await fetchClaims();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div data-testid="blanko-insights-collab" style={{ marginTop: 18 }}>
      <button
        type="button"
        data-testid="blanko-insights-collab-toggle"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: SLATE,
        }}
      >
        <span>Collab · claim</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${LINE}`,
            background: PAPER,
          }}
        >
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
            onClick={isMine ? () => void handleRelease() : () => void handleClaim()}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: FONT_UI,
              fontWeight: 600,
              borderRadius: 8,
              border: `1px solid ${isMine ? BAD : `${ACCENT}66`}`,
              background: CANVAS,
              color: !canClaim || (nodeClaim && !isMine) ? SLATE : isMine ? BAD : ACCENT,
              cursor: !canClaim || claimBusy || (nodeClaim && !isMine) ? "not-allowed" : "pointer",
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
            <div style={{ marginTop: 6, fontSize: 11, color: BAD }}>{claimError}</div>
          )}
          {usage && !usage.migrationPending && usage.totals.eventCount > 0 ? (
            <div data-testid="node-usage-burn" style={{ marginTop: 10, fontSize: 12, color: INK, lineHeight: 1.45 }}>
              Burn (30d):{" "}
              <span style={{ color: GOOD, fontWeight: 600 }}>{formatCents(usage.totals.costCents)}</span>
              {usage.claimerNickname ? ` · @${usage.claimerNickname}` : ""}
            </div>
          ) : (
            <div data-testid="node-usage-burn" style={{ marginTop: 10, fontSize: 12, color: SLATE }}>
              No usage attributed yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
