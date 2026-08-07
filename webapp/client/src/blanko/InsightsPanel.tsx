/**
 * Insights = system findings OR automated node context (minimize: one panel).
 */
import { useEffect, useState } from "react";
import type { DesignFinding } from "../designRules";
import { designScore } from "../designRules";
import type { InventoryRow } from "../platformInventory";
import { ProviderIcon } from "../ProviderIcon";
import { DesignInspectPanel } from "../DesignInspectPanel";
import type { ArchNode } from "../types";
import { NodeCollabSection } from "./NodeCollabSection";
import { BAD, CANVAS, FONT_MONO, FONT_UI, GOOD, INK, LINE, PAPER, SLATE, WARN, ACCENT } from "../theme/tokens";

type Props = {
  findings: DesignFinding[];
  inventory: InventoryRow[];
  architectureSummary?: string;
  selectedNode?: ArchNode | null;
  /** Open Edit details when true (double-click / place). */
  editDetailsOpen?: boolean;
  onEditDetailsOpenChange?: (open: boolean) => void;
  onHighlight: (finding: DesignFinding) => void;
  onFix?: (finding: DesignFinding) => void;
  onAskFix?: (finding: DesignFinding) => void;
  onContinueInChat?: (node: ArchNode) => void;
  /** Scan graph that isn't the locked trading spine yet */
  showApplyTradingSpine?: boolean;
  onApplyTradingSpine?: () => void;
  onNodeChange?: (
    patch: Partial<
      Pick<
        ArchNode,
        | "label"
        | "layer"
        | "description"
        | "platformBindings"
        | "llmProvider"
        | "cloudProvider"
        | "llmops"
        | "properties"
        | "requiredEnv"
        | "deployHealth"
      >
    >
  ) => void;
  onNodeDelete?: () => void;
  onAddNeighbours?: () => void;
  /** Open linked source file (scan graphs) without auto-navigating on select. */
  onOpenFile?: (path: string) => void;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
};

function severityColor(s: DesignFinding["severity"]) {
  if (s === "blocker") return BAD;
  if (s === "risk") return WARN;
  return GOOD;
}

