/**
 * P1 assisted design loop — workstream C: static "explain in place" knowledge base.
 *
 * Pure data + lookup helpers. No network, no React. Keyed by palette id (see
 * DESIGN_PALETTE in greenfieldDesign.ts) so both chat-created and
 * drag-created nodes resolve to the same explanations by matching on label
 * text and layer, the same way designRules.ts classifies nodes.
 */
import type { ArchNode, EdgeRelation } from "./types";

export interface DesignKnowledgeEntry {
  /** Plain-language: what this component is. */
  explanation: string;
  /** Plain-language: why a design like this usually needs one. */
  whyHere: string;
  /** Palette ids this component usually sits next to. */
  typicalNeighbours: string[];
  /** Real-world technology examples a beginner could actually pick. */
  realTechnologies: string[];
  /** Mistakes people commonly make when adding this piece. */
  commonMistakes: string[];
  /** Plain-language: what breaks if this piece is missing from the design. */
  breaksWithout: string;
  /** Suggested architectural layer when none is set yet. */
  defaultLayer: string;
}

export const DESIGN_KNOWLEDGE: Record<string, DesignKnowledgeEntry> = {
  auth: {
    explanation: "Auth verifies who is making a request — logging in, sessions, tokens — before anything else runs.",
    whyHere: "Any system with users or a public API needs a single place that answers \"who is this?\" so the rest of the system can trust the answer.",
    typicalNeighbours: ["api", "db"],
    realTechnologies: ["Auth0", "Supabase Auth", "AWS Cognito", "Keycloak", "Passport.js"],
    commonMistakes: [
      "Checking auth inside every route handler instead of one shared layer.",
      "Storing passwords or tokens in plain text instead of hashed/short-lived.",
      "Forgetting to also protect internal service-to-service calls.",
    ],
    breaksWithout: "Anyone can call your API as anyone else — there's no way to know who's making a request, so permissions and audit trails are meaningless.",
    defaultLayer: "Safety",
  },
  api: {
    explanation: "The API (or gateway) is the front door for requests — it validates input, enforces rules, and routes work to the right place.",
    whyHere: "It's the one place you can safely put permission checks, rate limits, and logging in front of everything behind it.",
    typicalNeighbours: ["auth", "db", "cache"],
    realTechnologies: ["Express", "FastAPI", "NestJS", "AWS API Gateway", "Kong"],
    commonMistakes: [
      "Letting a frontend talk straight to the database, bypassing this layer.",
      "Putting business logic in route handlers instead of a service layer behind the API.",
      "Skipping input validation because \"the frontend already validates it.\"",
    ],
    breaksWithout: "Clients have nowhere safe to send requests — every client would need direct, unguarded access to your data and services.",
    defaultLayer: "Presentation",
  },
  telegram: {
    explanation:
      "Telegram is a chat ingress — humans send commands and messages to a bot; the agent replies in the same thread. It is not a generic REST API.",
    whyHere:
      "Traders already live in Telegram. The bot is the verified channel into Identity → Policy → Execution; cash never moves from a chat message alone.",
    typicalNeighbours: ["auth", "agent", "api"],
    realTechnologies: ["Telegram Bot API", "long-poll bot", "telegraf", "grammy"],
    commonMistakes: [
      "Treating a chat id as a verified identity without allowlist / email enrolment.",
      "Letting the LLM submit broker orders from a Telegram turn (propose-only must hold).",
    ],
    breaksWithout: "There is no human command path into the trading agent — research and paper actions stay unreachable from chat.",
    defaultLayer: "Presentation",
  },
  "trading-chat": {
    explanation:
      "Trading Chat splits into UI (browser page under unified-dashboard) and API (Express route under middleware-platform/routes). Labels should read Trading Chat UI vs Trading Chat API.",
    whyHere:
      "Useful for demos and research without Telegram. Same agent turn path as Telegram, but anonymous and research-only.",
    typicalNeighbours: ["agent", "auth", "api"],
    realTechnologies: ["POST /api/trading/chat/turn", "Express", "localStorage session", "unified-dashboard/trading/trading-chat.js"],
    commonMistakes: [
      "Assuming web session ids are verified identities (they are claims under web:).",
      "Expecting paper-wallet commands on the anonymous web path.",
      "Treating the dashboard UI module and the routes module as the same canvas card.",
    ],
    breaksWithout: "Browser users have no way to talk to the trading agent — only Telegram (if configured) remains.",
    defaultLayer: "Presentation",
  },
  frontend: {
    explanation: "The frontend is what a person actually sees and clicks — a web page or app UI.",
    whyHere: "Every product with a human user needs a presentation layer that renders data and captures input.",
    typicalNeighbours: ["api", "auth"],
    realTechnologies: ["React", "Next.js", "Vue", "SvelteKit"],
    commonMistakes: [
      "Calling the database or internal services directly instead of going through an API.",
      "Storing secrets (API keys, service credentials) in frontend code — anything shipped to a browser is public.",
    ],
    breaksWithout: "There's no way for a person to actually use the system — it's just backend services with nothing to interact with.",
    defaultLayer: "Presentation",
  },
  mobile: {
    explanation: "A native or cross-platform mobile client — the phone/tablet equivalent of a frontend.",
    whyHere: "When users are primarily on phones, a mobile client talks to the same backend APIs a web frontend would.",
    typicalNeighbours: ["api", "auth"],
    realTechnologies: ["React Native", "Swift/SwiftUI", "Kotlin", "Flutter"],
    commonMistakes: [
      "Embedding long-lived secrets in the app binary — it can be decompiled.",
      "Assuming app store release cycles let you patch bugs as fast as a web deploy.",
    ],
    breaksWithout: "Mobile users have no way to reach the system — you'd be web-only even though the design implies mobile support.",
    defaultLayer: "Presentation",
  },
  "load-balancer": {
    explanation: "A load balancer spreads incoming traffic across multiple copies of a service so no single instance gets overwhelmed.",
    whyHere: "Once you run more than one instance of a service for reliability or scale, something has to decide which instance handles each request.",
    typicalNeighbours: ["api", "frontend"],
    realTechnologies: ["AWS ALB/ELB", "NGINX", "HAProxy", "Cloudflare Load Balancing"],
    commonMistakes: [
      "Adding one before you actually have more than one service instance to balance across.",
      "Forgetting health checks, so it keeps sending traffic to a dead instance.",
    ],
    breaksWithout: "Traffic has to land on one fixed instance — if it goes down or gets overloaded, everything behind it becomes unreachable.",
    defaultLayer: "Infrastructure",
  },

  db: {
    explanation: "The database is where your application's durable data lives — users, orders, whatever the system needs to remember.",
    whyHere: "Almost every non-trivial system needs somewhere to persist state between requests and across restarts.",
    typicalNeighbours: ["api", "cache", "queue"],
    realTechnologies: ["PostgreSQL", "MySQL", "MongoDB", "DynamoDB"],
    commonMistakes: [
      "Letting the frontend query it directly instead of going through an API.",
      "No backups or migrations strategy before the first real user shows up.",
    ],
    breaksWithout: "Nothing persists — every restart or deploy would wipe all your data back to zero.",
    defaultLayer: "Data Access",
  },
  postgres: {
    explanation: "Postgres is a relational database: data lives in tables with defined relationships, and you query it with SQL.",
    whyHere: "Great default choice when your data has clear structure and relationships (users have orders, orders have line items, etc.) and you need strong consistency.",
    typicalNeighbours: ["api", "cache"],
    realTechnologies: ["Postgres (self-hosted)", "Supabase", "Amazon RDS", "Neon"],
    commonMistakes: [
      "Missing indexes on columns you filter/join on, so queries slow down as data grows.",
      "Running long transactions that hold locks and block other writers.",
    ],
    breaksWithout: "Without a relational store, you lose transactional guarantees — related records (e.g. an order and its payment) can end up inconsistent.",
    defaultLayer: "Data Access",
  },
  cache: {
    explanation: "A cache stores recently-used or expensive-to-compute data in fast memory so you don't hit the database every time.",
    whyHere: "Once traffic grows, repeatedly reading the same rarely-changing data from the database wastes time and load.",
    typicalNeighbours: ["api", "db"],
    realTechnologies: ["Redis", "Memcached", "CDN edge cache"],
    commonMistakes: [
      "Caching data that changes constantly, so users see stale results.",
      "No invalidation strategy — cached data never gets refreshed when the source changes.",
    ],
    breaksWithout: "Every request re-does the full, expensive work — the system stays correct but gets slower and more expensive as traffic grows.",
    defaultLayer: "Memory",
  },
  redis: {
    explanation: "Redis is an in-memory key-value store, commonly used for caching, session storage, rate limiting, or lightweight pub/sub.",
    whyHere: "When you need sub-millisecond reads/writes for small pieces of data — sessions, hot cache entries, counters — Redis is the standard pick.",
    typicalNeighbours: ["api", "db"],
    realTechnologies: ["Redis (self-hosted)", "Upstash", "AWS ElastiCache"],
    commonMistakes: [
      "Treating it as a durable primary datastore — by default it's memory-first, not built for that.",
      "Storing large blobs in it instead of small hot keys, blowing memory budgets.",
    ],
    breaksWithout: "Sessions, rate limits, or hot-path lookups fall back to the primary database on every request, adding latency and load.",
    defaultLayer: "Memory",
  },
  s3: {
    explanation: "Object storage holds files — uploads, images, exports, backups — as blobs addressed by a key, not rows in a database.",
    whyHere: "Databases are bad at storing large binary files efficiently; object storage is built for exactly that, cheaply and durably.",
    typicalNeighbours: ["api", "cdn"],
    realTechnologies: ["Amazon S3", "Cloudflare R2", "Google Cloud Storage"],
    commonMistakes: [
      "Storing uploaded files as blobs in the database, bloating it and slowing backups.",
      "Making buckets public by default instead of scoping access per-object.",
    ],
    breaksWithout: "You'd need to store files directly in the database or on a single server's disk — neither scales or survives a redeploy cleanly.",
    defaultLayer: "Infrastructure",
  },
  "vector-db": {
    explanation: "A vector database stores embeddings (numeric representations of meaning) so you can search by semantic similarity, not exact match.",
    whyHere: "Needed whenever an agent or search feature does retrieval-augmented generation (RAG) — finding the most relevant chunks of text for a query.",
    typicalNeighbours: ["agent", "llm"],
    realTechnologies: ["Pinecone", "pgvector (Postgres extension)", "Weaviate", "Qdrant"],
    commonMistakes: [
      "Re-embedding the same content on every request instead of caching embeddings.",
      "No re-ranking step, so the first \"similar\" result isn't actually the best answer.",
    ],
    breaksWithout: "The agent can't find relevant context beyond what fits in a single prompt — retrieval-based answers become guesses.",
    defaultLayer: "Memory",
  },

  queue: {
    explanation: "A queue holds work items so a producer and a consumer don't have to run at the same time or speed.",
    whyHere: "Anything slow, unreliable, or bursty (emails, webhooks, external API calls) should be handed off instead of blocking the request that triggered it.",
    typicalNeighbours: ["worker", "db"],
    realTechnologies: ["AWS SQS", "RabbitMQ", "Redis-backed queues (BullMQ)"],
    commonMistakes: [
      "Writing straight to the database on the hot path instead of queueing the write.",
      "No dead-letter handling, so failed jobs silently vanish.",
    ],
    breaksWithout: "Every write or slow task blocks the request that triggered it — a burst of traffic overwhelms the database or a flaky external call times out the whole request.",
    defaultLayer: "Infrastructure",
  },
  kafka: {
    explanation: "Kafka is a distributed event log — producers append events, and any number of consumers can read the stream independently, at their own pace.",
    whyHere: "Picked over a simple queue when multiple independent services need to react to the same event, or you need to replay history.",
    typicalNeighbours: ["worker", "db"],
    realTechnologies: ["Apache Kafka", "Confluent Cloud", "Amazon MSK", "Redpanda"],
    commonMistakes: [
      "Reaching for Kafka when a simple queue (one producer, one consumer) would do — it's heavier to operate.",
      "Not planning topic/partition keys up front, making later re-partitioning painful.",
    ],
    breaksWithout: "Services can't independently subscribe to the same event stream — you'd need direct point-to-point calls between every producer and every consumer.",
    defaultLayer: "Infrastructure",
  },
  worker: {
    explanation: "A worker is a background process that pulls jobs off a queue and executes them outside the request/response cycle.",
    whyHere: "Pairs with a queue: something has to actually do the deferred work (send the email, resize the image, call the slow API).",
    typicalNeighbours: ["queue", "db"],
    realTechnologies: ["Sidekiq", "Celery", "BullMQ workers", "AWS Lambda (event-driven)"],
    commonMistakes: [
      "Not making job handlers idempotent, so retries cause duplicate side effects.",
      "No visibility/monitoring into queue depth or failed jobs.",
    ],
    breaksWithout: "Jobs pile up in the queue with nothing to process them — background work never actually completes.",
    defaultLayer: "Infrastructure",
  },

  agent: {
    explanation: "An agent is the orchestrator that decides what to do next — it plans, calls tools, and loops until the task is done.",
    whyHere: "Whenever you want the system to make multi-step decisions (not just answer one prompt), something needs to own that loop.",
    typicalNeighbours: ["llm", "memory", "eval", "vector-db", "api"],
    realTechnologies: ["LangGraph", "OpenAI Assistants/Agents SDK", "Custom tool-calling loop"],
    commonMistakes: [
      "No limit on tool-call loops, so a confused agent can spin forever (and burn tokens/cost).",
      "Giving the agent tools with side effects (writes, payments) with no guardrail or human check.",
      "Shipping without Memory or an Eval harness — drift from design goes unnoticed.",
    ],
    breaksWithout: "There's nothing coordinating multi-step reasoning — you'd be limited to single-shot prompt/response with no tool use.",
    defaultLayer: "Reasoning",
  },
  memory: {
    explanation: "Conversation or session memory the agent reads before tool dispatch — history that survives a single turn.",
    whyHere: "Without memory, every turn starts cold and the agent cannot refer to prior context.",
    typicalNeighbours: ["agent", "llm"],
    realTechnologies: ["Redis session store", "Postgres conversation table", "LangChain Memory"],
    commonMistakes: [
      "Storing PHI/money in memory without retention or redaction policy.",
      "Memory that nothing on the agent path actually reads.",
    ],
    breaksWithout: "The agent cannot recall prior turns — each request is amnesiac.",
    defaultLayer: "Memory",
  },
  eval: {
    explanation: "A quality gate / eval suite that scores the agent before release.",
    whyHere: "Without evals, regressions in tool use or safety ship silently.",
    typicalNeighbours: ["agent"],
    realTechnologies: ["Promptfoo", "LangSmith evals", "Custom assert harness"],
    commonMistakes: [
      "Eval suites that never import the agent they claim to test.",
      "No threshold — scores are recorded but never fail the gate.",
    ],
    breaksWithout: "You cannot tell whether a change made the agent better or worse before it hits users.",
    defaultLayer: "Evaluation",
  },
  llm: {
    explanation: "A hosted model call — the actual reasoning/generation step an agent or feature relies on.",
    whyHere: "It's the thing that turns a prompt (plus retrieved context) into an answer, a plan, or a tool call.",
    typicalNeighbours: ["agent", "vector-db"],
    realTechnologies: ["OpenAI API", "Anthropic API", "Google Gemini", "Self-hosted (Ollama, vLLM)"],
    commonMistakes: [
      "No fallback or retry when the provider has an outage or rate-limits you.",
      "Sending sensitive data in prompts without checking the provider's data-retention policy.",
    ],
    breaksWithout: "There's no actual reasoning/generation happening — the agent has a plan but nothing to think with.",
    defaultLayer: "Reasoning",
  },

  external: {
    explanation: "A third-party service your system calls out to instead of building yourself.",
    whyHere: "Common for payments, email, SMS, maps, or anything not worth reinventing.",
    typicalNeighbours: ["api", "queue"],
    realTechnologies: ["Stripe", "Twilio", "SendGrid", "Google Maps API"],
    commonMistakes: [
      "Calling it synchronously on the hot path with no timeout, so its outage becomes your outage.",
      "No fallback when it's your only external dependency and it's down.",
    ],
    breaksWithout: "The feature it powers just doesn't exist — there's no other way to email, charge cards, or send SMS without it.",
    defaultLayer: "External Services",
  },
  stripe: {
    explanation: "Stripe handles payment processing and billing so you don't touch raw card data yourself.",
    whyHere: "Needed the moment the product charges money — subscriptions, one-off payments, or marketplace payouts.",
    typicalNeighbours: ["api", "queue"],
    realTechnologies: ["Stripe Checkout", "Stripe Billing", "Stripe Connect"],
    commonMistakes: [
      "Trusting client-side payment confirmation instead of verifying via webhook.",
      "Not handling webhook retries/idempotency, causing double-charges or missed events.",
    ],
    breaksWithout: "You'd have to handle raw card data and payment compliance (PCI) yourself — expensive, risky, and usually not worth building.",
    defaultLayer: "External Services",
  },
  strategy: {
    explanation:
      "Strategy turns market/news context into a proposed action (signal) — it does not place orders.",
    whyHere: "Separates research/signal generation from policy gates and broker execution on the money path.",
    typicalNeighbours: ["agent", "policy", "auth"],
    realTechnologies: ["PEAD", "signal-engine", "generate_signal tool"],
    commonMistakes: [
      "Letting strategy call the broker directly.",
      "Mixing research allowlists with execution submit tools.",
    ],
    breaksWithout: "The agent has no disciplined signal layer — chat jumps straight toward risk/execution.",
    defaultLayer: "Reasoning",
  },
  policy: {
    explanation: "Policy is the gate that allows, blocks, or rewrites a proposed trade before risk sizing.",
    whyHere: "Money-path safety: propose-only tools stop here; policy owns hard rules (hours, symbols, mode).",
    typicalNeighbours: ["strategy", "risk", "auth"],
    realTechnologies: ["policy service", "LIVE0", "propose-only guard"],
    commonMistakes: [
      "Bypassing policy from Telegram or chat.",
      "Encoding broker submit inside policy.",
    ],
    breaksWithout: "Signals reach risk/execution without rule checks — paper or live cash is unprotected.",
    defaultLayer: "Safety",
  },
  risk: {
    explanation: "Risk sizes and caps exposure (Kelly, max notional, concentration) after policy allows a proposal.",
    whyHere: "Even an allowed signal can be oversized — risk owns how much, not whether.",
    typicalNeighbours: ["policy", "execution", "auth"],
    realTechnologies: ["Kelly sizing", "risk service", "position limits"],
    commonMistakes: [
      "Treating risk as optional on paper mode.",
      "Letting the LLM invent size without the risk module.",
    ],
    breaksWithout: "Allowed proposals can oversize accounts with no independent check.",
    defaultLayer: "Safety",
  },
  execution: {
    explanation:
      "Execution turns an approved plan into broker orders — the only place that may call submitOrder.",
    whyHere: "Keeps LLM tools propose-only; cash movement is a dedicated service with reconcile.",
    typicalNeighbours: ["risk", "broker", "auth"],
    realTechnologies: ["execution-service", "paper broker", "Alpaca submit"],
    commonMistakes: [
      "Exposing submit tools to the LLM allowlist.",
      "Skipping reconcile after fills.",
    ],
    breaksWithout: "There is no controlled path from approved proposal to a broker order.",
    defaultLayer: "Infrastructure",
  },
  broker: {
    explanation: "Broker (Alpaca paper/live, etc.) is the external venue that holds buying power and fills orders.",
    whyHere: "Execution needs a venue; UI bindings must not imply live readiness without credentials.",
    typicalNeighbours: ["execution", "auth"],
    realTechnologies: ["Alpaca", "paper broker stub", "Kraken (if configured)"],
    commonMistakes: [
      "Showing Bound when APCA_* keys are empty.",
      "Confusing Telegram paper wallet cash with Alpaca buying power.",
    ],
    breaksWithout: "Approved orders have nowhere to settle — trading stops at execution.",
    defaultLayer: "External Services",
  },
  payment: {
    explanation:
      "Payment / paper wallet tracks local paper cash (Telegram /fund) — not Stripe product billing.",
    whyHere: "Separates demo paper ledger from broker buying power and SaaS payments.",
    typicalNeighbours: ["auth", "broker", "execution"],
    realTechnologies: ["paper_wallets SQLite", "Telegram /fund", "wallet-service"],
    commonMistakes: [
      "Equating paper ledger balance with Alpaca cash.",
      "Allowing LLM tools to credit wallets.",
    ],
    breaksWithout: "Paper fund/withdraw UX has no ledger — demo cash cannot be tracked.",
    defaultLayer: "Data Access",
  },
  cdn: {
    explanation: "A CDN caches static content (assets, sometimes API responses) at edge locations close to users.",
    whyHere: "Cuts latency for users far from your origin server and offloads repeated requests from your backend.",
    typicalNeighbours: ["frontend", "s3"],
    realTechnologies: ["Cloudflare", "AWS CloudFront", "Fastly"],
    commonMistakes: [
      "Caching personalized/authenticated responses at the edge and leaking one user's data to another.",
      "No cache invalidation plan when assets change.",
    ],
    breaksWithout: "Every request — including for unchanging static assets — travels all the way to your origin server, which is slower and costs more at scale.",
    defaultLayer: "Infrastructure",
  },
};

