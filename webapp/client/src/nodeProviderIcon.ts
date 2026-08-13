/**
 * Resolve a catalog provider id for a canvas node so ProviderIcon can render.
 */
import type { ArchNode } from "./types";
import { primaryBinding } from "./platformInventory";
import { canonicalizeProviderId, getProvider, PROVIDER_CATALOG } from "./providerCatalog";

const TECH_TO_PROVIDER: Record<string, string> = {
  redis: "redis",
  postgres: "postgresql",
  postgresql: "postgresql",
  mongodb: "mongodb",
  kafka: "kafka",
  kubernetes: "kubernetes",
  docker: "docker",
  openai: "openai",
  anthropic: "anthropic",
  slack: "slack",
  n8n: "n8n",
  stripe: "stripe",
  supabase: "supabase",
  pinecone: "pinecone",
  aws: "aws",
  azure: "azure",
  gcp: "gcp",
  googlecloud: "gcp",
  http: "generic",
  webhook: "n8n",
  "google-sheets": "google-sheets",
  googlesheets: "google-sheets",
  sheets: "google-sheets",
  calendar: "google",
  gmail: "google",
  twilio: "twilio",
  airtable: "airtable",
  github: "github",
  react: "react",
};

const LABEL_HINTS: Array<{ re: RegExp; id: string }> = [
  { re: /slack/i, id: "slack" },
  { re: /openai|chatgpt|gpt/i, id: "openai" },
  { re: /anthropic|claude/i, id: "anthropic" },
  { re: /postgres|postgresql|pg\b/i, id: "postgresql" },
  { re: /redis/i, id: "redis" },
  { re: /mongo/i, id: "mongodb" },
  { re: /stripe/i, id: "stripe" },
  { re: /supabase/i, id: "supabase" },
  { re: /google\s*sheet|sheets/i, id: "google-sheets" },
  { re: /gmail|google\s*cal|calendar/i, id: "google" },
  { re: /github/i, id: "github" },
  { re: /twilio/i, id: "twilio" },
  { re: /airtable/i, id: "airtable" },
  { re: /kafka/i, id: "kafka" },
  { re: /docker/i, id: "docker" },
  { re: /kubernetes|k8s/i, id: "kubernetes" },
  { re: /aws|bedrock|lambda/i, id: "aws" },
  { re: /azure/i, id: "azure" },
  { re: /gcp|google\s*cloud/i, id: "gcp" },
  { re: /webhook|n8n|respond to webhook/i, id: "n8n" },
  { re: /pinecone/i, id: "pinecone" },
  { re: /langchain|langgraph/i, id: "langchain" },
  { re: /\breact\b|frontend|next\.?js/i, id: "react" },
  { re: /telegram|trading[\s_-]?chat|execute[\s_-]?turn/i, id: "telegram" },
];

export function resolveNodeProviderId(node: ArchNode | null | undefined): string | null {
  if (!node) return null;

  const binding = primaryBinding(node);
  if (binding?.providerId) {
    return canonicalizeProviderId(binding.providerId) ?? binding.providerId;
  }

  if (node.iconKey) {
    const fromIcon =
      canonicalizeProviderId(node.iconKey) ?? TECH_TO_PROVIDER[node.iconKey.toLowerCase()];
    if (fromIcon && getProvider(fromIcon)) return fromIcon;
  }

  if (node.llmProvider) {
    const fromLlm = canonicalizeProviderId(node.llmProvider);
    if (fromLlm) return fromLlm;
  }

  if (node.cloudProvider && node.cloudProvider !== "unknown") {
    const fromCloud =
      canonicalizeProviderId(node.cloudProvider) ??
      TECH_TO_PROVIDER[String(node.cloudProvider).toLowerCase()];
    if (fromCloud && getProvider(fromCloud)) return fromCloud;
  }

  const tech = String(node.techKind ?? "").toLowerCase();
  if (TECH_TO_PROVIDER[tech] && getProvider(TECH_TO_PROVIDER[tech])) {
    return TECH_TO_PROVIDER[tech];
  }

  const hay = `${node.label ?? ""} ${node.role ?? ""} ${node.id ?? ""} ${(node.files ?? []).join(" ")} ${(node.tags ?? []).join(" ")}`;
  for (const hint of LABEL_HINTS) {
    if (hint.re.test(hay) && getProvider(hint.id)) return hint.id;
  }

  for (const p of PROVIDER_CATALOG) {
    if (hay.toLowerCase().includes(p.id) || hay.toLowerCase().includes(p.name.toLowerCase())) {
      return p.id;
    }
  }

  // Design palette kinds → generic mark still renders via fallback emoji in node
  return null;
}
