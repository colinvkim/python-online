"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Play, Square } from "lucide-react";
import PythonEditor from "@/components/python-editor";
import { persistCode, readStoredCode } from "@/lib/storage";
import {
  INTERRUPT_SIGNAL,
  STDIN_CAPACITY_BYTES,
  type RuntimeStatus,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "@/lib/runtime";

function normalizeTerminalText(text: string) {
  return text.replace(/\r?\n/g, "\r\n");
}

const SUPPORT_ERROR_MESSAGE =
  "SharedArrayBuffer is unavailable in this browser session, so interactive stdin cannot start.";
const textEncoder = new TextEncoder();

export default function PythonIde() {
  const [initialCode, setInitialCode] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("standby");
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);

  const codeRef = useRef("");
  const persistTimeoutRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const stdinMetaRef = useRef<Int32Array | null>(null);
  const stdinBytesRef = useRef<Uint8Array | null>(null);
  const interruptBufferRef = useRef<Int32Array | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const awaitingInputRef = useRef(false);
  const runtimeStatusRef = useRef<RuntimeStatus>("standby");
  const currentInputRef = useRef("");
  const hasLoggedSupportErrorRef = useRef(false);
  const suppressPrimaryClickRef = useRef(false);
  const prewarmRequestedRef = useRef(false);

  const isProgramActive =
    runtimeStatus === "loading" ||
    runtimeStatus === "running" ||
    runtimeStatus === "waiting-input";

  useEffect(() => {
    awaitingInputRef.current = awaitingInput;

    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = awaitingInput;
      if (awaitingInput) {
        terminalRef.current.focus();
      }
    }
  }, [awaitingInput]);

  useEffect(() => {
    runtimeStatusRef.current = runtimeStatus;
  }, [runtimeStatus]);

  useEffect(() => {
    if (!terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorWidth: 2,
      fontFamily: '"JetBrains Mono", "SF Mono", "IBM Plex Mono", monospace',
      fontSize: 15,
      fontWeight: "500",
      fontWeightBold: "700",
      lineHeight: 1.45,
      letterSpacing: 0.2,
      rightClickSelectsWord: true,
      scrollback: 3000,
      scrollSensitivity: 1.15,
      fastScrollSensitivity: 2.5,
      smoothScrollDuration: 80,
      theme: {
        background: "#02060d",
        foreground: "#d5e6f7",
        cursor: "#8ce3b8",
        cursorAccent: "#02060d",
        brightBlack: "#475569",
        black: "#0f172a",
        red: "#f87171",
        green: "#8ce3b8",
        yellow: "#fbbf24",
        blue: "#56c7ff",
        magenta: "#c084fc",
        cyan: "#67e8f9",
        white: "#e2e8f0",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    const textarea = terminal.textarea;
    textarea?.setAttribute("autocapitalize", "off");
    textarea?.setAttribute("autocomplete", "off");
    textarea?.setAttribute("autocorrect", "off");
    textarea?.setAttribute("spellcheck", "false");
    textarea?.setAttribute("aria-label", "Python terminal");
    fitAddon.fit();
    terminal.focus();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposable = terminal.onData((data) => {
      handleTerminalData(data);
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserverRef.current.observe(terminalHostRef.current);

    if (supportError && !hasLoggedSupportErrorRef.current) {
      hasLoggedSupportErrorRef.current = true;
      terminal.writeln(supportError);
    }

    return () => {
      disposable.dispose();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [supportError]);

  useEffect(() => {
    const storedCode = readStoredCode();
    if (storedCode) {
      codeRef.current = storedCode;
      setInitialCode(storedCode);
    }

    if (
      typeof window !== "undefined" &&
      (typeof window.SharedArrayBuffer === "undefined" ||
        !window.crossOriginIsolated)
    ) {
      setSupportError(SUPPORT_ERROR_MESSAGE);
      setRuntimeStatus("error");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const prewarmWorker = useCallback(() => {
    if (supportError || prewarmRequestedRef.current) {
      return;
    }

    const worker = ensureWorker();
    if (!worker) {
      return;
    }

    prewarmRequestedRef.current = true;
    const message: WorkerInboundMessage = {
      type: "warm",
    };
    worker.postMessage(message);
  }, [supportError]);

  const handleCodeChange = useCallback(
    (value: string) => {
      codeRef.current = value;

      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }

      persistTimeoutRef.current = window.setTimeout(() => {
        persistCode(value);
        persistTimeoutRef.current = null;
      }, 300);
    },
    [],
  );

  useEffect(() => {
    if (!supportError || hasLoggedSupportErrorRef.current || !terminalRef.current) {
      return;
    }

    hasLoggedSupportErrorRef.current = true;
    terminalRef.current.writeln(supportError);
  }, [supportError]);

  useEffect(() => {
    if (supportError) {
      return;
    }

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const requestIdle = window.requestIdleCallback?.bind(window);
    const cancelIdle = window.cancelIdleCallback?.bind(window);

    const warm = () => {
      prewarmWorker();
      removeListeners();
    };

    const removeListeners = () => {
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
      window.removeEventListener("touchstart", warm);
    };

    window.addEventListener("pointerdown", warm, { once: true, passive: true });
    window.addEventListener("keydown", warm, { once: true });
    window.addEventListener("touchstart", warm, { once: true, passive: true });

    if (requestIdle) {
      idleId = requestIdle(
        () => {
          warm();
        },
        { timeout: 2000 },
      );
    } else {
      timeoutId = window.setTimeout(warm, 1500);
    }

    return () => {
      removeListeners();

      if (idleId !== null && cancelIdle) {
        cancelIdle(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [prewarmWorker, supportError]);

  function focusTerminal() {
    terminalRef.current?.focus();
  }

  function fitTerminal() {
    fitAddonRef.current?.fit();
  }

  function resetTerminal() {
    currentInputRef.current = "";

    if (terminalRef.current) {
      terminalRef.current.reset();
      fitTerminal();
    }
  }

  function writeTerminal(text: string) {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.write(normalizeTerminalText(text));
  }

  function writelnTerminal(text: string) {
    writeTerminal(`${text}\n`);
  }

  function setUpStdinBuffer() {
    const shared = new SharedArrayBuffer(8 + STDIN_CAPACITY_BYTES);
    stdinMetaRef.current = new Int32Array(shared, 0, 2);
    stdinBytesRef.current = new Uint8Array(shared, 8);
    return shared;
  }

  function setUpInterruptBuffer() {
    const shared = new SharedArrayBuffer(4);
    interruptBufferRef.current = new Int32Array(shared);
    return shared;
  }

  function submitInput(input: string) {
    const meta = stdinMetaRef.current;
    const bytes = stdinBytesRef.current;

    if (!meta || !bytes) {
      writelnTerminal("stdin channel is not ready.");
      return;
    }

    const encoded = textEncoder.encode(`${input}\n`);
    if (encoded.length > STDIN_CAPACITY_BYTES) {
      writelnTerminal(
        `stdin is too large. Limit input to ${STDIN_CAPACITY_BYTES - 1} bytes.`,
      );
      return;
    }

    bytes.fill(0);
    bytes.set(encoded);
    Atomics.store(meta, 1, encoded.length);
    Atomics.store(meta, 0, 1);
    Atomics.notify(meta, 0, 1);

    setAwaitingInput(false);
    setRuntimeStatus("running");
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
        writeTerminal(message.chunk);
        break;
      case "stderr":
        writeTerminal(message.chunk);
        break;
      case "input_request":
        currentInputRef.current = "";
        setAwaitingInput(true);
        setRuntimeStatus("waiting-input");
        focusTerminal();
        break;
      case "success":
        setAwaitingInput(false);
        setRuntimeStatus("ready");
        activeRequestIdRef.current = null;
        break;
      case "interrupted":
        setAwaitingInput(false);
        currentInputRef.current = "";
        writelnTerminal("^C");
        setRuntimeStatus("stopped");
        activeRequestIdRef.current = null;
        break;
      case "error":
        setAwaitingInput(false);
        writelnTerminal(message.error);
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
      writelnTerminal(event.message);
      setRuntimeStatus("error");
      activeRequestIdRef.current = null;
    });

    const stdinBuffer = setUpStdinBuffer();
    const interruptBuffer = setUpInterruptBuffer();
    const initMessage: WorkerInboundMessage = {
      type: "init",
      stdinBuffer,
      interruptBuffer,
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
    interruptBufferRef.current = null;
  }

  function forceStop() {
    resetWorker();
    currentInputRef.current = "";
    setAwaitingInput(false);
    activeRequestIdRef.current = null;
    setRuntimeStatus("stopped");
    writelnTerminal("^C");
    focusTerminal();
  }

  function requestInterrupt() {
    const requestId = activeRequestIdRef.current;
    if (!requestId || !workerRef.current) {
      return false;
    }

    if (runtimeStatusRef.current === "loading") {
      return false;
    }

    const interruptBuffer = interruptBufferRef.current;
    if (!interruptBuffer) {
      return false;
    }

    Atomics.store(interruptBuffer, 0, INTERRUPT_SIGNAL);
    const message: WorkerInboundMessage = {
      type: "stop",
      requestId,
    };
    workerRef.current.postMessage(message);
    return true;
  }

  function handleTerminalData(data: string) {
    if (data.includes("\u0003")) {
      handleStop();
      return;
    }

    if (!awaitingInputRef.current) {
      return;
    }

    for (const char of Array.from(data)) {
      if (char === "\r" || char === "\n") {
        const input = currentInputRef.current;
        terminalRef.current?.write("\r\n");
        currentInputRef.current = "";
        submitInput(input);
        break;
      }

      if (char === "\u007f") {
        if (currentInputRef.current.length === 0) {
          continue;
        }

        currentInputRef.current = currentInputRef.current.slice(0, -1);
        terminalRef.current?.write("\b \b");
        continue;
      }

      if (char === "\u0015") {
        while (currentInputRef.current.length > 0) {
          currentInputRef.current = currentInputRef.current.slice(0, -1);
          terminalRef.current?.write("\b \b");
        }
        continue;
      }

      if (char === "\u001b") {
        continue;
      }

      if (char === "\t" || char >= " ") {
        currentInputRef.current += char;
        terminalRef.current?.write(char);
      }
    }
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
        writelnTerminal(supportError);
      }
      return;
    }

    requestSequenceRef.current += 1;
    const requestId = `run-${requestSequenceRef.current}`;
    activeRequestIdRef.current = requestId;
    currentInputRef.current = "";
    setAwaitingInput(false);
    resetTerminal();
    setRuntimeStatus("loading");

    const message: WorkerInboundMessage = {
      type: "run",
      code: codeRef.current,
      requestId,
    };

    worker.postMessage(message);
    focusTerminal();
  }

  function handleStop() {
    if (!workerRef.current) {
      return;
    }

    if (runtimeStatusRef.current === "waiting-input") {
      forceStop();
      return;
    }

    const interrupted = requestInterrupt();
    if (!interrupted) {
      forceStop();
    }
    focusTerminal();
  }

  function handlePrimaryActionPointerDown(
    event: PointerEvent<HTMLButtonElement>,
  ) {
    if (!isProgramActive) {
      return;
    }

    suppressPrimaryClickRef.current = true;
    event.preventDefault();
    handleStop();
  }

  function handlePrimaryActionClick(event: MouseEvent<HTMLButtonElement>) {
    if (suppressPrimaryClickRef.current) {
      suppressPrimaryClickRef.current = false;
      event.preventDefault();
      return;
    }

    if (isProgramActive) {
      handleStop();
      return;
    }

    void handleRun();
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleRun();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "c") {
        if (
          runtimeStatus === "running" ||
          runtimeStatus === "waiting-input" ||
          runtimeStatus === "loading"
        ) {
          event.preventDefault();
          handleStop();
        }
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [runtimeStatus, supportError]);

  return (
    <main className="ide-shell">
      <section className="ide-frame">
        <header className="ide-toolbar">
          <div className="ide-toolbar__actions">
            <button
              type="button"
              className={`chrome-button ${
                isProgramActive
                  ? "chrome-button--danger"
                  : "chrome-button--primary"
              }`}
              onPointerDown={handlePrimaryActionPointerDown}
              onClick={handlePrimaryActionClick}
              disabled={Boolean(supportError) && !isProgramActive}
            >
              {isProgramActive ? (
                <>
                  <Square size={16} strokeWidth={2.2} aria-hidden="true" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Play size={16} strokeWidth={2.2} aria-hidden="true" />
                  <span>Run</span>
                </>
              )}
            </button>
          </div>
        </header>

        <section className="ide-workspace">
          <article className="pane pane--editor">
            <PythonEditor
              initialCode={initialCode}
              onCodeChange={handleCodeChange}
            />
          </article>

          <article className="pane pane--terminal" onClick={focusTerminal}>
            <div ref={terminalHostRef} className="terminal-host" />
          </article>
        </section>
      </section>
    </main>
  );
}
