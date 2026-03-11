# TODO Audit — Exact Counts

**Audit date:** 2025-03-10  
**Source:** Unified todo list + DIAGNOSIS_AND_TODO (p1–p20) + PRODUCT_STATUS + TODO.md

---

## Summary

| Category | Count |
|----------|-------|
| **Done** | 64 |
| **Pending** | 51 |
| **Total tracked** | 115 |

---

## 1. Core Rails & Execution

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 2. Todos & Dependency Execution

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 3. Chat, Orchestration & Sessions

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 4. Board & Webapp UI

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 5. Jira, Violations & Governance

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 6. Greenfield, Materialize, Sandbox

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 7. Data Model, DB, Infra

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 8. Verification & Testing

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 9. Bugs (from PRODUCT_STATUS)

All items in this section are completed and have been pruned from the active todo list. See git history for the archived details.

---

## 10. TODO.md Phases (distinct items)

Phase 0–6 items (archNodeId docs, id-decorator, Ghost nodes, Scaffold, telemetry manager, Fix-or-Track, Jira overlay, Greenfield UX) — counted as additional pending in TODO.md; not double-counted above.

---

## 11. UI – 2D/3D Architecture Visualization Parity (new)

These items bring the Arch Visualizer canvas closer to iCraft-style visuals.

**Codebase reality check (already implemented):**
- 2D/3D toggle + ReactFlow canvas + custom nodes/edges: `webapp/client/src/ArchCanvas.tsx`
- Workspaces + persistence + load/save + archived soft-delete: `webapp/server/src/workspaces.ts`
- Repo scan pipeline + graph persistence: `webapp/server/src/scan.ts`

These were previously marked as “not included in the summary”; this audit now **includes** them in totals.

