/**
 * Map n8n node types → layer / techKind / providerId / kind / cost center hints.
 */

import type { NodeKind, NodeLayer, TechKind } from "../../../../src/types.js";

export type CostCenterKind = "llm" | "sms" | "http" | "saas" | "unknown";

export type TaxonomyHit = {
  layer: NodeLayer;
  techKind: TechKind;
  providerId?: string;
  kind?: NodeKind;
  costCenterKind?: CostCenterKind;
  isTrigger?: boolean;
  iconKey?: string;
};

const BASE: Record<string, TaxonomyHit> = {
  webhook: {
    layer: "Presentation",
    techKind: "http-api",
    isTrigger: true,
    iconKey: "http",
  },
  respondToWebhook: { layer: "Presentation", techKind: "http-api", iconKey: "http" },
  httpRequest: {
    layer: "External Services",
    techKind: "http-api",
    costCenterKind: "http",
    iconKey: "http",
  },
  set: { layer: "Business Logic", techKind: "generic-service" },
  code: { layer: "Business Logic", techKind: "generic-service" },
  function: { layer: "Business Logic", techKind: "generic-service" },
  if: { layer: "Orchestration", techKind: "generic-service" },
  switch: { layer: "Orchestration", techKind: "generic-service" },
  merge: { layer: "Orchestration", techKind: "generic-service" },
  splitInBatches: { layer: "Orchestration", techKind: "generic-service" },
  wait: { layer: "Orchestration", techKind: "generic-service" },
  filter: { layer: "Business Logic", techKind: "generic-service" },
  noOp: { layer: "Utilities", techKind: "generic-service" },
  stickyNote: { layer: "Utilities", techKind: "unknown" },
  executeWorkflow: { layer: "Orchestration", techKind: "generic-service", kind: "orchestrator" },
  errorTrigger: { layer: "Safety", techKind: "generic-service", isTrigger: true },
  scheduleTrigger: {
    layer: "Orchestration",
    techKind: "generic-service",
    isTrigger: true,
  },
  manualTrigger: {
    layer: "Orchestration",
    techKind: "generic-service",
    isTrigger: true,
  },
  cron: { layer: "Orchestration", techKind: "generic-service", isTrigger: true },
  twilio: {
    layer: "External Services",
    techKind: "external-saas",
    providerId: "twilio",
    costCenterKind: "sms",
    iconKey: "twilio",
  },
  slack: {
    layer: "External Services",
    techKind: "external-saas",
    providerId: "slack",
    costCenterKind: "saas",
    iconKey: "slack",
  },
  airtable: {
    layer: "Data Access",
    techKind: "external-saas",
    providerId: "airtable",
    costCenterKind: "saas",
    iconKey: "airtable",
  },
  googleSheets: {
    layer: "Data Access",
    techKind: "external-saas",
    providerId: "google_sheets",
    costCenterKind: "saas",
    iconKey: "google_sheets",
  },
  postgres: { layer: "Data Access", techKind: "database", providerId: "postgresql" },
  redis: { layer: "Data Access", techKind: "cache", providerId: "redis" },
  openAi: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "openai",
    kind: "agent",
    costCenterKind: "llm",
    iconKey: "openai",
  },
};

const LANGCHAIN: Record<string, TaxonomyHit> = {
  agent: { layer: "Reasoning", techKind: "generic-service", kind: "agent", costCenterKind: "llm" },
  agentTool: { layer: "Reasoning", techKind: "generic-service", kind: "agent" },
  toolWorkflow: { layer: "Orchestration", techKind: "generic-service", kind: "orchestrator" },
  toolHttpRequest: {
    layer: "External Services",
    techKind: "http-api",
    costCenterKind: "http",
  },
  toolCode: { layer: "Business Logic", techKind: "generic-service" },
  lmChatOpenAi: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "openai",
    kind: "agent",
    costCenterKind: "llm",
    iconKey: "openai",
  },
  lmChatAnthropic: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "anthropic",
    kind: "agent",
    costCenterKind: "llm",
    iconKey: "anthropic",
  },
  lmChatAwsBedrock: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "bedrock",
    kind: "agent",
    costCenterKind: "llm",
  },
  lmChatGoogleGemini: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "google",
    kind: "agent",
    costCenterKind: "llm",
  },
  lmChatGroq: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "groq",
    kind: "agent",
    costCenterKind: "llm",
  },
  lmChatMistralCloud: {
    layer: "Reasoning",
    techKind: "external-saas",
    providerId: "mistral",
    kind: "agent",
    costCenterKind: "llm",
  },
  memoryBufferWindow: { layer: "Memory", techKind: "generic-service", kind: "infra" },
  memoryPostgresChat: { layer: "Memory", techKind: "database", kind: "infra" },
};

const HOST_PROVIDER: Array<{ host: RegExp; providerId: string }> = [
  { host: /cal\.com|api\.cal\.com/i, providerId: "calcom" },
  { host: /api\.twilio\.com/i, providerId: "twilio" },
  { host: /hooks\.slack\.com|slack\.com/i, providerId: "slack" },
  { host: /api\.airtable\.com/i, providerId: "airtable" },
  { host: /googleapis\.com|sheets\.googleapis/i, providerId: "google_sheets" },
  { host: /api\.openai\.com/i, providerId: "openai" },
  { host: /api\.anthropic\.com/i, providerId: "anthropic" },
];

export function shortType(n8nType: string): string {
  const base = n8nType.replace(/^n8n-nodes-base\./, "");
  const lc = n8nType.replace(/^@n8n\/n8n-nodes-langchain\./, "");
  if (base !== n8nType) return base;
  if (lc !== n8nType) return lc;
  return n8nType.split(".").pop() ?? n8nType;
}

export function lookupTaxonomy(n8nType: string): TaxonomyHit {
  const short = shortType(n8nType);
  if (n8nType.includes("n8n-nodes-langchain") || n8nType.includes("@n8n/n8n-nodes-langchain")) {
    return (
      LANGCHAIN[short] ?? {
        layer: "Reasoning",
        techKind: "generic-service",
        kind: "agent",
      }
    );
  }
  return (
    BASE[short] ?? {
      layer: "Uncategorized",
      techKind: "unknown",
    }
  );
}

export function providerFromHttpUrl(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  for (const { host, providerId } of HOST_PROVIDER) {
    if (host.test(url)) return providerId;
  }
  return undefined;
}

export function isStickyType(n8nType: string): boolean {
  return shortType(n8nType) === "stickyNote";
}

export function isTriggerType(n8nType: string, tax?: TaxonomyHit): boolean {
  if (tax?.isTrigger) return true;
  const s = shortType(n8nType).toLowerCase();
  return (
    s.includes("trigger") ||
    s === "webhook" ||
    s === "cron" ||
    s === "schedule" ||
    s === "manualtrigger"
  );
}
