/**
 * Phase 1 greenfield — design graph helpers.
 * Chat + palette DnD write the same ArchGraph DAG (no virtual/materialize layer).
 */

import type {
  ArchEdge,
  ArchGraph,
  ArchNode,
  EdgeRelation,
  GraphCommand,
  NodeLayer,
  TechKind,
} from "./types";

export type DesignPaletteGroup =
  | "Agent"
  | "Brain"
  | "Memory & RAG"
  | "Tools"
  | "Strategies"
  | "Channels"
  | "Data"
  | "Eval"
  | "Ops";

export interface DesignPaletteItem {
  id: string;
  label: string;
  layer: NodeLayer | string;
  techKind?: TechKind;
  description: string;
  group: DesignPaletteGroup;
}

/**
 * AI design canvas catalog. Ids are stable — chat/session drafts and
 * saved workspaces reference them, so existing ids are never renamed, only added to.
 */
export const DESIGN_PALETTE: DesignPaletteItem[] = [
  // Agent
  { id: "agent", label: "Agent", layer: "Reasoning", description: "AI agent or orchestrator that plans and calls tools.", group: "Agent" },

  // Brain
  { id: "llm", label: "LLM", layer: "Reasoning", description: "Hosted model call (OpenAI, Anthropic, etc.) the agent reasons with.", group: "Brain" },

  // Memory & RAG
  { id: "memory", label: "Memory store", layer: "Memory", description: "Conversation/session memory the agent reads before tool dispatch.", group: "Memory & RAG" },
  { id: "vector-db", label: "Vector DB / RAG", layer: "Memory", techKind: "database", description: "Embeddings store for semantic search / RAG retrieval.", group: "Memory & RAG" },

  // Tools
  { id: "tool", label: "Tool", layer: "External Services", techKind: "external-saas", description: "A capability the agent can call (calendar, sheets, email, custom API).", group: "Tools" },

  // Strategies
  { id: "strategy", label: "Strategy", layer: "Reasoning", description: "A named decision policy or trading/playbook module the agent uses.", group: "Strategies" },

  // Channels
  { id: "retell-channel", label: "Voice (Retell)", layer: "Presentation", techKind: "external-saas", description: "Voice channel — callers talk to Retell; blanko designs the agent behind it.", group: "Channels" },
  { id: "api-channel", label: "API / Webhook", layer: "Presentation", techKind: "http-api", description: "HTTP API or webhook channel into the agent system.", group: "Channels" },
  { id: "frontend", label: "Frontend", layer: "Presentation", techKind: "web-ui", description: "Web or client UI users interact with.", group: "Channels" },
  { id: "api", label: "API / Gateway", layer: "Presentation", techKind: "http-api", description: "HTTP API or gateway other services call.", group: "Channels" },

  // Data
  { id: "db", label: "Database", layer: "Data Access", techKind: "database", description: "Primary datastore for application records.", group: "Data" },
  { id: "postgres", label: "Postgres", layer: "Data Access", techKind: "database", description: "Relational database — strong consistency, SQL queries.", group: "Data" },
  { id: "cache", label: "Cache", layer: "Memory", techKind: "cache", description: "Cache or session store for hot data.", group: "Data" },
  { id: "redis", label: "Redis", layer: "Memory", techKind: "cache", description: "In-memory store for caching, sessions, or rate limits.", group: "Data" },
  { id: "s3", label: "Object storage (S3)", layer: "Infrastructure", techKind: "object-storage", description: "Blob storage for files, uploads, and backups.", group: "Data" },

  // Eval
  { id: "eval", label: "Eval harness", layer: "Evaluation", description: "Quality gate / eval suite that scores this agent before release.", group: "Eval" },

  // Ops (secondary)
  { id: "auth", label: "Auth", layer: "Safety", description: "Authentication / identity — who is making the request.", group: "Ops" },
  { id: "mobile", label: "Mobile app", layer: "Presentation", techKind: "mobile-app", description: "Native or cross-platform mobile client.", group: "Ops" },
  { id: "load-balancer", label: "Load balancer", layer: "Infrastructure", techKind: "generic-service", description: "Distributes traffic across service instances.", group: "Ops" },
  { id: "queue", label: "Queue", layer: "Infrastructure", techKind: "queue", description: "Async job or message queue to buffer work.", group: "Ops" },
  { id: "kafka", label: "Kafka", layer: "Infrastructure", techKind: "message-bus", description: "Distributed event log for high-throughput streaming.", group: "Ops" },
  { id: "worker", label: "Worker", layer: "Infrastructure", techKind: "generic-service", description: "Background process that consumes queued jobs.", group: "Ops" },
  { id: "external", label: "External", layer: "External Services", techKind: "external-saas", description: "Third-party service your system depends on.", group: "Ops" },
  { id: "stripe", label: "Stripe", layer: "External Services", techKind: "external-saas", description: "Payment processing and billing.", group: "Ops" },
  { id: "cdn", label: "CDN", layer: "Infrastructure", techKind: "generic-service", description: "Edge caching for static assets close to users.", group: "Ops" },
];

