// Output safety check for the General CKD Chatbot (hardened-RAG spec §3.2,
// §12 step 6). A minimal post-generation check that runs AFTER the LLM and
// BEFORE the reply is returned. Cheap heuristics only — no model call — per
// spec: "Keep this cheap — a substring/heuristic check, not another model
// call, unless a check fails."
//
// Catches three failure shapes:
//   1. Verbatim leak of a long (12+ word) window of the system prompt.
//   2. Claims that the model's rules/instructions changed, were updated, or
//      were ignored, or that a "developer mode" is enabled.
//   3. The untrusted-data delimiter tokens leaking into the output (a sign
//      the model echoed structural markers instead of just their content).
//
// Used ONLY by the general-chat Edge Function.

import {
  RETRIEVED_DATA_BEGIN,
  RETRIEVED_DATA_END,
  USER_QUESTION_BEGIN,
  USER_QUESTION_END,
} from "./rag-content.ts";
import { DEFLECTION_MESSAGE } from "./prompts.ts";

export interface DraftCheckResult {
  safe: boolean;
  /** Present when unsafe — log it, don't send it. */
  reason?: string;
}

const DELIMITER_TOKENS: readonly string[] = [
  RETRIEVED_DATA_BEGIN,
  RETRIEVED_DATA_END,
  USER_QUESTION_BEGIN,
  USER_QUESTION_END,
];

const RULE_CHANGE_PATTERNS: RegExp[] = [
  /\b(?:my\s+)?(?:rules|instructions)\s+(?:have\s+|has\s+)?(?:been\s+)?(?:changed|updated|ignored)\b/i,
  /\bdeveloper\s+mode\s+(?:is\s+|has\s+been\s+)?enabled\b/i,
  /\bi\s+am\s+now\s+in\s+developer\s+mode\b/i,
];

/** Word-count window size for the verbatim system-prompt leak check. */
const LEAK_WINDOW_WORDS = 12;

function normalizeWhitespace(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * True iff any contiguous LEAK_WINDOW_WORDS-word window of `systemPrompt`
 * appears verbatim (whitespace/case-insensitive) inside `draft`.
 */
function containsVerbatimSystemPromptWindow(
  draft: string,
  systemPrompt: string,
): boolean {
  const draftNorm = normalizeWhitespace(draft);
  const promptWords = normalizeWhitespace(systemPrompt).split(" ").filter(
    Boolean,
  );
  if (promptWords.length < LEAK_WINDOW_WORDS || draftNorm.length === 0) {
    return false;
  }
  for (let i = 0; i <= promptWords.length - LEAK_WINDOW_WORDS; i++) {
    const window = promptWords.slice(i, i + LEAK_WINDOW_WORDS).join(" ");
    if (draftNorm.includes(window)) return true;
  }
  return false;
}

/**
 * Cheap heuristic audit of a draft answer before it reaches the user. Never
 * calls a model. Returns { safe: false, reason } on the first check that
 * trips; the caller should replace the draft with the standard deflection.
 */
export function checkDraftAnswer(
  draft: string,
  systemPrompt: string,
): DraftCheckResult {
  // Case-insensitive: neutralizeDelimiters matches tokens case-insensitively,
  // so the output-side check must too.
  const draftUpper = draft.toUpperCase();
  for (const token of DELIMITER_TOKENS) {
    if (draftUpper.includes(token.toUpperCase())) {
      return {
        safe: false,
        reason: `output leaked a delimiter token: ${token}`,
      };
    }
  }

  for (const pattern of RULE_CHANGE_PATTERNS) {
    const match = draft.match(pattern);
    if (match) {
      return {
        safe: false,
        reason: `output claims rules/mode changed: "${match[0]}"`,
      };
    }
  }

  // The system prompt quotes DEFLECTION_MESSAGE verbatim (so model-side
  // declines match the server-side wording word for word). That quoted
  // sentence is the one part of the prompt a correct reply may legitimately
  // repeat — exclude it from the leak-window text, or every legitimate
  // decline would be misflagged as a system-prompt leak.
  const promptForLeakCheck = systemPrompt.split(DEFLECTION_MESSAGE).join(" ");
  if (containsVerbatimSystemPromptWindow(draft, promptForLeakCheck)) {
    return {
      safe: false,
      reason:
        `output contains a verbatim ${LEAK_WINDOW_WORDS}+ word window of the system prompt`,
    };
  }

  return { safe: true };
}
