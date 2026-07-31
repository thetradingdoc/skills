/**
 * A way to reach the files.
 *
 * Every view in this tool names files — agents, tools with line numbers, Guard
 * evidence, components in a layer — and until now none of them opened one. The
 * only route to source was clicking a node in the 2D module graph, which is the
 * view least concerned with agents.
 *
 * Grouping matters more than an alphabetical list would suggest. A repository
 * this size is mostly files you will never open; the eight that run agents are
 * what you came for. So agents lead and are open by default, and everything
 * else is there when you want it rather than in the way.
 */
import { useMemo, useState } from "react";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Props = {
  graph?: any;
  openPath?: string | null;
  onOpen: (path: string, line?: number) => void;
};

type Entry = {
  path: string;
  name: string;
  /** Shown to the right — tool count, reach, whatever the group cares about. */
  note?: string;
  /** Red when this file is somewhere a change would matter most. */
  alarm?: boolean;
};

type Group = {
  key: string;
  label: string;
  entries: Entry[];
  openByDefault: boolean;
  /** Why this group exists, for the moment it is empty. */
  emptyNote?: string;
};

const fileName = (p: string): string => p.split(/[/\\]/).pop() || p;

function buildGroups(graph: any): Group[] {
  const inv = graph?.agents;
  const surfaces: any[] = inv?.agents ?? [];
  const catalogs: Record<string, any[]> = inv?.toolCatalogs ?? {};

  const toolsOf = (a: any): any[] =>
    Array.isArray(a.tools) && a.tools.length
      ? a.tools
      : a.catalogId
        ? (catalogs[a.catalogId] ?? [])
        : [];

  const agents = surfaces
    .filter((a) => a.kind === "agent")
    .map((a): Entry => {
      const tools = toolsOf(a);
      const sensitive = tools.some(
        (t: any) =>
          t?.reach?.cells?.patient?.state === "reaches" ||
          t?.reach?.cells?.money?.state === "reaches"
      );
      const noAuth = !a.auth?.found;
      return {
        path: a.file,
        name: fileName(a.file),
        note:
          tools.length +
          " tools" +
          (sensitive && noAuth ? " · no auth" : ""),
        alarm: sensitive && noAuth,
      };
    })
    // The ones where an edit matters most, first.
    .sort((x, y) => Number(y.alarm) - Number(x.alarm));

  const helpers = surfaces
    .filter((a) => a.kind === "helper")
    .map((a): Entry => ({
      path: a.file,
      name: fileName(a.file),
      note: a.provider ?? undefined,
    }));

  const unknown = surfaces
    .filter((a) => a.kind === "unknown")
    .map((a): Entry => ({
      path: a.file,
      name: fileName(a.file),
      note: "unclassified",
    }));

  // Everything else the scan saw. Node files are directories with a file list,
  // so this flattens them and drops anything already accounted for above.
  const claimed = new Set(surfaces.map((a) => a.file));
  const rest: Entry[] = [];
  for (const n of graph?.nodes ?? []) {
    for (const f of n.files ?? []) {
      const p = typeof f === "string" ? f : String(f);
      if (claimed.has(p) || rest.some((e) => e.path === p)) continue;
      rest.push({ path: p, name: fileName(p) });
    }
  }
  rest.sort((a, b) => a.path.localeCompare(b.path));

  return [
    {
      key: "agents",
      label: "AGENTS",
      entries: agents,
      openByDefault: true,
      emptyNote: "No agent surfaces in this repository.",
    },
    { key: "helpers", label: "LLM HELPERS", entries: helpers, openByDefault: false },
    { key: "unknown", label: "UNCLASSIFIED", entries: unknown, openByDefault: false },
    { key: "rest", label: "OTHER FILES", entries: rest, openByDefault: false },
  ].filter((g) => g.entries.length > 0 || g.key === "agents");
}

export function FileBrowser({ graph, openPath, onOpen }: Props) {
  const groups = useMemo(() => buildGroups(graph), [graph]);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.openByDefault]))
  );
  const [filter, setFilter] = useState("");

  if (!graph) {
    return (
      <div style={{ padding: 14, fontSize: 12.5, color: "#8b949e", lineHeight: 1.6 }}>
        Scan a repository to browse its files.
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const match = (e: Entry) =>
    !q || e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q);

  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={"Filter " + total + " files"}
        style={{
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: 6,
          padding: "5px 9px",
          fontSize: 11.5,
          color: "#e6edf3",
          marginBottom: 10,
          fontFamily: MONO,
        }}
      />

      <div style={{ overflowY: "auto", minHeight: 0 }}>
        {groups.map((g) => {
          const entries = g.entries.filter(match);
          // A search that matches inside a collapsed group should reveal it.
          const isOpen = q ? entries.length > 0 : open[g.key];

          return (
            <div key={g.key} style={{ marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  background: "none",
                  border: 0,
                  padding: "4px 2px",
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: "#6e7681",
                }}
              >
                <span>{isOpen ? "▾" : "▸"}</span>
                <span>{g.label}</span>
                <span style={{ color: "#484f58" }}>{entries.length}</span>
              </button>

              {isOpen &&
                (entries.length === 0 ? (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "#6e7681",
                      padding: "4px 0 4px 16px",
                    }}
                  >
                    {q ? "nothing matches" : g.emptyNote ?? "empty"}
                  </div>
                ) : (
                  entries.map((e) => {
                    const active = openPath === e.path;
                    return (
                      <button
                        key={e.path}
                        type="button"
                        title={e.path}
                        onClick={() => onOpen(e.path)}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          width: "100%",
                          textAlign: "left",
                          background: active ? "rgba(88,166,255,0.10)" : "transparent",
                          border: 0,
                          borderLeft: active
                            ? "2px solid #58a6ff"
                            : "2px solid transparent",
                          padding: "4px 6px 4px 14px",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 11.5,
                            color: active ? "#58a6ff" : "#c9d1d9",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {e.name}
                        </span>
                        {e.note ? (
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 10,
                              color: e.alarm ? "#f85149" : "#6e7681",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {e.note}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
