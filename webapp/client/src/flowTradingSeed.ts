/**
 * Pipeline cards seeded onto Flow → Tasks (Payment first).
 * blanko tracks trading-agent work via these todos + blueprint nodes.
 */

export type SeedCard = {
  title: string;
  description: string;
  layerId: string;
  kind: "task" | "issue";
  /** Stable key for idempotent re-seed (stored in source_path). */
  sourcePath: string;
};

/** Ordered spine — Payment is first. */
export const TRADING_PIPELINE_SEED: SeedCard[] = [
  {
    title: "Task 1 — Payment (paper wallet)",
    description:
      "Telegram identity allowlist; /fund→/confirm_fund; /withdraw→/confirm_withdraw; paper_wallets + ledger; limits; single writer. Paper only.",
    layerId: "ingress",
    kind: "task",
    sourcePath: "trading-spine:p1-payment",
  },
  {
    title: "Task 2 — Broker abstraction",
    description: "Broker interface → PaperBroker → AlpacaBroker. No LLM→broker.",
    layerId: "tools",
    kind: "task",
    sourcePath: "trading-spine:p2-broker",
  },
  {
    title: "Task 3 — Policy + Risk",
    description: "PROPOSED_ACTION → evaluate ALLOW|REJECT|CONFIRM; penny/size/kill-switch.",
    layerId: "safety",
    kind: "task",
    sourcePath: "trading-spine:p3-policy-risk",
  },
  {
    title: "Task 4 — Market data + FDA + KG",
    description: "MarketDataService (no Yahoo on exec path); FDA client; structured kg_*.",
    layerId: "knowledge",
    kind: "task",
    sourcePath: "trading-spine:p4-data",
  },
  {
    title: "Task 5 — PEAD + FDA strategy",
    description: "Arithmetic PEAD + FDA supply → PROPOSED_ACTION only.",
    layerId: "reasoning",
    kind: "task",
    sourcePath: "trading-spine:p5-strategy",
  },
  {
    title: "Task 6 — Agent (propose only)",
    description: "One agent + LLMRouter; research/propose; no submit_* tools.",
    layerId: "reasoning",
    kind: "task",
    sourcePath: "trading-spine:p6-agent",
  },
  {
    title: "Task 7 — Execution + reconcile",
    description: "proposal → policy → risk → execution → Alpaca; idempotency + DB↔Alpaca reconcile.",
    layerId: "tools",
    kind: "task",
    sourcePath: "trading-spine:p7-execution",
  },
  {
    title: "Task 8 — Evaluation",
    description: "Full-pipeline harness, paper PnL, Telegram payment tests.",
    layerId: "eval",
    kind: "task",
    sourcePath: "trading-spine:p8-eval",
  },
];