export const DESIGN_DND_MIME = "application/x-littlelabs-design-palette";

export const EDGE_RELATIONS: EdgeRelation[] = [
  "calls",
  "uses",
  "retrieves",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "authenticates_via",
  "caches",
  "depends_on",
  "channel_to",
];

export const DEFAULT_DESIGN_RELATION: EdgeRelation = "uses";

export function relationLabel(relation: EdgeRelation | undefined): string {
  if (!relation) return "calls";
  return relation.replace(/_/g, " ");
}

export function createBlankDesignGraph(projectName = "New Design"): ArchGraph {
  return {
    nodes: [],
    edges: [],
    generatedAt: Date.now(),
    projectRoot: "",
    projectName,
  };
}

export function isDesignGraph(graph: ArchGraph | null | undefined): boolean {
  if (!graph) return false;
  if (graph.architectureBoard) return true;
  return !(graph.projectRoot && graph.projectRoot.trim());
}

export function createDesignArchNode(opts: {
  id: string;
  label: string;
  layer?: string;
  description?: string;
  path?: string;
  techKind?: TechKind;
  position?: { x: number; y: number };
  buildStatus?: "planned" | "building" | "built";
}): ArchNode {
  return {
    id: opts.id,
    label: opts.label,
    path: opts.path ?? opts.id,
    layer: opts.layer ?? "Uncategorized",
    description: opts.description,
    summary: opts.description,
    files: [],
    health: { hasDocs: false, hasTests: false, hasContext: false },
    semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
    status: "new",
    isDrift: false,
    techKind: opts.techKind,
    position: opts.position,
    buildStatus: opts.buildStatus ?? "planned",
  };
}

export function createDesignEdge(opts: {
  fromId: string;
  toId: string;
  edgeType?: ArchEdge["type"];
  relation?: EdgeRelation;
}): ArchEdge {
  return {
    id: `edge-${opts.fromId}-${opts.toId}`,
    source: opts.fromId,
    target: opts.toId,
    type: opts.edgeType ?? "import",
    relation: opts.relation ?? DEFAULT_DESIGN_RELATION,
    isDrift: false,
    importance: "architectural",
  };
}

/** Apply design graphCommands into ArchGraph (source of truth). */
export function applyDesignCommandsToGraph(
  graph: ArchGraph,
  commands: GraphCommand[]
): ArchGraph {
  let nodes = [...graph.nodes];
  let edges = [...graph.edges];
  let changed = false;

  for (const cmd of commands) {
    if (cmd.action === "create_node") {
      if (nodes.some((n) => n.id === cmd.id)) continue;
      nodes.push(
        createDesignArchNode({
          id: cmd.id,
          label: cmd.label,
          layer: cmd.layer,
          description: cmd.description,
          path: cmd.archNodeId ?? cmd.id,
        })
      );
      changed = true;
    } else if (cmd.action === "connect") {
      const exists = edges.some(
        (e) => e.source === cmd.fromId && e.target === cmd.toId
      );
      if (exists) continue;
      if (!nodes.some((n) => n.id === cmd.fromId) || !nodes.some((n) => n.id === cmd.toId)) {
        continue;
      }
      edges.push(
        createDesignEdge({
          fromId: cmd.fromId,
          toId: cmd.toId,
          edgeType: cmd.edgeType,
          relation: cmd.relation ?? DEFAULT_DESIGN_RELATION,
        })
      );
      changed = true;
    } else if (cmd.action === "update_node") {
      const idx = nodes.findIndex((n) => n.id === cmd.id);
      if (idx < 0) continue;
      const prev = nodes[idx]!;
      nodes[idx] = {
        ...prev,
        ...(cmd.label !== undefined ? { label: cmd.label } : {}),
        ...(cmd.layer !== undefined ? { layer: cmd.layer } : {}),
        ...(cmd.description !== undefined
          ? { description: cmd.description, summary: cmd.description }
          : {}),
      };
      changed = true;
    } else if (cmd.action === "reset") {
      // Design-safe: clear highlights only at App level; do not wipe graph here.
    }
  }

  if (!changed) return graph;
  return { ...graph, nodes, edges, generatedAt: Date.now() };
}

export function updateDesignNode(
  graph: ArchGraph,
  nodeId: string,
  patch: Partial<
    Pick<
      ArchNode,
      | "label"
      | "layer"
      | "description"
      | "platformBindings"
      | "llmProvider"
      | "cloudProvider"
      | "llmops"
      | "properties"
      | "requiredEnv"
      | "deployHealth"
    >
  >
): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id !== nodeId
        ? n
        : {
            ...n,
            ...(patch.label !== undefined ? { label: patch.label } : {}),
            ...(patch.layer !== undefined ? { layer: patch.layer } : {}),
            ...(patch.description !== undefined
              ? { description: patch.description, summary: patch.description }
              : {}),
            ...(patch.platformBindings !== undefined ? { platformBindings: patch.platformBindings } : {}),
            ...(patch.llmProvider !== undefined ? { llmProvider: patch.llmProvider } : {}),
            ...(patch.cloudProvider !== undefined ? { cloudProvider: patch.cloudProvider } : {}),
            ...(patch.llmops !== undefined ? { llmops: patch.llmops } : {}),
            ...(patch.properties !== undefined ? { properties: patch.properties } : {}),
            ...(patch.requiredEnv !== undefined ? { requiredEnv: patch.requiredEnv } : {}),
            ...(patch.deployHealth !== undefined ? { deployHealth: patch.deployHealth } : {}),
          }
    ),
    generatedAt: Date.now(),
  };
}

