import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { detectSandbox, resolveExecutable as resolveCommand, sandboxLaunch } from "./sandbox.mjs";

const PROTOCOL = "ynx-code/v1",
  COOKIE = "ynx_code_session",
  MAX_FILES = 256,
  MAX_SOURCE_BYTES = 2 * 1024 * 1024,
  MAX_OUTPUT_BYTES = 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9_./ +@-]+$/;

export function createWorkspaceRuntime(options = {}) {
  const sessionKey = Buffer.from(options.sessionKey || process.env.YNX_CODE_WORKSPACE_SESSION_KEY || randomBytes(32));
  const root = options.root || join(tmpdir(), "ynx-code-runtime");
  const workspaceStore = options.workspaceStore || null;
  const release = publicRelease(options.release ?? process.env.YNX_CODE_RELEASE);
  const languageRequests = options.languageRequests || (options.languageRequest ? { cpp: options.languageRequest } : {});
  const environmentResolver = options.environmentResolver;
  const concurrency = boundedNumber(options.concurrency || process.env.YNX_CODE_RUNTIME_CONCURRENCY, 4, 1, 64);
  const queueLimit = boundedNumber(options.queueLimit || process.env.YNX_CODE_RUNTIME_QUEUE, 64, 1, 512);
  let active = 0;
  const queue = [],
    activities = new Map();
  const sandbox = detectSandbox(options);
  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/runtime/tasks/active" && request.method === "GET") {
      const session = readSession(request, sessionKey);
      if (!session) {
        json(response, 401, { error: "A signed workspace session is required.", code: "workspace_session_required" });
        return true;
      }
      const owner = ownerId(session, sessionKey);
      json(response, 200, { protocolVersion: PROTOCOL, tasks: [...activities.values()].filter((item) => item.owner === owner).map(publicActivity) });
      return true;
    }
    const stopTaskMatch = url.pathname.match(/^\/runtime\/tasks\/([0-9a-f-]{36})$/);
    if (stopTaskMatch && request.method === "DELETE") {
      const session = readSession(request, sessionKey);
      if (!session) {
        json(response, 401, { error: "A signed workspace session is required.", code: "workspace_session_required" });
        return true;
      }
      const activity = activities.get(stopTaskMatch[1]),
        owner = ownerId(session, sessionKey);
      if (!activity || activity.owner !== owner) {
        json(response, 404, { error: "Task was not found.", code: "task_not_found" });
        return true;
      }
      if (activity.status === "queued") {
        const index = queue.findIndex((item) => item.taskId === activity.taskId);
        if (index < 0) {
          json(response, 409, { error: "Task state changed before cancellation. Refresh and retry.", code: "task_state_changed" });
          return true;
        }
        const [item] = queue.splice(index, 1);
        finishActivity(activity.taskId);
        const error = Object.assign(new Error("Task cancelled before execution."), { status: 409, code: "task_cancelled" });
        if (item.internal) item.reject(error);
        else {
          json(item.response, error.status, { error: error.message, code: error.code });
          item.resolve();
        }
        json(response, 202, { protocolVersion: PROTOCOL, cancelled: activity.taskId, previousStatus: "queued" });
        pump();
        return true;
      }
      if (activity.status === "stopping") {
        json(response, 202, { protocolVersion: PROTOCOL, stopping: activity.taskId, previousStatus: "stopping" });
        return true;
      }
      activity.status = "stopping";
      activity.controller.abort();
      json(response, 202, { protocolVersion: PROTOCOL, stopping: activity.taskId, previousStatus: "running" });
      return true;
    }
    if (url.pathname === "/runtime/health" && request.method === "GET") {
      const session = readSession(request, sessionKey) || newSession();
      json(
        response,
        200,
        {
          ok: true,
          protocolVersion: PROTOCOL,
          service: "ynx-code-workspace-agent",
          sandboxReady: sandbox.ready,
          sandbox: sandbox.kind,
          compilers: await compilerInventory(),
          languageServers: Object.fromEntries(Object.keys(languageRequests).map((id) => [id, true])),
          active,
          queued: queue.length,
          maxConcurrent: concurrency,
          maxQueued: queueLimit,
          sessionClass: "ephemeral-guest",
          release,
          workspacePersistence: workspaceStore ? "sqlite-wal" : "disabled",
          durability: workspaceStore ? "server-local recovery; production object-store migration required" : "runtime-local; restart invalidates guest session",
        },
        { "set-cookie": cookie(session, sessionKey, request) },
      );
      return true;
    }
    const languageMatch = url.pathname.match(/^\/runtime\/language\/([a-z][a-z0-9-]{0,31})$/);
    if (languageMatch && request.method === "POST") {
      const session = readSession(request, sessionKey),
        languageRequest = languageRequests[languageMatch[1]];
      if (!session) {
        const next = newSession();
        json(
          response,
          401,
          {
            error: "Workspace session was established. Retry the language request.",
            code: "workspace_session_required",
          },
          { "set-cookie": cookie(next, sessionKey, request) },
        );
        return true;
      }
      if (!languageRequest) {
        json(response, 503, {
          error: "The requested language service is not configured.",
          code: "language_server_unavailable",
        });
        return true;
      }
      try {
        const body = JSON.parse((await readBody(request, 3 * 1024 * 1024)).toString("utf8"));
        if (body.protocolVersion !== PROTOCOL) throw Object.assign(new Error("Language protocol version is required."), { status: 400, code: "protocol_mismatch" });
        const value = await languageRequest(body, {
          owner: ownerId(session, sessionKey),
          request,
        });
        json(response, 200, value);
      } catch (error) {
        json(response, error.status || 400, {
          error: error.message || "Language request failed.",
          code: error.code || "language_request_failed",
        });
      }
      return true;
    }
    const workspaceMatch = url.pathname.match(/^\/runtime\/workspaces\/([-A-Za-z0-9_]{1,160})$/);
    if (workspaceMatch && (request.method === "GET" || request.method === "PUT" || request.method === "POST")) {
      const session = readSession(request, sessionKey);
      if (!session) {
        const next = newSession();
        json(
          response,
          401,
          {
            error: "Workspace session was established. Retry the request.",
            code: "workspace_session_required",
          },
          { "set-cookie": cookie(next, sessionKey, request) },
        );
        return true;
      }
      if (!workspaceStore) {
        json(response, 503, {
          error: "Durable workspace storage is not configured.",
          code: "workspace_store_unavailable",
        });
        return true;
      }
      const owner = ownerId(session, sessionKey),
        projectId = workspaceMatch[1];
      try {
        if (request.method === "GET") {
          if (url.searchParams.get("view") === "history") {
            const value = workspaceStore.history(owner, projectId, url.searchParams.get("cursor"), url.searchParams.get("limit"));
            json(response, 200, { protocolVersion: PROTOCOL, history: value });
            return true;
          }
          if (url.searchParams.get("view") === "snapshot") {
            const revision = Number(url.searchParams.get("revision"));
            const value = workspaceStore.snapshot(owner, projectId, revision);
            if (!value)
              json(response, 404, {
                error: "The selected workspace revision is not retained.",
                code: "workspace_revision_not_found",
              });
            else
              json(response, 200, {
                protocolVersion: PROTOCOL,
                workspace: value,
              });
            return true;
          }
          const value = workspaceStore.get(owner, projectId);
          if (!value)
            json(response, 404, {
              error: "Workspace was not found.",
              code: "workspace_not_found",
            });
          else
            json(response, 200, {
              protocolVersion: PROTOCOL,
              workspace: value,
            });
          return true;
        }
        const body = JSON.parse((await readBody(request, 3 * 1024 * 1024)).toString("utf8"));
        if (body.protocolVersion !== PROTOCOL) throw Object.assign(new Error("Workspace protocol version is required."), { status: 400, code: "protocol_mismatch" });
        if (request.method === "POST") {
          if (body.action !== "restore" || body.approval !== "restore-workspace-once") throw Object.assign(new Error("An explicit one-time workspace restore approval is required."), { status: 403, code: "restore_approval_required" });
          const value = workspaceStore.restore(owner, projectId, {
            expectedRevision: body.expectedRevision,
            sourceRevision: body.sourceRevision,
            idempotencyKey: body.idempotencyKey,
            approvalId: body.approvalId,
          });
          json(response, 200, { protocolVersion: PROTOCOL, workspace: value });
          return true;
        }
        const value = workspaceStore.put(owner, projectId, {
          expectedRevision: body.expectedRevision,
          idempotencyKey: body.idempotencyKey,
          payload: body.workspace,
        });
        json(response, 200, { protocolVersion: PROTOCOL, workspace: value });
        return true;
      } catch (error) {
        json(response, error.status || 400, {
          error: error.message || "Workspace mutation failed.",
          code: error.code || "workspace_mutation_failed",
          ...(Number.isInteger(error.currentRevision) ? { currentRevision: error.currentRevision } : {}),
        });
        return true;
      }
    }
    const streaming = url.pathname === "/runtime/tasks/stream";
    if ((url.pathname === "/runtime/tasks" || streaming) && request.method === "POST") {
      const session = readSession(request, sessionKey);
      if (!session) {
        const next = newSession();
        json(
          response,
          401,
          {
            error: "Workspace session was established. Retry the reviewed task.",
            code: "workspace_session_required",
          },
          { "set-cookie": cookie(next, sessionKey, request) },
        );
        return true;
      }
      let body;
      try {
        body = JSON.parse((await readBody(request, 3 * 1024 * 1024)).toString("utf8"));
        validateTask(body);
      } catch (error) {
        json(response, error.status || 400, {
          error: error.message || "Invalid workspace task.",
          code: error.code || "invalid_task",
        });
        return true;
      }
      if (!sandbox.ready) {
        json(response, 503, {
          error: "No approved workspace sandbox is installed. Execution fails closed.",
          code: "sandbox_unavailable",
          sandbox: sandbox.kind,
        });
        return true;
      }
      if (active >= concurrency && queue.length >= queueLimit) {
        json(
          response,
          503,
          {
            error: "Workspace runtime queue is full. Retry shortly.",
            code: "runtime_overloaded",
          },
          { "retry-after": "2" },
        );
        return true;
      }
      await new Promise((resolve) => {
        const item = { taskId: randomUUID(), session, owner: ownerId(session, sessionKey), body, response, resolve, streaming };
        queue.push(item);
        queueActivity(item);
        pump();
      });
      return true;
    }
    return false;
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const item = queue.shift();
      active++;
      startActivity(item);
      if (item.internal) {
        execute(item.session, item.body, {
          root,
          sandbox,
          onEvent: item.onEvent,
          owner: item.owner,
          environmentResolver,
          taskId: item.taskId,
          onEnvironmentResolved: (revision) => updateActivity(item.taskId, revision),
          signal: item.controller.signal,
        })
          .then(item.resolve, item.reject)
          .finally(() => {
            active--;
            finishActivity(item.taskId);
            pump();
          });
        continue;
      }
      if (item.streaming) {
        item.response.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-accel-buffering": "no",
        });
        const send = (value) => item.response.write(`${JSON.stringify(value)}\n`);
        execute(item.session, item.body, { root, sandbox, onEvent: send, owner: item.owner, environmentResolver, taskId: item.taskId, onEnvironmentResolved: (revision) => updateActivity(item.taskId, revision), signal: item.controller.signal })
          .then(
            (value) => send({ type: "result", value }),
            (error) =>
              send({
                type: "error",
                error: error.publicMessage || error.message || "Workspace task failed.",
                code: error.code || "task_failed",
              }),
          )
          .finally(() => item.response.end())
          .finally(() => {
            active--;
            finishActivity(item.taskId);
            item.resolve();
            pump();
          });
      } else
        execute(item.session, item.body, { root, sandbox, owner: item.owner, environmentResolver, taskId: item.taskId, onEnvironmentResolved: (revision) => updateActivity(item.taskId, revision), signal: item.controller.signal })
          .then(
            (value) => json(item.response, 200, value),
            (error) =>
              json(item.response, error.status || 400, {
                error: error.publicMessage || error.message || "Workspace task failed.",
                code: error.code || "task_failed",
              }),
          )
          .finally(() => {
            active--;
            finishActivity(item.taskId);
            item.resolve();
            pump();
          });
    }
  }
  function runTaskForOwner(owner, body, onEvent) {
    if (typeof owner !== "string" || !owner)
      throw Object.assign(new Error("A workspace owner is required."), {
        status: 401,
        code: "workspace_owner_required",
      });
    validateTask(body);
    if (!sandbox.ready) throw Object.assign(new Error("No approved workspace sandbox is installed."), { status: 503, code: "sandbox_unavailable" });
    if (active >= concurrency && queue.length >= queueLimit)
      throw Object.assign(new Error("Workspace runtime queue is full."), {
        status: 503,
        code: "runtime_overloaded",
      });
    return new Promise((resolve, reject) => {
      const item = {
        taskId: randomUUID(),
        session: `internal:${owner}`,
        owner,
        body,
        onEvent,
        resolve,
        reject,
        internal: true,
      };
      queue.push(item);
      queueActivity(item);
      pump();
    });
  }
  function queueActivity(item) {
    activities.set(item.taskId, { taskId: item.taskId, owner: item.owner, projectId: item.body.projectId, kind: item.body.task, status: "queued", queuedAt: new Date().toISOString(), startedAt: null, environmentRevision: null, controller: null });
  }
  function startActivity(item) {
    item.controller = new AbortController();
    const activity = activities.get(item.taskId);
    if (activity) Object.assign(activity, { status: "running", startedAt: new Date().toISOString(), controller: item.controller });
  }
  function updateActivity(taskId, environmentRevision) {
    const item = activities.get(taskId);
    if (item) item.environmentRevision = environmentRevision;
  }
  function finishActivity(taskId) {
    activities.delete(taskId);
  }
  return {
    handler,
    runTaskForOwner,
    ownerForRequest(request) {
      const session = readSession(request, sessionKey);
      return session ? ownerId(session, sessionKey) : null;
    },
    status: () => ({
      active,
      queued: queue.length,
      sandbox: sandbox.kind,
      sandboxReady: sandbox.ready,
    }),
  };
}
function publicRelease(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(value) ? value : null;
}