export function InsightsPanel({
  findings,
  inventory,
  architectureSummary,
  selectedNode,
  editDetailsOpen: editDetailsOpenProp,
  onEditDetailsOpenChange,
  onHighlight,
  onFix,
  onAskFix,
  onContinueInChat,
  showApplyTradingSpine,
  onApplyTradingSpine,
  onNodeChange,
  onNodeDelete,
  onAddNeighbours,
  onOpenFile,
  workspaceId,
  accessToken,
  apiBase = "/api",
}: Props) {
  const nodeMode = !!selectedNode;
  const nodeFindings = selectedNode
    ? findings.filter((f) => f.nodeIds.includes(selectedNode.id))
    : findings;
  const score = designScore(nodeMode ? nodeFindings : findings);
  const [editOpen, setEditOpen] = useState(!!editDetailsOpenProp);
  const linkedFile = selectedNode?.files?.[0];

  useEffect(() => {
    if (editDetailsOpenProp !== undefined) setEditOpen(editDetailsOpenProp);
  }, [editDetailsOpenProp, selectedNode?.id]);

  const setEdit = (open: boolean) => {
    setEditOpen(open);
    onEditDetailsOpenChange?.(open);
  };

  return (
    <div data-testid="blanko-insights" style={{ padding: 14, fontFamily: FONT_UI }}>
      {nodeMode && selectedNode ? (
        <div data-testid="blanko-insights-node" style={{ marginBottom: 16 }}>
          <div style={{ ...monoLabel, marginBottom: 6 }}>Selected piece</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: INK,
              letterSpacing: "-0.02em",
              marginBottom: 4,
            }}
          >
            {selectedNode.label}
          </div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 12, lineHeight: 1.45 }}>
            {selectedNode.layer ? `${selectedNode.layer}` : "Uncategorized"}
            {selectedNode.description ? ` · ${selectedNode.description.slice(0, 120)}` : ""}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {onContinueInChat && (
              <button
                type="button"
                data-testid="blanko-insights-continue-chat"
                onClick={() => onContinueInChat(selectedNode)}
                style={primaryBtn}
              >
                Continue in chat
              </button>
            )}
            {linkedFile && onOpenFile && (
              <button
                type="button"
                data-testid="blanko-insights-open-file"
                onClick={() => onOpenFile(linkedFile)}
                style={ghostBtn}
                title={linkedFile}
              >
                Open file
              </button>
            )}
            <button
              type="button"
              data-testid="blanko-insights-edit-toggle"
              onClick={() => setEdit(!editOpen)}
              style={ghostBtn}
            >
              {editOpen ? "Hide details" : "Edit details"}
            </button>
          </div>
          {editOpen && onNodeChange && onNodeDelete && (
            <div
              data-testid="blanko-insights-edit"
              style={{
                marginTop: 8,
                marginBottom: 8,
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${LINE}`,
                background: PAPER,
              }}
            >
              <DesignInspectPanel
                variant="embedded"
                mode="node"
                node={selectedNode}
                onChange={onNodeChange}
                onDelete={onNodeDelete}
                onClose={() => setEdit(false)}
                onAddNeighbours={onAddNeighbours}
                workspaceId={workspaceId}
                accessToken={accessToken}
                apiBase={apiBase}
              />
            </div>
          )}
          <NodeCollabSection
            workspaceId={workspaceId ?? null}
            nodeId={selectedNode.id}
            nodeLabel={selectedNode.label}
            apiBase={apiBase}
            accessToken={accessToken ?? null}
          />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 14 }}>
          Findings show <strong style={{ color: INK }}>where the agent system is broken</strong>. Click
          a piece on the canvas for its context, or click a finding to highlight it.
        </div>
      )}

      {!nodeMode && architectureSummary && (
        <div
          data-testid="blanko-insights-summary"
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${LINE}`,
            background: PAPER,
            fontSize: 13,
            color: INK,
            lineHeight: 1.45,
            marginBottom: 14,
          }}
        >
          {architectureSummary}
        </div>
      )}

      {showApplyTradingSpine && onApplyTradingSpine && !nodeMode ? (
        <div
          data-testid="blanko-apply-trading-spine-cta"
          style={{
            border: `2px solid ${ACCENT}`,
            borderRadius: 12,
            padding: 14,
            marginBottom: 14,
            background: PAPER,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 6 }}>
            This is a code scan — not the trading architecture board
          </div>
          <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 10 }}>
            Rescan shows modules (Trading Chat, Service Layer…). Apply the locked spine to see
            Telegram → Identity → Payment → Policy → Risk → Execution → Alpaca.
          </div>
          <button
            type="button"
            data-testid="blanko-apply-trading-spine"
            onClick={onApplyTradingSpine}
            style={primaryBtn}
          >
            Apply trading agent spine
          </button>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={monoLabel}>{nodeMode ? "Findings on this piece" : "Findings"}</div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: SLATE }}>
          score <span style={{ color: INK, fontWeight: 700 }}>{score}</span>
        </div>
      </div>

      {nodeFindings.length === 0 ? (
        <div style={{ fontSize: 13, color: SLATE, marginBottom: 16, lineHeight: 1.45 }}>
          {nodeMode
            ? "No findings on this piece."
            : "No findings yet — a clean starting point. Keep designing; Insights updates as the graph grows."}
        </div>
      ) : (
        nodeFindings.map((f) => (
          <div
            key={f.id}
            data-testid={`blanko-finding-${f.id}`}
            style={{
              border: `1px solid ${LINE}`,
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
              background: CANVAS,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: severityColor(f.severity),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{f.title}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: SLATE, textTransform: "uppercase" }}>
                {f.severity}
              </span>
            </div>
            <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 8 }}>
              <strong style={{ color: INK }}>Why it matters: </strong>
              {f.whyItMatters}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => onHighlight(f)} style={ghostBtn} data-testid={`blanko-finding-focus-${f.id}`}>
                Show on canvas
              </button>
              {f.fix && onFix && (
                <button type="button" onClick={() => onFix(f)} style={primaryBtn} data-testid={`blanko-finding-fix-${f.id}`}>
                  Propose fix
                </button>
              )}
              {onAskFix && (
                <button type="button" onClick={() => onAskFix(f)} style={ghostBtn}>
                  Ask chat
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {!nodeMode && (
        <>
          <div style={{ ...monoLabel, marginTop: 18, marginBottom: 8 }}>Platforms · tracking</div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 10, lineHeight: 1.4 }}>
            Bind providers for design &amp; cost tracking — not to run them here.
          </div>
          {inventory.length === 0 ? (
            <div style={{ fontSize: 12, color: SLATE }}>No providers detected yet.</div>
          ) : (
            inventory.slice(0, 24).map((row) => (
              <div
                key={row.provider.id}
                data-testid={`blanko-platform-${row.provider.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                <ProviderIcon providerId={row.provider.id} size={18} />
                <span style={{ flex: 1, fontSize: 13, color: INK }}>{row.provider.name}</span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: row.status === "connected" ? GOOD : row.status === "missing_credentials" ? WARN : SLATE,
                  }}
                >
                  {row.status}
                </span>
              </div>
            ))
          )}
          <div style={{ ...monoLabel, marginTop: 18, marginBottom: 8 }}>Usage · burn</div>
          <div
            data-testid="blanko-insights-usage"
            style={{
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${LINE}`,
              background: PAPER,
              fontSize: 12,
              color: SLATE,
              lineHeight: 1.45,
              marginBottom: 8,
            }}
          >
            Select a piece and open Collab · claim for per-node burn. Platforms above track bind status.
          </div>
        </>
      )}
    </div>
  );
}

const monoLabel = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  fontWeight: 600 as const,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: SLATE,
};

const ghostBtn = {
  padding: "6px 10px",
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  background: CANVAS,
  color: INK,
  fontFamily: FONT_UI,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtn = {
  ...ghostBtn,
  background: INK,
  color: CANVAS,
  border: "1px solid transparent",
};
