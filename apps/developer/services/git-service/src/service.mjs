import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import {
  detectSandbox,
  resolveExecutable,
  sandboxLaunch,
} from "../../workspace-agent/src/sandbox.mjs";
import {
  materializeSnapshot,
  readTextSnapshot,
} from "../../workspace-agent/src/workspace-files.mjs";

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
        ...(error.details ? { details: error.details } : {}),
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
    if (body.action === "commit-reviewed") {
      if (
        !Number.isInteger(body.expectedRevision) ||
        body.expectedRevision !== snapshot.revision
      )
        throw fault(
          "The workspace changed after Git review.",
          "git_preview_stale",
          409,
        );
      if (body.expectedInitialized !== initialized)
        throw fault(
          "The repository changed after Git review.",
          "git_preview_stale",
          409,
        );
      const paths = validPaths(body.paths),
        message = validMessage(body.message),
        identity = validIdentity(body),
        expectedHead = body.expectedHead == null ? null : validRevision(body.expectedHead),
        expectedBranch =
          body.expectedBranch == null ? null : validBranch(body.expectedBranch);
      if (!paths.length)
        throw fault(
          "Select at least one reviewed workspace path.",
          "git_paths_required",
          400,
        );
      if (!initialized)
        await initializeRepository(ownerRoot, repository, snapshot, git);
      return withWorkspace(snapshot, repository, git, async (context) => {
        const before = await status(context),
          actualPaths = before.changes
            .map((change) => change.path)
            .sort(),
          reviewedPaths = [...paths].sort();
        if (
          (initialized &&
            (before.head !== expectedHead || before.branch !== expectedBranch)) ||
          JSON.stringify(actualPaths) !== JSON.stringify(reviewedPaths)
        )
          throw fault(
            "The repository changed after Git review.",
            "git_preview_stale",
            409,
          );
        const staged = await command(context, ["add", "-A", "--", ...paths]);
        if (staged.code !== 0) throw gitFault(staged);
        const committed = await command(
          context,
          ["commit", "--no-gpg-sign", "--no-verify", "-m", message],
          {
            GIT_AUTHOR_NAME: identity.name,
            GIT_AUTHOR_EMAIL: identity.email,
            GIT_COMMITTER_NAME: identity.name,
            GIT_COMMITTER_EMAIL: identity.email,
          },
        );
        if (committed.code !== 0) throw gitFault(committed);
        return status(context);
      });
    }
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
      mutate({ ...context, owner, projectId, snapshot }, body),
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
  async function initializeRepository(ownerRoot, repository, snapshot, git) {
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
      const message = validMessage(body.message),
        { name, email } = validIdentity(body);
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
    if (body.action === "create-branch") {
      const branch = validBranch(body.branch),
        startPoint = body.startPoint ? validRevision(body.startPoint) : "HEAD",
        verified = await command(context, ["rev-parse", "--verify", startPoint]);
      if (verified.code !== 0)
        throw fault("Branch start point was not found.", "git_revision_not_found", 404);
      const result = await command(context, ["branch", branch, startPoint]);
      if (result.code !== 0) throw gitFault(result);
      return status(context);
    }
    if (body.action === "delete-branch") {
      if (body.approval !== "delete-branch-once")
        throw fault(
          "Deleting a branch requires one-time approval.",
          "git_branch_delete_approval_required",
          403,
        );
      const branch = validBranch(body.branch),
        current = await currentBranch(context);
      if (branch === current)
        throw fault("The current branch cannot be deleted.", "git_current_branch_delete", 409);
      const result = await command(context, ["branch", "-d", "--", branch]);
      if (result.code !== 0) throw gitFault(result);
      return status(context);
    }
    if (body.action === "checkout") {
      const branch = validBranch(body.branch);
      validateWorkspaceMutation(body, context.snapshot);
      await requireClean(context);
      await requireLocalBranch(context, branch);
      const originalBranch = await currentBranch(context),
        result = await command(context, ["checkout", "--quiet", branch]);
      if (result.code !== 0) throw gitFault(result);
      try {
        const workspace = await persistWorktree(context, body);
        return { ...(await status(context)), workspace };
      } catch (error) {
        await command(context, ["checkout", "--quiet", originalBranch]);
        throw error;
      }
    }
    if (body.action === "merge") {
      const branch = validBranch(body.branch),
        message = body.message
          ? validMessage(body.message)
          : `Merge branch '${branch}'`,
        { name, email } = validIdentity(body);
      validateWorkspaceMutation(body, context.snapshot);
      await requireClean(context);
      await requireLocalBranch(context, branch);
      const current = await currentBranch(context);
      if (branch === current)
        throw fault("A branch cannot be merged into itself.", "git_merge_same_branch", 409);
      const before = (await command(context, ["rev-parse", "HEAD"])).output.trim(),
        identityEnv = {
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: email,
        },
        merge = await command(
          context,
          ["merge", "--no-ff", "--no-commit", branch],
          identityEnv,
        );
      if (merge.code !== 0) {
        const conflicts = await conflictPaths(context);
        await command(context, ["merge", "--abort"]);
        if (conflicts.length)
          throw Object.assign(
            fault("Merge has conflicts and was aborted without changing the workspace.", "git_merge_conflict", 409),
            { details: { conflicts } },
          );
        throw gitFault(merge);
      }
      if (!/Already up[ -]to[ -]date\.?/i.test(merge.output)) {
        const committed = await command(
          context,
          ["commit", "--no-gpg-sign", "--no-verify", "-m", message],
          identityEnv,
        );
        if (committed.code !== 0) {
          await command(context, ["merge", "--abort"]);
          throw gitFault(committed);
        }
      }
      try {
        const workspace = await persistWorktree(context, body);
        return { ...(await status(context)), workspace };
      } catch (error) {
        await command(context, ["reset", "--hard", before]);
        throw error;
      }
    }
    if (body.action === "remote-preview")
      return remotePreview(context, body);
    throw fault("Unsupported Git mutation.", "unsupported_git_action", 400);
  }
  async function status(context) {
    const [branchResult, statusResult, logResult, branchesResult, headResult] = await Promise.all([
      command(context, ["branch", "--show-current"]),
      command(context, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      command(context, [
        "log",
        "-50",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
      ]),
      command(context, [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)%00%(objectname)%00%(objectname:short)%00%(committerdate:iso-strict)",
        "refs/heads",
      ]),
      command(context, ["rev-parse", "--verify", "HEAD"]),
    ]);
    if (statusResult.code !== 0) throw gitFault(statusResult);
    return {
      initialized: true,
      branch: branchResult.output.trim() || "main",
      head: headResult.code === 0 ? headResult.output.trim() : null,
      changes: parseStatus(statusResult.output),
      commits: parseLog(logResult.code === 0 ? logResult.output : ""),
      branches: parseBranches(branchesResult.code === 0 ? branchesResult.output : ""),
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
  async function currentBranch(context) {
    const result = await command(context, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (result.code !== 0)
      throw fault("Detached HEAD is not supported by this workspace broker.", "git_detached_head", 409);
    return result.output.trim();
  }
  async function requireClean(context) {
    const value = await status(context);
    if (value.changes.length)
      throw Object.assign(
        fault("Commit or discard workspace changes before switching or merging branches.", "git_workspace_dirty", 409),
        { details: { changes: value.changes.map((change) => change.path) } },
      );
  }
  async function requireLocalBranch(context, branch) {
    const result = await command(context, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (result.code !== 0)
      throw fault("Local branch was not found.", "git_branch_not_found", 404);
  }
  async function conflictPaths(context) {
    const result = await command(context, ["diff", "--name-only", "--diff-filter=U", "-z"]);
    return result.output.split("\0").filter(safePath).slice(0, 256);
  }
  async function persistWorktree(context, body) {
    const payload = await readTextSnapshot(context.workspace, context.snapshot),
      saved = workspaceStore.put(context.owner, context.projectId, {
        expectedRevision: body.expectedRevision,
        idempotencyKey: body.idempotencyKey,
        payload,
      });
    return { revision: saved.revision, updatedAt: saved.updatedAt, replayed: saved.replayed };
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
  async function runForOwner(owner, projectId, body = null) {
    if (typeof owner !== "string" || !owner)
      throw fault("A workspace owner is required.", "workspace_owner_required", 401);
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(projectId))
      throw fault("Invalid project identifier.", "invalid_project", 400);
    if (!sandbox.ready)
      throw fault(
        "The approved Git sandbox is unavailable.",
        "sandbox_unavailable",
        503,
      );
    const request = body
      ? Readable.from([Buffer.from(JSON.stringify(body))])
      : Readable.from([]);
    request.method = body ? "POST" : "GET";
    const url = new URL(`http://internal/runtime/git/${projectId}`);
    return exclusive(`${owner}:${projectId}`, () =>
      execute({ request, url, owner, projectId }),
    );
  }
  return {
    handler,
    runForOwner,
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
    // Git checkout and merge must materialize the selected revision into this
    // per-request snapshot before persistWorktree validates and saves it.
    // The temporary workspace is never a user-owned host path.
    writeWorkspace: true,
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
function parseBranches(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((record) => {
      const [name, hash, shortHash, date] = record.split("\0");
      return { name, hash, shortHash, date: date || null };
    })
    .filter((branch) => validBranchName(branch.name));
}
function validMessage(value) {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message || message.length > 4_096 || /[\0\r]/.test(message))
    throw fault("A valid commit message is required.", "invalid_git_message", 400);
  return message;
}
function validIdentity(value) {
  const name = typeof value.authorName === "string" ? value.authorName.trim() : "",
    email = typeof value.authorEmail === "string" ? value.authorEmail.trim() : "";
  if (!name || name.length > 160 || /[<>\0\r\n]/.test(name))
    throw fault("A valid Git author name is required.", "invalid_git_author", 400);
  if (
    !email ||
    email.length > 254 ||
    /[<>\0\r\n]/.test(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw fault("A valid Git author email is required.", "invalid_git_email", 400);
  return { name, email };
}
function validBranch(value) {
  if (!validBranchName(value))
    throw fault("A valid local branch name is required.", "invalid_git_branch", 400);
  return value;
}
function validBranchName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !/[\s~^:?*[\\\0-\x1f\x7f]/.test(value) &&
    !value.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  );
}
function validRevision(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    value.startsWith("-") ||
    !/^[A-Za-z0-9_./@{}~^+-]+$/.test(value)
  )
    throw fault("A valid Git revision is required.", "invalid_git_revision", 400);
  return value;
}
function validateWorkspaceMutation(body, snapshot) {
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
    throw fault("A non-negative workspace revision is required.", "invalid_revision", 400);
  if (
    typeof body.idempotencyKey !== "string" ||
    !/^[-A-Za-z0-9_]{8,160}$/.test(body.idempotencyKey)
  )
    throw fault("A valid idempotency key is required.", "invalid_idempotency_key", 400);
}
function remotePreview(_context, body) {
  const operation = body.operation;
  if (!["pull", "push", "create-pr"].includes(operation))
    throw fault("Select pull, push, or create-pr.", "invalid_git_remote_operation", 400);
  const remoteUrl = validRemoteUrl(body.remoteUrl),
    branch = validBranch(body.branch),
    targetBranch = operation === "create-pr" ? validBranch(body.targetBranch) : null,
    intent = { operation, remoteUrl, branch, targetBranch },
    previewDigest = createHash("sha256")
      .update(`${PROTOCOL}\0${JSON.stringify(intent)}`)
      .digest("hex");
  return {
    initialized: true,
    remoteIntent: intent,
    previewDigest,
    executable: false,
    boundary: "server-side-credential-broker-required",
    message:
      "Preview only. No network request or credential access occurred; execution remains disabled until an approved server-side credential broker is configured.",
  };
}
function validRemoteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fault("A valid HTTPS Git remote URL is required.", "invalid_git_remote_url", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.hostname.includes(".") ||
    url.hostname === "localhost" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
  )
    throw fault(
      "Only credential-free HTTPS remotes on public hosts can be previewed.",
      "invalid_git_remote_url",
      400,
    );
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname || url.pathname === "/")
    throw fault("The remote repository path is required.", "invalid_git_remote_url", 400);
  return url.toString();
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
