import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ArchGraph } from "../types";
import { ProviderIcon } from "../ProviderIcon";
import {
  ACCENT,
  ACCENT_WASH,
  CANVAS,
  FONT_BRAND,
  FONT_UI,
  INK,
  LINE,
  PAPER,
  SLATE,
} from "../theme/tokens";

/** @deprecated kept for import compatibility. */
export type LeftRailTab = "scene" | "build";
export type LeftExploreSection = "import";

type WorkspaceListItem = {
  id: string;
  name: string;
  node_count?: number;
};

type Props = {
  graph: ArchGraph;
  collapsed: boolean;
  onToggle: () => void;
  workspaceTitle: string;
  activeWorkspaceId?: string | null;
  onRenameWorkspace?: (title: string) => void;
  workspaces?: WorkspaceListItem[];
  onOpenWorkspace?: (id: string) => void;
  onNewWorkspace?: () => void;
  onDeleteWorkspace?: (id: string) => void;
  onOpenProfile?: () => void;
  onSignIn?: () => void;
  signedIn?: boolean;
  loadingWorkspaces?: boolean;
  onFetchWorkspaces?: () => void;
  onImportN8n?: () => void;
  onImportGithub?: () => void;
};

function friendlyTitle(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "Untitled design";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)) return `Design ${t.slice(0, 8)}`;
  if (/^arch-viz-/i.test(t)) return "Untitled design";
  return t.length > 36 ? `${t.slice(0, 35)}…` : t;
}

function BlankoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden data-testid="blanko-left-mark">
      <rect width="32" height="32" rx="8" fill={ACCENT} />
      <g fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round">
        <path d="M10.5 8V24" />
        <circle cx="16.5" cy="19" r="5" />
      </g>
    </svg>
  );
}

