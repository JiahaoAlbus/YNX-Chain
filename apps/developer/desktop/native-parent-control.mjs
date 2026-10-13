import { TextDecoder } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const owners = new WeakMap();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** One source-owned reader per native parent pipe. A subscription owns neither
 * the pipe nor another subscription's tasks. This transport grants no service. */
export function createNativeParentControl({ input, onError = () => {} }) {
  const previous = owners.get(input);
  if (previous) return previous;
  let buffer = Buffer.alloc(0), closed = false, listening = false, finishing;
  const routes = new Map(), subscriptions = new Set(), pending = new Set();
  let firstFailure;
  const report = error => { firstFailure ??= error; try { onError(error); } catch { /* retain original */ } };
  const track = promise => {
    const task = Promise.resolve(promise); pending.add(task);
    void task.then(() => pending.delete(task), error => { pending.delete(task); report(error); });
  };
  const retire = subscription => {
    if (subscription.retired) return;
    subscription.retired = true;
    for (const action of subscription.actions) routes.delete(action);
    subscriptions.delete(subscription);
    try { track(subscription.onClose()); } catch (error) { report(error); }
  };
  const close = () => {
    if (closed) return;
    closed = true; buffer = Buffer.alloc(0);
    input.removeListener('data', data); input.removeListener('end', ended);
    input.removeListener('close', ended); input.removeListener('error', failed);
    // Only this owner may pause the whole pipe, after all consumers retire.
    input.pause();
    for (const subscription of [...subscriptions]) retire(subscription);
  };
  const failed = error => { report(error); close(); };
  const ended = () => {
    if (buffer.length) report(Error('Native parent input ended inside a frame.'));
    close();
  };
  const data = chunk => {
    if (closed) return;
    if (!(chunk instanceof Uint8Array)) { failed(Error('Native parent input must contain bytes.')); return; }
    // A large chunk can contain many valid frames. Bound each unfinished frame,
    // rather than rejecting a valid batch based on the chunk's total length.
    let offset = 0;
    while (offset < chunk.length && !closed) {
      const newline = chunk.indexOf(10, offset), end = newline < 0 ? chunk.length : newline;
      if (buffer.length + end - offset > 262144) { failed(Error('Native parent frame exceeded its bound.')); return; }
      buffer = Buffer.concat([buffer, chunk.subarray(offset, end)]);
      offset = newline < 0 ? chunk.length : newline + 1;
      if (newline < 0) continue;
      try {
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        buffer = Buffer.alloc(0);
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') throw Error('Invalid native parent frame.');
        const subscription = routes.get(body.action);
        if (subscription && !subscription.retired) {
          if (Buffer.byteLength(raw) > subscription.maxFrameBytes) throw Error('Native parent consumer frame exceeded its bound.');
          if (pending.size >= 64) throw Error('Native parent pending work exceeded its bound.');
          // Hand the original field values to the one selected consumer. Wallet
          // canonicalInput stays an opaque string, never parsed/rebuilt here.
          track(subscription.receive(body));
        }
      } catch (error) { failed(error); }
    }
  };
  const owner = Object.freeze({
    subscribe({ actions, receive, onClose = () => {}, maxFrameBytes = 262144 }) {
      if (closed || !Array.isArray(actions) || !actions.length || new Set(actions).size !== actions.length
        || actions.some(action => typeof action !== 'string' || routes.has(action)) || typeof receive !== 'function'
        || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > 262144) throw Error('Native parent subscription is unavailable.');
      const subscription = { actions: [...actions], receive, onClose, maxFrameBytes, retired: false };
      subscriptions.add(subscription); for (const action of actions) routes.set(action, subscription);
      // Registration can follow an awaited private-directory setup. Keep stdin
      // buffered until its consumers exist, so first-use requests are not lost.
      if (!listening) { listening = true; input.on('data', data); input.resume(); }
      return Object.freeze({ close: () => retire(subscription) });
    },
    close,
    finishCleanup() {
      close();
      finishing ??= (async () => { while (pending.size) await Promise.allSettled([...pending]); return Object.freeze({ complete: !firstFailure, firstFailure }); })();
      return finishing;
    },
    status: () => Object.freeze({ closed, subscriptions: subscriptions.size, pending: pending.size, firstFailure }),
  });
  owners.set(input, owner);
  input.once('end', ended); input.once('close', ended); input.once('error', failed);
  return owner;
}

/** Local request custody only. Entry observations cannot authorize a dispatcher,
 * supply a Native borrow or acknowledge an authoritative terminal result. */
