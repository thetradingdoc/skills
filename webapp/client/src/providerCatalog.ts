/**
 * P4 provider catalog — canonical platforms with icons (not just labels).
 *
 * Icons live in /public/provider-icons/*.svg (Simple Icons MIT where available;
 * small custom marks for brands missing from Simple Icons).
 */
export type ProviderCategory =
  | "llm"
  | "framework"
  | "cloud"
  | "data"
  | "observability"
  | "third_party"
  | "voice";

export type BindingStatus = "connected" | "missing_credentials" | "unknown" | "unbound";

export type ProviderDef = {
  id: string;
  name: string;
  category: ProviderCategory;
  /** Path under public/, e.g. /provider-icons/openai.svg */
  icon: string;
  /** Brand accent for badges (CSS color). */
  color: string;
  /** npm packages / import cues that imply this provider. */
  packages?: string[];
  /** Env var names that usually mean credentials exist. */
  credentialEnv?: string[];
  critical?: boolean;
  aliases?: string[];
};

export type PlatformBinding = {
  providerId: string;
  /** Optional account / project label the user recorded. */
  accountLabel?: string;
  status: BindingStatus;
  /** detected | declared — how we know about this binding */
  source: "detected" | "declared";
  evidence?: string;
};

/** Full catalog shown in inventory + bind picker. */
export const PROVIDER_CATALOG: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    category: "llm",
    icon: "/provider-icons/openai.svg",
    color: "#10A37F",
    packages: ["openai", "@langchain/openai"],
    credentialEnv: ["OPENAI_API_KEY"],
    critical: true,
    aliases: ["gpt", "chatgpt"],
  },
  {
    id: "anthropic",
    name: "Anthropic / Claude",
    category: "llm",
    icon: "/provider-icons/anthropic.svg",
    color: "#D4A27F",
    packages: ["@anthropic-ai/sdk", "@langchain/anthropic"],
    credentialEnv: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    critical: true,
    aliases: ["claude"],
  },
  {
    id: "google",
    name: "Google AI / Vertex",
    category: "llm",
    icon: "/provider-icons/google.svg",
    color: "#4285F4",
    packages: ["@google/generative-ai", "@google-cloud/vertexai"],
    credentialEnv: ["GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"],
    aliases: ["gemini", "vertex"],
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    category: "llm",
    icon: "/provider-icons/bedrock.svg",
    color: "#FF9900",
    packages: ["@aws-sdk/client-bedrock-runtime"],
    credentialEnv: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
    aliases: ["aws-bedrock"],
  },
  {
    id: "mistral",
    name: "Mistral",
    category: "llm",
    icon: "/provider-icons/mistral.svg",
    color: "#F7D046",
    packages: ["@mistralai/mistralai"],
    credentialEnv: ["MISTRAL_API_KEY"],
  },
  {
    id: "groq",
    name: "Groq",
    category: "llm",
    icon: "/provider-icons/groq.svg",
    color: "#F55036",
    packages: ["groq-sdk", "@langchain/groq"],
    credentialEnv: ["GROQ_API_KEY"],
  },
  {
    id: "cohere",
    name: "Cohere",
    category: "llm",
    icon: "/provider-icons/cohere.svg",
    color: "#39594D",
    packages: ["cohere-ai"],
    credentialEnv: ["COHERE_API_KEY"],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    category: "llm",
    icon: "/provider-icons/huggingface.svg",
    color: "#FFD21E",
    packages: ["@huggingface/inference"],
    credentialEnv: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
  },
  {
    id: "langchain",
    name: "LangChain",
    category: "framework",
    icon: "/provider-icons/langchain.svg",
    color: "#1C3C3C",
    packages: ["langchain", "@langchain/core"],
    critical: true,
    aliases: ["langsmith"],
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    category: "framework",
    icon: "/provider-icons/llamaindex.svg",
    color: "#8B5CF6",
    packages: ["llamaindex"],
  },
  {
    id: "vercel-ai",
    name: "Vercel AI SDK",
    category: "framework",
    icon: "/provider-icons/vercel-ai.svg",
    color: "#000000",
    packages: ["ai"],
    aliases: ["vercel"],
  },
  {
    id: "aws",
    name: "AWS",
    category: "cloud",
    icon: "/provider-icons/aws.svg",
    color: "#FF9900",
    packages: ["aws-sdk", "@aws-sdk/client-s3"],
    credentialEnv: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
    critical: true,
  },
  {
    id: "gcp",
    name: "Google Cloud",
    category: "cloud",
    icon: "/provider-icons/googlecloud.svg",
    color: "#4285F4",
    packages: ["@google-cloud/storage"],
    credentialEnv: ["GOOGLE_APPLICATION_CREDENTIALS"],
    aliases: ["googlecloud"],
  },
  {
    id: "azure",
    name: "Azure",
    category: "cloud",
    icon: "/provider-icons/azure.svg",
    color: "#0078D4",
    packages: ["@azure/identity", "@azure/openai"],
    credentialEnv: ["AZURE_CLIENT_ID", "AZURE_OPENAI_API_KEY"],
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "cloud",
    icon: "/provider-icons/vercel.svg",
    color: "#000000",
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "data",
    icon: "/provider-icons/supabase.svg",
    color: "#3ECF8E",
    packages: ["@supabase/supabase-js"],
    credentialEnv: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    category: "data",
    icon: "/provider-icons/postgresql.svg",
    color: "#4169E1",
    packages: ["pg", "postgres"],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "data",
    icon: "/provider-icons/mongodb.svg",
    color: "#47A248",
    packages: ["mongodb", "mongoose"],
  },
  {
    id: "redis",
    name: "Redis",
    category: "data",
    icon: "/provider-icons/redis.svg",
    color: "#DC382D",
    packages: ["ioredis", "redis"],
  },
  {
    id: "pinecone",
    name: "Pinecone",
    category: "data",
    icon: "/provider-icons/pinecone.svg",
    color: "#00C389",
    packages: ["@pinecone-database/pinecone"],
    credentialEnv: ["PINECONE_API_KEY"],
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "third_party",
    icon: "/provider-icons/stripe.svg",
    color: "#635BFF",
    packages: ["stripe"],
    credentialEnv: ["STRIPE_SECRET_KEY", "STRIPE_API_KEY"],
    // Not critical for every board — only surface when detected/declared.
  },
  {
    id: "alpaca",
    name: "Alpaca",
    category: "third_party",
    icon: "/provider-icons/generic.svg",
    color: "#FCD34D",
    packages: ["@alpacahq/alpaca-trade-api", "alpaca"],
    credentialEnv: ["ALPACA_API_KEY", "ALPACA_API_SECRET", "ALPACA_KEY_ID"],
    aliases: ["alpaca-markets", "alpaca markets"],
  },
  {
    id: "kraken",
    name: "Kraken",
    category: "third_party",
    icon: "/provider-icons/generic.svg",
    color: "#5741D9",
    packages: ["kraken-api", "kraken"],
    credentialEnv: ["KRAKEN_API_KEY", "KRAKEN_API_SECRET"],
    aliases: ["kraken-exchange"],
  },
  {
    id: "twilio",
    name: "Twilio",
    category: "third_party",
    icon: "/provider-icons/twilio.svg",
    color: "#F22F46",
    packages: ["twilio"],
    credentialEnv: ["TWILIO_AUTH_TOKEN"],
  },
  {
    id: "github",
    name: "GitHub",
    category: "third_party",
    icon: "/provider-icons/github.svg",
    color: "#181717",
    packages: ["@octokit/rest"],
    credentialEnv: ["GITHUB_TOKEN"],
  },
  {
    id: "slack",
    name: "Slack",
    category: "third_party",
    icon: "/provider-icons/slack.svg",
    color: "#4A154B",
    packages: ["@slack/web-api"],
  },
  {
    id: "datadog",
    name: "Datadog",
    category: "observability",
    icon: "/provider-icons/datadog.svg",
    color: "#632CA6",
    packages: ["dd-trace"],
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "observability",
    icon: "/provider-icons/sentry.svg",
    color: "#362D59",
    packages: ["@sentry/node", "@sentry/react"],
    credentialEnv: ["SENTRY_DSN"],
  },
  {
    id: "retell",
    name: "Retell",
    category: "voice",
    icon: "/provider-icons/retell.svg",
    color: "#6C47FF",
    packages: ["retell-ai"],
    credentialEnv: ["RETELL_API_KEY"],
  },
  {
    id: "livekit",
    name: "LiveKit",
    category: "voice",
    icon: "/provider-icons/livekit.svg",
    color: "#1FD5A3",
    packages: ["@livekit/agents", "livekit-server-sdk"],
    credentialEnv: ["LIVEKIT_API_KEY"],
  },
  {
    id: "docker",
    name: "Docker",
    category: "cloud",
    icon: "/provider-icons/docker.svg",
    color: "#2496ED",
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    category: "cloud",
    icon: "/provider-icons/kubernetes.svg",
    color: "#326CE5",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "cloud",
    icon: "/provider-icons/cloudflare.svg",
    color: "#F38020",
  },
  {
    id: "react",
    name: "React",
    category: "framework",
    icon: "/provider-icons/react.svg",
    color: "#61DAFB",
    packages: ["react", "react-dom"],
  },
  {
    id: "kafka",
    name: "Apache Kafka",
    category: "data",
    icon: "/provider-icons/kafka.svg",
    color: "#231F20",
    packages: ["kafkajs"],
    aliases: ["apachekafka", "apache-kafka"],
  },
  {
    id: "n8n",
    name: "n8n",
    category: "third_party",
    icon: "/provider-icons/n8n.svg",
    color: "#EA4B71",
    aliases: ["n8n-io"],
  },
  {
    id: "airtable",
    name: "Airtable",
    category: "third_party",
    icon: "/provider-icons/airtable.svg",
    color: "#18BFFF",
    packages: ["airtable"],
    credentialEnv: ["AIRTABLE_API_KEY"],
  },
  {
    id: "calcom",
    name: "Cal.com",
    category: "third_party",
    icon: "/provider-icons/calcom.svg",
    color: "#292929",
    aliases: ["cal.com", "cal"],
    credentialEnv: ["CAL_API_KEY"],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    category: "third_party",
    icon: "/provider-icons/google-sheets.svg",
    color: "#0F9D58",
    aliases: ["sheets", "gsheets"],
  },
];

