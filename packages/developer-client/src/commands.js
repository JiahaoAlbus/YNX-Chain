import { DeveloperError, invariant } from "./errors.js";

const ALLOWLIST = new Map([
  ["test", { command: "node --test test/*.test.js", environmentClass: "desktop-project-sandbox", risk: "write" }],
  ["check", { command: "node --check approved-js-files", environmentClass: "desktop-project-sandbox", risk: "read" }],
  ["git-diff", { command: "internal checkpoint diff", environmentClass: "browser-project", risk: "read" }]
]);

export function commandPreview(task, cwd) {
  const definition = ALLOWLIST.get(task);
  invariant(definition, "command_not_allowed", "Only product allowlisted build, test, check, and diff tasks can run.");
  invariant(typeof cwd === "string" && cwd.startsWith("/") && !cwd.includes(".."), "invalid_cwd", "Command cwd must be an absolute project path.");
  return { task, cwd, ...definition, approval: definition.risk === "read" ? "command" : "write-and-command" };
}

export class CommandAudit {
  constructor({ executor, clock = Date.now } = {}) { this.executor = executor; this.clock = clock; this.entries = []; this.active = new Map(); }
  async run(preview, approval, context = {}) {
    invariant(approval?.command === true, "command_approval_required", "Command execution requires explicit approval after preview.");
    if (preview.risk !== "read") invariant(approval?.write === true, "write_approval_required", "This command can write build artifacts and requires write approval.");
    invariant(typeof this.executor === "function", "desktop_executor_unavailable", "Web Product cannot execute local terminal commands. Use the unsigned local desktop package with an approved executor.");
    const controller = new AbortController();
    const entry = { id: crypto.randomUUID(), startedAt: new Date(this.clock()).toISOString(), ...preview, status: "running", output: "" };
    this.entries.push(entry); this.active.set(entry.id, controller);
    try {
      const result = await this.executor({ ...preview, ...context }, { signal: controller.signal, onChunk: (chunk) => { entry.output += String(chunk); } });
      entry.status = result?.code === 0 ? "passed" : "failed"; entry.exitCode = result?.code ?? null;
      return structuredClone(entry);
    } catch (error) {
      entry.status = controller.signal.aborted ? "cancelled" : "failed";
      entry.error = error instanceof Error ? error.message : String(error);
      return structuredClone(entry);
    } finally { entry.finishedAt = new Date(this.clock()).toISOString(); this.active.delete(entry.id); }
  }
  cancel(id) { const controller = this.active.get(id); if (!controller) throw new DeveloperError("command_not_running", "Command is not running."); controller.abort(); }
}
