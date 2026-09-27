// General CKD Chatbot — Edge Function (hardened-RAG spec §12).
//
// Free-form, topic-constrained conversational assistant. Stateless on the
// SERVER (no chat-session persistence): the client sends the recent turns
// with each request, and nothing about the conversation is stored here.
// Grounds every answer in retrieval, never in a baked-in knowledge base:
//
//   (1) input gate classifies in_scope + injection_detected, and — when the
//       request carries history — resolves the message into a question that
//       stands alone;
//   (2) embed the query ONCE — reused by (2a) and (3);
//   (2a) semantic answer-cache probe; a hit returns immediately, spending no
//        generation quota (see _shared/answer-cache.ts);
//   (3) pgvector top-K on the query embedding;
//   (4) rerank to top-N above threshold;
//   (4b) if none pass, rephrase the question once and retry retrieval — the
//        reranker scores personal phrasings poorly even when the corpus has
//        the answer (see reformulateForRetrieval in _shared/gate.ts);
//   (5) if that finds nothing either, return the approved deflection;
//   (6) else generate with retrieved chunks as UNTRUSTED DATA, strictly
//       separated from instructions, declaring the sources used on a final
//       machine-readable line; verify that declaration, then strip it and any
//       citation the model wrote into the prose (see _shared/citations.ts);
//   (7) diagnostic-language filter — never let "you have CKD" reach a user;
//   (8) output guard (injection fallout / groundedness) — cheap heuristic
//       check before the reply ever reaches the user;
//   (9) store the guarded reply in the answer cache.
//
// The cache probe sits AFTER the gate and the write happens AFTER every
// guard, so caching can neither bypass screening on the way in nor preserve
// an unguarded reply on the way out.
//
// Every infrastructure failure (embedding, RPC, generation) degrades to a
// graceful reply with a server-side log — never a raw 500 with internals.
// It degrades to SERVICE_ERROR_MESSAGE, NOT to the scope deflection: those
// two sentences make different claims, and only one of them is true when the
// pipeline breaks under an in-scope question. See serviceError() below.
//
// ===== ONE RESOLVED QUESTION, USED EVERYWHERE =====
//
// Steps 2 onward run on the RESOLVED question — the gate's rewrite when there
// was one, the raw message otherwise — and never on a mixture of the two. A
// follow-up like "how bad is this?" is unusable on its own at every one of
// those stages: it embeds to nothing useful, and as a cache key it is
// actively dangerous, because the same three words mean something different
// in every conversation that contains them. Keying the cache on the resolved
// question is what stops one conversation's answer being served into
// another's.
//
// POST { message: string, history?: {role, text}[] }
//   → { reply, sources, deflected }

