import { useState, type ReactNode } from "react";
import { NotificationsBell } from "../NotificationsBell";
import { ACCENT, CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type ExportOption = {
  id: string;
  label: string;
  onClick: () => void;
};

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
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
  /** Scan staleness + Rescan live in the notifications bell */
  projectRoot?: string | null;
  generatedAt?: number | null;
  onRescan?: () => void;
  scanning?: boolean;
  hideStaleness?: boolean;
};

export function ChromeBar({
  search,
  onSearchChange,
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
  onRescan,
  scanning,
  hideStaleness,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div
      data-testid="blanko-chrome-bar"
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        maxWidth: "min(720px, calc(100% - 32px))",
        width: "max-content",
        background: CANVAS,
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        boxShadow: "0 8px 28px rgba(18,19,26,0.1), 0 1px 3px rgba(18,19,26,0.04)",
        fontFamily: FONT_UI,
        pointerEvents: "auto",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 999,
          background: PAPER,
          border: `1px solid ${LINE}`,
          minWidth: 140,
          maxWidth: 220,
        }}
      >
        <SearchIcon />
        <input
          data-testid="blanko-chrome-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          style={{
            border: "none",
            background: "transparent",
            outline: "none",
            fontFamily: FONT_UI,
            fontSize: 13,
            color: INK,
            width: "100%",
            minWidth: 0,
          }}
        />
      </label>

      <Divider />

      <button
        type="button"
        data-testid="chrome-save"
        disabled={saveDisabled}
        onClick={onSave}
        style={{
          ...pillBtn,
          background: INK,
          color: CANVAS,
          border: "none",
          opacity: saveDisabled ? 0.45 : 1,
          cursor: saveDisabled ? "not-allowed" : "pointer",
        }}
      >
        {saveLabel}
      </button>
      <button
        type="button"
        data-testid="chrome-share"
        disabled={shareDisabled}
        onClick={onShare}
        style={{
          ...pillBtn,
          background: ACCENT,
          color: "#fff",
          border: "none",
          opacity: shareDisabled ? 0.45 : 1,
          cursor: shareDisabled ? "not-allowed" : "pointer",
        }}
      >
        {shareLabel}
      </button>

      <Divider />

      {accessToken && (
        <NotificationsBell
          apiBase={apiBase}
          accessToken={accessToken}
          variant="blanko"
          projectRoot={projectRoot}
          generatedAt={generatedAt}
          onRescan={onRescan}
          scanning={scanning}
          hideStaleness={hideStaleness}
        />
      )}

      <div style={{ position: "relative" }}>
        <button
          type="button"
          data-testid="export-menu-toggle"
          title="Export & more"
          onClick={() => setMoreOpen((v) => !v)}
          style={{
            ...iconBtn,
            background: moreOpen ? PAPER : CANVAS,
            gap: 2,
            width: "auto",
            padding: "0 10px",
            color: INK,
            fontFamily: FONT_UI,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <MoreIcon />
          <span>Export</span>
        </button>
        {moreOpen && (
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
              {moreItems.length > 0 && (
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
              )}
              {materializeSlot && (
                <>
                  <div style={{ height: 1, background: LINE, margin: "6px 4px" }} />
                  <div style={{ padding: "4px 6px" }} onClick={() => setMoreOpen(false)}>
                    {materializeSlot}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 22, background: LINE, margin: "0 2px", flexShrink: 0 }} />;
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0, color: SLATE }}>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16.5 16.5L20 20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ color: SLATE }}>
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="18" r="1.6" />
    </svg>
  );
}

const pillBtn = {
  padding: "7px 12px",
  borderRadius: 999,
  fontFamily: FONT_UI,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};

const iconBtn = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: `1px solid ${LINE}`,
  background: CANVAS,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const menuItem = {
  display: "block" as const,
  width: "100%",
  textAlign: "left" as const,
  padding: "8px 10px",
  border: "none",
  background: "transparent",
  borderRadius: 8,
  fontFamily: FONT_UI,
  fontSize: 13,
  color: INK,
  cursor: "pointer",
};