function publicActivity(item) {
  return {
    taskId: item.taskId,
    projectId: item.projectId,
    kind: item.kind,
    status: item.status,
    queuedAt: item.queuedAt,
    startedAt: item.startedAt,
    environmentRevision: item.environmentRevision,
  };
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function newSession() {
  return randomBytes(24).toString("base64url");
}
function signature(value, key) {
  return createHmac("sha256", key).update(value).digest("base64url");
}
function ownerId(session, key) {
  return createHmac("sha256", key).update(`workspace-owner:${session}`).digest("hex");
}
function cookie(value, key, request) {
  const secure =
    request?.socket?.encrypted ||
    String(request?.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() === "https";
  return `${COOKIE}=${value}.${signature(value, key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${secure ? "; Secure" : ""}`;
}
function readSession(request, key) {
  const header = String(request.headers.cookie || "");
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return null;
  const split = value.lastIndexOf(".");
  if (split < 1) return null;
  const id = value.slice(0, split),
    given = value.slice(split + 1),
    expected = signature(id, key);
  if (!/^[A-Za-z0-9_-]{32}$/.test(id) || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return id;
}
async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request exceeds the workspace task limit."), { status: 413, code: "task_too_large" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}
function safePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => !part || part === "." || part === "..") && SAFE_PATH.test(value);
}
function validateTask(value) {
  const build = value?.task === "build-run-active",
    test = value?.task === "test-project";
  if (!value || value.protocolVersion !== PROTOCOL || (!build && !test) || value.approval !== (build ? "execute-once" : "test-once")) throw Object.assign(new Error("A versioned one-time build/run or project-test approval is required."), { status: 403, code: "task_approval_required" });
  if (typeof value.projectId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.projectId) || (build && !safePath(value.activePath)) || !value.files || Array.isArray(value.files) || typeof value.files !== "object") throw Object.assign(new Error("A valid project and text file map are required."), { code: "invalid_workspace" });
  const entries = Object.entries(value.files);
  if (entries.length < 1 || entries.length > MAX_FILES || (build && !Object.hasOwn(value.files, value.activePath))) throw Object.assign(new Error("Workspace must contain the active file when building and at most 256 files."), { code: "invalid_workspace" });
  let bytes = 0;
  for (const [path, content] of entries) {
    if (!safePath(path) || typeof content !== "string") throw Object.assign(new Error("Workspace contains an invalid path or non-text file."), { code: "invalid_workspace_file" });
    bytes += Buffer.byteLength(content);
    if (bytes > MAX_SOURCE_BYTES)
      throw Object.assign(new Error("Workspace source exceeds 2 MiB."), {
        status: 413,
        code: "workspace_too_large",
      });
  }
}

