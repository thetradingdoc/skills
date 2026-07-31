/**
 * Fixed-layout Agents view — derived from scan inventory only.
 * No drag, no persisted positions, no layout engine.
 * Does not touch the module graph canvas.
 */
import { useMemo, useState, type ReactNode } from "react";
import type { AgentInventoryResult, AgentSurface } from "./types";

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
        border: selected ? "1px solid #58a6ff" : "1px solid #30363d",
        background: selected ? "rgba(29,78,216,0.18)" : "rgba(6,12,26,0.85)",
        color: "#e6edf3",
        cursor: "pointer",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "#f3f4f6" }}>
        {fileName(surface.file)}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "#8b949e",
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 12px",
        }}
      >
        <span>{surface.provider}</span>
        <span>{surface.model ?? "model unknown"}</span>
        <span>{surface.loopKind ?? "—"}</span>
        <span>
          {toolCount} tool{toolCount === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: "#7d8590" }}>{surface.file}</div>
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
        border: "1px solid #30363d",
        background: "rgba(17,24,39,0.9)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        minWidth: 180,
        maxWidth: 280,
      }}
    >
      <div style={{ fontSize: 12, color: "#58a6ff", fontWeight: 600 }}>{name}</div>
      {handler && (
        <button
          type="button"
          disabled={!onOpenFile || !target}
          title={onOpenFile ? "Open " + handler : handler}
          onClick={() => target && onOpenFile?.(target.path, target.line)}
          style={{
            marginTop: 4,
            fontSize: 10,
            color: onOpenFile ? "#58a6ff" : "#8b949e",
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
        <div style={{ marginTop: 4, fontSize: 10, color: "#7d8590" }}>{note}</div>
      )}
      {!handler && !note && (
        <div style={{ marginTop: 4, fontSize: 10, color: "#4b5563" }}>handler unresolved</div>
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
          color: "#e6edf3",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          cursor: "pointer",
          padding: "4px 0",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ color: "#7d8590" }}>{open ? "▼" : "▶"}</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

export default function AgentsView({ agents, onOpenFile }: Props) {
  const surfaces = agents?.agents ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { agentSurfaces, helpers, unknowns } = useMemo(() => {
    const agentSurfaces: AgentSurface[] = [];
    const helpers: AgentSurface[] = [];
    const unknowns: AgentSurface[] = [];
    for (const s of surfaces) {
      const kind = s.kind ?? (s.tools?.length || s.toolCandidates?.length ? "agent" : "helper");
      if (kind === "agent") agentSurfaces.push(s);
      else if (kind === "unknown") unknowns.push(s);
      else helpers.push(s);
    }
    agentSurfaces.sort((a, b) => a.file.localeCompare(b.file));
    helpers.sort((a, b) => a.file.localeCompare(b.file));
    unknowns.sort((a, b) => a.file.localeCompare(b.file));
    return { agentSurfaces, helpers, unknowns };
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
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#e6edf3",
          background: "rgba(6,12,26,0.4)",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "#f3f4f6", fontWeight: 600 }}>
          No agents found
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#8b949e", maxWidth: 520, lineHeight: 1.5 }}>
          This scan did not find any model-client surfaces. The inventory looks for declared
          package.json SDKs intersecting a known list, plus HTTP calls to openai / anthropic /
          groq / retell.
        </p>
        {searched.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: "#7d8590", marginBottom: 8 }}>Searched for:</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#8b949e", lineHeight: 1.7 }}>
              {searched.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {searched.length === 0 && (
          <p style={{ fontSize: 12, color: "#7d8590" }}>
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
        background: "rgba(6,12,26,0.35)",
      }}
    >
      <div
        style={{
          width: 340,
          flexShrink: 0,
          overflow: "auto",
          padding: "20px 16px 40px",
          borderRight: "1px solid #30363d",
        }}
      >
        <div style={{ fontSize: 11, color: "#7d8590", marginBottom: 12, letterSpacing: 0.04 }}>
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
          <p style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.5 }}>
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
                  border: "1px solid #21262d",
                  background: "rgba(6,12,26,0.5)",
                  fontSize: 11,
                  color: "#8b949e",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <div style={{ color: "#e6edf3" }}>{fileName(h.file)}</div>
                <div style={{ marginTop: 2, color: "#7d8590" }}>
                  {h.provider}
                  {h.model ? ` · ${h.model}` : ""}
                </div>
                <div style={{ marginTop: 2, color: "#4b5563", fontSize: 10 }}>{h.kindSignal}</div>
              </div>
            ))}
            {helpers.length === 0 && (
              <div style={{ fontSize: 11, color: "#4b5563" }}>None</div>
            )}
          </div>
        </CollapsibleGroup>

        <div style={{ marginTop: 20 }}>
          <div
            style={{
              color: "#e6edf3",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
                  border: "1px solid #3f3f1a",
                  background: "rgba(40,40,10,0.35)",
                  fontSize: 11,
                  color: "#e6edf3",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <div style={{ fontWeight: 600 }}>{fileName(u.file)}</div>
                <div style={{ marginTop: 4, color: "#a3a3a3", fontSize: 10, lineHeight: 1.4 }}>
                  {u.kindSignal}
                </div>
              </div>
            ))}
            {unknowns.length === 0 && (
              <div style={{ fontSize: 11, color: "#4b5563" }}>None</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 40px" }}>
        {!selected && (
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              color: "#7d8590",
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
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 16, color: "#f3f4f6", fontWeight: 600 }}>
                {fileName(selected.file)}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#8b949e" }}>
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
                <div style={{ fontSize: 12, color: "#7d8590" }}>No tools extracted.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
