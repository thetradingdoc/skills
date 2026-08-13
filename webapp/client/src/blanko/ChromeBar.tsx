import { useState, type CSSProperties, type ReactNode } from "react";
import { NotificationsBell } from "../NotificationsBell";
import { ACCENT, CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type ExportOption = {
  id: string;
  label: string;
  onClick: () => void;
};

export type CanvasInteractionMode = "view" | "edit";

/** Chrome-local accents — distinct roles, not severity / brand pink. */
const NAV_BLUE = "#2563EB";
const NAV_BLUE_WASH = "#EFF6FF";
const NAV_BLUE_LINE = "#BFDBFE";
const CODE_TEAL = "#0F766E";
const CODE_TEAL_WASH = "#F0FDFA";
const CODE_TEAL_LINE = "#99F6E4";
const MONEY_AMBER = "#B45309";
const MONEY_AMBER_WASH = "#FFFBEB";
const MONEY_AMBER_LINE = "#FCD34D";
const VIEW_NAVY = "#1E3A5F";
const EDIT_COPPER = "#C2410C";

type Props = {
  onSave: () => void;
  saveLabel: string;
  saveDisabled?: boolean;
  onShare: () => void;
  shareLabel: string;
  shareDisabled?: boolean;
  accessToken: string | null;
  apiBase: string;
  exportOptions: ExportOption[];
  moreItems?: Array<{ id: string; label: string; onClick: () => void }>;
  materializeSlot?: ReactNode;
  projectRoot?: string | null;
  generatedAt?: number | null;
  scannedCommit?: string | null;
  onRescan?: () => void;
  scanning?: boolean;
  hideStaleness?: boolean;
  interactionMode?: CanvasInteractionMode;
  onInteractionModeChange?: (mode: CanvasInteractionMode) => void;
  editingScanHint?: boolean;
  architectureBoardHint?: boolean;
  onBackToCodeMap?: () => void;
  showCodeMapHint?: boolean;
  onOpenModuleMapHint?: () => void;
};

/**
 * Floating chrome:
 * [ home|back ] page name | View/Edit | bell · save · share · export
 * Color code: blue=nav, teal=Code map, amber=Money path, navy=View, copper=Edit, pink=Share.
 */
export function ChromeBar({
  onSave,
  saveLabel,
  saveDisabled,
  onShare,
  shareLabel,
  shareDisabled,
  accessToken,
  apiBase,
  exportOptions,
  moreItems = [],
  materializeSlot,
  projectRoot,
  generatedAt,
  scannedCommit,
  onRescan,
  scanning,
  hideStaleness,
  interactionMode = "view",
  onInteractionModeChange,
  editingScanHint = false,
  architectureBoardHint = false,
  onBackToCodeMap,
  showCodeMapHint = false,
  onOpenModuleMapHint,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const onMoneyPath = !!(architectureBoardHint && onBackToCodeMap);
  const onCodeMap = !onMoneyPath && showCodeMapHint;
  const pageName = onMoneyPath ? "Money path" : onCodeMap ? "Code map" : "Design";
  const saveDirty = !saveDisabled && saveLabel !== "Saved" && saveLabel !== "…";

  return (
    <div
      data-testid="blanko-chrome-bar"
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 32,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        maxWidth: "calc(100% - 160px)",
        width: "max-content",
        overflowX: "auto",
        overflowY: "hidden",
        background: CANVAS,
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        boxShadow: "0 8px 28px rgba(18,19,26,0.1), 0 1px 3px rgba(18,19,26,0.04)",
        fontFamily: FONT_UI,
        pointerEvents: "auto",
        scrollbarWidth: "none",
      }}
    >
      {/* Nav glyph — decorative home; Money path uses teal back (only clickable nav). */}
      {onMoneyPath ? (
        <button
          type="button"
          data-testid="chrome-back-code-map"
          onClick={onBackToCodeMap}
          title="Back to Code map"
          aria-label="Back to Code map"
          style={{
            ...roundIcon,
            background: CODE_TEAL_WASH,
            borderColor: CODE_TEAL_LINE,
            color: CODE_TEAL,
          }}
        >
          <IconArrowLeft />
        </button>
      ) : (
        <span
          data-testid="chrome-home"
          title="Home"
          aria-hidden
          style={{
            ...roundIcon,
            background: NAV_BLUE_WASH,
            borderColor: NAV_BLUE_LINE,
            color: NAV_BLUE,
            cursor: "default",
            pointerEvents: "none",
          }}
        >
          <IconHome />
        </span>
      )}

      {/* Page name — teal Code map / amber Money path / ink Design */}
      {onMoneyPath ? (
        <span
          data-testid="chrome-money-path-chip"
          title="Money path board — View/Edit locks the canvas only"
          style={{
            ...pageChip,
            background: MONEY_AMBER_WASH,
            borderColor: MONEY_AMBER_LINE,
            color: MONEY_AMBER,
          }}
        >
          {pageName}
        </span>
      ) : onCodeMap ? (
        <span
          data-testid="chrome-code-map-hint"
          title={
            onOpenModuleMapHint
              ? "Code map — click to open Insights and apply Money path"
              : "Code map (scanned modules)"
          }
          role={onOpenModuleMapHint ? "button" : undefined}
          tabIndex={onOpenModuleMapHint ? 0 : undefined}
          onClick={() => onOpenModuleMapHint?.()}
          onKeyDown={(e) => {
            if (!onOpenModuleMapHint) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenModuleMapHint();
            }
          }}
          style={{
            ...pageChip,
            background: CODE_TEAL_WASH,
            borderColor: CODE_TEAL_LINE,
            color: CODE_TEAL,
            cursor: onOpenModuleMapHint ? "pointer" : "default",
          }}
        >
          {pageName}
        </span>
      ) : (
        <span
          data-testid="chrome-design-chip"
          title="Design canvas"
          style={{
            ...pageChip,
            background: PAPER,
            borderColor: LINE,
            color: INK,
          }}
        >
          {pageName}
        </span>
      )}

      <Divider />

      {onInteractionModeChange ? (
        <div
          data-testid="blanko-chrome-interaction"
          role="group"
          aria-label="Canvas interaction"
          title={
            architectureBoardHint
              ? "View / Edit locks the canvas — use back to leave Money path"
              : editingScanHint
                ? "Editing Code map modules — Apply trading spine in Insights for Money path"
                : interactionMode === "edit"
                  ? "Edit: connect, drop components, delete"
                  : "View: pan and inspect (nodes locked)"
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 2,
            borderRadius: 999,
            background: PAPER,
            border: `1px solid ${LINE}`,
            gap: 0,
            flexShrink: 0,
          }}
        >
          {(["view", "edit"] as const).map((mode) => {
            const active = interactionMode === mode;
            const activeBg = mode === "view" ? VIEW_NAVY : EDIT_COPPER;
            return (
              <button
                key={mode}
                type="button"
                data-testid={`blanko-chrome-${mode}`}
                aria-pressed={active}
                onClick={() => onInteractionModeChange(mode)}
                style={{
                  border: "none",
                  background: active ? activeBg : "transparent",
                  color: active ? CANVAS : SLATE,
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 12px",
                  borderRadius: 999,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  lineHeight: 1,
                }}
              >
                {mode === "view" ? "View" : "Edit"}
              </button>
            );
          })}
        </div>
      ) : null}

      <Divider />

      {/* Actions: bell · save · share · export */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {accessToken ? (
          <span style={{ display: "inline-flex" }}>
            <NotificationsBell
              apiBase={apiBase}
              accessToken={accessToken}
              variant="blanko"
              projectRoot={projectRoot}
              generatedAt={generatedAt}
              scannedCommit={scannedCommit}
              onRescan={onRescan}
              scanning={scanning}
              hideStaleness={hideStaleness}
            />
          </span>
        ) : null}

        <button
          type="button"
          data-testid="chrome-save"
          disabled={saveDisabled}
          onClick={onSave}
          title={saveLabel}
          aria-label={saveLabel}
          style={{
            ...roundIcon,
            background: saveDirty ? INK : CANVAS,
            borderColor: saveDirty ? INK : LINE,
            color: saveDirty ? CANVAS : SLATE,
            opacity: saveDisabled ? 0.4 : 1,
            cursor: saveDisabled ? "not-allowed" : "pointer",
          }}
        >
          <IconSave />
        </button>

        <button
          type="button"
          data-testid="chrome-share"
          disabled={shareDisabled}
          onClick={onShare}
          title={shareLabel}
          aria-label={shareLabel}
          style={{
            ...roundIcon,
            background: ACCENT,
            borderColor: ACCENT,
            color: "#fff",
            opacity: shareDisabled ? 0.45 : 1,
            cursor: shareDisabled ? "not-allowed" : "pointer",
          }}
        >
          <IconShare />
        </button>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            data-testid="export-menu-toggle"
            title="Export & more"
            aria-label="Export"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            style={{
              ...roundIcon,
              background: moreOpen ? PAPER : CANVAS,
              borderColor: LINE,
              color: SLATE,
            }}
          >
            <IconExport />
          </button>
          {moreOpen ? (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
                onClick={() => setMoreOpen(false)}
                aria-hidden
              />
              <div
                data-testid="blanko-chrome-more-menu"
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 8,
                  minWidth: 180,
                  background: CANVAS,
                  border: `1px solid ${LINE}`,
                  borderRadius: 12,
                  boxShadow: "0 12px 32px rgba(18,19,26,0.12)",
                  zIndex: 50,
                  padding: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: SLATE,
                    letterSpacing: "0.08em",
                    padding: "6px 10px 4px",
                  }}
                >
                  EXPORT
                </div>
                {exportOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`blanko-chrome-export-${opt.id}`}
                    onClick={() => {
                      opt.onClick();
                      setMoreOpen(false);
                    }}
                    style={menuItem}
                  >
                    {opt.label}
                  </button>
                ))}
                {moreItems.length > 0 ? (
                  <>
                    <div style={{ height: 1, background: LINE, margin: "6px 4px" }} />
                    {moreItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          item.onClick();
                          setMoreOpen(false);
                        }}
                        style={menuItem}
                      >
                        {item.label}
                      </button>
                    ))}
                  </>
                ) : null}
                {materializeSlot ? (
                  <>
                    <div style={{ height: 1, background: LINE, margin: "6px 4px" }} />
                    <div style={{ padding: "4px 6px" }} onClick={() => setMoreOpen(false)}>
                      {materializeSlot}
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <span
      style={{ width: 1, height: 22, background: LINE, margin: "0 2px", flexShrink: 0 }}
      aria-hidden
    />
  );
}

/** Stroke icons — 1.75px professional geometry (not emoji / sparkle glyphs). */
function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 10.5 12 4l7.5 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5.5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6 9 12l6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 12h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 4h10.5L20 7.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M8 4v5h8V4" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M8 19v-6h8v6" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="18" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="6" cy="12" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="18" cy="19" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8.2 10.9 15.8 6.6M8.2 13.1l7.6 4.3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconExport() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15V4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="m8 8 4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

const roundIcon: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: `1px solid ${LINE}`,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
  boxSizing: "border-box",
};

const pageChip: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  fontFamily: FONT_UI,
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
  border: `1px solid ${LINE}`,
  flexShrink: 0,
  letterSpacing: "-0.01em",
  lineHeight: 1.2,
};

const menuItem: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  border: "none",
  background: "transparent",
  borderRadius: 8,
  fontFamily: FONT_UI,
  fontSize: 13,
  color: INK,
  cursor: "pointer",
};
