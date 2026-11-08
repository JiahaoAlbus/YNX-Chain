// PRIVATE original Native/Auth continuation -> SAME finite3 execute transport.
// Auth's fixed compositor supplies its recognized original child. Its methods
// are capabilities already owned there, not a LINK Source/provider constructor.
// No cap, reservation or approval is reconstructed from HTTP/control DATA.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {openOriginalTaskReadResourceCaller, openOriginalTaskReadResourceSidebandForContinuation,
  takeOriginalTaskReadResourceSidebandSocket} from './task-read-resource-caller.mjs';

const owners = new WeakMap(), selectedChildren = new WeakSet(), selectedMethods = new WeakSet(), retained = new Set();
const maxData = 1 << 20, maxCalls = 64, maxOwners = 64;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const offsetOf = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
const lengthOf = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const setBytes = Uint8Array.prototype.set;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;

function fault(s, code, cause) {
  return Object.assign(new Error(code, {cause}), {code, dispatchPossible: s?.physical?.lifetime().dispatchPossible === true});
}
function state(owner) {
  const s = owner && owners.get(owner);
  if (!s || s.pid !== process.pid) throw fault(null, 'TASK_CONTINUATION_ORIGINAL_OWNER_REQUIRED');
  return s;
}
function remember(s, error, unknown = false) {
  if (!s.firstPresent) {s.firstPresent = true; s.first = error;}
  s.unknown ||= unknown; changed(s); return s.first;
}
function changed(s) {for (const wake of [...s.waiters]) wake(); s.waiters.clear();}
function optionsSignal(options) {
  if (options === undefined) return undefined;
  if (!options || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype) throw fault(null, 'TASK_CONTINUATION_OPTIONS');
  const d = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(d).length !== 1 || !Object.hasOwn(d.signal || {}, 'value')) throw fault(null, 'TASK_CONTINUATION_OPTIONS');
  const signal = d.signal.value;
  if (signal !== undefined) {try {aborted.call(signal);} catch {throw fault(null, 'TASK_CONTINUATION_SIGNAL');}}
  return signal;
}
function wait(s, signal) {
  if (signal && aborted.call(signal)) return Promise.reject(reason.call(signal));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (present, error) => {if (done) return; done = true; s.waiters.delete(wake); if (signal) removeListener.call(signal, 'abort', cancel); if (present) reject(error); else resolve();};
    const wake = () => finish(false), cancel = () => finish(true, reason.call(signal));
    s.waiters.add(wake);
    if (signal) {addListener.call(signal, 'abort', cancel, {once: true}); if (aborted.call(signal)) cancel();}
  });
}
function bytes(input) {
  if (!types.isUint8Array(input) || types.isProxy(input)) throw fault(null, 'TASK_CONTINUATION_ORIGINAL_ENTITY');
  const backing = bufferOf.call(input), offset = offsetOf.call(input), length = lengthOf.call(input);
  if (types.isSharedArrayBuffer(backing) || length < 1 || length > maxData) throw fault(null, 'TASK_CONTINUATION_ENTITY_BOUND');
  const own = Buffer.alloc(length); setBytes.call(own, new Uint8Array(backing, offset, length)); return own;
}
function adoptChild(s, child) {
  if (!child || typeof child !== 'object' || types.isProxy(child) || selectedChildren.has(child)) throw fault(s, 'TASK_CONTINUATION_ALREADY_SELECTED');
  const methods = {};
  for (const name of ['assertCurrent', 'readOriginalRequestDATA', 'claimAtOriginalResourceFence']) {
    const d = Object.getOwnPropertyDescriptor(child, name);
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'function' || selectedMethods.has(d.value)) throw fault(s, 'TASK_CONTINUATION_ORIGINAL_CHILD_REQUIRED');
    methods[name] = d.value;
  }
  // An open failure, changed profile or lost ACK cannot rearm this child. This
  // is a transport once guard, NOT the Auth recognition/Source/grant brand.
  selectedChildren.add(child);
  for (const fn of Object.values(methods)) selectedMethods.add(fn);
  s.child = child; s.methods = methods;
}
async function heldCurrent(s) {
  const work = (async () => {
    const out = await Reflect.apply(s.methods.assertCurrent, s.child, []);
    if (out !== undefined) throw fault(s, 'TASK_CONTINUATION_CURRENT_VOID');
  })();
  s.heldWorks.add(work); changed(s);
  try {await work;} finally {s.heldWorks.delete(work); changed(s);}
}
function syncHeld(s, name) {
  s.heldSync++; changed(s);
  try {return Reflect.apply(s.methods[name], s.child, []);}
  finally {s.heldSync--; changed(s);}
}
function errorWire(error) {
  let code;
  if (typeof error === 'number') code = error;
  else if (error && typeof error === 'object' && !types.isProxy(error)) {
    const d = Object.getOwnPropertyDescriptor(error, 'code');
    if (d && Object.hasOwn(d, 'value') && typeof d.value === 'number') code = d.value;
  }
  return Number.isInteger(code) && code >= -0x80000000 && code <= 0x7fffffff ? {kind: 1, code} : {kind: 2, code: 0};
}
function readable(s, deadline) {
  return new Promise((resolve, reject) => {
    const socket = s.socket; let done = false;
    const finish = error => {if (done) return; done = true; clearTimeout(timer); socket.off('readable', wake); socket.off('end', wake); socket.off('close', wake); socket.off('error', failed); if (error) reject(error); else resolve();};
    const wake = () => finish(), failed = error => finish(error);
    const timer = setTimeout(() => finish(fault(s, 'TASK_CONTINUATION_CONTROL_TIMEOUT')), Math.max(1, deadline - performance.now()));
    socket.once('readable', wake); socket.once('end', wake); socket.once('close', wake); socket.once('error', failed);
  });
}
async function exactRead(s, size, boundary = false) {
  const pieces = []; let n = 0; const end = performance.now() + s.timeoutMs;
  for (;;) {
    const part = s.socket.read(size - n);
    if (part) {pieces.push(Buffer.from(part)); n += part.length; if (n === size) return Buffer.concat(pieces, n);}
    if (s.socket.readableEnded || s.socket.destroyed) {
      if (boundary && n === 0) return null;
      throw Object.assign(fault(s, 'TASK_CONTINUATION_CONTROL_PARTIAL'), {frameData: Buffer.concat(pieces, n), bytesReceived: n});
    }
    await readable(s, end);
  }
}
async function writeFrame(s, frame) {
  s.writing = true; changed(s);
  try {
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {if (done) return; done = true; clearTimeout(timer); s.socket.off('error', failed); if (error) reject(error); else resolve();};
      const failed = error => finish(error);
      const timer = setTimeout(() => {finish(fault(s, 'TASK_CONTINUATION_REPLY_TIMEOUT')); s.socket.destroy();}, s.timeoutMs);
      s.socket.once('error', failed);
      s.socket.write(frame, error => finish(error));
    });
  } finally {s.writing = false; changed(s);}
}
async function controlLoop(s) {
  try {
    for (;;) {
      const header = await exactRead(s, 4, true);
      // Go's original child may close its own control FD at handler return,
      // before the complete HTTP response/FIN. At a clean frame boundary that
      // alone is not a Source failure and never closes the borrowed child.
      if (!header) {s.controlEOF = true; return;}
      if (header.readUInt32BE(0) !== 37) throw fault(s, 'TASK_CONTINUATION_CONTROL_LENGTH');
      const request = await exactRead(s, 37), command = String.fromCharCode(request[0]), sequence = request.readUInt32BE(1);
      if (!['C', 'D', 'F'].includes(command) || sequence !== s.sequence + 1 || sequence > maxCalls || !request.subarray(5).equals(s.hash))
        throw fault(s, 'TASK_CONTINUATION_CONTROL_BINDING');
      s.sequence = sequence;
      let errorPresent = false, error, data = Buffer.alloc(0);
      try {
        if (s.retired || !s.exchangeSelected || !s.physical.lifetime().requestInFlight) throw fault(s, 'TASK_CONTINUATION_REQUEST_NOT_ACTIVE');
        if (command === 'C') await heldCurrent(s);
        else if (command === 'D') {
          const value = syncHeld(s, 'readOriginalRequestDATA');
          if (types.isPromise(value)) throw fault(s, 'TASK_CONTINUATION_DATA_SYNC_REQUIRED');
          const json = JSON.stringify(value);
          if (typeof json !== 'string' || Buffer.byteLength(json) > maxData) throw fault(s, 'TASK_CONTINUATION_DATA_BOUND');
          data = Buffer.from(json, 'utf8');
        } else {
          if (s.claimSelected) throw fault(s, 'TASK_CONTINUATION_CLAIM_ALREADY_SELECTED');
          s.claimSelected = true; // Before actual call; never reset on error/ACK loss.
          // One synchronous turn: original local -> same-ledger transaction ->
          // local. Do not await Current here, re-open, or call the Go resource.
          if (syncHeld(s, 'claimAtOriginalResourceFence') !== undefined) throw fault(s, 'TASK_CONTINUATION_CLAIM_VOID');
        }
        if (s.retired) throw fault(s, 'TASK_CONTINUATION_RETIRED');
      } catch (cause) {errorPresent = true; error = cause; data = Buffer.alloc(0); remember(s, cause, command === 'F');}
      const encoded = errorPresent ? errorWire(error) : {kind: 0, code: 0};
      const response = Buffer.alloc(4 + 43 + data.length);
      response.writeUInt32BE(43 + data.length, 0); request.copy(response, 4);
      response[41] = errorPresent ? 1 : 0; response[42] = encoded.kind; response.writeInt32BE(encoded.code, 43);
      if (data.length) data.copy(response, 47);
      await writeFrame(s, response);
      if (command === 'F') s.claimReplyWritten = true;
    }
  } catch (error) {
    if (!s.retired) remember(s, error, true);
  } finally {s.controlDone = true; changed(s);}
}
function pair(s, done) {return Object.freeze({physicalDone: done, errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null});}
function ready(s) {
  return !s.opening && !s.httpRunning && s.heldWorks.size === 0 && s.heldSync === 0 && !s.writing && s.controlDone &&
    (!s.sideband || s.sideband.lifetime().physicalDone) && (!s.physical || s.physical.lifetime().joined);
}
function observeDrain(s) {
  if (!s.physicalJoin && s.physical) {
    s.physicalJoin = (async () => {
      try {await s.physical.join();} catch (error) {remember(s, error);}
      finally {changed(s);}
    })();
  }
  if (!s.sidebandJoin && s.sideband) {
    s.sidebandJoin = (async () => {
      try {const out = await s.sideband.join(); if (out.errorPresent) remember(s, out.error, !out.physicalDone);}
      catch (error) {remember(s, error, true);}
      finally {changed(s);}
    })();
  }
}

