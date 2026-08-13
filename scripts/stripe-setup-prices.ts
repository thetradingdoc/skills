/**
 * Create Stripe Products/Prices for Pro and Team.
 * Usage (from webapp/server so `stripe` resolves):
 *   set -a && source .env && set +a
 *   NODE_PATH=./node_modules node --import tsx ../../scripts/stripe-setup-prices.ts
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(key);

async function ensurePrice(nickname: string, unitAmount: number, productName: string) {
  const existing = await stripe.prices.list({ limit: 100, active: true });
  const hit = existing.data.find((p) => p.nickname === nickname && p.unit_amount === unitAmount);
  if (hit) {
    console.log(`${nickname} already exists: ${hit.id}`);
    return hit.id;
  }
  const product = await stripe.products.create({ name: productName });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval: "month" },
    nickname,
  });
  console.log(`Created ${nickname}: ${price.id}`);
  return price.id;
}

async function main() {
  const pro = await ensurePrice("littlelabs_pro_monthly", 2900, "LittleLabs Pro");
  const team = await ensurePrice("littlelabs_team_monthly", 7900, "LittleLabs Team");

  console.log("\nAdd to webapp/server/.env:");
  console.log(`STRIPE_PRICE_PRO=${pro}`);
  console.log(`STRIPE_PRICE_TEAM=${team}`);
  console.log(
    "\nEnable Customer Portal: Dashboard → Settings → Billing → Customer portal"
  );
  console.log("  - Cancellation: at period end");
  console.log("  - Payment methods: update / remove");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
