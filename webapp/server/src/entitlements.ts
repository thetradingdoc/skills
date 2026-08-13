/**
 * Plan entitlements keyed by user_id. Webhook-updated subscription rows are source of truth.
 *
 * V1 launch gate: free users get canUseDesignChat (limited messages);
 * canUseAiAgent (analysis on scanned repos) stays Pro/Team only.
 */
import { supabaseAdmin } from "./supabaseAdmin.js";

export type PlanId = "free" | "pro" | "team";

export const FREE_SCAN_LIMIT_MONTHLY = Math.max(
  1,
  parseInt(process.env.FREE_SCAN_LIMIT_MONTHLY ?? "5", 10)
);

export const FREE_DESIGN_MESSAGES_MONTHLY = Math.max(
  0,
  parseInt(process.env.FREE_DESIGN_MESSAGES_MONTHLY ?? "20", 10)
);

export const PRO_SCAN_CREDITS = Math.max(
  1,
  parseInt(process.env.PRO_SCAN_CREDITS ?? "100", 10)
);

export const TEAM_SCAN_CREDITS = Math.max(
  1,
  parseInt(process.env.TEAM_SCAN_CREDITS ?? "500", 10)
);

export const PRO_AI_CREDITS_CENTS = Math.max(
  0,
  parseInt(process.env.PRO_AI_CREDITS_CENTS ?? "2000", 10)
);

export const TEAM_AI_CREDITS_CENTS = Math.max(
  0,
  parseInt(process.env.TEAM_AI_CREDITS_CENTS ?? "10000", 10)
);

export function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO?.trim()) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM?.trim()) return "team";
  return null;
}

export type Entitlement = {
  plan: PlanId;
  status: string;
  canScan: boolean;
  /** Pro/Team analysis agent on scanned graphs. */
  canUseAiAgent: boolean;
  /** Free+paid design/greenfield chat (subject to designMessagesRemaining for free). */
  canUseDesignChat: boolean;
  scansRemaining: number;
  designMessagesRemaining: number;
  reason?: string;
  code?: "UPGRADE_REQUIRED" | "PAST_DUE";
};

export type ChatMode = "greenfield" | "analysis";

/**
 * Local / owner bypass for billing gates.
 * - BILLING_DEV_UNLIMITED=1 → every user gets Pro-equivalent access (local only).
 * - OWNER_USER_IDS=uuid1,uuid2,dev-bypass-user → listed ids get unlimited access.
 */
