import { useState, type CSSProperties } from "react";
import type { ArchEdge, ArchNode, EdgeRelation, NodeLayer } from "./types";
import { DESIGN_PALETTE, EDGE_RELATIONS, relationLabel } from "./greenfieldDesign";
import { getDesignKnowledge, RELATION_KNOWLEDGE } from "./designKnowledge";
import { PROVIDER_CATALOG, type BindingStatus } from "./providerCatalog";
import { ProviderIcon } from "./ProviderIcon";
import { primaryBinding, setNodeProviderBinding } from "./platformInventory";
import { isAgentNode } from "./llmopsDrift";
import { schemaForNode, type PropertyField } from "./nodePropertySchemas";
import { ACCENT, BAD, CANVAS, FONT_MONO, FONT_UI, INK, LINE, PAPER, SLATE } from "./theme/tokens";

const LAYERS: Array<NodeLayer | string> = [
  "Presentation",
  "Orchestration",
  "Reasoning",
  "Business Logic",
  "Memory",
  "Evaluation",
  "Safety",
  "Data Access",
  "External Services",
  "Infrastructure",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

type NodeProps = {
  mode: "node";
  node: ArchNode;
  onChange: (
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
  onDelete: () => void;
  onClose: () => void;
  /** Create + connect this node's typical neighbours that aren't already present. */
  onAddNeighbours?: () => void;
  /** P6: when present alongside accessToken, prompt/config ref edits also PUT to llmops-ref. */
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  /** overlay = floating canvas card; embedded = content only (no chrome). */
  variant?: "overlay" | "embedded";
};

type EdgeProps = {
  mode: "edge";
  edge: ArchEdge;
  sourceLabel?: string;
  targetLabel?: string;
  onChange: (patch: { relation?: EdgeRelation }) => void;
  onDelete: () => void;
  onClose: () => void;
  variant?: "overlay" | "embedded";
};

type Props = NodeProps | EdgeProps;

const field: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: PAPER,
  border: `1px solid ${LINE}`,
  borderRadius: 8,
  color: INK,
  fontSize: 12,
  boxSizing: "border-box",
  marginBottom: 8,
  fontFamily: FONT_UI,
  transition: "border-color 120ms ease, box-shadow 120ms ease",
};

const sectionLabel: CSSProperties = {
  fontSize: 9,
  color: SLATE,
  textTransform: "uppercase",
  letterSpacing: 0.06,
  marginBottom: 3,
  fontFamily: FONT_MONO,
};

const sectionText: CSSProperties = {
  fontSize: 12,
  color: INK,
  lineHeight: 1.5,
  marginBottom: 10,
  fontFamily: FONT_UI,
};

function paletteLabelFor(paletteId: string): string {
  return DESIGN_PALETTE.find((p) => p.id === paletteId)?.label ?? paletteId;
}

function PlatformBindingFields({ node, onChange }: Pick<NodeProps, "node" | "onChange">) {
  const binding = primaryBinding(node);
  const currentProviderId = binding?.providerId ?? "";

  const applyBinding = (providerId: string | null, opts?: { accountLabel?: string; status?: BindingStatus }) => {
    const next = setNodeProviderBinding(node, providerId, {
      accountLabel: opts?.accountLabel ?? binding?.accountLabel,
      status: opts?.status ?? binding?.status,
    });
    onChange({
      platformBindings: next.platformBindings,
      llmProvider: next.llmProvider,
      cloudProvider: next.cloudProvider,
    });
  };

  return (
    <>
      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Platform binding</label>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {currentProviderId && <ProviderIcon providerId={currentProviderId} size={16} />}
        <select
          data-testid="design-inspect-provider"
          value={currentProviderId}
          onChange={(e) => applyBinding(e.target.value || null)}
          style={{ ...field, marginBottom: 0, flex: 1 }}
        >
          <option value="">None</option>
          {PROVIDER_CATALOG.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {currentProviderId && (
        <>
          <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>
            Account / project label
          </label>
          <input
            data-testid="design-inspect-provider-account"
            value={binding?.accountLabel ?? ""}
            onChange={(e) => applyBinding(currentProviderId, { accountLabel: e.target.value })}
            placeholder="e.g. prod-us-east"
            style={field}
          />

          <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Status</label>
          <select
            data-testid="design-inspect-provider-status"
            value={binding?.status ?? "connected"}
            onChange={(e) => applyBinding(currentProviderId, { status: e.target.value as BindingStatus })}
            style={field}
          >
            <option value="connected">Connected</option>
            <option value="missing_credentials">Missing credentials</option>
            <option value="unknown">Unknown</option>
          </select>
        </>
      )}
    </>
  );
}

function LlmopsRefFields({
  node,
  onChange,
  workspaceId,
  accessToken,
  apiBase,
}: Pick<NodeProps, "node" | "onChange" | "workspaceId" | "accessToken" | "apiBase">) {
  const promptRef = node.llmops?.promptRef ?? "";
  const configRef = node.llmops?.configRef ?? "";

  const syncToServer = (next: { promptRef?: string; configRef?: string }) => {
    if (!workspaceId || !accessToken || !apiBase) return;
    fetch(
      `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(node.id)}/llmops-ref`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          promptRef: next.promptRef ?? node.llmops?.promptRef ?? null,
          configRef: next.configRef ?? node.llmops?.configRef ?? null,
          memoryNodeId: node.llmops?.memoryNodeId ?? null,
          evalNodeId: node.llmops?.evalNodeId ?? null,
        }),
      }
    ).catch(() => {
      /* best-effort — local graph is the source of truth for design mode */
    });
  };

  return (
    <>
      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Prompt ref</label>
      <input
        data-testid="design-inspect-prompt-ref"
        value={promptRef}
        onChange={(e) => onChange({ llmops: { ...node.llmops, promptRef: e.target.value } })}
        onBlur={(e) => syncToServer({ promptRef: e.target.value })}
        placeholder="e.g. prompts/support-agent@v3"
        style={field}
      />

      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Config ref</label>
      <input
        data-testid="design-inspect-config-ref"
        value={configRef}
        onChange={(e) => onChange({ llmops: { ...node.llmops, configRef: e.target.value } })}
        onBlur={(e) => syncToServer({ configRef: e.target.value })}
        placeholder="e.g. configs/support-agent.yaml"
        style={field}
      />
    </>
  );
}

