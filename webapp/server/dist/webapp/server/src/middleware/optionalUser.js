import * as jose from "jose";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { logAuth } from "../authDebug.js";
/**
 * Attaches user to req if a valid Bearer token is present. Does not reject unauthenticated requests.
 */
export async function optionalUser(req, _res, next) {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const authHeader = req.header("authorization") || req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!token) {
        logAuth("optionalUser", { hasToken: false });
        req.user = undefined;
        req.accessToken = undefined;
        next();
        return;
    }
    const tokenPreview = token.length >= 20 ? `${token.slice(0, 10)}...${token.slice(-6)}` : "***";
    // Try getUser first (requires a working Supabase server key).
    if (supabaseAdmin) {
        try {
            const result = await supabaseAdmin.auth.getUser(token);
            const { data, error } = result;
            if (!error && data?.user) {
                logAuth("optionalUser", {
                    hasToken: true,
                    tokenPreview,
                    success: true,
                    userId: data.user.id,
                    method: "getUser",
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
        catch {
            // fall through to JWKS
        }
    }
    // Fallback: verify JWT via JWKS (works even if getUser fails due to key format).
    if (supabaseUrl) {
        try {
            const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
            const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
            const { payload } = await jose.jwtVerify(token, JWKS, {
                issuer: `${supabaseUrl}/auth/v1`,
                audience: "authenticated",
            });
            const sub = payload.sub;
            if (sub) {
                logAuth("optionalUser", {
                    hasToken: true,
                    tokenPreview,
                    success: true,
                    userId: sub,
                    method: "JWKS",
                });
                req.user = {
                    id: sub,
                    email: payload.email,
                    user_metadata: payload.user_metadata,
                };
                req.accessToken = token;
                next();
                return;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logAuth("optionalUser", {
                hasToken: true,
                tokenPreview,
                success: false,
                error: msg,
                method: "JWKS",
            });
        }
    }
    // No valid user.
    logAuth("optionalUser", { hasToken: true, tokenPreview, success: false });
    req.user = undefined;
    req.accessToken = undefined;
    next();
}