export function updateDesignEdge(
  graph: ArchGraph,
  edgeId: string,
  patch: { relation?: EdgeRelation }
): ArchGraph {
  return {
    ...graph,
    edges: graph.edges.map((e) =>
      e.id !== edgeId
        ? e
        : {
            ...e,
            ...(patch.relation !== undefined ? { relation: patch.relation } : {}),
          }
    ),
    generatedAt: Date.now(),
  };
}

/** Persist a drag/drop position onto a design node (workstream E: trust / starting points). */
export function setDesignNodePosition(
  graph: ArchGraph,
  nodeId: string,
  position: { x: number; y: number }
): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id !== nodeId ? n : { ...n, position })),
    generatedAt: Date.now(),
  };
}

/** Apply a computed layout (e.g. computeLayerLayout) back onto every node's stored position. */
export function applyPositionsToGraph(
  graph: ArchGraph,
  positions: Map<string, { x: number; y: number }>
): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }),
    generatedAt: Date.now(),
  };
}

/** Set a node's build-plan status (workstream D). */
export function setDesignNodeBuildStatus(
  graph: ArchGraph,
  nodeId: string,
  buildStatus: "planned" | "building" | "built"
): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id !== nodeId ? n : { ...n, buildStatus })),
    generatedAt: Date.now(),
  };
}

export function deleteDesignNode(graph: ArchGraph, nodeId: string): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    generatedAt: Date.now(),
  };
}

export function deleteDesignEdge(graph: ArchGraph, edgeId: string): ArchGraph {
  return {
    ...graph,
    edges: graph.edges.filter((e) => e.id !== edgeId),
    generatedAt: Date.now(),
  };
}

export function paletteItemToNode(
  paletteId: string,
  dropIndex = 0,
  position?: { x: number; y: number }
): ArchNode | null {
  const item = DESIGN_PALETTE.find((p) => p.id === paletteId);
  if (!item) return null;
  const id = `design-${item.id}-${Date.now()}-${dropIndex}`;
  return createDesignArchNode({
    id,
    label: item.label,
    layer: item.layer,
    description: item.description,
    techKind: item.techKind,
    position,
  });
}

/** Place any Build catalog id (core palette or integration). */
export function buildItemToNode(
  item: {
    id: string;
    label: string;
    layer: string;
    description: string;
    techKind?: TechKind;
    providerId?: string;
  },
  dropIndex = 0,
  position?: { x: number; y: number }
): ArchNode {
  const id = `design-${item.id}-${Date.now()}-${dropIndex}`;
  const node = createDesignArchNode({
    id,
    label: item.label,
    layer: item.layer,
    description: item.description,
    techKind: item.techKind,
    position,
  });
  if (item.providerId) {
    return {
      ...node,
      platformBindings: [
        {
          providerId: item.providerId,
          status: "unbound",
          source: "declared",
          evidence: `build:${item.id}`,
        },
      ],
      llmProvider: item.providerId,
    };
  }
  return node;
}

export function draftNodesToArchNodes(
  nodes: Array<{
    id?: string;
    label?: string;
    layer?: string;
    description?: string;
    archNodeId?: string;
    buildStatus?: "planned" | "building" | "built";
    position?: { x: number; y: number };
  }>
): ArchNode[] {
  return nodes
    .filter((n) => n && typeof n.id === "string")
    .map((n) =>
      createDesignArchNode({
        id: n.id!,
        label: typeof n.label === "string" ? n.label : n.id!,
        layer: typeof n.layer === "string" ? n.layer : undefined,
        description: typeof n.description === "string" ? n.description : undefined,
        path: typeof n.archNodeId === "string" ? n.archNodeId : n.id!,
        buildStatus: n.buildStatus,
        position: n.position,
      })
    );
}

export function draftEdgesToArchEdges(
  edges: Array<{
    source?: string;
    target?: string;
    fromId?: string;
    toId?: string;
    relation?: EdgeRelation;
  }>
): ArchEdge[] {
  return edges
    .map((e) => {
      const fromId = e.fromId ?? e.source;
      const toId = e.toId ?? e.target;
      if (typeof fromId !== "string" || typeof toId !== "string") return null;
      return createDesignEdge({
        fromId,
        toId,
        relation: e.relation ?? DEFAULT_DESIGN_RELATION,
      });
    })
    .filter((e): e is ArchEdge => !!e);
}
