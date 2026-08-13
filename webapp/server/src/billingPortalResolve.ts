/**
 * Pure-ish portal customer resolution — injectable deps for tests.
 * Heals missing billing_customers when Stripe still has the link.
 */

export type PortalSubRow = {
  stripe_subscription_id?: string | null;
  plan?: string | null;
  status?: string | null;
};

export type PortalResolveDeps = {
  getBillingCustomerId: (userId: string) => Promise<string | null>;
  getSubscription: (userId: string) => Promise<PortalSubRow | null>;
  linkBillingCustomer: (userId: string, stripeCustomerId: string) => Promise<void>;
  retrieveSubscriptionCustomerId: (subscriptionId: string) => Promise<string | null>;
  searchCustomerByUserId: (userId: string) => Promise<string | null>;
  createCustomer: (userId: string, email?: string) => Promise<string>;
};

export type PortalResolveResult =
  | { customerId: string }
  | { error: string; status: number };

export async function resolvePortalCustomerIdWithDeps(
  userId: string,
  email: string | undefined,
  deps: PortalResolveDeps
): Promise<PortalResolveResult> {
  const existing = await deps.getBillingCustomerId(userId);
  if (existing) return { customerId: existing };

  const sub = await deps.getSubscription(userId);
  const subId = sub?.stripe_subscription_id ?? null;

  if (subId) {
    try {
      const customerId = await deps.retrieveSubscriptionCustomerId(subId);
      if (customerId) {
        await deps.linkBillingCustomer(userId, customerId);
        return { customerId };
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const found = await deps.searchCustomerByUserId(userId);
    if (found) {
      await deps.linkBillingCustomer(userId, found);
      return { customerId: found };
    }
  } catch {
    /* search may be unavailable */
  }

  const plan = sub?.plan || "free";
  const status = sub?.status || "free";
  const looksPaid =
    (plan === "pro" || plan === "team") &&
    ["active", "trialing", "past_due", "incomplete", "unpaid"].includes(status);

  if (looksPaid) {
    const customerId = await deps.createCustomer(userId, email);
    return { customerId };
  }

  return {
    error:
      "No Stripe billing profile yet. Upgrade to a paid plan to manage cards and invoices.",
    status: 400,
  };
}