const LABEL_KEY_HINTS: Array<{ key: string; hints: string[] }> = [
  { key: "postgres", hints: ["postgres", "postgresql"] },
  { key: "redis", hints: ["redis"] },
  { key: "s3", hints: ["s3", "object storage", "blob storage", "file storage"] },
  { key: "vector-db", hints: ["vector db", "vector-db", "vector database", "pinecone", "embeddings", "weaviate", "qdrant", "pgvector"] },
  { key: "kafka", hints: ["kafka"] },
  { key: "stripe", hints: ["stripe"] },
  { key: "cdn", hints: ["cdn", "content delivery"] },
  { key: "load-balancer", hints: ["load balancer", "load-balancer", " lb "] },
  { key: "worker", hints: ["worker", "background job"] },
  { key: "mobile", hints: ["mobile", "ios app", "android app"] },
  // Ingress before generic api/frontend so Presentation scan nodes don't get REST-API teach copy.
  { key: "telegram", hints: ["telegram", "tg bot", "telegram-bot"] },
  { key: "trading-chat", hints: ["trading chat", "trading-chat", "execute-turn", "execute turn"] },
  { key: "strategy", hints: ["strategy", "signal engine", "pead"] },
  { key: "policy", hints: ["policy engine", "policy"] },
  { key: "risk", hints: ["risk engine", "risk", "kelly"] },
  { key: "execution", hints: ["execution", "order router"] },
  { key: "broker", hints: ["alpaca", "broker", "kraken"] },
  { key: "payment", hints: ["paper wallet", "payment", "wallet"] },
  { key: "llm", hints: ["llm", "large language model", "gpt", "claude model", "openai", "language model"] },
  { key: "db", hints: ["database", " db", "db ", "mongo", "mysql", "dynamo", "sql"] },
  { key: "cache", hints: ["cache", "session store"] },
  { key: "queue", hints: ["queue", "message bus", "pubsub", "pub/sub", "sqs", "rabbitmq"] },
  { key: "auth", hints: ["auth", "identity", "iam", "oidc", "oauth"] },
  { key: "agent", hints: ["agent", "orchestrator"] },
  { key: "external", hints: ["external", "third-party", "third party", "saas"] },
  { key: "api", hints: ["api", "gateway", "endpoint", "backend"] },
  { key: "frontend", hints: ["frontend", "front-end", "client", "web ui", "web-ui", " ui", "browser", "app"] },
];