export function createNativeRequestCustody({ instance, context }) {
  if (!UUID.test(instance || '') || !UUID.test(context?.id || '') || typeof context.workspace !== 'string') throw Error('Native request context is invalid.');
  const requests = new Map(); let retired = false;
  return Object.freeze({
    reserve(body) {
      if (retired || requests.size >= 32 || !body || !UUID.test(body.id || '') || !UUID.test(body.document || '')
        || body.instance !== instance || body.projectId !== context.id || body.workspace !== context.workspace
        || typeof body.canonicalInput !== 'string' || Buffer.byteLength(body.canonicalInput) > 65536
        || requests.has(body.id)) throw Error('Native request is stale, duplicate or invalid.');
      const row = { id: body.id, document: body.document, canonicalInput: body.canonicalInput, entered: false, unknown: false, cancelled: false, result: undefined, completed: false };
      requests.set(body.id, row); return row;
    },
    cancel(id, document) { const row = requests.get(id); if (row && row.document === document) row.cancelled = true; },
    retire() { if (retired) return; retired = true; for (const row of requests.values()) row.cancelled = true; },
    observeEntry(row) {
      if (requests.get(row?.id) !== row || retired || row.cancelled || row.completed || row.entered) throw Error('Native request cannot enter.');
      row.entered = true; row.unknown = true;
    },
    retainCompletion(row, result) {
      if (requests.get(row?.id) !== row || row.completed) throw Error('Native request completion is duplicate.');
      row.completed = true; row.result = result;
      // Never clear UNKNOWN: only the original service can establish terminal
      // evidence. A late result is retained but cannot revive a cancelled UI.
      return !retired && !row.cancelled;
    },
    request: id => requests.get(id),
    status: () => Object.freeze({ retired, count: requests.size, unknown: [...requests.values()].some(row => row.unknown) }),
  });
}

// Private envelope request IDs are distinct from the canonical req_* ID. Neither
// an instance UUID nor this schema is evidence of original service admission.
export function nativeOriginalServiceEnvelope(body) {
  const fields = body?.action === 'original-service-dispatch'
    ? ['action', 'id', 'document', 'instance', 'projectId', 'workspace', 'canonicalInput']
    : body?.action === 'original-service-cancel' ? ['action', 'id', 'document', 'instance', 'projectId', 'workspace'] : [];
  return fields.length > 0 && body && Object.keys(body).sort().join(',') === fields.sort().join(',');
}

/** No original service producer has been supplied yet. Return a concrete
 * pre-entry failure through the private parent result directory; no private
 * method, endpoint, callback factory or renderer borrow is selected here. */
export function attachUnavailableOriginalServiceChannel({ control, instance, context, directory, onError = () => {} }) {
  const custody = createNativeRequestCustody({ instance, context });
  const owned = new Set(); let closed = false, firstFailure;
  const writeResult = async (body, row) => {
    const before = await fs.lstat(directory);
    if (!before.isDirectory() || before.uid !== process.getuid() || (before.mode & 0o777) !== 0o700) throw Error('Native parent result directory is unsafe.');
    const result = { id: body.id, document: body.document, instance, projectId: context.id,
      status: 'unavailable', entered: false, unknown: false, error: 'ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED' };
    const pendingPath = path.join(directory, '.wallet-' + body.id + '-' + randomUUID());
    const target = path.join(directory, 'wallet-' + body.id + '.json');
    const handle = await fs.open(pendingPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(result) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    const current = await fs.lstat(directory);
    if (current.dev !== before.dev || current.ino !== before.ino || current.uid !== before.uid || (current.mode & 0o777) !== 0o700) throw Error('Native parent result directory changed.');
    // Exclusive link gives an atomic, non-overwriting complete result. A failed
    // publication leaves only our private staging file for cleanup diagnosis.
    await fs.link(pendingPath, target); await fs.unlink(pendingPath);
    custody.retainCompletion(row, result);
  };
  const finishCleanup = async () => { while (owned.size) await Promise.allSettled([...owned]); return Object.freeze({ complete: !firstFailure, firstFailure }); };
  const subscription = control.subscribe({ actions: ['original-service-dispatch', 'original-service-cancel'],
    receive(body) {
      if (closed || !nativeOriginalServiceEnvelope(body) || body.instance !== instance || body.projectId !== context.id || body.workspace !== context.workspace) return;
      if (body.action === 'original-service-cancel') { custody.cancel(body.id, body.document); return; }
      let row; try { row = custody.reserve(body); } catch (error) { onError(error); return; }
      const task = writeResult(body, row).catch(error => { firstFailure ??= error; onError(error); throw error; }); owned.add(task);
      void task.finally(() => owned.delete(task)).catch(() => {}); return task;
    }, onClose() { closed = true; custody.retire(); return finishCleanup(); },
  });
  return Object.freeze({ close() { closed = true; custody.retire(); subscription.close(); }, finishCleanup, status: () => Object.freeze({ ...custody.status(), cleanupFailure: firstFailure }) });
}
