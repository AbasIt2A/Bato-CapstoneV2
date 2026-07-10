import { Link, NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import GeneralChat from "./pages/GeneralChat";
import AssessmentChat from "./features/assessment/AssessmentChat";

export default function App() {
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-logo" aria-hidden>
            🫘
          </span>
          <span className="brand-text">
            <strong>BATO</strong>
            <small>CKD Risk Screening</small>
          </span>
        </Link>
        <nav className="site-nav">
          <NavLink to="/assessment">Risk Assessment</NavLink>
          <NavLink to="/chat">Ask about CKD</NavLink>
        </nav>
      </header>

      <main className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/assessment" element={<AssessmentChat />} />
          <Route path="/chat" element={<GeneralChat />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>

      <footer className="disclaimer">
        BATO is a screening and awareness tool, not a medical device, and its
        results and chat responses are not medical advice or a diagnosis.
        Always consult a doctor or health professional about your health.
      </footer>
    </div>
  );
}
