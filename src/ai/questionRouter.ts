/**
 * questionRouter.ts
 *
 * Step 1 of the retrieval pipeline.
 * Classifies the question's intent and identifies which nodes and file paths
 * are most relevant — WITHOUT calling the LLM. Pure heuristic.
 *
 * This replaces "send the whole graph every time" with
 * "identify what matters for this question, then send that."
 */

import * as path from "path";
import type { ArchGraph, ArchitectureChatHistory, ArchNode, ContractFinding } from "../types";

export type QuestionIntent =
  | "debug"
  | "trace_flow"
  | "show_layer"
  | "explain_node"
  | "violations"
  | "drift"
  | "overview"
  | "general";

export interface RouteResult {
  intent: QuestionIntent;
  relevantNodeIds: string[];
  filesToRead: string[];
  relevantFindings: ContractFinding[];
  keywords: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_./]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreNode(node: ArchNode, keywords: string[]): number {
  const haystack = [
    node.id,
    node.label,
    node.suggestedLabel ?? "",
    node.description ?? "",
    node.layer ?? "",
    ...(node.semanticSignals?.exports ?? []),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += kw.length;
  }
  return score;
}

function scoreFinding(finding: ContractFinding, keywords: string[]): number {
  const haystack = `${finding.description} ${finding.location} ${finding.evidence.join(" ")}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += 1;
  }
  return score;
}

function classifyIntent(question: string): QuestionIntent {
  const q = question.toLowerCase();

  if (/bug|broken|not work|fail|error|missing|why isn|issue|wrong/.test(q)) return "debug";
  if (/violat/.test(q)) return "violations";
  if (/drift/.test(q)) return "drift";
  if (/how.*reach|flow|trace|path from|end.to.end|request.*response/.test(q)) return "trace_flow";
  if (/show|filter|highlight|layer/.test(q)) return "show_layer";
  if (/overview|architecture|structure|what does.*repo|what is this/.test(q)) return "overview";
  if (/what does|tell me about|explain|describe/.test(q)) return "explain_node";

  return "general";
}

export function routeQuestion(
  question: string,
  graph: ArchGraph,
  findings: ContractFinding[],
  focusedNodeId?: string,
  history?: ArchitectureChatHistory
): RouteResult {
  const intent = classifyIntent(question);
  const historyKeywords = (history ?? [])
    .slice(-3)
    .flatMap((h) => tokenize(h.content))
    .slice(0, 20);
  const keywords = [...tokenize(question), ...historyKeywords];

  const forcedNodes = focusedNodeId
    ? graph.nodes.filter((n) => n.id === focusedNodeId)
    : [];

  const scored = graph.nodes.map((n) => ({ node: n, score: scoreNode(n, keywords) }));
  scored.sort((a, b) => b.score - a.score);

  const MAX_NODES = 6;
  const topNodes = scored
    .filter((s) => s.score > 0 && !forcedNodes.some((f) => f.id === s.node.id))
    .slice(0, MAX_NODES)
    .map((s) => s.node);

  const relevantNodes = [...forcedNodes, ...topNodes];

  let neighbourNodes: ArchNode[] = [];
  if (intent === "debug" || intent === "trace_flow") {
    const relevantIds = new Set(relevantNodes.map((n) => n.id));
    const neighbourIds = new Set<string>();
    for (const edge of graph.edges) {
      if (relevantIds.has(edge.source)) neighbourIds.add(edge.target);
      if (relevantIds.has(edge.target)) neighbourIds.add(edge.source);
    }
    neighbourNodes = graph.nodes.filter(
      (n) => neighbourIds.has(n.id) && !relevantIds.has(n.id)
    );
  }

  const allRelevantNodes = [...relevantNodes, ...neighbourNodes].slice(0, 10);

  const root = graph.projectRoot;
  const filesToRead: string[] = [];
  for (const node of allRelevantNodes.slice(0, 4)) {
    const preferred = node.files
      .filter((f) => /\.(ts|tsx|py)$/.test(f) && !/\.test\.|\.spec\./.test(f))
      .slice(0, 2);
    for (const f of preferred) {
      const fullPath = path.join(root, f);
      if (!filesToRead.includes(fullPath)) filesToRead.push(fullPath);
    }
  }

  if (intent === "debug") {
    for (const finding of findings.filter((f) => f.severity === "critical").slice(0, 3)) {
      const loc = path.isAbsolute(finding.location)
        ? finding.location
        : path.join(root, finding.location);
      if (!filesToRead.includes(loc)) filesToRead.push(loc);
    }
  }

  const scoredFindings = findings.map((f) => ({ finding: f, score: scoreFinding(f, keywords) }));
  scoredFindings.sort((a, b) => {
    if (a.finding.severity === "critical" && b.finding.severity !== "critical") return -1;
    if (b.finding.severity === "critical" && a.finding.severity !== "critical") return 1;
    return b.score - a.score;
  });

  const relevantFindings =
    intent === "debug" || intent === "general"
      ? scoredFindings.slice(0, 15).map((s) => s.finding)
      : scoredFindings.filter((s) => s.score > 0).slice(0, 8).map((s) => s.finding);

  return {
    intent,
    relevantNodeIds: allRelevantNodes.map((n) => n.id),
    filesToRead: filesToRead.slice(0, 6),
    relevantFindings,
    keywords,
  };
}
