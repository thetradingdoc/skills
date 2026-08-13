# Backend E2E / API gate coverage

Last updated: 2026-08-05

## What to run

```bash
# Always (no live DB required) — high-risk Express contracts
NODE_PATH=./webapp/server/node_modules node --import tsx scripts/test-backend-api-gates.ts

# Optional live smoke (skips if API down)
E2E_API_URL=http://localhost:4000 APP_URL=http://localhost:5174 \
  npx playwright test scripts/backend-api.spec.ts
```

## Fixes shipped with this suite

| Issue | Fix |
|-------|-----|
| Save owner-only vs editor RBAC | `POST .../save` now uses `requireWorkspaceAccess` + `requireCanEdit` |
| Save revision conflicts | Pure `graphSaveRevision.ts` + client sends `baseRevision` and merges on 409 |
| Onboarding intent step | Shared `scripts/e2eOnboarding.ts`; sandbox + billing specs updated |
| Playwright host | Default `APP_URL` → `http://localhost:5174`; `fullyParallel: false` |
| Materialize path escape | `validateTargetRoot` exported + gated under `PROJECTS_BASE_DIR` |
| Stripe confirm ≠ Pro | Contract test: confirm-subscription note mentions webhook only |
| Webhook HMAC | Stripe missing/bad sig + GitHub HMAC unit checks |
| Chat free vs analysis | Entitlement gate contracts in API gate suite |

## Still needs live auth fixture (manual / future)

Authenticated happy-paths for claims CRUD, chat-async credit decrement against real `usage_balances`, and GitHub webhook → DB rows require a seeded Supabase user + workspace. The gate suite covers the **policy contracts**; live fixtures can wrap them later with `E2E_FULL_BILLING=1`.