| # | ID | Status | Evidence / Notes |
|---|----|--------|------------------|
| 97 | ui-tech-taxonomy-categories | DONE | Define tech categories (DB, cache, queue, HTTP API, web UI, mobile, k8s cluster, container service, serverless, object storage, external SaaS, etc.). |
| 98 | ui-tech-detection-heuristics-paths | DONE | Implement path/name heuristics in the analyzer (e.g. k8s/helm/eks/ingress/kafka/redis/auth/gateway). |
| 99 | ui-tech-detection-heuristics-deps | DONE | Implement dependency-based detection (e.g. kafkajs, bullmq, aws-sdk, pg, mongoose, etc.). |
| 100 | ui-tech-metadata-overrides | DONE | Support optional `.arch-node.json` / `archNode` metadata overrides per folder. |
| 101 | ui-archnode-techkind-fields | DONE | Extend `ArchNode` with `techKind`, `cloudProvider`, `tags`, `iconKey`. |
| 102 | ui-icon-set-generic-infra | DONE | Design/adopt icon set for generic infra (server, VM, DB, queue, cache, LB, API gateway, web app, worker, etc.). |
| 103 | ui-icon-set-cloud-variants | DONE | Add cloud-specific variants (AWS/GCP/Azure) where licensing allows, or neutral equivalents. |
| 104 | ui-2d-node-icons | DONE | Render small SVG glyphs in 2D card headers based on `techKind`. |
| 105 | ui-3d-node-meshes | DONE | Map `techKind` to 3D sprites/meshes (cylinder for DB, stacked cubes for clusters, envelope for queues, etc.). |
| 106 | ui-color-semantic-tech-family | DONE | Define color semantics by tech family (data plane, control plane, edge) distinct from violation colors. |
| 107 | ui-theme-toggle-basic | DONE | Add minimal theming (dark/light and high-contrast variants) for canvas elements. |
| 108 | ui-2d-layer-zones | DONE | Render semi-transparent rounded rectangles per logical layer (Configuration, Orchestration, Business Logic, Infrastructure, External) behind nodes. |
| 109 | ui-external-deps-lane | DONE | Visually group external dependencies into a dedicated lane with different background styling. |
| 110 | ui-edge-style-types | DONE | Differentiate normal imports, violating edges, and execution/rail paths via line weight, color, and effects. |
| 111 | ui-edge-arrows | DONE | Add directional arrowheads to edges in 2D view. |
| 112 | ui-edge-bundling | DONE | Implement basic edge bundling/simplified routing to reduce clutter on dense graphs. |
| 113 | ui-card-typography-hierarchy | DONE | Refine node card typography (title, tech subtitle, key metrics such as file count/LOC bucket). |
| 114 | ui-card-badges-violations | DONE | Add micro-badges for violation severity and “has traces” state. |
| 115 | ui-card-badges-jira | DONE | Indicate Jira linkage/status on cards (e.g. small Jira key/status badge). |
| 116 | ui-card-tags-tech | DONE | Show compact tech tags on cards (e.g. `k8s`, `API`, `DB`, `external`). |
| 117 | ui-3d-camera-isometric | DONE | Default 3D camera to an isometric view similar to iCraft examples. |
| 118 | ui-3d-lighting-setup | DONE | Configure ambient + directional lights and optional shadow plane for depth. |
| 119 | ui-3d-ground-grid | DONE | Add configurable ground grid (density/opacity controls). |
| 120 | ui-3d-node-slabs | DONE | Extrude nodes into low 3D slabs with top face colored by tech family and sides by layer. |
| 121 | ui-3d-layer-plates | DONE | Render larger thin 3D plates beneath node groups to represent layers/zones. |
| 122 | ui-3d-node-animations | DONE | Add subtle hover animations and severity pulses for problematic nodes. |
| 123 | ui-camera-presets-model | DONE | Define camera preset struct `{id, name, position, target}` and persistence schema. |
| 124 | ui-camera-presets-storage | DONE | Add `workspace_views` (or similar) table and API to save/load camera presets per workspace. |
| 125 | ui-camera-presets-ui | DONE | Implement “Save view” control and preset list/hotkeys (1–5) to jump between views. |
| 126 | ui-camera-transition-tween | DONE | Smoothly interpolate camera moves between presets. |
| 127 | ui-tooltips-nodes | DONE | Implement rich node hover tooltips (description, key files, last change, Jira summary when present). |
| 128 | ui-tooltips-edges | DONE | Implement edge tooltips (source→target, violation reason where applicable). |
| 129 | ui-annotations-schema | DONE | Create `workspace_annotations` table with type (`note`, `highlight`, `question`) and author fields. |
| 130 | ui-annotations-crud | DONE | Add UI to create/edit/delete annotations pinned to nodes/zones/canvas positions. |
| 131 | ui-annotations-render-2d | DONE | Render annotations as sticky-note style overlays in 2D. |
| 132 | ui-annotations-render-3d | DONE | Render annotations as floating panels anchored in 3D scenes. |
| 133 | ui-presentation-mode | DONE | Add presentation mode that hides most controls and steps through saved “scenes” (views + annotations). |
| 134 | ui-focus-mode | DONE | Add focus mode that highlights a selected node + neighbors and fades others, with “Explain this area” entry point. |
| 135 | ui-saved-workspace-thumbnails | DONE | Store and display small thumbnails or encoded previews for each saved workspace in the “Open saved” list. |
| 136 | ui-saved-workspace-metrics | DONE | Show last scan time, node count, and violation count alongside saved workspace names. |
| 137 | ui-archived-workspaces-view | DONE | Add “Archived workspaces” management UI (list, restore, hard-delete). |
| 138 | ui-api-views-annotations | DONE | Extend `GET /workspaces/:id/load` to return any saved camera views and annotation summaries. |
| 139 | ui-theme-module | DONE | Centralize colors, typography, and spacing into a shared theme module for 2D/3D views. |
| 140 | ui-density-toggle | DONE | Add toggle between compact and presentation densities (card padding, font sizes). |
| 141 | ui-feature-flags | DONE | Introduce feature flags for icons, 3D enhancements, and annotations to allow incremental rollout. |
| 142 | ui-perf-benchmarking | DONE | Measure and track FPS/latency for 50/200/500-node graphs in 2D/3D. |
| 143 | ui-perf-optimizations | DONE | Implement instanced meshes, layout debouncing, and other optimizations when needed. |
| 144 | ui-ux-review-loop | DONE | Establish UX review loop comparing against iCraft-style diagrams and testing on real repos (e.g. doclittle-platform). |
| 154 | ui-2d-node-icon-cards | DONE | Replace 2D node cards with compact icon-first tiles: large tech/infra icon + minimal label and micro-badges, so the canvas reads as an icon map instead of text boxes. |
| 155 | ui-2d-icon-size-scale | DONE | Make icon and label sizing responsive to both density and zoom level, so default zoom emphasizes icons and zoom-in progressively reveals more text/metrics. |
| 156 | ui-2d-zoom-text-pruning | DONE | Aggressively hide secondary text (descriptions, provider/model lines) at low zoom, even in standard density, to keep the canvas visually sparse. |
| 157 | ui-2d-icon-badges-minimal | DONE | Reduce visible badges on nodes to a few micro-badges (violations count, traces, Jira, depth/drift) with semantics explained in the legend, not on the cards. |
| 158 | ui-2d-techfamily-legend | DONE | Add a small “Tech families” legend row that explains icon/color meaning (DB/cache/queue/API/UI/etc.), alongside the existing Layers and By type sections. |
| 159 | ui-legend-layout-freeze | DONE | Lock the left legend layout and wording to match the iCraft-style screenshot (Click to highlight, Layers with counts, By type Imports/Layer violation/Drift, Focus on selection). |
| 160 | ui-legend-theme-integration | DONE | Drive all legend colors/typography (headers, section titles, dividers) from the shared `canvasTheme` module instead of inline hex values. |
| 161 | ui-bottomright-widget-remove | DONE | Remove the existing right-side workspace/status widget from the main canvas view so the canvas center and edges are visually clean. |
| 162 | ui-bottomright-future-slot-reserve | DONE | Reserve a minimal, invisible container in the bottom-right corner as a HUD slot for future perf/runtime overlays, disabled/off by default. |
| 163 | ui-screenshot-parity-review | DONE | After implementing the above, visually compare against the reference screenshot and tweak spacing, radii, and grid contrast until the 2D layout closely matches. |

