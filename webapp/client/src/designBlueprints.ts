/**
 * P1 assisted design loop — workstream E: forkable starting points.
 *
 * Six annotated, ready-to-fork designs so a blank canvas isn't the only way
 * to start. Pure data + a fork helper — no React, no network.
 */
import type { ArchGraph, ArchNode, EdgeRelation, TechKind } from "./types";
import { createDesignArchNode, createDesignEdge } from "./greenfieldDesign";

export interface DesignBlueprint {
  id: string;
  title: string;
  summary: string;
  notes: string[];
  graph: ArchGraph;
}

function bpNode(opts: {
  id: string;
  label: string;
  layer: string;
  description: string;
  x: number;
  y: number;
  techKind?: TechKind;
}): ArchNode {
  return {
    ...createDesignArchNode({
      id: opts.id,
      label: opts.label,
      layer: opts.layer,
      description: opts.description,
      techKind: opts.techKind,
      position: { x: opts.x, y: opts.y },
    }),
  };
}

function bpEdge(fromId: string, toId: string, relation: EdgeRelation) {
  return createDesignEdge({ fromId, toId, relation });
}

function graphOf(projectName: string, nodes: ArchNode[], edges: ReturnType<typeof bpEdge>[]): ArchGraph {
  return {
    nodes,
    edges,
    generatedAt: Date.now(),
    projectRoot: "",
    projectName,
  };
}

// ── Trading agent (AI design canvas flagship) ───────────────────────────────

const tradingAgent: DesignBlueprint = {
  id: "trading-agent",
  title: "Trading agent",
  summary:
    "Healthcare paper trading spine: Telegram → Identity → Payment → Agent proposes → Policy → Risk → Execution → Alpaca. LLM never submits orders.",
  notes: [
    "Hard rule: Agent outputs PROPOSED_ACTION only — Policy + Risk + Execution own money.",
    "Payment is paper wallet via Telegram (/fund → /confirm_fund). Track progress in Flow → Tasks.",
    "Mobile app / dashboard can sit on the Presentation layer; MetaMask stays human-signed crypto treasury.",
  ],
  graph: graphOf(
    "Trading agent",
    [
      bpNode({
        id: "bp-ta-telegram",
        label: "Telegram / Trading Chat",
        layer: "Presentation",
        description:
          "Human ingress — Telegram commands and HTTP Trading Chat. Always through Identity before Payment or Agent.",
        x: 0,
        y: 160,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp-ta-identity",
        label: "Identity / Auth",
        layer: "Safety",
        description: "Allowlist / RBAC before any money command.",
        x: 220,
        y: 160,
      }),
      bpNode({
        id: "bp-ta-payment",
        label: "Payment (paper wallet)",
        layer: "Data Access",
        description: "paper_wallets + ledger; confirm fund/withdraw.",
        x: 440,
        y: 40,
        techKind: "database",
      }),
      bpNode({
        id: "bp-ta-agent",
        label: "Agent / LLM",
        layer: "Reasoning",
        description: "Research and propose only — never submit orders.",
        x: 440,
        y: 220,
      }),
      bpNode({
        id: "bp-ta-strategy",
        label: "Strategy (PEAD / FDA)",
        layer: "Reasoning",
        description: "Arithmetic PEAD + FDA supply → PROPOSED_ACTION.",
        x: 660,
        y: 220,
      }),
      bpNode({
        id: "bp-ta-policy",
        label: "Policy engine",
        layer: "Safety",
        description: "ALLOW | REJECT | REQUIRE_HUMAN_CONFIRMATION.",
        x: 880,
        y: 100,
      }),
      bpNode({
        id: "bp-ta-risk",
        label: "Risk engine",
        layer: "Safety",
        description: "Size, exposure, penny/volume, kill-switch.",
        x: 880,
        y: 260,
      }),
      bpNode({
        id: "bp-ta-execution",
        label: "Execution service",
        layer: "External Services",
        description: "Idempotency, order state, reconciliation.",
        x: 1100,
        y: 160,
      }),
      bpNode({
        id: "bp-ta-alpaca",
        label: "Alpaca",
        layer: "External Services",
        description: "Equities brokerage (paper then live).",
        x: 1320,
        y: 80,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp-ta-kraken",
        label: "Kraken",
        layer: "External Services",
        description: "Crypto exchange — isolated from equity funding.",
        x: 1320,
        y: 240,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp-ta-mobile",
        label: "Mobile app",
        layer: "Presentation",
        description: "Optional phone client / BFF surface for status.",
        x: 0,
        y: 320,
        techKind: "mobile-app",
      }),
    ],
    [
      bpEdge("bp-ta-telegram", "bp-ta-identity", "channel_to"),
      bpEdge("bp-ta-mobile", "bp-ta-identity", "calls"),
      bpEdge("bp-ta-payment", "bp-ta-identity", "authenticates_via"),
      bpEdge("bp-ta-agent", "bp-ta-identity", "authenticates_via"),
      bpEdge("bp-ta-agent", "bp-ta-strategy", "uses"),
      bpEdge("bp-ta-strategy", "bp-ta-policy", "depends_on"),
      bpEdge("bp-ta-policy", "bp-ta-risk", "depends_on"),
      bpEdge("bp-ta-risk", "bp-ta-execution", "calls"),
      bpEdge("bp-ta-execution", "bp-ta-alpaca", "calls"),
      bpEdge("bp-ta-execution", "bp-ta-kraken", "calls"),
    ]
  ),
};

