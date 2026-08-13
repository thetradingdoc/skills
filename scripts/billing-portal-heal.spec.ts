/**
 * Portal heal logic — Playwright tests with injectable mocks (no live Stripe).
 * Confirms Manage-billing failure modes from the PRO-without-customer screenshot.
 */
import { test, expect } from "@playwright/test";
import {
  resolvePortalCustomerIdWithDeps,
  type PortalResolveDeps,
} from "../webapp/server/src/billingPortalResolve";

function mockDeps(overrides: Partial<PortalResolveDeps> = {}): PortalResolveDeps & {
  linked: Array<{ userId: string; customerId: string }>;
  created: string[];
} {
  const linked: Array<{ userId: string; customerId: string }> = [];
  const created: string[] = [];
  return {
    linked,
    created,
    getBillingCustomerId: async () => null,
    getSubscription: async () => null,
    linkBillingCustomer: async (userId, stripeCustomerId) => {
      linked.push({ userId, customerId: stripeCustomerId });
    },
    retrieveSubscriptionCustomerId: async () => null,
    searchCustomerByUserId: async () => null,
    createCustomer: async (userId) => {
      const id = `cus_healed_${userId.slice(0, 8)}`;
      created.push(id);
      linked.push({ userId, customerId: id });
      return id;
    },
    ...overrides,
  };
}

test.describe("billing portal heal (mock)", () => {
  test("returns existing billing_customers id", async () => {
    const deps = mockDeps({
      getBillingCustomerId: async () => "cus_existing",
    });
    const r = await resolvePortalCustomerIdWithDeps("user-1", "a@b.com", deps);
    expect(r).toEqual({ customerId: "cus_existing" });
    expect(deps.linked).toHaveLength(0);
  });

  test("heals from stripe subscription customer when billing_customers missing", async () => {
    const deps = mockDeps({
      getSubscription: async () => ({
        stripe_subscription_id: "sub_123",
        plan: "pro",
        status: "active",
      }),
      retrieveSubscriptionCustomerId: async (id) => {
        expect(id).toBe("sub_123");
        return "cus_from_sub";
      },
    });
    const r = await resolvePortalCustomerIdWithDeps("user-1", "a@b.com", deps);
    expect(r).toEqual({ customerId: "cus_from_sub" });
    expect(deps.linked).toEqual([{ userId: "user-1", customerId: "cus_from_sub" }]);
  });

  test("heals orphan PRO (screenshot state) by creating a Stripe customer", async () => {
    const deps = mockDeps({
      getSubscription: async () => ({
        stripe_subscription_id: null,
        plan: "pro",
        status: "active",
      }),
    });
    const r = await resolvePortalCustomerIdWithDeps("user-orphan", "pro@blanko.app", deps);
    expect("customerId" in r).toBeTruthy();
    if ("customerId" in r) expect(r.customerId).toMatch(/^cus_healed_/);
    expect(deps.created.length).toBe(1);
  });

  test("free user without customer gets clear error (not upgrade-first)", async () => {
    const deps = mockDeps({
      getSubscription: async () => ({
        stripe_subscription_id: null,
        plan: "free",
        status: "free",
      }),
    });
    const r = await resolvePortalCustomerIdWithDeps("user-free", "f@b.com", deps);
    expect(r).toEqual({
      error:
        "No Stripe billing profile yet. Upgrade to a paid plan to manage cards and invoices.",
      status: 400,
    });
    expect(JSON.stringify(r)).not.toMatch(/upgrade first/i);
    expect(deps.created).toHaveLength(0);
  });

  test("heals via Stripe customer metadata search", async () => {
    const deps = mockDeps({
      getSubscription: async () => ({
        stripe_subscription_id: null,
        plan: "pro",
        status: "active",
      }),
      searchCustomerByUserId: async () => "cus_searched",
    });
    const r = await resolvePortalCustomerIdWithDeps("user-1", undefined, deps);
    expect(r).toEqual({ customerId: "cus_searched" });
    expect(deps.linked).toEqual([{ userId: "user-1", customerId: "cus_searched" }]);
    expect(deps.created).toHaveLength(0);
  });
});
