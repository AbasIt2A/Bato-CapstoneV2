import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { hasCompletedAssessment } from "../lib/progress";
import GeneralChat from "./GeneralChat";
import "../features/evaluation/evaluation.css";

/**
 * The KidneyLearn, or — until this browser has finished the risk
 * assessment — a short page asking the user to do that first. See
 * lib/progress.ts for why.
 */
export default function ChatLock() {
  const { t } = useI18n();
  if (hasCompletedAssessment()) return <GeneralChat />;

  const l = t.chatLock;
  return (
    <div className="feedback">
      <section className="card feedback-card">
        <span className="feedback-eyebrow">{l.eyebrow}</span>
        <h1>{l.title}</h1>
        <p>{l.body}</p>
        <Link className="button-link accent feedback-button" to="/assessment">
          {l.start}
        </Link>
      </section>
    </div>
  );
}
