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
    <div className={"card results " + (positive ? "positive" : "negative")}>
      <h2>{positive ? "Screening suggests elevated risk" : "No elevated risk detected"}</h2>
      <p className="score-chip">
        SCORED score: <strong>{result.totalScore}</strong> out of 12
      </p>

      {positive ? (
        <>
          <p>
            Your answers add up to a score that the SCORED tool classifies as{" "}
            <strong>Screen Positive</strong> — meaning people with answers like
            yours have a higher chance of having reduced kidney function. This
            is <strong>not a diagnosis</strong>: it is a recommendation to get
            a confirmatory test.
          </p>
          <p>
            Please consider visiting a doctor or health center for a simple
            kidney check — usually a blood test (creatinine/eGFR) and a urine
            test. Early detection makes a real difference.
          </p>
        </>
      ) : (
        <>
          <p>
            Your answers add up to a score that the SCORED tool classifies as{" "}
            <strong>Screen Negative</strong> — no elevated CKD risk was
            detected from your age and health history today.
          </p>
          <p>
            Keep it that way: stay hydrated, manage blood pressure and blood
            sugar, and ask the Kidney Health Chat how to keep your kidneys
            healthy.
          </p>
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

      <div className="button-row">
        <button className="button-link accent" onClick={onRetake}>
          Retake the assessment
        </button>
        <Link className="button-link" to="/chat">
          Ask about kidney health
        </Link>
      </div>
    </div>
  );
}
