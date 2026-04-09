export const STDIN_CAPACITY_BYTES = 8192;

export type RuntimeStatus =
  | "standby"
  | "loading"
  | "ready"
  | "running"
  | "waiting-input"
  | "stopped"
  | "error";

export type WorkerInboundMessage =
  | {
      type: "init";
      stdinBuffer: SharedArrayBuffer;
    }
  | {
      type: "run";
      code: string;
      requestId: string;
    };

export type WorkerOutboundMessage =
  | {
      type: "loading";
    }
  | {
      type: "ready";
    }
  | {
      type: "execution_started";
      requestId: string;
    }
  | {
      type: "stdout";
      chunk: string;
      requestId: string;
    }
  | {
      type: "stderr";
      chunk: string;
      requestId: string;
    }
  | {
      type: "input_request";
      requestId: string;
    }
  | {
      type: "success";
      requestId: string;
    }
  | {
      type: "error";
      requestId: string;
      error: string;
    };