// ── Voice agent (Retell as channel) ─────────────────────────────────────────

const voiceAgent: DesignBlueprint = {
  id: "voice-agent",
  title: "Voice agent (Retell)",
  summary:
    "Retell as the voice channel into an agent with tools — blanko designs the agent system; mid-call transitions stay in Retell.",
  notes: [
    "Voice (Retell) is a Channel, not a full Retell editor inside blanko.",
    "The agent owns tools (calendar, sheets, email) behind the call.",
    "Import n8n/Retell graphs later to see where Wait/IF breaks — don't rebuild Execute here.",
  ],
  graph: graphOf(
    "Voice agent",
    [
      bpNode({
        id: "bp-va-retell",
        label: "Voice (Retell)",
        layer: "Presentation",
        description: "Callers talk here — channel into the agent.",
        x: 0,
        y: 120,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp-va-agent",
        label: "Agent",
        layer: "Reasoning",
        description: "Plans replies and tool calls for the conversation.",
        x: 300,
        y: 120,
      }),
      bpNode({
        id: "bp-va-tool",
        label: "Tool",
        layer: "External Services",
        description: "Calendar / sheets / email or custom capability.",
        x: 600,
        y: 40,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp-va-memory",
        label: "Memory store",
        layer: "Memory",
        description: "Caller context across the conversation.",
        x: 600,
        y: 200,
      }),
    ],
    [
      bpEdge("bp-va-retell", "bp-va-agent", "channel_to"),
      bpEdge("bp-va-agent", "bp-va-tool", "uses"),
      bpEdge("bp-va-agent", "bp-va-memory", "reads"),
    ]
  ),
};

// ── Classic web app (demoted — still available) ─────────────────────────────

const webAuthDb: DesignBlueprint = {
  id: "web-auth-db",
  title: "Web app with auth and database",
  summary: "Classic product shape (not the primary AI design canvas recipe).",
  notes: [
    "Prefer Trading agent / RAG / Voice blueprints when building an agent.",
    "The frontend never talks to the database directly — everything goes through the API.",
    "Auth sits in front of the API so every request is checked in one place.",
  ],
  graph: graphOf(
    "Web app with auth and database",
    [
      bpNode({ id: "bp1-frontend", label: "Frontend", layer: "Presentation", description: "React web app users sign into.", x: 0, y: 0, techKind: "web-ui" }),
      bpNode({ id: "bp1-auth", label: "Auth", layer: "Safety", description: "Login, sessions, and identity checks.", x: 0, y: 220 }),
      bpNode({ id: "bp1-api", label: "API / Gateway", layer: "Presentation", description: "Validates requests and enforces permissions.", x: 300, y: 110, techKind: "http-api" }),
      bpNode({ id: "bp1-db", label: "Postgres", layer: "Data Access", description: "Primary datastore for users and app records.", x: 600, y: 30, techKind: "database" }),
      bpNode({ id: "bp1-cache", label: "Redis", layer: "Memory", description: "Cache for hot reads and sessions.", x: 600, y: 220, techKind: "cache" }),
    ],
    [
      bpEdge("bp1-frontend", "bp1-api", "calls"),
      bpEdge("bp1-api", "bp1-auth", "authenticates_via"),
      bpEdge("bp1-api", "bp1-db", "reads"),
      bpEdge("bp1-api", "bp1-db", "writes"),
      bpEdge("bp1-api", "bp1-cache", "caches"),
    ]
  ),
};

