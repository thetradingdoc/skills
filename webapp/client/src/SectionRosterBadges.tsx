import type { SectionClaim } from "./types";
import type { PresenceUser } from "./useWorkspacePresence";

const MONO = "JetBrains Mono, ui-monospace, monospace";

interface Props {
  claims: SectionClaim[];
  presenceUsers: PresenceUser[];
  targetKind: "layer" | "node" | "section";
  targetId: string;
  /** Excludes this user id from the "viewing" roster (usually the current user). */
  excludeUserId?: string | null;
}

/**
 * Who's here for this layer/node/section: a claim badge (someone has taken
 * ownership) plus small "viewing" badges for anyone else whose live focus
 * currently points at the same target. Purely presentational — callers own
 * fetching claims and presence.
 */
export function SectionRosterBadges({ claims, presenceUsers, targetKind, targetId, excludeUserId }: Props) {
  const claim = claims.find((c) => c.kind === targetKind && c.target_id === targetId);

  const viewers = presenceUsers.filter(
    (u) =>
      u.focus?.kind === targetKind &&
      u.focus?.id === targetId &&
      u.id !== excludeUserId &&
      u.id !== claim?.claimer_id
  );

  if (!claim && viewers.length === 0) return null;

  return (
    <div
      data-testid="section-roster-badges"
      style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontFamily: MONO }}
    >
      {claim && (
        <span
          title={`Claimed ${new Date(claim.claimed_at).toLocaleString()}`}
          style={{
            fontSize: 10,
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgba(163,113,247,0.14)",
            border: "1px solid #a371f755",
            color: "#d2a8ff",
            whiteSpace: "nowrap",
          }}
        >
          🔖 @{claim.claimerNickname ?? claim.claimer_id.slice(0, 8)}
        </span>
      )}
      {viewers.map((u) => (
        <span
          key={u.id}
          title="Currently viewing"
          style={{
            fontSize: 10,
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgba(88,166,255,0.1)",
            border: "1px solid #ef32a644",
            color: "#79c0ff",
            whiteSpace: "nowrap",
          }}
        >
          👁 @{u.name}
        </span>
      ))}
    </div>
  );
}
