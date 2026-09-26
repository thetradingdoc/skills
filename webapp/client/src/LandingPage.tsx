/**
 * blanko landing page — one designed composition.
 *
 * The hero is a paper panel inset from the viewport with four floating product
 * props in the corners and two CTAs: "Start design" (onboarding chat) and
 * "Import file", which reveals a hidden panel with n8n upload + GitHub import.
 * All state that outlives the landing (repo url, errors, overlays) is passed
 * in from App.
 */
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { DotGrid } from "./ui/DotGrid";
import { PrimaryBtn, GhostBtn } from "./ui/buttons";
import { ProviderIcon } from "./ProviderIcon";
import { DESIGN_BLUEPRINTS } from "./designBlueprints";
import {
  INK,
  SLATE,
  LINE,
  PAPER,
  CANVAS,
  ACCENT,
  ACCENT_WASH,
  WARN,
  BAD,
  FONT_BRAND,
  FONT_UI,
  FONT_MONO,
} from "./theme/tokens";

export type LandingPageProps = {
  repoUrl: string;
  onRepoUrlChange: (v: string) => void;
  error: string | null;
  authLoading: boolean;
  onScan: () => void;
  onDesignFromScratch: () => void;
  onImportN8nClick: () => void;
  /** Parent-owned hidden <input type="file"> for n8n JSON. */
  n8nFileInput: ReactNode;
  onForkBlueprint: (id: string) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
  /** Modals / overlays rendered by the parent. */
  children?: ReactNode;
};

const WORKS_WITH = [
  "react",
  "postgresql",
  "n8n",
  "stripe",
  "openai",
  "redis",
  "kafka",
  "supabase",
] as const;

const CANVAS_PROPS: { id: string; label: string; provider: string }[] = [
  { id: "frontend", label: "Frontend", provider: "react" },
  { id: "api", label: "API", provider: "generic" },
  { id: "postgres", label: "Postgres", provider: "postgresql" },
];

const CARD_SHADOW = "0 12px 32px rgba(18,19,26,0.10), 0 2px 6px rgba(18,19,26,0.05)";

const LANDING_CSS = `
.blanko-landing { --blanko-hero-size: clamp(40px, 6.2vw, 72px); }
.blanko-landing .blanko-h1 {
  font-size: var(--blanko-hero-size);
  line-height: 1.02;
  letter-spacing: -0.04em;
  margin: 0;
  max-width: 20ch;
}
.blanko-landing .blanko-h1 .l1 { font-weight: 700; color: ${INK}; display: block; }
.blanko-landing .blanko-h1 .l2 { font-weight: 500; color: ${SLATE}; display: block; }
.blanko-landing .blanko-prop {
  position: absolute;
  z-index: 2;
  background: ${CANVAS};
  border: 1px solid ${LINE};
  border-radius: 16px;
  box-shadow: ${CARD_SHADOW};
  padding: 12px;
  box-sizing: border-box;
  text-align: left;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease;
}
.blanko-landing .blanko-prop-click { cursor: pointer; }
.blanko-landing .blanko-prop-click:hover {
  box-shadow: 0 18px 44px rgba(18,19,26,0.14), 0 2px 6px rgba(18,19,26,0.06);
}
.blanko-landing .blanko-input:focus {
  border-color: ${ACCENT};
  box-shadow: 0 0 0 3px ${ACCENT_WASH};
}
.blanko-landing .blanko-tile,
.blanko-landing .blanko-bp-card {
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.blanko-landing .blanko-bp-card:hover {
  border-color: #D4D7DE;
  box-shadow: 0 10px 26px rgba(18, 19, 26, 0.07);
  transform: translateY(-2px);
}
@media (max-width: 1180px) {
  .blanko-landing .blanko-prop { display: none; }
}
@media (max-width: 860px) {
  .blanko-landing .blanko-header { padding: 16px 20px; }
  .blanko-landing .blanko-hero-panel { margin: 0 12px 12px; min-height: 74vh; }
}
@media (max-width: 560px) {
  .blanko-landing .blanko-header { padding: 14px 16px; }
  .blanko-landing .blanko-import-row { flex-direction: column; align-items: stretch !important; }
  .blanko-landing .blanko-import-row > button,
  .blanko-landing .blanko-import-row > input { width: 100%; }
}
`;