export function ScenePanel({
  graph,
  collapsed,
  onToggle,
  workspaceTitle,
  activeWorkspaceId,
  onRenameWorkspace,
  workspaces = [],
  onOpenWorkspace,
  onNewWorkspace,
  onDeleteWorkspace,
  onOpenProfile,
  onSignIn,
  signedIn,
  loadingWorkspaces,
  onFetchWorkspaces,
  onImportN8n,
  onImportGithub,
}: Props) {
  const [exploreOpen, setExploreOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(true);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(workspaceTitle);

  useEffect(() => {
    setTitleDraft(workspaceTitle);
  }, [workspaceTitle]);

  useEffect(() => {
    onFetchWorkspaces?.();
  }, [onFetchWorkspaces]);

  useEffect(() => {
    if (!wsMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-testid='blanko-ws-switcher']")) return;
      setWsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [wsMenuOpen]);

  const nodeCount = graph.nodes.filter((n) => !String(n.id).startsWith("band:")).length;
  const title = friendlyTitle(workspaceTitle);
  const otherWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId);

  if (collapsed) {
    return (
      <div
        data-testid="blanko-scene-collapsed"
        style={{
          width: 56,
          flexShrink: 0,
          borderRight: `1px solid ${LINE}`,
          background: CANVAS,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 14,
          gap: 12,
        }}
      >
        <BlankoMark size={28} />
        <button type="button" title="Expand" data-testid="blanko-scene-expand" onClick={onToggle} style={iconBtn}>
          ›
        </button>
        {onNewWorkspace && (
          <button
            type="button"
            title="New workspace"
            data-testid="blanko-left-new-workspace"
            onClick={onNewWorkspace}
            style={{ ...iconBtn, color: ACCENT, borderColor: `${ACCENT}55`, background: ACCENT_WASH }}
          >
            +
          </button>
        )}
        {(onOpenProfile || onSignIn) && (
          <button
            type="button"
            title={signedIn ? "Profile" : "Sign in"}
            data-testid="blanko-left-profile-collapsed"
            onClick={() => (signedIn ? onOpenProfile?.() : onSignIn?.())}
            style={iconBtn}
          >
            ○
          </button>
        )}
      </div>
    );
  }

  return (
    <aside
      data-testid="blanko-scene"
      data-explore="import"
      style={{
        width: 268,
        flexShrink: 0,
        borderRight: `1px solid ${LINE}`,
        background: CANVAS,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_UI,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 14px 12px",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <BlankoMark size={30} />
          <span
            data-testid="blanko-left-brand"
            style={{
              fontFamily: FONT_BRAND,
              fontSize: 22,
              color: ACCENT,
              textTransform: "lowercase",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            blanko
          </span>
        </div>
        <button type="button" title="Collapse" data-testid="blanko-scene-collapse" onClick={onToggle} style={iconBtn}>
          ‹
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 10px 8px" }}>
        <NavParent
          label="Explore"
          icon="▦"
          open={exploreOpen}
          onToggle={() => setExploreOpen((v) => !v)}
          testId="blanko-explore"
        />
        {exploreOpen && (
          <div style={{ paddingLeft: 10, marginBottom: 8, borderLeft: `1px solid ${LINE}`, marginLeft: 18 }}>
            <NavChild
              label="Import"
              active
              open={importOpen}
              testId="blanko-explore-import"
              onClick={() => setImportOpen(true)}
              onChevron={() => setImportOpen((v) => !v)}
            />
            {importOpen && (
              <div style={{ padding: "2px 0 8px 8px" }}>
                <button type="button" data-testid="blanko-import-n8n" onClick={() => onImportN8n?.()} style={childRow}>
                  <span style={glyphBox}>
                    <ProviderIcon providerId="n8n" size={14} chip={false} />
                  </span>
                  Upload n8n JSON
                </button>
                <button
                  type="button"
                  data-testid="blanko-import-github"
                  onClick={() => onImportGithub?.()}
                  style={childRow}
                >
                  <span style={glyphBox}>
                    <ProviderIcon providerId="github" size={14} chip={false} />
                  </span>
                  Import GitHub…
                </button>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 8px 6px",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: SLATE,
              letterSpacing: "0.02em",
            }}
          >
            My workspace
          </div>
          {onNewWorkspace && (
            <button
              type="button"
              title="New workspace"
              data-testid="blanko-left-new-workspace"
              onClick={onNewWorkspace}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: `1px solid ${ACCENT}55`,
                background: ACCENT_WASH,
                color: ACCENT,
                fontSize: 16,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              +
            </button>
          )}
        </div>

        <div data-testid="blanko-ws-switcher" style={{ position: "relative", marginBottom: 4 }}>
          {titleEditing && onRenameWorkspace ? (
            <input
              autoFocus
              value={titleDraft}
              maxLength={80}
              data-testid="blanko-left-workspace-input"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const t = titleDraft.trim();
                if (t) onRenameWorkspace(t);
                setTitleEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const t = titleDraft.trim();
                  if (t) onRenameWorkspace(t);
                  setTitleEditing(false);
                } else if (e.key === "Escape") {
                  setTitleDraft(workspaceTitle);
                  setTitleEditing(false);
                }
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                borderRadius: 10,
                border: `1px solid ${LINE}`,
                fontFamily: FONT_UI,
                fontSize: 13,
                fontWeight: 600,
                color: INK,
                outline: "none",
              }}
            />
          ) : (
            <button
              type="button"
              data-testid="blanko-left-workspace"
              onClick={() => {
                setWsMenuOpen((v) => !v);
                if (!wsMenuOpen) onFetchWorkspaces?.();
              }}
              style={{ ...navRow, background: PAPER, marginBottom: 0, border: `1px solid ${LINE}` }}
              title="Switch or manage workspace"
            >
              <span style={{ ...glyphBox, background: CANVAS }}>▣</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <span
                  style={{
                    display: "block",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {title}
                </span>
                <span style={{ display: "block", fontSize: 11, color: SLATE, marginTop: 1 }}>
                  {nodeCount} nodes · {activeWorkspaceId ? "current · saved" : "current · not saved yet"}
                </span>
              </span>
              <span style={{ color: SLATE, fontSize: 11, flexShrink: 0 }}>{wsMenuOpen ? "▴" : "▾"}</span>
            </button>
          )}

          {wsMenuOpen && (
            <div
              data-testid="blanko-ws-menu"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "100%",
                marginTop: 4,
                background: CANVAS,
                border: `1px solid ${LINE}`,
                borderRadius: 12,
                boxShadow: "0 12px 28px rgba(18,19,26,0.12)",
                zIndex: 40,
                padding: 6,
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {onNewWorkspace && (
                <MenuRow
                  testId="blanko-ws-menu-new"
                  onClick={() => {
                    setWsMenuOpen(false);
                    onNewWorkspace();
                  }}
                  icon="+"
                  accent
                >
                  New workspace
                </MenuRow>
              )}
              {onRenameWorkspace && (
                <MenuRow
                  testId="blanko-ws-menu-rename"
                  onClick={() => {
                    setWsMenuOpen(false);
                    setTitleDraft(workspaceTitle);
                    setTitleEditing(true);
                  }}
                  icon="✎"
                >
                  Rename…
                </MenuRow>
              )}
              {activeWorkspaceId && onDeleteWorkspace && (
                <MenuRow
                  testId="blanko-ws-menu-delete"
                  onClick={() => {
                    setWsMenuOpen(false);
                    onDeleteWorkspace(activeWorkspaceId);
                  }}
                  icon="×"
                  danger
                >
                  Delete current
                </MenuRow>
              )}

              <div style={{ height: 1, background: LINE, margin: "6px 4px" }} />
              <div
                style={{
                  fontSize: 10,
                  color: SLATE,
                  padding: "4px 8px",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                }}
              >
                SAVED
              </div>
              {activeWorkspaceId ? (
                <div
                  data-testid="blanko-ws-current-saved-hint"
                  style={{ padding: "2px 8px 8px", fontSize: 11, color: SLATE, lineHeight: 1.35 }}
                >
                  Current workspace is above (not repeated here).
                </div>
              ) : null}

              {!signedIn ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: SLATE }}>
                  Sign in to see saved workspaces
                </div>
              ) : loadingWorkspaces ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: SLATE }}>Loading…</div>
              ) : otherWorkspaces.length === 0 && !activeWorkspaceId ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: SLATE }}>No saved workspaces yet</div>
              ) : otherWorkspaces.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: SLATE }}>No other workspaces</div>
              ) : (
                otherWorkspaces.slice(0, 12).map((ws) => (
                  <div
                    key={ws.id}
                    style={{ display: "flex", alignItems: "center", gap: 2 }}
                  >
                    <button
                      type="button"
                      data-testid={`blanko-left-ws-${ws.id}`}
                      onClick={() => {
                        setWsMenuOpen(false);
                        onOpenWorkspace?.(ws.id);
                      }}
                      style={{
                        ...navRow,
                        flex: 1,
                        marginBottom: 0,
                        minWidth: 0,
                      }}
                    >
                      <span style={{ ...glyphBox, color: "#D97706", borderColor: "#F5D0A9" }}>▢</span>
                      <span
                        style={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textAlign: "left",
                          fontSize: 12,
                        }}
                      >
                        {friendlyTitle(ws.name)}
                      </span>
                      {typeof ws.node_count === "number" && (
                        <span style={{ fontSize: 10, color: SLATE }}>{ws.node_count}</span>
                      )}
                    </button>
                    {onDeleteWorkspace && (
                      <button
                        type="button"
                        title="Delete"
                        data-testid={`blanko-ws-delete-${ws.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteWorkspace(ws.id);
                        }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: "none",
                          background: "transparent",
                          color: SLATE,
                          cursor: "pointer",
                          fontSize: 14,
                          flexShrink: 0,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Profile footer — not search (header already has workspace search) */}
      <div style={{ padding: "10px 14px 14px", borderTop: `1px solid ${LINE}` }}>
        {signedIn && onOpenProfile ? (
          <button type="button" data-testid="blanko-left-profile" onClick={onOpenProfile} style={profileBtn}>
            <span style={glyphBox}>○</span>
            <span style={{ flex: 1, textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 600, color: INK }}>Profile & billing</span>
              <span style={{ display: "block", fontSize: 11, color: SLATE, marginTop: 1 }}>Account & plan</span>
            </span>
          </button>
        ) : onSignIn ? (
          <button type="button" data-testid="blanko-left-signin" onClick={onSignIn} style={profileBtn}>
            <span style={glyphBox}>○</span>
            <span style={{ flex: 1, textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 600, color: INK }}>Sign in</span>
              <span style={{ display: "block", fontSize: 11, color: SLATE, marginTop: 1 }}>Save & sync workspaces</span>
            </span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function MenuRow({
  children,
  onClick,
  icon,
  testId,
  accent,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  icon: string;
  testId: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "9px 10px",
        border: "none",
        background: "transparent",
        borderRadius: 8,
        fontFamily: FONT_UI,
        fontSize: 13,
        color: danger ? "#DC2626" : accent ? ACCENT : INK,
        fontWeight: accent || danger ? 600 : 500,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        style={{
          ...glyphBox,
          background: accent ? ACCENT_WASH : PAPER,
          borderColor: accent ? `${ACCENT}55` : LINE,
          color: danger ? "#DC2626" : accent ? ACCENT : INK,
        }}
      >
        {icon}
      </span>
      {children}
    </button>
  );
}

function NavParent({
  label,
  icon,
  open,
  onToggle,
  testId,
}: {
  label: string;
  icon: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button type="button" data-testid={testId} onClick={onToggle} style={navRow}>
      <span style={glyphBox}>{icon}</span>
      <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>{label}</span>
      <span style={{ color: SLATE, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
    </button>
  );
}

function NavChild({
  label,
  active,
  open,
  testId,
  onClick,
  onChevron,
}: {
  label: string;
  active?: boolean;
  open?: boolean;
  testId: string;
  onClick: () => void;
  onChevron?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: 2,
        borderRadius: 10,
        background: active ? PAPER : "transparent",
      }}
    >
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          border: "none",
          background: "transparent",
          borderRadius: 10,
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          color: active ? INK : SLATE,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1 }}>{label}</span>
      </button>
      {onChevron && (
        <button
          type="button"
          onClick={onChevron}
          style={{
            border: "none",
            background: "transparent",
            color: SLATE,
            cursor: "pointer",
            padding: "4px 8px",
            fontSize: 11,
          }}
        >
          {open ? "▾" : "▸"}
        </button>
      )}
    </div>
  );
}

const navRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 10px",
  marginBottom: 2,
  borderRadius: 10,
  border: "none",
  background: "transparent",
  fontFamily: FONT_UI,
  fontSize: 13,
  color: INK,
  cursor: "pointer",
};

const childRow: CSSProperties = {
  ...navRow,
  fontSize: 12,
  padding: "7px 8px",
};

const profileBtn: CSSProperties = {
  ...navRow,
  marginBottom: 0,
  background: PAPER,
  border: `1px solid ${LINE}`,
  padding: "10px 12px",
};

const glyphBox: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  background: PAPER,
  border: `1px solid ${LINE}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  fontSize: 12,
  color: INK,
};

const iconBtn: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  border: `1px solid ${LINE}`,
  background: CANVAS,
  color: SLATE,
  cursor: "pointer",
  fontSize: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