const LAYER_DEFAULT_KEY: Record<string, string> = {
  Safety: "auth",
  Presentation: "api",
  "Data Access": "db",
  Infrastructure: "queue",
  Memory: "cache",
  Reasoning: "agent",
  "External Services": "external",
};

/**
 * Resolve a design node to a DESIGN_KNOWLEDGE / DESIGN_PALETTE key.
 * The label is checked against every hint first — a clear label match (e.g.
 * "API Gateway") should win even if the free-form description happens to
 * mention another component (e.g. "…between frontend and database"). Only
 * once the label alone doesn't resolve anything do we widen the search to
 * include the description.
 */
export function resolveKnowledgeKey(
  node: Pick<ArchNode, "label" | "layer" | "description" | "techKind">
): string | undefined {
  const label = ` ${node.label ?? ""} `.toLowerCase();
  for (const { key, hints } of LABEL_KEY_HINTS) {
    if (hints.some((h) => label.includes(h))) return key;
  }
  const labelAndDescription = ` ${node.label ?? ""} ${node.description ?? ""} `.toLowerCase();
  for (const { key, hints } of LABEL_KEY_HINTS) {
    if (hints.some((h) => labelAndDescription.includes(h))) return key;
  }
  const layer = String(node.layer ?? "");
  return LAYER_DEFAULT_KEY[layer];
}

