// Shared server-side helpers for the Edge Functions: CORS, the Supabase
// service-role client, and caller identity. The service-role client bypasses
// RLS and must never leave server-side code.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Comma-separated list so the same deploy can serve local dev
// (http://localhost:5173) and the deployed frontend at once — e.g.
// "http://localhost:5173,https://bato-capstone-v2.vercel.app".
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  // Loud, one-time (module-load-time) warning: a "*" CORS origin is fine for
  // local testing (see SETUP.md) but must never reach a production deploy
  // silently — this makes a missing ALLOWED_ORIGIN secret visible in
  // function logs instead of only in behavior.
  console.warn(
    "supabase.ts: ALLOWED_ORIGIN is not set — falling back to " +
      '"Access-Control-Allow-Origin: *". Set ALLOWED_ORIGIN in production.',
  );
}

export const corsHeaders: Record<string, string> = {
  // Per-request handlers overwrite this with resolveCorsOrigin(req) before
  // returning — see the Deno.serve wrapper in each function's index.ts.
  "Access-Control-Allow-Origin": allowedOrigins[0] ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

/**
 * Picks the Access-Control-Allow-Origin value for one request: the caller's
 * own Origin header when it's in the allowlist, otherwise the first
 * allowed origin (or "*" if none are configured). Callers must copy this
 * onto the outgoing Response — see each function's Deno.serve wrapper.
 */
export function resolveCorsOrigin(req: Request): string {
  if (allowedOrigins.length === 0) return "*";
  const origin = req.headers.get("Origin");
  return origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Resolves the caller's user id from the request JWT (anonymous sign-ins
 * included). Returns null if the token is missing or invalid — the platform
 * already rejects unauthenticated calls when verify_jwt is on, so this is a
 * second check plus identity extraction.
 *
 * Used ONLY by the screening controller, which writes assessment rows owned
 * by a caller. The clarification engine deliberately does not use it: that
 * branch performs no writes and holds no assessment identity at all.
 */
export async function getCallerUserId(
  req: Request,
  supabase: SupabaseClient,
): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