// ── 2. Multi-tenant SaaS ────────────────────────────────────────────────────

const multiTenantSaas: DesignBlueprint = {
  id: "multi-tenant-saas",
  title: "Multi-tenant SaaS",
  summary: "A subscription product with billing, a background worker for async work, and a queue so writes don't block requests.",
  notes: [
    "Stripe handles billing so you never touch raw card data.",
    "Writes to the database go through a queue + worker instead of straight from the API, so traffic spikes don't overwhelm it.",
    "Auth here is also where you'd model tenant/org membership.",
  ],
  graph: graphOf(
    "Multi-tenant SaaS",
    [
      bpNode({ id: "bp2-frontend", label: "Frontend", layer: "Presentation", description: "Tenant-facing dashboard.", x: 0, y: 0, techKind: "web-ui" }),
      bpNode({ id: "bp2-auth", label: "Auth", layer: "Safety", description: "Login + tenant/org membership.", x: 0, y: 220 }),
      bpNode({ id: "bp2-api", label: "API / Gateway", layer: "Presentation", description: "Tenant-scoped API surface.", x: 300, y: 110, techKind: "http-api" }),
      bpNode({ id: "bp2-db", label: "Postgres", layer: "Data Access", description: "Per-tenant application data.", x: 620, y: 0, techKind: "database" }),
      bpNode({ id: "bp2-cache", label: "Redis", layer: "Memory", description: "Session + hot-path cache.", x: 620, y: 180, techKind: "cache" }),
      bpNode({ id: "bp2-queue", label: "Queue", layer: "Infrastructure", description: "Buffers writes and async jobs.", x: 300, y: 320, techKind: "queue" }),
      bpNode({ id: "bp2-worker", label: "Worker", layer: "Infrastructure", description: "Processes queued jobs (emails, exports, billing sync).", x: 620, y: 360 }),
      bpNode({ id: "bp2-stripe", label: "Stripe", layer: "External Services", description: "Subscription billing and invoicing.", x: 300, y: 500, techKind: "external-saas" }),
    ],
    [
      bpEdge("bp2-frontend", "bp2-api", "calls"),
      bpEdge("bp2-api", "bp2-auth", "authenticates_via"),
      bpEdge("bp2-api", "bp2-db", "reads"),
      bpEdge("bp2-api", "bp2-cache", "caches"),
      bpEdge("bp2-api", "bp2-queue", "publishes"),
      bpEdge("bp2-worker", "bp2-queue", "subscribes"),
      bpEdge("bp2-worker", "bp2-db", "writes"),
      bpEdge("bp2-api", "bp2-stripe", "calls"),
    ]
  ),
};

// ── 3. RAG agent ─────────────────────────────────────────────────────────

const ragAgent: DesignBlueprint = {
  id: "rag-agent",
  title: "RAG agent",
  summary: "An AI agent that retrieves relevant context from a vector database before asking an LLM to answer, behind a normal API.",
  notes: [
    "The agent owns the loop: retrieve context, call the LLM, decide if more retrieval is needed.",
    "Vector DB search is a separate step from the LLM call — swap embeddings/index without touching the model call.",
    "Auth still guards the API even though the interesting part is the agent behind it.",
  ],
  graph: graphOf(
    "RAG agent",
    [
      bpNode({ id: "bp3-frontend", label: "Frontend", layer: "Presentation", description: "Chat UI.", x: 0, y: 0, techKind: "web-ui" }),
      bpNode({ id: "bp3-auth", label: "Auth", layer: "Safety", description: "Login and API key checks.", x: 0, y: 220 }),
      bpNode({ id: "bp3-api", label: "API / Gateway", layer: "Presentation", description: "Receives chat requests.", x: 300, y: 110, techKind: "http-api" }),
      bpNode({ id: "bp3-agent", label: "Agent", layer: "Reasoning", description: "Plans retrieval + generation, calls tools.", x: 620, y: 30 }),
      bpNode({ id: "bp3-vector", label: "Vector DB", layer: "Memory", description: "Semantic search over your documents.", x: 940, y: 0, techKind: "database" }),
      bpNode({ id: "bp3-llm", label: "LLM", layer: "Reasoning", description: "Hosted model call for generation.", x: 940, y: 200 }),
      bpNode({ id: "bp3-db", label: "Postgres", layer: "Data Access", description: "Conversation history and metadata.", x: 620, y: 260, techKind: "database" }),
    ],
    [
      bpEdge("bp3-frontend", "bp3-api", "calls"),
      bpEdge("bp3-api", "bp3-auth", "authenticates_via"),
      bpEdge("bp3-api", "bp3-agent", "calls"),
      bpEdge("bp3-agent", "bp3-vector", "reads"),
      bpEdge("bp3-agent", "bp3-llm", "calls"),
      bpEdge("bp3-agent", "bp3-db", "writes"),
    ]
  ),
};

