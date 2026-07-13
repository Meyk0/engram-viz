"use client";

import { FileJson, FileUp, ShieldCheck, Sparkles, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./trace-playback.css";

const MAX_TRACE_FILE_BYTES = 2 * 1024 * 1024;

export type TraceImportDialogProps = {
  error?: string | null;
  importing?: boolean;
  onCancel: () => void;
  onImport: (raw: unknown | string) => void | Promise<void>;
  onLoadSample: () => void;
  open: boolean;
};

export function TraceImportDialog({
  error,
  importing = false,
  onCancel,
  onImport,
  onLoadSample,
  open
}: TraceImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaId = useId();
  const [rawTrace, setRawTrace] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  const displayedError = localError ?? error;

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
        aria-describedby="trace-import-privacy"
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

          <input
            ref={fileInputRef}
            className="trace-file-input"
            type="file"
            accept=".json,application/json"
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
        </div>

        <footer className="trace-import-actions">
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
        </footer>
      </section>
    </div>
  );
}
