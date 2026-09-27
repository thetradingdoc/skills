import { DESIGN_DND_MIME } from "../greenfieldDesign";
import { allBuildItems, providerForBuildItem, recommendForSelection, type BuildItem } from "./buildCatalog";
import type { ArchNode } from "../types";
import { ProviderIcon } from "../ProviderIcon";
import { CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type Props = {
  selectedNode: ArchNode | null;
  onPlace: (paletteId: string) => void;
  findings?: Array<{ ruleId?: string; title?: string; nodeIds?: string[] }>;
  graphHasAuth?: boolean;
  graphNodes?: ArchNode[];
  /** dock = right Components; rail = left Build tab (denser Brainwave/Build mock). */
  variant?: "dock" | "rail";
  searchQuery?: string;
  /** False on scanned code maps — Components must not mutate topology. */
  designAllowed?: boolean;
  /** Fired when a Components row HTML5 drag starts/ends (for dock pass-through). */
  onPaletteDragStart?: () => void;
  onPaletteDragEnd?: () => void;
};

const GROUP_ORDER = [
  "Agent",
  "Brain",
  "Memory & RAG",
  "Tools",
  "Strategies",
  "Channels",
  "Data",
  "Eval",
  "Ops",
] as const;

const GROUP_LABEL: Record<string, string> = {
  Agent: "Agent",
  Brain: "Brain",
  "Memory & RAG": "Memory & RAG",
  Tools: "Tools",
  Strategies: "Strategies",
  Channels: "Channels",
  Data: "Data",
  Eval: "Eval",
  Ops: "Ops",
};

function kindGlyph(item: BuildItem): string {
  const id = item.id.toLowerCase();
  const layer = String(item.layer ?? "");
  if (id.includes("auth")) return "⬡";
  if (id.includes("api") || id.includes("gateway")) return "⇄";
  if (id.includes("frontend") || id.includes("react")) return "▣";
  if (id.includes("mobile")) return "▣";
  if (id.includes("db") || id.includes("postgres") || id.includes("vector") || id.includes("mongo")) return "▦";
  if (id.includes("cache") || id.includes("redis")) return "⚡";
  if (id.includes("queue") || id.includes("kafka") || id.includes("worker")) return "⇢";
  if (id.includes("agent") || id.includes("llm") || id.includes("openai") || id.includes("anthropic")) return "✦";
  if (id.includes("eval")) return "✓";
  if (layer.includes("External")) return "◎";
  return "●";
}

function BuildRow({
  item,
  onPlace,
  compact,
  disabled,
  onPaletteDragStart,
  onPaletteDragEnd,
}: {
  item: BuildItem;
  onPlace: (id: string) => void;
  compact?: boolean;
  disabled?: boolean;
  onPaletteDragStart?: () => void;
  onPaletteDragEnd?: () => void;
}) {
  const provider = providerForBuildItem(item);
  return (
    <button
      type="button"
      data-testid={`blanko-build-item-${item.id}`}
      draggable={!disabled}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onDragStart={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(DESIGN_DND_MIME, item.id);
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "copy";
        // Defer so the browser finishes dragstart before the dock goes
        // pointer-events:none (avoids cancelling the drag on some engines).
        requestAnimationFrame(() => onPaletteDragStart?.());
      }}
      onDragEnd={() => {
        onPaletteDragEnd?.();
      }}
      onClick={() => {
        if (disabled) return;
        onPlace(item.id);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 10 : 10,
        width: "100%",
        textAlign: "left",
        padding: compact ? "8px 10px" : "10px 12px",
        marginBottom: compact ? 6 : 6,
        borderRadius: compact ? 12 : 10,
        border: `1px solid ${LINE}`,
        background: CANVAS,
        cursor: disabled ? "not-allowed" : "grab",
        opacity: disabled ? 0.55 : 1,
        fontFamily: FONT_UI,
      }}
    >
      <span
        style={{
          width: compact ? 28 : 28,
          height: compact ? 28 : 28,
          borderRadius: 8,
          background: PAPER,
          border: `1px solid ${LINE}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {provider ? (
          <ProviderIcon providerId={provider.id} size={compact ? 16 : 18} chip={false} />
        ) : (
          <span style={{ fontSize: 12, color: INK, lineHeight: 1 }}>{kindGlyph(item)}</span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: compact ? 13 : 13, fontWeight: 600, color: INK }}>{item.label}</span>
        {!compact && (
          <span style={{ display: "block", fontSize: 11, color: SLATE, marginTop: 2, lineHeight: 1.4 }}>
            {item.why ?? item.description}
          </span>
        )}
        {compact && item.why && (
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: SLATE,
              marginTop: 1,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.why}
          </span>
        )}
      </span>
    </button>
  );
}

function groupItems(items: BuildItem[]): Array<{ key: string; label: string; items: BuildItem[] }> {
  const map = new Map<string, BuildItem[]>();
  for (const item of items) {
    const raw = item.group ?? "Other";
    const key = GROUP_ORDER.includes(raw as (typeof GROUP_ORDER)[number]) ? raw : "Other";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return GROUP_ORDER.filter((k) => map.has(k)).map((key) => ({
    key,
    label: GROUP_LABEL[key] ?? key,
    items: map.get(key)!,
  }));
}

export function BuildPanel({
  selectedNode,
  onPlace,
  findings,
  graphHasAuth,
  graphNodes,
  variant = "dock",
  searchQuery = "",
  designAllowed = true,
  onPaletteDragStart,
  onPaletteDragEnd,
}: Props) {
  const compact = variant === "rail";
  const q = searchQuery.trim().toLowerCase();
  const recommended = recommendForSelection(selectedNode, {
    findings,
    graphHasAuth,
    graphNodes,
  }).filter((i) =>
    !q ? true : i.label.toLowerCase().includes(q) || i.id.includes(q)
  );
  const catalog = allBuildItems().filter(
    (i) => !recommended.some((r) => r.id === i.id) && (!q || i.label.toLowerCase().includes(q) || i.id.includes(q))
  );
  const sections = groupItems(catalog);
  const blocked = !designAllowed;
  const rowDrag = {
    onPaletteDragStart,
    onPaletteDragEnd,
  };

  return (
    <div
      data-testid="blanko-build"
      data-build-variant={variant}
      data-design-allowed={designAllowed ? "true" : "false"}
      style={{ padding: compact ? "4px 10px 16px" : 14, fontFamily: FONT_UI }}
    >
      {compact ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Components</div>
          <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
            Bind a provider, or add agent blocks to this canvas while Edit is on.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 14 }} data-testid="blanko-build-intro">
          Bind a provider onto the selected module, or add an agent block to the canvas. Connected repository read blocks can run from Harness; other integrations need a runtime adapter and credentials.
        </div>
      )}

      {blocked ? (
        <div
          data-testid="blanko-build-design-only-cta"
          role="status"
          style={{
            marginBottom: compact ? 12 : 14,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${LINE}`,
            background: PAPER,
            fontSize: 12,
            color: INK,
            lineHeight: 1.45,
          }}
        >
          Switch the canvas to Edit to add agent blocks alongside this repository map
        </div>
      ) : null}

      {recommended.length > 0 && (
        <>
          <div style={{ ...sectionHead, marginBottom: 8 }} data-testid="blanko-build-recommended">
            {selectedNode ? `Recommended for ${selectedNode.label}` : "Recommended to start"}
          </div>
          {recommended.map((item) => (
            <BuildRow
              key={`rec-${item.id}`}
              item={item}
              onPlace={onPlace}
              compact={compact}
              disabled={blocked}
              {...rowDrag}
            />
          ))}
        </>
      )}

      {sections.map((sec) => (
        <div key={sec.key} style={{ marginTop: compact ? 14 : 18 }}>
          <div style={{ ...sectionHead, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            {sec.label}
            {sec.key === "Agent" || sec.key === "Strategies" || sec.key === "Channels" ? (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  background: INK,
                  color: CANVAS,
                  borderRadius: 999,
                  padding: "2px 6px",
                }}
              >
                New
              </span>
            ) : null}
          </div>
          {sec.items.map((item) => (
            <BuildRow
              key={item.id}
              item={item}
              onPlace={onPlace}
              compact={compact}
              disabled={blocked}
              {...rowDrag}
            />
          ))}
        </div>
      ))}

      {!compact && catalog.length === 0 && recommended.length === 0 && (
        <div style={{ fontSize: 12, color: SLATE }}>No components match.</div>
      )}
    </div>
  );
}

const sectionHead = {
  fontFamily: FONT_UI,
  fontSize: 12,
  fontWeight: 700 as const,
  color: INK,
  letterSpacing: "-0.01em",
};
