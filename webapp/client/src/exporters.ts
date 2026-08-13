import { toPng } from "html-to-image";
import type { ArchGraph, ArchNode, WorkspaceSceneDoc } from "./types";
import type { DesignFinding } from "./designRules";
import { designScore, evaluateDesign } from "./designRules";

/** Scene bundle format (.arch-scene): scene JSON + graph snapshot + metadata. */
export interface SceneBundle {
  format: "arch-scene-bundle";
  version: 1;
  exportedAt: string;
  scene: WorkspaceSceneDoc;
  graph?: ArchGraph;
  /** Optional base64 thumbnail (PNG). */
  thumbnail?: string;
  /** Source workspace id (informational). */
  workspaceId?: string;
}

export function exportSceneBundle(
  scene: WorkspaceSceneDoc,
  options?: { graph?: ArchGraph; workspaceId?: string; thumbnail?: string }
): string {
  const bundle: SceneBundle = {
    format: "arch-scene-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    scene,
    graph: options?.graph,
    thumbnail: options?.thumbnail,
    workspaceId: options?.workspaceId,
  };
  return JSON.stringify(bundle, null, 0);
}

export function importSceneBundle(json: string): { scene: WorkspaceSceneDoc; graph?: ArchGraph } {
  const parsed = JSON.parse(json) as Partial<SceneBundle>;
  if (parsed?.format !== "arch-scene-bundle" || !parsed.scene) {
    throw new Error("Invalid arch-scene-bundle format");
  }
  return {
    scene: parsed.scene as WorkspaceSceneDoc,
    graph: parsed.graph as ArchGraph | undefined,
  };
}

function groupNodesByLayer(graph: ArchGraph): Map<string, ArchNode[]> {
  const m = new Map<string, ArchNode[]>();
  for (const n of graph.nodes) {
    const layer = (n.layer ?? "Uncategorized") as string;
    if (!m.has(layer)) m.set(layer, []);
    m.get(layer)!.push(n);
  }
  return m;
}

