import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { spawn as spawnPty } from "node-pty";
import { WebSocketServer } from "ws";
import { detectSandbox, resolveExecutable, sandboxLaunch } from "../../workspace-agent/src/sandbox.mjs";
import { materializeSnapshot, readTextSnapshot } from "../../workspace-agent/src/workspace-files.mjs";

const PROTOCOL = "ynx-code-terminal-v1",
  MAX_INPUT = 64 * 1024,
  MAX_REPLAY = 256 * 1024,
  MAX_FILES = 256,
  MAX_BYTES = 2 * 1024 * 1024;

export function createTerminalService(options) {
  const { workspaceStore, ownerForRequest, containerTerminalBroker, environmentService } = options,
    sandbox = detectSandbox(options),
    root = options.root || join(tmpdir(), "ynx-code-terminals"),
    maxSessions = bounded(options.maxSessions, 16, 1, 256),
    maxOwnerSessions = bounded(options.maxOwnerSessions, 2, 1, 8),
    idleMs = bounded(options.idleMs, 15 * 60_000, 10_000, 60 * 60_000),
    hardMs = bounded(options.hardMs, 60 * 60_000, 30_000, 4 * 60 * 60_000),
    clock = options.clock || {
      now: () => Date.now(),
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    },
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT }),
    sessions = new Map();
  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`),
      stopMatch = url.pathname.match(/^\/runtime\/terminals\/([0-9a-f-]{36})$/);
    if (url.pathname !== "/runtime/terminals" && !stopMatch) return false;
    const owner = ownerForRequest(request);
    if (!owner)
      return json(response, 401, {
        error: "A signed workspace session is required.",
        code: "workspace_session_required",
      });
    if (url.pathname === "/runtime/terminals" && request.method === "GET") {
      const projectId = url.searchParams.get("projectId");
      if (projectId !== null && !/^[A-Za-z0-9_-]{1,160}$/.test(projectId))
        return json(response, 400, {
          error: "Invalid project ID.",
          code: "invalid_project_id",
        });
      const terminals = [...sessions.values()].filter((state) => state.owner === owner && (!projectId || state.projectId === projectId)).map(publicSession);
      return json(response, 200, { protocolVersion: PROTOCOL, terminals });
    }
    if (stopMatch && request.method === "DELETE") {
      const state = sessions.get(stopMatch[1]);
      if (!state || state.owner !== owner)
        return json(response, 404, {
          error: "Terminal session was not found.",
          code: "terminal_session_not_found",
        });
      await finish(state, { exitCode: 130, signal: 15, reason: "api_stop" });
      return json(response, 200, {
        protocolVersion: PROTOCOL,
        stopped: stopMatch[1],
      });
    }
    return json(response, 405, {
      error: "Method not allowed.",
      code: "method_not_allowed",
    });
  }
  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/runtime/terminals") return false;
    const owner = ownerForRequest(request),
      projectId = url.searchParams.get("projectId"),
      runtimeId = url.searchParams.get("runtimeId"),
      sessionId = url.searchParams.get("sessionId"),
      existing = sessionId ? sessions.get(sessionId) : undefined,
      reconnecting = Boolean(existing && existing.owner === owner && existing.projectId === projectId && existing.runtimeId === runtimeId);
    if (!owner || !/^[A-Za-z0-9_-]{1,160}$/.test(projectId || "") || (runtimeId !== null && !/^(?:ssh-)?[a-f0-9]{24}$/.test(runtimeId)) || (sessionId !== null && !/^[0-9a-f-]{36}$/.test(sessionId)) || (sessionId !== null && !reconnecting) || !sameOrigin(request) || request.headers["sec-websocket-protocol"] !== PROTOCOL || (!reconnecting && runtimeId ? !containerTerminalBroker : !reconnecting && !sandbox.ready) || (!reconnecting && sessions.size >= maxSessions) || (!reconnecting && [...sessions.values()].filter((value) => value.owner === owner).length >= maxOwnerSessions)) {
      reject(socket);
      return true;
    }
    wss.handleUpgrade(request, socket, head, (websocket) =>
      wss.emit("connection", websocket, request, {
        owner,
        projectId,
        runtimeId,
        sessionId,
      }),
    );
    return true;
  }
  wss.on("connection", (websocket, _request, identity) =>
    start(websocket, identity).catch((error) => {
      send(websocket, {
        type: "error",
        code: error.code || "terminal_start_failed",
        message: error.message || "Terminal could not start.",
      });
      websocket.close(1011, "Terminal start failed");
    }),
  );
  async function start(websocket, { owner, projectId, runtimeId, sessionId: requestedSessionId }) {
    if (requestedSessionId) {
      const state = sessions.get(requestedSessionId);
      if (!state) throw fault("Terminal session was not found.", "terminal_session_not_found");
      try {
        state.websocket?.close(4001, "Terminal reattached");
      } catch {}
      state.websocket = null;
      attach(state, websocket, true);
      return;
    }
    const snapshot = workspaceStore.get(owner, projectId);
    if (!snapshot) throw fault("Workspace was not found.", "workspace_not_found");
    const sessionId = randomUUID(),
      sessionRoot = await mkdtemp(join(await ensureRoot(root), "terminal-")),
      workspace = await realpath(sessionRoot);
    await mkdir(join(workspace, ".tmp"), { mode: 0o700 });
    await mkdir(join(workspace, ".ynx-build"), { mode: 0o700 });
    let remote;
    try {
      const resolvedEnvironment = environmentService ? await environmentService.resolve(owner, projectId) : { revision: 0, environment: {} };
      if (runtimeId)
        remote = await containerTerminalBroker.openTerminal({
          owner,
          runtimeId,
          projectId,
          snapshot,
          environment: resolvedEnvironment.environment,
        });
      else {
        await materializeSnapshot(workspace, snapshot);
      }
      const shell = remote ? null : await resolveExecutable(process.platform === "darwin" ? ["zsh", "bash", "sh"] : ["bash", "sh"]);
      if (!remote && !shell) throw fault("No approved shell is installed.", "shell_unavailable");
      await ensurePtyHelper();
      const launch =
          remote?.launch ||
          sandboxLaunch({
            sandbox,
            workspace,
            command: shell,
            args: ["-l"],
            writeWorkspace: true,
          }),
        terminal = spawnPty(launch.command, launch.args, {
          name: "xterm-256color",
          cols: 100,
          rows: 28,
          cwd: launch.cwd,
          env: {
            ...launch.env,
            ...(!remote ? resolvedEnvironment.environment : {}),
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });
      const state = {
        owner,
        projectId,
        runtimeId,
        sessionId,
        workspace,
        snapshot,
        remote,
        terminal,
        websocket,
        sequence: 0,
        startedAt: clock.now(),
        environmentRevision: resolvedEnvironment.revision,
        replay: [],
        replayBytes: 0,
        lastInput: clock.now(),
        closed: false,
      };
      sessions.set(sessionId, state);
      attach(state, websocket, false);
      terminal.onData((data) => {
        remember(state, data);
        send(state.websocket, {
          type: "output",
          sequence: ++state.sequence,
          data,
        });
      });
      terminal.onExit(({ exitCode, signal }) => finish(state, { exitCode, signal }));
      state.idle = clock.setInterval(
        () => {
          if (clock.now() - state.lastInput > idleMs)
            finish(state, {
              exitCode: 124,
              signal: 15,
              reason: "idle_timeout",
            });
        },
        Math.min(30_000, idleMs),
      );
      state.hard = clock.setTimeout(
        () =>
          finish(state, {
            exitCode: 124,
            signal: 15,
            reason: "lifetime_limit",
          }),
        hardMs,
      );
    } catch (error) {
      remote?.release();
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }
  function attach(state, websocket, reconnected) {
    state.websocket = websocket;
    state.lastInput = clock.now();
    send(websocket, {
      type: "ready",
      protocolVersion: PROTOCOL,
      sessionId: state.sessionId,
      reconnected,
      cwd: "/workspace",
      sandbox: state.remote?.launch.sandbox || {
        kind: sandbox.kind,
        network: false,
        writableRoot: "workspace",
      },
    });
    if (reconnected && state.replay.length)
      send(websocket, {
        type: "replay",
        sequence: state.sequence,
        data: state.replay.join(""),
      });
    websocket.on("message", (raw) => message(state, websocket, raw));
    websocket.on("close", () => detach(state, websocket));
    websocket.on("error", () => detach(state, websocket));
  }
  function detach(state, websocket) {
    if (!state.closed && state.websocket === websocket) {
      state.websocket = null;
      state.lastInput = clock.now();
    }
  }
  function message(state, websocket, raw) {
    if (state.closed || state.websocket !== websocket) return;
    state.lastInput = clock.now();
    let value;
    try {
      value = JSON.parse(String(raw));
    } catch {
      return send(state.websocket, {
        type: "error",
        code: "invalid_terminal_message",
        message: "Terminal messages must be JSON.",
      });
    }
    if (value.type === "input" && typeof value.data === "string" && Buffer.byteLength(value.data) <= MAX_INPUT) state.terminal.write(value.data);
    else if (value.type === "resize" && Number.isInteger(value.cols) && Number.isInteger(value.rows) && value.cols >= 20 && value.cols <= 400 && value.rows >= 5 && value.rows <= 200) state.terminal.resize(value.cols, value.rows);
    else if (value.type === "close") finish(state, { exitCode: 130, signal: 15, reason: "client_close" });
    else
      send(state.websocket, {
        type: "error",
        code: "invalid_terminal_message",
        message: "Unsupported terminal operation.",
      });
  }
  async function finish(state, result) {
    if (state.closed) return;
    state.closed = true;
    clock.clearInterval(state.idle);
    clock.clearTimeout(state.hard);
    sessions.delete(state.sessionId);
    try {
      state.terminal.kill();
    } catch {}
    try {
      const { revision: _revision, updatedAt: _updatedAt, replayed: _replayed, ...baseSnapshot } = state.snapshot,
        remotePayload = state.remote ? await state.remote.collect() : null,
        files = remotePayload?.files,
        open = files ? (state.snapshot.open || []).filter((path) => Object.hasOwn(files, path)) : undefined,
        payload = remotePayload
          ? {
              ...baseSnapshot,
              ...remotePayload,
              open,
              active: Object.hasOwn(files, state.snapshot.active) ? state.snapshot.active : open[0] || Object.keys(files)[0] || "",
            }
          : await readTextSnapshot(state.workspace, baseSnapshot);
      const saved = workspaceStore.put(state.owner, state.projectId, {
        expectedRevision: state.snapshot.revision,
        idempotencyKey: `terminal-${state.sessionId}`,
        payload,
      });
      send(state.websocket, {
        type: "workspace-synced",
        revision: saved.revision,
      });
    } catch (error) {
      send(state.websocket, {
        type: "workspace-sync-conflict",
        code: error.code || "workspace_sync_failed",
        message: error.message || "Terminal changes could not be synchronized.",
      });
    }
    try {
      await state.remote?.release();
    } catch {}
    send(state.websocket, {
      type: "exit",
      code: result.exitCode,
      signal: result.signal,
      reason: result.reason,
    });
    try {
      state.websocket?.close(1000, "Terminal exited");
    } catch {}
    await rm(state.workspace, { recursive: true, force: true });
  }
  function remember(state, data) {
    let value = data,
      bytes = Buffer.byteLength(value);
    if (bytes > MAX_REPLAY) {
      const buffer = Buffer.from(value);
      value = buffer
        .subarray(buffer.length - MAX_REPLAY)
        .toString("utf8")
        .replace(/^\uFFFD/, "");
      bytes = Buffer.byteLength(value);
      state.replay.length = 0;
      state.replayBytes = 0;
    }
    state.replay.push(value);
    state.replayBytes += bytes;
    while (state.replayBytes > MAX_REPLAY && state.replay.length > 1) state.replayBytes -= Buffer.byteLength(state.replay.shift());
  }
  async function close() {
    for (const state of sessions.values())
      await finish(state, {
        exitCode: 130,
        signal: 15,
        reason: "service_shutdown",
      });
    wss.close();
  }
  return {
    handler,
    handleUpgrade,
    close,
    status: () => ({
      active: sessions.size,
      maxSessions,
      sandbox: sandbox.kind,
      sandboxReady: sandbox.ready,
    }),
  };
}

function publicSession(state) {
  return {
    sessionId: state.sessionId,
    projectId: state.projectId,
    runtimeId: state.runtimeId,
    status: state.websocket ? "attached" : "detached",
    startedAt: new Date(state.startedAt).toISOString(),
    lastActivityAt: new Date(state.lastInput).toISOString(),
    replayBytes: state.replayBytes,
    environmentRevision: state.environmentRevision,
  };
}
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
  return true;
}

async function ensureRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}
function sameOrigin(request) {
  try {
    const origin = new URL(String(request.headers.origin || "")),
      host = String(request.headers["x-forwarded-host"] || request.headers.host || "")
        .split(",")[0]
        .trim();
    return origin.host === host && (request.headers["sec-fetch-site"] === undefined || request.headers["sec-fetch-site"] === "same-origin");
  } catch {
    return false;
  }
}
function reject(socket) {
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
}
function send(websocket, value) {
  if (websocket?.readyState === 1) websocket.send(JSON.stringify(value));
}
function bounded(value, fallback, min, max) {
  const number = Number(value || fallback);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
function fault(message, code) {
  return Object.assign(new Error(message), { code });
}
async function ensurePtyHelper() {
  if (process.platform !== "darwin") return;
  const require = createRequire(import.meta.url),
    packageRoot = dirname(require.resolve("node-pty/package.json")),
    helper = join(packageRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper");
  await chmod(helper, 0o755);
}
