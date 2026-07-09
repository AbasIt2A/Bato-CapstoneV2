// Shared server-side helpers for the General CKD Chatbot Edge Function:
// CORS and the Supabase service-role client. The service-role client
// bypasses RLS and must never leave server-side code.

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