function monoLabelStyle(): CSSProperties {
  return {
    fontFamily: FONT_MONO,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: SLATE,
  };
}

/** Top-left prop: a miniature of the canvas the product is actually about. */
function CanvasProp() {
  return (
    <div className="blanko-prop" style={{ top: "6%", left: "3%", width: 272, transform: "rotate(-5deg)" }}>
      <div style={{ ...monoLabelStyle(), marginBottom: 12 }}>Your canvas</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {CANVAS_PROPS.map((n, i) => (
          <div key={n.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px 9px 9px",
                borderRadius: 999,
                border: `1px solid ${LINE}`,
                background: PAPER,
              }}
            >
              <ProviderIcon providerId={n.provider} size={20} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{n.label}</span>
            </div>
            {i < CANVAS_PROPS.length - 1 && (
              <div style={{ width: 2, height: 16, background: LINE, marginLeft: 22 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Top-right prop: what a scan hands back. */
function FindingsProp() {
  const rows: { dot: string; text: string; chip: string }[] = [
    { dot: WARN, text: "No error handling", chip: "med" },
    { dot: ACCENT, text: "Hardcoded secret", chip: "high" },
  ];
  return (
    <div className="blanko-prop" style={{ top: "9%", right: "3.5%", width: 252, transform: "rotate(4deg)" }}>
      <div style={{ ...monoLabelStyle(), marginBottom: 12 }}>Findings</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {rows.map((r) => (
          <div key={r.text} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: r.dot,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, color: INK, flex: 1, lineHeight: 1.3 }}>{r.text}</span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: SLATE,
                background: PAPER,
                border: `1px solid ${LINE}`,
                borderRadius: 6,
                padding: "3px 6px",
                flexShrink: 0,
              }}
            >
              {r.chip}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Bottom-left prop: a second, decorative-but-live n8n drop target. */
function UploadProp({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="landing-import-n8n-card"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="blanko-prop blanko-prop-click"
      style={{
        bottom: "8%",
        left: "4.5%",
        width: 262,
        transform: hover ? "rotate(3deg) translateY(-4px)" : "rotate(3deg)",
      }}
    >
      <div
        style={{
          border: `2px dashed ${hover ? "#D4D7DE" : LINE}`,
          borderRadius: 12,
          padding: "20px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
          textAlign: "center",
        }}
      >
        <ProviderIcon providerId="n8n" size={36} />
        <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>Upload workflow or design doc</div>
        <div style={{ fontSize: 12, color: SLATE }}>Drop .json or .md</div>
      </div>
    </div>
  );
}

/** Bottom-right prop: big colored provider marks. */
function IntegrationsProp() {
  return (
    <div
      data-testid="landing-works-with"
      className="blanko-prop"
      style={{ bottom: "6%", right: "4%", width: 274, transform: "rotate(-4deg)" }}
    >
      <div style={{ ...monoLabelStyle(), marginBottom: 12 }}>Works with</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          justifyItems: "center",
        }}
      >
        {WORKS_WITH.map((id) => (
          <div key={id} data-testid={`works-with-${id}`} style={{ display: "flex" }}>
            <ProviderIcon providerId={id} size={36} chip />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Import panel, hidden behind the hero "Import" button for a cleaner first
 * view. n8n upload leads; GitHub import below; one caption at the bottom.
 */
function ImportPanel({
  repoUrl,
  onRepoUrlChange,
  error,
  authLoading,
  onScan,
  onImportN8nClick,
}: Pick<
  LandingPageProps,
  "repoUrl" | "onRepoUrlChange" | "error" | "authLoading" | "onScan" | "onImportN8nClick"
>) {
  return (
    <div
      data-testid="landing-import-panel"
      style={{
        marginTop: 18,
        width: "100%",
        maxWidth: 560,
        background: CANVAS,
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        boxShadow: CARD_SHADOW,
        padding: 18,
        boxSizing: "border-box",
        textAlign: "left",
      }}
    >
      <button
        type="button"
        data-testid="landing-import-n8n"
        data-ll-interactive="true"
        onClick={onImportN8nClick}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "13px 16px",
          background: ACCENT_WASH,
          border: `1px dashed ${ACCENT}66`,
          borderRadius: 10,
          color: "#9D1D6B",
          fontFamily: FONT_UI,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <ProviderIcon providerId="n8n" size={20} />
        Upload workflow or doc (.json, .md)
      </button>

      <div
        className="blanko-import-row"
        style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}
      >
        <input
          className="blanko-input"
          type="url"
          value={repoUrl}
          onChange={(e) => onRepoUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onScan();
          }}
          placeholder="https://github.com/owner/repo"
          aria-label="GitHub repository URL"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "11px 12px",
            fontFamily: FONT_MONO,
            fontSize: 13,
            color: INK,
            background: PAPER,
            border: `1px solid ${LINE}`,
            borderRadius: 10,
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color 0.16s ease, box-shadow 0.16s ease",
          }}
        />
        <PrimaryBtn small data-testid="landing-import-scan" onClick={onScan} disabled={authLoading}>
          Import →
        </PrimaryBtn>
      </div>

      {error && (
        <div
          data-testid="landing-error"
          style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5, color: BAD }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          letterSpacing: "0.05em",
          color: SLATE,
          textAlign: "center",
        }}
      >
        GitHub repo · workflow (.json) · design doc (.md)
      </div>
    </div>
  );
}

function BlueprintGrid({ onFork }: { onFork: (id: string) => void }) {
  return (
    <div
      data-testid="design-blueprint-gallery"
      style={{
        marginTop: 20,
        width: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
        gap: 12,
        textAlign: "left",
      }}
    >
      {DESIGN_BLUEPRINTS.map((bp) => (
        <div
          key={bp.id}
          className="blanko-bp-card"
          data-testid={`design-blueprint-${bp.id}`}
          style={{
            background: CANVAS,
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 700, color: INK, letterSpacing: "-0.01em" }}>
            {bp.title}
          </div>
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.5,
              color: SLATE,
              flex: 1,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {bp.summary}
          </div>
          <button
            type="button"
            data-testid={`design-blueprint-fork-${bp.id}`}
            onClick={() => onFork(bp.id)}
            style={{
              alignSelf: "flex-start",
              marginTop: 4,
              padding: 0,
              background: "none",
              border: "none",
              color: ACCENT,
              fontFamily: FONT_UI,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Fork →
          </button>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ ...monoLabelStyle(), marginBottom: 16 }}>{children}</div>;
}

export function LandingPage({
  repoUrl,
  onRepoUrlChange,
  error,
  authLoading,
  onScan,
  onDesignFromScratch,
  onImportN8nClick,
  n8nFileInput,
  onForkBlueprint,
  onSignIn,
  onGetStarted,
  children,
}: LandingPageProps) {
  const [showBlueprints, setShowBlueprints] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // A failed import remounts the landing; reopen the panel so the error is seen.
  useEffect(() => {
    if (error) setShowImport(true);
  }, [error]);

  return (
    <div
      className="blanko-landing"
      style={{
        minHeight: "100vh",
        background: CANVAS,
        color: INK,
        fontFamily: FONT_UI,
        position: "relative",
        overflowX: "hidden",
      }}
    >
      <style>{LANDING_CSS}</style>

      <header
        className="blanko-header"
        style={{
          position: "relative",
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "20px 32px",
          boxSizing: "border-box",
          background: CANVAS,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <img src="/favicon.svg" alt="" width={26} height={26} style={{ display: "block" }} />
          <span
            style={{
              fontFamily: FONT_BRAND,
              fontSize: 26,
              fontWeight: 400,
              letterSpacing: "-0.01em",
              color: INK,
              lineHeight: 1,
            }}
          >
            blanko
          </span>
        </div>
        <nav style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GhostBtn small onClick={onSignIn} data-testid="landing-sign-in">
            Sign in
          </GhostBtn>
          <PrimaryBtn small onClick={onGetStarted} data-testid="landing-get-started">
            Get started
          </PrimaryBtn>
        </nav>
      </header>

      <main
        className="blanko-hero-panel"
        style={{
          position: "relative",
          margin: "0 20px 20px",
          minHeight: "86vh",
          background: PAPER,
          border: `1px solid ${LINE}`,
          borderRadius: 24,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "72px 32px",
          boxSizing: "border-box",
        }}
      >
        <DotGrid size={28} dotRadius={1.4} opacity={1} fade={false} />

        <CanvasProp />
        <FindingsProp />
        <UploadProp onClick={onImportN8nClick} />
        <IntegrationsProp />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 20,
              background: CANVAS,
              border: `1px solid ${LINE}`,
              boxShadow: CARD_SHADOW,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 22,
            }}
          >
            <img src="/favicon.svg" alt="blanko" width={44} height={44} style={{ display: "block" }} />
          </div>

          <h1 className="blanko-h1">
            <span className="l1">Think, design and track</span>
            <span className="l2">your systems in one place</span>
          </h1>

          <p style={{ margin: "18px 0 0", fontSize: 18, lineHeight: 1.5, color: SLATE }}>
            A drag-and-drop canvas for architecture and automations — AI optional.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
            <PrimaryBtn
              data-testid="landing-cta-start"
              onClick={onGetStarted}
              style={{ fontSize: 16, padding: "15px 28px", borderRadius: 12 }}
            >
              Start design
            </PrimaryBtn>
            <GhostBtn
              data-testid="landing-import-toggle"
              onClick={() => setShowImport((v) => !v)}
              style={{
                fontSize: 16,
                padding: "15px 28px",
                borderRadius: 12,
                ...(showImport ? { borderColor: ACCENT, color: ACCENT } : {}),
              }}
            >
              Import file
            </GhostBtn>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: SLATE }}>No account needed</div>

          {showImport && (
            <ImportPanel
              repoUrl={repoUrl}
              onRepoUrlChange={onRepoUrlChange}
              error={error}
              authLoading={authLoading}
              onScan={onScan}
              onImportN8nClick={onImportN8nClick}
            />
          )}
        </div>

        {n8nFileInput}
      </main>

      <section
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "72px 24px 0",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <SectionLabel>Or start from an agent blueprint</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <button
              type="button"
              data-testid="design-from-scratch"
              data-ll-interactive="true"
              onClick={onDesignFromScratch}
              style={{
                padding: 0,
                background: "none",
                border: "none",
                fontFamily: FONT_UI,
                fontSize: 13,
                fontWeight: 600,
                color: SLATE,
                cursor: "pointer",
              }}
            >
              Start with a blank canvas →
            </button>
            <GhostBtn
              small
              data-testid="design-blueprint-gallery-toggle"
              onClick={() => setShowBlueprints((v) => !v)}
            >
              {showBlueprints ? "Hide blueprints" : "Browse blueprints"}
            </GhostBtn>
          </div>
        </div>
        {showBlueprints && <BlueprintGrid onFork={onForkBlueprint} />}
      </section>

      <footer
        style={{
          padding: "64px 24px 36px",
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: SLATE,
        }}
      >
        blanko — think, design and track
      </footer>

      {children}
    </div>
  );
}

export default LandingPage;