// ── 4. Event-driven orders ──────────────────────────────────────────────────

const eventDrivenOrders: DesignBlueprint = {
  id: "event-driven-orders",
  title: "Event-driven orders",
  summary: "Placing an order publishes an event that multiple independent workers react to — inventory and notifications don't block the checkout request.",
  notes: [
    "The API only writes the order and publishes an event — it doesn't wait for inventory or email to finish.",
    "Kafka lets you add more consumers later (analytics, fraud checks) without changing the API.",
    "Each worker owns its own failure mode: a broken email provider shouldn't block inventory updates.",
  ],
  graph: graphOf(
    "Event-driven orders",
    [
      bpNode({ id: "bp4-frontend", label: "Frontend", layer: "Presentation", description: "Checkout UI.", x: 0, y: 0, techKind: "web-ui" }),
      bpNode({ id: "bp4-auth", label: "Auth", layer: "Safety", description: "Customer login.", x: 0, y: 220 }),
      bpNode({ id: "bp4-api", label: "API / Gateway", layer: "Presentation", description: "Places orders.", x: 300, y: 110, techKind: "http-api" }),
      bpNode({ id: "bp4-db", label: "Postgres", layer: "Data Access", description: "Orders and order lines.", x: 620, y: 30, techKind: "database" }),
      bpNode({ id: "bp4-kafka", label: "Kafka", layer: "Infrastructure", description: "order.placed event stream.", x: 620, y: 220, techKind: "message-bus" }),
      bpNode({ id: "bp4-inventory-worker", label: "Worker", layer: "Infrastructure", description: "Reserves stock for placed orders.", x: 940, y: 140 }),
      bpNode({ id: "bp4-notify-worker", label: "Worker", layer: "Infrastructure", description: "Sends order confirmation emails.", x: 940, y: 320 }),
      bpNode({ id: "bp4-email", label: "External", layer: "External Services", description: "Transactional email provider.", x: 1260, y: 320, techKind: "external-saas" }),
    ],
    [
      bpEdge("bp4-frontend", "bp4-api", "calls"),
      bpEdge("bp4-api", "bp4-auth", "authenticates_via"),
      bpEdge("bp4-api", "bp4-db", "writes"),
      bpEdge("bp4-api", "bp4-kafka", "publishes"),
      bpEdge("bp4-inventory-worker", "bp4-kafka", "subscribes"),
      bpEdge("bp4-notify-worker", "bp4-kafka", "subscribes"),
      bpEdge("bp4-inventory-worker", "bp4-db", "writes"),
      bpEdge("bp4-notify-worker", "bp4-email", "calls"),
    ]
  ),
};

// ── 5. Mobile + BFF ─────────────────────────────────────────────────────────