export function getDesignKnowledge(
  node: Pick<ArchNode, "label" | "layer" | "description" | "techKind">
): DesignKnowledgeEntry | undefined {
  const key = resolveKnowledgeKey(node);
  return key ? DESIGN_KNOWLEDGE[key] : undefined;
}

// ── Edge relation knowledge ────────────────────────────────────────────────

export interface RelationKnowledgeEntry {
  /** Plain-language: what this relation means. */
  meaning: string;
  /** Plain-language: what breaks if this edge is wrong or missing. */
  failureMode: string;
}

export const RELATION_KNOWLEDGE: Record<EdgeRelation, RelationKnowledgeEntry> = {
  calls: {
    meaning: "The source makes a request to the target and waits for a response (a normal request/response call).",
    failureMode: "If the target is slow or down, the source's request hangs or fails right along with it — there's no buffer between them.",
  },
  uses: {
    meaning: "The source relies on the target as part of how the agent system works (tools, strategies, models).",
    failureMode: "If the target isn't wired or fails, the agent can't complete that part of its job.",
  },
  retrieves: {
    meaning: "The source pulls context or knowledge from the target (typical RAG / memory path).",
    failureMode: "Without retrieval, the agent answers from the model alone — stale or missing domain knowledge.",
  },
  reads: {
    meaning: "The source fetches data from the target without changing it.",
    failureMode: "If the target is unavailable, the source has stale or no data to show — reads should usually have a cache or fallback.",
  },
  writes: {
    meaning: "The source persists or updates data in the target.",
    failureMode: "If this happens synchronously with no queue in front of it, a slow or overloaded target blocks every request that writes, and a failed write can silently lose data.",
  },
  publishes: {
    meaning: "The source emits an event or message without knowing (or caring) who consumes it.",
    failureMode: "If nothing is actually subscribed to the target, the event is emitted into the void — work you expect to happen silently never does.",
  },
  subscribes: {
    meaning: "The source listens for events or messages from the target and reacts when they arrive.",
    failureMode: "If the subscription drops or the consumer crashes, events pile up unprocessed and the source falls behind reality.",
  },
  authenticates_via: {
    meaning: "The source checks the caller's identity with the target before doing anything else.",
    failureMode: "Without this edge, the source has no way to verify who's calling it — it's effectively open to anyone.",
  },
  caches: {
    meaning: "The source stores a copy of data from elsewhere in the target so future reads are faster.",
    failureMode: "If there's no invalidation plan, users can see stale data forever after the source of truth changes.",
  },
  depends_on: {
    meaning: "The source needs the target to exist and work correctly, without a more specific relation.",
    failureMode: "If the target isn't built or is down, the source can't function correctly — treat this as a hard prerequisite.",
  },
  channel_to: {
    meaning: "A channel (voice, API, UI) delivers conversations or requests into the agent system.",
    failureMode: "If the channel isn't connected to an agent, callers have nowhere for their input to go.",
  },
};
