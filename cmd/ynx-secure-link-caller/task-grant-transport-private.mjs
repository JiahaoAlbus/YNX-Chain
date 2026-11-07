// Package-internal lifecycle utilities. These do not acquire a resource,
// register a provider, parse a Grant, or execute an effect.
import {types} from 'node:util';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;

export function fault(code, cause) { return Object.assign(new Error(code, {cause}), {code}); }
export function changed(s) {
  const waiting = [...s.waiters]; s.waiters.clear();
  for (const wake of waiting) wake();
}
export function signalOf(options) {
  if (options === undefined) return undefined;
  if (!options || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).length !== 1)
    throw fault('TASK_GRANT_TRANSPORT_JOIN_OPTIONS');
  const d = Object.getOwnPropertyDescriptor(options, 'signal');
  if (!d || !Object.hasOwn(d, 'value')) throw fault('TASK_GRANT_TRANSPORT_JOIN_OPTIONS');
  if (d.value !== undefined) { try { aborted.call(d.value); } catch { throw fault('TASK_GRANT_TRANSPORT_JOIN_SIGNAL'); } }
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
