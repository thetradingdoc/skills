import type { Request, Response, NextFunction } from "express";
import * as jose from "jose";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { logAuth } from "../authDebug.js";

export type AuthenticatedUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      accessToken?: string;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL?.trim();

/** Fallback: verify JWT locally via Supabase JWKS (works when getUser returns Invalid API key) */
async function verifyJwtViaJwks(token: string): Promise<{ sub: string; email?: string; user_metadata?: Record<string, unknown> } | null> {
  if (!supabaseUrl) return null;
  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  try {
    const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
    });
    const sub = payload.sub as string;
    const email = payload.email as string | undefined;
    const user_metadata = payload.user_metadata as Record<string, unknown> | undefined;
    return sub ? { sub, email, user_metadata } : null;
  } catch {
    return null;
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!supabaseAdmin && !supabaseUrl) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const authHeader = req.header("authorization") || req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  // Dev bypass: skip auth when CHAT_DEV_BYPASS=1 and request is from localhost (for terminal tests)
  const devBypass = process.env.CHAT_DEV_BYPASS === "1";
  const host = req.get("host") ?? "";
  const remote = req.socket?.remoteAddress ?? req.ip ?? "";
  const fromLocalhost =
    req.ip === "127.0.0.1" ||
    req.ip === "::1" ||
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    req.get("x-forwarded-for")?.includes("127.0.0.1");
  if (!token && devBypass && fromLocalhost) {
    logAuth("requireUser", { devBypass: true });
    req.user = { id: "dev-bypass-user", email: "dev@local" };
    next();
    return;
  }

  if (!token) {
    logAuth("requireUser", { hasToken: false });
    res.status(401).json({ error: "Unauthorized: missing Bearer token" });
    return;
  }

  const tokenPreview = token.length >= 20 ? `${token.slice(0, 10)}...${token.slice(-6)}` : "***";

  // Try supabase.auth.getUser first
  if (supabaseAdmin) {
    let result: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>;
    try {
      result = await supabaseAdmin.auth.getUser(token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause : null;
      const isNetwork = cause?.message?.includes("ENOTFOUND") || msg?.includes("fetch failed");
      logAuth("requireUser", {
        hasToken: true,
        tokenPreview,
        success: false,
        error: msg,
        networkError: isNetwork,
      });
      res.status(503).json({
        error: isNetwork
          ? "Auth service unavailable. Check your connection and Supabase project status."
          : "Auth service error",
      });
      return;
    }

    const { data, error } = result;
    if (!error && data?.user) {
      logAuth("requireUser", {
        hasToken: true,
        tokenPreview,
        success: true,
        userId: data.user.id,
      });
      req.user = {
        id: data.user.id,
        email: data.user.email ?? undefined,
        user_metadata: (data.user.user_metadata as Record<string, unknown> | undefined) ?? undefined,
      };
      req.accessToken = token;
      next();
      return;
    }
  }

  // Fallback: verify via JWKS (fixes "Invalid API key" with new Supabase key format)
  const jwtPayload = await verifyJwtViaJwks(token);
  if (jwtPayload) {
    logAuth("requireUser", {
      hasToken: true,
      tokenPreview,
      success: true,
      userId: jwtPayload.sub,
    });
    req.user = {
      id: jwtPayload.sub,
      email: jwtPayload.email,
      user_metadata: jwtPayload.user_metadata,
    };
    req.accessToken = token;
    next();
    return;
  }

  logAuth("requireUser", {
    hasToken: true,
    tokenPreview,
    success: false,
    error: "getUser failed and JWKS verification failed",
  });
  res.status(401).json({ error: "Unauthorized: invalid token" });
}

