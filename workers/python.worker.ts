import { loadPyodide, version as pyodideVersion } from "pyodide";
import type { PyodideInterface } from "pyodide";
import {
  INTERRUPT_SIGNAL,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "@/lib/runtime";

let pyodideReadyPromise: Promise<PyodideInterface> | null = null;
let pyodideInstance: PyodideInterface | null = null;
let stdinMeta: Int32Array | null = null;
let stdinBytes: Uint8Array | null = null;
let interruptBuffer: Int32Array | null = null;
let pendingBytes: Uint8Array | null = null;
let pendingOffset = 0;
let activeRequestId: string | null = null;
let awaitingInput = false;

function post(message: WorkerOutboundMessage) {
  self.postMessage(message);
}

function ensureStdinReady() {
  if (!stdinMeta || !stdinBytes) {
    throw new Error("stdin bridge was not initialized.");
  }

  return {
    meta: stdinMeta,
    bytes: stdinBytes,
  };
}

function readFromSharedStdin() {
  const { meta, bytes } = ensureStdinReady();

  while (Atomics.load(meta, 0) === 0) {
    const state = Atomics.wait(meta, 0, 0, 100);
    if (state === "timed-out") {
      pyodideInstance?.checkInterrupt();
    }
  }

  const length = Atomics.load(meta, 1);
  const next = bytes.slice(0, length);
  Atomics.store(meta, 0, 0);
  Atomics.store(meta, 1, 0);
  return next;
}

function readStdin(buffer: Uint8Array) {
  while (!pendingBytes || pendingOffset >= pendingBytes.length) {
    if (!awaitingInput) {
      awaitingInput = true;
      if (!activeRequestId) {
        throw new Error("No active request for stdin.");
      }
      post({
        type: "input_request",
        requestId: activeRequestId,
      });
    }

    pendingBytes = readFromSharedStdin();
    pendingOffset = 0;
    awaitingInput = false;
  }

  const remaining = pendingBytes.length - pendingOffset;
  const count = Math.min(buffer.length, remaining);
  buffer.set(pendingBytes.subarray(pendingOffset, pendingOffset + count));
  pendingOffset += count;

  if (pendingOffset >= pendingBytes.length) {
    pendingBytes = null;
    pendingOffset = 0;
  }

  return count;
}

async function ensurePyodide() {
  if (!pyodideReadyPromise) {
    post({ type: "loading" });
    pyodideReadyPromise = loadPyodide({
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`,
    })
      .then((instance) => {
        pyodideInstance = instance;

        if (interruptBuffer) {
          instance.setInterruptBuffer(interruptBuffer);
        }

        instance.setStdout({
          raw: (charCode) => {
            if (!activeRequestId) {
              return;
            }

            post({
              type: "stdout",
              chunk: String.fromCharCode(charCode),
              requestId: activeRequestId,
            });
          },
        });

        instance.setStderr({
          raw: (charCode) => {
            if (!activeRequestId) {
              return;
            }

            post({
              type: "stderr",
              chunk: String.fromCharCode(charCode),
              requestId: activeRequestId,
            });
          },
        });

        instance.setStdin({
          read: readStdin,
        });

        post({ type: "ready" });
        return instance;
      })
      .catch((error) => {
        pyodideReadyPromise = null;
        throw error;
      });
  }

  return pyodideReadyPromise;
}

async function runCode(code: string, requestId: string) {
  activeRequestId = requestId;
  pendingBytes = null;
  pendingOffset = 0;
  awaitingInput = false;
  if (interruptBuffer) {
    Atomics.store(interruptBuffer, 0, 0);
  }
  let pyodide: PyodideInterface | null = null;

  try {
    pyodide = await ensurePyodide();
    post({
      type: "execution_started",
      requestId,
    });

    pyodide.globals.set("__user_code", code);
    await pyodide.runPythonAsync(`
globals_dict = {"__name__": "__main__"}
compiled = compile(__user_code, "<editor>", "exec")
exec(compiled, globals_dict, globals_dict)
`);

    post({
      type: "success",
      requestId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Python runtime error.";

    if (message.includes("KeyboardInterrupt")) {
      post({
        type: "interrupted",
        requestId,
      });
    } else {
      post({
        type: "error",
        requestId,
        error: message,
      });
    }
  } finally {
    pyodide?.globals.delete("__user_code");
    activeRequestId = null;
    pendingBytes = null;
    pendingOffset = 0;
    awaitingInput = false;
    if (interruptBuffer) {
      Atomics.store(interruptBuffer, 0, 0);
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    stdinMeta = new Int32Array(message.stdinBuffer, 0, 2);
    stdinBytes = new Uint8Array(message.stdinBuffer, 8);
    interruptBuffer = new Int32Array(message.interruptBuffer);
    pyodideInstance?.setInterruptBuffer(interruptBuffer);
    return;
  }

  if (message.type === "run") {
    void runCode(message.code, message.requestId);
    return;
  }

  if (message.type === "stop" && activeRequestId === message.requestId && interruptBuffer) {
    Atomics.store(interruptBuffer, 0, INTERRUPT_SIGNAL);
  }
};
