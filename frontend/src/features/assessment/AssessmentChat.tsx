import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  abandonScreening,
  askClarification,
  startScreening,
  submitAnswer,
  type ScreeningResult,
  type StepPayload,
} from "../../lib/assessment-api";
import { hasConsented } from "../../lib/consent";
import { isQuestionShaped } from "../../lib/question-shape";
import { markAssessmentCompleted, setAssessmentInProgress } from "../../lib/progress";
import { useI18n } from "../../lib/i18n";
import { redactPersonalDetails } from "../../lib/personal-details";
import type { InvalidCode, ScreeningKey } from "../../lib/strings";
import ConsentGate from "./ConsentGate";
import ResultsScreen from "./ResultsScreen";
import "./assessment.css";

interface Turn {
  role: "user" | "bot";
  /** English text; shown as-is unless one of the keys below translates it. */
  text: string;
  error?: boolean;
  /** A screening question — rendered in the current language. */
  stepKey?: ScreeningKey;
  /** A rejected answer — the server's code, rendered in the current language. */
  code?: InvalidCode;
  /** Written by the AI Clarification Engine (English). Not labelled in the UI. */
  ai?: boolean;
}


/**
 * Sentences in a screening prompt that tell the user HOW to enter an answer,
 * rather than what is being asked. Dropped before the prompt is quoted to
 * the clarification engine.
 */
const INPUT_INSTRUCTION = /(?:^|\s)(?:please type|if you have never been told)\b[^.?!]*[.?!]/gi;

/**
 * Screening questions whose prompt contains no clinical term at all, and so
 * cannot be quoted to the clarification engine — its input gate judges the
 * question text on its own and has nothing to key on. Only `age` qualifies:
 * "how old are you" is pure demographics. `female` looks similar but its
 * prompt says "kidney disease risk differs between males and females", which
 * is enough.
 */
const NO_CLINICAL_TERM: Record<string, string> = {
  age: "Why does this screening ask my age, and what does age have to do with kidney health?",
};

/**
 * What the "Explain this question" chip SENDS, as opposed to what it
 * displays. The chip text alone names no medical term, so the sent query
 * carries the term itself by quoting the current screening question. (The
 * server now also shows the gate that question, keyed by variableKey, so
 * free-typed follow-ups like "why does this matter?" resolve too — but the
 * chip wording below was measured before that and is kept as-is.)
 *
 * The quote is stripped of input instructions first: the age prompt ends
 * "Please type your age in years (for example, 54)." and the engine read
 * that as a request for help filling in the form.
 *
 * Every part of this was measured against the deployed function, because
 * each plausible simplification fails a different subset of the nine:
 *   - quote the prompt verbatim            -> 8/9 (age deflects)
 *   - quote it with instructions stripped  -> 8/9 (age still deflects:
 *     "To get started: how old are you?" names nothing clinical)
 *   - ask about the subject for every key  -> 6/9 (age passes, but female,
 *     anemia and diabetes now deflect — the term the gate keys on is gone)
 * So: quote the trimmed prompt, except where there is no term to quote.
 * Re-measure all nine before changing this.
 */
function explainQuestionQuery(variableKey: string, prompt: string): string {
  const override = NO_CLINICAL_TERM[variableKey];
  if (override) return override;
  const asked = prompt.replace(INPUT_INSTRUCTION, "").replace(/\s+/g, " ").trim();
  return `What does this screening question mean: "${asked}"?`;
}

function promptTurn(step: StepPayload): Turn {
  return { role: "bot", text: step.prompt, stepKey: step.key as ScreeningKey };
}

