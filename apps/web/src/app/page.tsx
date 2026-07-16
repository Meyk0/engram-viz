import {
  ArrowRight,
  Braces,
  CircleDot,
  Database,
  GitBranch,
  GitFork,
  Network,
  Play,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  TestTube2,
  Waves
} from "lucide-react";
import { MarketingBrain } from "../components/MarketingBrain";
import { MarketingCommand } from "../components/MarketingCommand";

const githubUrl = "https://github.com/Meyk0/engram-viz";
const defaultDocsUrl = `${githubUrl}/blob/main/docs/quickstart.mdx`;

const loopSteps = [
  {
    icon: Waves,
    number: "01",
    title: "Capture",
    text: "Record stores, retrieval candidates, selection, loaded context, and the returned answer."
  },
  {
    icon: ScanSearch,
    number: "02",
    title: "Diagnose",
    text: "Reconstruct the exact memory state and locate the decision that produced the wrong context."
  },
  {
    icon: RotateCcw,
    number: "03",
    title: "Replay",
    text: "Branch from the original checkpoint, change one memory decision, and rerun the frozen turn."
  },
  {
    icon: TestTube2,
    number: "04",
    title: "Test",
    text: "Export the verified answer and retrieval behavior as a portable regression contract."
  }
];

const evidenceLevels = [
  ["Observed", "Explicit application or provider telemetry"],
  ["Mapped", "Deterministic translation from a known provider shape"],
  ["Derived", "A visible rule applied to captured evidence"],
  ["Replayed", "A controlled rerun under a documented memory change"],
  ["Unavailable", "Not captured, and never silently inferred"]
];

const integrations = [
  {
    icon: Braces,
    name: "TypeScript SDK",
    text: "Wrap the agent turn and emit the retrieval-to-answer boundary directly."
  },
  {
    icon: Database,
    name: "Mem0",
    text: "Preserve returned records and selection evidence without changing provider behavior."
  },
  {
    icon: Network,
    name: "LangGraph",
    text: "Instrument durable Store operations while keeping checkpoint state distinct."
  },
  {
    icon: GitBranch,
    name: "Custom memory",
    text: "Use the provider-neutral telemetry contract around your own retrieval stack."
  }
];

