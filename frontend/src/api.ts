// Thin client for the deployed general-chat Edge Function. Uses plain fetch
// with the public anon key — no supabase-js needed, since the chatbot is the
// only backend surface this frontend talks to.

export interface SourceCitation {
  source: string;
  title: string;
  /** Null for a chunk that sat directly under the document's H1. */
  heading_path: string | null;
}

export interface ChatResponse {
  reply: string;
  sources: SourceCitation[];
  deflected: boolean;
}

// Mirrors MAX_MESSAGE_LENGTH in supabase/functions/general-chat/index.ts.
export const MAX_MESSAGE_LENGTH = 2000;

/** One earlier turn, sent so the backend can read a follow-up in context. */
export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Exchanges of history sent with each message. Mirrors MAX_HISTORY_TURNS
 * (6 turns) in supabase/functions/_shared/gate.ts — the server trims to that
 * anyway, so sending more only wastes bandwidth.
 */
export const HISTORY_EXCHANGES = 3;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export async function askGeneralChat(
  message: string,
  history: HistoryTurn[] = [],
): Promise<ChatResponse> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      "Frontend is not configured — copy frontend/.env.example to frontend/.env " +
        "and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/general-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ message, history }),
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `request failed with status ${res.status}`;
    throw new Error(detail);
  }
  return data as ChatResponse;
}
