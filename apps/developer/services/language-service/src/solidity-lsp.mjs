import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { detectSandbox, resolveExecutable, sandboxLaunch } from "../../workspace-agent/src/sandbox.mjs";
import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

export async function runSolidityLanguageRequest(request, options) {
  if (request?.operation === "diagnostics" && !options?.processFactory)
    return runCompilerDiagnostics(request);
  return runStdioLanguageRequest(request, {
    language: "solidity",
    label: "Solidity",
    extensions: new Set([".sol"]),
    serverCandidates: ["nomicfoundation-solidity-language-server"],
    serverName: "nomicfoundation-solidity-language-server",
    serverArgs: ["--stdio"],
    languageId: () => "solidity",
    memoryBytes: 2147483648,
    addressSpaceBytes: null,
    environment: { NODE_OPTIONS: "--max-old-space-size=512" },
    initializeTimeoutMs: 20_000,
    requestTimeoutMs: 20_000,
    openDelayMs: 900,
    completionAttempts: 4,
    completionRetryMs: 350,
    readOnlyBinds: solidityLanguageToolBinds,
  }, options);
}

async function solidityLanguageToolBinds(executable) {
  const packageRoot = dirname(dirname(executable));
  const nodeModules = dirname(dirname(packageRoot));
  const names = [
    "@nomicfoundation/solidity-language-server",
    "@nomicfoundation/solidity-analyzer",
    "@nomicfoundation/slang",
    "@bytecodealliance/preview2-shim",
  ];
  try {
    for (const entry of await readdir(join(nodeModules, "@nomicfoundation"), { withFileTypes: true }))
      if (entry.isDirectory() && entry.name.startsWith("solidity-analyzer-"))
        names.push(`@nomicfoundation/${entry.name}`);
  } catch {}
  const binds = [];
  for (const name of names) {
    const host = join(nodeModules, name);
    try {
      await realpath(host);
      binds.push({ host, guest: `/ynx-solidity-lsp/node_modules/${name}` });
    } catch {}
  }
  return binds;
}

async function runCompilerDiagnostics({ files, activePath }) {
  validateWorkspace(files, activePath);
  const sandbox = detectSandbox();
  if (!sandbox.ready) throw fault("No approved Solidity diagnostics sandbox is installed.", "lsp_sandbox_unavailable", 503);
  const executable = await resolveExecutable(["solcjs"]);
  if (!executable) throw fault("solcjs is not installed in this workspace runtime.", "language_server_unavailable", 503);
  const root = await realpath(await mkdtemp(join(tmpdir(), "ynx-code-solidity-diagnostics-")));
  try {
    await mkdir(join(root, ".tmp"), { mode: 0o700 });
    await mkdir(join(root, ".ynx-build"), { mode: 0o700 });
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { mode: 0o600, flag: "wx" });
    }
    const readOnlyBinds = await solidityCompilerToolBinds(executable);
    const launch = sandboxLaunch({ sandbox, workspace: root, command: executable, args: ["--standard-json"], readOnlyBinds, memoryBytes: 1073741824, addressSpaceBytes: null, environment: { NODE_OPTIONS: "--max-old-space-size=512" } });
    const input = JSON.stringify({ language: "Solidity", sources: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { content }])), settings: { outputSelection: { "*": { "*": [] } } } });
    const output = await runCompiler(launch, input);
    const start = output.indexOf("{");
    if (start < 0) throw fault("Solidity compiler returned an invalid diagnostics response.", "language_server_error", 503);
    const value = JSON.parse(output.slice(start));
    const result = (value.errors || []).filter(item => item.sourceLocation?.file === activePath).map(item => ({
      range: {
        start: offsetPosition(files[activePath], item.sourceLocation.start),
        end: offsetPosition(files[activePath], item.sourceLocation.end),
      },
      severity: item.severity === "error" ? 1 : item.severity === "warning" ? 2 : 3,
      code: item.errorCode || item.type,
      source: "solc",
      message: item.message || item.formattedMessage || "Solidity compiler diagnostic",
    }));
    return { protocolVersion: "ynx-code/v1", language: "solidity", operation: "diagnostics", result, server: { name: "solcjs", capabilities: { compilerDiagnostics: true } }, sandbox: { kind: sandbox.kind, network: false } };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function solidityCompilerToolBinds(executable) {
  const packageRoot = dirname(executable), nodeModules = dirname(packageRoot), names = ["solc", "command-exists", "commander", "follow-redirects", "js-sha3", "memorystream", "semver", "tmp"], binds = [];
  for (const name of names) {
    const host = join(nodeModules, name);
    try { await realpath(host); binds.push({ host, guest: `/ynx-solc/node_modules/${name}` }); } catch {}
  }
  return binds;
}

function runCompiler(launch, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, shell: false, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "", stderr = "", settled = false, timer;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const append = (current, chunk) => { const next = current + String(chunk); if (Buffer.byteLength(next) > 2 * 1024 * 1024) throw fault("Solidity diagnostics exceeded 2 MiB.", "language_response_too_large", 503); return next; };
    child.stdout.on("data", chunk => { try { stdout = append(stdout, chunk); } catch (error) { killGroup(child); finish(error); } });
    child.stderr.on("data", chunk => { try { stderr = append(stderr, chunk); } catch (error) { killGroup(child); finish(error); } });
    child.once("error", () => finish(fault("Solidity compiler could not start.", "language_server_unavailable", 503)));
    child.once("close", code => code === 0 ? finish(null, stdout) : finish(fault(stderr || "Solidity compiler failed.", "language_server_error", 503)));
    timer = setTimeout(() => { killGroup(child); finish(fault("Solidity diagnostics timed out.", "language_server_timeout", 504)); }, 8000);
    child.stdin.end(input);
  });
}

function validateWorkspace(files, activePath) {
  if (!files || typeof files !== "object" || Array.isArray(files) || Object.keys(files).length < 1 || Object.keys(files).length > 256 || !Object.hasOwn(files, activePath) || !activePath.endsWith(".sol")) throw fault("A valid Solidity workspace is required.", "invalid_language_request", 400);
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!safePath(path) || typeof content !== "string") throw fault("Solidity workspace contains an invalid file.", "invalid_language_workspace", 400);
    bytes += Buffer.byteLength(content);
    if (bytes > 2 * 1024 * 1024) throw fault("Solidity workspace exceeds 2 MiB.", "language_workspace_too_large", 413);
  }
}
function safePath(value) { return typeof value === "string" && value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(part => !part || part === "." || part === "..") && /^[A-Za-z0-9_./ +@-]+$/.test(value); }
function offsetPosition(source, byteOffset) { const prefix = Buffer.from(source).subarray(0, Math.max(0, byteOffset || 0)).toString("utf8"), lines = prefix.split("\n"); return { line: lines.length - 1, character: lines.at(-1).length }; }
function killGroup(child) { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {} }
function fault(message, code, status) { return Object.assign(new Error(message), { code, status }); }
