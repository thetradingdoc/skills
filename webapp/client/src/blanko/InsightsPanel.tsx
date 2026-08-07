/**
 * Insights = architecture / workflow / platforms / tools / costs + node briefings.
 * Config-hidden views are always pointed out — blanko must explain where value lives.
 */
import { useEffect, useMemo, useState } from "react";
import type { DesignFinding } from "../designRules";
import { designScore } from "../designRules";
import type { InventoryRow } from "../platformInventory";
import { ProviderIcon } from "../ProviderIcon";
import { DesignInspectPanel } from "../DesignInspectPanel";
import type { ArchGraph, ArchNode } from "../types";
import { NodeCollabSection } from "./NodeCollabSection";
import {
  architectureBrief,
  briefNode,
  inventoryHeadline,
  orphanPresentationNodes,
  toolsForGraph,
  workflowHops,
} from "../insightsBriefing";
import { BAD, CANVAS, FONT_MONO, FONT_UI, GOOD, INK, LINE, PAPER, SLATE, WARN, ACCENT } from "../theme/tokens";

type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
};

type Props = {
  findings: DesignFinding[];
  inventory: InventoryRow[];
  graph?: ArchGraph | null;
  selectedNode?: ArchNode | null;
  editDetailsOpen?: boolean;
  onEditDetailsOpenChange?: (open: boolean) => void;
  onHighlight: (finding: DesignFinding) => void;
  onFix?: (finding: DesignFinding) => void;
  onAskFix?: (finding: DesignFinding) => void;
  onContinueInChat?: (node: ArchNode) => void;
  showApplyTradingSpine?: boolean;
  onApplyTradingSpine?: () => void;
  onOpenConfig?: (view: "flow" | "agents" | "usage" | "platforms") => void;
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

function cents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

export function InsightsPanel({
  findings,
  inventory,
  graph,
  selectedNode,
  editDetailsOpen: editDetailsOpenProp,
  onEditDetailsOpenChange,
  onHighlight,
  onFix,
  onAskFix,
  onContinueInChat,
  showApplyTradingSpine,
  onApplyTradingSpine,
  onOpenConfig,
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
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [usageNote, setUsageNote] = useState<string | null>(null);

  const brief = useMemo(
    () => (selectedNode ? briefNode(graph, selectedNode) : null),
    [graph, selectedNode]
  );
  const hops = useMemo(() => (!nodeMode ? workflowHops(graph) : []), [graph, nodeMode]);
  const orphans = useMemo(
    () => (!nodeMode ? orphanPresentationNodes(graph) : []),
    [graph, nodeMode]
  );
  const tools = useMemo(() => (!nodeMode ? toolsForGraph(graph) : []), [graph, nodeMode]);
  const archText = useMemo(() => architectureBrief(graph), [graph]);
  const platHeadline = useMemo(() => inventoryHeadline(inventory), [inventory]);

  useEffect(() => {
    if (editDetailsOpenProp !== undefined) setEditOpen(editDetailsOpenProp);
  }, [editDetailsOpenProp, selectedNode?.id]);

  useEffect(() => {
    if (!workspaceId || !accessToken) {
      setUsage(null);
      setUsageNote("Sign in and open Config → Usage for burn & budgets.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/usage?days=30`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!r.ok) {
          if (!cancelled) {
            setUsage(null);
            setUsageNote("Usage API unavailable — open Config → Usage when ready.");
          }
          return;
        }
        const d = await r.json();
        if (cancelled) return;
        if (d.migrationPending) {
          setUsage(null);
          setUsageNote("Usage tables pending migration — Config → Usage.");
          return;
        }
        setUsage(d.totals ?? null);
        setUsageNote(null);
      } catch {
        if (!cancelled) {
          setUsage(null);
          setUsageNote("Could not load burn — Config → Usage.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken, apiBase, graph?.generatedAt]);

  const setEdit = (open: boolean) => {
    setEditOpen(open);
    onEditDetailsOpenChange?.(open);
  };

  const configLink = (view: "flow" | "agents" | "usage" | "platforms", label: string) =>
    onOpenConfig ? (
      <button
        type="button"
        data-testid={`blanko-insights-open-${view}`}
        onClick={() => onOpenConfig(view)}
        style={{ ...linkBtn }}
      >
        {label}
      </button>
    ) : (
      <span style={{ color: ACCENT, fontWeight: 600 }}>{label}</span>
    );

  return (
    <div data-testid="blanko-insights" style={{ padding: 14, fontFamily: FONT_UI }}>
      {nodeMode && selectedNode && brief ? (
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
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
            {selectedNode.layer ?? "Uncategorized"}
            {selectedNode.buildStatus ? ` · ${selectedNode.buildStatus}` : ""}
          </div>
          <div
            data-testid="blanko-insights-node-role"
            style={{
              fontSize: 13,
              color: INK,
              lineHeight: 1.45,
              marginBottom: 8,
              padding: 10,
              borderRadius: 10,
              background: PAPER,
              border: `1px solid ${LINE}`,
            }}
          >
            {brief.role}
            {brief.moneyRule ? (
              <div style={{ marginTop: 8, fontSize: 12, color: ACCENT, fontWeight: 600 }}>
                {brief.moneyRule}
              </div>
            ) : null}
          </div>

          {brief.neighbours.length > 0 ? (
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 8, lineHeight: 1.4 }}>
              <strong style={{ color: INK }}>Connected to: </strong>
              {brief.neighbours.join(" · ")}
            </div>
          ) : (
            <div
              data-testid="blanko-insights-node-orphan"
              style={{
                fontSize: 12,
                color: BAD,
                marginBottom: 8,
                lineHeight: 1.4,
                fontWeight: 600,
              }}
            >
              No edges on this piece — scan modules sit alone until you Apply the trading spine.
            </div>
          )}

          {brief.providers.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...monoLabel, marginBottom: 6 }}>Providers</div>
              {brief.providers.map((p) => (
                <div
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
                >
                  <ProviderIcon providerId={p.id} size={16} />
                  <span style={{ fontSize: 13, color: INK, flex: 1 }}>{p.id}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: GOOD }}>{p.status}</span>
                </div>
              ))}
            </div>
          ) : null}

          {brief.files.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...monoLabel, marginBottom: 6 }}>Bound files</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, fontFamily: FONT_MONO, color: INK }}>
                {brief.files.map((f) => (
                  <li key={f} style={{ marginBottom: 2 }}>
                    {onOpenFile ? (
                      <button type="button" onClick={() => onOpenFile(f)} style={fileLink}>
                        {f}
                      </button>
                    ) : (
                      f
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {brief.tools.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...monoLabel, marginBottom: 6 }}>Tools</div>
              <div style={{ fontSize: 12, color: INK, lineHeight: 1.4 }}>
                {brief.tools.map((t) => t.name).join(" · ")}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: SLATE }}>
                Full catalog → {configLink("agents", "Config · Agents")}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 8, lineHeight: 1.4 }}>
              No tools listed on this piece. Surfaces &amp; tool catalogs live in{" "}
              {configLink("agents", "Config · Agents")}.
            </div>
          )}

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
              {editOpen ? "Hide details" : "Edit / bind"}
            </button>
          </div>

          <div
            data-testid="blanko-insights-config-hints"
            style={{
              fontSize: 11,
              color: SLATE,
              lineHeight: 1.5,
              marginBottom: 10,
              padding: 8,
              borderRadius: 8,
              border: `1px dashed ${LINE}`,
            }}
          >
            <strong style={{ color: INK }}>Also in Config: </strong>
            {configLink("flow", "Flow")} · {configLink("usage", "Usage")} ·{" "}
            {configLink("platforms", "Platforms")}
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
        <>
          <div style={{ ...monoLabel, marginBottom: 6 }}>Architecture</div>
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
            {archText}
          </div>

          {showApplyTradingSpine && onApplyTradingSpine ? (
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
                Scan modules ≠ money workflow
              </div>
              <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 10 }}>
                Trading Chat alone has no Policy/Risk/Execution edges. Apply the locked spine so ingress
                connects Identity → Agent → Strategy → Policy → Risk → Execution → Alpaca/Kraken.
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

          {orphans.length > 0 && !showApplyTradingSpine ? (
            <div
              data-testid="blanko-insights-orphan-warn"
              style={{
                fontSize: 12,
                color: WARN,
                marginBottom: 12,
                lineHeight: 1.4,
              }}
            >
              Orphan presentation pieces: {orphans.map((n) => n.label).join(", ")}. Wire them or re-apply
              the spine.
            </div>
          ) : null}

          <div style={{ ...monoLabel, marginBottom: 8 }}>Workflow · money path</div>
          <div data-testid="blanko-insights-workflow" style={{ marginBottom: 14 }}>
            {hops.length === 0 ? (
              <div style={{ fontSize: 12, color: SLATE }}>No workflow hops yet.</div>
            ) : (
              hops.map((h) => (
                <div
                  key={h.id}
                  data-testid={`blanko-workflow-hop-${h.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: `1px solid ${LINE}`,
                    fontSize: 12,
                  }}
                >
                  <span style={{ flex: 1, color: INK, fontWeight: 600 }}>{h.label}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: SLATE }}>
                    {h.buildStatus}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: h.degree === 0 ? BAD : GOOD,
                    }}
                  >
                    {h.degree === 0 ? "no edges" : `${h.degree} edges`}
                  </span>
                </div>
              ))
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: SLATE }}>
              Path + Tasks board → {configLink("flow", "Config · Flow")}
            </div>
          </div>

          <div style={{ ...monoLabel, marginBottom: 8 }}>Tools · surfaces</div>
          <div data-testid="blanko-insights-tools" style={{ marginBottom: 14, fontSize: 12, color: INK, lineHeight: 1.45 }}>
            {tools.length === 0 ? (
              <span style={{ color: SLATE }}>
                No tool catalog on this graph yet (rescan after agent inventory, or open{" "}
                {configLink("agents", "Config · Agents")}).
              </span>
            ) : (
              <>
                {tools.map((t) => t.name).join(" · ")}
                <div style={{ marginTop: 6, fontSize: 11, color: SLATE }}>
                  Full list → {configLink("agents", "Config · Agents")}
                </div>
              </>
            )}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={monoLabel}>{nodeMode ? "Findings on this piece" : "Design findings"}</div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: SLATE }}>
          score <span style={{ color: INK, fontWeight: 700 }}>{score}</span>
        </div>
      </div>

      {nodeFindings.length === 0 ? (
        <div style={{ fontSize: 13, color: SLATE, marginBottom: 16, lineHeight: 1.45 }}>
          {nodeMode
            ? "No design findings on this piece."
            : "No blockers — watch Platforms and Workflow for cost/risk gaps."}
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
          <div style={{ ...monoLabel, marginTop: 18, marginBottom: 8 }}>Platforms · this board</div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 10, lineHeight: 1.4 }}>{platHeadline}</div>
          {inventory.length === 0 ? (
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
              Nothing bound yet. After Apply spine you should see Alpaca / Kraken here.
            </div>
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
                    color:
                      row.status === "connected"
                        ? GOOD
                        : row.status === "missing_credentials"
                          ? WARN
                          : SLATE,
                  }}
                >
                  {row.status}
                </span>
              </div>
            ))
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: SLATE, marginBottom: 12 }}>
            Bind / credentials UI → {configLink("platforms", "Config · Platforms")}
          </div>

          <div style={{ ...monoLabel, marginTop: 8, marginBottom: 8 }}>Usage · burn (30d)</div>
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
            {usage ? (
              <div style={{ color: INK }}>
                <strong>{cents(usage.costCents)}</strong> · {usage.promptTokens + usage.completionTokens}{" "}
                tokens · {usage.eventCount} events
              </div>
            ) : (
              usageNote || "No burn data yet."
            )}
            <div style={{ marginTop: 8 }}>
              Budgets &amp; by-node burn → {configLink("usage", "Config · Usage")}
            </div>
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

const linkBtn = {
  border: "none",
  background: "none",
  padding: 0,
  color: ACCENT,
  fontWeight: 700,
  fontSize: "inherit",
  cursor: "pointer",
  fontFamily: FONT_UI,
};

const fileLink = {
  ...linkBtn,
  fontFamily: FONT_MONO,
  fontSize: 11,
  fontWeight: 500,
  color: INK,
  textAlign: "left" as const,
};
