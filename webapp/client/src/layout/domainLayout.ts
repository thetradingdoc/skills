/**
 * Domain-based layout: clusters nodes by domain (derived from path) then by layer.
 * e.g. src/auth/* → "auth", src/payment/* → "payment", lib/* → "lib"
 */

import type { ArchGraph, ArchNode } from "../types";
import { LAYER_ORDER } from "../architecture/layerModel";
import { NODE_W } from "./canvasConstants";
import type { LayerBand } from "./depthLayout";

export interface DomainLayerBand extends LayerBand {
  layerKey?: string;
  nodeCount?: number;
}

export interface DomainRegion {
  id: string;
  domain: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomainLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  layerBands: LayerBand[];
  domainRegions: DomainRegion[];
}

export function domainFromPath(path: string, id: string): string {
  const p = (path || id).replace(/^\.\//, "").replace(/\\/g, "/");
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, 2).join("/");
}

export function computeDomainLayout(graph: ArchGraph): DomainLayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const layerBands: DomainLayerBand[] = [];

  const domainToNodes = new Map<string, ArchNode[]>();
  for (const n of graph.nodes) {
    const domain = domainFromPath(n.path ?? n.id, n.id);
    if (!domainToNodes.has(domain)) domainToNodes.set(domain, []);
    domainToNodes.get(domain)!.push(n);
  }

  const BAND_H = 180;
  const DOMAIN_GAP = 120;
  let globalY = 0;

  const domains = [...domainToNodes.keys()].sort();

  for (const domain of domains) {
    const domainNodes = domainToNodes.get(domain)!;
    const layerGroups = new Map<string, ArchNode[]>();
    for (const n of domainNodes) {
      const layer = (n.layer ?? "Uncategorized") as string;
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer)!.push(n);
    }

    const orderedLayers = LAYER_ORDER.filter((l) => layerGroups.has(l));
    let domainWidth = 0;

    for (const layer of orderedLayers) {
      const nodes = layerGroups.get(layer)!;
      const sorted = [...nodes].sort((a, b) => (a.depth ?? 999) - (b.depth ?? 999));
      const w = Math.max(sorted.length * (NODE_W + 60), 400);
      domainWidth = Math.max(domainWidth, w);
    }
    domainWidth = Math.max(domainWidth, 300);

    let bandY = globalY;
    for (const layer of orderedLayers) {
      const nodes = layerGroups.get(layer)!;
      const sorted = [...nodes].sort((a, b) => (a.depth ?? 999) - (b.depth ?? 999));
      const startX = -domainWidth / 2 + 40;

      layerBands.push({
        id: `band:${domain}:${layer}`,
        layer: `${domain} · ${layer}`,
        layerKey: layer,
        nodeCount: sorted.length,
        x: -domainWidth / 2,
        y: bandY - 16,
        width: domainWidth + 80,
        height: BAND_H,
      });

      for (let i = 0; i < sorted.length; i++) {
        positions.set(sorted[i].id, { x: startX + i * (NODE_W + 60), y: bandY });
      }
      bandY += BAND_H;
    }

    globalY = bandY + DOMAIN_GAP;
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  for (const p of positions.values()) {
    p.x = p.x - minX + 80;
    p.y = p.y - minY + 80;
  }
  for (const band of layerBands) {
    band.x = band.x - minX + 80;
    band.y = band.y - minY + 80;
  }

  // Aggregate bands by domain to form cohesive background regions
  const domainRegions: DomainRegion[] = [];
  const bandsByDomain = new Map<string, typeof layerBands>();
  for (const band of layerBands) {
    const domainBand = band as DomainLayerBand;
    const domain = domainBand.id?.startsWith("band:") ? domainBand.id.split(":")[1] ?? "root" : "root";
    if (!bandsByDomain.has(domain)) bandsByDomain.set(domain, []);
    bandsByDomain.get(domain)!.push(band);
  }
  for (const [domain, bands] of bandsByDomain) {
    if (bands.length === 0) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of bands) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    const pad = 16;
    domainRegions.push({
      id: `domain:${domain}`,
      domain,
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    });
  }

  return { nodePositions: positions, layerBands, domainRegions };
}