const BY_ID = new Map(PROVIDER_CATALOG.map((p) => [p.id, p]));
const BY_ALIAS = new Map<string, ProviderDef>();
for (const p of PROVIDER_CATALOG) {
  BY_ALIAS.set(p.id.toLowerCase(), p);
  for (const a of p.aliases ?? []) BY_ALIAS.set(a.toLowerCase(), p);
  for (const pkg of p.packages ?? []) BY_ALIAS.set(pkg.toLowerCase(), p);
}

export function getProvider(idOrAlias: string | null | undefined): ProviderDef | null {
  if (!idOrAlias) return null;
  const key = idOrAlias.trim().toLowerCase();
  return BY_ID.get(key) ?? BY_ALIAS.get(key) ?? null;
}

export function providerIconSrc(idOrAlias: string | null | undefined): string {
  return getProvider(idOrAlias)?.icon ?? "/provider-icons/generic.svg";
}

export function providerDisplayName(idOrAlias: string | null | undefined): string {
  return getProvider(idOrAlias)?.name ?? (idOrAlias || "Unknown");
}

/** Normalize agent-inventory / llmProvider strings onto catalog ids. */
export function canonicalizeProviderId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = getProvider(raw);
  if (p) return p.id;
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return BY_ID.has(cleaned) ? cleaned : cleaned || null;
}

export function categoryLabel(c: ProviderCategory): string {
  switch (c) {
    case "llm":
      return "LLM";
    case "framework":
      return "Framework";
    case "cloud":
      return "Cloud";
    case "data":
      return "Data";
    case "observability":
      return "Observability";
    case "third_party":
      return "Third party";
    case "voice":
      return "Voice";
    default:
      return c;
  }
}

export function bindingStatusLabel(s: BindingStatus): string {
  switch (s) {
    case "connected":
      return "connected";
    case "missing_credentials":
      return "missing credentials";
    case "unknown":
      return "unknown";
    case "unbound":
      return "unbound";
    default:
      return s;
  }
}

export function bindingStatusColor(s: BindingStatus): string {
  switch (s) {
    case "connected":
      return "#3fb950";
    case "missing_credentials":
      return "#d29922";
    case "unknown":
      return "#8b949e";
    case "unbound":
      return "#f85149";
    default:
      return "#8b949e";
  }
}
