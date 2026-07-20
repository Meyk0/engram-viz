import { ArrowRight, GitFork, Play } from "lucide-react";
import { IncidentProof } from "../components/IncidentProof";
import { MarketingBrain } from "../components/MarketingBrain";
import { MarketingCommand } from "../components/MarketingCommand";

const githubUrl = "https://github.com/Meyk0/engram-viz";
const defaultDocsUrl = `${githubUrl}/blob/main/docs/quickstart.mdx`;

export default function HomePage() {
  const configuredDocsUrl = process.env.NEXT_PUBLIC_DOCS_URL?.replace(/\/$/, "");
  const docsUrl = configuredDocsUrl ?? defaultDocsUrl;
  const docHref = (path: string) => configuredDocsUrl
    ? `${configuredDocsUrl}/${path}`
    : `${githubUrl}/blob/main/docs/${path}.mdx`;
  const integrations = [
    ["TypeScript SDK", "@engramviz/sdk", docHref("instrument/typescript-sdk")],
    ["Mem0", "@engramviz/adapter-mem0", docHref("instrument/mem0")],
    ["LangGraph Store", "@engramviz/adapter-langgraph", docHref("instrument/langgraph")],
    ["Custom provider", "Memory Telemetry v2", docHref("instrument/custom-adapters")]
  ] as const;

  return (
    <main>
      <a className="skip-link" href="#main-content">Skip to content</a>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <header className="site-header">
          <a className="brand" href="#top" aria-label="Engram home">
            <strong>ENGRAM</strong>
            <small>Memory reliability</small>
          </a>
          <nav aria-label="Primary navigation">
            <a href="/demo">Demo</a>
            <a href="/docs">Docs</a>
            <a aria-label="Engram on GitHub" href={githubUrl} target="_blank" rel="noreferrer">
              <GitFork aria-hidden="true" size={16} />
              <span>GitHub</span>
            </a>
          </nav>
        </header>

        <div className="hero-scene"><MarketingBrain /></div>

        <div className="hero-inner">
          <div className="hero-copy" id="main-content">
            <h1 id="hero-title">Replay and regression-test agent memory policies.</h1>
            <p className="hero-lede">
              Import a captured failure, inspect the exact state, ranking, selection, and context decisions,
              then test an alternative policy on an isolated branch and keep the repair executable in CI.
            </p>
            <MarketingCommand />
            <div className="hero-actions">
              <a className="button button-primary" href="/demo">
                <Play aria-hidden="true" fill="currentColor" size={15} />
                Run the guided incident
              </a>
              <a className="text-link" href={docsUrl} target="_blank" rel="noreferrer">
                Instrument your agent <ArrowRight aria-hidden="true" size={15} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-section" id="workflow" aria-labelledby="proof-title">
        <div className="section-inner">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2 id="proof-title">From trace evidence to a memory-policy test.</h2>
              <p>Diagnose one stale-memory incident, replay a controlled repair, then make it portable.</p>
            </div>
          </div>
          <IncidentProof />
        </div>
      </section>

      <section className="integrations-section" aria-labelledby="integrations-title">
        <div className="section-inner integrations-layout">
          <div className="section-heading integrations-heading">
            <span className="section-number">02</span>
            <div>
              <h2 id="integrations-title">Use your existing memory stack.</h2>
              <p>Capture retrieval, loaded context, and answers with the SDK or an adapter.</p>
            </div>
          </div>
          <div className="integration-rail" aria-label="Supported integrations">
            {integrations.map(([name, detail, href]) => (
              <a href={href} key={name} rel="noreferrer" target="_blank">
                <strong>{name}</strong><span>{detail}</span><ArrowRight aria-hidden="true" size={14} />
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="evidence-section" aria-labelledby="evidence-title">
        <div className="section-inner evidence-layout">
          <div>
            <span className="section-number">03</span>
            <h2 id="evidence-title">Evidence without invented certainty.</h2>
          </div>
          <div className="evidence-copy">
            <p>
              Engram shows observable application behavior, not chain-of-thought or hidden model activations.
              Replay is behavioral evidence, not causal proof. Missing evidence stays unavailable instead of
              becoming a confident story.
            </p>
            <p>
              Use Engram beside general tracing tools as the specialized memory-policy layer: reconstruct the
              lifecycle decision, intervene on it, and turn the repair into a semantic regression contract.
            </p>
            <div className="evidence-legend" aria-label="Evidence levels">
              <span><i data-level="observed" />Observed</span>
              <span><i data-level="derived" />Derived</span>
              <span><i data-level="replayed" />Replayed</span>
              <span><i data-level="unavailable" />Unavailable</span>
            </div>
            <a className="closing-link" href={docsUrl} target="_blank" rel="noreferrer">
              Instrument your agent <ArrowRight aria-hidden="true" size={15} />
            </a>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="section-inner footer-inner">
          <div><strong>ENGRAM</strong><span>Memory reliability for AI agents.</span></div>
          <div className="footer-links">
            <a href="/demo">Demo</a>
            <a href="/docs">Docs</a>
            <a href="https://www.npmjs.com/package/@engramviz/cli" target="_blank" rel="noreferrer">npm</a>
            <a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
            <span>MIT</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
