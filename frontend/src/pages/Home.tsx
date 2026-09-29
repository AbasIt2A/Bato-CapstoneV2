import { Link } from "react-router-dom";
import "./home.css";

export default function Home() {
  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="home-eyebrow"><span aria-hidden="true" /> Kidney health starts with awareness</p>
          <h1 id="home-title">Know when to check on your <em>kidney health.</em></h1>
          <p className="home-lede">
            Chronic kidney disease often has no symptoms until it is advanced.
            Answer nine short questions to learn whether a kidney test is recommended for you.
          </p>
          <div className="home-actions">
            <Link className="home-button home-button-primary" to="/assessment">
              Start risk assessment <span aria-hidden="true">↗</span>
            </Link>
            <Link className="home-button home-button-secondary" to="/chat">
              Ask about kidney health
            </Link>
          </div>
          <p className="home-hero-footnote">A screening tool, not a diagnosis. Always discuss health concerns with a professional.</p>
        </div>

        <div className="home-hero-panel" aria-label="BATO assessment at a glance">
          <div className="home-panel-top"><span>BATO / SCREENING</span><span>ABOUT 2 MIN</span></div>
          <div className="home-panel-middle">
            <span className="home-panel-number">9</span>
            <span className="home-panel-label">guided questions<br />to a clearer next step</span>
          </div>
          <div className="home-panel-bottom">
            <span>Based on the published SCORED tool</span>
            <span className="home-panel-arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </section>

      <div className="home-facts" aria-label="Assessment details">
        <p><strong>About 2 minutes</strong><span>to complete</span></p>
        <p><strong>Anonymous</strong><span>no name or account required</span></p>
        <p><strong>Published method</strong><span>fixed SCORED scoring rules</span></p>
      </div>

      <section className="home-pathways" aria-labelledby="home-pathways-title">
        <div className="home-section-heading">
          <div>
            <p className="home-section-label">Explore BATO</p>
            <h2 id="home-pathways-title">Find the help you need.</h2>
          </div>
          <p>Start with a quick check, explore a question, or look for local testing options.</p>
        </div>
        <div className="home-pathway-grid">
          <article className="home-pathway-card">
            <span className="home-card-index">01 / ASSESS</span>
            <h3>Understand your risk</h3>
            <p>Nine questions based on SCORED, a validated, published screening tool. Fixed medical rules calculate your score and indicate whether a confirmatory kidney test is recommended.</p>
            <Link to="/assessment">Check my CKD risk <span aria-hidden="true">↗</span></Link>
          </article>
          <article className="home-pathway-card">
            <span className="home-card-index">02 / LEARN</span>
            <h3>Ask a question</h3>
            <p>Get plain-language answers about kidney health, risk factors, and testing. The assistant cites curated guidance and can explain screening questions along the way.</p>
            <Link to="/chat">Explore kidney health <span aria-hidden="true">↗</span></Link>
          </article>
          <article className="home-pathway-card">
            <span className="home-card-index">03 / ACT</span>
            <h3>Find a laboratory</h3>
            <p>Browse listed clinical laboratories in Davao Region if you need to ask about a serum creatinine blood test. Confirm services with a facility before visiting.</p>
            <Link to="/facilities">Find a laboratory <span aria-hidden="true">↗</span></Link>
          </article>
        </div>
      </section>

      <section className="home-confidence" aria-labelledby="home-confidence-title">
        <div>
          <p className="home-section-label">Information you can trace</p>
          <h2 id="home-confidence-title">Clear guidance, grounded in sources.</h2>
        </div>
        <p>
          BATO&apos;s kidney health answers cite curated guidance from DOH, PSN, WHO, CDC,
          NIDDK, and KDIGO. Assessment scores follow the published SCORED rules rather
          than AI. Neither the assessment nor the chat can diagnose disease.
        </p>
      </section>

      <section className="home-about" aria-labelledby="home-about-title">
        <h2 id="home-about-title">About BATO</h2>
        <p>
          Bridging Awareness Through Online Risk Assessment is a capstone research
          project of the College of Computer Studies, University of the Immaculate
          Conception, Davao City. It does not store lab results or replace medical
          consultation. Participation is anonymous, and data handling follows the
          Philippine Data Privacy Act of 2012 (RA 10173). The SCORED instrument is
          used under license from AstraZeneca Philippines.
        </p>
      </section>
    </div>
  );
}
