/* blanko brand tokens.
   Mirrored as CSS variables on :root in src/index.css, so a value used in inline
   styles here is available to plain CSS as var(--blanko-<name>):
     INK -> var(--blanko-ink), ACCENT_WASH -> var(--blanko-accent-wash),
     FONT_BRAND -> var(--blanko-font-brand).
   Change a value in both places or they drift. */

export const INK = "#12131A";
export const SLATE = "#6B7280";
export const LINE = "#E5E7EB";
export const PAPER = "#FAFAFA";
export const CANVAS = "#FFFFFF";
export const ACCENT = "#ef32a6";
export const ACCENT_WASH = "#FDF2F8";

/** Findings severity only — never chrome or brand surfaces. */
export const GOOD = "#16A34A";
export const WARN = "#D97706";
export const BAD = "#DC2626";

export const FONT_BRAND = "'Bubbleboddy Neue', system-ui, sans-serif";
export const FONT_UI =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const FONT_MONO =
  '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

export const tokens = {
  ink: INK,
  slate: SLATE,
  line: LINE,
  paper: PAPER,
  canvas: CANVAS,
  accent: ACCENT,
  accentWash: ACCENT_WASH,
  good: GOOD,
  warn: WARN,
  bad: BAD,
  fontBrand: FONT_BRAND,
  fontUi: FONT_UI,
  fontMono: FONT_MONO,
} as const;

export type BrandToken = keyof typeof tokens;
