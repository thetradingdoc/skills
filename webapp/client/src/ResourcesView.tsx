/**
 * Resources classification screen — blast-radius sorted, confirm heuristics.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  AgentInventoryResult,
  ArchGraph,
  ResourceClass,
} from "./types";

type Props = {
  agents: AgentInventoryResult | undefined;
  apiBase: string;
  onGraphPatch?: (patch: (g: ArchGraph) => ArchGraph) => void;
};

type ClassifyFile = {
  resources: Record<string, ResourceClass>;
  guesses: Record<string, ResourceClass>;
  unclassified: string[];
  noise?: string[];
};

type ResourceRow = {
  key: string;
  kind: string;
  name: string;
  toolCount: number;
  locations: string[];
  class: ResourceClass;
  isGuess: boolean;
  isDecision: boolean;
};

const CLASS_BTNS: ResourceClass[] = ["patient", "money", "external", "internal"];

function applyClassToGraph(graph: ArchGraph, key: string, cls: ResourceClass): ArchGraph {
  if (!graph.agents?.agents) return graph;
  const agents = graph.agents.agents.map((a) => {
    if (a.kind !== "agent" || !a.tools) return a;
    const tools = a.tools.map((t) => {
      if (!t.reach?.resources?.length) return t;
      let changed = false;
      const resources = t.reach.resources.map((r) => {
        const rk = `${r.kind}:${r.name}`.toLowerCase();
        if (rk !== key) return r;
        changed = true;
        return { ...r, class: cls, guess: false };
      });
      if (!changed) return t;
      // Rebuild cells lightly from resources
      const cells = { ...t.reach.cells };
      for (const c of ["patient", "money", "external", "internal", "unclassified"] as ResourceClass[]) {
        const ofClass = resources.filter((r) => r.class === c);
        if (ofClass.length) {
          const best = ofClass.reduce((x, y) => (x.depth <= y.depth ? x : y));
          cells[c] = {
            state: "reaches",
            depth: best.depth,
            path: best.path,
            reason: null,
            resources: ofClass,
          };
        } else if (cells[c]?.state === "reaches") {
          // Was reaches only via this resource — fall back to none if walk wasn't truncated
          cells[c] = t.reach.truncated
            ? {
                state: "not-traced",
                depth: null,
                path: null,
                reason: t.reach.truncationReasons?.[0] ?? "reclassified",
                resources: [],
              }
            : { state: "none", depth: null, path: null, reason: null, resources: [] };
        }
      }
      return {
        ...t,
        reach: { ...t.reach, resources, cells },
      };
    });
    return { ...a, tools };
  });
  return {
    ...graph,
    agents: { ...graph.agents, agents },
  };
}

export default function ResourcesView({ agents, apiBase, onGraphPatch }: Props) {
  const [classify, setClassify] = useState<ClassifyFile | null>(null);
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/resources/classify`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) {
          setClassify({
            resources: data.resources ?? {},
            guesses: data.guesses ?? {},
            unclassified: data.unclassified ?? [],
            noise: data.noise ?? [],
          });
        }
      } catch (e) {
        // Fall back to public copy
        try {
          const res = await fetch("/resources.classify.json");
          const data = await res.json();
          if (!cancelled) {
            setClassify({
              resources: data.resources ?? {},
              guesses: data.guesses ?? {},
              unclassified: data.unclassified ?? [],
              noise: data.noise ?? [],
            });
          }
        } catch (e2) {
          if (!cancelled) setError(String(e2));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const rows: ResourceRow[] = useMemo(() => {
    const byKey = new Map<
      string,
      { tools: Set<string>; locations: string[]; kind: string; name: string }
    >();
    for (const a of agents?.agents ?? []) {
      if (a.kind !== "agent") continue;
      for (const t of a.tools ?? []) {
        for (const r of t.reach?.resources ?? []) {
          if (r.kind === "db_call" || r.class === "plumbing") continue;
          const key = `${r.kind}:${r.name}`.toLowerCase();
          let entry = byKey.get(key);
          if (!entry) {
            entry = {
              tools: new Set(),
              locations: [],
              kind: r.kind,
              name: r.name,
            };
            byKey.set(key, entry);
          }
          entry.tools.add(`${a.file}::${t.name}`);
          const m = r.evidence.match(/^([^:]+\.[a-z]+:\d+)/i);
          const locKey = m ? m[1]! : r.evidence.slice(0, 80);
          if (locKey && !entry.locations.includes(locKey)) {
            entry.locations.push(locKey);
          }
        }
      }
    }

    const out: ResourceRow[] = [];
    for (const [key, entry] of byKey) {
      if (classify?.noise?.includes(key)) continue;
      if (key.startsWith("db_call:")) continue;
      const decision = classify?.resources?.[key] as ResourceClass | undefined;
      const guess = classify?.guesses?.[key] as ResourceClass | undefined;
      const cls: ResourceClass = decision ?? guess ?? "unclassified";
      if (cls === "plumbing") continue;
      const isDecision = !!decision;
      const isGuess = !decision && !!guess;
      out.push({
        key,
        kind: entry.kind,
        name: entry.name,
        toolCount: entry.tools.size,
        locations: entry.locations.slice(0, 3),
        class: cls,
        isGuess,
        isDecision,
      });
    }
    out.sort((a, b) => b.toolCount - a.toolCount || a.key.localeCompare(b.key));
    return out;
  }, [agents, classify]);

  const visible = useMemo(() => {
    if (!unclassifiedOnly) return rows;
    return rows.filter((r) => !r.isDecision);
  }, [rows, unclassifiedOnly]);

  const totalDistinct = rows.length;
  const classifiedCount = rows.filter((r) => r.isDecision).length;

  async function classifyKeys(keys: string[], cls: ResourceClass) {
    if (!keys.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/resources/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: keys.map((key) => ({ key, class: cls })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setClassify({
        resources: data.classify.resources ?? {},
        guesses: data.classify.guesses ?? {},
        unclassified: data.classify.unclassified ?? [],
        noise: data.classify.noise ?? [],
      });
      if (onGraphPatch) {
        onGraphPatch((g) => {
          let next = g;
          for (const key of keys) next = applyClassToGraph(next, key, cls);
          return next;
        });
      }
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  if (!agents) {
    return (
      <div style={{ padding: 32, color: "#9ca3af", fontFamily: "ui-monospace, monospace" }}>
        No agent inventory — scan a repository first.
      </div>
    );
  }

  return (
    <div
      data-testid="resources-view"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "rgba(6,12,26,0.35)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#d1d5db",
      }}
    >
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #30363d",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 13, color: "#f3f4f6" }}>
          Resources — {classifiedCount} of {totalDistinct} classified
        </div>
        <label style={{ fontSize: 11, color: "#9ca3af", display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={unclassifiedOnly}
            onChange={(e) => setUnclassifiedOnly(e.target.checked)}
          />
          Unclassified only
        </label>
        {selected.size > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#93c5fd" }}>{selected.size} selected →</span>
            {CLASS_BTNS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={busy}
                onClick={() => classifyKeys([...selected], c)}
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: "#1f2937",
                  color: "#e5e7eb",
                  cursor: "pointer",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {error && <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px 32px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "#6b7280", textAlign: "left" }}>
              <th style={{ padding: "6px 8px", width: 28 }} />
              <th style={{ padding: "6px 8px" }}>Resource</th>
              <th style={{ padding: "6px 8px", width: 70 }}>Tools</th>
              <th style={{ padding: "6px 8px" }}>Found at</th>
              <th style={{ padding: "6px 8px", width: 90 }}>Class</th>
              <th style={{ padding: "6px 8px", width: 280 }}>Decide</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} style={{ borderTop: "1px solid #21262d" }}>
                <td style={{ padding: "6px 8px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.key)}
                    onChange={() => toggle(row.key)}
                  />
                </td>
                <td style={{ padding: "6px 8px", color: "#e5e7eb" }}>
                  <span style={{ color: "#93c5fd" }}>{row.kind}</span>:{row.name}
                </td>
                <td style={{ padding: "6px 8px", color: "#fbbf24", fontWeight: 600 }}>
                  {row.toolCount}
                </td>
                <td style={{ padding: "6px 8px", color: "#6b7280", maxWidth: 280 }}>
                  {row.locations.slice(0, 3).join(" · ") || "—"}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <span style={{ color: row.isDecision ? "#86efac" : row.isGuess ? "#fbbf24" : "#a78bfa" }}>
                    {row.class}
                    {row.isGuess ? " (guess)" : row.isDecision ? "" : ""}
                  </span>
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {CLASS_BTNS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={busy}
                        onClick={() => classifyKeys([row.key], c)}
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          border:
                            row.class === c
                              ? "1px solid #60a5fa"
                              : "1px solid #30363d",
                          background:
                            row.class === c ? "rgba(29,78,216,0.25)" : "transparent",
                          color: "#d1d5db",
                          cursor: "pointer",
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div style={{ padding: 24, color: "#6b7280" }}>
            {unclassifiedOnly ? "Nothing left to classify." : "No resources found."}
          </div>
        )}
      </div>
    </div>
  );
}