import {
  classifyQuery,
  type ConversationTurn,
  type GateVerdict,
  normalizeHistory,
  reformulateForRetrieval,
} from "../_shared/gate.ts";
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
import {
  allowedCitationIds,
  mentionsSourceId,
  splitSourceFooter,
  stripInlineCitations,
} from "../_shared/citations.ts";
import { filterAssistantReply } from "../_shared/topic-filter.ts";
import {
  DEFLECTION_MESSAGE,
  GENERAL_CHAT_SYSTEM_PROMPT,
  SERVICE_ERROR_MESSAGE,
} from "../_shared/prompts.ts";
import {
  corsHeaders,
  createServiceClient,
  jsonResponse,
  resolveCorsOrigin,
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

/**
 * The reply for a TEMPORARY INFRASTRUCTURE FAILURE — never for a decision
 * about the question itself.
 *
 * Use this where the pipeline broke: the embedding call, the retrieval RPC,
 * the generation call, or the last-resort catch. Use deflect() where the
 * pipeline WORKED and the answer was withheld: the gate blocked the message,
 * nothing cleared the rerank threshold, the reply cited nothing retrieved, or
 * a guard tripped. The distinction is whether the sentence the user reads is
 * true, and until 2026-08-30 it frequently was not — a Gemini
 * MALFORMED_RESPONSE told the user their in-scope question was off-topic.
 *
 * `deflected` stays TRUE on the wire. It is not a claim about scope; it is
 * what tells the client this turn carries no answer, and the frontend uses it
 * to keep the turn out of the conversation history sent with the next message
 * (see recentHistory in GeneralChat.tsx). A failed turn has no subject for a
 * follow-up to inherit, exactly like a refusal.
 */
function serviceError(): Response {
  const body: ChatResponse = {
    reply: SERVICE_ERROR_MESSAGE,
    sources: [],
    deflected: true,
  };
  return jsonResponse(body);
}

Deno.serve(async (req) => {
  const response = await handleRequest(req);
  response.headers.set("Access-Control-Allow-Origin", resolveCorsOrigin(req));
  return response;
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { message?: unknown; history?: unknown };
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

  // Optional, unverified, and validated rather than trusted: malformed
  // history degrades to no history, which is simply the single-turn request
  // this endpoint accepted before. See the security note in gate.ts.
  const history: ConversationTurn[] = normalizeHistory(body.history);

  try {
    const supabase = createServiceClient();

    // (1) Input gate — scope + injection classification. classifyQuery()
    // never throws (fail-open on API error), but a defensive catch keeps
    // this route from ever surfacing a raw 500.
    let verdict: GateVerdict;
    try {
      verdict = await classifyQuery(message, SCOPE, history);
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

    // The question every later stage works from. Falls back to the raw
    // message whenever there was no history, the gate failed open, or the
    // rewrite did not survive sanitizeRewrite() — in all three cases the
    // pipeline behaves exactly as the single-turn version did.
    const question = verdict.standalone_question ?? message;
    if (question !== message) {
      console.info(
        `general-chat: resolved follow-up in context — "${message}" → "${question}"`,
      );
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
    const exact = await lookupExactAnswer(supabase, question, SCOPE);
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
        embedQuery(question),
        embedForCache(question),
      ]);
    } catch (err) {
      console.error("general-chat: embedding failed:", err);
      return serviceError();
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
      candidates = await retrieveChunks(supabase, question, SCOPE, embedding);
    } catch (err) {
      console.error("general-chat: retrieval failed:", err);
      return serviceError();
    }

    // (4) Rerank to the top-N above the relevance threshold. Never throws;
    // an empty result means nothing grounds this question.
    let reranked = await rerankChunks(question, candidates, SCOPE);

    // (4b) SECOND-CHANCE RETRIEVAL. Nothing cleared the threshold, which has
    // two very different causes: the corpus has no answer, or it has one and
    // the question was phrased in a way the reranker scores poorly. Only the
    // second is fixable, and it is common — a worried personal framing
    // ("when should I be worried about going under dialysis treatment?")
    // scored 0.292 against the very passage that answers it, where the plain
    // form of the same question scored 0.682.
    //
    // So before deflecting, rephrase once and look again. If the corpus truly
    // has nothing, the retry finds nothing either and the deflection stands —
    // it costs one small Groq call on a request that was already lost.
    //
    // The reformulation is used for RETRIEVAL ONLY. Generation, the cache key
    // and the reply all stay with the user's own question: rephrasing is a
    // way to find passages, never a licence to answer something else.
    if (reranked.length === 0) {
      const reformulated = await reformulateForRetrieval(question);
      if (reformulated) {
        console.info(
          `general-chat: nothing cleared rerank — retrying retrieval as "${reformulated}"`,
        );
        try {
          const retryEmbedding = await embedQuery(reformulated);
          const retryCandidates = await retrieveChunks(
            supabase,
            reformulated,
            SCOPE,
            retryEmbedding,
          );
          reranked = await rerankChunks(reformulated, retryCandidates, SCOPE);
        } catch (err) {
          console.warn("general-chat: second-chance retrieval failed:", err);
        }
      }
    }

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
        message: buildGroundedUserMessage(question, reranked),
        // Selects this chatbot's own generation model, kept distinct from
        // the clarification engine's so the two do not share one free-tier
        // daily allowance (see generationModelFor in gemini.ts).
        scope: SCOPE,
      });
    } catch (err) {
      console.error("general-chat: generation failed:", err);
      return serviceError();
    }

    // (6) Attribution. The model declares what it used on a final SOURCES
    // line instead of naming sources mid-sentence; verify that declaration
    // against what was actually retrieved, then strip it. A reply that
    // declares nothing usable is treated exactly as an uncited reply always
    // was — ungrounded, therefore deflected. See citations.ts for why the
    // check could not simply be dropped.
    const allowed = allowedCitationIds(reranked);
    const split = splitSourceFooter(draft);
    const cited = split.declared.filter((id) => allowed.includes(id));
    if (cited.length === 0) {
      console.warn(
        `general-chat: reply declared no retrieved source (footer: ${
          split.hasFooter ? split.declared.join(", ") || "empty" : "absent"
        }) — deflecting`,
      );
      return deflect();
    }
    // Backstop for the prose rule: strip any citation the model wrote into
    // the sentences anyway, so the reply reads the same way every time.
    const reply = stripInlineCitations(split.visible);
    if (!reply) {
      console.warn("general-chat: reply was empty after removing its source line — deflecting");
      return deflect();
    }

    // (7) Diagnostic-language filter. Distinct from the output guard below:
    // this catches "you have CKD" reaching a user, which the groundedness/
    // injection guard does not check for at all.
    const filtered = filterAssistantReply(reply);
    if (!filtered.ok) {
      console.warn("general-chat: diagnostic-language filter blocked reply:", filtered.blockedReason);
      return deflect();
    }

    // (8) Output safety check — cheap heuristics, no model call. Runs on the
    // USER-VISIBLE text. requireCitation is off because step 6 already
    // verified attribution: the visible prose is citation-free by design, so
    // the in-text check would now reject every correct answer.
    const guard = checkDraftAnswer(
      reply,
      GENERAL_CHAT_SYSTEM_PROMPT,
      reranked.map((c) => c.source),
      { requireCitation: false },
    );
    if (!guard.safe) {
      console.warn("general-chat: output guard blocked reply:", guard.reason);
      return deflect();
    }

    // Chips show what the answer actually used, in the order the model
    // declared it — not everything retrieval happened to return. Each is
    // described by the passage it came from, so the tooltip still points at a
    // real section of a real document.
    const sources: SourceCitation[] = cited.map((id) => {
      const chunk = reranked.find((c) => c.source === id) ??
        reranked.find((c) => mentionsSourceId(c.content, id))!;
      return {
        source: id,
        title: chunk.title,
        heading_path: chunk.heading_path ?? null,
      };
    });

    // (9) Cache the finished reply. Reached ONLY here — past the rerank
    // threshold, the diagnostic filter and the output guard — so a deflection
    // can never be stored, and a stored reply is one that already satisfied
    // every guard. Failure to write is logged and ignored: the next identical
    // question simply regenerates.
    await storeAnswer(supabase, {
      scope: SCOPE,
      question,
      // The SEMANTIC_SIMILARITY vector, matching what tier 2 queries against.
      embedding: cacheEmbedding,
      // The cleaned, user-visible text — never the raw draft. A cached reply
      // is served verbatim, so storing the draft would put the SOURCES line
      // and any stripped citation back in front of a later user.
      reply,
      sources,
      model: generationModelFor(SCOPE),
    });

    const response: ChatResponse = {
      reply,
      sources,
      deflected: false,
    };
    return jsonResponse(response);
  } catch (err) {
    // Last-resort safety net: any unexpected failure anywhere in the
    // pipeline still degrades to a graceful reply, never a raw 500.
    console.error("general-chat: unexpected error:", err);
    return serviceError();
  }
}
