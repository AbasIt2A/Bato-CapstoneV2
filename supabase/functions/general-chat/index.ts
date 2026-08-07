// General CKD Chatbot — Edge Function (hardened-RAG spec §12).
//
// Free-form, topic-constrained conversational assistant. Single-turn and
// stateless in this standalone build (no chat-session persistence). Grounds
// every answer in retrieval, never in a baked-in knowledge base:
//
//   (1) input gate classifies in_scope + injection_detected;
//   (2) embed the query ONCE — reused by (2a) and (3);
//   (2a) semantic answer-cache probe; a hit returns immediately, spending no
//        generation quota (see _shared/answer-cache.ts);
//   (3) pgvector top-K on the query embedding;
//   (4) rerank to top-N above threshold;
//   (5) if none pass, return the approved deflection;
//   (6) else generate with retrieved chunks as UNTRUSTED DATA, strictly
//       separated from instructions, citing each source;
//   (7) diagnostic-language filter — never let "you have CKD" reach a user;
//   (8) output guard (injection fallout / groundedness) — cheap heuristic
//       check before the reply ever reaches the user;
//   (9) store the guarded reply in the answer cache.
//
// The cache probe sits AFTER the gate and the write happens AFTER every
// guard, so caching can neither bypass screening on the way in nor preserve
// an unguarded reply on the way out.
//
// Every infrastructure failure (embedding, RPC, generation) degrades to the
// deflection with a server-side log — never a raw 500 with internals.
//
// POST { message: string } → { reply, sources, deflected }

import { classifyQuery, type GateVerdict } from "../_shared/gate.ts";
import {
  embedForCache,
  embedQuery,
  retrieveChunks,
  type RetrievedChunk,
} from "../_shared/retrieval.ts";
import { rerankChunks } from "../_shared/rerank.ts";
import { buildGroundedUserMessage } from "../_shared/rag-content.ts";
import { generateReply, generationModelFor } from "../_shared/gemini.ts";
import {
  type CachedAnswer,
  lookupCachedAnswer,
  lookupExactAnswer,
  recordCacheHit,
  storeAnswer,
} from "../_shared/answer-cache.ts";
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

    // Serves a cache hit. Runs only AFTER the gate, so nothing the gate would
    // have blocked can reach a cached reply. The stored text already passed
    // every guard below, and those guards are deterministic, so re-running
    // them on identical input cannot change the outcome.
    const serveCached = (cached: CachedAnswer): Response => {
      console.info(
        `general-chat: answer-cache ${cached.tier} hit (similarity ${
          cached.similarity.toFixed(3)
        }) — no generation call`,
      );
      const body: ChatResponse = {
        reply: cached.reply,
        sources: cached.sources as SourceCitation[],
        deflected: false,
      };
      return jsonResponse(body);
    };

    // (2a) TIER 1 — exact match on the normalised question. Deliberately
    // before any embedding: it needs none, cannot false-hit, and catches the
    // repeat pattern that actually dominates a scripted evaluation session.
    const exact = await lookupExactAnswer(supabase, message, SCOPE);
    if (exact) {
      await recordCacheHit(supabase, exact.id);
      return serveCached(exact);
    }

    // (2b) Two embeddings, in parallel, in DIFFERENT geometries: retrieval
    // needs RETRIEVAL_QUERY, the cache's similarity tier needs
    // SEMANTIC_SIMILARITY, and the two vectors are not interchangeable.
    // Issued together so the second costs no wall-clock latency; embeddings
    // sit on a separate, far larger quota than generation.
    let embedding: number[];
    let cacheEmbedding: number[];
    try {
      [embedding, cacheEmbedding] = await Promise.all([
        embedQuery(message),
        embedForCache(message),
      ]);
    } catch (err) {
      console.error("general-chat: embedding failed — deflecting:", err);
      return deflect();
    }

    // (2c) TIER 2 — similarity backstop, at a threshold set above every
    // measured false-hit pair. Expected to hit rarely by design; see the
    // measurement note in answer-cache.ts.
    const cached = await lookupCachedAnswer(supabase, cacheEmbedding, SCOPE);
    if (cached) {
      await recordCacheHit(supabase, cached.id);
      return serveCached(cached);
    }

    // (3) pgvector similarity for a wide candidate pool, reusing the vector
    // from (2b). Infrastructure failure here maps to a deflection.
    let candidates: RetrievedChunk[];
    try {
      candidates = await retrieveChunks(supabase, message, SCOPE, embedding);
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
        // Selects this chatbot's own generation model, kept distinct from
        // the clarification engine's so the two do not share one free-tier
        // daily allowance (see generationModelFor in gemini.ts).
        scope: SCOPE,
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

    // (9) Cache the finished reply. Reached ONLY here — past the rerank
    // threshold, the diagnostic filter and the output guard — so a deflection
    // can never be stored, and a stored reply is one that already satisfied
    // every guard. Failure to write is logged and ignored: the next identical
    // question simply regenerates.
    await storeAnswer(supabase, {
      scope: SCOPE,
      question: message,
      // The SEMANTIC_SIMILARITY vector, matching what tier 2 queries against.
      embedding: cacheEmbedding,
      reply: draft,
      sources,
      model: generationModelFor(SCOPE),
    });

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
