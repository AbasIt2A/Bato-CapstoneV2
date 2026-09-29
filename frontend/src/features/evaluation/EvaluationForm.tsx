import { useState } from "react";
import { INSTRUMENTS, LIKERT_5, type InstrumentSpec } from "./instruments";
import { submitEvaluation } from "../../lib/evaluation-api";
import "./evaluation.css";

type FormState = "idle" | "sending" | "done" | "error";

function InstrumentSection({
  id,
  spec,
  onSubmitted,
}: {
  id: string;
  spec: InstrumentSpec;
  onSubmitted: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<number, number>>({});
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const answered = spec.items.filter((_, i) => values[i] !== undefined).length;
  const complete = answered === spec.items.length;

  const submit = async () => {
    if (!complete || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const ordered = spec.items.map((_, i) => values[i]);
      const responses = Object.fromEntries(
        spec.items.map((item, i) => [`q${i + 1}`, { item, value: ordered[i] }]),
      );
      const score = spec.computeScore(ordered);
      await submitEvaluation(id, responses, score);
      setState("done");
      onSubmitted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit.");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <section className="card instrument-card is-done">
        <span className="instrument-code">{id}</span>
        <h2>{spec.title}</h2>
        <p className="success" role="status">Submitted. Thank you for your feedback.</p>
      </section>
    );
  }

  return (
    <section className="card instrument-card">
      <div className="instrument-heading">
        <div>
          <span className="instrument-code">{id}</span>
          <h2>{spec.title}</h2>
          <p>{spec.description}</p>
        </div>
        <span className="instrument-count">{spec.items.length} statements</span>
      </div>
      <div className="instrument-progress">
        <span>{answered} of {spec.items.length} answered</span>
        <progress value={answered} max={spec.items.length} aria-label={`${spec.title} progress`} />
      </div>
      <div className="likert-key" aria-label="Response scale">
        {LIKERT_5.map((opt) => <span key={opt.value}><strong>{opt.value}</strong> {opt.label}</span>)}
      </div>
      <ol className="likert-list">
        {spec.items.map((item, i) => (
          <li key={item}>
            <fieldset className="likert-question" disabled={state === "sending"}>
              <legend><span className="question-number">{String(i + 1).padStart(2, "0")}</span>{item}</legend>
              <div className="likert-options">
                {LIKERT_5.map((opt) => (
                  <label key={opt.value} className={values[i] === opt.value ? "selected" : ""}>
                    <input
                      type="radio"
                      name={`${id}-${i}`}
                      value={opt.value}
                      aria-label={opt.label}
                      checked={values[i] === opt.value}
                      onChange={() => setValues((v) => ({ ...v, [i]: opt.value }))}
                    />
                    <span className="likert-num">{opt.value}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="instrument-footer">
        <div>
          {error && <p className="error-text" role="alert">Could not submit: {error}</p>}
          {!complete && <p className="hint">Answer all statements to submit this survey.</p>}
        </div>
        <button
          className="button-link accent"
          type="button"
          disabled={!complete || state === "sending"}
          onClick={() => void submit()}
        >
          {state === "sending" ? "Submitting…" : `Submit ${id}`}
        </button>
      </div>
    </section>
  );
}

export default function EvaluationForm() {
  const [submitted, setSubmitted] = useState<string[]>([]);
  const total = Object.keys(INSTRUMENTS).length;

  return (
    <div className="evaluation">
      <header className="evaluation-intro">
        <span className="evaluation-eyebrow">Share your experience</span>
        <h1>Rate your experience</h1>
        <p>These three short surveys are part of BATO&apos;s capstone evaluation. Please try BATO&apos;s risk assessment and chat first, then come back here.</p>
        <p>Choose how much you agree with each statement, from 1 (strongly disagree) to 5 (strongly agree). Each survey is submitted separately.</p>
        <span className="evaluation-overall">{submitted.length} of {total} surveys submitted</span>
      </header>
      {Object.entries(INSTRUMENTS).map(([id, spec]) => (
        <InstrumentSection
          key={id}
          id={id}
          spec={spec}
          onSubmitted={(doneId) => setSubmitted((s) => [...s, doneId])}
        />
      ))}
      {submitted.length === total && (
        <p className="success big" role="status">All three surveys submitted. Thank you for helping our research!</p>
      )}
    </div>
  );
}
