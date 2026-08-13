/**
 * Deterministic display labels when scan/enrich would collapse distinct modules
 * into the same friendly name (e.g. two "Trading Chat" cards).
 */
import type { ArchGraph, ArchNode } from "./types";

function blob(node: Pick<ArchNode, "id" | "path" | "label" | "suggestedLabel" | "files">): string {
  return [
    node.id,
    node.path ?? "",
    node.label ?? "",
    node.suggestedLabel ?? "",
    ...(node.files ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\\/g, "/");
}

/**
 * Prefer path/file evidence over whatever AI or basename labeling produced.
 * - unified-dashboard trading-chat.js → Trading Chat UI (browser app)
 * - middleware routes/trading-chat.js → Trading Chat API (HTTP ingress)
 * - trading-chat-service.js → Trading Chat Service
 */
export function refineNodeDisplayLabel(node: ArchNode): string {
  const current = (node.suggestedLabel ?? node.role ?? node.label ?? node.id).trim();
  const b = blob(node);
  const mentionsTradingChat =
    /trading-chat|trading\/chat|trading chat/.test(b) || /^trading chat$/i.test(current);

  if (!mentionsTradingChat) return current;

  if (/trading-chat-service/.test(b)) {
    return "Trading Chat Service";
  }

  // Express route module (API), not the browser page.
  if (
    /routes\/trading-chat/.test(b) ||
    (/middleware-platform\/routes/.test(b) && /trading-chat/.test(b))
  ) {
    return "Trading Chat API";
  }

  // Browser / dashboard UI.
  if (
    /unified-dashboard/.test(b) ||
    (/\/trading\/trading-chat\.js/.test(b) && !/routes\//.test(b))
  ) {
    return "Trading Chat UI";
  }

  // Folder basename "trading" that only holds the dashboard chat script.
  if (
    /(^|\/)trading$/i.test(node.id.replace(/\\/g, "/")) &&
    /trading-chat\.js/.test(b) &&
    !/routes\//.test(b)
  ) {
    return "Trading Chat UI";
  }

  // Already disambiguated.
  if (/trading chat (ui|api|service)$/i.test(current)) return current;

  // Ambiguous "Trading Chat" with no path signal — leave as-is.
  return current;
}

/** Apply UI/API/Service disambiguation across a graph (idempotent). */
export function refineGraphNodeLabels(graph: ArchGraph): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const next = refineNodeDisplayLabel(node);
      const prev = (node.suggestedLabel ?? node.role ?? node.label ?? "").trim();
      if (next === prev) return node;
      const roleWasLabel =
        !node.role ||
        node.role === node.suggestedLabel ||
        node.role === node.label ||
        /^trading chat$/i.test(node.role);
      return {
        ...node,
        suggestedLabel: next,
        label: next,
        ...(roleWasLabel ? { role: next } : {}),
      };
    }),
  };
}