export function isEntitlementUnlimited(userId: string): boolean {
  if (process.env.BILLING_DEV_UNLIMITED?.trim() === "1") return true;
  const raw = process.env.OWNER_USER_IDS?.trim() ?? "";
  if (!raw) return false;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

function unlimitedEntitlement(): Entitlement {
  return {
    plan: "pro",
    status: "active",
    canScan: true,
    canUseAiAgent: true,
    canUseDesignChat: true,
    scansRemaining: Math.max(PRO_SCAN_CREDITS, FREE_SCAN_LIMIT_MONTHLY),
    designMessagesRemaining: FREE_DESIGN_MESSAGES_MONTHLY,
  };
}

/** Pure resolver — unit-tested. DB fetch wraps this. */
export function resolveEntitlement(input: {
  unlimited?: boolean;
  status?: string | null;
  plan?: PlanId | string | null;
  priceId?: string | null;
  scanCredits?: number | null;
  designMessageCredits?: number | null;
}): Entitlement {
  if (input.unlimited) return unlimitedEntitlement();

  const status = (input.status as string) || "free";
  let plan =
    (input.plan as PlanId) || planFromPriceId(input.priceId) || ("free" as PlanId);
  if (status === "canceled" || status === "unpaid") plan = "free";

  let scansRemaining = input.scanCredits;
  if (scansRemaining == null) {
    scansRemaining =
      plan === "team" ? TEAM_SCAN_CREDITS : plan === "pro" ? PRO_SCAN_CREDITS : FREE_SCAN_LIMIT_MONTHLY;
  }

  let designMessagesRemaining = input.designMessageCredits;
  if (designMessagesRemaining == null) {
    designMessagesRemaining = FREE_DESIGN_MESSAGES_MONTHLY;
  }

  if (status === "past_due") {
    return {
      plan: plan === "pro" || plan === "team" ? plan : "free",
      status,
      canScan: false,
      canUseAiAgent: false,
      canUseDesignChat: false,
      scansRemaining,
      designMessagesRemaining: 0,
      reason: "Payment past due. Update your card in Profile → Manage billing.",
      code: "PAST_DUE",
    };
  }

  const paidActive =
    (plan === "pro" || plan === "team") && (status === "active" || status === "trialing");

  if (!paidActive && plan !== "free") {
    plan = "free";
  }

  const canUseAiAgent = paidActive;
  const canUseDesignChat = paidActive || designMessagesRemaining > 0;
  const canScan = scansRemaining > 0;

  if (!canScan) {
    return {
      plan: paidActive ? plan : "free",
      status: paidActive ? status : "free",
      canScan: false,
      canUseAiAgent,
      canUseDesignChat,
      scansRemaining: 0,
      designMessagesRemaining: paidActive ? designMessagesRemaining : Math.max(0, designMessagesRemaining),
      reason: "Scan credit limit reached. Upgrade or buy more credits.",
      code: "UPGRADE_REQUIRED",
    };
  }

  return {
    plan: paidActive ? plan : "free",
    status: paidActive ? status : "free",
    canScan: true,
    canUseAiAgent,
    canUseDesignChat,
    scansRemaining,
    designMessagesRemaining: paidActive ? designMessagesRemaining : Math.max(0, designMessagesRemaining),
  };
}

/**
 * Gate chat by mode. Analysis requires Pro agent; greenfield uses design allowance.
 */
export function evaluateChatAccess(
  ent: Entitlement,
  mode: ChatMode
): { allowed: true } | { allowed: false; status: 403; body: Record<string, unknown> } {
  if (mode === "analysis") {
    if (ent.canUseAiAgent) return { allowed: true };
    return {
      allowed: false,
      status: 403,
      body: {
        error:
          ent.code === "PAST_DUE"
            ? ent.reason
            : "AI agent requires Pro or Team. Upgrade in Profile → Billing.",
        code: ent.code ?? "UPGRADE_REQUIRED",
        plan: ent.plan,
      },
    };
  }

  // greenfield / design
  if (ent.canUseDesignChat) return { allowed: true };
  return {
    allowed: false,
    status: 403,
    body: {
      error:
        ent.code === "PAST_DUE"
          ? ent.reason
          : ent.designMessagesRemaining <= 0
            ? "Free design chat allowance used. Upgrade to Pro for more AI design help."
            : "Design chat requires a free or paid account with remaining allowance.",
      code: ent.code ?? "UPGRADE_REQUIRED",
      plan: ent.plan,
      designMessagesRemaining: ent.designMessagesRemaining,
    },
  };
}

export function resolveChatMode(
  bodyMode: unknown,
  graph: { nodes?: unknown[]; projectRoot?: string | null } | null | undefined
): ChatMode {
  if (bodyMode === "greenfield" || bodyMode === "analysis") return bodyMode;
  const isEmpty =
    !graph ||
    !Array.isArray(graph.nodes) ||
    graph.nodes.length === 0 ||
    !graph.projectRoot ||
    String(graph.projectRoot).trim() === "";
  return isEmpty ? "greenfield" : "analysis";
}

export async function seedUsageForPlan(userId: string, plan: PlanId): Promise<void> {
  if (!supabaseAdmin) return;
  const scan =
    plan === "team" ? TEAM_SCAN_CREDITS : plan === "pro" ? PRO_SCAN_CREDITS : FREE_SCAN_LIMIT_MONTHLY;
  const ai =
    plan === "team" ? TEAM_AI_CREDITS_CENTS : plan === "pro" ? PRO_AI_CREDITS_CENTS : 0;
  const design =
    plan === "free" ? FREE_DESIGN_MESSAGES_MONTHLY : FREE_DESIGN_MESSAGES_MONTHLY;
  await supabaseAdmin.from("usage_balances").upsert({
    user_id: userId,
    scan_credits: scan,
    ai_credits_cents: ai,
    design_message_credits: design,
    updated_at: new Date().toISOString(),
  });
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  if (isEntitlementUnlimited(userId)) {
    return unlimitedEntitlement();
  }

  if (!supabaseAdmin) {
    return resolveEntitlement({
      status: "free",
      plan: "free",
      scanCredits: FREE_SCAN_LIMIT_MONTHLY,
      designMessageCredits: FREE_DESIGN_MESSAGES_MONTHLY,
    });
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("plan,status,price_id")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: bal } = await supabaseAdmin
    .from("usage_balances")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return resolveEntitlement({
    status: (sub?.status as string) || "free",
    plan: (sub?.plan as PlanId) || null,
    priceId: (sub?.price_id as string) || null,
    scanCredits: bal?.scan_credits as number | undefined,
    designMessageCredits:
      bal && "design_message_credits" in bal
        ? ((bal as { design_message_credits?: number }).design_message_credits ?? null)
        : null,
  });
}

export async function consumeScanCredit(userId: string): Promise<void> {
  if (!supabaseAdmin) return;
  if (isEntitlementUnlimited(userId)) return;
  const ent = await getEntitlement(userId);
  const next = Math.max(0, ent.scansRemaining - 1);
  await supabaseAdmin.from("usage_balances").upsert({
    user_id: userId,
    scan_credits: next,
    updated_at: new Date().toISOString(),
  });
}

/** Decrement free design/greenfield message allowance. No-op for Pro/Team or unlimited. */
export async function consumeDesignMessageCredit(userId: string): Promise<void> {
  if (!supabaseAdmin) return;
  if (isEntitlementUnlimited(userId)) return;
  const ent = await getEntitlement(userId);
  if (ent.canUseAiAgent) return; // paid — unlimited design chat
  const next = Math.max(0, ent.designMessagesRemaining - 1);
  await supabaseAdmin.from("usage_balances").upsert({
    user_id: userId,
    design_message_credits: next,
    updated_at: new Date().toISOString(),
  });
}
