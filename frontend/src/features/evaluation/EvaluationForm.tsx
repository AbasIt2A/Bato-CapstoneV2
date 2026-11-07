import { useI18n } from "../../lib/i18n";
import "./evaluation.css";

/**
 * The SUS / TAM / TiMT surveys are administered on Google Forms, so this page
 * only points participants there. The link is configuration, not code:
 * VITE_FEEDBACK_FORM_URL in frontend/.env (and in Vercel's environment
 * variables for the hosted build).
 */
const FORM_URL = (import.meta.env.VITE_FEEDBACK_FORM_URL as string | undefined)
  ?.trim();

export default function EvaluationForm() {
  const { t } = useI18n();
  const f = t.feedback;

  return (
    <div className="feedback">
      <section className="card feedback-card">
        <span className="feedback-eyebrow">{f.eyebrow}</span>
        <h1>{f.title}</h1>
        <p>{f.body}</p>
        {FORM_URL
          ? (
            <>
              <a
                className="button-link accent feedback-button"
                href={FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {f.button}
              </a>
              <p className="feedback-note">{f.newTab}</p>
            </>
          )
          : <p className="feedback-note" role="status">{f.unavailable}</p>}
        <p className="feedback-thanks">{f.thanks}</p>
      </section>
    </div>
  );
}
