import { access, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function detectSandbox(options = {}) {
  if (options.sandbox) return options.sandbox;
  if (process.platform === "darwin")
    return { kind: "macos-sandbox-exec", ready: true };
  if (process.platform === "linux")
    return {
      kind: "linux-bubblewrap-prlimit",
      ready: commandExists("bwrap") && commandExists("prlimit"),
      // A Docker verifier may already have removed every external network
      // interface. In that case Bubblewrap can share the outer namespace
      // instead of requiring NET_ADMIN merely to configure a fresh loopback.
      outerNetworkIsolated: process.env.YNX_CODE_OUTER_NETWORK_ISOLATED === "1",
    };
  return { kind: `unsupported-${process.platform}`, ready: false };
}
export async function resolveExecutable(candidates) {
  for (const command of candidates) {
    for (const directory of String(process.env.PATH || "")
      .split(process.platform === "win32" ? ";" : ":")
      .filter(Boolean)) {
      const path = join(directory, command);
      try {
        await access(path, fsConstants.X_OK);
        return await realpath(path);
      } catch {}
    }
  }
  return null;
}
export function sandboxLaunch({
  sandbox,
  workspace,
  command,
  args = [],
  writeWorkspace = false,
  writableBinds = [],
  readOnlyBinds = [],
  memoryBytes = 1073741824,
  addressSpaceBytes = memoryBytes,
  environment = {},
}) {
  if (!Number.isInteger(memoryBytes) || memoryBytes < 268435456 || memoryBytes > 4294967296)
    throw Object.assign(new Error("Invalid sandbox memory limit."), { status: 500, code: "invalid_sandbox_limit" });
  if (addressSpaceBytes !== null && (!Number.isInteger(addressSpaceBytes) || addressSpaceBytes < 268435456 || addressSpaceBytes > 4294967296))
    throw Object.assign(new Error("Invalid sandbox address-space limit."), { status: 500, code: "invalid_sandbox_limit" });
  if (Object.entries(environment).some(([key,value]) => !["GOMAXPROCS","NODE_OPTIONS","RUST_SRC_PATH","RUSTUP_TOOLCHAIN"].includes(key) || typeof value !== "string" || value.length > 512))
    throw Object.assign(new Error("Invalid sandbox environment override."), { status: 500, code: "invalid_sandbox_environment" });
  if (environment.GOMAXPROCS && !/^[1-8]$/.test(environment.GOMAXPROCS))
    throw Object.assign(new Error("Invalid Go processor limit."), { status: 500, code: "invalid_sandbox_environment" });
  if (environment.NODE_OPTIONS && !/^--max-old-space-size=(256|384|512|768|1024)$/.test(environment.NODE_OPTIONS))
    throw Object.assign(new Error("Invalid Node.js memory option."), { status: 500, code: "invalid_sandbox_environment" });
  if (
    [...writableBinds, ...readOnlyBinds].some(
      ({ host, guest }) =>
        typeof host !== "string" ||
        !host.startsWith("/") ||
        typeof guest !== "string" ||
        !/^\/[A-Za-z0-9_@-]+(?:\/[A-Za-z0-9_@-]+)*$/.test(guest),
    )
  )
    throw Object.assign(new Error("Invalid sandbox bind."), {
      status: 500,
      code: "invalid_sandbox_bind",
    });
  if (sandbox.kind === "macos-sandbox-exec") {
    const originalHome = process.env.HOME
        ? resolve(process.env.HOME)
        : "/Users",
      escape = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'),
      extraReads = writableBinds
        .map(({ host }) => `(allow file-read* (subpath "${escape(host)}"))`)
        .join("\n"),
      extraWrites = writableBinds
        .map(({ host }) => `(allow file-write* (subpath "${escape(host)}"))`)
        .join("\n"),
      toolReads = readOnlyBinds
        .map(({ host }) => `(allow file-read* (subpath "${escape(host)}"))`)
        .join("\n"),
      toolMetadata = [...new Set(readOnlyBinds.flatMap(({ host }) => {
        const parents = [];
        for (let path = dirname(host); path !== "/"; path = dirname(path))
          parents.push(path);
        return parents;
      }))]
        .map((path) => `(allow file-read-metadata (literal "${escape(path)}"))`)
        .join("\n"),
      profile = `(version 1)\n(allow default)\n(deny network*)\n(deny file-read* (subpath "${escape(originalHome)}"))\n(allow file-read* (subpath "${escape(workspace)}"))\n${extraReads}\n(deny file-write*)\n(allow file-write* (subpath "${escape(workspace)}") (subpath "/private/tmp") (subpath "/dev"))\n${extraWrites}`;
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", `${profile}\n${toolMetadata}\n${toolReads}`, command, ...args],
      cwd: workspace,
      env: { ...runtimeEnvironment(workspace), ...environment },
    };
  }
  if (sandbox.kind === "linux-bubblewrap-prlimit") {
    const binds = [];
    for (const path of [
      "/usr",
      "/bin",
      "/lib",
      "/lib64",
      "/etc/alternatives",
      "/etc/ld.so.cache",
    ]) {
      try {
        if (process.getBuiltinModule("fs").existsSync(path))
          binds.push("--ro-bind", path, path);
      } catch {}
    }
    const translate = (value) => {
        if (value.startsWith(workspace))
          return `/workspace${value.slice(workspace.length)}`;
        const binding = writableBinds.find(({ host }) =>
          value.startsWith(host),
        ) || readOnlyBinds.find(({ host }) => value.startsWith(host));
        return binding
          ? `${binding.guest}${value.slice(binding.host.length)}`
          : value;
      },
      innerCommand = translate(command),
      workspaceBind = writeWorkspace
        ? ["--bind", workspace, "/workspace"]
        : [
            "--ro-bind",
            workspace,
            "/workspace",
            "--bind",
            join(workspace, ".ynx-build"),
            "/workspace/.ynx-build",
          ],
      extraBinds = writableBinds.flatMap(({ host, guest }) => [
        "--bind",
        host,
        guest,
      ]),
      toolBinds = readOnlyBinds.flatMap(({ host, guest }) => [
        "--ro-bind",
        host,
        guest,
      ]),
      namespaceFlags = sandbox.outerNetworkIsolated
        ? ["--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup"]
        : ["--unshare-all"],
      bubblewrap = [
        "bwrap",
        ...namespaceFlags,
        "--die-with-parent",
        "--new-session",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        ...binds,
        ...extraBinds,
        ...toolBinds,
        ...workspaceBind,
        "--chdir",
        "/workspace",
        "--setenv",
        "HOME",
        "/workspace",
        "--setenv",
        "TMPDIR",
        "/tmp",
        innerCommand,
        ...args.map(translate),
      ];
    return {
      command: "prlimit",
      args: [
        "--cpu=3600:3600",
        ...(addressSpaceBytes === null ? [] : [`--as=${addressSpaceBytes}:${addressSpaceBytes}`]),
        "--nproc=256:256",
        "--nofile=256:256",
        "--fsize=67108864:67108864",
        "--core=0:0",
        "--",
        ...bubblewrap,
      ],
      cwd: workspace,
      env: { ...runtimeEnvironment(workspace), ...environment },
    };
  }
  throw Object.assign(new Error("Approved sandbox is unavailable."), {
    status: 503,
    code: "sandbox_unavailable",
  });
}
export function runtimeEnvironment(workspace) {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: workspace,
    TMPDIR: join(workspace, ".tmp"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    GOCACHE: join(workspace, ".ynx-build", "go-cache"),
    GOMODCACHE: join(workspace, ".ynx-build", "go-mod-cache"),
    CARGO_HOME: join(workspace, ".ynx-build", "cargo-home"),
    RUSTUP_HOME: join(workspace, ".ynx-build", "rustup-home"),
  };
}
function commandExists(command) {
  return String(process.env.PATH || "")
    .split(":")
    .some((path) => {
      try {
        return Boolean(
          process
            .getBuiltinModule("fs")
            .accessSync(join(path, command), fsConstants.X_OK) === undefined,
        );
      } catch {
        return false;
      }
    });
}
