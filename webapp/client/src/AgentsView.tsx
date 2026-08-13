/**
 * Fixed-layout Agents view — derived from scan inventory only.
 * No drag, no persisted positions, no layout engine.
 * Does not touch the module graph canvas.
 */
import { useMemo, useState, type ReactNode } from "react";
import type { AgentInventoryResult, AgentSurface } from "./types";
import { ProviderIcon } from "./ProviderIcon";
import { getProvider } from "./providerCatalog";
import {
  INK,
  SLATE,
  LINE,
  CANVAS,
  PAPER,
  ACCENT,
  FONT_MONO,
  FONT_UI,
} from "./theme/tokens";

type Props = {
  agents: AgentInventoryResult | undefined;
  /** Open a file at a line. A tool declaration site is the most precise link
   *  in this app and was previously text you had to copy by hand. */
  onOpenFile?: (path: string, line?: number) => void;
};

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

function AgentCard({
  surface,
  selected,
  onSelect,
}: {
  surface: AgentSurface;
  selected: boolean;
  onSelect: () => void;
}) {
  const toolCount = surface.tools?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 10,
        border: selected ? `1px solid ${ACCENT}` : `1px solid ${LINE}`,
        background: selected ? "rgba(239, 50, 166, 0.08)" : CANVAS,
        color: INK,
        cursor: "pointer",
        fontFamily: FONT_UI,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>
        {fileName(surface.file)}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: SLATE,
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 12px",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {getProvider(surface.provider) && <ProviderIcon providerId={surface.provider} size={12} />}
          {surface.provider}
        </span>
        <span>{surface.model ?? "model unknown"}</span>
        <span>{surface.loopKind ?? "—"}</span>
        <span>
          {toolCount} tool{toolCount === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: SLATE }}>{surface.file}</div>
    </button>
  );
}