function PropertyFieldInput({
  fieldDef,
  node,
  onChange,
}: {
  fieldDef: PropertyField;
  node: ArchNode;
  onChange: NodeProps["onChange"];
}) {
  const raw = node.properties?.[fieldDef.key];
  const testId = `design-inspect-prop-${fieldDef.key}`;

  const setValue = (value: string | number | boolean | null) => {
    onChange({ properties: { ...node.properties, [fieldDef.key]: value } });
  };

  if (fieldDef.type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: INK, marginBottom: 8 }}>
        <input
          type="checkbox"
          data-testid={testId}
          checked={Boolean(raw ?? fieldDef.defaultValue ?? false)}
          onChange={(e) => setValue(e.target.checked)}
        />
        {fieldDef.label}
      </label>
    );
  }

  if (fieldDef.type === "enum") {
    const value = (raw as string) ?? (fieldDef.defaultValue as string) ?? "";
    return (
      <>
        <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>{fieldDef.label}</label>
        <select data-testid={testId} value={value} onChange={(e) => setValue(e.target.value)} style={field}>
          {(fieldDef.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </>
    );
  }

  if (fieldDef.type === "number") {
    const value = raw === null || raw === undefined ? "" : String(raw);
    return (
      <>
        <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>{fieldDef.label}</label>
        <input
          type="number"
          data-testid={testId}
          value={value}
          placeholder={fieldDef.placeholder}
          onChange={(e) => setValue(e.target.value === "" ? null : Number(e.target.value))}
          style={field}
        />
      </>
    );
  }

  const value = raw === null || raw === undefined ? "" : String(raw);
  return (
    <>
      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>{fieldDef.label}</label>
      <input
        data-testid={testId}
        value={value}
        placeholder={fieldDef.placeholder}
        onChange={(e) => setValue(e.target.value)}
        style={field}
      />
    </>
  );
}

function NodePropertiesFields({ node, onChange }: Pick<NodeProps, "node" | "onChange">) {
  const schema = schemaForNode(node);
  if (schema.fields.length === 0) return null;

  return (
    <div data-testid="design-inspect-properties">
      <div style={sectionLabel}>Properties</div>
      {schema.fields.map((fieldDef) => (
        <div key={fieldDef.key}>
          <PropertyFieldInput fieldDef={fieldDef} node={node} onChange={onChange} />
        </div>
      ))}
    </div>
  );
}

function NodeExplainPanel({ node, onChange, onDelete, onAddNeighbours, workspaceId, accessToken, apiBase }: NodeProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const knowledge = getDesignKnowledge(node);
  const neighbourLabels = knowledge?.typicalNeighbours.map(paletteLabelFor) ?? [];

  return (
    <>
      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Label</label>
      <input
        data-testid="design-inspect-label"
        value={node.label}
        onChange={(e) => onChange({ label: e.target.value })}
        style={field}
      />

      {node.deployHealth && (
        <div
          data-testid="design-inspect-deploy-health-chip"
          data-status={node.deployHealth.status}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            fontFamily: "monospace",
            color:
              node.deployHealth.status === "failed"
                ? BAD
                : node.deployHealth.status === "degraded"
                  ? "#d29922"
                  : node.deployHealth.status === "healthy"
                    ? "#3fb950"
                    : "#6e7681",
            border: `1px solid ${
              node.deployHealth.status === "failed"
                ? "rgba(220,38,38,0.25)"
                : node.deployHealth.status === "degraded"
                  ? "#d2992255"
                  : node.deployHealth.status === "healthy"
                    ? "#3fb95055"
                    : "#6e768155"
            }`,
            borderRadius: 999,
            padding: "2px 8px",
            textTransform: "uppercase",
            letterSpacing: 0.04,
            marginBottom: 10,
          }}
          title={node.deployHealth.summary}
        >
          Deploy: {node.deployHealth.status}
        </div>
      )}

      {knowledge ? (
        <div data-testid="blanko-teach-card">
          <div style={{ ...sectionLabel, color: "#ef32a6" }}>Teach</div>
          <div style={sectionLabel}>What this is</div>
          <div style={sectionText}>{knowledge.explanation}</div>

          <div style={sectionLabel}>Why it's here</div>
          <div style={sectionText}>{knowledge.whyHere}</div>

          {neighbourLabels.length > 0 && (
            <>
              <div style={sectionLabel}>Usually connects to</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {neighbourLabels.map((label) => (
                  <span
                    key={label}
                    style={{
                      fontSize: 10,
                      padding: "3px 8px",
                      borderRadius: 999,
                      background: "rgba(239,50,166,0.08)",
                      border: "1px solid #ef32a644",
                      color: "#ef32a6",
                      fontFamily: "monospace",
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              {onAddNeighbours && (
                <button
                  type="button"
                  data-testid="design-inspect-add-neighbours"
                  onClick={onAddNeighbours}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    marginBottom: 10,
                    background: "rgba(239,50,166,0.08)",
                    border: "1px solid #ef32a655",
                    borderRadius: 6,
                    color: "#ef32a6",
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  + Add usual neighbours
                </button>
              )}
            </>
          )}

          <div style={sectionLabel}>What breaks without it</div>
          <div style={sectionText}>{knowledge.breaksWithout}</div>

          <div style={sectionLabel}>Real technologies</div>
          <div style={{ fontSize: 11, color: SLATE, marginBottom: 10, lineHeight: 1.5 }}>
            {knowledge.realTechnologies.join(" · ")}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#6e7681", marginBottom: 10, lineHeight: 1.5 }}>
          No canned explanation for this component yet — describe it in the notes below.
        </div>
      )}

      <NodePropertiesFields node={node} onChange={onChange} />

      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Notes</label>
      <textarea
        data-testid="design-inspect-notes"
        value={node.description ?? ""}
        onChange={(e) => onChange({ description: e.target.value })}
        rows={3}
        style={{ ...field, resize: "vertical" }}
      />

      <button
        type="button"
        data-testid="design-inspect-advanced-toggle"
        onClick={() => setAdvancedOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "6px 10px",
          marginBottom: advancedOpen ? 8 : 10,
          background: "none",
          border: "1px solid #30363d",
          borderRadius: 6,
          color: SLATE,
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "monospace",
          textAlign: "left",
        }}
      >
        {advancedOpen ? "▾" : "▸"} Advanced
      </button>
      {advancedOpen && (
        <>
          <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Type / layer</label>
          <select
            data-testid="design-inspect-layer"
            value={(node.layer as string) ?? knowledge?.defaultLayer ?? "Uncategorized"}
            onChange={(e) => onChange({ layer: e.target.value })}
            style={field}
          >
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <PlatformBindingFields node={node} onChange={onChange} />

          {isAgentNode(node) && (
            <LlmopsRefFields
              node={node}
              onChange={onChange}
              workspaceId={workspaceId}
              accessToken={accessToken}
              apiBase={apiBase}
            />
          )}
        </>
      )}

      <button
        type="button"
        data-testid="design-inspect-delete"
        onClick={onDelete}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: "rgba(220,38,38,0.06)",
          border: `1px solid ${BAD}`,
          borderRadius: 8,
          color: BAD,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: FONT_UI,
          fontWeight: 600,
        }}
      >
        Delete node
      </button>
    </>
  );
}

function EdgeExplainPanel(props: EdgeProps) {
  const relation = props.edge.relation ?? "calls";
  const knowledge = RELATION_KNOWLEDGE[relation];

  return (
    <>
      <div style={{ fontSize: 11, color: SLATE, marginBottom: 8, fontFamily: "monospace" }}>
        {(props.sourceLabel ?? props.edge.source) + " → " + (props.targetLabel ?? props.edge.target)}
      </div>
      <label style={{ fontSize: 10, color: SLATE, display: "block", marginBottom: 4 }}>Relation</label>
      <select
        data-testid="design-inspect-relation"
        value={relation}
        onChange={(e) => props.onChange({ relation: e.target.value as EdgeRelation })}
        style={field}
      >
        {EDGE_RELATIONS.map((r) => (
          <option key={r} value={r}>
            {relationLabel(r)}
          </option>
        ))}
      </select>

      {knowledge && (
        <>
          <div style={sectionLabel}>What this means</div>
          <div style={sectionText}>{knowledge.meaning}</div>

          <div style={sectionLabel}>What breaks if this is wrong</div>
          <div style={sectionText}>{knowledge.failureMode}</div>
        </>
      )}

      <button
        type="button"
        data-testid="design-inspect-delete-edge"
        onClick={props.onDelete}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: "rgba(220,38,38,0.06)",
          border: `1px solid ${BAD}`,
          borderRadius: 8,
          color: BAD,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: FONT_UI,
          fontWeight: 600,
        }}
      >
        Delete edge
      </button>
    </>
  );
}

