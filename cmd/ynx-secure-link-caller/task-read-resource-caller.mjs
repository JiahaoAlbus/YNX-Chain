// PRIVATE Node -> original P08 Go resource transport. The original Auth
// bootstrap selects this registration while holding its actual Source and
// reserved operation loan. Unix credentials, body bytes and response DATA do
// not prove a Grant, reservation, Source, receipt or permission to execute.
// No global provider, authority DTO, URL/header setter or new native brand.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {closeSync} from 'node:fs';
import {createRequire} from 'node:module';
import {types} from 'node:util';

const native = createRequire(import.meta.url)('./build/caller.node');
const owners = new WeakMap(), responses = new WeakMap(), sidebands = new WeakMap();
const service = 'ynx-ai-original-task-read-v1';
const routePaths = Object.freeze({input: '/internal/ai/original-task-read/input',
  execute: '/internal/ai/original-task-read/execute', query: '/internal/ai/original-task-read/query'});
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const offsetOf = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
const lengthOf = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const setBytes = Uint8Array.prototype.set;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;

export class TaskReadResourceTransportError extends Error {
  constructor(code, message, {cause, dispatchPossible = false} = {}) {
    super(message, {cause}); this.name = 'TaskReadResourceTransportError'; this.code = code;
    this.dispatchPossible = dispatchPossible;
  }
}
function fault(code, message, cause) {return new TaskReadResourceTransportError(code, message, {cause});}
function exact(value, keys) {
  if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw fault('DENIED', 'plain private registration DATA required');
  const fields = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(fields);
  if (actual.length !== keys.length || keys.some(k => !fields[k] || !Object.hasOwn(fields[k], 'value')) || actual.some(k => typeof k !== 'string' || !keys.includes(k)))
    throw fault('DENIED', 'exact private DATA fields required');
  return Object.fromEntries(keys.map(k => [k, fields[k].value]));
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault('BOUNDS', 'bounded original transport DATA required');
  return value;
}
function registration(input) {
  const p = exact(input, ['socketPath', 'serverUID', 'serverPID', 'service', 'connectTimeoutMs', 'requestTimeoutMs', 'routes']);
  if (p.service !== service || typeof p.socketPath !== 'string' || !path.isAbsolute(p.socketPath) || path.normalize(p.socketPath) !== p.socketPath || /[\0\r\n]/.test(p.socketPath) || Buffer.byteLength(p.socketPath) >= (process.platform === 'darwin' ? 104 : 108))
    throw fault('DENIED', 'original finite resource service and Unix endpoint required');
  integer(p.serverUID, 0, 0xffffffff); integer(p.serverPID, 1, 0x7fffffff);
  integer(p.connectTimeoutMs, 1, 30000); integer(p.requestTimeoutMs, 1, 300000);
  if (!Array.isArray(p.routes) || types.isProxy(p.routes) || p.routes.length !== 3) throw fault('DENIED', 'all three original resource routes required');
  const list = Object.getOwnPropertyDescriptors(p.routes);
  if (Reflect.ownKeys(list).length !== 4 || [0, 1, 2].some(i => !Object.hasOwn(list[i] || {}, 'value')))
    throw fault('DENIED', 'owned finite route list required');
  const selected = new Map();
  for (const i of [0, 1, 2]) {
    const r = exact(list[i].value, ['id', 'method', 'path', 'maxRequestBytes', 'maxResponseBytes']);
    if (typeof r.id !== 'string' || !Object.hasOwn(routePaths, r.id) || r.method !== 'POST' || r.path !== routePaths[r.id] || selected.has(r.id))
      throw fault('DENIED', 'exact resource operation/method/path required');
    integer(r.maxRequestBytes, 1, 1 << 20); integer(r.maxResponseBytes, 1, 1 << 20);
    selected.set(r.id, Object.freeze(r));
  }
  return Object.freeze({...p, routes: Object.freeze([...selected.values()]), selected});
}
function capture(input, cap) {
  if (!types.isUint8Array(input) || types.isProxy(input)) throw fault('DENIED', 'owned original opaque bytes required');
  const backing = bufferOf.call(input), offset = offsetOf.call(input), size = lengthOf.call(input);
  if (types.isSharedArrayBuffer(backing)) throw fault('DENIED', 'shared request bytes refused');
  integer(size, 1, cap);
  const copy = Buffer.alloc(size); setBytes.call(copy, new Uint8Array(backing, offset, size)); return copy;
}
function signalOf(options) {
  if (options === undefined) return undefined;
  const {signal} = exact(options, ['signal']);
  if (signal !== undefined) {try {aborted.call(signal);} catch {throw fault('DENIED', 'original AbortSignal required');}}
  return signal;
}
function stateOf(owner) {
  const s = owner && owners.get(owner);
  if (!s || s.pid !== process.pid) throw fault('DENIED', 'same private original caller owner required');
  return s;
}
function packetOf(packet) {
  const p = packet && responses.get(packet);
  if (!p || p.state.pid !== process.pid || p.released) throw fault('CLOSED', 'same owned original response required');
  return p;
}
function changed(s) {for (const wake of s.waiters) wake(); s.waiters.clear();}
function wait(s, signal) {
  if (signal && aborted.call(signal)) return Promise.reject(reason.call(signal));
  return new Promise((resolve, reject) => {
    let ended = false;
    const finish = (present, error) => {if (ended) return; ended = true; s.waiters.delete(wake); if (signal) removeListener.call(signal, 'abort', cancel); if (present) reject(error); else resolve();};
    const wake = () => finish(false), cancel = () => finish(true, reason.call(signal));
    s.waiters.add(wake);
    if (signal) {addListener.call(signal, 'abort', cancel, {once: true}); if (aborted.call(signal)) cancel();}
  });
}
function remember(s, original, code = 'UNAVAILABLE') {
  if (!s.firstPresent) {
    s.firstPresent = true;
    s.first = original instanceof TaskReadResourceTransportError ? original : fault(code, 'original resource transport failed', original);
    s.first.dispatchPossible ||= s.dispatch;
  }
  changed(s); return s.first;
}
function current(s) {
  if (s.retired || s.closed || s.used && !s.inflight || !s.native || !s.socket || s.socket.destroyed || s.socketError)
    throw fault('DENIED', 'original resource connection unavailable', s.socketError);
  return Object.freeze({...native.current(s.native), service, dataOnly: true, sourceVerified: false, operationVerified: false});
}
function shutdown(s) {
  if (s.shutdownSelected) return;
  s.shutdownSelected = true; s.retired = true;
  try {
    if (s.native) {
      const outcome = native.retireOriginalTaskReadResource(s.native);
      if (outcome.physicalDone !== true) s.cleanupUnknown = true;
      if (outcome.errorPresent) {
        const error = fault('UNAVAILABLE', 'original resource descriptor cleanup failed');
        error.errno = outcome.errorNumber; error.unknownCloseBits = outcome.unknownCloseBits;
        remember(s, error);
      }
    }
  }
  catch (error) {s.cleanupUnknown = true; remember(s, error);}
  finally {s.nativeCloseReturned = true;}
  try {s.socket?.destroy(); s.agent?.destroy();}
  catch (error) {s.cleanupUnknown = true; remember(s, error);}
  if (!s.socket) s.socketClosed = true;
  changed(s);
}
function physical(s) {return !s.opening && !s.inflight && s.shutdownSelected && s.nativeCloseReturned && s.socketClosed && !s.packetHeld && !s.cleanupUnknown;}
function responseLoan(s, route) {
  const p = {state: s, released: false, route, chunks: [], received: 0, stored: 0, body: Buffer.alloc(0), statusCode: 0, headers: Object.create(null), rawHeaders: [], complete: false};
  const packet = Object.freeze({
    copyDATA() {
      const p = packetOf(this), s = p.state;
      return Object.freeze({method: 'POST', path: p.route.path, statusCode: p.statusCode,
        headers: Object.fromEntries(Object.entries(p.headers).map(([k, values]) => [k, [...values]])), rawHeaders: [...p.rawHeaders],
        body: Buffer.from(p.body), bodyComplete: p.complete, dispatchPossible: s.dispatch,
        requestBytesWritten: s.requestWritten, bytesReceived: p.received, service,
        terminalPeer: p.terminalPeer ? Object.freeze({...p.terminalPeer}) : null,
        peer: Object.freeze({uid: s.profile.serverUID, pid: s.profile.serverPID}), dataOnly: true, sourceVerified: false, operationVerified: false});
    },
    release() {
      const p = responses.get(this);
      if (!p || p.state.pid !== process.pid) throw fault('DENIED', 'same original response required');
      if (p.released) return;
      if (p.state.inflight) throw fault('DRAINING', 'original response still being written');
      p.released = true; p.body = null; p.chunks = null; p.state.packetHeld = false; changed(p.state);
    },
  });
  responses.set(packet, p); s.packetHeld = true; return {packet, p};
}
function exchange(s, operation, input, options) {
  let route, body, signal;
  try {
    signal = signalOf(options);
    if (s.retired || s.closed || s.used) throw fault('DENIED', 'original caller already consumed or retired');
    if (s.sidebandSelected && (!s.sidebandReady || operation !== 'execute')) throw fault('DENIED', 'protected sideband binds only its original execute');
    if (typeof operation !== 'string' || !s.profile?.selected.has(operation)) throw fault('DENIED', 'unregistered finite resource operation');
    route = s.profile.selected.get(operation); body = capture(input, route.maxRequestBytes);
    if (signal && aborted.call(signal)) throw fault('CANCELLED', 'resource request cancelled before dispatch', reason.call(signal));
  } catch (error) {return Promise.resolve(Object.freeze({response: null, errorPresent: true, error}));}
  // Reserve the response owner and bounded retained-data inventory BEFORE any
  // request can be handed to HTTP. No received late prefix is discarded just
  // because the operation also returns an error.
  let packet, p;
  try {({packet, p} = responseLoan(s, route)); current(s);}
  catch (error) {if (packet) packet.release(); remember(s, error); shutdown(s); return Promise.resolve(Object.freeze({response: null, errorPresent: true, error: s.first}));}
  s.used = true; s.inflight = true; s.requestBody = body;
  s.work = new Promise(resolve => {
    let request, response, settled = false, protocolFailure;
    const startWritten = s.socket.bytesWritten;
    const settle = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); if (signal) removeListener.call(signal, 'abort', onAbort);
      s.abortWork = null;
      s.requestWritten = Math.max(0, s.socket.bytesWritten - startWritten);
      p.body = Buffer.concat(p.chunks, p.stored); p.chunks = [];
      if (error) remember(s, error);
      // No application callback can outlive this actual descriptor drain.
      shutdown(s);
      try {response?.destroy(); request?.destroy();} catch (error) {s.cleanupUnknown = true; remember(s, error);}
      s.requestBody = null;
      s.socketCloseWork.then(() => {
        s.inflight = false; changed(s);
        resolve(Object.freeze({response: packet, errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null}));
      });
    };
    const onAbort = () => settle(fault('CANCELLED', 'original resource request cancelled', reason.call(signal)));
    s.abortWork = () => settle(fault('CANCELLED', 'original resource caller retired'));
    const timer = setTimeout(() => settle(fault('TIMEOUT', 'original resource request timed out')), s.profile.requestTimeoutMs);
    if (signal) addListener.call(signal, 'abort', onAbort, {once: true});
    try {
      current(s);
      const agent = new http.Agent({keepAlive: true, maxSockets: 1, maxFreeSockets: 1});
      let transferred = false;
      agent.createConnection = () => {if (transferred) throw fault('DENIED', 'reconnect/retry refused'); transferred = true; return s.socket;};
      s.agent = agent;
      request = http.request({method: 'POST', path: route.path, host: service, port: 80, agent, maxHeaderSize: 64 << 10,
        headers: {Host: service, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': String(body.length), Connection: 'keep-alive'}}, incoming => {
        response = incoming; p.statusCode = incoming.statusCode;
        // Attach even when the first header check fails: destroying a real
        // response can emit its original stream error asynchronously.
        incoming.once('error', error => settle(error));
        p.headers = Object.fromEntries(Object.entries(incoming.headersDistinct).map(([k, values]) => [k, [...values]]));
        p.rawHeaders = [...incoming.rawHeaders];
        if (p.headers['content-type']?.length !== 1 || p.headers['content-type'][0] !== 'application/json' || p.headers['content-encoding']?.length)
          protocolFailure = fault('DENIED', 'original resource response media rejected');
        const declared = incoming.headers['content-length'];
        if (declared !== undefined && (!/^(0|[1-9][0-9]*)$/.test(declared) || BigInt(declared) > BigInt(route.maxResponseBytes)))
          return settle(fault('BOUNDS', 'original resource response bound exceeded'));
        incoming.on('data', chunk => {
          if (settled) return;
          p.received += chunk.length;
          const room = route.maxResponseBytes - p.stored;
          if (room) {const owned = Buffer.from(chunk.subarray(0, room)); p.chunks.push(owned); p.stored += owned.length;}
          if (p.received > route.maxResponseBytes) settle(fault('BOUNDS', 'original resource response bound exceeded'));
        });
        incoming.once('close', () => {if (!incoming.complete) settle(fault('UNAVAILABLE', 'original resource response incomplete'));});
        incoming.once('end', () => {
          if (settled) return;
          p.complete = incoming.complete && p.received <= route.maxResponseBytes;
          if (!p.complete) return settle(fault('UNAVAILABLE', 'original resource response incomplete'));
          // Same original native connection, not a response-supplied peer DTO.
          // Late failure keeps complete status/headers/body with its first cause.
          try {p.terminalPeer = native.inspectOriginalTaskReadResourcePeer(s.native);} catch (error) {return settle(protocolFailure || error);}
          settle(protocolFailure);
        });
      });
      request.once('error', error => settle(error));
      current(s);
      if (signal && aborted.call(signal)) return onAbort();
      // HTTP owns the bytes from here. A later error cannot prove no dispatch.
      s.dispatch = true;
      request.end(body);
    } catch (error) {settle(error);}
  });
  return s.work;
}

