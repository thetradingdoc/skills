/**
 * blanko button primitives.
 * Primary fill is INK — accent pink is reserved for text highlights, links and active state.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { INK, LINE, CANVAS, SLATE, FONT_UI } from "../theme/tokens";

type BtnProps = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  style?: CSSProperties;
  small?: boolean;
  title?: string;
  "data-testid"?: string;
};

const base = (small: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontFamily: FONT_UI,
  fontSize: small ? 13 : 15,
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: "-0.01em",
  padding: small ? "9px 14px" : "13px 22px",
  borderRadius: 10,
  cursor: "pointer",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  transition: "background 0.16s ease, border-color 0.16s ease, transform 0.12s ease, box-shadow 0.16s ease",
});

export function PrimaryBtn({
  children,
  onClick,
  disabled = false,
  type = "button",
  style,
  small = false,
  title,
  ...rest
}: BtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type={type}
      title={title}
      data-testid={rest["data-testid"]}
      data-ll-interactive="true"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...base(small),
        background: disabled ? "#C7C9D1" : hover ? "#000000" : INK,
        color: CANVAS,
        border: "1px solid transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        boxShadow:
          hover && !disabled
            ? "0 8px 20px rgba(18,19,26,0.18)"
            : "0 1px 2px rgba(18,19,26,0.08)",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function GhostBtn({
  children,
  onClick,
  disabled = false,
  type = "button",
  style,
  small = false,
  title,
  ...rest
}: BtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type={type}
      title={title}
      data-testid={rest["data-testid"]}
      data-ll-interactive="true"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...base(small),
        background: CANVAS,
        color: disabled ? SLATE : INK,
        border: `1px solid ${hover && !disabled ? "#C9CCD4" : LINE}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: hover && !disabled ? "0 4px 12px rgba(18,19,26,0.07)" : "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
