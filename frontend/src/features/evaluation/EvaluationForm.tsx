import { useState } from "react";
import { INSTRUMENTS, LIKERT_5, type InstrumentSpec } from "./instruments";
import { submitEvaluation } from "../../lib/evaluation-api";

// SUS / TAM / TiMT capture. One section per instrument, each submitted
// separately into evaluation_responses (per-item answers as jsonb plus the
// computed composite score).

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

  const complete = spec.items.every((_, i) => values[i] !== undefined);

  const submit = async () => {
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
      <section className="card instrument-card">
        <h2>{spec.title}</h2>
        <p className="success">✓ Submitted — thank you!</p>
      </section>
    );
  }

  return (
    <section className="card instrument-card">
      <h2>{spec.title}</h2>
      <p>{spec.description}</p>
      <ol className="likert-list">
        {spec.items.map((item, i) => (
          <li key={item}>
            <p className="likert-item">{item}</p>
            <div className="likert-options" role="radiogroup" aria-label={item}>
              {LIKERT_5.map((opt) => (
                <label
                  key={opt.value}
                  className={values[i] === opt.value ? "selected" : ""}
                  title={opt.label}
                >
                  <input
                    type="radio"
                    name={`${id}-${i}`}
                    value={opt.value}
                    checked={values[i] === opt.value}
                    onChange={() =>
                      setValues((v) => ({ ...v, [i]: opt.value }))
                    }
                  />
                  <span className="likert-num">{opt.value}</span>
                  <span className="likert-label">{opt.label}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="error-text">Could not submit: {error}</p>}
      <button
        className="button-link accent"
        disabled={!complete || state === "sending"}
        onClick={() => void submit()}
      >
        {state === "sending" ? "Submitting…" : `Submit ${id}`}
      </button>
      {!complete && (
        <p className="hint">Please answer all statements to submit.</p>
      )}
    </section>
  );
}

export default function EvaluationForm() {
  const [submitted, setSubmitted] = useState<string[]>([]);

  return (
    <div className="evaluation">
      <h1>Rate your experience</h1>
      <p>
        These three short surveys are part of BATO's capstone evaluation.
        Answer each statement from 1 (strongly disagree) to 5 (strongly
        agree). Please try BATO's risk assessment and chat first, then come
        back here.
      </p>
      {Object.entries(INSTRUMENTS).map(([id, spec]) => (
        <InstrumentSection
          key={id}
          id={id}
          spec={spec}
          onSubmitted={(doneId) => setSubmitted((s) => [...s, doneId])}
        />
      ))}
      {submitted.length === Object.keys(INSTRUMENTS).length && (
        <p className="success big">
          All three surveys submitted — thank you for helping our research!
        </p>
      )}
    </div>
  );
}