// This private composition entry accepts transport registration DATA only.
// Auth alone mints/selects its actual reserved Source/resource loan. In
// particular P08's RawInput []byte stays its existing JSON/base64 DATA; LINK
// neither decodes that schema nor fabricates a different reservation slot.
export async function openOriginalTaskReadResourceCaller(profile, options) {
  const s = {pid: process.pid, opening: true, profile: null, native: null, socket: null, socketError: null,
    socketClosed: false, socketCloseWork: null, nativeCloseReturned: false, shutdownSelected: false,
    used: false, inflight: false, dispatch: false, requestWritten: 0, packetHeld: false, work: null,
    retired: false, closed: false, cleanupUnknown: false, firstPresent: false, first: null, waiters: new Set()};
  const owner = Object.freeze({
    current() {return current(stateOf(this));},
    exchange(operation, input, options) {let s; try {s = stateOf(this);} catch (error) {return Promise.resolve(Object.freeze({response: null, errorPresent: true, error}));} return exchange(s, operation, input, options);},
    retire() {const s = stateOf(this); if (s.abortWork) s.abortWork(); else shutdown(s);},
    async join(options) {
      const s = stateOf(this), signal = signalOf(options);
      if (!s.retired) throw fault('DENIED', 'retire original caller before join');
      while (!physical(s)) {if (s.cleanupUnknown) throw s.first; await wait(s, signal);}
      if (s.firstPresent) throw s.first;
    },
    async close(options) {
      let s; try {s = stateOf(this); owner.retire(); await owner.join(options);}
      catch (error) {if (!s || !physical(s)) return Object.freeze({physicalDone: false, errorPresent: true, error});}
      s.closed = true;
      return Object.freeze({physicalDone: true, errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null});
    },
    lifetime() {
      const s = stateOf(this);
      return Object.freeze({retired: s.retired, requestInFlight: s.inflight, packetHolds: s.packetHeld ? 1 : 0,
        localFDClosed: s.nativeCloseReturned && s.socketClosed && !s.cleanupUnknown, joined: physical(s), closed: s.closed,
        dispatchPossible: s.dispatch, unknown: s.dispatch && s.firstPresent || s.cleanupUnknown,
        firstCausePresent: s.firstPresent, dataOnly: true, sourceVerified: false, operationVerified: false});
    },
    firstCause() {const s = stateOf(this); return s.firstPresent ? s.first : null;},
  });
  owners.set(owner, s);
  let signal, onAbort, signalSelected = false;
  try {
    s.profile = registration(profile); signal = signalOf(options);
    if (['connectUnix', 'current', 'takeFD', 'inspectOriginalTaskReadResourcePeer', 'retireOriginalTaskReadResource'].some(name => typeof native[name] !== 'function'))
      throw fault('UNAVAILABLE', 'matching original resource native implementation required before connect');
    if (signal && aborted.call(signal)) throw fault('CANCELLED', 'original resource connect cancelled', reason.call(signal));
    onAbort = () => {signalSelected = true;};
    if (signal) addListener.call(signal, 'abort', onAbort, {once: true});
    s.native = await native.connectUnix({socketPath: s.profile.socketPath, serverUID: s.profile.serverUID,
      serverPID: s.profile.serverPID, timeoutMs: s.profile.connectTimeoutMs});
    if (signalSelected || signal && aborted.call(signal)) throw fault('CANCELLED', 'original resource connect cancelled', reason.call(signal));
    native.current(s.native);
    const fd = native.takeFD(s.native);
    try {s.socket = new net.Socket({fd, readable: true, writable: true});}
    catch (error) {try {closeSync(fd);} catch (closeError) {s.cleanupUnknown = true; s.transferredFDDebt = {fd, error: closeError};} throw error;}
    s.socketCloseWork = new Promise(resolve => s.socket.once('close', () => {s.socketClosed = true; changed(s); resolve();}));
    s.socket.on('error', error => {s.socketError ??= error;});
    current(s);
  } catch (error) {
    if (error?.cleanupUnknown === true) {s.cleanupUnknown = true; s.connectCleanupError = error;}
    remember(s, error); shutdown(s);
    if (s.socketCloseWork) await s.socketCloseWork;
  } finally {
    if (signal && onAbort) removeListener.call(signal, 'abort', onAbort);
    s.opening = false; changed(s);
  }
  return Object.freeze({owner, errorPresent: s.firstPresent, error: s.firstPresent ? s.first : null});
}

