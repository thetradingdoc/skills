# Auth Debug Report

## Issue 1 — Sign out doesn't take me to the landing page

**Root cause:** `handleSignOut` cleared `accessToken` but not `graph`. The landing page only renders when `!graph && !loading`. With a non-null `graph`, the app stayed on the workspace view.

**Fix applied:** Sign out now resets workspace state (`setGraph(null)`, etc.) so the app shows the landing page after sign out.

**Flow now:**
1. User clicks "Sign out"
2. Button shows "Signing out…" (via `isSigningOut`)
3. `supabase.auth.signOut()` runs
4. `setAccessToken(null)` + `setGraph(null)` and related state
5. `!graph && !loading` → landing page renders
6. Sign out button is not on the landing page (workspace-only UI)

---

## Issue 2 — Error: Unauthorized: invalid token

**Root cause:** The server (`requireUser`) validates the Bearer token with Supabase `auth.getUser(token)`. Supabase rejects it when:
- Token expired
- Token is for a different Supabase project than the server
- Client `VITE_SUPABASE_URL` ≠ server `SUPABASE_URL` (project mismatch)

**Fix applied:**
- Chat requests use `supabase.auth.getSession()` for a fresh token before calling the API
- On 401, the client logs `[Auth] 401 — token rejected` with `serverProjectRef` and `clientProjectRef`
- New endpoint: `GET /api/auth/config` → `{ supabaseConfigured, projectRef }` for config checks

**Debugging steps:**

1. **Check Supabase config**  
   Ensure client and server use the same project:
   - Client (`.env`): `VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co`
   - Server (`.env`): `SUPABASE_URL=https://YOUR_PROJECT.supabase.co`  
   The project IDs (e.g. `xxxxx` in `xxxxx.supabase.co`) must match.

2. **Enable server token logs**  
   Add to `webapp/server/.env`:
   ```
   DEBUG_AUTH=true
   ```
   Restart the server. It will log token validation (success/fail, user id, errors) for each protected request.

3. **Verify token on 401**  
   In dev, after a 401 the browser console shows:
   ```
   [Auth] 401 — token rejected. Debug: { serverProjectRef: "xxx", clientProjectRef: "yyy" }
   ```
   If `serverProjectRef !== clientProjectRef`, fix the env vars so both use the same Supabase project.

4. **Sign in again**  
   Sign out (landing page), then sign in. Use the new token and retry the chat.
