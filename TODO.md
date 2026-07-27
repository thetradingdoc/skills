# Arch Visualizer – Graph & Code Viewer TODO (Pending Only)

This file lists **only pending work** for improving the graph dashboard, code viewer, and learning surfaces.

Move completed items to git history or an audit doc; keep this list **pending-only**.

## 1. Code viewer / node inspector

- **1.1**: Add a dedicated `CodeViewer`-style panel (likely as a right-sidebar tab) that shows:
  - Node type badge
  - Node name (primary title)
  - File path (monospace, truncated)
  - Line range (e.g. `Lines 42–87` or “Full file”)
- **1.2**: Extend the graph node model (front-end + back-end types) to include, where missing:
  - `summary`
  - `languageNotes`
  - `tags`
  - `complexity`
  - `lineRange`
- **1.3**: Implement a “Summary” section in the viewer that renders the node `summary` in readable prose.
- **1.4**: Implement a collapsible “Language Concepts” / “Language Notes” section using `languageNotes`.
- **1.5**: Render node `tags` as pill chips with consistent styling.
- **1.6**: Add a “Source” line that shows the local file path (and, where possible, hooks or affordances to open the file in the IDE).

## 2. Connections / relationships

- **2.1**: Implement a “Connections (N)” section on the inspector/code viewer that lists all incoming and outgoing edges for the selected node.
- **2.2**: For each connection, show:
  - Direction arrow (`→` / `←`)
  - Edge type (`calls`, `depends_on`, etc.)
  - Other node’s name (fallback to id)
- **2.3**: Ensure edges in the graph model always carry `type`, `source`, and `target` so this view is reliable.

## 3. Graph rendering / node styling

- **3.1**: Introduce a `persona` state in the front-end (e.g. `overview`, `learn`, `deep_dive`) that can be toggled from the UI.
- **3.2**: Implement persona-based filtering:
  - Overview / non-technical: show only high-level node types (domains/modules/files/“concepts”).
  - Deep dive / experienced: show all supported node types.
- **3.3**: Extend node renderers (2D canvas and, where appropriate, 3D) to include:
  - Left color bar keyed by node type.
  - Type label text color keyed by node type.
  - Complexity text color keyed by `complexity`.
  - Visual states for selection, hover, and “highlighted”.
- **3.4**: Add search result highlighting:
  - Track `searchResults` with `nodeId` + `score`.
  - Pass `isHighlighted` and `searchScore` into node data.
  - Map `searchScore` buckets into ring/glow intensity.

## 4. Layers / grouping

- **4.1**: Introduce (or map existing structures into) a `layers` abstraction in the graph model, representing logical groups/bounded contexts.
- **4.2**: Implement grouping logic in the layout:
  - Compute bounding boxes per layer from laid-out node positions.
  - Create group nodes (background rectangles with labels) for each layer.
  - Attach member nodes as children (`parentId` + `extent: "parent"`) and adjust their positions relative to the group.
- **4.3**: Ensure group nodes are ordered before their children in the node array to satisfy the layout engine.
- **4.4**: Add a `LayerLegend` component that shows:
  - Layer color (dot)
  - Layer name
  - Node count `(N)`
- **4.5**: Add a “Layers ON/OFF” toggle that:
  - Hides/shows grouping while preserving the underlying layout where possible.

## 5. Learn / tour experience

- **5.1**: Add a `tour` structure to the graph model (server + client) with steps containing:
  - `order`
  - `title`
  - `description` (markdown)
  - `nodeIds` (referenced components)
  - Optional `languageLesson`
- **5.2**: Implement a `LearnPanel` / “Tour” sidebar tab with three states:
  - No tour available (friendly empty state).
  - Tour available but not started (overview + “Start Tour” CTA).
  - Tour active (step details + navigation).
- **5.3**: Add UI affordances:
  - Progress bar (percent complete).
  - Step counter (`current / total`).
  - Step dots for random access.
  - Prev / Next buttons; “Finish” on last step.
- **5.4**: Render step `description` via markdown (with code blocks, lists, inline code) using consistent styles.
- **5.5**: Render a “Referenced Components” section with pills that, when clicked:
  - Select the node.
  - Highlight it on the graph.
  - Optionally pan/zoom the canvas to it.
- **5.6**: Wire node highlighting and camera focus so the active step’s `nodeIds` are visually emphasized on the graph.

## 6. Persona selector and view presets

- **6.1**: Implement a `PersonaSelector` control in the top bar (e.g. Overview / Learn / Deep Dive).
- **6.2**: For each persona, define a preset that configures:
  - Which node types are visible.
  - Which sidebars/tabs are open (e.g. Code, Learn, Board).
  - Whether tours and layers are enabled by default.
- **6.3**: Ensure persona changes propagate cleanly to graph filters, inspector, and tour panel (no stale state).

## 7. Empty states and UX polish

- **7.1**: Add explicit empty states (icon + short copy) for:
  - No graph loaded.
  - No node selected in the inspector.
  - No file selected in the code viewer.
  - No tour available.
  - No layers present.
  - No connections for a node.
- **7.2**: Standardize typography and spacing for small section headers:
  - 10–11px uppercase labels.
  - Serif for primary titles.
  - Monospace for file paths and technical identifiers.
- **7.3**: Audit spacing and padding in the right sidebar and overlays to match the design language (consistent gaps, border radii, and border colors).

## 8. Single-screen graph layout & mode buttons

- **8.1**: Unify the main layout so the graph canvas occupies the full primary content area with a single right sidebar (no split “two halves” layout).
- **8.2**: Keep the existing top-bar buttons and their positions:
  - `2D`, `3D`, `View`, `Arch`, `Domains`, `Runtime`, `Failure`, `Depth`, `Domain`, `Elk`.
- **8.3**: Wire these buttons so they control **how the single main canvas renders**, instead of switching between separate panes:
  - `2D` vs `3D`: switch between 2D canvas and 3D view.
  - `View`: switch sub-modes that affect overlays or camera behavior.
  - `Arch`, `Domains`, `Runtime`, `Failure`, `Depth`, `Domain`, `Elk`: map each to a clear, documented graph mode (e.g. architectural layers, domain slices, runtime overlays, failure paths, depth-based filters, elk layout).
- **8.4**: Ensure mode switches are reflected visually (active button states) and do not disrupt selection, inspector, or tour state more than necessary.
