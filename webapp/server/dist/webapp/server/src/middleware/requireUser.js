import * as jose from "jose";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { logAuth } from "../authDebug.js";
const supabaseUrl = process.env.SUPABASE_URL?.trim();
/** Fallback: verify JWT locally via Supabase JWKS (works when getUser returns Invalid API key) */
async function verifyJwtViaJwks(token) {
    if (!supabaseUrl)
        return null;
    const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
    try {
        const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
        const { payload } = await jose.jwtVerify(token, JWKS, {
            issuer: `${supabaseUrl}/auth/v1`,
            audience: "authenticated",
        });
        const sub = payload.sub;
        const email = payload.email;
        const user_metadata = payload.user_metadata;
        return sub ? { sub, email, user_metadata } : null;
    }
    catch {
        return null;
    }
}
export async function requireUser(req, res, next) {
    if (!supabaseAdmin && !supabaseUrl) {
        res.status(503).json({ error: "Auth service not configured." });
        return;
    }
    const authHeader = req.header("authorization") || req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!token) {
        logAuth("requireUser", { hasToken: false });
        res.status(401).json({ error: "Unauthorized: missing Bearer token" });
        return;
    }
    const tokenPreview = token.length >= 20 ? `${token.slice(0, 10)}...${token.slice(-6)}` : "***";
    // Try supabase.auth.getUser first
    if (supabaseAdmin) {
        let result;
        try {
            result = await supabaseAdmin.auth.getUser(token);
        }
        catch (e) {
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
                user_metadata: data.user.user_metadata ?? undefined,
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