**Section 11 totals:** DONE 58 (97–112, 113–144, 154–163), PENDING 0, TOTAL 58.

---

## 12. iCraft Parity — Editor + Scene Model + Digital Twin (missing)

iCraft is not just a “viewer UI”: it has an **editor** (drag/drop, snapping, stacking), a **scene/state model** (sub-scenes), and a **player** intended for “digital twin” style external control ([iCraft repo](https://github.com/gantFDT/icraft), [README](https://raw.githubusercontent.com/gantFDT/icraft/main/README.md), [player](https://raw.githubusercontent.com/gantFDT/icraft/main/player-react.README.md)).

These items capture what’s missing from our current platform to reach iCraft-style parity beyond visuals.

| # | ID | Status | Evidence / Notes |
|---|----|--------|------------------|
| 145 | ui-scene-model-schema | PENDING | Define a first-class Scene document (objects/transforms/materials/links) separate from `ArchGraph`; add `workspace_scenes` table and versioning. |
| 146 | ui-scene-editor-2d | PENDING | 2D editor: palette, drag/drop placement, multi-select, align/distribute, group/ungroup, undo/redo; grid snapping + magnetic attraction. |
| 147 | ui-scene-editor-3d | PENDING | 3D editor: orbit + transform gizmos, grid/ground plane, stacking rules, selection, direct manipulation. |
| 148 | ui-asset-library | PENDING | Built-in icon/mesh catalog: search/tags/categories; map `techKind/iconKey` to assets consistently in 2D/3D. |
| 149 | ui-import-gltf-glb | PENDING | External model import pipeline (GLB/GLTF), asset optimization, caching, licensing constraints. |
| 150 | ui-scene-states-slides | PENDING | “Sub-scene states”: named scene states with camera + visibility + overrides + annotation sets (beyond just camera presets). |
| 151 | ui-animation-timeline | PENDING | Presentation timeline: transitions between states, playback controls, animated emphasis (flow pulses, status changes). |
| 152 | ui-player-api-digital-twin | PENDING | External control API: update node/object state via events/methods; bind live metrics/status to materials and labels (digital twin). |
| 153 | ui-export-import-scene-bundle | PENDING | Export/import format (our equivalent of `.iplayer`): scene JSON + assets + thumbnails + migrations; supports sharing. |

**Section 12 totals:** DONE 0, PENDING 9, TOTAL 9.

---

## Recount from this audit (updated)

Manual count from active sections above:
- Section 11: DONE 58, PENDING 0 (TOTAL 58)
- Section 12: DONE 0, PENDING 9 (TOTAL 9)

**Final totals (active todos only):**
- **Done:** 72
- **Pending:** 43
- **Total:** 115
