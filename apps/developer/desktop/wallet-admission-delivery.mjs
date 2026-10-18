import { Socket } from 'node:net';
import { isAbsolute, normalize, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { createPrivatePayloadPump } from './private-payload-pump.mjs';

// PUBLIC framing, not another authorization/signing protocol. Only the fixed
// original supplier may authenticate the native-parent binding. fd4 alone
// never supplies that binding. Four-operation callers retain their own fd3.
const fail = code => Object.assign(Error(code), { code });
const denied = () => fail('WALLET_SERVICE_ADMISSION_DENIED');
const unavailable = () => fail('WALLET_SERVICE_ADMISSION_UNAVAILABLE');
const missing = () => fail('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');
// Backend-private readiness lookup, populated only by the normal fixed parent
// acquisition below. Entry coordinates select no authority or replacement SDK.
const originalServiceReadiness = new Map();
export function originalServiceForRunningEntry(actualEntryURL) {
  return originalServiceReadiness.get(actualEntryURL) || null;
}
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function admissionDeliveryCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(admissionDeliveryCanonical).join(',') + ']';
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw denied();
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if (keys.some(k => typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k)
    || !Object.hasOwn(d[k], 'value') || !d[k].enumerable)) throw denied();
  return '{' + keys.sort().map(k => JSON.stringify(k) + ':' + admissionDeliveryCanonical(d[k].value)).join(',') + '}';
}
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw denied();
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
function record(bytes, at) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!Buffer.from(text).equals(bytes)) throw denied();
  const v = JSON.parse(text);
  if (admissionDeliveryCanonical(v) !== text) throw denied();
  exact(v, ['type', 'selection', 'sequence', 'expiresAtMs']);
  exact(v.selection, ['sourceSelection', 'receiptSelection', 'expectedRequest', 'receiptDirectory']);
  exact(v.selection.sourceSelection, ['rootPath', 'rootDigest', 'rolePath', 'roleDigest']);
  exact(v.selection.receiptSelection, ['receiptPath', 'receiptDigest']);
  const r = v.selection.expectedRequest;
  exact(r, ['version', 'purpose', 'service', 'productId', 'platform', 'applicationId', 'gatewayOrigin',
    'registryDigest', 'consumerManifestDigest', 'gatewayManifestDigest', 'instanceId', 'currentReference',
    'operations', 'requestNonce', 'requestedAtMs', 'expiresAtMs']);
  if (v.type !== 'installed' || r.version !== 1 || r.purpose !== 'wallet-product-session-v2-service-admission/v1'
    || r.service !== 'wallet-product-session-v2' || r.productId !== 'developer' || r.platform !== 'macos'
    || r.applicationId !== 'com.ynxweb4.developer.testnetpreview' || r.gatewayOrigin !== 'https://wallet-auth.ynxweb4.com'
    || JSON.stringify(r.operations) !== JSON.stringify(['beginYNX', 'handleReturn', 'restore', 'disconnect'])
    || ![r.registryDigest, r.consumerManifestDigest, r.gatewayManifestDigest, r.currentReference,
      v.selection.receiptSelection.receiptDigest, v.selection.sourceSelection.rootDigest, v.selection.sourceSelection.roleDigest].every(hex)
    || typeof r.instanceId !== 'string' || !r.instanceId || typeof r.requestNonce !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(r.requestNonce) || !Number.isSafeInteger(v.sequence) || v.sequence < 1
    || !Number.isSafeInteger(v.expiresAtMs) || v.expiresAtMs <= at || v.expiresAtMs - at > 30000
    || !Number.isSafeInteger(r.requestedAtMs) || r.requestedAtMs > at
    || !Number.isSafeInteger(r.expiresAtMs) || v.expiresAtMs > r.expiresAtMs) throw denied();
  for (const p of [v.selection.sourceSelection.rootPath, v.selection.sourceSelection.rolePath,
    v.selection.receiptSelection.receiptPath, v.selection.receiptDirectory]) {
    if (typeof p !== 'string' || !isAbsolute(p) || normalize(p) !== p || p.includes('\0')) throw denied();
  }
  if (v.selection.receiptSelection.receiptPath !== join(v.selection.receiptDirectory, r.requestNonce + '.admission.json')) throw denied();
  return freeze(v);
}
const probe = Object.freeze({ service: 'wallet-product-session-v2', productId: 'developer', platform: 'macos',
  gatewayOrigin: 'https://wallet-auth.ynxweb4.com', operation: 'restore' });
