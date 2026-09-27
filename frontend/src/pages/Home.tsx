import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <span className="hero-logo" aria-hidden>
          🫘
        </span>
        <h1>BATO</h1>
        <p className="tagline">Bridging Awareness Through Online Risk Assessment</p>
        <p className="lede">
          Chronic Kidney Disease often has <strong>no symptoms</strong> until
          it&apos;s advanced. BATO helps you find out — in about two minutes —
          whether your age and health history suggest you should get your
          kidneys checked.
        </p>
        <div className="button-row center">
          <Link className="button-link accent big" to="/assessment">
            Check my CKD risk
          </Link>
          <Link className="button-link big" to="/chat">
            Ask about kidney health
          </Link>
          <Link className="button-link big" to="/facilities">
            Find a laboratory
          </Link>
        </div>
      </section>

      <section className="home-cards">
        <div className="card">
          <h2>🩺 Risk Assessment</h2>
          <p>
            Nine quick questions based on <strong>SCORED</strong>, a validated,
            published screening tool (Bang et al., 2007; used under license
            from AstraZeneca Philippines). Your score is computed by fixed
            medical rules — not by AI — and tells you whether a confirmatory
            kidney test is recommended.
          </p>
          <p>
            Confused by a medical term mid-way? Just ask — a built-in assistant
            explains any question in plain language, then lets you continue
            where you left off.
          </p>
        </div>
        <div className="card">
          <h2>💬 Kidney Health Chat</h2>
          <p>
            A conversational assistant for general questions about chronic
            kidney disease — risk factors, prevention, and what screening and
            testing involve. Every answer is retrieved from curated guidance
            from DOH, PSN, WHO, CDC, NIDDK, and KDIGO, and cites its sources.
          </p>
          <p>
            It sticks to kidney health, and it will never diagnose you — for
            personal medical concerns, it points you to real health
            professionals.
          </p>
        </div>
      </section>

      <section className="card about">
        <h2>About this project</h2>
        <p>
          BATO is a capstone research project of the College of Computer
          Studies, University of the Immaculate Conception, Davao City. It is a
          screening and awareness tool: it does not diagnose disease, store lab
          results, or replace medical consultation. Participation is anonymous,
          and data handling follows the Philippine Data Privacy Act of 2012 (RA
          10173).
        </p>
      </section>
    </div>
  );
}