export function exportArchitectureSvg(graph: ArchGraph): string {
  const layerGroups = groupNodesByLayer(graph);
  const layers = Array.from(layerGroups.keys());
  const layerHeight = 160;
  const nodeWidth = 160;
  const nodeHeight = 60;
  const hGap = 40;
  const vGap = 40;

  let svgWidth = 800;
  let svgHeight = layers.length * (layerHeight + vGap) + vGap;

  const layerPositions = new Map<string, number>();
  layers.forEach((layer, idx) => {
    layerPositions.set(layer, vGap + idx * (layerHeight + vGap));
  });

  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const layer of layers) {
    const nodes = layerGroups.get(layer)!;
    const totalWidth = nodes.length * (nodeWidth + hGap) - hGap;
    const startX = Math.max(vGap, (svgWidth - totalWidth) / 2);
    nodes.forEach((n, i) => {
      const x = startX + i * (nodeWidth + hGap);
      const y = (layerPositions.get(layer) ?? vGap) + 30;
      nodePositions.set(n.id, { x, y });
    });
    svgWidth = Math.max(svgWidth, totalWidth + 2 * vGap);
  }

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background:#020617">`
  );

  // Layers
  layers.forEach((layer) => {
    const y = layerPositions.get(layer) ?? vGap;
    parts.push(
      `<rect x="${vGap}" y="${y}" width="${svgWidth - 2 * vGap}" height="${layerHeight}" rx="12" ry="12" fill="rgba(15,23,42,0.9)" stroke="rgba(30,64,175,0.6)" />`
    );
    parts.push(
      `<text x="${vGap + 12}" y="${y + 20}" fill="#8b949e" font-family="monospace" font-size="11">${esc(
        layer
      )}</text>`
    );
  });

  // Edges
  for (const e of graph.edges) {
    const src = nodePositions.get(e.source);
    const tgt = nodePositions.get(e.target);
    if (!src || !tgt) continue;
    const sx = src.x + nodeWidth;
    const sy = src.y + nodeHeight / 2;
    const tx = tgt.x;
    const ty = tgt.y + nodeHeight / 2;
    const mx = (sx + tx) / 2;
    const color = e.isDrift ? "#f85149" : e.isLayerViolation ? "#d29922" : "#ef32a6";
    const dash = e.isDrift ? "6 3" : e.isLayerViolation ? "2 4" : "none";
    parts.push(
      `<path d="M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}" fill="none" stroke="${color}" stroke-width="1.4" stroke-dasharray="${dash}" />`
    );
  }

  // Nodes
  for (const n of graph.nodes) {
    const pos = nodePositions.get(n.id);
    if (!pos) continue;
    const label = esc(n.suggestedLabel ?? n.role ?? n.label);
    const tech = esc(((n as any).techKind as string | undefined) ?? "unknown");
    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" ry="8" fill="#020617" stroke="#161b22" />`
    );
    parts.push(
      `<text x="${pos.x + 8}" y="${pos.y + 20}" fill="#e6edf3" font-family="monospace" font-size="11">${label}</text>`
    );
    parts.push(
      `<text x="${pos.x + 8}" y="${pos.y + 36}" fill="#7d8590" font-family="monospace" font-size="9">${tech}</text>`
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

export function exportArchitectureMarkdown(graph: ArchGraph): string {
  const lines: string[] = [];
  lines.push(`# Architecture Overview`);
  if (graph.projectName) {
    lines.push(`Project: **${graph.projectName}**`);
  }
  lines.push("");
  lines.push(`Generated at: ${new Date(graph.generatedAt).toISOString()}`);
  lines.push("");

  const layers = groupNodesByLayer(graph);
  for (const [layer, nodes] of layers.entries()) {
    lines.push(`## Layer: ${layer}`);
    lines.push("");
    for (const n of nodes) {
      const label = n.suggestedLabel ?? n.role ?? n.label;
      const tech = ((n as any).techKind as string | undefined) ?? "unknown";
      lines.push(`- **${label}** \`(${tech})\``);
      if (n.description) {
        lines.push(`  - ${n.description}`);
      }
    }
    lines.push("");
  }

  lines.push(`## Edge summary`);
  lines.push("");
  for (const e of graph.edges) {
    lines.push(
      `- \`${e.source} → ${e.target}\` (${e.type}${e.isLayerViolation ? ", layer-violation" : ""}${
        e.isDrift ? ", drift" : ""
      })`
    );
  }

  return lines.join("\n");
}

export function exportC4PlantUml(graph: ArchGraph): string {
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml");
  lines.push("");
  lines.push('System_Boundary(s1, "System") {');
  for (const n of graph.nodes) {
    const label = (n.suggestedLabel ?? n.role ?? n.label).replace(/"/g, "'");
    const tech = ((n as any).techKind as string | undefined) ?? "service";
    lines.push(`  Container(${n.id.replace(/[^A-Za-z0-9_]/g, "_")}, "${label}", "${tech}")`);
  }
  lines.push("}");
  lines.push("");
  for (const e of graph.edges) {
    const src = e.source.replace(/[^A-Za-z0-9_]/g, "_");
    const tgt = e.target.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`Rel(${src}, ${tgt}, "${e.type}")`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

export function exportMermaid(graph: ArchGraph): string {
  const lines: string[] = [];
  lines.push("graph LR");
  for (const n of graph.nodes) {
    const id = n.id.replace(/[^A-Za-z0-9_]/g, "_");
    const label = (n.suggestedLabel ?? n.role ?? n.label).replace(/"/g, "'");
    lines.push(`  ${id}["${label}"]`);
  }
  for (const e of graph.edges) {
    const src = e.source.replace(/[^A-Za-z0-9_]/g, "_");
    const tgt = e.target.replace(/[^A-Za-z0-9_]/g, "_");
    const kind =
      e.isDrift ? " -. drift .-> " : e.isLayerViolation ? " -. violation .-> " : " --> ";
    lines.push(`  ${src}${kind}${tgt}`);
  }
  return lines.join("\n");
}

// ── P2c: design-mode exports ────────────────────────────────────────────

function triggerDownload(filename: string, dataUrl: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Rasterizes a DOM element (typically the react-flow viewport) to a PNG and
 * triggers a download. Runs client-side only — html-to-image walks the live
 * DOM and inlines computed styles, so this must be called with the element
 * actually mounted and visible.
 */
export async function exportDesignPng(element: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(element, {
    backgroundColor: "#020617",
    pixelRatio: 2,
    cacheBust: true,
  });
  triggerDownload(filename, dataUrl);
}

function severityBadge(severity: DesignFinding["severity"]): string {
  return severity === "blocker" ? "🔴 blocker" : severity === "risk" ? "🟡 risk" : "🔵 suggestion";
}

/**
 * A README section describing the design: what it's made of, how it's
 * scored, and what's still wrong with it. `findings`/`score` are optional so
 * callers who already computed them (most of the time) skip recomputing —
 * pass nothing and this derives both from the graph.
 */
export function exportDesignReadme(
  graph: ArchGraph,
  findings?: DesignFinding[],
  score?: number
): string {
  const computedFindings = findings ?? evaluateDesign(graph);
  const computedScore = score ?? designScore(computedFindings);
  const layers = groupNodesByLayer(graph);

  const lines: string[] = [];
  lines.push(`# ${graph.projectName ?? "System"} — Design Overview`);
  lines.push("");
  lines.push(
    `A design with **${graph.nodes.length} component${graph.nodes.length === 1 ? "" : "s"}** and ` +
      `**${graph.edges.length} connection${graph.edges.length === 1 ? "" : "s"}**. Design health score: **${computedScore}/100**.`
  );
  lines.push("");

  lines.push(`## Components`);
  lines.push("");
  for (const [layer, nodes] of layers.entries()) {
    lines.push(`### ${layer}`);
    lines.push("");
    for (const n of nodes) {
      const label = n.suggestedLabel ?? n.role ?? n.label;
      lines.push(`- **${label}**${n.description ? ` — ${n.description}` : ""}`);
    }
    lines.push("");
  }

  if (computedFindings.length > 0) {
    lines.push(`## Open issues`);
    lines.push("");
    for (const f of computedFindings) {
      lines.push(`- ${severityBadge(f.severity)} **${f.title}** — ${f.whyItMatters}`);
    }
    lines.push("");
  } else {
    lines.push(`## Open issues`);
    lines.push("");
    lines.push(`None found by the design review.`);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`_Generated ${new Date().toISOString()}_`);
  return lines.join("\n");
}

/**
 * An Architecture Decision Record for the whole design, in the classic
 * Context / Decision / Consequences shape. One ADR summarizing the design as
 * a unit is more useful here than one-per-node — the graph doesn't carry
 * enough history to reconstruct why each individual choice was made.
 */
export function exportDesignAdr(graph: ArchGraph, score?: number): string {
  const findings = evaluateDesign(graph);
  const computedScore = score ?? designScore(findings);
  const layers = groupNodesByLayer(graph);
  const lines: string[] = [];

  lines.push(`# ADR: ${graph.projectName ?? "System"} architecture`);
  lines.push("");
  lines.push(`Status: Proposed`);
  lines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push(`## Context`);
  lines.push("");
  lines.push(
    `This system is designed with ${graph.nodes.length} component(s) across ${layers.size} layer(s): ` +
      `${Array.from(layers.keys()).join(", ")}.`
  );
  lines.push("");

  lines.push(`## Decision`);
  lines.push("");
  lines.push(`The design connects components as follows:`);
  lines.push("");
  const nodeLabel = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? n.suggestedLabel ?? n.role ?? n.label : id;
  };
  for (const e of graph.edges) {
    const relation = e.relation ?? e.type;
    lines.push(`- \`${nodeLabel(e.source)}\` **${relation}** \`${nodeLabel(e.target)}\``);
  }
  lines.push("");

  lines.push(`## Consequences`);
  lines.push("");
  lines.push(`Design health score: **${computedScore}/100**.`);
  lines.push("");
  const blockers = findings.filter((f) => f.severity === "blocker");
  const risks = findings.filter((f) => f.severity === "risk");
  if (blockers.length > 0) {
    lines.push(`**Blockers that must be resolved before this can ship:**`);
    lines.push("");
    for (const f of blockers) lines.push(`- ${f.title} — ${f.whyItMatters}`);
    lines.push("");
  }
  if (risks.length > 0) {
    lines.push(`**Known risks accepted or deferred:**`);
    lines.push("");
    for (const f of risks) lines.push(`- ${f.title} — ${f.whyItMatters}`);
    lines.push("");
  }
  if (blockers.length === 0 && risks.length === 0) {
    lines.push(`No blockers or risks were found by the design review at time of writing.`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Design score summary as JSON — score, severity breakdown, and every finding. */
export function exportDesignScoreCard(graph: ArchGraph): string {
  const findings = evaluateDesign(graph);
  const score = designScore(findings);
  const breakdown = {
    blocker: findings.filter((f) => f.severity === "blocker").length,
    risk: findings.filter((f) => f.severity === "risk").length,
    suggestion: findings.filter((f) => f.severity === "suggestion").length,
  };
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      projectName: graph.projectName ?? null,
      score,
      breakdown,
      findings: findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        nodeIds: f.nodeIds,
      })),
    },
    null,
    2
  );
}

export function exportPlantUml(graph: ArchGraph): string {
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("skinparam componentStyle rectangle");
  for (const n of graph.nodes) {
    const id = n.id.replace(/[^A-Za-z0-9_]/g, "_");
    const label = (n.suggestedLabel ?? n.role ?? n.label).replace(/"/g, "'");
    lines.push(`component "${label}" as ${id}`);
  }
  for (const e of graph.edges) {
    const src = e.source.replace(/[^A-Za-z0-9_]/g, "_");
    const tgt = e.target.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`${src} --> ${tgt} : ${e.type}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

