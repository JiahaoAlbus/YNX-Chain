import { AsyncLocalStorage } from "node:async_hooks";
import { open, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

export function maintenanceError() {
  return Object.assign(new Error("Code is undergoing maintenance. Your saved workspace is retained; retry after service returns."), {
    code: "service_maintenance", status: 503,
  });
}

// These counts describe work admitted by this gateway process. Persistent cloud
// runtimes are resources, not proof that remote applications have stopped.
export function createActivityRegistry() {
  const context = new AsyncLocalStorage(), requests = new Set(), operations = new Set(), probes = new Map();
  let phase = "serving", reason = null, cancelled = 0, unsafeCleanupCount = 0;
  function beginMaintenance(value = "operator") {
    if (phase === "serving") { phase = "draining"; reason = value; }
  }
  function begin(category, collection, admittedParent = false) {
    if (phase !== "serving" && !(phase === "draining" && admittedParent && context.getStore()?.active)) throw maintenanceError();
    const item = { category, active: true, controller: new AbortController() };
    collection.add(item);
    item.finish = () => { item.active = false; collection.delete(item); };
    return item;
  }
  async function operation(category, work) {
    const item = begin(category, operations, true);
    try { return await work(item.controller.signal); }
    catch (error) { if (["child_exit_timeout", "remote_terminal_recovery_required"].includes(error?.code)) unsafeCleanupCount++; throw error; }
    finally { item.finish(); }
  }
  function admitRequest(category) { return begin(category, requests); }
  function counts(collection) {
    const byCategory = {};
    for (const item of collection) byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    return { total: collection.size, byCategory };
  }
  function snapshot() {
    const services = Object.fromEntries([...probes].map(([name, probe]) => [name, probe()]));
    return { accepting: phase === "serving", phase, reason, requests: counts(requests), operations: counts(operations), services,
      cancellationRequests: cancelled, unsafeCleanupCount, scope: "this gateway's admitted requests, operations and interactive sessions; persistent remote applications are not stopped" };
  }
  function idle() {
    return !unsafeCleanupCount && !requests.size && !operations.size && [...probes.values()].every(probe =>
      Object.entries(probe()).every(([name, count]) => name === "cleanupFailures" || name === "recoveryRequired" || count === 0));
  }
  async function waitIdle(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (idle()) return true;
      await new Promise(resolve => setTimeout(resolve, Math.min(20, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    return idle();
  }
  function cancel() {
    phase = "cancelling";
    for (const item of [...requests, ...operations]) {
      if (!item.controller.signal.aborted) { cancelled++; item.controller.abort(maintenanceError()); }
    }
  }
  return { beginMaintenance, admitRequest, operation, snapshot, idle, waitIdle, cancel,
    recoveryRequired: () => [...probes.values()].some(probe => probe().recoveryRequired > 0),
    accepting: () => phase === "serving",
    runRequest: (item, work) => context.run(item, work),
    observe: (name, probe) => probes.set(name, probe),
    complete: () => { phase = "maintenance"; }, fail: () => { phase = "failed"; } };
}

export function requestCategory(path) {
  const routes = [
    ["/runtime/agent", "agent"], ["/runtime/models", "ai"], ["/runtime/language", "language"],
    ["/runtime/tasks", "compile"], ["/runtime/execute", "compile"], ["/runtime/run", "compile"],
    ["/runtime/terminals", "terminal"], ["/runtime/debug", "debug"], ["/runtime/collaboration", "collaboration"],
    ["/runtime/git", "git"], ["/runtime/environments", "environment"], ["/runtime/memory", "memory"],
    ["/runtime/extensions", "extensions"], ["/runtime/chain", "chain"], ["/runtime/wallet", "wallet"],
    ["/runtime/workspaces", "workspace"], ["/runtime", "runtime"],
  ];
  return routes.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"))?.[1] || "assets";
}

export function maintenanceResponse(response, accepted = false) {
  const error = maintenanceError();
  response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "30", connection: "close" });
  response.end(JSON.stringify({ error: accepted ? "Maintenance interrupted this request. It may have completed; reload the saved workspace or operation state before retrying." : error.message,
    code: error.code, retryable: true, automaticRetry: false, outcome: accepted ? "reload-before-retry" : "not-admitted" }));
}

export function guardRequests(activity, handler) {
  return function(request, response) {
    let path;
    try { path = new URL(request.url, "http://localhost").pathname; }
    catch { response.writeHead(400, { connection: "close" }); response.end("Invalid request URL."); return; }
    if (path === "/healthz" || path === "/readyz") return handler(request, response);
    let ticket;
    try { ticket = activity.admitRequest(requestCategory(path)); }
    catch { maintenanceResponse(response); return; }
    request.maintenanceSignal = ticket.controller.signal;
    let handlerDone = false, responseDone = false;
    const finish = () => { if (handlerDone && responseDone) ticket.finish(); };
    for (const event of ["finish", "close"]) response.once(event, () => { responseDone = true; finish(); });
    ticket.controller.signal.addEventListener("abort", () => {
      if (!response.headersSent && !response.destroyed) maintenanceResponse(response, true);
      else response.destroy();
      request.destroy();
    }, { once: true });
    return activity.runRequest(ticket, async () => {
      try { await handler(request, response); }
      finally { handlerDone = true; finish(); }
    });
  };
}

export async function writeMaintenanceReceipt(filename, value) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + ".tmp", stream = await open(temporary, "w", 0o600);
  try { await stream.writeFile(JSON.stringify(value, null, 2) + "\n"); await stream.sync(); }
  finally { await stream.close(); }
  await rename(temporary, filename);
  const directory = await open(dirname(filename), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

export function createMaintenance({ activity, stopInteractive, cancelWork, closeStores, checkpoint,
  drainTimeoutMs = 30_000, cancelTimeoutMs = 10_000 }) {
  let promise;
  return function maintain(reason = "operator") {
    if (promise) return promise;
    activity.beginMaintenance(reason); // Synchronous: no await before admission closes.
    promise = (async () => {
      let interactiveDone = false, interactiveError;
      const interactive = Promise.resolve().then(stopInteractive).then(
        () => { interactiveDone = true; }, error => { interactiveError = error; interactiveDone = true; });
      const wait = async (duration) => {
        const deadline = Date.now() + duration;
        while (Date.now() < deadline) {
          if (interactiveDone && activity.idle()) return true;
          await activity.waitIdle(Math.min(20, Math.max(1, deadline - Date.now())));
          // idle HTTP with still-closing sessions must not starve I/O.
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        return interactiveDone && activity.idle();
      };
      let drained = await wait(drainTimeoutMs), forcedCancellation = false;
      if (!drained) {
        forcedCancellation = true; activity.cancel(); await cancelWork();
        drained = await wait(cancelTimeoutMs);
      }
      if (!drained || interactiveError || activity.recoveryRequired()) {
        activity.fail();
        await checkpoint({ status: "failed", cleanShutdown: false, forcedCancellation,
          reason: !drained ? "maintenance_timeout" : interactiveError ? "interactive_state_not_saved" : "runtime_recovery_required", activity: activity.snapshot() });
        // Live work may still access SQLite. Never close it underneath that work.
        return { cleanShutdown: false, exitCode: 1, timedOut: !drained };
      }
      await interactive;
      await checkpoint({ status: "drained", cleanShutdown: false, forcedCancellation, activity: activity.snapshot() });
      await closeStores();
      activity.complete();
      await checkpoint({ status: "maintenance", cleanShutdown: true, forcedCancellation, activity: activity.snapshot() });
      return { cleanShutdown: true, exitCode: 0, forcedCancellation };
    })().catch(async error => {
      activity.fail();
      try { await checkpoint({ status: "failed", cleanShutdown: false, reason: "maintenance_cleanup_failed", activity: activity.snapshot() }); } catch {}
      return { cleanShutdown: false, exitCode: 1, reason: error.code || "maintenance_cleanup_failed" };
    });
    return promise;
  };
}
