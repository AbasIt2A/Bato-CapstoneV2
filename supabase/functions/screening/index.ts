// Rule-Based Screening Controller — Edge Function (PRD §6.2/§6.3A).
//
// HTTP/DB glue around the pure state machine in _shared/screening-flow.ts.
// Fully deterministic: this function has no LLM dependency of any kind
// (FR-4). Clarification requests never reach this function — the frontend
// calls the separate `clarify` function and returns to the same step (FR-3).
//
// Actions (POST JSON):
//   { action: "start" }
//     → { assessmentId, step }
//   { action: "answer", assessmentId, value }
//     → { valid: false, message, step }                 (re-ask, no advance)
//     → { valid: true, step }                           (next question)
//     → { valid: true, completed: true, result }        (flow finished)
//   { action: "status", assessmentId }
//     → { status, step? , result? }
//   { action: "abandon", assessmentId }
//     → { ok: true }

import {
  evaluateAnswer,
  finalizeAssessment,
  nextStepIndex,
  SCREENING_SEQUENCE,
  stepPayload,
  TOTAL_STEPS,
} from "../_shared/screening-flow.ts";
import {
  corsHeaders,
  createServiceClient,
  getCallerUserId,
  jsonResponse,
} from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = createServiceClient();
  const userId = await getCallerUserId(req, supabase);
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { action?: string; assessmentId?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "start": {
        const { data, error } = await supabase
          .from("assessments")
          .insert({ user_id: userId })
          .select("id")
          .single();
        if (error) throw error;
        return jsonResponse({ assessmentId: data.id, step: stepPayload(0) });
      }

      case "status": {
        const assessment = await loadOwnAssessment(supabase, body, userId);
        if (!assessment) return jsonResponse({ error: "Not found" }, 404);
        if (assessment.status === "completed") {
          return jsonResponse({
            status: "completed",
            result: {
              totalScore: assessment.total_score,
              classification: assessment.classification,
            },
          });
        }
        if (assessment.status === "abandoned") {
          return jsonResponse({ status: "abandoned" });
        }
        const responses = await loadResponses(supabase, assessment.id);
        return jsonResponse({
          status: "in_progress",
          step: stepPayload(nextStepIndex(responses)),
        });
      }

      case "answer": {
        const assessment = await loadOwnAssessment(supabase, body, userId);
        if (!assessment) return jsonResponse({ error: "Not found" }, 404);
        if (assessment.status !== "in_progress") {
          return jsonResponse(
            { error: `Assessment is ${assessment.status}` },
            409,
          );
        }
        if (typeof body.value !== "string") {
          return jsonResponse({ error: "Missing answer value" }, 400);
        }

        const responses = await loadResponses(supabase, assessment.id);
        const index = nextStepIndex(responses);
        const key = SCREENING_SEQUENCE[index];

        const outcome = evaluateAnswer(key, body.value);
        if (!outcome.ok) {
          // Invalid input: re-ask the same step. Deterministic message only;
          // the LLM Clarification Engine is a separate function (§6.3).
          return jsonResponse({
            valid: false,
            message: outcome.message,
            step: stepPayload(index),
          });
        }

        const { error: insertError } = await supabase
          .from("assessment_responses")
          .insert({
            assessment_id: assessment.id,
            variable_key: key,
            value_raw: outcome.normalized,
            points_awarded: outcome.points,
          });
        if (insertError) throw insertError;

        const answeredCount = index + 1;
        if (answeredCount < TOTAL_STEPS) {
          return jsonResponse({ valid: true, step: stepPayload(answeredCount) });
        }

        // Final answer: score deterministically from the stored responses.
        const allResponses = await loadResponses(supabase, assessment.id);
        const result = finalizeAssessment(allResponses);

        // Integrity check: per-step points already written must sum to the
        // recomputed total. A mismatch means corrupted state — fail loudly.
        const storedSum = allResponses.reduce(
          (sum, r) => sum + r.points_awarded,
          0,
        );
        if (storedSum !== result.totalScore) {
          throw new Error(
            `score integrity check failed: stored ${storedSum} != computed ${result.totalScore}`,
          );
        }

        const { error: updateError } = await supabase
          .from("assessments")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            total_score: result.totalScore,
            classification: result.classification,
          })
          .eq("id", assessment.id);
        if (updateError) throw updateError;

        return jsonResponse({
          valid: true,
          completed: true,
          result: {
            totalScore: result.totalScore,
            classification: result.classification,
          },
        });
      }

      case "abandon": {
        const assessment = await loadOwnAssessment(supabase, body, userId);
        if (!assessment) return jsonResponse({ error: "Not found" }, 404);
        if (assessment.status === "in_progress") {
          const { error } = await supabase
            .from("assessments")
            .update({ status: "abandoned" })
            .eq("id", assessment.id);
          if (error) throw error;
        }
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("screening error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

async function loadOwnAssessment(
  supabase: ReturnType<typeof createServiceClient>,
  body: { assessmentId?: string },
  userId: string,
) {
  if (!body.assessmentId) return null;
  const { data, error } = await supabase
    .from("assessments")
    .select("id, status, total_score, classification, user_id")
    .eq("id", body.assessmentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadResponses(
  supabase: ReturnType<typeof createServiceClient>,
  assessmentId: string,
) {
  const { data, error } = await supabase
    .from("assessment_responses")
    .select("variable_key, value_raw, points_awarded")
    .eq("assessment_id", assessmentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
