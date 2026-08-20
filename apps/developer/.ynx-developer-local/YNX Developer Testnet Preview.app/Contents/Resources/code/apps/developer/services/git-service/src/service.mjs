import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  detectSandbox,
  resolveExecutable,
  sandboxLaunch,
} from "../../workspace-agent/src/sandbox.mjs";
import { materializeSnapshot } from "../../workspace-agent/src/workspace-files.mjs";

const PROTOCOL = "ynx-code-git-v1",
  MAX_OUTPUT = 2 * 1024 * 1024;

export function createGitService(options) {
  const { workspaceStore, ownerForRequest } = options,
    root = options.root || join(tmpdir(), "ynx-code-git"),
    sandbox = detectSandbox(options),
    locks = new Map();
  async function handler(request, response) {
    const url = new URL(
        request.url,
        `http://${request.headers.host || "127.0.0.1"}`,
      ),
      match = url.pathname.match(/^\/runtime\/git\/([A-Za-z0-9_-]{1,160})$/);
    if (!match) return false;
    const owner = ownerForRequest(request);
    if (!owner) {
      json(response, 401, {
        error: "A signed workspace session is required.",
        code: "workspace_session_required",
      });
      return true;
    }
    if (!sandbox.ready) {
      json(response, 503, {
        error: "The approved Git sandbox is unavailable.",
        code: "sandbox_unavailable",
      });
      return true;
    }
    const projectId = match[1];
    try {
      const result = await exclusive(`${owner}:${projectId}`, () =>
        execute({ request, url, owner, projectId }),
      );
      json(response, 200, { protocolVersion: PROTOCOL, ...result });
    } catch (error) {
      json(response, error.status || 400, {
        error: error.publicMessage || error.message || "Git operation failed.",
        code: error.code || "git_operation_failed",
      });
    }
    return true;
  }
  async function execute({ request, url, owner, projectId }) {
    const snapshot = workspaceStore.get(owner, projectId);
    if (!snapshot)
      throw fault("Workspace was not found.", "workspace_not_found", 404);
    const git = options.gitPath || (await resolveExecutable(["git"]));
    if (!git)
      throw fault(
        "Git is not installed in the selected runtime.",
        "git_unavailable",
        503,
      );
    const ownerRoot = join(root, owner),
      repository = join(ownerRoot, `${projectId}.git`),
      initialized = await isRepository(repository);
    if (request.method === "GET") {
      if (!initialized)
        return { initialized: false, branch: null, changes: [], commits: [] };
      return withWorkspace(snapshot, repository, git, async (context) =>
        url.searchParams.get("view") === "diff"
          ? diff(context, url)
          : status(context),
      );
    }
    if (request.method !== "POST")
      throw fault("Method not allowed.", "method_not_allowed", 405);
    const body = JSON.parse(
      (await readBody(request, 256 * 1024)).toString("utf8"),
    );
    if (body.protocolVersion !== PROTOCOL)
      throw fault(
        "Git protocol version is required.",
        "protocol_mismatch",
        400,
      );
    if (body.action === "init") {
      if (initialized)
        return {
          ...(await withWorkspace(snapshot, repository, git, status)),
          replayed: true,
        };
      await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
      await mkdir(repository, { mode: 0o700 });
      const canonical = await realpath(repository),
        workspace = await temporaryWorkspace(snapshot);
      try {
        const launch = sandboxLaunch({
          sandbox,
          workspace,
          command: git,
          args: ["init", "--bare", "--initial-branch=main", canonical],
          writableBinds: [{ host: canonical, guest: "/repo" }],
        });
        const result = await run(launch, 15_000);
        if (result.code !== 0) throw gitFault(result);
        return {
          ...(await status({ git, sandbox, workspace, repository: canonical })),
          replayed: false,
        };
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
    if (!initialized)
      throw fault(
        "Initialize the repository first.",
        "repository_not_initialized",
        409,
      );
    return withWorkspace(snapshot, repository, git, async (context) =>
      mutate(context, body),
    );
  }
  async function withWorkspace(snapshot, repository, git, operation) {
    const workspace = await temporaryWorkspace(snapshot),
      canonical = await realpath(repository);
    try {
      return await operation({
        git,
        sandbox,
        workspace,
        repository: canonical,
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
  async function mutate(context, body) {
    if (body.action === "stage" || body.action === "unstage") {
      const paths = validPaths(body.paths);
      if (!paths.length)
        throw fault(
          "Select at least one workspace path.",
          "git_paths_required",
          400,
        );
      const args =
          body.action === "stage"
            ? ["add", "-A", "--", ...paths]
            : (await hasHead(context))
              ? ["reset", "-q", "HEAD", "--", ...paths]
              : ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths],
        result = await command(context, args);
      if (result.code !== 0) throw gitFault(result);
      return status(context);
    }
    if (body.action === "commit") {
      const message =
          typeof body.message === "string" ? body.message.trim() : "",
        name =
          typeof body.authorName === "string" ? body.authorName.trim() : "",
        email =
          typeof body.authorEmail === "string" ? body.authorEmail.trim() : "";
      if (
        message.length < 1 ||
        message.length > 4000 ||
        name.length < 1 ||
        name.length > 160 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      )
        throw fault(
          "A commit message and valid author identity are required.",
          "invalid_commit",
          400,
        );
      const result = await command(
        context,
        ["commit", "--no-gpg-sign", "--no-verify", "-m", message],
        {
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: email,
        },
      );
      if (result.code !== 0) throw gitFault(result);
      return status(context);
    }
    throw fault("Unsupported Git mutation.", "unsupported_git_action", 400);
  }
  async function status(context) {
    const [branchResult, statusResult, logResult] = await Promise.all([
      command(context, ["branch", "--show-current"]),
      command(context, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      command(context, [
        "log",
        "-10",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
      ]),
    ]);
    if (statusResult.code !== 0) throw gitFault(statusResult);
    return {
      initialized: true,
      branch: branchResult.output.trim() || "main",
      changes: parseStatus(statusResult.output),
      commits: parseLog(logResult.code === 0 ? logResult.output : ""),
    };
  }
  async function diff(context, url) {
    const scope =
        url.searchParams.get("scope") === "staged" ? "staged" : "working",
      path = url.searchParams.get("path"),
      args = ["diff", "--no-ext-diff", "--no-color"];
    if (scope === "staged") args.push("--cached");
    if (path) {
      if (!safePath(path))
        throw fault("Invalid Git path.", "invalid_git_path", 400);
      args.push("--", path);
    }
    const result = await command(context, args);
    if (result.code !== 0) throw gitFault(result);
    return {
      initialized: true,
      scope,
      path: path || null,
      diff: result.output,
    };
  }
  function command(context, args, extraEnv = {}) {
    return run(gitLaunch({ ...context, args }), 15_000, extraEnv);
  }
  async function hasHead(context) {
    return (
      (await command(context, ["rev-parse", "--verify", "HEAD"])).code === 0
    );
  }
  async function exclusive(key, work) {
    const previous = locks.get(key) || Promise.resolve(),
      current = previous.catch(() => {}).then(work);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }
  return {
    handler,
    status: () => ({
      activeRepositories: locks.size,
      sandbox: sandbox.kind,
      sandboxReady: sandbox.ready,
    }),
  };
}

function gitLaunch({ git, sandbox, workspace, repository, args }) {
  const common = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "diff.external=",
    "--git-dir",
    repository,
    "--work-tree",
    workspace,
    ...args,
  ];
  return sandboxLaunch({
    sandbox,
    workspace,
    command: git,
    args: common,
    writableBinds: [{ host: repository, guest: "/repo" }],
  });
}
async function temporaryWorkspace(snapshot) {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "ynx-git-worktree-")),
  );
  await mkdir(join(workspace, ".tmp"), { mode: 0o700 });
  await mkdir(join(workspace, ".ynx-build"), { mode: 0o700 });
  await materializeSnapshot(workspace, snapshot);
  return workspace;
}
function run(launch, timeout, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: {
        ...launch.env,
        ...extraEnv,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "",
      truncated = false;
    const append = (chunk) => {
      if (truncated) return;
      output += String(chunk);
      if (Buffer.byteLength(output) > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT);
        truncated = true;
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
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
      resolveRun({ code: code ?? 124, output, truncated });
    });
  });
}
async function isRepository(path) {
  try {
    return (await stat(join(path, "HEAD"))).isFile();
  } catch {
    return false;
  }
}
function parseStatus(output) {
  const records = output.split("\0").filter(Boolean),
    changes = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index],
      status = record.slice(0, 2),
      path = record.slice(3);
    if (!path) continue;
    const change = {
      path,
      status,
      indexStatus: status[0],
      worktreeStatus: status[1],
    };
    if (status[0] === "R" || status[0] === "C")
      change.originalPath = records[++index];
    changes.push(change);
  }
  return changes;
}
function parseLog(output) {
  return output
    .split("\x1e")
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, date, subject] = record.split("\x1f");
      return { hash, shortHash, author, date, subject };
    });
}
function validPaths(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(safePath))].slice(0, 256)
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
async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit)
      throw fault("Git request is too large.", "git_request_too_large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function gitFault(result) {
  return Object.assign(
    fault("Git command failed.", "git_command_failed", 409),
    { publicMessage: `Git command failed:\n${result.output.slice(0, 32_000)}` },
  );
}
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
function fault(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
