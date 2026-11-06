import { Link } from "react-router-dom";
import type { ScreeningResult } from "../../lib/assessment-api";
import { useI18n } from "../../lib/i18n";

// Results screen. The UIC-REC (protocol UG-ER-09-26-0744) requires:
//   - a PROMINENT disclaimer that BATO is a screening tool, not a clinical
//     diagnostic instrument — always visible, never behind a disclosure;
//   - Screen Positive: advice to seek professional medical evaluation;
//   - Screen Negative: an explicit statement that a low score does not
//     guarantee the absence of kidney disease and that routine check-ups
//     remain essential (self-reported answers can miss real risk).
export default function ResultsScreen({
  result,
  onRetake,
}: {
  result: ScreeningResult;
  onRetake: () => void;
}) {
  const { t } = useI18n();
  const r = t.results;
  const positive = result.classification === "Screen Positive";

  return (
    <section className="assessment-panel assessment-results" aria-labelledby="assessment-results-title">
      <span className="assessment-eyebrow">{r.eyebrow}</span>
      <h1 id="assessment-results-title">{positive ? r.positiveTitle : r.negativeTitle}</h1>
      <div className="assessment-result-summary">
        <p className={"assessment-result-status " + (positive ? "assessment-result-positive" : "assessment-result-negative")}>
          {result.classification}
        </p>
        <p className="assessment-score">
          <span>{r.scoreLabel}</span>
          <strong>{result.totalScore}<small> / 12</small></strong>
        </p>
      </div>

      <div className="result-disclaimer" role="note">
        <h2>{r.disclaimerTitle}</h2>
        <p>{r.disclaimerBody}</p>
      </div>

      {positive ? (
        <>
          <p>{r.positiveBody}</p>
          <div className="assessment-next-step">
            <h2>{r.positiveNextTitle}</h2>
            <p>{r.positiveNext}</p>
            <Link className="assessment-button assessment-button-primary assessment-facility-link" to="/facilities">
              {r.findLab}
            </Link>
            <p>{r.confirmLab}</p>
          </div>
        </>
      ) : (
        <>
          <p>{r.negativeBody}</p>
          <div className="result-disclaimer result-disclaimer-warning" role="note">
            <h2>{r.negativeWarningTitle}</h2>
            <p>{r.negativeWarning}</p>
          </div>
          <div className="assessment-next-step">
            <h2>{r.negativeNextTitle}</h2>
            <p>{r.negativeNext}</p>
          </div>
        </>
      )}

      <details className="accuracy-note">
        <summary>{r.accuracyTitle}</summary>
        <p>{r.accuracyBody}</p>
      </details>

      <div className="assessment-actions">
        <button className="assessment-button assessment-button-secondary" onClick={onRetake}>
          {r.retake}
        </button>
        <Link className={"assessment-button " + (positive ? "assessment-button-secondary" : "assessment-button-primary")} to="/chat">
          {r.askChat}
        </Link>
      </div>
    </section>
  );
}
