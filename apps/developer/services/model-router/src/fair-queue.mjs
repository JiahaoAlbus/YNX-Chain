// Process-local admission control. Owner IDs come from the authenticated host,
// never the browser's provider configuration. This does not coordinate replicas.
export function createFairQueue({ maxConcurrent, maxQueued, maxPerOwner,
  maxQueuedPerOwner, maxHostedConcurrent, queueTimeoutMs, run }) {
  const owners = new Map(), order = [], activeOwners = new Map();
  let active = 0, hostedActive = 0, queued = 0;
  const state = () => ({ active, queued, hostedActive,
    byoActive: active - hostedActive, maxConcurrent, maxQueued,
    maxPerOwner, maxQueuedPerOwner, maxHostedConcurrent, queueTimeoutMs });

  function remove(task) {
    const tasks = owners.get(task.owner);
    const index = tasks?.indexOf(task) ?? -1;
    if (index < 0) return false;
    tasks.splice(index, 1);
    queued -= 1;
    if (!tasks.length) {
      owners.delete(task.owner);
      order.splice(order.indexOf(task.owner), 1);
    }
    cleanup(task);
    return true;
  }
  function cleanup(task) {
    clearTimeout(task.timer);
    task.input.signal?.removeEventListener("abort", task.abort);
  }
  function eligible(task) {
    return active < maxConcurrent &&
      (activeOwners.get(task.owner) || 0) < maxPerOwner &&
      (task.input.provider !== "ynx-hosted" || hostedActive < maxHostedConcurrent);
  }
  function pump() {
    while (active < maxConcurrent && order.length) {
      let selected;
      // Rotate once per owner, even when that owner has many queued requests.
      for (let attempts = order.length; attempts > 0; attempts -= 1) {
        const owner = order.shift(), tasks = owners.get(owner), task = tasks[0];
        order.push(owner);
        if (eligible(task)) { selected = task; break; }
      }
      if (!selected) break;
      remove(selected);
      active += 1;
      activeOwners.set(selected.owner, (activeOwners.get(selected.owner) || 0) + 1);
      if (selected.input.provider === "ynx-hosted") hostedActive += 1;
      Promise.resolve().then(() => run(selected.input)).then(selected.resolve, selected.reject)
        .finally(() => {
          active -= 1;
          const count = activeOwners.get(selected.owner) - 1;
          if (count) activeOwners.set(selected.owner, count);
          else activeOwners.delete(selected.owner);
          if (selected.input.provider === "ynx-hosted") hostedActive -= 1;
          pump();
        });
    }
  }
  function schedule(input) {
    if (input.signal?.aborted) return Promise.reject(cancelled());
    const owner = input.ownerId;
    const task = { owner, input };
    // A free slot can admit a new owner even while another owner's queue is full.
    if (!eligible(task)) {
      if ((owners.get(owner)?.length || 0) >= maxQueuedPerOwner)
        return Promise.reject(fault("Your AI queue is full. Wait for a running task or cancel one.", "model_owner_queue_full", 429));
      if (queued >= maxQueued)
        return Promise.reject(fault("AI capacity is full. Retry shortly.", "model_queue_full", 503));
    }
    return new Promise((resolve, reject) => {
      Object.assign(task, { resolve, reject, timer: null, abort: null });
      task.abort = () => { if (remove(task)) { reject(cancelled()); pump(); } };
      input.signal?.addEventListener("abort", task.abort, { once: true });
      if (!owners.has(owner)) { owners.set(owner, []); order.push(owner); }
      owners.get(owner).push(task);
      queued += 1;
      task.timer = setTimeout(() => {
        if (remove(task)) {
          reject(fault("AI queue wait expired. Retry or choose another provider.", "model_queue_timeout", 504));
          pump();
        }
      }, queueTimeoutMs);
      pump();
      // A later request from the same owner cannot skip its earlier blocked
      // request merely because its provider would have a free execution slot.
      if (owners.get(owner)?.includes(task)) {
        const ownerFull = owners.get(owner).length > maxQueuedPerOwner;
        if (ownerFull || queued > maxQueued) {
          remove(task);
          reject(ownerFull
            ? fault("Your AI queue is full. Wait for a running task or cancel one.", "model_owner_queue_full", 429)
            : fault("AI capacity is full. Retry shortly.", "model_queue_full", 503));
        }
      }
    });
  }
  return { schedule, state };
}

function fault(message, code, status) { return Object.assign(new Error(message), { code, status }); }
function cancelled() { return fault("AI request was cancelled after the client disconnected.", "model_request_cancelled", 499); }
