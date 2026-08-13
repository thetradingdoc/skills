/**
 * P7 — management rollup with section Own/Release + GitHub sync CTA.
 * Ownership = section_claims (not CODEOWNERS). GitHub connect fills lastChange separately.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArchGraph } from "./types";
import {
  buildManagementRollup,
  formatRollupCents,
  type ManagementRollup,
  type SectionRollup,
} from "./managementRollup";
import { useWorkspacePresence } from "./useWorkspacePresence";
import { ACCENT, ACCENT_WASH, BAD, CANVAS, FONT_MONO, FONT_UI, GOOD, INK, LINE, PAPER, SLATE, WARN } from "./theme/tokens";

type Props = {
  graph: ArchGraph | null;
  workspaceId: string | null;
  apiBase: string;
  accessToken: string | null;
  onSelectNode?: (nodeId: string) => void;
  /** Opens ConnectGitHubModal (App). */
  onConnectGitHub?: () => void;
  /** Bump after Connect GitHub to refetch githubFullName. */
  refreshKey?: number;
};

type Filter = "all" | "hotspots" | "unowned" | "pastdue";

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function ownerLabel(section: SectionRollup): string {
  if (!section.owner) return "unowned";
  return `@${section.owner.nickname || section.owner.userId.slice(0, 8)}`;
}

