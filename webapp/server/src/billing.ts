/**
 * Stripe billing: customers, subscriptions, portal, webhooks, free entitlement.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import {
  FREE_DESIGN_MESSAGES_MONTHLY,
  FREE_SCAN_LIMIT_MONTHLY,
  getEntitlement,
  planFromPriceId,
  seedUsageForPlan,
  type PlanId,
} from "./entitlements.js";
import { resolvePortalCustomerIdWithDeps } from "./billingPortalResolve.js";

const router = Router();

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

function priceIdForPlan(plan: PlanId): string | null {
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO?.trim() || null;
  if (plan === "team") return process.env.STRIPE_PRICE_TEAM?.trim() || null;
  return null;
}

async function linkBillingCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  if (!supabaseAdmin) throw new Error("Database not configured");
  const { error } = await supabaseAdmin.from("billing_customers").upsert({
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
  });
  if (error) throw error;
}

async function getOrCreateCustomer(
  stripe: Stripe,
  userId: string,
  email?: string
): Promise<string> {
  if (!supabaseAdmin) throw new Error("Database not configured");
  const { data: existing } = await supabaseAdmin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string;

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { user_id: userId },
  });
  await linkBillingCustomer(userId, customer.id);
  return customer.id;
}

/**
 * Resolve a Stripe customer for the Customer Portal.
 * Heals missing billing_customers rows when a subscription (or metadata) still links Stripe.
 */
async function resolvePortalCustomerId(
  stripe: Stripe,
  userId: string,
  email?: string
): Promise<{ customerId: string } | { error: string; status: number }> {
  if (!supabaseAdmin) {
    return { error: "Database not configured", status: 503 };
  }

  return resolvePortalCustomerIdWithDeps(userId, email, {
    getBillingCustomerId: async (uid) => {
      const { data: row } = await supabaseAdmin!
        .from("billing_customers")
        .select("stripe_customer_id")
        .eq("user_id", uid)
        .maybeSingle();
      return (row?.stripe_customer_id as string | undefined) ?? null;
    },
    getSubscription: async (uid) => {
      const { data: sub } = await supabaseAdmin!
        .from("subscriptions")
        .select("stripe_subscription_id, plan, status")
        .eq("user_id", uid)
        .maybeSingle();
      return sub;
    },
    linkBillingCustomer,
    retrieveSubscriptionCustomerId: async (subscriptionId) => {
      const full = await stripe.subscriptions.retrieve(subscriptionId);
      return typeof full.customer === "string" ? full.customer : full.customer?.id ?? null;
    },
    searchCustomerByUserId: async (uid) => {
      const listed = await stripe.customers.search({
        query: `metadata['user_id']:'${uid}'`,
        limit: 1,
      });
      return listed.data[0]?.id ?? null;
    },
    createCustomer: (uid, em) => getOrCreateCustomer(stripe, uid, em),
  });
}

router.post("/billing/ensure-free", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Database not configured" });
      return;
    }
    await supabaseAdmin.from("subscriptions").upsert({
      user_id: userId,
      stripe_subscription_id: null,
      price_id: null,
      status: "free",
      current_period_end: null,
      plan: "free",
    });
    await seedUsageForPlan(userId, "free");
    res.json({ ok: true, plan: "free" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/billing/create-customer", requireUser, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured (STRIPE_SECRET_KEY)" });
      return;
    }
    const id = await getOrCreateCustomer(stripe, req.user!.id, req.user!.email);
    res.json({ stripeCustomerId: id });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/billing/create-subscription", requireUser, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured (STRIPE_SECRET_KEY)" });
      return;
    }
    const plan = (req.body?.plan === "team" ? "team" : "pro") as PlanId;
    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      res.status(503).json({
        error: `Missing ${plan === "team" ? "STRIPE_PRICE_TEAM" : "STRIPE_PRICE_PRO"}`,
      });
      return;
    }
    const customerId = await getOrCreateCustomer(stripe, req.user!.id, req.user!.email);
    // Stripe API 2025+ (SDK v22) removed invoice.payment_intent; the Payment
    // Element client secret now lives on latest_invoice.confirmation_secret.
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.confirmation_secret"],
      metadata: { user_id: req.user!.id, plan },
    });
    const invoice = subscription.latest_invoice as Stripe.Invoice | null;
    let clientSecret: string | null = null;
    if (invoice && typeof invoice !== "string") {
      clientSecret = invoice.confirmation_secret?.client_secret ?? null;
      if (!clientSecret) {
        // Older API versions expose a payment intent on the invoice instead.
        const pi = (invoice as unknown as { payment_intent?: string | Stripe.PaymentIntent })
          .payment_intent;
        if (pi && typeof pi !== "string") clientSecret = pi.client_secret ?? null;
        else if (typeof pi === "string") {
          const intent = await stripe.paymentIntents.retrieve(pi);
          clientSecret = intent.client_secret ?? null;
        }
      }
    }
    if (!clientSecret) {
      res.status(500).json({ error: "No payment client secret from Stripe" });
      return;
    }
    if (supabaseAdmin) {
      await supabaseAdmin.from("subscriptions").upsert({
        user_id: req.user!.id,
        stripe_subscription_id: subscription.id,
        price_id: priceId,
        status: subscription.status,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        plan,
      });
    }
    res.json({
      subscriptionId: subscription.id,
      clientSecret,
      plan,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/billing/confirm-subscription", requireUser, async (req, res) => {
  // Client ack only — Pro access is granted by webhook.
  res.json({
    ok: true,
    note: "Paid access activates when Stripe webhook confirms the subscription.",
  });
});