// Package-private transport port used only by task-read-resource-continuation.
// It opens a real socketpair and sends its receiver end on this SAME native
// data connection. No caller fd, Source callback or authority brand is accepted.
export async function openOriginalTaskReadResourceSidebandForContinuation(owner) {
  const s = stateOf(owner);
  if (s.used || s.retired || s.sidebandSelected || typeof native.openTaskReadResourceSideband !== 'function')
    return Object.freeze({owner: null, errorPresent: true, error: fault('DENIED', 'one matching original sideband implementation required')});
  s.sidebandSelected = true;
  const c = {pid: process.pid, parent: s, socket: null, socketClosed: false, nativeDone: false, cleanupUnknown: false,
    firstPresent: false, first: undefined, markerWritten: false, retired: false, socketBorrowed: false, waiters: new Set()};
  const control = Object.freeze({
    retire() {
      if (sidebands.get(this) !== c || c.pid !== process.pid) throw fault('DENIED', 'same original sideband required');
      if (!c.retired) {c.retired = true; c.socket?.destroy(); if (!c.socket) c.socketClosed = true; changed(c);}
    },
    async join(options) {
      if (sidebands.get(this) !== c || c.pid !== process.pid) throw fault('DENIED', 'same original sideband required');
      const signal = signalOf(options);
      while (!c.nativeDone || !c.socketClosed) await wait(c, signal);
      return Object.freeze({physicalDone: !c.cleanupUnknown, errorPresent: c.firstPresent, error: c.firstPresent ? c.first : null});
    },
    lifetime() {
      if (sidebands.get(this) !== c || c.pid !== process.pid) throw fault('DENIED', 'same original sideband required');
      return Object.freeze({markerWritten: c.markerWritten, nativeDone: c.nativeDone, socketClosed: c.socketClosed,
        physicalDone: c.nativeDone && c.socketClosed && !c.cleanupUnknown, cleanupUnknown: c.cleanupUnknown});
    },
  });
  sidebands.set(control, c);
  const failed = error => {if (!c.firstPresent) {c.firstPresent = true; c.first = error;} if (error?.cleanupUnknown === true) {c.cleanupUnknown = true; s.cleanupUnknown = true;} };
  try {
    current(s);
    const result = await native.openTaskReadResourceSideband(s.native, {timeoutMs: Math.min(s.profile.connectTimeoutMs, 30000)});
    // Adopt the actual owned Node endpoint even when native transfer/cleanup
    // also returns an error. It is never reconstructed from a fd/JSON setter.
    if (Number.isInteger(result?.fd) && result.fd >= 0) {
      try {c.socket = new net.Socket({fd: result.fd, readable: true, writable: true, highWaterMark: 1024});}
      catch (error) {try {closeSync(result.fd);} catch (closeError) {c.cleanupUnknown = true; s.cleanupUnknown = true; c.fdDebt = {fd: result.fd, error: closeError};} throw error;}
      c.socket.on('error', error => {c.socketError = error;});
      c.socket.once('close', () => {c.socketClosed = true; changed(c);});
    } else c.socketClosed = true;
    c.markerWritten = result?.markerWritten === true;
    if (result?.cleanupUnknown === true) {c.cleanupUnknown = true; s.cleanupUnknown = true;}
    if (!result || typeof result.errorPresent !== 'boolean') failed(fault('UNAVAILABLE', 'resource sideband status missing'));
    else if (result.errorPresent) failed(result.error);
    else if (!c.socket || !c.markerWritten) failed(fault('UNAVAILABLE', 'resource sideband was not transferred'));
    s.sidebandReady = !c.firstPresent;
  } catch (error) {failed(error);}
  finally {c.nativeDone = true; changed(c);}
  return Object.freeze({owner: control, timeoutMs: Math.min(s.profile.requestTimeoutMs, 30000), errorPresent: c.firstPresent, error: c.firstPresent ? c.first : null});
}

// Borrowed package-private original socket, one reader/worker only. This is a
// transport reference, not proof that a Source/Grant or reservation is genuine.
export function takeOriginalTaskReadResourceSidebandSocket(control) {
  const c = control && sidebands.get(control);
  if (!c || c.pid !== process.pid || c.socketBorrowed || !c.socket || c.retired) throw fault('DENIED', 'same one original sideband socket required');
  c.socketBorrowed = true; return c.socket;
}
