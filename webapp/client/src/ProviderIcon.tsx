/**
 * Tiny React badge for a catalog provider icon.
 * Colored brand mark on a soft tinted chip so icons read on white and dark chrome.
 */
import type { CSSProperties } from "react";
import { getProvider, providerIconSrc, providerDisplayName } from "./providerCatalog";

type Props = {
  providerId: string | null | undefined;
  size?: number;
  showLabel?: boolean;
  /** When true, wraps the mark in a tinted brand-color chip (default true). */
  chip?: boolean;
  style?: CSSProperties;
  title?: string;
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6) return `rgba(239, 50, 166, ${alpha})`;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ProviderIcon({
  providerId,
  size = 16,
  showLabel = false,
  chip = true,
  style,
  title,
}: Props) {
  const def = getProvider(providerId);
  const src = providerIconSrc(providerId);
  const name = providerDisplayName(providerId);
  const brand = def?.color ?? "#6B7280";
  const isNearBlack = /^#0{0,2}[0-3][0-9a-f]{0,5}$/i.test(brand) || brand.toLowerCase() === "#181717" || brand.toLowerCase() === "#231f20" || brand.toLowerCase() === "#292929" || brand.toLowerCase() === "#000000" || brand.toLowerCase() === "#000";
  const chipPad = chip ? Math.max(3, Math.round(size * 0.22)) : 0;
  const markSize = chip ? Math.max(10, size - chipPad) : size;

  return (
    <span
      data-testid="provider-icon"
      data-provider-id={def?.id ?? providerId ?? ""}
      data-provider-color={brand}
      title={title ?? name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        verticalAlign: "middle",
        ...style,
      }}
    >
      <span
        data-testid="provider-icon-chip"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size + (chip ? chipPad * 2 : 0),
          height: size + (chip ? chipPad * 2 : 0),
          borderRadius: Math.max(5, Math.round((size + chipPad * 2) * 0.28)),
          background: chip ? (isNearBlack ? "#F3F4F6" : hexToRgba(brand, 0.12)) : "transparent",
          border: chip && isNearBlack ? "1px solid #E5E7EB" : "1px solid transparent",
          boxSizing: "border-box",
          flexShrink: 0,
        }}
      >
        <img
          src={src}
          alt=""
          width={markSize}
          height={markSize}
          style={{
            width: markSize,
            height: markSize,
            objectFit: "contain",
            display: "block",
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/provider-icons/generic.svg";
          }}
        />
      </span>
      {showLabel && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#12131A",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          }}
        >
          {name}
        </span>
      )}
    </span>
  );
}