function ToolCard({
  name,
  handler,
  note,
  onOpenFile,
}: {
  name: string;
  handler: string | null;
  note?: string;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  // handler is "path/to/file.js:981" — the most precise link in the app, and
  // until now it was text you had to copy into an editor by hand.
  const target = (() => {
    if (!handler) return null;
    const m = handler.match(/^(.*?):(\d+)$/);
    return m ? { path: m[1], line: Number(m[2]) } : { pa: handler };
  })();
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${LINE}`,
        background: CANVAS,
        fontFamily: FONT_MONO,
        minWidth: 180,
        maxWidth: 280,
      }}
    >
      <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>{name}</div>
      {handler && (
        <button
          type="button"
          disabled={!onOpenFile || !target}
          title={onOpenFile ? "Open " + handler : handler}
          onClick={() => target && onOpenFile?.(target.path, target.line)}
          style={{
            marginTop: 4,
            fontSize: 10,
            color: onOpenFile ? ACCENT : SLATE,
            wordBreak: "break-all",
            background: "none",
            border: 0,
            padding: 0,
            textAlign: "left",
            cursor: onOpenFile ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          {handler}
        </button>
      )}
      {!handler && note && (
        <div style={{ marginTop: 4, fontSize: 10, color: SLATE }}>{note}</div>
      )}
      {!handler && !note && (
        <div style={{ marginTop: 4, fontSize: 10, color: SLATE }}>handler unresolved</div>
      )}
    </div>
  );
}

function CollapsibleGroup({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 20 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          border: "none",
          color: INK,
          fontFamily: FONT_MONO,
          fontSize: 12,
          cursor: "pointer",
          padding: "4px 0",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ color: SLATE }}>{open ? "▼" : "▶"}</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

export default function AgentsView({ agents, onOpenFile }: Props) {
  const surfaces = agents?.agents ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { agentSurfaces, helpers, infra, unknowns } = useMemo(() => {
    const agentSurfaces: AgentSurface[] = [];
    const helpers: AgentSurface[] = [];
    // Its own bucket. A shared router is what everything depends on, and folding
    // it in with one-shot helpers hides the one file whose failure is total.
    const infra: AgentSurface[] = [];
    const unknowns: AgentSurface[] = [];
    for (const s of surfaces) {
      const kind = s.kind ?? (s.tools?.length || s.toolCandidates?.length ? "agent" : "helper");
      if (kind === "agent") agentSurfaces.push(s);
      else if (kind === "infrastructure") infra.push(s);
      else if (kind === "unknown") unknowns.push(s);
      else helpers.push(s);
    }
    agentSurfaces.sort((a, b) => a.file.localeCompare(b.file));
    helpers.sort((a, b) => a.file.localeCompare(b.file));
    unknowns.sort((a, b) => a.file.localeCompare(b.file));
    infra.sort((a, b) => a.file.localeCompare(b.file));
    return { agentSurfaces, helpers, infra, unknowns };
  }, [surfaces]);

  const selected = agentSurfaces.find((a) => a.file === selectedFile) ?? null;

  if (!agents || surfaces.length === 0) {
    const searched = agents?.searchedFor ?? [];
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 32,
          overflow: "auto",
          fontFamily: FONT_MONO,
          color: INK,
          background: PAPER,
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, color: INK, fontWeight: 600 }}>
          No agents found
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: SLATE, maxWidth: 520, lineHeight: 1.5 }}>
          This scan did not find any model-client surfaces. The inventory looks for declared
          package.json SDKs intersecting a known list, plus HTTP calls to openai / anthropic /
          groq / retell.
        </p>
        {searched.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: SLATE, marginBottom: 8 }}>Searched for:</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: SLATE, lineHeight: 1.7 }}>
              {searched.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {searched.length === 0 && (
          <p style={{ fontSize: 12, color: SLATE }}>
            No inventory payload on this graph — re-scan the repo to populate agents.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        overflow: "hidden",
        background: PAPER,
      }}
    >
      <div
        style={{
          width: 340,
          flexShrink: 0,
          overflow: "auto",
          padding: "20px 16px 40px",
          borderRight: `1px solid ${LINE}`,
        }}
      >
        <div style={{ fontSize: 11, color: SLATE, marginBottom: 12, letterSpacing: 0.04 }}>
          AGENTS — {agentSurfaces.length}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {agentSurfaces.map((a) => (
            <AgentCard
              key={a.file}
              surface={a}
              selected={selectedFile === a.file}
              onSelect={() => setSelectedFile((f) => (f === a.file ? null : a.file))}
            />
          ))}
        </div>
        {agentSurfaces.length === 0 && (
          <p style={{ fontSize: 12, color: SLATE, lineHeight: 1.5 }}>
            No kind=agent surfaces. Helpers and unknowns are listed below.
          </p>
        )}

        <CollapsibleGroup
          title={`LLM helpers — no tools, no reach (${helpers.length})`}
          defaultOpen={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {helpers.map((h) => (
              <div
                key={h.file}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${LINE}`,
                  background: CANVAS,
                  fontSize: 11,
                  color: SLATE,
                  fontFamily: FONT_MONO,
                }}
              >
                <div style={{ color: INK }}>{fileName(h.file)}</div>
                <div style={{ marginTop: 2, color: SLATE }}>
                  {h.provider}
                  {h.model ? ` · ${h.model}` : ""}
                </div>
                <div style={{ marginTop: 2, color: SLATE, fontSize: 10 }}>{h.kindSignal}</div>
              </div>
            ))}
            {helpers.length === 0 && (
              <div style={{ fontSize: 11, color: SLATE }}>None</div>
            )}
          </div>
        </CollapsibleGroup>

        {infra.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                color: INK,
                fontFamily: FONT_MONO,
                fontSize: 12,
                padding: "4px 0",
              }}
            >
              Infrastructure — everything depends on these ({infra.length})
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {infra.map((i) => (
                <div
                  key={i.file}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${LINE}`,
                    background: PAPER,
                    fontSize: 11,
                    color: INK,
                    fontFamily: FONT_MONO,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{fileName(i.file)}</div>
                  <div style={{ marginTop: 4, color: SLATE, fontSize: 10, lineHeight: 1.4 }}>
                    {i.kindSignal}
                  </div>
                </div>
            ))}
            </div>
          </div>
        )}

        {unknowns.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              color: INK,
              fontFamily: FONT_MONO,
              fontSize: 12,
              padding: "4px 0",
            }}
          >
            Unknown — needs a human decision ({unknowns.length})
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {unknowns.map((u) => (
              <div
                key={u.file}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${LINE}`,
                  background: PAPER,
                  fontSize: 11,
                  color: INK,
                  fontFamily: FONT_MONO,
                }}
              >
                <div style={{ fontWeight: 600 }}>{fileName(u.file)}</div>
                <div style={{ marginTop: 4, color: "#a3a3a3", fontSize: 10, lineHeight: 1.4 }}>
                  {u.kindSignal}
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 40px" }}>
        {!selected && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 13,
              color: SLATE,
              marginTop: 8,
            }}
          >
            Select an agent to expand its tools.
          </div>
        )}
        {selected && (
          <>
            <div
              style={{
                fontFamily: FONT_MONO,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 16, color: INK, fontWeight: 600 }}>
                {fileName(selected.file)}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: SLATE }}>
                {selected.kindSignal}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignContent: "flex-start",
              }}
            >
              {(selected.tools ?? []).map((t) => (
                <ToolCard
                  key={t.name + (t.handler ?? "")}
                  name={t.name}
                  handler={t.handler}
                  note={t.note}
                  onOpenFile={onOpenFile}
                />
              ))}
              {(selected.tools?.length ?? 0) === 0 && (
                <div style={{ fontSize: 12, color: SLATE }}>No tools extracted.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
