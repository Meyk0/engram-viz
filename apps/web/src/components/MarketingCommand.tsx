"use client";

import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

const command = "npx --yes @engramviz/cli demo stale-location";

export function MarketingCommand() {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="command-shell">
      <div className="command-heading">
        <span>Run the same incident locally</span>
        <a href="https://www.npmjs.com/package/@engramviz/cli" rel="noreferrer" target="_blank">npm</a>
      </div>
      <div className="command-line" aria-label="Guided demo command">
        <Terminal aria-hidden="true" size={18} />
        <code>{command}</code>
        <button
          aria-label={copied ? "Command copied" : "Copy guided demo command"}
          className="icon-button"
          onClick={copyCommand}
          title={copied ? "Copied" : "Copy command"}
          type="button"
        >
          {copied ? <Check aria-hidden="true" size={17} /> : <Copy aria-hidden="true" size={17} />}
        </button>
      </div>
      <p className="command-meta">Open-source CLI <span /> Local Studio <span /> No account <span /> No hosted collector</p>
      <p className="command-architecture">Your agent <span>→</span> SDK or adapter <span>→</span> .engram/data <span>→</span> local Studio</p>
    </div>
  );
}