router.get("/billing/me", requireUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      res.json({
        plan: "free",
        status: "free",
        currentPeriodEnd: null,
        cardBrand: null,
        cardLast4: null,
        freeScanLimit: FREE_SCAN_LIMIT_MONTHLY,
        freeDesignLimit: FREE_DESIGN_MESSAGES_MONTHLY,
        canUseAiAgent: false,
        canUseDesignChat: FREE_DESIGN_MESSAGES_MONTHLY > 0,
        designMessagesRemaining: FREE_DESIGN_MESSAGES_MONTHLY,
        scansRemaining: FREE_SCAN_LIMIT_MONTHLY,
      });
      return;
    }
    const userId = req.user!.id;
    const ent = await getEntitlement(userId);
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    let cardBrand: string | null = null;
    let cardLast4: string | null = null;
    let cancelAtPeriodEnd = false;
    const stripe = stripeClient();
    if (stripe && sub?.stripe_subscription_id) {
      try {
        const full = await stripe.subscriptions.retrieve(sub.stripe_subscription_id as string, {
          expand: ["default_payment_method"],
        });
        cancelAtPeriodEnd = Boolean(full.cancel_at_period_end);
        const pm = full.default_payment_method;
        if (pm && typeof pm !== "string" && pm.card) {
          cardBrand = pm.card.brand;
          cardLast4 = pm.card.last4;
        }
      } catch {
        /* ignore card lookup failures */
      }
    }

    const plan = (sub?.plan as PlanId) || planFromPriceId(sub?.price_id as string | null) || ent.plan;
    res.json({
      plan,
      status: (sub?.status as string) || ent.status || "free",
      currentPeriodEnd: (sub?.current_period_end as string) || null,
      cardBrand,
      cardLast4,
      cancelAtPeriodEnd,
      freeScanLimit: FREE_SCAN_LIMIT_MONTHLY,
      freeDesignLimit: FREE_DESIGN_MESSAGES_MONTHLY,
      canUseAiAgent: ent.canUseAiAgent,
      canUseDesignChat: ent.canUseDesignChat,
      designMessagesRemaining: ent.designMessagesRemaining,
      scansRemaining: ent.scansRemaining,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/billing/portal", requireUser, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Database not configured" });
      return;
    }
    const resolved = await resolvePortalCustomerId(stripe, req.user!.id, req.user!.email);
    if ("error" in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const returnUrl =
      process.env.APP_URL?.trim() ||
      req.headers.origin ||
      "http://localhost:5174";
    const session = await stripe.billingPortal.sessions.create({
      customer: resolved.customerId,
      return_url: String(returnUrl),
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

async function upsertSubscriptionFromStripe(sub: Stripe.Subscription) {
  if (!supabaseAdmin) return;
  const userId = sub.metadata?.user_id;
  if (!userId) return;
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const plan = (sub.metadata?.plan as PlanId) || planFromPriceId(priceId) || "pro";
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  if (customerId) {
    try {
      await linkBillingCustomer(userId, customerId);
    } catch {
      /* don't block entitlement sync if customer link fails */
    }
  }
  await supabaseAdmin.from("subscriptions").upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    status: sub.status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    plan: sub.status === "active" || sub.status === "trialing" ? plan : plan,
  });
  if (sub.status === "active" || sub.status === "trialing") {
    await seedUsageForPlan(userId, plan);
  }
  if (sub.status === "canceled" || sub.status === "unpaid") {
    await supabaseAdmin.from("subscriptions").upsert({
      user_id: userId,
      stripe_subscription_id: sub.id,
      price_id: priceId,
      status: sub.status,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      plan: "free",
    });
    await seedUsageForPlan(userId, "free");
  }
}

/** Raw body required for signature verification — mount before json parser if needed. */
export async function handleStripeWebhook(req: Request, res: Response) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) {
    res.status(503).json({ error: "Stripe webhook not configured" });
    return;
  }
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing stripe-signature" });
    return;
  }
  let event: Stripe.Event;
  try {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? req.body;
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    res.status(400).json({
      error: `Webhook signature verification failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscriptionFromStripe(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.user_id;
        if (userId && supabaseAdmin) {
          const customerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
          if (customerId) {
            try {
              await linkBillingCustomer(userId, customerId);
            } catch {
              /* ignore */
            }
          }
          await supabaseAdmin.from("subscriptions").upsert({
            user_id: userId,
            stripe_subscription_id: sub.id,
            price_id: sub.items.data[0]?.price?.id ?? null,
            status: "canceled",
            current_period_end: null,
            plan: "free",
          });
          await seedUsageForPlan(userId, "free");
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
        if (subId && stripe) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub);
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export { router as billingRoutes };
