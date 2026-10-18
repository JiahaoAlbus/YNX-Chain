import fs from 'node:fs/promises';
import { constants, linkSync, unlinkSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { attachUnavailableOriginalServiceChannel, NATIVE_ORIGINAL_SERVICE_FRAME_LIMIT } from './native-parent-control.mjs';
import { originalServiceForRunningEntry, runEnteredOriginalServiceForRunningEntry } from './wallet-admission-delivery.mjs';

// Transport only. The original SDK owns parsing, admission, journal, execution
// and terminal proof. This is not an acquisition/provider registration API.
export const ORIGINAL_SERVICE_PIPE_SCHEMA = 'ynx-ide-original-service-pipe/v1';
export const ORIGINAL_SERVICE_PIPE_FRAME_LIMIT = NATIVE_ORIGINAL_SERVICE_FRAME_LIMIT;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const hash = raw => createHash('sha256').update(raw).digest('hex');
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const failure = () => Error('Original service transport is unavailable; preserve its original outcome.');

// Normal entry accepts transport coordinates only, including this backend's
// actual entry URL. Only the existing fixed parent acquisition can populate
// its readiness lookup; no caller object/descriptor/provider supplies a client.
export async function attachOriginalServicePipe(options) {
  const allowed = ['control', 'instance', 'context', 'directory', 'onError', 'runningBackendModuleURL'];
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some(key => !allowed.includes(key))) throw failure();
  const acquired = originalServiceForRunningEntry(options.runningBackendModuleURL);
  return acquired === null ? attachUnavailableOriginalServiceChannel(options) : attachAcquiredOriginalServicePipe(options, acquired,
    task => runEnteredOriginalServiceForRunningEntry(options.runningBackendModuleURL, task));
}