async function compilerInventory() {
  const specs = {
    c: ["clang", "gcc"],
    cpp: ["clang++", "g++"],
    javascript: [basename(process.execPath)],
    typescript: ["tsc"],
    python: ["python3.13", "python3.12", "python3.11", "python3"],
    go: ["go"],
    rust: ["rustc"],
    java: ["javac"],
    solidity: ["solcjs"],
  };
  const output = {};
  for (const [id, candidates] of Object.entries(specs)) output[id] = Boolean(await resolveCommand(candidates));
  return output;
}

async function execute(session, task, { root, sandbox, onEvent, owner, environmentResolver, taskId = randomUUID(), onEnvironmentResolved, signal }) {
  const started = performance.now(),
    sessionRoot = join(root, createHmac("sha256", Buffer.from(session)).update(task.projectId).digest("hex").slice(0, 32));
  const resolvedEnvironment = environmentResolver ? await environmentResolver(owner, task.projectId) : { revision: 0, environment: {} };
  onEnvironmentResolved?.(resolvedEnvironment.revision);
  let sequence = 0;
  const emit = (value) => onEvent?.({ ...value, taskId, sequence: ++sequence });
  await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(sessionRoot, "task-"));
  try {
    const sandboxWorkspace = await realpath(workspace);
    await mkdir(join(sandboxWorkspace, ".tmp"), { mode: 0o700 });
    for (const [path, content] of Object.entries(task.files)) {
      const target = safeJoin(sandboxWorkspace, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { mode: 0o600, flag: "wx" });
    }
    const spec = task.task === "test-project" ? await projectTestSpec(sandboxWorkspace, task.files) : await taskSpec(task.activePath, sandboxWorkspace, task.files);
    if (!spec) throw Object.assign(new Error(`No installed runtime adapter can build and run ${extname(task.activePath) || "this file"}.`), { status: 503, code: "toolchain_unavailable" });
    await mkdir(join(sandboxWorkspace, ".ynx-build"), { mode: 0o700 });
    if (spec.artifactRoot) await mkdir(spec.artifactRoot, { recursive: true, mode: 0o700 });
    let output = "",
      truncated = false;
    for (const phase of spec.phases) {
      emit({ type: "phase", phase: phase.label, status: "started" });
      let result = await runSandboxed({
        sandbox,
        workspace: sandboxWorkspace,
        command: phase.command,
        args: phase.args,
        stdin: phase.stdin,
        timeout: phase.timeout || 30_000,
        maxOutputBytes: phase.maxOutputBytes,
        addressSpaceBytes: phase.addressSpaceBytes,
        environment: phase.environment,
        projectEnvironment: resolvedEnvironment.environment,
        signal,
        readOnlyBinds: phase.readOnlyBinds,
        onChunk: phase.materialize ? undefined : (channel, data) => emit({ type: "output", phase: phase.label, channel, data }),
      });
      if (phase.materialize) result = await phase.materialize(result);
      const append = `${phase.label}> ${result.output}`;
      if (Buffer.byteLength(output + append) > MAX_OUTPUT_BYTES) {
        output = (output + append).slice(0, MAX_OUTPUT_BYTES);
        truncated = true;
      } else output += append;
      if (phase.materialize)
        emit({
          type: "output",
          phase: phase.label,
          channel: "stdout",
          data: result.output,
        });
      emit({
        type: "phase",
        phase: phase.label,
        status: "completed",
        code: result.code,
      });
      if (result.code !== 0)
        return resultEnvelope({
          taskId,
          started,
          spec,
          output,
          code: result.code,
          sandbox,
          truncated,
          artifacts: [],
          environmentRevision: resolvedEnvironment.revision,
        });
    }
    const artifacts = spec.artifactRoot ? await collectArtifacts(sandboxWorkspace, spec.artifactRoot) : [];
    return resultEnvelope({
      taskId,
      started,
      spec,
      output,
      code: 0,
      sandbox,
      truncated,
      artifacts,
      environmentRevision: resolvedEnvironment.revision,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
function safeJoin(root, path) {
  const target = normalize(join(root, path));
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw Object.assign(new Error("Workspace path escaped its root."), {
      code: "workspace_escape",
    });
  return target;
}
async function taskSpec(path, workspace, files) {
  const file = safeJoin(workspace, path),
    extension = extname(path).toLowerCase(),
    build = join(workspace, ".ynx-build", "program");
  if (extension === ".c") {
    const compiler = await resolveCommand(["clang", "gcc"]);
    if (!compiler) return null;
    return {
      language: "c",
      compiler,
      version: await version(compiler),
      phases: [
        {
          label: "build",
          command: compiler,
          args: ["-std=c17", "-Wall", "-Wextra", "-pedantic", file, "-o", build],
        },
        { label: "run", command: build, args: [] },
      ],
    };
  }
  if ([".cpp", ".cc", ".cxx"].includes(extension)) {
    const compiler = await resolveCommand(["clang++", "g++"]);
    if (!compiler) return null;
    return {
      language: "cpp",
      compiler,
      version: await version(compiler),
      phases: [
        {
          label: "build",
          command: compiler,
          args: ["-std=c++20", "-Wall", "-Wextra", "-pedantic", file, "-o", build],
        },
        { label: "run", command: build, args: [] },
      ],
    };
  }
  if ([".js", ".mjs", ".cjs"].includes(extension))
    return {
      language: "javascript",
      compiler: process.execPath,
      version: process.version,
      phases: [{ label: "run", command: process.execPath, args: [file] }],
    };
  if (extension === ".ts") {
    const compiler = await resolveCommand(["tsc"]);
    if (!compiler) return null;
    const output = join(workspace, ".ynx-build", "typescript", path.slice(0, -3) + ".js"),
      readOnlyBinds = await typescriptToolBinds(compiler);
    return {
      language: "typescript",
      compiler,
      version: await version(compiler),
      phases: [
        {
          label: "build",
          command: compiler,
          args: ["--target", "ES2022", "--module", "node16", "--moduleResolution", "node16", "--rootDir", workspace, "--outDir", join(workspace, ".ynx-build", "typescript"), "--noEmitOnError", "--skipLibCheck", file],
          readOnlyBinds,
        },
        { label: "run", command: process.execPath, args: [output] },
      ],
    };
  }
  if (extension === ".py") {
    const compiler = await resolveCommand(["python3.13", "python3.12", "python3.11", "python3"]);
    if (!compiler) return null;
    return {
      language: "python",
      compiler,
      version: await version(compiler),
      phases: [{ label: "run", command: compiler, args: ["-I", file] }],
    };
  }
  if (extension === ".go") {
    const compiler = await resolveCommand(["go"]);
    if (!compiler) return null;
    return {
      language: "go",
      compiler,
      version: await version(compiler),
      // The reviewed cloud runner reserves a small process/thread envelope.
      // Go's compiler otherwise sizes itself from host CPUs and can exhaust
      // that envelope before the user's single-file program begins.
      phases: [{ label: "run", command: compiler, args: ["run", "-p", "1", file], environment: { GOMAXPROCS: "1" } }],
    };
  }
  if (extension === ".rs") {
    const compiler = await resolveCommand(["rustc"]);
    if (!compiler) return null;
    return {
      language: "rust",
      compiler,
      version: await version(compiler),
      phases: [
        { label: "build", command: compiler, args: [file, "-o", build] },
        { label: "run", command: build, args: [] },
      ],
    };
  }
  if (extension === ".java") {
    const compiler = await resolveCommand(["javac"]),
      runtime = await resolveCommand(["java"]);
    if (!compiler || !runtime) return null;
    const className = basename(path, extension),
      source = files[path],
      packageName = source.match(/^\s*package\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*;/m)?.[1],
      mainClass = packageName ? `${packageName}.${className}` : className,
      output = join(workspace, ".ynx-build", "java");
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className)) throw Object.assign(new Error("Java source filename must be a valid class identifier."), { status: 400, code: "invalid_java_class_name" });
    return {
      language: "java",
      compiler,
      version: await version(compiler),
      phases: [
        {
          label: "build",
          command: compiler,
          args: ["-encoding", "UTF-8", "-d", output, file],
        },
        {
          label: "run",
          command: runtime,
          args: ["-Dfile.encoding=UTF-8", "-cp", output, mainClass],
        },
      ],
    };
  }
  if (extension === ".sol") {
    const compiler = await resolveCommand(["solcjs"]);
    if (!compiler) return null;
    const artifactRoot = join(workspace, ".ynx-build", "solidity"),
      readOnlyBinds = await solidityToolBinds(compiler),
      input = JSON.stringify({
        language: "Solidity",
        sources: Object.fromEntries(
          Object.entries(files)
            .filter(([name]) => name.endsWith(".sol"))
            .map(([name, content]) => [name, { content }]),
        ),
        settings: {
          outputSelection: {
            "*": {
              "*": ["abi", "metadata", "evm.bytecode.object", "evm.bytecode.sourceMap", "evm.bytecode.linkReferences", "evm.deployedBytecode.object", "evm.deployedBytecode.sourceMap", "evm.deployedBytecode.linkReferences"],
            },
          },
        },
      });
    return {
      language: "solidity",
      compiler,
      version: await version(compiler),
      compilerEvidence: {
        input: "standard-json",
        abi: true,
        bytecode: true,
        sourceMaps: true,
      },
      artifactRoot,
      phases: [
        {
          label: "compile",
          command: compiler,
          args: ["--standard-json"],
          stdin: input,
          maxOutputBytes: 8 * 1024 * 1024,
          addressSpaceBytes: null,
          environment: { NODE_OPTIONS: "--max-old-space-size=512" },
          readOnlyBinds,
          materialize: (result) => materializeSolidityArtifacts(result, artifactRoot),
        },
      ],
    };
  }
  return null;
}
async function projectTestSpec(workspace, files) {
  const paths = Object.keys(files).sort(),
    javascript = paths.filter((path) => /(?:^|\/).+\.(?:test|spec)\.(?:js|mjs|cjs)$/i.test(path)),
    python = paths.filter((path) => /(?:^|\/)(?:test_.+|.+_test)\.py$/i.test(path)),
    goTests = paths.filter((path) => /_test\.go$/i.test(path)),
    c = paths.filter((path) => /(?:^|\/)(?:test|tests)\/.+\.c$/i.test(path)),
    cpp = paths.filter((path) => /(?:^|\/)(?:test|tests)\/.+\.(?:cpp|cc|cxx)$/i.test(path)),
    rustTests = paths.filter((path) => path.endsWith(".rs") && /#\s*\[\s*test\s*\]/.test(files[path])),
    javaTests = paths.filter((path) => /(?:^|\/)src\/test\/java\/.+(?:Test|Tests)\.java$/i.test(path)),
    solidityTests = paths.filter((path) => /(?:^|\/)contracts\/.+\.t\.sol$/i.test(path) && /\bfunction\s+test[A-Za-z0-9_]*\s*\(/.test(files[path])),
    discovered = javascript.length + python.length + goTests.length + c.length + cpp.length + rustTests.length + javaTests.length + solidityTests.length;
  if (discovered === 0) throw Object.assign(new Error("No supported JavaScript, Python, Go, C, C++, Cargo, JUnit or Solidity project tests were found."), { status: 400, code: "tests_missing" });
  if (discovered > 32)
    throw Object.assign(new Error("Project test discovery exceeds the 32-file review boundary."), {
      status: 413,
      code: "test_file_limit",
    });
  const phases = [],
    runners = [];
  let primary = process.execPath;
  if (javascript.length) {
    runners.push({ language: "javascript", files: javascript });
    phases.push({
      label: "test:javascript",
      command: process.execPath,
      args: ["--test", ...javascript.map((path) => safeJoin(workspace, path))],
      timeout: 20_000,
    });
  }
  if (python.length) {
    const command = await resolveCommand(["python3.13", "python3.12", "python3.11", "python3"]);
    if (!command)
      throw Object.assign(new Error("Python tests were found but no reviewed Python runtime is installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (!runners.length) primary = command;
    runners.push({ language: "python", files: python });
    for (const path of python)
      phases.push({
        label: `test:python:${path}`,
        command,
        args: ["-I", "-m", "unittest", "discover", "-s", safeJoin(workspace, dirname(path)), "-p", basename(path)],
        timeout: 10_000,
      });
  }
  if (goTests.length) {
    const command = await resolveCommand(["go"]);
    if (!command)
      throw Object.assign(new Error("Go tests were found but no reviewed Go toolchain is installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (!runners.length) primary = command;
    const directories = [...new Set(goTests.map((path) => dirname(path)))].sort();
    runners.push({ language: "go", files: goTests });
    for (const directory of directories) {
      const sources = paths.filter((path) => dirname(path) === directory && path.endsWith(".go"));
      phases.push({
        label: `test:go:${directory}`,
        command,
        args: ["test", "-p", "1", ...sources.map((path) => safeJoin(workspace, path))],
        timeout: 90_000,
        environment: { GOMAXPROCS: "1" },
      });
    }
  }
  if (c.length) {
    const command = await resolveCommand(["clang", "gcc"]);
    if (!command)
      throw Object.assign(new Error("C tests were found but no reviewed C compiler is installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (!runners.length) primary = command;
    runners.push({ language: "c", files: c });
    for (let index = 0; index < c.length; index += 1) {
      const path = c[index],
        output = join(workspace, ".ynx-build", `test-c-${index}`);
      phases.push(
        {
          label: `build-test:c:${path}`,
          command,
          args: ["-std=c17", "-Wall", "-Wextra", "-pedantic", safeJoin(workspace, path), "-o", output],
          timeout: 20_000,
        },
        {
          label: `test:c:${path}`,
          command: output,
          args: [],
          timeout: 10_000,
        },
      );
    }
  }
  if (cpp.length) {
    const command = await resolveCommand(["clang++", "g++"]);
    if (!command)
      throw Object.assign(new Error("C++ tests were found but no reviewed C++ compiler is installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (!runners.length) primary = command;
    runners.push({ language: "cpp", files: cpp });
    for (let index = 0; index < cpp.length; index += 1) {
      const path = cpp[index],
        output = join(workspace, ".ynx-build", `test-cpp-${index}`);
      phases.push(
        {
          label: `build-test:cpp:${path}`,
          command,
          args: ["-std=c++20", "-Wall", "-Wextra", "-pedantic", safeJoin(workspace, path), "-o", output],
          timeout: 20_000,
        },
        {
          label: `test:cpp:${path}`,
          command: output,
          args: [],
          timeout: 10_000,
        },
      );
    }
  }
  if (rustTests.length) {
    const command = await resolveCommand(["cargo"]),
      metadata = rustPackageMetadata(files["Cargo.toml"]),
      lockPath = join(workspace, "Cargo.lock");
    if (!command)
      throw Object.assign(new Error("Rust tests were found but no reviewed Cargo toolchain is installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (files["Cargo.lock"] === undefined) await writeFile(lockPath, rustLock(metadata), { mode: 0o600, flag: "wx" });
    else validateRustLock(files["Cargo.lock"], metadata);
    if (!runners.length) primary = command;
    runners.push({ language: "rust", framework: "cargo-test-offline", files: rustTests });
    phases.push({
      label: "test:rust:cargo",
      command,
      args: ["test", "--offline", "--locked", "--manifest-path", safeJoin(workspace, "Cargo.toml"), "--target-dir", join(workspace, ".ynx-build", "cargo-target"), "--", "--test-threads=1"],
      timeout: 120_000,
      addressSpaceBytes: null,
    });
  }
  if (javaTests.length) {
    const java = await resolveCommand(["java"]),
      javac = await resolveCommand(["javac"]),
      junitJar = await realpath(process.env.YNX_CODE_JUNIT_CONSOLE_JAR || "/usr/local/share/ynx-code/junit-platform-console-standalone.jar").catch(() => null);
    if (!java || !javac || !junitJar)
      throw Object.assign(new Error("JUnit tests were found but the reviewed JDK and pinned JUnit Console runtime are not installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (!runners.length) primary = java;
    const output = join(workspace, ".ynx-build", "junit"),
      sources = paths.filter((path) => path.endsWith(".java"));
    runners.push({ language: "java", framework: "junit-platform-1.14.2", files: javaTests });
    phases.push(
      {
        label: "build-test:java:junit",
        command: javac,
        args: ["-encoding", "UTF-8", "-cp", junitJar, "-d", output, ...sources.map((path) => safeJoin(workspace, path))],
        timeout: 60_000,
        readOnlyBinds: [{ host: junitJar, guest: "/ynx-toolchain/junit-platform-console-standalone" }],
      },
      {
        label: "test:java:junit",
        command: java,
        args: ["-jar", junitJar, "execute", "--class-path", output, "--scan-class-path", "--disable-banner", "--details=summary", "--fail-if-no-tests"],
        timeout: 60_000,
        addressSpaceBytes: null,
        readOnlyBinds: [{ host: junitJar, guest: "/ynx-toolchain/junit-platform-console-standalone" }],
      },
    );
  }
  if (solidityTests.length) {
    const nodeModules = await reviewedHardhatToolchain(),
      runner = await realpath(fileURLToPath(new URL("./hardhat-solidity-test.mjs", import.meta.url))).catch(() => null);
    if (!nodeModules || !runner)
      throw Object.assign(new Error("Solidity tests were found but the reviewed Hardhat 3 and pinned solc 0.8.24 toolchain are not installed."), {
        status: 503,
        code: "toolchain_unavailable",
      });
    if (!runners.length) primary = process.execPath;
    runners.push({ language: "solidity", framework: "hardhat-3-solidity-tests", compiler: "solc-0.8.24-wasm", files: solidityTests });
    phases.push({
      label: "test:solidity:hardhat",
      command: process.execPath,
      args: [runner, nodeModules],
      timeout: 120_000,
      addressSpaceBytes: null,
      environment: { NODE_OPTIONS: "--max-old-space-size=768" },
      readOnlyBinds: [
        { host: runner, guest: "/ynx-toolchain/hardhat-runner" },
        { host: nodeModules, guest: "/ynx-toolchain/node_modules" },
      ],
    });
  }
  if (phases.length > 20)
    throw Object.assign(new Error("Project test plan exceeds the 20-phase execution boundary."), {
      status: 413,
      code: "test_phase_limit",
    });
  return {
    language: "project-tests",
    compiler: primary,
    version: await version(primary),
    compilerEvidence: { discovery: "bounded-explicit-files", runners },
    phases,
  };
}
async function reviewedHardhatToolchain() {
  for (let cursor = dirname(fileURLToPath(import.meta.url)); cursor !== dirname(cursor); cursor = dirname(cursor)) {
    const hardhat = await realpath(join(cursor, "node_modules", "hardhat", "package.json")).catch(() => null),
      solc = await realpath(join(cursor, "node_modules", "solc", "soljson.js")).catch(() => null);
    if (hardhat && solc) return join(cursor, "node_modules");
  }
  return null;
}
function rustPackageMetadata(manifest) {
  if (typeof manifest !== "string") throw Object.assign(new Error("Cargo tests require a bounded Cargo.toml."), { status: 400, code: "invalid_cargo_manifest" });
  let section = "", name = "", versionValue = "", edition = "";
  for (const raw of manifest.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; if (section !== "package") throw Object.assign(new Error("Cargo project tests permit only a dependency-free [package] manifest."), { status: 400, code: "invalid_cargo_manifest" }); continue; }
    const field = line.match(/^(name|version|edition)\s*=\s*"([^"]+)"$/);
    if (section !== "package" || !field) throw Object.assign(new Error("Cargo project tests permit only name, version and edition package fields."), { status: 400, code: "invalid_cargo_manifest" });
    if (field[1] === "name") name = field[2];
    if (field[1] === "version") versionValue = field[2];
    if (field[1] === "edition") edition = field[2];
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || !/^\d+\.\d+\.\d+$/.test(versionValue) || !/^(2021|2024)$/.test(edition)) throw Object.assign(new Error("Cargo package name, exact version and supported edition are required."), { status: 400, code: "invalid_cargo_manifest" });
  return { name, version: versionValue };
}
// Keep the dependency-free lock readable by the oldest reviewed Cargo runtime
// in a rebuilt toolchain image. Cargo 1.92 accepts this v3 format too, while a
// v4 lock is rejected by the existing isolated runtime before offline tests run.
function rustLock({ name, version }) { return `# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 3\n\n[[package]]\nname = "${name}"\nversion = "${version}"\n`; }
function validateRustLock(lock, metadata) {
  if (typeof lock !== "string" || lock.includes("source =") || lock.includes("checksum =") || lock !== rustLock(metadata)) throw Object.assign(new Error("Cargo.lock must be the canonical dependency-free lock for this package."), { status: 400, code: "invalid_cargo_lock" });
}
async function typescriptToolBinds(compiler) {
  const packageRoot = dirname(dirname(compiler)),
    nodeModules = dirname(packageRoot),
    binds = [{ host: packageRoot, guest: "/ynx-toolchain/node_modules/typescript" }];
  try {
    for (const entry of await readdir(join(nodeModules, "@typescript"), {
      withFileTypes: true,
    }))
      if (entry.isDirectory())
        binds.push({
          host: join(nodeModules, "@typescript", entry.name),
          guest: `/ynx-toolchain/node_modules/@typescript/${entry.name}`,
        });
  } catch {}
  return binds;
}
async function solidityToolBinds(compiler) {
  const packageRoot = dirname(compiler),
    nodeModules = dirname(packageRoot),
    packages = ["solc", "command-exists", "commander", "follow-redirects", "js-sha3", "memorystream", "semver", "tmp"],
    binds = [];
  for (const name of packages) {
    const host = join(nodeModules, name);
    try {
      await realpath(host);
      binds.push({ host, guest: `/ynx-solc/node_modules/${name}` });
    } catch {}
  }
  return binds;
}
async function collectArtifacts(workspace, artifactRoot) {
  const files = [];
  let total = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (files.length >= 64) throw Object.assign(new Error("Compiler produced too many artifacts."), { code: "artifact_limit_exceeded" });
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const body = await readFile(path);
        total += body.length;
        if (body.length > 2 * 1024 * 1024 || total > 8 * 1024 * 1024) throw Object.assign(new Error("Compiler artifact bundle exceeds its 2 MiB per-file or 8 MiB total boundary."), { code: "artifact_too_large" });
        files.push({
          path: relative(workspace, path).split(sep).join("/"),
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
          content: body.toString("utf8"),
        });
      }
    }
  }
  await walk(artifactRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function materializeSolidityArtifacts(result, artifactRoot) {
  const first = result.output.indexOf("{"),
    last = result.output.lastIndexOf("}");
  if (first < 0 || last < first)
    return {
      ...result,
      code: result.code || 1,
      output: `Solidity compiler returned an invalid standard JSON response.\n${result.output.slice(0, 1024)}`,
    };
  let value;
  try {
    value = JSON.parse(result.output.slice(first, last + 1));
  } catch {
    return {
      ...result,
      code: 1,
      output: `Solidity compiler returned malformed standard JSON.\n${result.output.slice(0, 1024)}`,
    };
  }
  const messages = (value.errors || []).map((item) => item.formattedMessage || item.message).filter(Boolean),
    hasErrors = (value.errors || []).some((item) => item.severity === "error");
  let count = 0;
  if (!hasErrors)
    for (const [source, contracts] of Object.entries(value.contracts || {}))
      for (const [name, contract] of Object.entries(contracts)) {
        const stem = `${source.replaceAll(/[^A-Za-z0-9_-]/g, "_")}_${name.replaceAll(/[^A-Za-z0-9_-]/g, "_")}`;
        await writeFile(join(artifactRoot, `${stem}.abi`), `${JSON.stringify(contract.abi || [], null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await writeFile(join(artifactRoot, `${stem}.bin`), `${contract.evm?.bytecode?.object || ""}\n`, { mode: 0o600, flag: "wx" });
        await writeFile(join(artifactRoot, `${stem}.metadata.json`), `${JSON.stringify({ source, contract: name, compilerMetadata: contract.metadata ? JSON.parse(contract.metadata) : null, bytecode: { sourceMap: contract.evm?.bytecode?.sourceMap || "", linkReferences: contract.evm?.bytecode?.linkReferences || {} }, deployedBytecode: { object: contract.evm?.deployedBytecode?.object || "", sourceMap: contract.evm?.deployedBytecode?.sourceMap || "", linkReferences: contract.evm?.deployedBytecode?.linkReferences || {} } }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        count += 3;
      }
  return {
    ...result,
    code: hasErrors ? 1 : result.code,
    output: `${messages.length ? `${messages.join("\n")}\n` : ""}${hasErrors ? "Compilation failed." : `Compiled ${count} integrity-addressed Solidity artifacts.`}\n`,
  };
}
async function version(command) {
  const result = await spawnBounded(command, ["--version"], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH || "/usr/bin:/bin" },
    timeout: 10_000,
  });
  return result.output.split("\n")[0].slice(0, 160);
}
function resultEnvelope({ taskId, started, spec, output, code, sandbox, truncated, artifacts = [], environmentRevision = 0 }) {
  return {
    protocolVersion: PROTOCOL,
    taskId,
    ok: code === 0,
    code,
    language: spec.language,
    output,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    compiler: {
      executable: basename(spec.compiler),
      version: spec.version,
      ...(spec.compilerEvidence ? { evidence: spec.compilerEvidence } : {}),
    },
    artifacts,
    sandbox: { kind: sandbox.kind, network: false, writableRoot: "workspace" },
    truncated,
    environmentRevision,
  };
}

function runSandboxed({ sandbox, workspace, command, args, stdin, timeout, maxOutputBytes, addressSpaceBytes, environment, projectEnvironment, signal, onChunk, readOnlyBinds }) {
  const launch = sandboxLaunch({
    sandbox,
    workspace,
    command,
    args,
    readOnlyBinds,
    addressSpaceBytes,
    environment,
  });
  return spawnBounded(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...launch.env, ...projectEnvironment },
    stdin,
    timeout,
    maxOutputBytes,
    onChunk,
    signal,
  });
}
function spawnBounded(command, args, { cwd, env, stdin, timeout, maxOutputBytes = MAX_OUTPUT_BYTES, onChunk, signal }) {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== "win32",
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        detached,
      });
    let output = "",
      truncated = false;
    const append = (channel, chunk) => {
      if (truncated) return;
      const data = String(chunk),
        next = output + data;
      if (Buffer.byteLength(next) > maxOutputBytes) {
        output = next.slice(0, maxOutputBytes);
        truncated = true;
      } else {
        output = next;
        onChunk?.(channel, data);
      }
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    const killGroup = () => {
      try {
        if (detached && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    let cancelled = false;
    const abort = () => {
        cancelled = true;
        killGroup();
      },
      timer = setTimeout(killGroup, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        Object.assign(new Error("Workspace process could not start."), {
          code: "process_start_failed",
          cause: error,
        }),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({
        code: cancelled ? 130 : (code ?? 124),
        output: cancelled ? `${output}Task cancelled.\n` : output || "Process completed without output.\n",
        truncated,
      });
    });
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}
