/**
 * Mirror of webapp/client/src/nodeLabel.ts for scanner/enricher (no cross-package import).
 * Keep logic in sync when changing trading-chat disambiguation.
 */
import type { ArchGraph, ArchNode } from "../types";

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

export function refineNodeDisplayLabel(node: ArchNode): string {
  const current = (node.suggestedLabel ?? node.role ?? node.label ?? node.id).trim();
  const b = blob(node);
  const mentionsTradingChat =
    /trading-chat|trading\/chat|trading chat/.test(b) || /^trading chat$/i.test(current);

  if (!mentionsTradingChat) return current;

  if (/trading-chat-service/.test(b)) {
    return "Trading Chat Service";
  }

  if (
    /routes\/trading-chat/.test(b) ||
    (/middleware-platform\/routes/.test(b) && /trading-chat/.test(b))
  ) {
    return "Trading Chat API";
  }

  if (
    /unified-dashboard/.test(b) ||
    (/\/trading\/trading-chat\.js/.test(b) && !/routes\//.test(b))
  ) {
    return "Trading Chat UI";
  }

  if (
    /(^|\/)trading$/i.test(node.id.replace(/\\/g, "/")) &&
    /trading-chat\.js/.test(b) &&
    !/routes\//.test(b)
  ) {
    return "Trading Chat UI";
  }

  if (/trading chat (ui|api|service)$/i.test(current)) return current;

  return current;
}

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
