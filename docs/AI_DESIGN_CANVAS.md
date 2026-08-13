# AI design canvas

**Product surface name:** AI design canvas  
**Metaphor:** agent system design — compose and manage an AI agent visually.

## Primary job

Help a non-dev (and a developer who doesn’t want Cursor-only text) **design and manage an agent system** on a persistent canvas:

- Agent · Brain (LLM) · Memory / RAG · Tools · Strategies · Channels (e.g. Retell) · Data · Eval
- Place pieces by **drag (Components)** or **chat (Accept / Reject)**
- Same catalog for both inputs

**Acceptance story:** “Trading agent: Agent + RAG + strategies + channel via drag **or** chat.”

## Secondary job

Someone stuck in n8n / Retell / another low-code tool asks “where is the issue?”  

- Import their graph → same canvas → **Insights** + highlight the break  
- blanko shows structure; Claude/Cursor alone only give text

## Explicit non-goals (v1 / Phase 5)

- Replace **n8n Execute** / full automation IDE
- Replace **Retell** conversation-state / transition editor
- **ArchiMate swimlanes** (PRESENTATION / BUSINESS LOGIC / …) as the default design surface — Architecture is an optional lens only
- Full OAuth so nodes **run** integrations from blanko

**Connect** = bind for design & tracking. **Run** stays in n8n / Retell / cloud / app.

## Chrome on the canvas

Keep: floating Search · Save · Share · bell · Export; floating chat (collapsed by default).  
Right wall (control panel overlays): **Components · Insights · Terminal · Config** — closed until clicked.  
Inspect: floating overlay on place/double-click (blanko theme), not a second dock behind it.  
Left scene: collapsed by default for full-bleed canvas.  
Do **not** put Unsaved / node count / Health / Analyze as mid-canvas status chrome.  
Staleness / Rescan: scan graphs only.

**Config:** Review (Agents · Layers · Reach · Flow · Usage · Guard · Review doc) · Workspace (Files · Platforms · Rollup · Changes) · 3D / Canvas.  
Click Config again while away from the 2d canvas to return. Terminal is wall-only (not under Files).

## Related

Plan: `blanko_ui_redesign_7dc1a53b` — Phase 5 Gates 0–10.  
Shell: floating control wall — Components · Insights · Terminal · Config; Inspect overlay.

