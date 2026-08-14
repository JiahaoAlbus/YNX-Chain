import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import {
  detectSandbox,
  resolveExecutable,
  sandboxLaunch,
} from "../../workspace-agent/src/sandbox.mjs";
import {
  materializeSnapshot,
  safeWorkspaceJoin,
} from "../../workspace-agent/src/workspace-files.mjs";

const PROTOCOL = "ynx-code-dap-v1",
  MAX_MESSAGE = 1024 * 1024,
  ALLOWED = new Set([
    "initialize",
    "launch",
    "setBreakpoints",
    "setExceptionBreakpoints",
    "configurationDone",
    "threads",
    "stackTrace",
    "scopes",
    "variables",
    "continue",
    "next",
    "stepIn",
    "stepOut",
    "pause",
    "evaluate",
    "disconnect",
    "terminate",
  ]);

export function createDebugService(options) {
  const { workspaceStore, ownerForRequest } = options,
    sandbox = detectSandbox(options),
    createLaunch = options.createLaunch || sandboxLaunch,
    root = options.root || join(tmpdir(), "ynx-code-debug"),
    maxSessions = bounded(options.maxSessions, 8, 1, 64),
    maxOwnerSessions = bounded(options.maxOwnerSessions, 2, 1, 8),
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE }),
    sessions = new Map();
  function handleUpgrade(request, socket, head) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (url.pathname !== "/runtime/debug") return false;
    const owner = ownerForRequest(request),
      projectId = url.searchParams.get("projectId"),
      activePath = url.searchParams.get("activePath");
    if (
      !owner ||
      !validId(projectId) ||
      !safePath(activePath) ||
      !cFamily(activePath) ||
      !sameOrigin(request) ||
      request.headers["sec-websocket-protocol"] !== PROTOCOL ||
      !sandbox.ready ||
      sessions.size >= maxSessions ||
      [...sessions.values()].filter((value) => value.owner === owner).length >=
        maxOwnerSessions
    ) {
      reject(socket);
      return true;
    }
    wss.handleUpgrade(request, socket, head, (websocket) =>
      wss.emit("connection", websocket, request, {
        owner,
        projectId,
        activePath,
      }),
    );
    return true;
  }
  wss.on("connection", (websocket, _request, identity) =>
    start(websocket, identity).catch((error) => {
      send(websocket, {
        type: "error",
        code: error.code || "debug_start_failed",
        message:
          error.publicMessage ||
          error.message ||
          "Debug session could not start.",
      });
      websocket.close(1011, "Debug start failed");
    }),
  );
  async function start(websocket, { owner, projectId, activePath }) {
    const snapshot = workspaceStore.get(owner, projectId);
    if (!snapshot || !Object.hasOwn(snapshot.files, activePath))
      throw fault(
        "Workspace or active source was not found.",
        "workspace_not_found",
      );
    const language = extname(activePath).toLowerCase() === ".c" ? "c" : "cpp",
      compiler =
        options.compilerPath || (await resolveExecutable(language === "c" ? ["clang", "gcc"] : ["clang++", "g++"])),
      adapter =
        options.adapterPath ||
        (await resolveExecutable(["lldb-dap-18", "lldb-dap", "lldb-vscode"]));
    if (!compiler || !adapter)
      throw fault(
        "The reviewed C/C++ compiler or LLDB DAP adapter is unavailable.",
        "debug_adapter_unavailable",
      );
    const sessionId = randomUUID(),
      workspace = await realpath(
        await mkdtemp(join(await ensureRoot(root), "debug-")),
      );
    try {
      await mkdir(join(workspace, ".tmp"), { mode: 0o700 });
      await mkdir(join(workspace, ".ynx-build"), { mode: 0o700 });
      await materializeSnapshot(workspace, snapshot);
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
    const source = safeWorkspaceJoin(workspace, activePath),
      program = join(workspace, ".ynx-build", "debug-program"),
      compileLaunch = createLaunch({
        sandbox,
        workspace,
        command: compiler,
        args: [
          language === "c" ? "-std=c17" : "-std=c++20",
          "-g",
          "-O0",
          "-fno-omit-frame-pointer",
          source,
          "-o",
          program,
        ],
      });
    const compiled = await run(compileLaunch, 30_000);
    if (compiled.code !== 0) {
      await rm(workspace, { recursive: true, force: true });
      throw Object.assign(fault("Debug build failed.", "debug_build_failed"), {
        publicMessage: `Debug build failed:\n${compiled.output.slice(0, 32_000)}`,
      });
    }
    const adapterLaunch = createLaunch({
        sandbox,
        workspace,
        command: adapter,
        args: [],
        writeWorkspace: true,
      }),
      child = spawn(adapterLaunch.command, adapterLaunch.args, {
        cwd: adapterLaunch.cwd,
        env: adapterLaunch.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      }),
      state = {
        sessionId,
        owner,
        projectId,
        activePath,
        workspace,
        program,
        websocket,
        child,
        buffer: Buffer.alloc(0),
        closed: false,
        lastActivity: Date.now(),
      };
    sessions.set(sessionId, state);
    send(websocket, {
      type: "ready",
      protocolVersion: PROTOCOL,
      sessionId,
      adapter: "lldb-dap",
      language,
      sandbox: { kind: sandbox.kind, network: false },
      program: "/workspace/.ynx-build/debug-program",
    });
    child.stdout.on("data", (chunk) => parse(state, chunk));
    child.stderr.on("data", (chunk) =>
      send(websocket, {
        type: "adapter-stderr",
        data: String(chunk).slice(0, 32_000),
      }),
    );
    child.on("close", (code) =>
      finish(state, { code: code ?? 0, reason: "adapter_exit" }),
    );
    child.on("error", () =>
      finish(state, { code: 1, reason: "adapter_error" }),
    );
    websocket.on("message", (raw) => receive(state, raw));
    websocket.on("close", () =>
      finish(state, { code: 130, reason: "client_close" }),
    );
    websocket.on("error", () =>
      finish(state, { code: 130, reason: "client_error" }),
    );
    state.timer = setInterval(() => {
      if (Date.now() - state.lastActivity > 30 * 60_000)
        finish(state, { code: 124, reason: "idle_timeout" });
    }, 30_000);
  }
  function receive(state, raw) {
    state.lastActivity = Date.now();
    let envelope;
    try {
      envelope = JSON.parse(String(raw));
    } catch {
      return send(state.websocket, {
        type: "error",
        code: "invalid_dap_message",
        message: "DAP envelope must be JSON.",
      });
    }
    const message = envelope?.type === "dap" ? envelope.message : null;
    if (
      !message ||
      message.type !== "request" ||
      !Number.isInteger(message.seq) ||
      !ALLOWED.has(message.command)
    )
      return send(state.websocket, {
        type: "error",
        code: "unapproved_dap_request",
        message: "DAP request is not approved.",
      });
    const next = structuredClone(message);
    if (next.command === "launch")
      next.arguments = {
        program: "/workspace/.ynx-build/debug-program",
        cwd: "/workspace",
        args: validArgs(next.arguments?.args),
        stopOnEntry: Boolean(next.arguments?.stopOnEntry),
      };
    if (next.command === "setBreakpoints") {
      const path = next.arguments?.source?.path;
      if (!safePath(path))
        return send(state.websocket, {
          type: "error",
          code: "invalid_breakpoint_path",
          message: "Breakpoint source must be workspace-relative.",
        });
      next.arguments.source.path = `/workspace/${path}`;
      next.arguments.breakpoints = (next.arguments.breakpoints || [])
        .slice(0, 256)
        .filter(
          (value) =>
            Number.isInteger(value.line) &&
            value.line > 0 &&
            value.line < 10_000,
        );
    }
    writeDap(state.child.stdin, next);
  }
  function parse(state, chunk) {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    while (state.buffer.length) {
      const split = state.buffer.indexOf("\r\n\r\n");
      if (split < 0) {
        if (state.buffer.length > MAX_MESSAGE)
          finish(state, { code: 1, reason: "adapter_message_too_large" });
        return;
      }
      const header = state.buffer.subarray(0, split).toString("ascii"),
        length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isInteger(length) || length < 0 || length > MAX_MESSAGE) {
        finish(state, { code: 1, reason: "invalid_adapter_frame" });
        return;
      }
      const end = split + 4 + length;
      if (state.buffer.length < end) return;
      const body = state.buffer.subarray(split + 4, end).toString("utf8");
      state.buffer = state.buffer.subarray(end);
      try {
        send(state.websocket, { type: "dap", message: JSON.parse(body) });
      } catch {
        finish(state, { code: 1, reason: "invalid_adapter_json" });
        return;
      }
    }
  }
  async function finish(state, result) {
    if (state.closed) return;
    state.closed = true;
    clearInterval(state.timer);
    sessions.delete(state.sessionId);
    try {
      if (state.child.pid && process.platform !== "win32")
        process.kill(-state.child.pid, "SIGKILL");
      else state.child.kill("SIGKILL");
    } catch {}
    send(state.websocket, { type: "exit", ...result });
    try {
      state.websocket.close(1000, "Debug session ended");
    } catch {}
    await rm(state.workspace, { recursive: true, force: true });
  }
  async function close() {
    for (const state of [...sessions.values()])
      await finish(state, { code: 130, reason: "service_shutdown" });
    wss.close();
  }
  return {
    handleUpgrade,
    close,
    status: () => ({
      active: sessions.size,
      maxSessions,
      maxOwnerSessions,
      sandbox: sandbox.kind,
      sandboxReady: sandbox.ready,
    }),
  };
}