export default function HomePage() {
  const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? defaultDocsUrl;

  return (
    <main>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <section className="hero" aria-labelledby="hero-title">
        <header className="site-header">
          <a className="brand" href="#top" aria-label="Engram home">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span>ENGRAM</span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#workflow">Workflow</a>
            <a href="/docs">Docs</a>
            <a href={githubUrl} target="_blank" rel="noreferrer">
              <GitFork aria-hidden="true" size={17} />
              <span>GitHub</span>
            </a>
          </nav>
        </header>

        <div className="hero-scene">
          <MarketingBrain />
        </div>

        <div className="hero-inner" id="top">
          <div className="hero-copy" id="main-content">
            <p className="eyebrow">Open source / local memory evidence</p>
            <h1 id="hero-title">Memory reliability for AI agents</h1>
            <p className="hero-lede">
              Find the memory decision behind a bad answer. Correct it in isolation, replay the same turn,
              and keep the verified behavior as a regression test.
            </p>

            <div className="failure-snapshot" aria-label="Stale location failure example">
              <div>
                <span>Question</span>
                <strong>What city do I live in now?</strong>
              </div>
              <div>
                <span>Loaded memory</span>
                <strong>San Francisco / stale</strong>
              </div>
              <div className="failure-answer">
                <span>Bad answer</span>
                <strong>You live in San Francisco.</strong>
              </div>
            </div>

            <div className="hero-actions">
              <a className="button button-primary" href="#quickstart">
                <Play aria-hidden="true" fill="currentColor" size={16} />
                Run guided demo
              </a>
              <a className="button button-secondary" href={docsUrl} target="_blank" rel="noreferrer">
                Quickstart
                <ArrowRight aria-hidden="true" size={16} />
              </a>
            </div>

            <p className="trust-line">
              <ShieldCheck aria-hidden="true" size={16} />
              Runs locally. No account. No hosted collector. Your traces stay on your machine.
            </p>
          </div>
        </div>
      </section>

      <section className="incident-section" id="workflow" aria-labelledby="incident-title">
        <div className="section-inner incident-layout">
          <div className="section-intro">
            <p className="section-kicker">A concrete failure, not generic tracing</p>
            <h2 id="incident-title">The answer was wrong before generation began.</h2>
            <p>
              The user moved to Oakland. Retrieval still selected an older San Francisco memory and loaded it
              into active context. Engram keeps each boundary visible so the repair targets the memory decision,
              not a guess about model reasoning.
            </p>
          </div>

          <ol className="incident-trace" aria-label="Stale location incident trace">
            <li>
              <span className="trace-index">01</span>
              <div>
                <span className="trace-label">Memory state</span>
                <strong>San Francisco</strong>
                <strong className="trace-current">Oakland / current</strong>
              </div>
            </li>
            <li>
              <span className="trace-index">02</span>
              <div>
                <span className="trace-label">Retrieval</span>
                <strong>Selected stale record</strong>
                <span>Ignored the newer correction</span>
              </div>
            </li>
            <li>
              <span className="trace-index">03</span>
              <div>
                <span className="trace-label">Generation</span>
                <strong>“You live in San Francisco.”</strong>
                <span>Recorded answer / observed</span>
              </div>
            </li>
            <li>
              <span className="trace-index">04</span>
              <div>
                <span className="trace-label">Diagnosis</span>
                <strong>Stale memory reached context</strong>
                <span>Correction was available but not selected</span>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="loop-section" aria-labelledby="loop-title">
        <div className="section-inner">
          <div className="compact-heading">
            <p className="section-kicker">From incident to executable proof</p>
            <h2 id="loop-title">Capture. Diagnose. Replay. Test.</h2>
          </div>
          <div className="loop-grid">
            {loopSteps.map(({ icon: Icon, number, title, text }) => (
              <article className="loop-step" key={title}>
                <div className="loop-step-top">
                  <Icon aria-hidden="true" size={21} />
                  <span>{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="evidence-section" aria-labelledby="evidence-title">
        <div className="section-inner evidence-layout">
          <div className="section-intro">
            <p className="section-kicker">Evidence contract</p>
            <h2 id="evidence-title">Visualize what the application can prove.</h2>
            <p>
              Engram does not expose hidden chain-of-thought. It separates retrieved candidates from selected
              memory, loaded context, and the recorded answer, then labels every conclusion by evidence level.
            </p>
            <p className="evidence-note">
              <CircleDot aria-hidden="true" size={16} />A changed replay is behavioral evidence under controlled
              inputs, not deterministic causal proof.
            </p>
          </div>

          <dl className="evidence-table">
            {evidenceLevels.map(([term, detail]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="integrations-section" aria-labelledby="integrations-title">
        <div className="section-inner">
          <div className="compact-heading integrations-heading">
            <div>
              <p className="section-kicker">Instrument the boundary you own</p>
              <h2 id="integrations-title">Fits the memory stack already in your agent.</h2>
            </div>
            <a className="text-link" href={docsUrl} target="_blank" rel="noreferrer">
              Integration docs <ArrowRight aria-hidden="true" size={16} />
            </a>
          </div>
          <div className="integrations-grid">
            {integrations.map(({ icon: Icon, name, text }) => (
              <article className="integration" key={name}>
                <Icon aria-hidden="true" size={22} />
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="quickstart-section" id="quickstart" aria-labelledby="quickstart-title">
        <div className="section-inner quickstart-layout">
          <div>
            <p className="section-kicker">Deterministic guided demo</p>
            <h2 id="quickstart-title">Reproduce the failure before instrumenting anything.</h2>
            <p>
              One command starts local capture, records the three-turn stale-location incident, and opens the
              repair workflow. No API key or memory-provider account is required.
            </p>
          </div>
          <div className="quickstart-action">
            <MarketingCommand />
            <div className="quickstart-links">
              <a className="button button-primary" href={docsUrl} target="_blank" rel="noreferrer">
                Read the quickstart <ArrowRight aria-hidden="true" size={16} />
              </a>
              <a className="button button-secondary" href={githubUrl} target="_blank" rel="noreferrer">
                <GitFork aria-hidden="true" size={17} />
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="section-inner footer-inner">
          <div className="brand footer-brand">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span>ENGRAM</span>
          </div>
          <p>Open-source memory reliability and replay for AI agents.</p>
          <div className="footer-links">
            <a href="/docs">Docs</a>
            <a href={githubUrl} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span>MIT licensed</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
