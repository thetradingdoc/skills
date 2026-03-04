# Workspace & repo features – review

## Current behavior

### 1. **“My workspace” (top-right card on canvas)**
- **What it is:** Displays the current workspace name and status.
- **Source of name:** `graph.projectName` with fallbacks:
  - Set to `"My workspace"` when an empty graph is created (e.g. after auth, or initial empty state).
  - Set to a user-derived name when signing up (e.g. “New LittleLabs workspace” or user’s name).
  - After a scan, the server does **not** currently send `projectName` in the graph; the scan script only sets `projectRoot`. So the UI falls back to `"My workspace"` unless we set it elsewhere.
- **Function:** Informational only (last scan date, node count, Save/Share placeholders). **Not** a save action; it’s “current workspace status.”
- **Rename:** There is no UI to rename today. The graph type supports `projectName`; we can add rename (e.g. click-to-edit or a small “Rename” control) and update `graph.projectName` in App state.

---

### 2. **“Scan repository” (top – sidebar Repo section)**
- **When it appears:** Only when the workspace is **empty**: `graph.nodes.length === 0 && !graph.projectRoot`. Then the sidebar shows URL input + “Scan repository” button.
- **What it does:** `handleScan()` → `scanRepo(repoUrl)` → POST `/api/scan` → replaces the whole graph with the scan result. So “scan repo” = load a repo into this workspace (and clear whatever was there).
- **When you already have a repo:** The sidebar only shows the current `repoUrl` (read-only). There is no “Scan a different repo” button in the sidebar; to change repo you must clear first (see bottom action).

---

### 3. **“New repository” (bottom – sidebar)**
- **What it does:** Button opens a confirm dialog: “Start a new repository? This will clear your current graph, chat history, and violations.” On confirm, `handleNewRepo()`:
  - Sets `graph` to `null`
  - Clears chat tabs/sessions, violations, virtual nodes/edges, etc.
- **Result:** Because `!graph && !loading`, the app shows the **landing page**, where the user can enter a new URL and click “Scan repository” in the landing card. So “New repository” = “clear everything and go back to landing to (optionally) scan a different repo.”

---

### 4. **Repetition / overlap**
- **Top “Scan repository”** and **bottom “New repository”** are not the same action, but they are related:
  - **Top:** “Scan repository” appears only when the workspace is empty; it **loads** a repo into the current workspace.
  - **Bottom:** “New repository” **clears** the workspace and sends you to the landing page; from there you **also** “Scan repository” (on the landing card) to load a repo.
- So after clearing, “scan a new repo” happens on the **landing** page, not in the sidebar. The bottom action is really “start a **new workspace**” (clear and optionally load another repo), not “new repository” in the Git sense. Renaming the bottom action to **“New workspace”** would better match behavior and set the stage for “open other saved workspaces” (e.g. dropdown) later.

---

### 5. **Saved workspaces (implemented)**
- The server already **persists** a workspace + graph per scan (when the user is signed in) in `workspaces` and `graphs` tables. **Implemented:** The bottom control is "New workspace ▾" with a drop-up: "Start new workspace" and "Open saved" list (load via GET /api/workspaces/:id/load). If not signed in: "Sign in to see saved workspaces."
- (Superseded: bottom control now **“New workspace”** with a **dropdown / drop-up**: primary = “New workspace” (clear + go to landing), secondary = “Open saved…” (list of saved workspaces for the user). That would avoid repetition with “scan repo” and make “scan” the way you **load** a repo into the current (or a new) workspace.

---

## Recommended changes (implemented or to implement)

1. **Rename workspace**  
   - Allow the user to rename the current workspace (edit `graph.projectName`).  
   - e.g. Click-to-edit on the card title, or a “Rename” control; App updates graph with `setGraph(prev => prev ? { ...prev, projectName: newName } : null)`.

2. **Rename bottom action and dialog**  
   - Button: **“New repository”** → **“New workspace”**.  
   - Dialog: **“Start a new repository?”** → **“Start a new workspace?”** and keep the rest: “This will clear your current graph, chat history, and violations.” Optionally add: “You can then scan a different repository or start from scratch.”

3. **Later: dropdown / “Open saved”**  
   - When we add “open saved workspace” UI, the bottom control can be a dropdown: “New workspace” (current behavior) + “Open saved…” (list of user’s workspaces). No change to “Scan repository” at top or on landing; scan remains how you **load** a repo into a workspace.
