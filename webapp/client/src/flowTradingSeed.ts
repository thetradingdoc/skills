/**
 * Pipeline cards seeded onto Tasks (Payment first).
 * blanko tracks trading-agent work via these todos + blueprint nodes.
 */

export type SeedCard = {
  title: string;
  description: string;
  layerId: string;
  kind: "task" | "issue";
  /** Stable key for idempotent re-seed (stored in source_path). */
  sourcePath: string;
  /** Paths under the scanned repo the agent should focus on. */
  fileScope: string[];
  acceptanceCriteria: string;
};

/** Ordered spine — Payment is first. Paths relative to trading-agent / middleware-platform. */
export const TRADING_PIPELINE_SEED: SeedCard[] = [
  {
    title: "Task 1 — Payment (paper wallet)",
    description:
      "Telegram identity allowlist; /fund→/confirm_fund; /withdraw→/confirm_withdraw; paper_wallets + ledger; limits; single writer. Paper only.",
    layerId: "ingress",
    kind: "task",
    sourcePath: "trading-spine:p1-payment",
    fileScope: [
      "middleware-platform/services/wallet-service.js",
      "middleware-platform/services/paper-wallet-writer.js",
      "middleware-platform/services/telegram-paper-commands.js",
      "middleware-platform/migrations/011_paper_wallets.js",
    ],
    acceptanceCriteria:
      "Paper wallet fund/withdraw path is identity-scoped; single writer; no live cash mutation from chat tools.",
  },
  {
    title: "Task 2 — Broker abstraction",
    description: "Broker interface → PaperBroker → AlpacaBroker. No LLM→broker.",
    layerId: "tools",
    kind: "task",
    sourcePath: "trading-spine:p2-broker",
    fileScope: [
      "middleware-platform/services/broker/broker-interface.js",
      "middleware-platform/services/broker/paper-broker.js",
      "middleware-platform/services/broker/alpaca-broker.js",
      "middleware-platform/services/broker/index.js",
    ],
    acceptanceCriteria:
      "Broker interface is the only submit path; LLM tool allowlists never expose submitOrder.",
  },
  {
    title: "Task 3 — Policy + Risk",
    description: "PROPOSED_ACTION → evaluate ALLOW|REJECT|CONFIRM; penny/size/kill-switch.",
    layerId: "safety",
    kind: "task",
    sourcePath: "trading-spine:p3-policy-risk",
    fileScope: [
      "middleware-platform/services/policy/",
      "middleware-platform/services/risk/",
      "middleware-platform/services/policy-engine.js",
      "middleware-platform/services/risk-engine.js",
    ],
    acceptanceCriteria:
      "PROPOSED_ACTION is evaluated before execution; kill-switch and size gates are enforced.",
  },
  {
    title: "Task 4 — Market data + FDA + KG",
    description: "MarketDataService (no Yahoo on exec path); FDA client; structured kg_*.",
    layerId: "knowledge",
    kind: "task",
    sourcePath: "trading-spine:p4-data",
    fileScope: [
      "middleware-platform/services/market-data/",
      "middleware-platform/services/market-data-client.js",
      "middleware-platform/services/fda-client.js",
    ],
    acceptanceCriteria:
      "Execution path does not call Yahoo directly; market-data client is the quote SSOT for tools.",
  },
  {
    title: "Task 5 — PEAD + FDA strategy",
    description: "Arithmetic PEAD + FDA supply → PROPOSED_ACTION only.",
    layerId: "reasoning",
    kind: "task",
    sourcePath: "trading-spine:p5-strategy",
    fileScope: [
      "middleware-platform/services/strategy/",
      "middleware-platform/services/signal-engine.js",
    ],
    acceptanceCriteria:
      "Strategies emit PROPOSED_ACTION only; no broker submit from strategy modules.",
  },
  {
    title: "Task 6 — Agent (propose only)",
    description: "One agent + LLMRouter; research/propose; no submit_* tools.",
    layerId: "reasoning",
    kind: "task",
    sourcePath: "trading-spine:p6-agent",
    fileScope: [
      "middleware-platform/services/trading-rails/execute-turn.js",
      "middleware-platform/services/trading-tool-executor.js",
      "middleware-platform/services/llm-router.js",
      "middleware-platform/services/trading-rails/tool-allowlists.js",
    ],
    acceptanceCriteria:
      "execute-turn tool allowlist has no order-submit tools; assertCaller gates portfolio reads.",
  },
  {
    title: "Task 7 — Execution + reconcile",
    description: "proposal → policy → risk → execution → Alpaca; idempotency + DB↔Alpaca reconcile.",
    layerId: "tools",
    kind: "task",
    sourcePath: "trading-spine:p7-execution",
    fileScope: [
      "middleware-platform/services/execution/",
      "middleware-platform/services/execution/execution-service.js",
      "middleware-platform/services/execution/reconcile.js",
    ],
    acceptanceCriteria:
      "Only execution-service submits after ALLOW; reconcile updates DB from broker truth.",
  },
  {
    title: "Task 8 — Evaluation",
    description: "Full-pipeline harness, paper PnL, Telegram payment tests.",
    layerId: "eval",
    kind: "task",
    sourcePath: "trading-spine:p8-eval",
    fileScope: [
      "middleware-platform/__tests__/",
      "middleware-platform/scripts/",
    ],
    acceptanceCriteria:
      "Tests cover propose-only guard and paper wallet identity scoping; no live broker in default CI.",
  },
];
