import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  askClarification,
  startScreening,
  submitAnswer,
  type ScreeningResult,
  type StepPayload,
} from "../../lib/assessment-api";
import { hasConsented } from "../../lib/consent";
import ConsentGate from "./ConsentGate";
import ResultsScreen from "./ResultsScreen";

interface Turn {
  role: "user" | "bot";
  text: string;
  error?: boolean;
}

// Free text that looks like a question is routed to the clarification
// assistant instead of being submitted as an answer — same heuristic as the
// capstone frontend (English, Tagalog, and Bisaya interrogatives).
const QUESTION_SHAPE =
  /\?\s*$|^(what|why|how|explain|meaning|define|which|does|do|is|are|ano|bakit|paano|alin|unsa|ngano|giunsa)\b/i;

const EXPLAIN_CHIP = "Can you explain this question in simple words?";

export default function AssessmentChat() {
  const navigate = useNavigate();
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
      setAssessmentId(res.assessmentId);
      setStep(res.step);
      setTurns([{ role: "bot", text: res.step.prompt }]);
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

  async function sendClarification(question: string) {
    if (!assessmentId || !step) return;
    setBusy(true);
    setTurns((t) => [...t, { role: "user", text: question }]);
    try {
      // Only the question and the current variable's key travel to the
      // clarification engine — never the assessment ID, and nothing comes
      // back but prose. `step` is therefore re-displayed from local state
      // rather than reassigned from the response: the controller resumes at
      // the same variable because nothing was ever in a position to move it.
      const res = await askClarification(question, step.key);
      setTurns((t) => [
        ...t,
        { role: "bot", text: res.reply },
        { role: "bot", text: step.prompt },
      ]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: "bot",
          text:
            err instanceof Error
              ? `Something went wrong: ${err.message}`
              : "Something went wrong. Please try again.",
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
        setTurns((t) => [
          ...t,
          { role: "bot", text: res.message ?? "Please try that answer again." },
        ]);
        if (res.step) setStep(res.step);
      } else if (res.completed && res.result) {
        setResult(res.result);
      } else if (res.step) {
        setStep(res.step);
        setTurns((t) => [...t, { role: "bot", text: res.step!.prompt }]);
      }
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: "bot",
          text:
            err instanceof Error
              ? `Something went wrong: ${err.message}`
              : "Something went wrong. Please try again.",
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
    if (QUESTION_SHAPE.test(text)) {
      void sendClarification(text);
    } else {
      void sendAnswer(text);
    }
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
        <div className="card results">
          <h2>Assessment unavailable</h2>
          <p>{fatalError}</p>
          <div className="button-row">
            <button className="button-link accent" onClick={() => void begin()}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <div className="page-title">
        <h2>Risk Assessment</h2>
        {step && (
          <span className="progress-label">
            Question {step.index + 1} of {step.total}
          </span>
        )}
      </div>
      {step && (
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={step.total}
          aria-valuenow={step.index + 1}
        >
          <div
            className="progress-fill"
            style={{ width: `${((step.index + 1) / step.total) * 100}%` }}
          />
        </div>
      )}

      <div className="chat" ref={scrollRef}>
        {turns.map((turn, i) => (
          <div
            key={i}
            className={
              "bubble " +
              (turn.role === "user" ? "user" : "bot") +
              (turn.error ? " error" : "")
            }
          >
            {turn.text}
          </div>
        ))}
        {busy && (
          <div className="bubble bot typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {step && !busy && (
        <div className="quick-replies">
          {(step.options ?? []).map((opt) => (
            <button
              key={opt}
              className="starter"
              onClick={() => void sendAnswer(opt)}
            >
              {opt}
            </button>
          ))}
          <button
            className="starter explain"
            onClick={() => void sendClarification(EXPLAIN_CHIP)}
          >
            Explain this question
          </button>
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={
            step?.inputType === "number"
              ? "Type your answer (a number)…"
              : "Type your answer, or ask about the question…"
          }
          rows={1}
          maxLength={1000}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
