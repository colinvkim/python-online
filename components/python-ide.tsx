"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { DEFAULT_TEMPLATE } from "@/lib/templates";
import { clearStoredCode, persistCode, readStoredCode } from "@/lib/storage";
import {
  STDIN_CAPACITY_BYTES,
  type RuntimeStatus,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "@/lib/runtime";

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "15px",
    backgroundColor: "#0f172a",
  },
  ".cm-content": {
    padding: "22px 0",
    caretColor: "#f8fafc",
  },
  ".cm-line": {
    padding: "0 22px",
  },
  ".cm-gutters": {
    backgroundColor: "#0f172a",
    border: "none",
    color: "#64748b",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(56, 189, 248, 0.14)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(56, 189, 248, 0.24)",
  },
});

type ConsoleEntryTone = "stdout" | "stderr" | "stdin";

type ConsoleEntry = {
  id: string;
  tone: ConsoleEntryTone;
  text: string;
};

const STATUS_LABELS: Record<RuntimeStatus, string> = {
  standby: "Idle",
  loading: "Loading",
  ready: "Ready",
  running: "Running",
  "waiting-input": "Input",
  stopped: "Stopped",
  error: "Error",
};

export default function PythonIde() {
  const [code, setCode] = useState(DEFAULT_TEMPLATE.code);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("standby");
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [stdinValue, setStdinValue] = useState("");
  const [supportError, setSupportError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const stdinMetaRef = useRef<Int32Array | null>(null);
  const stdinBytesRef = useRef<Uint8Array | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const terminalScrollRef = useRef<HTMLDivElement | null>(null);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);
  const hasLoggedSupportErrorRef = useRef(false);

  const statusLabel = useMemo(
    () => STATUS_LABELS[runtimeStatus] ?? "Idle",
    [runtimeStatus],
  );

  useEffect(() => {
    setIsHydrated(true);

    const stored = readStoredCode();
    if (stored?.code) {
      setCode(stored.code);
    }

    if (
      typeof window !== "undefined" &&
      (typeof window.SharedArrayBuffer === "undefined" ||
        !window.crossOriginIsolated)
    ) {
      setSupportError(
        "SharedArrayBuffer is unavailable in this browser session, so interactive stdin cannot start.",
      );
      setRuntimeStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    persistCode(code, null);
  }, [code, isHydrated]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    terminalScrollRef.current?.scrollTo({
      top: terminalScrollRef.current.scrollHeight,
    });
  }, [consoleEntries, stdinValue, awaitingInput]);

  useEffect(() => {
    if (awaitingInput) {
      terminalInputRef.current?.focus();
      terminalInputRef.current?.select();
    }
  }, [awaitingInput]);

  useEffect(() => {
    if (!supportError || hasLoggedSupportErrorRef.current) {
      return;
    }

    hasLoggedSupportErrorRef.current = true;
    setConsoleEntries([
      {
        id: "support-error",
        tone: "stderr",
        text: `${supportError}\n`,
      },
    ]);
  }, [supportError]);

  function appendConsoleEntry(tone: ConsoleEntryTone, text: string) {
    setConsoleEntries((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tone,
        text,
      },
    ]);
  }

  function clearConsole() {
    setConsoleEntries([]);
  }

  function setUpStdinBuffer() {
    const shared = new SharedArrayBuffer(8 + STDIN_CAPACITY_BYTES);
    stdinMetaRef.current = new Int32Array(shared, 0, 2);
    stdinBytesRef.current = new Uint8Array(shared, 8);
    return shared;
  }

  function handleWorkerMessage(event: MessageEvent<WorkerOutboundMessage>) {
    const message = event.data;

    if ("requestId" in message && message.requestId !== activeRequestIdRef.current) {
      return;
    }

    switch (message.type) {
      case "loading":
        setRuntimeStatus("loading");
        break;
      case "ready":
        setRuntimeStatus((current) => (current === "running" ? current : "ready"));
        break;
      case "execution_started":
        setRuntimeStatus("running");
        break;
      case "stdout":
        appendConsoleEntry("stdout", message.chunk);
        break;
      case "stderr":
        appendConsoleEntry("stderr", message.chunk);
        break;
      case "input_request":
        setAwaitingInput(true);
        setRuntimeStatus("waiting-input");
        break;
      case "success":
        setAwaitingInput(false);
        setRuntimeStatus("ready");
        activeRequestIdRef.current = null;
        break;
      case "error":
        setAwaitingInput(false);
        appendConsoleEntry("stderr", `${message.error}\n`);
        setRuntimeStatus("error");
        activeRequestIdRef.current = null;
        break;
    }
  }

  function ensureWorker() {
    if (supportError) {
      return null;
    }

    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(
      new URL("../workers/python.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );

    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
      appendConsoleEntry("stderr", `${event.message}\n`);
      setRuntimeStatus("error");
    });

    const stdinBuffer = setUpStdinBuffer();
    const initMessage: WorkerInboundMessage = {
      type: "init",
      stdinBuffer,
    };

    worker.postMessage(initMessage);
    workerRef.current = worker;
    return worker;
  }

  function resetWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    stdinMetaRef.current = null;
    stdinBytesRef.current = null;
  }

  async function handleRun() {
    if (
      runtimeStatus === "loading" ||
      runtimeStatus === "running" ||
      runtimeStatus === "waiting-input"
    ) {
      return;
    }

    const worker = ensureWorker();
    if (!worker) {
      if (supportError) {
        appendConsoleEntry("stderr", `${supportError}\n`);
      }
      return;
    }

    requestSequenceRef.current += 1;
    const requestId = `run-${requestSequenceRef.current}`;
    activeRequestIdRef.current = requestId;
    setAwaitingInput(false);
    setStdinValue("");
    clearConsole();
    setRuntimeStatus("loading");

    const message: WorkerInboundMessage = {
      type: "run",
      code,
      requestId,
    };

    worker.postMessage(message);
  }

  function handleStop() {
    if (!workerRef.current) {
      return;
    }

    resetWorker();
    setAwaitingInput(false);
    setStdinValue("");
    activeRequestIdRef.current = null;
    setRuntimeStatus("stopped");
    appendConsoleEntry("stderr", "^C\n");
  }

  function handleReset() {
    clearStoredCode();
    setCode(DEFAULT_TEMPLATE.code);
    setAwaitingInput(false);
    setStdinValue("");
    setRuntimeStatus("standby");
    resetWorker();
    clearConsole();
  }

  function handleSubmitInput(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const meta = stdinMetaRef.current;
    const bytes = stdinBytesRef.current;

    if (!meta || !bytes) {
      appendConsoleEntry("stderr", "stdin channel is not ready.\n");
      return;
    }

    const encoded = new TextEncoder().encode(`${stdinValue}\n`);
    if (encoded.length > STDIN_CAPACITY_BYTES) {
      appendConsoleEntry(
        "stderr",
        `stdin is too large. Limit input to ${STDIN_CAPACITY_BYTES - 1} bytes.\n`,
      );
      return;
    }

    bytes.fill(0);
    bytes.set(encoded);
    Atomics.store(meta, 1, encoded.length);
    Atomics.store(meta, 0, 1);
    Atomics.notify(meta, 0, 1);

    appendConsoleEntry("stdin", `› ${stdinValue}\n`);
    setStdinValue("");
    setAwaitingInput(false);
    setRuntimeStatus("running");
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleRun();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [code, supportError]);

  return (
    <main className="ide-shell">
      <section className="ide-frame">
        <header className="ide-toolbar">
          <div className="ide-toolbar__actions">
            <button
              type="button"
              className="chrome-button chrome-button--primary"
              onClick={() => void handleRun()}
              disabled={
                Boolean(supportError) ||
                runtimeStatus === "loading" ||
                runtimeStatus === "running" ||
                runtimeStatus === "waiting-input"
              }
            >
              Run
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={handleStop}
              disabled={!workerRef.current || runtimeStatus === "loading"}
            >
              Stop
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={handleReset}
            >
              Reset
            </button>
          </div>

          <div className={`runtime-badge runtime-badge--${runtimeStatus}`}>
            <span className="runtime-badge__dot" />
            <span>{statusLabel}</span>
          </div>
        </header>

        <section className="ide-workspace">
          <article className="pane pane--editor">
            <CodeMirror
              value={code}
              height="100%"
              theme={oneDark}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                dropCursor: false,
                highlightActiveLineGutter: true,
                highlightSpecialChars: false,
              }}
              extensions={[
                python(),
                EditorView.lineWrapping,
                editorTheme,
                EditorView.theme({
                  "&": {
                    height: "100%",
                  },
                }),
              ]}
              onChange={(value) => setCode(value)}
            />
          </article>

          <article
            className="pane pane--terminal"
            onClick={() => terminalInputRef.current?.focus()}
          >
            <div ref={terminalScrollRef} className="terminal-scroll">
              {consoleEntries.length === 0 ? null : (
                <div className="terminal-output" aria-live="polite">
                  {consoleEntries.map((entry) => (
                    <span
                      key={entry.id}
                      className={`terminal-chunk terminal-chunk--${entry.tone}`}
                    >
                      {entry.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <form className="terminal-prompt" onSubmit={handleSubmitInput}>
              <span className="terminal-prompt__caret" aria-hidden="true">
                {awaitingInput ? "›" : ""}
              </span>
              <input
                ref={terminalInputRef}
                value={stdinValue}
                onChange={(event) => setStdinValue(event.target.value)}
                disabled={!awaitingInput}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Console input"
              />
            </form>
          </article>
        </section>
      </section>
    </main>
  );
}
