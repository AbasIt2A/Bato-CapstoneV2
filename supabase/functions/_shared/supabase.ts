// Shared server-side helpers for the Edge Functions: CORS, the Supabase
// service-role client, and caller identity. The service-role client bypasses
// RLS and must never leave server-side code.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
if (!allowedOrigin) {
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
  // Tighten to the deployed frontend origin once hosting is decided.
  "Access-Control-Allow-Origin": allowedOrigin ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
