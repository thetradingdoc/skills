/**
 * Post-V1 — polymorphic node property schemas.
 *
 * Different design-palette pieces (database, queue, cache, agent, ...) need
 * different structured config fields. This registry maps a node to the
 * PropertyField list the inspector should render, backed by the free-form
 * `ArchNode.properties` bag (see types.ts).
 *
 * Matching order in `schemaForNode`:
 *   1. Palette id inferred from the node's id (e.g. "design-postgres-...").
 *   2. Label hints (agent / auth / safety) for chat-authored or renamed nodes.
 *   3. techKind fallback (scanned/materialized nodes that carry a TechKind
 *      but no design-palette-shaped id).
 *   4. Unknown — empty field list.
 */
import { DESIGN_PALETTE } from "./greenfieldDesign";
import type { TechKind } from "./types";

export type PropertyFieldType = "string" | "number" | "boolean" | "enum";

export interface PropertyField {
  key: string;
  label: string;
  type: PropertyFieldType;
  /** Only present when type === "enum". */
  options?: string[];
  placeholder?: string;
  defaultValue?: string | number | boolean;
}

export interface NodePropertySchema {
  id: string;
  fields: PropertyField[];
}

const DATABASE_SCHEMA: NodePropertySchema = {
  id: "database",
  fields: [
    {
      key: "connectionString",
      label: "Connection string",
      type: "string",
      placeholder: "postgres://user:pass@host:5432/db",
    },
    { key: "schemaName", label: "Schema name", type: "string", placeholder: "public" },
    { key: "primaryKey", label: "Primary key", type: "string", placeholder: "id" },
  ],
};

const HTTP_API_SCHEMA: NodePropertySchema = {
  id: "http-api",
  fields: [
    { key: "basePath", label: "Base path", type: "string", placeholder: "/api/v1" },
    {
      key: "authType",
      label: "Auth type",
      type: "enum",
      options: ["none", "apiKey", "jwt", "oauth"],
      defaultValue: "none",
    },
    { key: "openApiRef", label: "OpenAPI ref", type: "string", placeholder: "openapi.yaml" },
  ],
};

const QUEUE_SCHEMA: NodePropertySchema = {
  id: "queue",
  fields: [
    { key: "topic", label: "Topic", type: "string", placeholder: "orders.created" },
    { key: "consumerGroup", label: "Consumer group", type: "string", placeholder: "orders-worker" },
    { key: "dlqTopic", label: "DLQ topic", type: "string", placeholder: "orders.created.dlq" },
  ],
};

const CACHE_SCHEMA: NodePropertySchema = {
  id: "cache",
  fields: [
    { key: "ttlSeconds", label: "TTL (seconds)", type: "number", placeholder: "300" },
    { key: "keyPrefix", label: "Key prefix", type: "string", placeholder: "app:cache:" },
  ],
};

const AGENT_SCHEMA: NodePropertySchema = {
  id: "agent",
  fields: [
    {
      key: "systemPromptHint",
      label: "System prompt hint",
      type: "string",
      placeholder: "You are a helpful support agent...",
    },
    { key: "maxTokens", label: "Max tokens", type: "number", placeholder: "2048" },
    { key: "temperature", label: "Temperature", type: "number", placeholder: "0.7" },
  ],
};

const CHANNEL_SCHEMA: NodePropertySchema = {
  id: "channel",
  fields: [
    {
      key: "retellAgentId",
      label: "Retell agent id",
      type: "string",
      placeholder: "agent_…",
    },
    {
      key: "webhookHint",
      label: "Webhook / callback hint",
      type: "string",
      placeholder: "https://…/retell-webhook",
    },
  ],
};

const STRATEGY_SCHEMA: NodePropertySchema = {
  id: "strategy",
  fields: [
    {
      key: "strategyName",
      label: "Strategy name",
      type: "string",
      placeholder: "mean-reversion / booking-policy",
    },
    {
      key: "notes",
      label: "Notes",
      type: "string",
      placeholder: "When to use this playbook",
    },
  ],
};

