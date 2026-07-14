"use client";

import { Copy, FileJson, FileUp, Radio, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { LiveRecorderStatus } from "@/hooks/useLiveTraceRecorder";
import "./trace-playback.css";

const MAX_TRACE_FILE_BYTES = 2 * 1024 * 1024;

export type TraceImportDialogProps = {
  error?: string | null;
  importing?: boolean;
  liveAvailable?: boolean;
  onCancel: () => void;
  onImport: (raw: unknown | string) => void | Promise<void>;
  onLoadSample: () => void;
  onStartLive?: () => void;
  onStopLive?: () => void;
  open: boolean;
  liveChannelId?: string;
  liveError?: string;
  liveStatus?: LiveRecorderStatus;
};

export function TraceImportDialog({
  error,
  importing = false,
  liveAvailable = true,
  onCancel,
  onImport,
  onLoadSample,
  onStartLive,
  onStopLive,
  liveChannelId,
  liveError,
  liveStatus = "idle",
  open
}: TraceImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaId = useId();
  const [rawTrace, setRawTrace] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mode, setMode] = useState<"file" | "live">("file");
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const displayedError = localError ?? error;
  const origin = typeof window === "undefined" ? "https://your-engram-host" : window.location.origin;
  const setupCode = liveChannelId
    ? liveSetupCode(`${origin}/api/traces/live`, liveChannelId)
    : "";

  async function copySetup() {
    await navigator.clipboard.writeText(setupCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function submitTrace() {
    setLocalError(null);

    if (!rawTrace.trim()) {
      setLocalError("Paste trace JSON or choose a JSON file first.");
      return;
    }

    try {
      JSON.parse(rawTrace);
      await onImport(rawTrace);
    } catch (caught) {
      setLocalError(
        caught instanceof SyntaxError
          ? "This is not valid JSON. Check the pasted trace and try again."
          : caught instanceof Error
            ? caught.message
            : "The trace could not be imported."
      );
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLocalError(null);
    if (file.size > MAX_TRACE_FILE_BYTES) {
      setFileName(null);
      setLocalError("Trace files must be smaller than 2 MB.");
      return;
    }

    try {
      const text = await file.text();
      JSON.parse(text);
      setRawTrace(text);
      setFileName(file.name);
    } catch {
      setFileName(null);
      setLocalError("The selected file is not valid JSON.");
    }
  }

  return (
    <div className="trace-import-backdrop" role="presentation">
      <section
        aria-describedby={mode === "file" ? "trace-import-privacy" : undefined}
        aria-labelledby="trace-import-title"
        aria-modal="true"
        className="trace-import-dialog"
        role="dialog"
      >
        <header className="trace-import-header">
          <div>
            <span className="trace-import-eyebrow">
              <FileUp aria-hidden="true" size={12} />
              Agent trace playback
            </span>
            <h2 id="trace-import-title">Import a recorded trace</h2>
          </div>
          <button className="trace-icon-button" type="button" onClick={onCancel} aria-label="Close trace import">
            <X aria-hidden="true" size={15} />
          </button>
        </header>

        <div className="trace-import-body">
          <p className="trace-import-intro">
            Replay recorded agent steps and visualize explicit memory operations without rerunning the model.
          </p>

          <div className="trace-import-mode" role="tablist" aria-label="Trace source">
            <button role="tab" aria-selected={mode === "file"} type="button" onClick={() => setMode("file")}>
              <FileJson size={12} /> Recorded
            </button>
            {liveAvailable ? (
              <button role="tab" aria-selected={mode === "live"} type="button" onClick={() => setMode("live")}>
                <Radio size={12} /> Live
              </button>
            ) : null}
          </div>

          {mode === "file" ? <>
          <input
            ref={fileInputRef}
            className="trace-file-input"
            type="file"
            accept=".engram,.json,application/json"
            onChange={readFile}
            aria-label="Choose trace JSON file"
          />
          <button
            className="trace-file-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <FileJson aria-hidden="true" size={15} />
            <span>
              <strong>{fileName ?? "Choose JSON file"}</strong>
              <small>OpenAI Responses, Agents SDK, or Engram trace</small>
            </span>
          </button>

          <div className="trace-import-divider" aria-hidden="true"><span>or paste JSON</span></div>

          <label className="trace-import-label" htmlFor={textareaId}>Trace JSON</label>
          <textarea
            id={textareaId}
            value={rawTrace}
            onChange={(event) => {
              setRawTrace(event.target.value);
              setFileName(null);
              setLocalError(null);
            }}
            placeholder={'{"object":"response", ...}'}
            spellCheck={false}
            disabled={importing}
          />

          {displayedError ? <p className="trace-import-error" role="alert">{displayedError}</p> : null}

          <div className="trace-import-privacy" id="trace-import-privacy">
            <ShieldCheck aria-hidden="true" size={14} />
            <span><strong>Parsed locally; never uploaded.</strong> Trace content stays in this browser session.</span>
          </div>
          </> : (
            <section
              className="trace-live-setup"
              aria-label="Live flight recorder setup"
              data-channel-id={liveChannelId}
            >
              <div className="trace-live-status" data-status={liveStatus}>
                <i aria-hidden="true" />
                <span>
                  <strong>{liveStatusLabel(liveStatus)}</strong>
                  {liveChannelId ? `${liveChannelId.slice(0, 18)}...` : "No channel is open."}
                </span>
              </div>

              {!liveChannelId ? (
                <button className="trace-live-start" type="button" onClick={onStartLive} disabled={!onStartLive}>
                  <Radio size={14} /> Start flight recorder
                </button>
              ) : (
                <>
                  <p>
                    Add this secondary processor to a server-side OpenAI Agents SDK app. Engram receives serialized traces and spans; your existing OpenAI exporter remains active.
                  </p>
                  <div className="trace-live-code">
                    <pre>{setupCode}</pre>
                    <button type="button" onClick={() => void copySetup()} aria-label="Copy live recorder setup">
                      <Copy size={12} /> {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="trace-live-caveat">
                    <ShieldCheck size={14} />
                    <span><strong>Ephemeral demo channel.</strong> Items are redacted and kept only in this server process. Serverless restarts can end the stream.</span>
                  </div>
                  <button className="trace-live-stop" type="button" onClick={onStopLive}>
                    <Square size={11} /> Stop listening
                  </button>
                </>
              )}
              {liveError ? <p className="trace-import-error" role="alert">{liveError}</p> : null}
            </section>
          )}
        </div>

        <footer className="trace-import-actions">
          {mode === "file" ? <>
          <button className="trace-sample-button" type="button" onClick={onLoadSample} disabled={importing}>
            <Sparkles aria-hidden="true" size={13} />
            Load sample trace
          </button>
          <span className="trace-import-action-spacer" />
          <button className="trace-cancel-button" type="button" onClick={onCancel} disabled={importing}>Cancel</button>
          <button className="trace-primary-button" type="button" onClick={submitTrace} disabled={importing || !rawTrace.trim()}>
            <FileUp aria-hidden="true" size={13} />
            {importing ? "Importing..." : "Import trace"}
          </button>
          </> : (
            <button className="trace-cancel-button" type="button" onClick={onCancel}>Close</button>
          )}
        </footer>
      </section>
    </div>
  );
}

function liveStatusLabel(status: LiveRecorderStatus) {
  if (status === "connecting") return "Opening channel";
  if (status === "listening") return "Listening for first span";
  if (status === "live") return "Receiving live trace";
  if (status === "reconnecting") return "Reconnecting";
  if (status === "error") return "Connection needs attention";
  return "Flight recorder idle";
}

function liveSetupCode(endpoint: string, channelId: string) {
  return `import { addTraceProcessor } from "@openai/agents";
import { createEngramTracingProcessor } from "./flight-recorder-client";

addTraceProcessor(createEngramTracingProcessor({
  endpoint: "${endpoint}",
  channelId: "${channelId}"
}));`;
}
