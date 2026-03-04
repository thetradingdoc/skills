# Architecture Visualizer — Vision for Solution Architects

**Version:** 1.0  
**Last Updated:** February 2026  
**Audience:** Solution architects visualizing codebase structure and layers

---

## 1. Goal

Build a tool that lets solution architects **visually explore their codebase as a layered, clustered architecture map** — with a chat interface to ask questions and an AI agent that understands the architecture.

---

## 2. User Journey (Must-Have)

1. **Sign in (easy)** — Simple auth (e.g., OAuth, magic link).
2. **Connect GitHub** — Connect GitHub account and select a repo.
3. **Agent chat** — A chat UI (similar to Cursor) to ask questions about the codebase. The model has access to the repo content.
4. **Architecture map** — A large, interactive ReactFlow canvas showing layers, clusters, and color-coded modules.

Code lives in GitHub → we need GitHub to run the analysis. Without repo access, we cannot visualize or reason about the architecture.

---

## 3. UI Layout

| Region | Content |
|--------|---------|
| **Left** | Simple prompt chat — ask questions, get answers from the AI (with repo context). |
| **Right / Center** | Large ReactFlow canvas — nodes as modules/layers, edges as dependencies, color-coded by role/status. |
| **Optional side panels** | Project overview, module list, Flow Observer–style stats. |

Inspired by the reference image: 3D-like stacked nodes, clusters, color codes (green = healthy, yellow = warning, red = error), and interconnections.

---

## 4. Platform Strategy

- **Build the web app first** — Easier to iterate, test, and demo. No VS Code dependency for core UX.
- **VS Code extension later** — Once the web app works, wrap or reuse it as an extension for in-editor use.

---

## 5. Tech Choices (For Now)

| Concern | Choice |
|---------|--------|
| Auth | TBD — easy sign-in (OAuth, magic link, etc.) |
| Repo access | GitHub OAuth + repo clone/fetch or GitHub API |
| AI model | **OpenAI** — add key to `.env` |
| Visualization | ReactFlow — nodes, edges, ELK layout |
| Styling | Layered/clustered look, color codes |

---

## 6. Out of Scope (v1)

- Multi-root / monorepo combined graph
- Runtime events (Flow Observer live sessions)
- 3D rendering (2D ReactFlow with depth cues is acceptable)
- Other model providers (OpenAI only for now)

---

## 7. Success Criteria

- Sign in with one click.
- Connect a GitHub repo.
- See an interactive architecture map (clusters, layers, color codes).
- Chat with an AI that answers architecture questions using the repo content.
