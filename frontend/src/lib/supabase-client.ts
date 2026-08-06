// Shared Supabase client for the two authenticated backend surfaces (Risk
// Assessment's screening/clarify functions and the evaluation survey) —
// both now live in this project's own Supabase project alongside
// general-chat, so there is exactly one client and one anonymous session.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Frontend is not configured — copy frontend/.env.example to " +
        "frontend/.env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/**
 * Anonymous-first auth: every visitor gets a Supabase anonymous session so
 * Edge Functions can identify them and RLS applies, without sign-up friction.
 */
export async function ensureSession(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      /disabled/i.test(error.message)
        ? "Anonymous sign-ins are disabled on this Supabase project. " +
            "Enable them in Supabase Dashboard → Authentication → " +
            "Sign In / Providers → Allow anonymous sign-ins."
        : error.message,
    );
  }
}