function SectionRow({
  section,
  onSelectNode,
  currentUserId,
  canAct,
  busy,
  rowError,
  onOwn,
  onRelease,
  githubLinked,
}: {
  section: SectionRollup;
  onSelectNode?: (id: string) => void;
  currentUserId: string | null;
  canAct: boolean;
  busy: boolean;
  rowError: string | null;
  onOwn: () => void;
  onRelease: () => void;
  githubLinked: boolean;
}) {
  const risk =
    section.findings.critical > 0 ? BAD : section.findings.high > 0 ? WARN : GOOD;
  const isMine = !!(section.owner && currentUserId && section.owner.userId === currentUserId);
  const canRelease =
    isMine &&
    section.owner?.claimKind === "section" &&
    !!section.owner.claimId;
  /** Own when unowned, node-derived, or take over another's section claim (upsert). */
  const showOwnButton =
    canAct &&
    (!section.owner ||
      section.owner.claimKind === "node" ||
      (section.owner.claimKind === "section" && !isMine));

  return (
    <div
      data-testid="rollup-section-row"
      data-section-id={section.id}
      data-section-name={section.name}
      data-claim-kind={section.owner?.claimKind ?? ""}
      style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${LINE}`,
        background: section.findings.critical > 0 ? "rgba(220,38,38,0.05)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{section.name}</span>
        <span
          data-testid={`rollup-owner-badge-${section.id}`}
          style={{
            fontSize: 10,
            fontFamily: FONT_MONO,
            color: section.owner ? ACCENT : BAD,
            border: `1px solid ${section.owner ? ACCENT + "55" : BAD + "55"}`,
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          {ownerLabel(section)}
        </span>
        {showOwnButton ? (
          <button
            type="button"
            data-testid={`rollup-own-${section.id}`}
            disabled={busy || !canAct}
            onClick={onOwn}
            title={
              !canAct
                ? "Sign in to claim"
                : section.owner?.claimKind === "node"
                  ? "Claim this section (promotes over node claim)"
                  : section.owner
                    ? "Take ownership of this section"
                    : "Claim responsibility for this section"
            }
            style={{
              fontSize: 10,
              fontFamily: FONT_UI,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 6,
              border: `1px solid ${ACCENT}`,
              background: CANVAS,
              color: ACCENT,
              cursor: busy || !canAct ? "not-allowed" : "pointer",
              opacity: busy || !canAct ? 0.5 : 1,
            }}
          >
            {busy ? "…" : section.owner && !isMine ? "Own" : section.owner?.claimKind === "node" ? "Own section" : "Own"}
          </button>
        ) : null}
        {canRelease ? (
          <button
            type="button"
            data-testid={`rollup-release-${section.id}`}
            disabled={busy}
            onClick={onRelease}
            title="Release section claim"
            style={{
              fontSize: 10,
              fontFamily: FONT_UI,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 6,
              border: `1px solid ${BAD}`,
              background: CANVAS,
              color: BAD,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "…" : "Release"}
          </button>
        ) : null}
        <span style={{ fontSize: 10, fontFamily: FONT_MONO, color: risk }}>
          {section.findings.open} open
          {section.findings.critical > 0 ? ` · ${section.findings.critical} critical` : ""}
          {section.findings.high > 0 ? ` · ${section.findings.high} high` : ""}
          {section.findings.pastDue > 0 ? ` · ${section.findings.pastDue} past-due` : ""}
        </span>
        <span style={{ fontSize: 10, color: SLATE, marginLeft: "auto", fontFamily: FONT_MONO }}>
          {formatRollupCents(section.spend.costCents)} / {section.spend.days}d
        </span>
      </div>
      {rowError ? (
        <div
          data-testid={`rollup-claim-error-${section.id}`}
          style={{ marginTop: 6, fontSize: 11, color: BAD, fontWeight: 600 }}
        >
          {rowError}
        </div>
      ) : null}
      <div style={{ marginTop: 6, fontSize: 11, color: SLATE, fontFamily: FONT_MONO }}>
        {section.lastChange ? (
          <>
            Last {section.lastChange.type}
            {section.lastChange.author ? ` by ${section.lastChange.author}` : ""} ·{" "}
            {relative(section.lastChange.at)}
            {section.lastChange.url && (
              <>
                {" "}
                <a href={section.lastChange.url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
                  view →
                </a>
              </>
            )}
          </>
        ) : githubLinked ? (
          null
        ) : (
          "No recent GitHub activity mapped"
        )}
        {" · "}
        {section.nodeIds.length} node{section.nodeIds.length === 1 ? "" : "s"}
      </div>
      {section.nodeIds.length > 0 && onSelectNode && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {section.nodeIds.slice(0, 6).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelectNode(id)}
              style={{
                fontSize: 10,
                fontFamily: FONT_MONO,
                color: ACCENT,
                background: ACCENT_WASH,
                border: `1px solid ${ACCENT}44`,
                borderRadius: 4,
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              {id.length > 24 ? id.slice(0, 22) + "…" : id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ManagementRollupView({
  graph,
  workspaceId,
  apiBase,
  accessToken,
  onSelectNode,
  onConnectGitHub,
  refreshKey = 0,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [remote, setRemote] = useState<ManagementRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const { currentUserId } = useWorkspacePresence(workspaceId);

  const local = useMemo(() => {
    if (!graph?.nodes?.length) return null;
    return buildManagementRollup({
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        domain: n.domain,
        layer: n.layer as string | undefined,
        path: n.path,
        files: n.files,
      })),
    });
  }, [graph]);

  const fetchRemote = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setRemote(null);
      setRemoteError(null);
      return;
    }
    setLoading(true);
    setRemoteError(null);
    try {
      const body = {
        days: 30,
        nodes: (graph?.nodes ?? []).map((n) => ({
          id: n.id,
          label: n.label,
          domain: n.domain,
          layer: n.layer,
          path: n.path,
          files: n.files,
        })),
      };
      const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/rollup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setRemoteError(d.error ?? `Couldn’t load live rollup (${r.status}) — showing graph-only.`);
        return;
      }
      const d = (await r.json()) as ManagementRollup;
      setRemote(d);
    } catch (e) {
      setRemoteError(
        e instanceof Error ? e.message : "Couldn’t load live rollup — showing graph-only."
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, apiBase, graph]);

  useEffect(() => {
    void fetchRemote();
  }, [fetchRemote, retryKey, refreshKey]);

  const data = remote ?? local;
  const githubFullName = remote?.githubFullName ?? null;
  const githubLinked = !!githubFullName;
  const githubInstalled =
    typeof remote?.githubInstallationId === "number" && remote.githubInstallationId > 0;
  const canAct = !!(workspaceId && accessToken);

  const ownSection = async (section: SectionRollup) => {
    if (!workspaceId || !accessToken) return;
    setBusyId(section.id);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[section.id];
      return next;
    });
    try {
      const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: "section",
          targetId: section.id,
          targetLabel: section.name,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        const msg =
          r.status === 403
            ? body.error ?? "Viewers can’t claim."
            : body.error ?? "Could not claim section";
        throw new Error(msg);
      }
      await fetchRemote();
    } catch (e) {
      setRowErrors((prev) => ({
        ...prev,
        [section.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyId(null);
    }
  };

  const releaseSection = async (section: SectionRollup) => {
    if (!workspaceId || !accessToken) return;
    if (section.owner?.claimKind !== "section" || !section.owner.claimId) return;
    setBusyId(section.id);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[section.id];
      return next;
    });
    try {
      const r = await fetch(
        `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/claims/${encodeURIComponent(section.owner.claimId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Could not release claim");
      await fetchRemote();
    } catch (e) {
      setRowErrors((prev) => ({
        ...prev,
        [section.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    if (filter === "hotspots") return data.sections.filter((s) => data.hotspots.includes(s.id));
    if (filter === "unowned") return data.sections.filter((s) => data.unowned.includes(s.id));
    if (filter === "pastdue") return data.sections.filter((s) => s.findings.pastDue > 0);
    return data.sections;
  }, [data, filter]);

  return (
    <div
      data-testid="management-rollup"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: CANVAS,
        color: INK,
        fontFamily: FONT_MONO,
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ACCENT, marginBottom: 4 }}>
          Management rollup
        </div>
        <div style={{ fontSize: 11, color: SLATE, lineHeight: 1.45 }}>
          Who owns each part, what&apos;s wrong, what changed, and what it costs. Editors can claim
          ownership; viewers read-only. Claim means you&apos;re responsible for the section — not
          CODEOWNERS and not an agent run.
        </div>

        {githubLinked && data && data.sections.every((s) => !s.lastChange) ? (
          <div
            data-testid="rollup-sync-status"
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${WARN}`,
              background: PAPER,
              fontSize: 12,
              color: INK,
              lineHeight: 1.45,
            }}
          >
            {githubInstalled
              ? "Linked and Blanko-Lab installed — waiting for first push/PR webhook."
              : "Repo is linked, but Blanko-Lab is not installed yet — webhooks will not arrive."}{" "}
            <button
              type="button"
              data-testid="rollup-check-webhook"
              onClick={() => onConnectGitHub?.()}
              style={{
                all: "unset",
                cursor: onConnectGitHub ? "pointer" : "default",
                color: ACCENT,
                fontWeight: 700,
                textDecoration: "underline",
              }}
            >
              {githubInstalled ? "Check webhook setup" : "Install Blanko-Lab"}
            </button>
          </div>
        ) : null}

        {!githubLinked && onConnectGitHub ? (
          <div
            data-testid="rollup-github-cta"
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${LINE}`,
              background: PAPER,
              fontSize: 11,
              color: INK,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              lineHeight: 1.45,
            }}
          >
            <span>Install Blanko-Lab and link a repo so Rollup last-change can fill after webhooks.</span>
            <button
              type="button"
              data-testid="rollup-connect-github"
              onClick={onConnectGitHub}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}`,
                background: CANVAS,
                color: ACCENT,
                cursor: "pointer",
                fontWeight: 600,
                fontFamily: FONT_UI,
              }}
            >
              Install Blanko-Lab
            </button>
          </div>
        ) : githubLinked ? (
          <div
            data-testid="rollup-github-linked"
            style={{ marginTop: 8, fontSize: 11, color: SLATE }}
          >
            Linked · {githubFullName}
            {githubInstalled ? " · Installed" : " · App not installed"}
            {githubLinked && data && data.sections.every((s) => !s.lastChange) && githubInstalled
              ? " · waiting for first push"
              : null}
          </div>
        ) : null}

        {remoteError ? (
          <div
            data-testid="rollup-remote-error"
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${WARN}`,
              background: PAPER,
              fontSize: 11,
              color: INK,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>{remoteError}</span>
            <button
              type="button"
              data-testid="rollup-retry"
              onClick={() => setRetryKey((k) => k + 1)}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 8,
                border: `1px solid ${LINE}`,
                background: CANVAS,
                cursor: "pointer",
                color: INK,
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
        {data && (
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, flexWrap: "wrap" }}>
            <span>{data.sections.length} sections</span>
            <span style={{ color: data.hotspots.length ? BAD : GOOD }}>
              {data.hotspots.length} hotspots
            </span>
            <span style={{ color: data.unowned.length ? WARN : SLATE }}>
              {data.unowned.length} unowned
            </span>
            <span style={{ color: data.pastDueFindings.length ? BAD : SLATE }}>
              {data.pastDueFindings.length} past-due
            </span>
            {loading && <span style={{ color: SLATE }}>refreshing…</span>}
            {!remote && !remoteError && !loading && (
              <span style={{ color: SLATE }}>graph-only</span>
            )}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {(
            [
              ["all", "All"],
              ["hotspots", "Hotspots"],
              ["unowned", "Unowned"],
              ["pastdue", "Past-due"],
            ] as Array<[Filter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`rollup-filter-${id}`}
              onClick={() => setFilter(id)}
              style={{
                fontSize: 10,
                padding: "3px 8px",
                borderRadius: 999,
                border: filter === id ? `1px solid ${ACCENT}` : `1px solid ${LINE}`,
                background: filter === id ? ACCENT_WASH : PAPER,
                color: filter === id ? ACCENT : SLATE,
                cursor: "pointer",
                fontFamily: FONT_MONO,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {!data || data.sections.length === 0 ? (
          <div style={{ padding: 24, color: SLATE, fontSize: 12 }}>
            No sections yet. Design or scan a graph — sections come from node domain/layer.
          </div>
        ) : (
          visible.map((s) => (
            <SectionRow
              key={s.id}
              section={s}
              onSelectNode={onSelectNode}
              currentUserId={currentUserId}
              canAct={canAct}
              busy={busyId === s.id}
              rowError={rowErrors[s.id] ?? null}
              onOwn={() => void ownSection(s)}
              onRelease={() => void releaseSection(s)}
              githubLinked={githubLinked}
            />
          ))
        )}
      </div>
    </div>
  );
}