export function DesignInspectPanel(props: Props) {
  const variant = props.variant ?? "overlay";
  if (variant === "embedded") {
    return (
      <div data-testid="design-inspect" data-variant="embedded" style={{ padding: 4, fontFamily: FONT_UI }}>
        {props.mode === "node" ? <NodeExplainPanel {...props} /> : <EdgeExplainPanel {...props} />}
      </div>
    );
  }

  return (
    <div
      data-testid="design-inspect"
      data-variant="overlay"
      style={{
        position: "absolute",
        /* Sit above chat, lower on the canvas — not top-right over chrome */
        right: 88,
        bottom: 100,
        top: "auto",
        width: 320,
        maxHeight: "min(52vh, 480px)",
        overflowY: "auto",
        zIndex: 27,
        background: CANVAS,
        border: `1px solid ${LINE}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 16px 48px rgba(18,19,26,0.14), 0 2px 8px rgba(18,19,26,0.04)",
        fontFamily: FONT_UI,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>
          {props.mode === "edge" ? "Edge" : "Inspect"}
        </div>
        <button
          type="button"
          data-testid="design-inspect-close"
          onClick={props.onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: `1px solid ${LINE}`,
            background: CANVAS,
            color: SLATE,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          height: 2,
          borderRadius: 2,
          background: ACCENT,
          marginBottom: 12,
          opacity: 0.85,
        }}
      />

      {props.mode === "node" ? <NodeExplainPanel {...props} /> : <EdgeExplainPanel {...props} />}
    </div>
  );
}
