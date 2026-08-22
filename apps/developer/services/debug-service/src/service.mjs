import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  DEFAULT_DEBUGPY_ROOT = fileURLToPath(
    new URL("../../../.ynx-debugpy", import.meta.url),
  ),
  execFileAsync = promisify(execFile),
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
      activePath = url.searchParams.get("activePath"),
      runtimeId = url.searchParams.get("runtimeId"),
      language = debugLanguage(activePath);
    if (
      !owner ||
      !validId(projectId) ||
      !safePath(activePath) ||
      !language ||
      (containerDebugLanguage(language) &&
        options.containerDebugBroker &&
        !validRuntimeId(runtimeId)) ||
      !sameOrigin(request) ||
      request.headers["sec-websocket-protocol"] !== PROTOCOL ||
      (!sandbox.ready &&
        !(containerDebugLanguage(language) && options.containerDebugBroker)) ||
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
        runtimeId,
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
  async function start(websocket, { owner, projectId, activePath, runtimeId }) {
    const snapshot = workspaceStore.get(owner, projectId);
    if (!snapshot || !Object.hasOwn(snapshot.files, activePath))
      throw fault(
        "Workspace or active source was not found.",
        "workspace_not_found",
      );
    const language = debugLanguage(activePath);
    if (containerDebugLanguage(language) && options.containerDebugBroker) {
      const handle =
        await options.containerDebugBroker.openContainerDebugProcess({
          owner,
          runtimeId,
          projectId,
          files: snapshot.files,
          activePath,
          language,
        });
      attach(websocket, {
        owner,
        projectId,
        activePath,
        language,
        workspace: null,
        program: handle.program,
        visibleRoot: handle.visibleRoot,
        child: handle.child,
        cleanup: handle.cleanup,
        adapterId: handle.adapterId,
        sandboxKind: handle.sandbox.kind,
      });
      return;
    }
    if (language === "rust")
      throw fault(
        "Rust debugging requires a selected reviewed LXD runtime.",
        "debug_runtime_required",
      );
    const toolchain = await resolveToolchain(language, options);
    if (!toolchain)
      throw fault(
        language === "python"
          ? "The reviewed Python debugpy adapter is unavailable."
          : "The reviewed C/C++ compiler or LLDB DAP adapter is unavailable.",
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
      program =
        language === "python"
          ? source
          : join(workspace, ".ynx-build", "debug-program"),
      visibleRoot =
        sandbox.kind === "macos-sandbox-exec" ? workspace : "/workspace";
    if (language !== "python") {
      const platformArgs = await compilerPlatformArgs();
      const compileLaunch = createLaunch({
          sandbox,
          workspace,
          command: toolchain.compiler,
          args: [
            language === "c" ? "-std=c17" : "-std=c++20",
            ...platformArgs,
            "-g",
            "-O0",
            "-fno-omit-frame-pointer",
            source,
            "-o",
            program,
          ],
        }),
        compiled = await run(compileLaunch, 30_000);
      if (compiled.code !== 0) {
        await rm(workspace, { recursive: true, force: true });
        throw Object.assign(
          fault("Debug build failed.", "debug_build_failed"),
          {
            publicMessage: `Debug build failed:\n${compiled.output.slice(0, 32_000)}`,
          },
        );
      }
    }
    const adapterLaunch = createLaunch({
        sandbox,
        workspace,
        command: toolchain.adapter,
        args: toolchain.adapterArgs,
        writeWorkspace: true,
        readOnlyBinds: toolchain.readOnlyBinds,
      }),
      child = spawn(adapterLaunch.command, adapterLaunch.args, {
        cwd: adapterLaunch.cwd,
        env: adapterLaunch.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    attach(websocket, {
      sessionId,
      owner,
      projectId,
      activePath,
      language,
      workspace,
      program:
        language === "python"
          ? `${visibleRoot}/${activePath}`
          : `${visibleRoot}/.ynx-build/debug-program`,
      visibleRoot,
      child,
      cleanup: null,
      adapterId: toolchain.adapterId,
      sandboxKind: sandbox.kind,
    });
  }
  function attach(websocket, value) {
    const state = {
      sessionId: value.sessionId || randomUUID(),
      ...value,
      websocket,
      buffer: Buffer.alloc(0),
      closed: false,
      lastActivity: Date.now(),
    };
    sessions.set(state.sessionId, state);
    send(websocket, {
      type: "ready",
      protocolVersion: PROTOCOL,
      sessionId: state.sessionId,
      adapter: state.adapterId,
      language: state.language,
      sandbox: { kind: state.sandboxKind, network: false },
      program: state.program,
    });
    state.child.stdout.on("data", (chunk) => parse(state, chunk));
    state.child.stderr.on("data", (chunk) =>
      send(websocket, {
        type: "adapter-stderr",
        data: String(chunk).slice(0, 32_000),
      }),
    );
    state.child.on("close", (code) =>
      finish(state, { code: code ?? 0, reason: "adapter_exit" }),
    );
    state.child.on("error", () =>
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
    if (next.command === "launch") {
      const shared = {
        program: state.program,
        cwd: state.visibleRoot,
        args: validArgs(next.arguments?.args),
        stopOnEntry: Boolean(next.arguments?.stopOnEntry),
      };
      next.arguments =
        state.language === "python"
          ? {
              ...shared,
              justMyCode: true,
              subProcess: false,
              console: "internalConsole",
            }
          : state.language === "go"
            ? {
                ...shared,
                mode: "debug",
                showGlobalVariables: false,
                showRegisters: false,
                hideSystemGoroutines: true,
              }
            : state.language === "node"
              ? {
                  ...shared,
                  type: "pwa-node",
                  request: "launch",
                  name: "YNX Node Debug",
                  runtimeExecutable:
                    options.containerNodePath || "/opt/node-v22.23.1/bin/node",
                  runtimeArgs: [],
                  console: "internalConsole",
                  outputCapture: "std",
                  autoAttachChildProcesses: false,
                  sourceMaps: true,
                  // The standalone server creates a child DAP session. Pause
                  // that target until the reviewed bridge reapplies the
                  // already-approved source breakpoints to the child session.
                  stopOnEntry: true,
                }
              : shared;
    }
    if (next.command === "setBreakpoints") {
      const path = next.arguments?.source?.path;
      if (!safePath(path))
        return send(state.websocket, {
          type: "error",
          code: "invalid_breakpoint_path",
          message: "Breakpoint source must be workspace-relative.",
        });
      next.arguments.source.path = `${state.visibleRoot}/${path}`;
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
    try {
      await state.cleanup?.();
    } catch {}
    if (state.workspace)
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
function debugLanguage(value) {
  const extension = extname(value).toLowerCase();
  if (extension === ".py") return "python";
  if (extension === ".rs") return "rust";
  if (extension === ".go") return "go";
  if ([".js", ".mjs", ".cjs"].includes(extension)) return "node";
  if (extension === ".c") return "c";
  if ([".cpp", ".cc", ".cxx"].includes(extension)) return "cpp";
  return null;
}
function containerDebugLanguage(language) {
  return (
    language === "python" ||
    language === "rust" ||
    language === "go" ||
    language === "node"
  );
}
async function resolveToolchain(language, options) {
  if (language === "python") {
    const root =
        options.pythonRoot ||
        process.env.YNX_CODE_DEBUGPY_ROOT ||
        DEFAULT_DEBUGPY_ROOT,
      executable =
        options.pythonPath ||
        join(
          root,
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        );
    try {
      await access(executable, fsConstants.X_OK);
    } catch {
      return null;
    }
    return {
      // Preserve the venv launcher path: resolving its Python symlink would
      // discard pyvenv.cfg and make the pinned debugpy package unreachable.
      adapter: executable,
      adapterArgs: ["-m", "debugpy.adapter"],
      adapterId: "debugpy",
      readOnlyBinds: [{ host: await realpath(root), guest: "/ynx-debugpy" }],
    };
  }
  const compiler =
      options.compilerPath ||
      (await resolveExecutable(
        language === "c" ? ["clang", "gcc"] : ["clang++", "g++"],
      )),
    adapter =
      options.adapterPath ||
      (await resolveExecutable(["lldb-dap-18", "lldb-dap", "lldb-vscode"]));
  return compiler && adapter
    ? {
        compiler,
        adapter,
        adapterArgs: [],
        adapterId: "lldb-dap",
        readOnlyBinds: [],
      }
    : null;
}
async function compilerPlatformArgs() {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/xcrun",
      ["--sdk", "macosx", "--show-sdk-path"],
      { timeout: 5_000, maxBuffer: 16 * 1024 },
    );
    const sdk = stdout.trim();
    if (
      !/^\/Library\/Developer\/[A-Za-z0-9_./+-]+\.sdk$/.test(sdk) ||
      sdk.includes("..")
    )
      return [];
    await access(sdk);
    return ["-isysroot", sdk];
  } catch {
    return [];
  }
}
function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}
function validRuntimeId(value) {
  return typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
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
