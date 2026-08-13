# Billing review checklist (chat onboarding)

Date: 2026-08-05

## Copy and chrome
- [x] "Free forever for personal projects" removed from auth modal
- [x] Onboarding chat header is "Get started" / Chat — distinct from Agent "Ask about your architecture"
- [x] Password strength hint + Terms/Privacy links on plan step

## Question pipeline
- [x] Email → first/last/nickname → password widgets (not bubbles) → plan chips + ToS → Payment Element or Free
- [x] Landing repo continuity optional step when `pendingRepoUrl` set
- [x] Sign-in escape hatch from onboarding
- [x] Free / no-repo path lands empty workspace

## Security / storage
- [x] Card via Stripe Payment Element only (PAN never in our DB)
- [x] Password fields are widgets; not pushed as chat message text
- [x] Webhook uses `STRIPE_WEBHOOK_SECRET` signature verification
- [x] `confirm-subscription` does not grant Pro; webhook upserts `subscriptions`

## Stripe ops (Doctor Little live account)
- [x] Pro / Team prices created (`littlelabs_pro_monthly` / `littlelabs_team_monthly`)
- [x] Customer Portal config active (cancel at period end + payment method update)
- [x] Webhook endpoint created (`…/api/billing/webhook`) + signing secret in server `.env`
- [ ] Prefer `sk_test_` / `pk_test_` for sandbox dogfood (currently live keys)

## Database
- [x] Applied `supabase/migrations/20260805120000_billing_subscriptions.sql`  
  Tables verified via REST: `billing_customers`, `subscriptions`, `usage_balances`

## Cancel / card
- [x] Profile → Manage billing → Customer Portal (cancel, update/remove card)
- [x] Copy: Cancel anytime; access until period end
- [x] `/billing/me` returns `cancelAtPeriodEnd` from Stripe

## Entitlements
- [x] `getEntitlement` keyed by `user_id`
- [x] Scan + chat-async return `UPGRADE_REQUIRED` / `PAST_DUE`
- [x] Free has no analysis AI agent (`canUseAiAgent`); free design chat is separate (`canUseDesignChat`)
- [x] `confirm-subscription` does not grant Pro (webhook only) — asserted in `test-backend-api-gates.ts`

## past_due
- [x] Profile banner when status is `past_due`
- [x] Entitlement blocks scan/AI when past_due

## E2E
- [x] Smoke specs green (`npx playwright test scripts/onboarding-billing.spec.ts` → exit 0)
- [x] Backend API gates (`node --import tsx scripts/test-backend-api-gates.ts`)
- [x] Live API smoke (`scripts/backend-api.spec.ts`) when server is up
- [ ] Full journey (`E2E_FULL_BILLING=1`) after migration + test-mode Stripe