const TOOL_SCHEMA: NodePropertySchema = {
  id: "tool",
  fields: [
    {
      key: "toolKind",
      label: "Tool kind",
      type: "enum",
      options: ["calendar", "sheets", "email", "custom"],
      defaultValue: "custom",
    },
    {
      key: "endpointHint",
      label: "Endpoint / action",
      type: "string",
      placeholder: "create_event / append_row",
    },
  ],
};

const AUTH_SCHEMA: NodePropertySchema = {
  id: "auth",
  fields: [
    {
      key: "protocol",
      label: "Protocol",
      type: "enum",
      options: ["oidc", "saml", "apiKey"],
      defaultValue: "oidc",
    },
    { key: "issuerUrl", label: "Issuer URL", type: "string", placeholder: "https://issuer.example.com" },
  ],
};

const UNKNOWN_SCHEMA: NodePropertySchema = { id: "unknown", fields: [] };

/** Design-palette id -> schema. Covers every palette id these tasks call out plus the
 * palette's other real-tech synonyms (e.g. "s3" stays unknown — not called out). */
const PALETTE_ID_SCHEMA: Record<string, NodePropertySchema> = {
  database: DATABASE_SCHEMA,
  postgres: DATABASE_SCHEMA,
  db: DATABASE_SCHEMA,
  "vector-db": DATABASE_SCHEMA,
  "http-api": HTTP_API_SCHEMA,
  api: HTTP_API_SCHEMA,
  queue: QUEUE_SCHEMA,
  kafka: QUEUE_SCHEMA,
  cache: CACHE_SCHEMA,
  redis: CACHE_SCHEMA,
  agent: AGENT_SCHEMA,
  auth: AUTH_SCHEMA,
  safety: AUTH_SCHEMA,
  "retell-channel": CHANNEL_SCHEMA,
  "api-channel": HTTP_API_SCHEMA,
  strategy: STRATEGY_SCHEMA,
  tool: TOOL_SCHEMA,
  llm: AGENT_SCHEMA,
  memory: CACHE_SCHEMA,
};

const TECH_KIND_SCHEMA: Partial<Record<TechKind, NodePropertySchema>> = {
  database: DATABASE_SCHEMA,
  cache: CACHE_SCHEMA,
  queue: QUEUE_SCHEMA,
  "message-bus": QUEUE_SCHEMA,
  "http-api": HTTP_API_SCHEMA,
};

/** Longest-first so "vector-db" isn't shadowed by the shorter "db" palette id. */
const PALETTE_IDS_BY_LENGTH_DESC = [...DESIGN_PALETTE].map((p) => p.id).sort((a, b) => b.length - a.length);

function paletteIdFromNodeId(nodeId: string | undefined): string | undefined {
  if (!nodeId) return undefined;
  for (const id of PALETTE_IDS_BY_LENGTH_DESC) {
    if (nodeId === id || nodeId.startsWith(`design-${id}-`) || nodeId.startsWith(`${id}-`)) {
      return id;
    }
  }
  return undefined;
}

export function schemaForNode(node: {
  techKind?: string;
  kind?: string;
  id?: string;
  label?: string;
}): NodePropertySchema {
  const paletteId = paletteIdFromNodeId(node.id);
  if (paletteId && PALETTE_ID_SCHEMA[paletteId]) {
    return PALETTE_ID_SCHEMA[paletteId];
  }

  const label = ` ${node.label ?? ""} `.toLowerCase();
  if (node.kind === "agent" || /\bagent\b/.test(label)) {
    return AGENT_SCHEMA;
  }
  if (/\bauth\b|\bsafety\b/.test(label)) {
    return AUTH_SCHEMA;
  }

  if (node.techKind && TECH_KIND_SCHEMA[node.techKind as TechKind]) {
    return TECH_KIND_SCHEMA[node.techKind as TechKind]!;
  }

  return UNKNOWN_SCHEMA;
}
