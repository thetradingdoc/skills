/**
 * Platform inventory: providers this architecture depends on (blanko light theme).
 */
import { useEffect, useMemo, useState } from "react";
import type { ArchGraph } from "./types";
import {
  PROVIDER_CATALOG,
  categoryLabel,
  bindingStatusColor,
  bindingStatusLabel,
  type ProviderCategory,
} from "./providerCatalog";
import { ProviderIcon } from "./ProviderIcon";
import {
  buildPlatformInventory,
  collectDetectedProvidersFromAgents,
  type InventoryRow,
} from "./platformInventory";
import { ACCENT, ACCENT_WASH, BAD, CANVAS, FONT_MONO, GOOD, INK, LINE, PAPER, SLATE } from "./theme/tokens";

type Props = {
  graph: ArchGraph | null;
  onSelectNode?: (nodeId: string) => void;
};

function TradingRuntimeStrip({
  enabled,
  llmRouting,
}: {
  enabled: boolean;
  llmRouting?: NonNullable<ArchGraph["providers"]>["llmRouting"];
}) {
  const [live, setLive] = useState<{ ok: boolean; status: number; note?: string } | null>(null);
  const [vendors, setVendors] = useState<{
    primary?: string;
    anthropic?: VendorCreditRow;
    groq?: VendorCreditRow;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tickHealth = () => {
      fetch("/api/trading-runtime-health")
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setLive({ ok: !!j.ok, status: Number(j.status) || 0, note: j.note });
        })
        .catch(() => {
          if (!cancelled) setLive({ ok: false, status: 0 });
        });
    };
    const tickVendors = () => {
      fetch("/api/trading-vendor-credits")
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) {
            setVendors({
              primary: typeof j.primary === "string" ? j.primary : undefined,
              anthropic: j.anthropic as VendorCreditRow | undefined,
              groq: j.groq as VendorCreditRow | undefined,
            });
          }
        })
        .catch(() => {
          if (!cancelled) setVendors(null);
        });
    };
    tickHealth();
    tickVendors();
    const healthId = window.setInterval(tickHealth, 15000);
    const vendorId = window.setInterval(tickVendors, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(healthId);
      window.clearInterval(vendorId);
    };
  }, [enabled]);
  if (!enabled) return null;
  const primary = vendors?.primary || llmRouting?.primary || "anthropic";
  const fallback = llmRouting?.fallback ?? "groq";
  return (
    <div
      data-testid="trading-runtime-strip"
      style={{
        marginTop: 8,
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${LINE}`,
        background: PAPER,
        fontSize: 11,
        color: INK,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <span>
        runtime:{" "}
        <span style={{ color: live == null ? SLATE : live.ok ? GOOD : BAD, fontWeight: 600 }}>
          {live == null ? "…" : live.ok ? "ok" : "down"}
        </span>
        {live && live.status ? ` (${live.status})` : ""}
      </span>
      <span style={{ color: SLATE }}>
        LLM: primary={primary} · fallback={fallback}
        {llmRouting?.source ? ` (${llmRouting.source})` : ""}
      </span>
      <span data-testid="trading-vendor-credits" style={{ color: SLATE, width: "100%" }}>
        vendors: Anthropic {formatVendor(vendors?.anthropic)} · Groq {formatVendor(vendors?.groq)}
        <span style={{ color: SLATE }}> · live key auth (+ rate-limit remaining when exposed)</span>
      </span>
    </div>
  );
}

type VendorCreditRow = {
  configured?: boolean;
  ok?: boolean;
  remainingRequests?: number | null;
  remainingTokens?: number | null;
  detail?: string;
};

function formatVendor(v?: VendorCreditRow | null): string {
  if (!v) return "…";
  if (!v.configured) return "no key";
  if (!v.ok) return v.detail || "auth fail";
  const bits: string[] = ["ok"];
  if (typeof v.remainingRequests === "number") bits.push(`${v.remainingRequests} req left`);
  if (typeof v.remainingTokens === "number") bits.push(`${v.remainingTokens} tok left`);
  return bits.join(", ");
}

const CATEGORIES: ProviderCategory[] = [
  "llm",
  "framework",
  "cloud",
  "data",
  "observability",
  "third_party",
  "voice",
];

function Row({
  row,
  onSelectNode,
}: {
  row: InventoryRow;
  onSelectNode?: (nodeId: string) => void;
}) {
  const sourceNote =
    row.sources.includes("detected") && row.status === "unknown"
      ? "detected"
      : row.sources.includes("detected") && row.status === "connected"
        ? "detected + bound"
        : row.sources.join("+");

  return (
    <div
      data-testid="platform-inventory-row"
      data-provider-id={row.provider.id}
      data-binding-status={row.status}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "10px 12px",
        borderBottom: `1px solid ${LINE}`,
        background:
          row.status === "unbound" && row.provider.critical ? "rgba(220,38,38,0.06)" : "transparent",
      }}
    >
      <ProviderIcon providerId={row.provider.id} size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{row.provider.name}</span>
          <span
            style={{
              fontSize: 10,
              fontFamily: FONT_MONO,
              color: bindingStatusColor(row.status),
              border: `1px solid ${bindingStatusColor(row.status)}55`,
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            {bindingStatusLabel(row.status)}
          </span>
          {row.provider.critical && row.status === "unbound" && (
            <span style={{ fontSize: 10, color: BAD, fontFamily: FONT_MONO }}>critical gap</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 4, fontFamily: FONT_MONO }}>
          {categoryLabel(row.provider.category)}
          {row.sources.length > 0 ? ` · ${sourceNote}` : ""}
          {row.accountLabels.length > 0 ? ` · ${row.accountLabels.join(", ")}` : ""}
        </div>
        {row.boundNodeIds.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {row.boundNodeIds.slice(0, 8).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectNode?.(id)}
                style={{
                  fontSize: 10,
                  fontFamily: FONT_MONO,
                  color: ACCENT,
                  background: ACCENT_WASH,
                  border: `1px solid ${ACCENT}44`,
                  borderRadius: 4,
                  padding: "2px 6px",
                  cursor: onSelectNode ? "pointer" : "default",
                }}
              >
                {id.length > 28 ? id.slice(0, 26) + "…" : id}
              </button>
            ))}
            {row.boundNodeIds.length > 8 && (
              <span style={{ fontSize: 10, color: SLATE }}>+{row.boundNodeIds.length - 8}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PlatformInventoryView({ graph, onSelectNode }: Props) {
  const [filter, setFilter] = useState<"all" | "gaps" | ProviderCategory>("all");
  const detected = useMemo(
    () => collectDetectedProvidersFromAgents(graph?.agents?.agents ?? null),
    [graph?.agents]
  );
  const rows = useMemo(() => buildPlatformInventory(graph, detected), [graph, detected]);

  const visible = rows.filter((r) => {
    if (filter === "all")
      return r.status !== "unbound" || r.provider.critical || r.boundNodeIds.length > 0 || r.sources.length > 0;
    if (filter === "gaps") return r.status === "unbound" || r.status === "missing_credentials";
    return (
      r.provider.category === filter &&
      (r.status !== "unbound" || r.provider.critical || r.sources.length > 0)
    );
  });

  const gapCount = rows.filter((r) => r.status === "unbound" && r.provider.critical).length;
  // Fix F: header counts must use the same status field as row badges (BK-PLAT-001).
  // Do not treat boundNodeIds alone as "bound" — spine can attach ids with unknown/missing_credentials.
  const boundCount = rows.filter((r) => r.status === "connected").length;
  const notConfiguredCount = rows.filter((r) => r.status === "missing_credentials").length;
  const detectedUnboundCount = rows.filter(
    (r) => r.status === "unknown" && (r.sources.includes("detected") || r.boundNodeIds.length > 0)
  ).length;

  return (
    <div
      data-testid="platform-inventory"
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
          Platform inventory
        </div>
        <div style={{ fontSize: 11, color: SLATE, lineHeight: 1.45 }}>
          Providers this architecture depends on. Bound = credentials configured on a declared node;
          NOT CONFIGURED = bound role but empty scanned .env. Detected = found in scan. Credential
          flags are static from the scanned repo; the strip below live-probes trading /health and
          Anthropic/Groq key auth (rate-limit remaining when vendors expose it).
        </div>
        <TradingRuntimeStrip
          enabled={!!graph?.architectureBoard || !!graph?.projectRoot?.trim()}
          llmRouting={graph?.providers?.llmRouting}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11, color: INK }}>
          <span data-testid="platform-bound-count">{boundCount} bound</span>
          {notConfiguredCount > 0 && (
            <span data-testid="platform-not-configured-count" style={{ color: BAD }}>
              {notConfiguredCount} NOT CONFIGURED
            </span>
          )}
          {detectedUnboundCount > 0 && (
            <span data-testid="platform-detected-count" style={{ color: SLATE }}>
              {detectedUnboundCount} detected · not bound
            </span>
          )}
          <span style={{ color: gapCount ? BAD : GOOD }}>{gapCount} critical unbound</span>
          <span style={{ color: SLATE }}>{PROVIDER_CATALOG.length} in catalog</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {(
            [
              ["all", "All"],
              ["gaps", "Gaps"],
              ...CATEGORIES.map((c) => [c, categoryLabel(c)] as const),
            ] as Array<[string, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`platform-filter-${id}`}
              onClick={() => setFilter(id as typeof filter)}
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
        {visible.length === 0 ? (
          <div style={{ padding: 24, color: SLATE, fontSize: 12 }}>
            No platforms in this filter. Scan a repo or bind a provider on a node.
          </div>
        ) : (
          visible.map((row) => <Row key={row.provider.id} row={row} onSelectNode={onSelectNode} />)
        )}
      </div>

      <div style={{ padding: "10px 16px", borderTop: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 10, color: SLATE, marginBottom: 8 }}>Catalog preview</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PROVIDER_CATALOG.slice(0, 18).map((p) => (
            <span key={p.id} title={p.name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <ProviderIcon providerId={p.id} size={14} />
              <span style={{ fontSize: 9, color: SLATE }}>{p.id}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
