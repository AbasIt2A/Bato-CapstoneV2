import { useState } from "react";
import { recordConsent } from "../../lib/consent";
import { LanguageSwitcher, useI18n } from "../../lib/i18n";

// Explicit consent screen before any data collection (PRD §12, Philippine
// Data Privacy Act of 2012 / RA 10173), shown before both the assessment and
// the General CKD Chatbot. Mirrors the study ICF and the UIC-REC decision
// letter (protocol UG-ER-09-26-0744):
//   - the age gate and exclusion self-confirmation the REC requires;
//   - the disclosure that participants will use an AI-powered chatbot;
//   - what is and is not kept, and the third-party AI services that receive
//     typed questions — keep this in step with the ICF wording.
export default function ConsentGate({
  onConsent,
  onDecline,
}: {
  onConsent: () => void;
  onDecline: () => void;
}) {
  const { t } = useI18n();
  const c = t.consent;
  const [adult, setAdult] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [agreed, setAgreed] = useState(false);

  function accept() {
    recordConsent();
    onConsent();
  }

  return (
    <section className="assessment-panel assessment-consent" aria-labelledby="assessment-consent-title">
      <LanguageSwitcher />
      <span className="assessment-eyebrow">{c.eyebrow}</span>
      <h1 id="assessment-consent-title">{c.title}</h1>
      <p>{c.intro}</p>
      <div className="assessment-consent-data">
        <h2>{c.scoreTitle}</h2>
        <p>{c.scoreBody}</p>
      </div>
      <div className="assessment-consent-data">
        <h2>{c.dataTitle}</h2>
        <ul>
          {c.dataItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <p>{c.voluntary}</p>
      <label className="assessment-consent-check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        {c.checkAge}
      </label>
      <label className="assessment-consent-check">
        <input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />
        {c.checkHealth}
      </label>
      <label className="assessment-consent-check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        {c.checkAgree}
      </label>
      <div className="assessment-actions">
        <button
          className="assessment-button assessment-button-primary"
          disabled={!adult || !eligible || !agreed}
          onClick={accept}
        >
          {c.accept}
        </button>
        <button className="assessment-button assessment-button-secondary" onClick={onDecline}>
          {c.decline}
        </button>
      </div>
      <p className="consent-ai-note">{c.aiNote}</p>
    </section>
  );
}