function writeDap(stream, message) {
  const body = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
function run(launch, timeout) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        if (output.length < MAX_MESSAGE) output += String(chunk);
      });
    const timer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    }, timeout);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 124, output });
    });
  });
}
async function ensureRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}
function validArgs(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === "string" && item.length <= 1024)
        .slice(0, 64)
    : [];
}
function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => !part || part === "." || part === "..") &&
    /^[A-Za-z0-9_./ +@-]+$/.test(value)
  );
}
function cFamily(value) {
  return [".c", ".cpp", ".cc", ".cxx"].includes(extname(value).toLowerCase());
}
function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}
function sameOrigin(request) {
  try {
    const origin = new URL(String(request.headers.origin || "")),
      host = String(
        request.headers["x-forwarded-host"] || request.headers.host || "",
      )
        .split(",")[0]
        .trim();
    return (
      origin.host === host &&
      (request.headers["sec-fetch-site"] === undefined ||
        request.headers["sec-fetch-site"] === "same-origin")
    );
  } catch {
    return false;
  }
}
function reject(socket) {
  socket.write(
    "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
  );
  socket.destroy();
}
function send(websocket, value) {
  if (websocket.readyState === 1) websocket.send(JSON.stringify(value));
}
function bounded(value, fallback, min, max) {
  const number = Number(value || fallback);
  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : fallback;
}
function fault(message, code) {
  return Object.assign(new Error(message), { code });
}
