// General CKD Chatbot — Edge Function (hardened-RAG spec §12).
//
// Free-form, topic-constrained conversational assistant. Single-turn and
// stateless in this standalone build (no chat-session persistence). Grounds
// every answer in retrieval, never in a baked-in knowledge base:
//
//   (1) input gate classifies in_scope + injection_detected;
//   (2)-(3) embed the query, pgvector top-K;
//   (4) rerank to top-N above threshold;
//   (5) if none pass, return the approved deflection;
//   (6) else generate with retrieved chunks as UNTRUSTED DATA, strictly
//       separated from instructions, citing each source;
//   (7) diagnostic-language filter — never let "you have CKD" reach a user;
//   (8) output guard (injection fallout / groundedness) — cheap heuristic
//       check before the reply ever reaches the user.
//
// Every infrastructure failure (embedding, RPC, generation) degrades to the
// deflection with a server-side log — never a raw 500 with internals.
//
// POST { message: string } → { reply, sources, deflected }

import { classifyQuery, type GateVerdict } from "../_shared/gate.ts";
import { retrieveChunks, type RetrievedChunk } from "../_shared/retrieval.ts";
import { rerankChunks } from "../_shared/rerank.ts";
import { buildGroundedUserMessage } from "../_shared/rag-content.ts";
import { generateReply } from "../_shared/gemini.ts";
import { checkDraftAnswer } from "../_shared/output-guard.ts";
import { filterAssistantReply } from "../_shared/topic-filter.ts";
import {
  DEFLECTION_MESSAGE,
  GENERAL_CHAT_SYSTEM_PROMPT,
} from "../_shared/prompts.ts";
import {
  corsHeaders,
  createServiceClient,
  jsonResponse,
} from "../_shared/supabase.ts";
import type { RetrievalScope } from "../_shared/scopes.ts";

/**
 * Hard-locked. Never taken from the request — the client cannot widen this
 * chatbot's retrieval surface to the screening-clarification corpus. The RPC
 * enforces it again server-side (see match_knowledge_chunks).
 */
const SCOPE: RetrievalScope = "general_education";

const MAX_MESSAGE_LENGTH = 2000;

interface SourceCitation {
  source: string;
  title: string;
  heading_path: string | null;
}

interface ChatResponse {
  reply: string;
  sources: SourceCitation[];
  deflected: boolean;
}

function deflect(): Response {
  const body: ChatResponse = {
    reply: DEFLECTION_MESSAGE,
    sources: [],
    deflected: true,
  };
  return jsonResponse(body);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return jsonResponse({ error: "message is required" }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse({ error: "Message is too long" }, 400);
  }

  try {
    const supabase = createServiceClient();

    // (1) Input gate — scope + injection classification. classifyQuery()
    // never throws (fail-open on API error), but a defensive catch keeps
    // this route from ever surfacing a raw 500.
    let verdict: GateVerdict;
    try {
      verdict = await classifyQuery(message);
    } catch (err) {
      console.warn(
        "general-chat: gate threw unexpectedly — failing open:",
        err,
      );
      verdict = { in_scope: true, injection_detected: false, reason: "gate-error" };
    }
    if (!verdict.in_scope || verdict.injection_detected) {
      console.warn("general-chat: gate blocked message:", verdict.reason);
      return deflect();
    }

    // (2)-(3) Embed the query and run pgvector similarity for a wide
    // candidate pool. Infrastructure failure here maps to a deflection.
    let candidates: RetrievedChunk[];
    try {
      candidates = await retrieveChunks(supabase, message, SCOPE);
    } catch (err) {
      console.error("general-chat: retrieval failed — deflecting:", err);
      return deflect();
    }

    // (4) Rerank to the top-N above the relevance threshold. Never throws;
    // an empty result means nothing grounds this question.
    const reranked = await rerankChunks(message, candidates, SCOPE);
    if (reranked.length === 0) {
      console.warn(
        "general-chat: no chunks cleared the rerank threshold — deflecting",
      );
      return deflect();
    }

    // (5) Generate. The system prompt is the ONLY trusted instruction
    // region; the retrieved chunks and the user's question travel together,
    // both neutralized, as the single untrusted user turn. Never
    // concatenate user/retrieved text into the system prompt.
    let draft: string;
    try {
      draft = await generateReply({
        systemPrompt: GENERAL_CHAT_SYSTEM_PROMPT,
        message: buildGroundedUserMessage(message, reranked),
      });
    } catch (err) {
      console.error("general-chat: generation failed — deflecting:", err);
      return deflect();
    }

    // (7) Diagnostic-language filter. Distinct from the output guard below:
    // this catches "you have CKD" reaching a user, which the groundedness/
    // injection guard does not check for at all.
    const filtered = filterAssistantReply(draft);
    if (!filtered.ok) {
      console.warn("general-chat: diagnostic-language filter blocked reply:", filtered.blockedReason);
      return deflect();
    }

    // (8) Output safety check — cheap heuristics, no model call. Pass this
    // request's actually-retrieved sources so the groundedness/citation
    // check judges the draft against what the generator was actually given.
    const guard = checkDraftAnswer(
      draft,
      GENERAL_CHAT_SYSTEM_PROMPT,
      reranked.map((c) => c.source),
    );
    if (!guard.safe) {
      console.warn("general-chat: output guard blocked reply:", guard.reason);
      return deflect();
    }

    const sources: SourceCitation[] = reranked.map((c) => ({
      source: c.source,
      title: c.title,
      heading_path: c.heading_path ?? null,
    }));

    const response: ChatResponse = {
      reply: draft,
      sources,
      deflected: false,
    };
    return jsonResponse(response);
  } catch (err) {
    // Last-resort safety net: any unexpected failure anywhere in the
    // pipeline still degrades to the deflection, never a raw 500.
    console.error("general-chat: unexpected error — deflecting:", err);
    return deflect();
  }
});
