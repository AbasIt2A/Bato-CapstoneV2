import { useState } from "react";
import { recordConsent } from "../../lib/consent";

// Explicit consent screen before any data collection (PRD §12, Philippine
// Data Privacy Act of 2012 / RA 10173). Copy mirrors the capstone frontend.
export default function ConsentGate({
  onConsent,
  onDecline,
}: {
  onConsent: () => void;
  onDecline: () => void;
}) {
  const [checked, setChecked] = useState(false);

  function accept() {
    recordConsent();
    onConsent();
  }

  return (
    <section className="assessment-panel assessment-consent" aria-labelledby="assessment-consent-title">
      <span className="assessment-eyebrow">Your privacy matters</span>
      <h1 id="assessment-consent-title">Before we start</h1>
      <p>
        BATO is a student capstone project of the College of Computer Studies,
        University of the Immaculate Conception (Davao City). It screens for
        Chronic Kidney Disease (CKD) risk using the validated SCORED
        questionnaire — it does <strong>not</strong> diagnose any disease.
      </p>
      <div className="assessment-consent-data">
        <h2>What BATO stores</h2>
        <p>To work, and for the study&apos;s evaluation, BATO stores:</p>
        <ul>
          <li>
            your answers to the 9 screening questions and your resulting score,
          </li>
          <li>your chat messages with BATO&apos;s assistants, and</li>
          <li>any evaluation survey answers you choose to submit.</li>
        </ul>
      </div>
      <p>
        No name, email, or account is required — your session is anonymous.
        Your data is used only for this capstone&apos;s research evaluation, in
        line with the Philippine Data Privacy Act of 2012 (RA 10173), and is
        protected so only you (and the research team, in anonymized form) can
        access it.
      </p>
      <label className="assessment-consent-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I understand and consent to my responses being stored for this
        research.
      </label>
      <div className="assessment-actions">
        <button className="assessment-button assessment-button-primary" disabled={!checked} onClick={accept}>
          I consent — start screening
        </button>
        <button className="assessment-button assessment-button-secondary" onClick={onDecline}>
          No thanks
        </button>
      </div>
    </section>
  );
}
