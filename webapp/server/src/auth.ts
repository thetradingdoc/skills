import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

/** Debug: validate a token and return result (uses JWKS fallback when getUser fails) */
router.post("/auth/debug-validate", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token required in body" });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL?.trim();

  // Try getUser first
  if (supabaseAdmin) {
    try {
      const result = await supabaseAdmin.auth.getUser(token);
      const { data, error } = result;
      if (!error && data?.user) {
        return res.json({
          valid: true,
          userId: data.user.id,
          email: data.user.email,
          method: "getUser",
        });
      }
    } catch (_e) {
      /* fall through to JWKS */
    }
  }

  // Fallback: verify via JWKS
  if (supabaseUrl) {
    try {
      const jose = await import("jose");
      const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
      const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: "authenticated",
      });
      const sub = payload.sub as string;
      return res.json({
        valid: true,
        userId: sub,
        email: payload.email as string | undefined,
        method: "JWKS",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.json({
        valid: false,
        error: { message: msg },
        method: "JWKS",
      });
    }
  }

  res.status(503).json({ error: "Auth not configured", valid: false });
});

/** Debug: returns whether server Supabase is configured + project ref for config-mismatch checks */
router.get("/auth/config", (_req, res) => {
  const url = process.env.SUPABASE_URL?.trim();
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = url?.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? null;
  res.json({
    supabaseConfigured: !!(url && hasKey),
    projectRef: projectRef ?? undefined,
  });
});

router.get("/auth/me", requireUser, async (req, res) => {
  res.json({
    user: req.user,
  });
});

// Supabase Auth logout is client-side (token/session revocation handled by Supabase).
router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

export { router as authRoutes };