// originalBodyBytes are the exact HTTP entity bytes from Auth requestDATA, not
// reconstructed HTTP headers/CRLF. Method/Host/CL/no chunked/exact execute path
// are independently constrained by both genuine transport endpoints.
export async function openOriginalTaskReadContinuationTransport(profile, originalBodyBytes, recognizedHeldChild, options) {
  const s = {pid: process.pid, opening: true, child: null, methods: null, body: null, hash: null,
    physical: null, sideband: null, socket: null, timeoutMs: 30000, sequence: 0,
    firstPresent: false, first: undefined, unknown: false, retired: false, closed: false, joining: false,
    exchangeSelected: false, httpRunning: false, httpDone: false, httpComplete: false, claimSelected: false, claimReplyWritten: false,
    controlDone: true, controlEOF: false, writing: false, heldWorks: new Set(), heldSync: 0, waiters: new Set()};
  const owner = Object.freeze({
    async current() {
      const s = state(this);
      if (s.firstPresent) throw s.first;
      if (s.retired || s.closed || !s.physical) throw fault(s, 'TASK_CONTINUATION_RETIRED');
      try {await heldCurrent(s); if (!s.httpDone) s.physical.current();}
      catch (error) {throw remember(s, error);}
    },
    exchange(options) {
      const s = state(this);
      const run = async () => {
        if (s.firstPresent) return Object.freeze({response: null, errorPresent: true, error: s.first});
        if (s.retired || s.closed || s.exchangeSelected || !s.physical || !s.socket) return Object.freeze({response: null, errorPresent: true, error: fault(s, 'TASK_CONTINUATION_ALREADY_DISPATCHED')});
        s.exchangeSelected = true; s.httpRunning = true; changed(s);
        let response = null;
        try {
          optionsSignal(options);
          await heldCurrent(s); // Open #1; actual prewrite #2; first Go C #3.
          if (s.retired || s.controlEOF || s.firstPresent) throw s.firstPresent ? s.first : fault(s, 'TASK_CONTINUATION_RETIRED');
          const returned = await s.physical.exchange('execute', s.body, options);
          response = returned?.response ?? null; // Adopt before status/current.
          if (!returned || typeof returned.errorPresent !== 'boolean') remember(s, fault(s, 'TASK_CONTINUATION_HTTP_STATUS'));
          else if (returned.errorPresent) remember(s, returned.error);
          if (response) {
            const actual = response.copyDATA(); s.httpComplete = actual.bodyComplete;
            if (actual.statusCode < 200 || actual.statusCode >= 300) remember(s, fault(s, 'TASK_CONTINUATION_HTTP_REFUSED'), true);
          }
          if (!s.retired) await heldCurrent(s); // Separate actual Source postcheck.
        } catch (error) {remember(s, error, s.physical?.lifetime().dispatchPossible === true && !s.httpComplete);}
        finally {s.httpRunning = false; s.httpDone = true; changed(s);}
        return Object.freeze({response, errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null});
      };
      return run();
    },
    retire() {
      const s = state(this);
      if (!s.retired) {
        s.retired = true;
        try {s.physical?.retire();} catch (error) {remember(s, error, true);}
        try {s.sideband?.retire();} catch (error) {remember(s, error, true);}
        // Auth, not LINK, owns child/parent retire/join/close.
        changed(s);
      }
    },
    async join(options) {
      const s = state(this); let signal;
      try {
        signal = optionsSignal(options);
        if (!s.retired) return Object.freeze({physicalDone: false, errorPresent: true, error: fault(s, 'TASK_CONTINUATION_RETIRE_REQUIRED')});
        observeDrain(s);
        while (!ready(s)) {
          const side = s.sideband?.lifetime(), physical = s.physical?.lifetime();
          if (side?.cleanupUnknown || physical && !physical.localFDClosed && !physical.requestInFlight && s.httpDone && physical.firstCausePresent)
            return pair(s, false);
          await wait(s, signal);
        }
        return pair(s, true);
      } catch (error) {return Object.freeze({physicalDone: false, errorPresent: true, error});}
    },
    async close(options) {
      const s = state(this); owner.retire();
      const joined = await owner.join(options);
      if (!joined.physicalDone) return joined;
      if (!s.closed) {
        if (s.physical) {
          const out = await s.physical.close();
          if (out.errorPresent) remember(s, out.error);
          if (!out.physicalDone) return pair(s, false);
        }
        s.closed = true; retained.delete(s); s.child = null; s.methods = null;
      }
      return pair(s, true);
    },
    lifetime() {
      const s = state(this);
      return Object.freeze({retired: s.retired, closed: s.closed, physicalDone: ready(s), requestInFlight: s.httpRunning,
        heldWork: s.heldWorks.size + s.heldSync, controlDone: s.controlDone, controlEOF: s.controlEOF, controlWriting: s.writing,
        claimSelected: s.claimSelected, claimReplyWritten: s.claimReplyWritten, calls: s.sequence, firstCausePresent: s.firstPresent,
        unknown: s.unknown || s.firstPresent, physical: s.physical?.lifetime() ?? null,
        dataOnly: true, sourceVerified: false, operationVerified: false});
    },
    firstCause() {const s = state(this); return Object.freeze({errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null});},
  });
  owners.set(owner, s);
  try {
    if (arguments.length < 3 || arguments.length > 4) throw fault(s, 'TASK_CONTINUATION_OPEN_ARITY');
    if (retained.size >= maxOwners) throw fault(s, 'TASK_CONTINUATION_CAPACITY');
    adoptChild(s, recognizedHeldChild); retained.add(s);
    s.body = bytes(originalBodyBytes); s.hash = createHash('sha256').update(s.body).digest(); optionsSignal(options);
    await heldCurrent(s);
    const opened = await openOriginalTaskReadResourceCaller(profile, options);
    s.physical = opened?.owner ?? null;
    if (!opened || typeof opened.errorPresent !== 'boolean') throw fault(s, 'TASK_CONTINUATION_PHYSICAL_OPEN_STATUS');
    if (opened.errorPresent) throw opened.error;
    const side = await openOriginalTaskReadResourceSidebandForContinuation(s.physical);
    s.sideband = side?.owner ?? null;
    if (!side || typeof side.errorPresent !== 'boolean') throw fault(s, 'TASK_CONTINUATION_SIDEBAND_STATUS');
    if (side.errorPresent) throw side.error;
    s.timeoutMs = side.timeoutMs; s.socket = takeOriginalTaskReadResourceSidebandSocket(s.sideband);
    s.controlDone = false; s.controlWork = controlLoop(s);
  } catch (error) {remember(s, error);}
  finally {s.opening = false; changed(s);}
  return Object.freeze({owner, errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null});
}
