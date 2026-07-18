import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

export const GROK_BUILD_PIN = Object.freeze({
  repository: "https://github.com/xai-org/grok-build",
  commit: "98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce",
  sourceRev: "124d85bc5dc6e7805560215fcc6d5413944920e1",
  version: "0.2.102",
  command: ["agent", "stdio"],
  license: "Apache-2.0",
});

const CLIENT_METHODS = new Set(["initialize", "authenticate", "session/new", "session/load", "session/prompt", "session/cancel"]);
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const clone = (value) => structuredClone(value);

export async function sha256File(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

export async function verifyGrokBuildBinary({ binaryPath, expectedSHA256, spawnFactory = spawn }) {
  if (!binaryPath || !/^[a-f0-9]{64}$/.test(expectedSHA256 ?? "")) throw new Error("A Grok Build binary path and trusted SHA-256 are required.");
  await access(binaryPath, constants.X_OK);
  const actualSHA256 = await sha256File(binaryPath);
  if (actualSHA256 !== expectedSHA256) throw new Error("Grok Build binary SHA-256 does not match the approved local manifest.");
  const child = spawnFactory(binaryPath, ["--version"], { shell: false, stdio: ["ignore", "pipe", "pipe"], env: {} });
  let stdout = "", stderr = ""; child.stdout?.setEncoding?.("utf8"); child.stderr?.setEncoding?.("utf8"); child.stdout?.on?.("data", (part) => stdout += part); child.stderr?.on?.("data", (part) => stderr += part);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0) throw new Error(`Grok Build version check failed: ${stderr.trim() || `exit ${code}`}`);
  if (!stdout.includes(GROK_BUILD_PIN.version)) throw new Error(`Expected Grok Build ${GROK_BUILD_PIN.version}; received ${stdout.trim() || "no version"}.`);
  return Object.freeze({ binaryPath, actualSHA256, version: GROK_BUILD_PIN.version, verified: true });
}

export class GrokBuildACPClient {
  constructor({ binaryPath, cwd, env = {}, spawnFactory = spawn, permissionBroker = async () => ({ outcome: "cancelled" }), onNotification = () => {}, clock = Date.now } = {}) {
    if (!binaryPath || !cwd) throw new Error("ACP sidecar requires an approved binary path and project cwd.");
    this.binaryPath = binaryPath; this.cwd = cwd; this.env = Object.freeze({ ...env }); this.spawnFactory = spawnFactory; this.permissionBroker = permissionBroker; this.onNotification = onNotification; this.clock = clock;
    this.child = null; this.buffer = ""; this.sequence = 0; this.pending = new Map(); this.audit = [];
  }

  start() {
    if (this.child) throw new Error("ACP sidecar is already running.");
    this.child = this.spawnFactory(this.binaryPath, GROK_BUILD_PIN.command, { cwd: this.cwd, env: { ...this.env }, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8"); this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (part) => this.#read(part));
    this.child.stderr.on("data", (part) => this.#audit("sidecar.stderr", { text: String(part).slice(0, 2000) }));
    this.child.once("error", (error) => this.#failAll(error));
    this.child.once("close", (code, signal) => { this.#audit("sidecar.closed", { code, signal }); this.#failAll(new Error(`Grok Build ACP sidecar closed (${code ?? signal ?? "unknown"}).`)); this.child = null; });
    this.#audit("sidecar.started", { command: GROK_BUILD_PIN.command, cwd: this.cwd }); return this;
  }

  request(method, params = {}, { timeoutMs = 120_000 } = {}) {
    if (!this.child?.stdin?.writable) throw new Error("ACP sidecar is not running.");
    if (!CLIENT_METHODS.has(method)) throw new Error(`ACP client method is not allowlisted: ${method}`);
    const id = `ynx-${++this.sequence}`; const message = { jsonrpc: "2.0", id, method, params: clone(params) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`ACP ${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(`${JSON.stringify(message)}\n`); this.#audit("acp.request", { id, method });
    });
  }

  notify(method, params = {}) { if (!this.child?.stdin?.writable) throw new Error("ACP sidecar is not running."); if (method !== "session/cancel") throw new Error(`ACP notification is not allowlisted: ${method}`); this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params: clone(params) })}\n`); this.#audit("acp.notification.sent", { method }); }
  cancel(sessionId) { this.notify("session/cancel", { sessionId }); }
  close() { if (!this.child) return; this.child.stdin.end(); this.child.kill("SIGTERM"); this.#audit("sidecar.stop-requested", {}); }
  exportAudit() { return clone(this.audit); }

  #read(part) {
    this.buffer += part;
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) { this.#failAll(new Error("ACP sidecar emitted an oversized line.")); this.close(); return; }
    const lines = this.buffer.split("\n"); this.buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) this.#dispatch(line);
  }

  async #dispatch(line) {
    let message; try { message = JSON.parse(line); } catch { this.#audit("acp.invalid-json", {}); return; }
    if (message?.jsonrpc !== "2.0" || (!message.id && !message.method)) { this.#audit("acp.invalid-envelope", {}); return; }
    if (message.id && !message.method) {
      const pending = this.pending.get(String(message.id)); if (!pending) { this.#audit("acp.unknown-response", { id: String(message.id) }); return; }
      clearTimeout(pending.timer); this.pending.delete(String(message.id));
      if (message.error) pending.reject(new Error(`ACP ${pending.method} failed: ${message.error.message ?? "unknown error"}`)); else pending.resolve(clone(message.result));
      this.#audit("acp.response", { id: String(message.id), method: pending.method, ok: !message.error }); return;
    }
    if (message.id && message.method) {
      const decision = await this.permissionBroker(clone(message));
      const response = decision?.outcome === "selected" ? { jsonrpc: "2.0", id: message.id, result: clone(decision.result ?? decision) } : { jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "YNX AI Build permission denied or cancelled." } };
      this.child?.stdin?.write(`${JSON.stringify(response)}\n`); this.#audit("acp.agent-request", { method: message.method, allowed: decision?.outcome === "selected" }); return;
    }
    this.onNotification(clone(message)); this.#audit("acp.notification.received", { method: message.method });
  }

  #failAll(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  #audit(event, details) { this.audit.push({ sequence: this.audit.length + 1, at: new Date(this.clock()).toISOString(), event, details: clone(details) }); }
}
