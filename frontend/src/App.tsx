import { lazy, Suspense } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import GeneralChat from "./pages/GeneralChat";
import AssessmentChat from "./features/assessment/AssessmentChat";
import EvaluationForm from "./features/evaluation/EvaluationForm";
import { LanguageSwitcher, useI18n } from "./lib/i18n";

const FacilityLocator = lazy(() => import("./features/locator/FacilityLocator"));

export default function App() {
  const { t } = useI18n();
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none" focusable="false">
              <path d="M14.5 7C9.8 7 7 12.1 7 19.9S9.8 33 14.5 33c3.6 0 5.5-2.5 5.5-5.4 0-2.6-2-4.4-2-7.6s2-5 2-7.6C20 9.5 18.1 7 14.5 7ZM25.5 7C30.2 7 33 12.1 33 19.9S30.2 33 25.5 33c-3.6 0-5.5-2.5-5.5-5.4 0-2.6 2-4.4 2-7.6s-2-5-2-7.6C20 9.5 21.9 7 25.5 7Z" fill="currentColor"/>
            </svg>
          </span>
          <span className="brand-text">
            <strong>BATO</strong>
            <small>Kidney health, made clearer</small>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <NavLink to="/assessment">{t.nav.assessment}</NavLink>
          <NavLink to="/chat">{t.nav.chat}</NavLink>
          <NavLink to="/facilities">{t.nav.labs}</NavLink>
          <NavLink to="/evaluate">{t.nav.feedback}</NavLink>
        </nav>
        <LanguageSwitcher />
      </header>

      <main className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/assessment" element={<AssessmentChat />} />
          <Route path="/chat" element={<GeneralChat />} />
          <Route path="/facilities" element={<Suspense fallback={<p>Loading facility locator…</p>}><FacilityLocator /></Suspense>} />
          <Route path="/evaluate" element={<EvaluationForm />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>

      <footer className="disclaimer">
        <strong>{t.footer.lead}</strong> {t.footer.body}
      </footer>
    </div>
  );
}
