// Package-internal lifecycle utilities. These do not acquire a resource,
// register a provider, parse a Principal, or execute an effect.
import {types} from 'node:util';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const decoder = new TextDecoder('utf-8', {fatal: true});
export const SOCIAL_DIRECTORY_PROOF_HEADER = 'x-ynx-product-session-proof-v4';
export const SOCIAL_DIRECTORY_MAX_PROOF_BYTES = 196608;
export const SOCIAL_DIRECTORY_MAX_HEADER_BYTES = 262144;
export const SOCIAL_DIRECTORY_MAX_CONTROL_BYTES = 2 << 20;
export const SOCIAL_DIRECTORY_PATHS = Object.freeze(['/v4/devices/directory', '/m1qa/v4/devices/directory']);

export function fault(code, cause) { return Object.assign(new Error(code, {cause}), {code}); }
function exact(value, keys) {
  if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw fault('SOCIAL_DIRECTORY_TRANSPORT_METADATA');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(k => !descriptors[k] || !Object.hasOwn(descriptors[k], 'value')))
    throw fault('SOCIAL_DIRECTORY_TRANSPORT_METADATA');
  return Object.fromEntries(keys.map(k => [k, descriptors[k].value]));
}

// Social reuses the original L/C framing and kernel capability, never its TLS
// Channel semantics. Tail segments remain owned exact originals; this decoder
// does not inspect Source/expected17, authenticate V4 or construct a Principal.
export function socialDirectoryMaterial(record, frame) {
  const meta = exact(JSON.parse(decoder.decode(frame.metadata)), ['transportKind', 'Service', 'Operation', 'Method', 'Path', 'Host', 'ContentLength', 'RequestOriginalBytes', 'SourceBindingOriginalBytes', 'SourceWindowOriginalBytes']);
  if (meta.transportKind !== 'localOSpeer' || meta.Service !== record.server.profile.service || !['currentExistingSocialDeviceDirectoryPrincipalV4','recheckExistingSocialDeviceDirectoryPrincipalV4'].includes(meta.Operation) || meta.Method !== 'GET' || meta.Path !== record.identity.url || meta.ContentLength !== 0 || typeof meta.Host !== 'string' || meta.Host.length < 1 || meta.Host.length > 512 || /[\0\r\n]/.test(meta.Host))
    throw fault('SOCIAL_DIRECTORY_TRANSPORT_ORIGINAL_ROUTE');
  const lengths = [meta.RequestOriginalBytes, meta.SourceBindingOriginalBytes, meta.SourceWindowOriginalBytes];
  const caps = [393216, 1 << 20, 65536];
  if (!Buffer.isBuffer(frame.body) || frame.body.length > SOCIAL_DIRECTORY_MAX_CONTROL_BYTES || lengths.some((n, i) => !Number.isSafeInteger(n) || n < 1 || n > caps[i]) || lengths.reduce((a, b) => a + b, 0) !== frame.body.length)
    throw fault('SOCIAL_DIRECTORY_TRANSPORT_ORIGINAL_BOUNDS');
  const request = Buffer.from(frame.body.subarray(0, lengths[0]));
  const source = Buffer.from(frame.body.subarray(lengths[0], lengths[0] + lengths[1]));
  const window = Buffer.from(frame.body.subarray(lengths[0] + lengths[1]));
  // Only match transport fields with the actual IncomingMessage. The sole
  // SDK/Auth consumer still performs its exact-six/expected17 validation.
  const view = JSON.parse(decoder.decode(request));
  if (!view || view.method !== 'GET' || view.path !== meta.Path || view.body !== '' || view.proofHeader !== record.identity.headers[SOCIAL_DIRECTORY_PROOF_HEADER])
    throw fault('SOCIAL_DIRECTORY_TRANSPORT_ORIGINAL_REQUEST');
  return Object.freeze({transportKind: 'localOSpeer', Service: meta.Service, Operation: meta.Operation, Method: meta.Method, Path: meta.Path, Host: meta.Host, ContentLength: 0,
    RequestOriginal: request, SourceBindingOriginal: source, SourceWindowOriginal: window,
    Peer: Object.freeze({uid: record.server.profile.bridgeUID, pid: record.server.profile.bridgePID}),
    dataOnly: true, sourceVerified: false, principalVerified: false});
}
export function changed(s) {
  const waiting = [...s.waiters]; s.waiters.clear();
  for (const wake of waiting) wake();
}
export function signalOf(options) {
  if (options === undefined) return undefined;
  if (!options || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).length !== 1)
    throw fault('SOCIAL_DIRECTORY_TRANSPORT_JOIN_OPTIONS');
  const d = Object.getOwnPropertyDescriptor(options, 'signal');
  if (!d || !Object.hasOwn(d, 'value')) throw fault('SOCIAL_DIRECTORY_TRANSPORT_JOIN_OPTIONS');
  if (d.value !== undefined) { try { aborted.call(d.value); } catch { throw fault('SOCIAL_DIRECTORY_TRANSPORT_JOIN_SIGNAL'); } }
  return d.value;
}
export function waitForChange(s, signal) {
  if (signal && aborted.call(signal)) return Promise.reject(reason.call(signal));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (errorPresent, error) => {
      if (done) return; done = true;
      s.waiters.delete(wake);
      if (signal) removeListener.call(signal, 'abort', cancel);
      if (errorPresent) reject(error); else resolve();
    };
    const wake = () => finish(false);
    const cancel = () => finish(true, reason.call(signal));
    s.waiters.add(wake);
    if (signal) {
      addListener.call(signal, 'abort', cancel, {once: true});
      if (aborted.call(signal)) cancel();
    }
  });
}
