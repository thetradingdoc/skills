/**
 * What is worth looking at in a file, without opening it.
 *
 * A 400px panel cannot show 6,840 lines and should not try. What it can show is
 * the handful of lines that matter — every tool declared in this file, what
 * that tool can reach, and whether anything checks identity first.
 *
 * That turns the sidebar from a bad code viewer into the thing you actually
 * want: a reason to open the file, and the line to open it at.
 */
import { useMemo } from "react";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Props = {
  graph?: any;
  filePath?: string | null;
  /** Open this file in the main view, optionally at a line. */
  onOpenFull: (path: string, line?: number) => void;
};

type Site = {
  line: number;
  tool: string;
  patient: boolean;
  money: boolean;
  external: boolean;
  untraced: boolean;
  /** The agent whose catalog declares it. */
  agent: string;
};

const fileName = (p: string): string => p.split(/[/\\]/).pop() || p;

function sitesInFile(graph: any, filePath: string): Site[] {
  const inv = graph?.agents;
  const surfaces: any[] = inv?.agents ?? [];
  const catalogs: Record<string, any[]> = inv?.toolCatalogs ?? {};

  const toolsOf = (a: any): any[] =>
    Array.isArray(a.tools) && a.tools.length
      ? a.tools
      : a.catalogId
        ? (catalogs[a.catalogId] ?? [])
        : [];

  const seen = new Set<string>();
  const out: Site[] = [];

  for (const a of surfaces.filter((x) => x.kind === "agent")) {
    for (const t of toolsOf(a)) {
      const handler: string | undefined = t.handler ?? undefined;
      if (!handler) continue;

      const m = handler.match(/^(.*?):(\d+)$/);
      if (!m || m[1] !== filePath) continue;

      // A shared catalog means the same declaration appears under several
      // agents. It is one line in one file either way.
      const key = m[2] + ":" + t.name;
      if (seen.has(key)) continue;
      seen.add(key);

      const cells = t?.reach?.cells ?? {};
      out.push({
        line: Number(m[2]),
        tool: t.name ?? "(unnamed)",
        patient: cells.patient?.state === "reaches",
        money: cells.money?.state === "reaches",
        external: cells.external?.state === "reaches",
        untraced: Object.values(cells).some(
          (c: any) => c?.state === "not-traced"
        ),
        agent: a.file,
      });
    }
  }

  // Riskiest first, then in file order — you read a file downwards, but you
  // care about the dangerous lines regardless of where they sit.
  return out.sort((x, y) => {
    const rx = (x.patient ? 2 : 0) + (x.money ? 1 : 0);
    const ry = (y.patient ? 2 : 0) + (y.money ? 1 : 0);
    return ry - rx || x.line - y.line;
  });
}

export function FileIssues({ graph, filePath, onOpenFull }: Props) {
  const sites = useMemo(
    () => (graph && filePath ? sitesInFile(graph, filePath) : []),
    [graph, filePath]
  );

  const agent = useMemo(() => {
    if (!graph || !filePath) return null;
    const surfaces: any[] = graph?.agents?.agents ?? [];
    return surfaces.find((a) => a.file === filePath && a.kind === "agent") ?? null;
  }, [graph, filePath]);

  if (!filePath) {
    return (
      <div style={{ padding: "10px 4px", fontSize: 11.5, color: "#6e7681", lineHeight: 1.6 }}>
        Pick a file above to see what is worth looking at in it.
      </div>
    );
  }

  const sensitive = sites.filter((s) => s.patient || s.money).length;

  return (
    <div style={{ padding: "10px 2px 4px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: "#e6edf3",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
          title={filePath}
        >
          {fileName(filePath)}
        </span>
        <button
          type="button"
          onClick={() => onOpenFull(filePath)}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            padding: "3px 9px",
            borderRadius: 5,
            border: "1px solid #30363d",
            background: "transparent",
            color: "#58a6ff",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          open full view
        </button>
      </div>

      {agent ? (
        <div
          style={{
            fontSize: 11.5,
            color: agent.auth?.found ? "#8b949e" : "#f85149",
            lineHeight: 1.5,
            marginBottom: 10,
            paddingLeft: 8,
            borderLeft: "2px solid " + (agent.auth?.found ? "#30363d" : "#f85149"),
          }}
        >
          {agent.auth?.found
            ? "Identity is checked before tools run."
            : "No identity check before tool execution."}
        </div>
      ) : null}

      {sites.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "#6e7681", lineHeight: 1.6 }}>
          No tool declarations traced to this file. Open the full view to read
          it.
        </div>
      ) : (
        <>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "#6e7681",
              marginBottom: 6,
            }}
          >
            {sites.length} TOOL{sites.length === 1 ? "" : "S"} DECLARED HERE
            {sensitive > 0 ? " · " + sensitive + " SENSITIVE" : ""}
          </div>

          {sites.map((s) => (
            <button
              key={s.line + s.tool}
              type="button"
              title={"Open at line " + s.line}
              onClick={() => onOpenFull(filePath, s.line)}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: 0,
                borderLeft:
                  "2px solid " +
                  (s.patient ? "#f85149" : s.money ? "#d29922" : "transparent"),
                padding: "3px 4px 3px 8px",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: "#484f58",
                  width: 38,
                  flexShrink: 0,
                  textAlign: "right",
                }}
              >
                {s.line}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: "#c9d1d9",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.tool}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  whiteSpace: "nowrap",
                  color: "#6e7681",
                }}
              >
                {s.patient ? <span style={{ color: "#f85149" }}>p</span> : null}
                {s.money ? <span style={{ color: "#d29922" }}>m</span> : null}
                {s.untraced ? <span style={{ color: "#6e7681" }}>?</span> : null}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