export default function AssessmentChat() {
  const navigate = useNavigate();
  const { lang, t } = useI18n();
  const a = t.assessment;
  const [consented, setConsented] = useState(hasConsented);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [step, setStep] = useState<StepPayload | null>(null);
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow the input with its text, like a chat app. Past the CSS max-height
  // it stops growing and only THEN shows a scrollbar — a short answer never
  // gets one.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    const needed = el.scrollHeight;
    el.style.height = `${Math.min(needed, max)}px`;
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, [input]);
  // The in-progress assessment, so it can be deleted if the participant
  // leaves mid-screening (the server keeps nothing once a session ends).
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Closing or reloading the tab mid-assessment: browsers only allow their
    // own generic "Leave site?" box here, not custom text.
    const warn = (e: BeforeUnloadEvent) => {
      if (activeIdRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      setAssessmentInProgress(false);
      if (activeIdRef.current) {
        void abandonScreening(activeIdRef.current).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy]);

  async function begin() {
    setBusy(true);
    setFatalError(null);
    setResult(null);
    setTurns([]);
    try {
      const res = await startScreening();
      activeIdRef.current = res.assessmentId;
      setAssessmentInProgress(true);
      setAssessmentId(res.assessmentId);
      setStep(res.step);
      setTurns([promptTurn(res.step)]);
    } catch (err) {
      setFatalError(
        err instanceof Error ? err.message : "Could not start the assessment.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!consented || startedRef.current) return;
    startedRef.current = true;
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consented]);

  /**
   * @param shown  what the user sees in the transcript
   * @param sent   what actually goes to the engine (defaults to `shown`);
   *               differs only for the chip, which must carry the term.
   */
  async function sendClarification(shown: string, sent: string = shown) {
    if (!step) return;
    // The engine has no assessment identity and returns no step — it cannot
    // advance or score anything. We therefore keep the current step here and
    // re-display its prompt ourselves, so control visibly returns to the
    // screening flow at exactly the variable the user paused on.
    const currentStep = step;
    setBusy(true);
    // The transcript shows the filtered text, matching what the engine
    // receives (askClarification filters `sent`).
    setTurns((t) => [...t, { role: "user", text: redactPersonalDetails(shown) }]);
    try {
      const res = await askClarification(sent, currentStep.key);
      setTurns((t) => [
        ...t,
        { role: "bot", text: res.reply, ai: true },
        promptTurn(currentStep),
      ]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: "bot",
          text:
            err instanceof Error
              ? `${a.somethingWrong} (${err.message})`
              : a.somethingWrong,
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function sendAnswer(value: string) {
    if (!assessmentId) return;
    setBusy(true);
    setTurns((t) => [...t, { role: "user", text: value }]);
    try {
      const res = await submitAnswer(assessmentId, value);
      if (!res.valid) {
        setTurns((prev) => [
          ...prev,
          {
            role: "bot",
            text: res.message ?? t.invalid(res.code ?? "yes_no"),
            code: res.code,
          },
        ]);
        if (res.step) setStep(res.step);
      } else if (res.completed && res.result) {
        // The server deleted the assessment when it returned the result.
        activeIdRef.current = null;
        setAssessmentInProgress(false);
        markAssessmentCompleted();
        setResult(res.result);
      } else if (res.step) {
        setStep(res.step);
        setTurns((t) => [...t, promptTurn(res.step!)]);
      }
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: "bot",
          text:
            err instanceof Error
              ? `${a.somethingWrong} (${err.message})`
              : a.somethingWrong,
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    // Free text that looks like a question or request goes to the
    // clarification assistant instead of being submitted as an answer.
    if (isQuestionShaped(text)) {
      void sendClarification(text);
    } else {
      void sendAnswer(text);
    }
  }

  /** What a bot turn shows, in the current language. */
  function turnText(turn: Turn): string {
    if (turn.stepKey) return t.questions[turn.stepKey];
    if (turn.code && lang !== "en") return t.invalid(turn.code);
    return turn.text;
  }

  function retake() {
    startedRef.current = true;
    void begin();
  }

  if (!consented) {
    return (
      <div className="assessment-page">
        <ConsentGate
          onConsent={() => setConsented(true)}
          onDecline={() => navigate("/")}
        />
      </div>
    );
  }

  if (result) {
    return (
      <div className="assessment-page">
        <ResultsScreen result={result} onRetake={retake} />
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="assessment-page">
        <div className="assessment-panel" role="alert">
          <span className="assessment-eyebrow">{a.title}</span>
          <h1>{a.unavailableTitle}</h1>
          <p>{fatalError}</p>
          <div className="assessment-actions">
            <button className="assessment-button assessment-button-primary" onClick={() => void begin()}>
              {a.tryAgain}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page assessment-chat">
      <header className="assessment-chat-header">
        <div>
          <span className="assessment-eyebrow">{a.eyebrow}</span>
          <h1>{a.title}</h1>
          <p>{a.subtitle}</p>
        </div>
        {step && (
          <span className="assessment-step-label">
            {a.step(step.index + 1, step.total)}
          </span>
        )}
      </header>
      <p className="chat-ai-notice" role="note">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span>{a.notice}</span>
      </p>
      {step && (
        <div
          className="assessment-progress"
          role="progressbar"
          aria-label="Screening progress"
          aria-valuemin={0}
          aria-valuemax={step.total}
          aria-valuenow={step.index + 1}
        >
          <div
            className="assessment-progress-fill"
            style={{ width: `${((step.index + 1) / step.total) * 100}%` }}
          />
        </div>
      )}

      <div className="chat assessment-transcript" ref={scrollRef} role="log" aria-label="Assessment conversation" aria-live="polite" aria-relevant="additions">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={
              "assessment-turn " +
              (turn.role === "user" ? "assessment-turn-user" : "assessment-turn-bot") +
              (turn.error ? " assessment-turn-error" : "") +
              (turn.role === "bot" && i === turns.length - 1 && turn.stepKey === step?.key
                ? " assessment-turn-current"
                : "")
            }
          >
            <span className="assessment-turn-label">
              {turn.role === "user" ? a.you : a.bato}
            </span>
            <span lang={turn.ai ? "en" : undefined}>{turnText(turn)}</span>
          </div>
        ))}
        {busy && (
          <div className="assessment-turn assessment-turn-bot typing" role="status" aria-label="BATO is responding">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {step && !busy && (
        <div className="assessment-responses" role="group" aria-label="Answer options">
          {(step.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              className="assessment-choice"
              onClick={() => void sendAnswer(opt)}
            >
              {/* Translated label; the canonical English value is sent. */}
              {t.options[opt] ?? opt}
            </button>
          ))}
          <button
            type="button"
            className="assessment-explain"
            onClick={() =>
              void sendClarification(
                a.explainChip,
                // Always the ENGLISH prompt: the engine's gate keys on the
                // English clinical term (see explainQuestionQuery).
                explainQuestionQuery(step.key, step.prompt),
              )
            }
          >
            {a.explainButton}
          </button>
        </div>
      )}

      <form
        className="composer assessment-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label className="sr-only" htmlFor="assessment-answer">
          {step?.inputType === "number" ? a.answerLabel : a.answerOrAskLabel}
        </label>
        <div className="assessment-composer-row">
          <textarea
            ref={inputRef}
            id="assessment-answer"
            value={input}
            inputMode={step?.inputType === "number" ? "numeric" : "text"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              step?.inputType === "number"
                ? a.numberPlaceholder
                : a.textPlaceholder
            }
            rows={1}
            maxLength={1000}
            disabled={busy}
          />
          <button
            type="submit"
            aria-label={a.send}
            title={a.send}
            disabled={busy || !input.trim()}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 19V5M5 12l7-7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
