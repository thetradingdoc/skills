# UX Review Checklist — iCraft Parity

Use this checklist when comparing Arch Visualizer against iCraft-style diagrams and when testing on real repos (e.g. doclittle-platform).

## 1. Visual parity

- [ ] **Node cards** — Icon-first, single-line title, layer line, density-aware
- [ ] **Layer bands** — Clear horizontal bands with labels and node counts
- [ ] **Domain grouping** — Domains view shows cohesive clusters with legend
- [ ] **Edge styling** — Drift (red), violation (amber), import (blue), trace (purple)
- [ ] **3D view** — Isometric camera, layer planes, node slabs, lighting

## 2. Interaction

- [ ] **Click to highlight** — Legend "Click to highlight" works for layers, tech, status
- [ ] **Path search** — From/To search finds and highlights dependency paths
- [ ] **Focus mode** — Isolate node + direct dependencies
- [ ] **Scene states** — Add states, capture view, play/pause timeline

## 3. Real-repo testing (doclittle-platform)

```bash
# Clone and scan
git clone https://github.com/your-org/doclittle-platform.git
# In Arch Visualizer: New workspace → paste repo URL → Scan
```

- [ ] **Scan completes** — No timeout, graph loads
- [ ] **Node count** — Matches expected modules
- [ ] **Domain inference** — Auth, payments, users, etc. appear in domains view
- [ ] **Performance** — 2D/3D smooth at 50–200 nodes
- [ ] **Path search** — Typical flows (e.g. API → Service → DB) are findable

## 4. iCraft-specific behaviors

- [ ] **Editor mode** — Drag nodes, grid snap, undo/redo
- [ ] **3D transform** — Gizmos for node repositioning
- [ ] **Player API** — `window.archPlayer.play()`, `setState()`, `highlightNodes()`
- [ ] **Export bundle** — Scene + graph export/import

## 5. Accessibility & polish

- [ ] **Tooltips** — Edges and nodes have descriptive titles
- [ ] **Legend** — All filters/sections explained
- [ ] **Keyboard** — Escape clears selection, 1–5 jump camera presets (3D)

---

**Review cadence:** After major UI changes, run through this list and update with findings.
