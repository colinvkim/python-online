import { loadPyodide, version as pyodideVersion } from "pyodide";
import type { PyodideInterface } from "pyodide";
import type { WorkerInboundMessage, WorkerOutboundMessage } from "@/lib/runtime";

let pyodideReadyPromise: Promise<PyodideInterface> | null = null;
let stdinMeta: Int32Array | null = null;
let stdinBytes: Uint8Array | null = null;
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
    Atomics.wait(meta, 0, 0, 100);
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
        instance.setStdout({
          batched: (chunk) => {
            if (!activeRequestId) {
              return;
            }

            post({
              type: "stdout",
              chunk,
              requestId: activeRequestId,
            });
          },
        });

        instance.setStderr({
          batched: (chunk) => {
            if (!activeRequestId) {
              return;
            }

            post({
              type: "stderr",
              chunk,
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

    post({
      type: "error",
      requestId,
      error: message,
    });
  } finally {
    pyodide?.globals.delete("__user_code");
    activeRequestId = null;
    pendingBytes = null;
    pendingOffset = 0;
    awaitingInput = false;
  }
}

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    stdinMeta = new Int32Array(message.stdinBuffer, 0, 2);
    stdinBytes = new Uint8Array(message.stdinBuffer, 8);
    return;
  }

  if (message.type === "run") {
    void runCode(message.code, message.requestId);
  }
};