// Success implementation remains module-private. Normal startup can reach it
// only through readiness of the same fixed SDK acquisition above.
// PUBLIC controls expose this unchanged body with an external test-only loader;
// the production module never exports an object-injection/provider hook.
async function attachAcquiredOriginalServicePipe({ control, instance, context, directory, onError = () => {} }, acquired, runEntered = task => task()) {
  let original;
  if (!UUID.test(instance || '') || !UUID.test(context?.id || '') || !path.isAbsolute(context.workspace)
    || path.normalize(context.workspace) !== context.workspace) throw failure();
  // CODE and actual-owner readiness are separate. Register the route now, but
  // wait for both before entering a business request; cancellation stays live.
  // No secondary parser, dynamic module path or authorization callback.
  const rows = new Map(), business = new Set(), pending = new Set();
  let closed = false, poisoned = false, firstFailurePresent = false, firstFailure;
  const report = error => { if (!firstFailurePresent) { firstFailurePresent = true; firstFailure = error; } try { onError(error); } catch {} };
  let decodeOriginalWalletServicePrivateRequest, canonicalJSON;
  const sdkReady = Promise.all([
    import('../../../packages/wallet-auth/src/original-wallet-service-private-dispatch.js'),
    import('../../../packages/wallet-auth/src/canonical.js'),
  ]).then(async ([codec, canonical]) => {
    if (typeof codec.decodeOriginalWalletServicePrivateRequest !== 'function' || typeof canonical.canonicalJSON !== 'function') throw failure();
    original = await acquired;
    if (['dispatch', 'acknowledge', 'selectCurrentOutcome'].some(key => typeof original?.[key] !== 'function')) throw failure();
    decodeOriginalWalletServicePrivateRequest = codec.decodeOriginalWalletServicePrivateRequest; canonicalJSON = canonical.canonicalJSON;
  });
  pending.add(sdkReady);
  void sdkReady.then(() => pending.delete(sdkReady), error => { pending.delete(sdkReady); poisoned = true; report(error); });
  const failRow = (row, error) => {
    if (!row.firstFailurePresent) { row.firstFailurePresent = true; row.firstFailure = error; }
    if (row.entered) { row.unknown = true; poisoned = true; }
    // Sole SDK-decoded complete coordinates, same actual current original.
    // DATA remains private; never replace result, publish terminal, ACK or
    // clear UNKNOWN from this read. It runs inside the original entered loan.
    if (row.entered && !row.diagnosticSelected && row.request?.carrierVersion === 'YNX-PRODUCT-SESSION-PRIVATE/v4'
      && row.request.referenceAction === 'complete' && typeof original?.readTerminalCustody === 'function') {
      row.diagnosticSelected = true;
      try { row.terminalCustodyData = original.readTerminalCustody(row.request.operation, row.request.phase, row.request.requestId); }
      catch (cause) { row.diagnosticFailurePresent = true; row.diagnosticFailure = cause; }
    }
    report(error);
  };
  const live = row => !closed && !poisoned && !row.cancelled && rows.get(row.id) === row;
  const binding = row => ({ schema: ORIGINAL_SERVICE_PIPE_SCHEMA, id: row.id, document: row.document, instance,
    projectId: context.id, workspace: context.workspace });
  const sameDirectory = (before, now) => now.isDirectory() && !now.isSymbolicLink() && now.dev === before.dev && now.ino === before.ino
    && now.uid === before.uid && (now.mode & 0o777) === 0o700;
  async function publish(row, suffix, value, fence) {
    const before = await fs.lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== process.getuid() || (before.mode & 0o777) !== 0o700) throw failure();
    const raw = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(raw) > 192 * 1024) throw failure();
    const staging = path.join(directory, '.wallet-' + row.id + '-' + randomUUID());
    const target = path.join(directory, 'wallet-' + row.id + suffix + '.json');
    const fd = await fs.open(staging, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await fd.writeFile(raw); await fd.sync(); } finally { await fd.close(); }
    // No JS event can interleave final current checks and the publication.
    // A failed post-link fence leaves nlink=2, which Native refuses; do not
    // delete that uncertain evidence or overwrite another request's result.
    if (!sameDirectory(before, lstatSync(directory))) throw failure();
    fence(); linkSync(staging, target); fence();
    if (!sameDirectory(before, lstatSync(directory))) throw failure();
    unlinkSync(staging);
  }
  function observe(row, terminal) {
    if (!live(row)) throw failure();
    const outcome = original.selectCurrentOutcome(row.request.operation, row.request.phase, row.request.requestId);
    if (!outcome || outcome.result !== row.result || canonicalJSON(outcome.result) !== row.resultRaw
      || terminal && (outcome.terminal !== true || outcome.unknown !== false)) throw failure();
    if (!live(row)) throw failure();
    return outcome;
  }
  const track = task => {
    const promise = Promise.resolve(task); pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;
  };
  const enter = (row, task) => track(Promise.resolve().then(() => runEntered(task)).catch(error => {
    // Acquisition/retirement can refuse the loan before task() enters. Keep
    // that exact failure visible, but never select terminal DATA outside the
    // actual entered caller. dispatch/receipt handle their own in-loan errors.
    if (!row.firstFailurePresent) { row.firstFailurePresent = true; row.firstFailure = error; }
    if (row.entered) { row.unknown = true; poisoned = true; }
    report(error);
  }));
  const finishCleanup = async () => { while (pending.size) await Promise.allSettled([...pending]); return { complete: !firstFailurePresent && ![...rows.values()].some(row => row.unknown), firstFailurePresent, firstFailure }; };
  const rejectBeforeEntry = async row => {
    if (closed || row.cancelled) return;
    await publish(row, '', { ...binding(row), status: 'failed', entered: false, unknown: poisoned,
      error: poisoned ? 'ORIGINAL_PRIVATE_SOURCE_UNRESOLVED' : 'ORIGINAL_PRIVATE_REQUEST_INVALID' }, () => {
      if (closed || row.cancelled) throw failure();
    });
  };
  async function dispatch(row) {
    try {
      // Claim the original pipe route synchronously, then queue its first
      // frame while fixed SDK CODE loads. Go may already be reading stdin.
      // Cancellation/close during this wait must not enter the SDK later.
      await sdkReady;
      if (!live(row)) return;
      row.request = decodeOriginalWalletServicePrivateRequest(row.canonicalInput);
      const key = JSON.stringify([row.request.operation, row.request.phase, row.request.requestId]);
      if (business.has(key)) throw failure();
      business.add(key);
      if (!live(row)) return;
      row.entered = true; row.unknown = true;
      row.result = await original.dispatch(row.canonicalInput);
      row.resultRaw = canonicalJSON(row.result);
      // This bounded wrapper does not enlarge the SDK's per-carrier budget.
      if (typeof row.result?.body !== 'string' || Buffer.byteLength(row.resultRaw) > 65536) throw failure();
      row.resultDigest = hash(row.resultRaw);
      observe(row, false);
      row.publication = publish(row, '', { ...binding(row), status: 'response-pending-terminal', entered: true, unknown: true,
        resultRaw: row.resultRaw, resultDigest: row.resultDigest }, () => observe(row, false));
      await row.publication;
    } catch (error) {
      if (row.entered) failRow(row, error);
      else {
        // A rejected public request never entered the original service. Keep
        // its own first cause, without inventing native cleanup debt or
        // poisoning a later, independently valid request.
        row.firstFailurePresent = true; row.firstFailure = error;
        try { onError(error); } catch {}
        try { await rejectBeforeEntry(row); } catch (publishError) { failRow(row, publishError); }
      }
    }
  }
  async function receipt(row, digest) {
    try {
      await row.publication;
      const before = observe(row, false);
      if (row.resultDigest !== digest) throw failure();
      // Coordinates come only from the original SDK-decoded raw request.
      // The parent receipt is NOT Native business terminal authorization.
      // A backend may already have completed its original durable ACK before
      // returning the response. Do not acknowledge that business action twice.
      // This same-live-owner observation cannot reconcile any poisoned/cold row.
      if (before.terminal !== true || before.unknown !== false) {
        if (before.terminal !== false || before.unknown !== true) throw failure();
        if (await original.acknowledge(row.request.operation, row.request.phase, row.request.requestId, row.resultDigest) !== undefined) throw failure();
      }
      observe(row, true);
      await publish(row, '-terminal', { ...binding(row), status: 'terminal', entered: true, unknown: false,
        resultDigest: row.resultDigest }, () => observe(row, true));
      row.terminalPublished = true; row.unknown = false;
    } catch (error) { failRow(row, error); }
  }
  const bound = body => body.instance === instance && body.projectId === context.id && body.workspace === context.workspace
    && UUID.test(body.id || '') && UUID.test(body.document || '');
  const subscription = control.subscribe({ actions: ['original-service-dispatch', 'original-service-cancel', 'original-service-received'],
    maxFrameBytes: ORIGINAL_SERVICE_PIPE_FRAME_LIMIT,
    receive(body) {
      if (closed || !bound(body)) return;
      const common = ['action', 'id', 'document', 'instance', 'projectId', 'workspace'];
      if (body.action === 'original-service-cancel' && exact(body, common)) {
        const row = rows.get(body.id); if (!row || row.document !== body.document || row.terminalPublished) return;
        row.cancelled = true; if (row.entered) { row.unknown = true; poisoned = true; } return;
      }
      if (body.action === 'original-service-received' && exact(body, [...common, 'resultDigest'])) {
        const row = rows.get(body.id);
        if (!row || row.document !== body.document || row.receiptSelected || !row.publication || !HEX.test(body.resultDigest || '')) return;
        row.receiptSelected = true; return enter(row, () => receipt(row, body.resultDigest));
      }
      if (body.action !== 'original-service-dispatch' || !exact(body, [...common, 'canonicalInput']) || rows.has(body.id)
        || rows.size >= 32 || typeof body.canonicalInput !== 'string' || Buffer.byteLength(body.canonicalInput) > 262144) return;
      const row = { id: body.id, document: body.document, canonicalInput: body.canonicalInput, entered: false, unknown: false,
        cancelled: false, receiptSelected: false, firstFailurePresent: false, terminalPublished: false };
      rows.set(row.id, row);
      if (poisoned) return track(rejectBeforeEntry(row).catch(error => failRow(row, error)));
      return enter(row, () => dispatch(row));
    },
    async onClose() {
      closed = true; for (const row of rows.values()) if (row.entered && !row.terminalPublished) { row.cancelled = true; row.unknown = true; }
      const result = await finishCleanup(); if (!result.complete) throw firstFailurePresent ? firstFailure : failure();
    },
  });
  return Object.freeze({
    close() { closed = true; for (const row of rows.values()) if (!row.terminalPublished) { row.cancelled = true; if (row.entered) row.unknown = true; } subscription.close(); },
    // This drains transport calls, not the SDK's Source/Native acquisition.
    // The acquiring backend must retain and close that original owner itself.
    finishCleanup,
    status: () => ({ closed, poisoned, firstFailurePresent, firstFailure, pending: pending.size, retained: rows.size,
      unknown: [...rows.values()].some(row => row.unknown), diagnosticRetained: [...rows.values()].filter(row => row.terminalCustodyData !== undefined).length,
      diagnosticFailures: [...rows.values()].filter(row => row.diagnosticFailurePresent).length }),
  });
}