const mobileBff: DesignBlueprint = {
  id: "mobile-bff",
  title: "Mobile app with a BFF",
  summary: "A mobile client talks to a backend-for-frontend that's shaped around what the app screen needs, instead of hitting shared internal services directly.",
  notes: [
    "The BFF exists to tailor responses for the mobile app — fewer round trips, mobile-friendly payloads.",
    "Auth and the database sit behind the BFF, same as any other API — mobile doesn't get special direct access.",
    "Push notifications are a separate external dependency the BFF calls out to.",
  ],
  graph: graphOf(
    "Mobile app with a BFF",
    [
      bpNode({ id: "bp5-mobile", label: "Mobile app", layer: "Presentation", description: "iOS/Android client.", x: 0, y: 0, techKind: "mobile-app" }),
      bpNode({ id: "bp5-auth", label: "Auth", layer: "Safety", description: "Login and device/session tokens.", x: 0, y: 220 }),
      bpNode({ id: "bp5-bff", label: "API / Gateway", layer: "Presentation", description: "Backend-for-frontend tailored to the app.", x: 300, y: 110, techKind: "http-api" }),
      bpNode({ id: "bp5-db", label: "Postgres", layer: "Data Access", description: "Application data.", x: 620, y: 30, techKind: "database" }),
      bpNode({ id: "bp5-cache", label: "Redis", layer: "Memory", description: "Cache for feed/profile reads.", x: 620, y: 210, techKind: "cache" }),
      bpNode({ id: "bp5-push", label: "External", layer: "External Services", description: "Push notification service (APNs/FCM).", x: 620, y: 390, techKind: "external-saas" }),
    ],
    [
      bpEdge("bp5-mobile", "bp5-bff", "calls"),
      bpEdge("bp5-bff", "bp5-auth", "authenticates_via"),
      bpEdge("bp5-bff", "bp5-db", "reads"),
      bpEdge("bp5-bff", "bp5-db", "writes"),
      bpEdge("bp5-bff", "bp5-cache", "caches"),
      bpEdge("bp5-bff", "bp5-push", "calls"),
    ]
  ),
};

// ── 6. n8n automation estate ────────────────────────────────────────────────

const n8nAutomationEstate: DesignBlueprint = {
  id: "n8n-automation-estate",
  title: "n8n automation estate",
  summary:
    "A multi-workflow automation system: triggers fan into workflow nodes that call Slack, Sheets, and a database — ready to replace with your own n8n import.",
  notes: [
    "Import your real n8n JSON exports from the landing page to replace this sketch with your estate.",
    "Cross-workflow calls become edges so you can see which automations depend on each other.",
    "Findings (error handling, secrets, batch waits) show up after a real import — this blueprint is a starting shape only.",
  ],
  graph: graphOf(
    "n8n automation estate",
    [
      bpNode({
        id: "bp6-webhook",
        label: "Webhook trigger",
        layer: "Infrastructure",
        description: "Inbound webhook that starts the booking flow.",
        x: 0,
        y: 80,
        techKind: "http-api",
      }),
      bpNode({
        id: "bp6-workflow",
        label: "n8n: Booking flow",
        layer: "Infrastructure",
        description: "Primary workflow — branches, transforms, and integrations.",
        x: 300,
        y: 80,
      }),
      bpNode({
        id: "bp6-slack",
        label: "Slack",
        layer: "External Services",
        description: "Notify the team when a booking is confirmed.",
        x: 620,
        y: 0,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp6-sheets",
        label: "Google Sheets",
        layer: "External Services",
        description: "Append booking rows for ops tracking.",
        x: 620,
        y: 160,
        techKind: "external-saas",
      }),
      bpNode({
        id: "bp6-db",
        label: "Postgres",
        layer: "Data Access",
        description: "Canonical booking records.",
        x: 620,
        y: 320,
        techKind: "database",
      }),
      bpNode({
        id: "bp6-sub",
        label: "n8n: Notify sub-workflow",
        layer: "Infrastructure",
        description: "Reusable notification workflow called from the booking flow.",
        x: 300,
        y: 280,
      }),
    ],
    [
      bpEdge("bp6-webhook", "bp6-workflow", "calls"),
      bpEdge("bp6-workflow", "bp6-slack", "calls"),
      bpEdge("bp6-workflow", "bp6-sheets", "calls"),
      bpEdge("bp6-workflow", "bp6-db", "writes"),
      bpEdge("bp6-workflow", "bp6-sub", "calls"),
      bpEdge("bp6-sub", "bp6-slack", "calls"),
    ]
  ),
};

export const DESIGN_BLUEPRINTS: DesignBlueprint[] = [
  tradingAgent,
  ragAgent,
  voiceAgent,
  n8nAutomationEstate,
  webAuthDb,
  multiTenantSaas,
  eventDrivenOrders,
  mobileBff,
];

/** Fork a blueprint into a fresh, standalone design ArchGraph (deep-copied, retimed). */
export function forkBlueprint(id: string): ArchGraph | null {
  const bp = DESIGN_BLUEPRINTS.find((b) => b.id === id);
  if (!bp) return null;
  const cloned = JSON.parse(JSON.stringify(bp.graph)) as ArchGraph;
  cloned.generatedAt = Date.now();
  return cloned;
}