function operation(value) {
  const v = JSON.parse(admissionDeliveryCanonical(value));
  exact(v, ['service', 'productId', 'platform', 'gatewayOrigin', 'operation']);
  if (v.service !== probe.service || v.productId !== probe.productId || v.platform !== probe.platform
    || v.gatewayOrigin !== probe.gatewayOrigin || !['beginYNX', 'handleReturn', 'restore', 'disconnect'].includes(v.operation)) throw denied();
  return freeze(v);
}

// Retirement refuses public calls immediately; disposal waits for each exact
// entered call, including a late rejection. No raced promise proves drainage.
function retainedOwner(binding, { schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let owner = binding, retired = false, firstCause, closeSelected = false;
  let cleanupState = 'not-selected', cleanupError, completion, bounded, childDebtPresent = false, childDebt;
  const pending = new Set(), hooks = new Set();
  let rejectRetirement;
  const retirement = new Promise((_, reject) => { rejectRetirement = reject; });
  retirement.catch(() => {});
  const refusal = () => firstCause instanceof Error ? firstCause : Object.assign(unavailable(), { cause: firstCause });
  const enter = fn => {
    if (retired) return Promise.reject(refusal());
    let settle;
    const joined = new Promise(resolve => { settle = resolve; });
    pending.add(joined); // register BEFORE invoking the original owner
    let value;
    try { value = fn(); } catch (error) { value = Promise.reject(error); }
    const original = Promise.resolve(value);
    original.then(() => { pending.delete(joined); settle(); }, () => { pending.delete(joined); settle(); });
    return Promise.race([original, retirement]);
  };
  const close = (...causes) => {
    if (retired) return completion;
    // An original promise can reject with undefined. Only an omitted cause
    // selects our shutdown default; never replace an entered owner's failure.
    retired = true; firstCause = causes.length ? causes[0] : unavailable(); rejectRetirement(refusal());
    for (const hook of hooks) { try { hook(); } catch {} }
    hooks.clear();
    cleanupState = 'draining';
    completion = (async () => {
      await Promise.all([...pending]);
      closeSelected = true; cleanupState = 'closing';
      try {
        if (childDebtPresent) throw childDebt;
        if (typeof owner?.close !== 'function') throw missing();
        const result = await owner.close();
        if (result !== undefined) throw Object.assign(denied(), { cleanupResult: result });
        owner = null; cleanupState = 'complete';
        return { complete: true };
      } catch (error) {
        cleanupState = 'failed'; cleanupError = error;
        throw Object.assign(unavailable(), { cause: firstCause, cleanupError, cleanupState: 'failed' });
      }
    })();
    completion.catch(() => {});
    bounded = new Promise((resolve, reject) => {
      const deadline = schedule(() => resolve({ complete: false, unknown: true }), 5000);
      completion.then(value => { unschedule(deadline); resolve(value); }, error => { unschedule(deadline); reject(error); });
    });
    bounded.catch(() => {});
    return completion;
  };
  return Object.freeze({ enter, close,
    retainChildCleanupDebt(error) { if (!childDebtPresent) { childDebtPresent = true; childDebt = error; } },
    onRetire(hook) { if (retired) hook(); else hooks.add(hook); },
    assertLive() { if (retired) throw refusal(); },
    async finishCleanup() { if (!retired) close(); return bounded; },
    status() { return Object.freeze({ retired, firstCause, cleanupState, cleanupError,
      closeSelected, pendingCalls: pending.size, ownerRetained: owner !== null }); },
  });
}
function cleanupOnly(lifecycle) {
  return Object.freeze({ assertCurrent() { lifecycle.assertLive(); throw missing(); },
    close: lifecycle.close, finishCleanup: lifecycle.finishCleanup, cleanupStatus: lifecycle.status });
}

// Standalone PUBLIC controls supply explicit stand-ins; production uses only
// the fixed original acquisition below. retained is internal same-owner state.
export function createInstalledAdmissionReceiver({ stream, parentBinding, validateInstalled,
  runningBackendModuleURL, now = Date.now, schedule = setTimeout, unschedule = clearTimeout, retained, acquirePrivateChannel, getPrivateChannelCleanup }) {
  if (!stream || !parentBinding || typeof parentBinding.assertCurrent !== 'function'
    || typeof parentBinding.close !== 'function' || typeof validateInstalled !== 'function') throw missing();
  const lifecycle = retained || retainedOwner(parentBinding, { schedule, unschedule });
  let received = false, active = false, ready = false, epoch, validator;
  let payload, privateChannel, privateSelected = false;
  let releasePrivate;
  const retirement = new Promise(resolve => { releasePrivate = resolve; });
  let resolveOriginal, rejectOriginal;
  const originalReady = new Promise((resolve, reject) => { resolveOriginal = resolve; rejectOriginal = reject; });
  void originalReady.catch(() => {});
  let bytes = Buffer.alloc(0), timer, floor = -1;
  const current = async () => {
    lifecycle.assertLive();
    const at = now();
    if (!Number.isSafeInteger(at) || at < floor || epoch && at >= epoch.expiresAtMs) throw denied();
    floor = at;
    if (await lifecycle.enter(() => parentBinding.assertCurrent(epoch?.selection.expectedRequest)) !== undefined) throw denied();
    lifecycle.assertLive();
    if (now() < floor || epoch && now() >= epoch.expiresAtMs) throw denied();
    return at;
  };
  const close = (...causes) => lifecycle.close(...causes);
  const ended = () => { close(unavailable()); }, errored = error => { close(error); };
  function startPrivatePayload() {
    if (privateSelected || typeof acquirePrivateChannel !== 'function') return;
    privateSelected = true;
    // The exact acquisition and all child cleanup remain one entered borrow.
    // Retirement cannot abandon a late partial or close its parent first.
    void lifecycle.enter(async () => {
      try {
        privateChannel = await acquirePrivateChannel();
        if (privateChannel === null) { rejectOriginal(missing()); return; }
        if (!privateChannel?.original || !privateChannel.framer) throw missing();
        lifecycle.assertLive();
        payload = createPrivatePayloadPump({ stream, framer: privateChannel.framer,
          assertCurrent: current, onFailure: error => { void close(error)?.catch(() => {}); } });
        resolveOriginal(privateChannel.original);
        payload.start();
        await retirement;
      } catch (error) {
        rejectOriginal(error);
        // Only the same fixed SDK's chosen-client cleanup accessor can prove
        // that a failed acquisition selected no client (null), or return the
        // exact retained partial. Never reacquire to fill a missing reference.
        if (privateChannel === undefined) {
          try {
            if (typeof getPrivateChannelCleanup !== 'function') throw error;
            const partial = await getPrivateChannelCleanup();
            if (partial === null) privateChannel = null;
            else if (partial && typeof partial === 'object') privateChannel = { original: partial };
            else throw missing();
          } catch (cleanupError) { lifecycle.retainChildCleanupDebt(cleanupError); }
        }
        void close(error)?.catch(() => {});
      }
      finally {
        if (privateChannel !== null && privateChannel !== undefined) {
          try {
            const original = privateChannel.original;
            if (typeof original?.retire !== 'function' || typeof original.join !== 'function' || typeof original.close !== 'function') throw missing();
            if (original.retire(lifecycle.status().firstCause) !== undefined) throw denied();
            payload?.retire(lifecycle.status().firstCause);
            if (payload && (await payload.finishCleanup()).complete !== true) throw unavailable();
            if (await original.join() !== undefined) throw denied();
            if (await original.close() !== undefined) throw denied();
            privateChannel = undefined;
          } catch (error) { lifecycle.retainChildCleanupDebt(error); }
        }
      }
    }).catch(() => {});
  }
  const install = async value => {
    epoch = value;
    unschedule(timer);
    timer = schedule(() => close(denied()), Math.max(1, value.expiresAtMs - now()));
    timer?.unref?.();
    await current();
    const admitted = await lifecycle.enter(() => validateInstalled(value.selection, runningBackendModuleURL));
    if (!admitted || typeof admitted.assertCurrent !== 'function') throw denied();
    await current();
    if (await lifecycle.enter(() => admitted.assertCurrent(probe)) !== undefined) throw denied();
    await current();
    validator = admitted;
    const r = value.selection.expectedRequest;
    const ack = admissionDeliveryCanonical({ type: 'ack', requestNonce: r.requestNonce,
      receiptDigest: value.selection.receiptSelection.receiptDigest, sequence: value.sequence,
      consumerManifestDigest: r.consumerManifestDigest }) + '\n';
    await lifecycle.enter(() => new Promise((resolve, reject) => {
      stream.write(ack, error => error ? reject(error) : resolve());
    }));
    await current(); ready = true;
    startPrivatePayload();
  };
  const data = chunk => {
    try {
      lifecycle.assertLive();
      if (received) {
        if (!ready || !payload) throw denied();
        payload.accept(chunk); return;
      }
      bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
      if (bytes.length > 65536) throw denied();
      const end = bytes.indexOf(10); if (end < 0) return;
      if (end !== bytes.length - 1) throw denied();
      const value = record(bytes.subarray(0, end), now());
      received = true; bytes = Buffer.alloc(0);
      void install(value).catch(error => {
        // Do not return a rejecting cleanup Promise into a detached catch
        // chain. Observe this exact selected attempt; finishCleanup/status
        // still expose its failure, retained owner and original first cause.
        void close(error)?.catch(() => {});
      });
    } catch (error) { close(error); }
  };
  stream.on('data', data); stream.on('end', ended); stream.on('close', ended); stream.on('error', errored);
  lifecycle.onRetire(() => {
    rejectOriginal(lifecycle.status().firstCause);
    releasePrivate(); payload?.retire(lifecycle.status().firstCause);
    ready = false; validator = undefined; unschedule(timer);
    stream.off('data', data); stream.off('end', ended); stream.off('close', ended); stream.off('error', errored);
    stream.on('error', () => {}); stream.destroy();
  });
  timer = schedule(() => close(unavailable()), 30000); timer?.unref?.();
  return Object.freeze({
    // This returns only the SDK facade from the already selected actual child;
    // there is no setter, provider argument, new capture or raw Native handle.
    whenOriginalServiceReady() { return originalReady; },
    async assertCurrent(input) {
      lifecycle.assertLive();
      if (active) { close(denied()); lifecycle.assertLive(); }
      if (!ready) throw missing();
      active = true;
      try {
        const tuple = operation(input); await current();
        if (await lifecycle.enter(() => validator.assertCurrent(tuple)) !== undefined) throw denied();
        await current();
      } catch (error) { close(error); lifecycle.assertLive(); }
      finally { active = false; }
    }, close, finishCleanup: lifecycle.finishCleanup, cleanupStatus: lifecycle.status,
  });
}

// Partial acquisition stays reachable as a cleanup-only facade. Its original
// close is selected once, never retried by startup or normal shutdown.
const parentDeliverySelections = new WeakMap();
export async function openOriginalParentDelivery(options) {
  const { supplier, runningBackendModuleURL } = options;
  let selections = parentDeliverySelections.get(supplier);
  if (!selections) { selections = new Map(); parentDeliverySelections.set(supplier, selections); }
  if (!selections.has(runningBackendModuleURL)) {
    // Select before any supplier await. Reentrant startup shares the exact
    // owner/reader, including a failed selection; it cannot adopt fd4 twice.
    selections.set(runningBackendModuleURL, Promise.resolve().then(() => openSelectedOriginalParentDelivery(options)));
  }
  return selections.get(runningBackendModuleURL);
}
async function openSelectedOriginalParentDelivery({ supplier, runningBackendModuleURL, validateInstalled }) {
  if (typeof supplier.acquireOriginalIDEAdmissionParentDelivery !== 'function') return null;
  const binding = await supplier.acquireOriginalIDEAdmissionParentDelivery(runningBackendModuleURL);
  if (!binding) return null;
  const lifecycle = retainedOwner(binding);
  const timer = setTimeout(() => lifecycle.close(unavailable()), 30000); timer.unref?.();
  lifecycle.onRetire(() => clearTimeout(timer));
  try {
    if (binding.descriptor !== 4 || typeof binding.assertCurrent !== 'function'
      || typeof binding.close !== 'function' || await lifecycle.enter(() => binding.assertCurrent()) !== undefined) throw missing();
    lifecycle.assertLive();
    const stream = new Socket({ fd: 4, readable: true, writable: true });
    const receiver = createInstalledAdmissionReceiver({ stream, parentBinding: binding, validateInstalled,
      runningBackendModuleURL, retained: lifecycle,
      async acquirePrivateChannel() {
        // One fixed SDK module retains the original Native binding privately.
        // Never pass a descriptor/provider/parent projection into its factory.
        const sdk = await import('../../../packages/wallet-auth/src/original-ide-admission-parent-delivery.js');
        if (typeof sdk.acquireOriginalIDEPrivateServiceChannel !== 'function') return null;
        return sdk.acquireOriginalIDEPrivateServiceChannel(runningBackendModuleURL);
      },
      async getPrivateChannelCleanup() {
        const sdk = await import('../../../packages/wallet-auth/src/original-ide-admission-parent-delivery.js');
        if (typeof sdk.getOriginalIDEPrivateServiceChannelCleanup !== 'function') throw missing();
        return sdk.getOriginalIDEPrivateServiceChannelCleanup(runningBackendModuleURL);
      },
    });
    if (originalServiceReadiness.has(runningBackendModuleURL)) {
      lifecycle.close(denied()); return cleanupOnly(lifecycle);
    }
    originalServiceReadiness.set(runningBackendModuleURL, receiver.whenOriginalServiceReady());
    clearTimeout(timer); return receiver;
  } catch (error) { lifecycle.close(error); return cleanupOnly(lifecycle); }
}
