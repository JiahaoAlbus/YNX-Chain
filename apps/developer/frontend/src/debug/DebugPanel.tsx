import { Bug, CircleStop, Play, StepForward, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { runtimeHealth } from "../runtime/client";

type DapMessage = {
  seq?: number;
  type: string;
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  body?: any;
};
type Frame = {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { path?: string; name?: string };
};
type Variable = {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
};

export function DebugPanel({
  projectId,
  runtimeId,
  activePath,
  breakpoints,
  onStoppedLine,
}: {
  projectId: string;
  runtimeId?: string;
  activePath: string;
  breakpoints: number[];
  onStoppedLine: (line?: number) => void;
}) {
  const socket = useRef<WebSocket | null>(null),
    sequence = useRef(1),
    thread = useRef<number | undefined>(undefined),
    [state, setState] = useState<
      "idle" | "connecting" | "running" | "stopped" | "ended" | "error"
    >("idle"),
    [frames, setFrames] = useState<Frame[]>([]),
    [variables, setVariables] = useState<Variable[]>([]),
    [log, setLog] = useState("");
  const supported = /\.(c|cpp|cc|cxx|py|rs|go|js|mjs|cjs)$/i.test(activePath),
    python = /\.py$/i.test(activePath),
    rust = /\.rs$/i.test(activePath),
    go = /\.go$/i.test(activePath),
    node = /\.(js|mjs|cjs)$/i.test(activePath),
    containerRequired = python || rust || go || node;
  useEffect(
    () => () => {
      socket.current?.close();
      socket.current = null;
    },
    [],
  );
  const request = (command: string, args: Record<string, unknown> = {}) => {
    const id = sequence.current++;
    socket.current?.send(
      JSON.stringify({
        type: "dap",
        message: { seq: id, type: "request", command, arguments: args },
      }),
    );
    return id;
  };
  const start = async () => {
    if (!supported || (containerRequired && !runtimeId)) return;
    socket.current?.close();
    setState("connecting");
    setFrames([]);
    setVariables([]);
    setLog(
      python
        ? "Starting Python inside the isolated cloud debug workspace…\n"
        : rust
          ? "Building Rust inside the isolated cloud debug workspace…\n"
          : go
            ? "Starting Delve inside the isolated cloud debug workspace…\n"
            : node
              ? "Starting js-debug inside the isolated cloud debug workspace…\n"
              : "Building a debug binary inside the isolated workspace…\n",
    );
    onStoppedLine();
    try {
      await runtimeHealth();
      const scheme = location.protocol === "https:" ? "wss" : "ws",
        ws = new WebSocket(
          `${scheme}://${location.host}/runtime/debug?projectId=${encodeURIComponent(projectId)}&activePath=${encodeURIComponent(activePath)}${runtimeId ? `&runtimeId=${encodeURIComponent(runtimeId)}` : ""}`,
          "ynx-code-dap-v1",
        );
      socket.current = ws;
      ws.addEventListener("message", (event) =>
        handle(JSON.parse(String(event.data))),
      );
      ws.addEventListener("close", () =>
        setState((current) => (current === "error" ? current : "ended")),
      );
      ws.addEventListener("error", () => {
        setState("error");
        setLog((value) => `${value}Debug transport failed.\n`);
      });
    } catch (error) {
      setState("error");
      setLog(
        (value) =>
          `${value}${error instanceof Error ? error.message : "Debug start failed."}\n`,
      );
    }
  };
  const handle = (envelope: any) => {
    if (envelope.type === "ready") {
      setLog(
        (value) =>
          `${value}${envelope.adapter} ready · ${envelope.sandbox.kind} · network disabled\n`,
      );
      request("initialize", {
        clientID: "ynx-code",
        clientName: "YNX Code",
        adapterID:
          envelope.language === "python"
            ? "python"
            : envelope.language === "go"
              ? "go"
              : envelope.language === "node"
                ? "node"
                : "lldb",
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: "path",
        supportsVariableType: true,
      });
      return;
    }
    if (envelope.type === "error") {
      setState("error");
      setLog((value) => `${value}${envelope.message}\n`);
      return;
    }
    if (envelope.type !== "dap") return;
    const message: DapMessage = envelope.message;
    if (
      message.type === "response" &&
      message.command === "initialize" &&
      message.success
    ) {
      request("launch", { args: [], stopOnEntry: breakpoints.length === 0 });
      return;
    }
    if (message.type === "event" && message.event === "initialized") {
      request("setBreakpoints", {
        source: { path: activePath },
        breakpoints: breakpoints.map((line) => ({ line })),
      });
      return;
    }
    if (
      message.type === "response" &&
      message.command === "setBreakpoints" &&
      message.success
    ) {
      request("configurationDone");
      return;
    }
    if (
      message.type === "response" &&
      message.command === "configurationDone" &&
      message.success
    ) {
      setState("running");
      return;
    }
    if (message.type === "event" && message.event === "stopped") {
      setState("stopped");
      thread.current = message.body?.threadId;
      request("threads");
      return;
    }
    if (
      message.type === "response" &&
      message.command === "threads" &&
      message.success
    ) {
      const id = thread.current || message.body?.threads?.[0]?.id;
      if (id) {
        thread.current = id;
        request("stackTrace", { threadId: id, startFrame: 0, levels: 50 });
      }
      return;
    }
    if (
      message.type === "response" &&
      message.command === "stackTrace" &&
      message.success
    ) {
      const next: Frame[] = message.body?.stackFrames || [];
      setFrames(next);
      onStoppedLine(next[0]?.line);
      if (next[0]) request("scopes", { frameId: next[0].id });
      return;
    }
    if (
      message.type === "response" &&
      message.command === "scopes" &&
      message.success
    ) {
      setVariables([]);
      for (const scope of message.body?.scopes || [])
        if (scope.variablesReference)
          request("variables", {
            variablesReference: scope.variablesReference,
            start: 0,
            count: 200,
          });
      return;
    }
    if (
      message.type === "response" &&
      message.command === "variables" &&
      message.success
    ) {
      setVariables((current) =>
        [...current, ...(message.body?.variables || [])].slice(0, 500),
      );
      return;
    }
    if (message.type === "event" && message.event === "output")
      setLog((value) => `${value}${message.body?.output || ""}`);
    if (
      message.type === "event" &&
      (message.event === "terminated" || message.event === "exited")
    ) {
      setState("ended");
      onStoppedLine();
    }
  };
  const control = (command: string) => {
    if (command === "disconnect") {
      request(command, { terminateDebuggee: true });
      socket.current?.close();
      setState("ended");
      onStoppedLine();
      return;
    }
    const threadId = thread.current;
    if (!threadId) return;
    request(command, { threadId });
    setState("running");
    onStoppedLine();
  };
  return (
    <section className="debug-panel">
      <header>
        <strong>RUN AND DEBUG</strong>
        <span className={`debug-state ${state}`}>{state}</span>
      </header>
      <div className="debug-controls">
        <button
          onClick={start}
          disabled={
            !supported ||
            (containerRequired && !runtimeId) ||
            state === "connecting" ||
            state === "running"
          }
          title="Start debugging"
        >
          <Play />
        </button>
        <button
          onClick={() => control("continue")}
          disabled={state !== "stopped"}
          title="Continue"
        >
          <Play />
        </button>
        <button
          onClick={() => control("next")}
          disabled={state !== "stopped"}
          title="Step over"
        >
          <StepForward />
        </button>
        <button
          onClick={() => control("stepIn")}
          disabled={state !== "stopped"}
          title="Step into"
        >
          <Undo2 />
        </button>
        <button
          onClick={() => control("disconnect")}
          disabled={state === "idle" || state === "ended"}
          title="Stop"
        >
          <CircleStop />
        </button>
      </div>
      {!supported && (
        <div className="honest-boundary">
          Reviewed DAP adapters support Node.js via js-debug, Python via
          debugpy, Go via Delve and Rust/C/C++ via LLDB. Select a .js, .mjs,
          .cjs, .py, .go, .rs, .c, .cpp, .cc or .cxx file.
        </div>
      )}
      {containerRequired && !runtimeId && (
        <div className="honest-boundary">
          Select an isolated LXD cloud runtime before starting Node.js, Python,
          Go or Rust debug. Node.js uses a per-session Unix socket and Python/Go
          use container loopback internally; no adapter gets an external network
          device.
        </div>
      )}
      <DebugSection title={`BREAKPOINTS (${breakpoints.length})`}>
        {breakpoints.length ? (
          breakpoints.map((line) => (
            <div key={line} className="debug-row">
              <Bug /> {activePath}:{line}
            </div>
          ))
        ) : (
          <small>
            Click the editor glyph margin to add a breakpoint. With none set,
            LLDB stops on entry.
          </small>
        )}
      </DebugSection>
      <DebugSection title="CALL STACK">
        {frames.length ? (
          frames.map((frame) => (
            <div key={frame.id} className="debug-row">
              <strong>{frame.name}</strong>
              <span>
                {frame.source?.name || frame.source?.path?.split("/").pop()}:
                {frame.line}
              </span>
            </div>
          ))
        ) : (
          <small>No paused stack.</small>
        )}
      </DebugSection>
      <DebugSection title="VARIABLES">
        {variables.length ? (
          variables.map((variable, index) => (
            <div key={`${variable.name}:${index}`} className="debug-variable">
              <strong>{variable.name}</strong>
              <span>{variable.value}</span>
              <em>{variable.type}</em>
            </div>
          ))
        ) : (
          <small>No paused variables.</small>
        )}
      </DebugSection>
      {log && <pre className="debug-log">{log}</pre>}
    </section>
  );
}
function DebugSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="debug-section">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
