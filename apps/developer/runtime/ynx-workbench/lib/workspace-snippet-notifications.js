'use strict';

const fencedControllers = new WeakSet();

// Retained SnippetController2 writes this observable only in cancel/updateState;
// its lifecycle reads the context keys, never the observable. Keep those keys
// current (finish/next depend on them), but publish their notifications and the
// final public observable state only after the coordinator seals native history.
function deferSnippetNotifications(controller, warn = () => {}) {
  const report = message => { try { warn(message); } catch (_) { /* Cleanup must survive a failed notification sink. */ } };
  if (!controller || fencedControllers.has(controller)) throw Error('This snippet controller already has a notification fence.');
  const observable = controller._inSnippetObservable;
  const services = new Set(['_inSnippet', '_hasNextTabstop', '_hasPrevTabstop'].map(key => controller[key]?._service));
  if (!observable || typeof observable.set !== 'function' || typeof observable.get !== 'function' || services.has(undefined)) throw Error('Review the retained snippet notification contract.');
  const emitters = [...new Set([...services].map(service => service._onDidChangeContext))];
  if (emitters.some(emitter => !emitter || typeof emitter.pause !== 'function' || typeof emitter.resume !== 'function' || !Number.isInteger(emitter._isPaused))) throw Error('Review the retained context notification contract.');
  const descriptor = Object.getOwnPropertyDescriptor(observable, 'set'), original = observable.set;
  let inherited = descriptor, parent = observable;
  while (!inherited && (parent = Object.getPrototypeOf(parent))) inherited = Object.getOwnPropertyDescriptor(parent, 'set');
  if (!inherited || !Object.hasOwn(inherited, 'value') || !inherited.writable || !descriptor && !Object.isExtensible(observable)) throw Error('The snippet observable method cannot be safely fenced.');
  const restore = () => { if (descriptor) Object.defineProperty(observable, 'set', descriptor); else delete observable.set; };
  const paused = [];
  let pending, installed = false, released = false;
  fencedControllers.add(controller);
  try {
    Object.defineProperty(observable, 'set', { ...(descriptor || { configurable: true, writable: true, enumerable: false }), value(value, tx, change) {
      // Native controller always passes undefined: retaining a finished external
      // transaction would violate ObservableValue's observer ownership contract.
      if (tx !== undefined || change !== undefined) throw Error('Unexpected snippet observable transaction.');
      pending = { value };
    } });
    installed = true;
    for (const emitter of emitters) { emitter.pause(); paused.push(emitter); }
  } catch (error) {
    try { if (installed) restore(); } finally {
      fencedControllers.delete(controller);
      for (const emitter of paused.reverse()) emitter.resume();
    }
    throw error;
  }
  return () => {
    if (released) return;
    released = true;
    // Restore first: reentrant observers now perform ordinary independent edits.
    try { restore(); } finally { fencedControllers.delete(controller); }
    // Set the final scalar before context publication so both consumer APIs
    // agree. Even observer.beginUpdate now runs only after the sealed batch.
    try { if (pending) original.call(observable, pending.value, undefined); }
    catch (error) { report('Workspace edit completed, but a snippet observer failed: ' + error.message); }
    finally {
      for (const emitter of paused) {
        try { emitter.resume(); } catch (error) { report('Workspace edit completed, but a snippet context listener failed: ' + error.message); }
      }
    }
  };
}

module.exports = { deferSnippetNotifications };
