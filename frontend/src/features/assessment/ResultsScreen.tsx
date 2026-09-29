import { Link } from "react-router-dom";
import type { ScreeningResult } from "../../lib/assessment-api";

export default function ResultsScreen({
  result,
  onRetake,
}: {
  result: ScreeningResult;
  onRetake: () => void;
}) {
  const positive = result.classification === "Screen Positive";

  return (
    <section className="assessment-panel assessment-results" aria-labelledby="assessment-results-title">
      <span className="assessment-eyebrow">Assessment complete</span>
      <h1 id="assessment-results-title">{positive ? "Screening suggests elevated risk" : "Screening did not suggest elevated risk"}</h1>
      <div className="assessment-result-summary">
        <p className={"assessment-result-status " + (positive ? "assessment-result-positive" : "assessment-result-negative")}>
          {result.classification}
        </p>
        <p className="assessment-score">
          <span>SCORED score</span>
          <strong>{result.totalScore}<small> / 12</small></strong>
        </p>
      </div>

      {positive ? (
        <>
          <p>
            Your answers add up to a score that the SCORED tool classifies as{" "}
            <strong>Screen Positive</strong> — meaning people with answers like
            yours have a higher chance of having reduced kidney function. This
            is <strong>not a diagnosis</strong>: it is a recommendation to get
            a confirmatory test.
          </p>
          <div className="assessment-next-step">
            <h2>What to do next</h2>
            <p>
              Please consider visiting a doctor or health center for a simple
              kidney check — usually a blood test (creatinine/eGFR) and a urine
              test. Early detection makes a real difference.
            </p>
            <Link className="assessment-button assessment-button-primary assessment-facility-link" to="/facilities">
              Find a nearby clinical laboratory
            </Link>
            <p>For the blood test, confirm test availability with the facility first.</p>
          </div>
        </>
      ) : (
        <>
          <p>
            Your answers add up to a score that the SCORED tool classifies as{" "}
            <strong>Screen Negative</strong> — no elevated CKD risk was
            detected from your age and health history today.
          </p>
          <div className="assessment-next-step">
            <h2>What to do next</h2>
            <p>
              Keep it that way: stay hydrated, manage blood pressure and blood
              sugar, and ask the Kidney Health Chat how to keep your kidneys
              healthy.
            </p>
          </div>
        </>
      )}

      <details className="accuracy-note">
        <summary>How accurate is this?</summary>
        <p>
          The score is computed by fixed, published medical rules (SCORED —
          Bang et al., 2007), not by AI. Screening tools estimate risk; they
          can miss cases and can flag people who turn out fine. Only laboratory
          tests interpreted by a clinician can confirm CKD.
        </p>
      </details>

      <div className="assessment-actions">
        <button className="assessment-button assessment-button-secondary" onClick={onRetake}>
          Retake the assessment
        </button>
        <Link className={"assessment-button " + (positive ? "assessment-button-secondary" : "assessment-button-primary")} to="/chat">
          Ask about kidney health
        </Link>
      </div>
    </section>
  );
}
