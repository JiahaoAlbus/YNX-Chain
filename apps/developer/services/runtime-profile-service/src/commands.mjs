import { spawn } from "node:child_process";

export function createCommandRunner({ spawnProcess = spawn, reapTimeoutMs = 4000 } = {}) {
  const children = new Set(); let unsafeCleanup = 0;
  const fault = (message, code) => Object.assign(new Error(message), { code });
  function run(command, args, options = {}) {
    if (options.signal?.aborted) return Promise.reject(fault("Runtime command cancelled for maintenance.", "service_maintenance"));
    const maximum = options.maxBuffer || 1024 * 1024, timeout = options.timeout || 10_000;
    return new Promise((resolve, reject) => {
      let child, timer, reapTimer, size = 0, failure, settled = false, closed = false;
      const stdout = [], stderr = [];
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(reapTimer);
        options.signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      function kill() {
        if (closed) return;
        try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); } catch {}
        try { child.kill("SIGKILL"); } catch {}
      }
      function stop(error) {
        failure ||= error; kill();
        if (!reapTimer && !closed) reapTimer = setTimeout(() => {
          if (closed) return;
          unsafeCleanup++;
          finish(fault("Runtime command did not exit. Its state is retained for recovery.", "child_exit_timeout"));
          // Keep the child counted until close even after the caller receives
          // failure; a settled Promise is not proof that execution stopped.
        }, reapTimeoutMs);
      }
      const abort = () => stop(fault("Runtime command cancelled for maintenance.", "service_maintenance"));
      try { child = spawnProcess(command, args, { stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], detached: process.platform !== "win32" }); }
      catch (error) { finish(error); return; }
      children.add(child);
      child.once("error", error => { if (!child.pid) { closed = true; children.delete(child); finish(error); } else stop(error); });
      child.once("close", (code, signal) => {
        closed = true; children.delete(child);
        const value = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
        finish(failure || (code === 0 ? null : Object.assign(fault(`${command} exited unsuccessfully.`, "command_failed"), { exitCode: code, signal, ...value })), value);
      });
      for (const [channel, target] of [[child.stdout, stdout], [child.stderr, stderr]]) {
        channel.on("error", error => stop(error));
        channel.on("data", chunk => {
          if (failure || settled) return;
          size += chunk.length;
          if (size > maximum) { stop(fault("Runtime command output exceeded its boundary.", "max_buffer")); return; }
          target.push(chunk);
        });
      }
      if (child.stdin) { child.stdin.on("error", error => stop(error)); child.stdin.end(options.input); }
      timer = setTimeout(() => stop(fault("Runtime command exceeded its time boundary.", "timeout")), timeout);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
  return { run, status: () => ({ active: children.size, unsafeCleanup }) };
}

const commands = createCommandRunner();
export const runFile = commands.run;
export const commandStatus = commands.status;
