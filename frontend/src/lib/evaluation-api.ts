// Evaluation capture (SUS / TAM / TiMT). Writes directly via the shared
// Supabase client — RLS allows users to insert only their own rows.

import { ensureSession, getSupabaseClient } from "./supabase-client";

export async function submitEvaluation(
  instrument: string,
  responses: Record<string, unknown>,
  score: number,
): Promise<void> {
  await ensureSession();
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Could not start a session.");

  const { error } = await supabase.from("evaluation_responses").insert({
    user_id: session.user.id,
    instrument,
    responses,
    score,
  });
  if (error) throw new Error(error.message);
}
