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
  );
}
