// PRIVATE six-callee adapter consumed by Auth's independently qualified
// readOriginalTaskReadClientModulePath. It is not a normal Root/Source factory
// or a continuation provider. The normal Auth source must pin THIS module,
// its unchanged finite3 primitive and the matching caller.node closure.
import {openOriginalTaskReadResourceCaller as openPhysical} from './task-read-resource-caller.mjs';

const handles = new WeakMap();
function fault(code, cause) {return Object.assign(new Error(code, {cause}), {code, dispatchPossible: false});}
function stateOf(handle) {
  const s = handle && handles.get(handle);
  if (!s || s.pid !== process.pid) throw fault('TASK_RESOURCE_ORIGINAL_HANDLE_REQUIRED');
  return s;
}
function remember(s, error) {
  if (!s.firstPresent) {s.firstPresent = true; s.first = error;}
  return s.first;
}
function cleanupFailure(s, error) {
  remember(s, error);
  if (!s.cleanupFirstPresent) {s.cleanupFirstPresent = true; s.cleanupFirst = error;}
}
function deliver(s, error) {
  if (s.firstPresent && error === s.first) s.firstObserved = true;
  if (s.cleanupFirstPresent && error === s.cleanupFirst) s.cleanupFirstObserved = true;
  throw error;
}
function harvest(s) {
  const life = s.owner?.lifetime();
  if (life?.firstCausePresent === true) remember(s, s.owner.firstCause());
  return life;
}
function lateFault(s, code) {
  const error = fault(code);
  error.dispatchPossible = s.owner?.lifetime().dispatchPossible === true;
  return error;
}
function pendingError(s) {
  if (s.firstPresent && !s.firstObserved) deliver(s, s.first);
  if (s.cleanupFirstPresent && !s.cleanupFirstObserved) deliver(s, s.cleanupFirst);
}
function physical(s) {return s.owner?.lifetime().joined === true;}
function ownPacket(data) {
  const headers = Object.fromEntries(Object.entries(data.headers).map(([key, values]) => [key, Object.freeze([...values])]));
  return Object.freeze({...data, headers: Object.freeze(headers), rawHeaders: Object.freeze([...data.rawHeaders]),
    body: Buffer.from(data.body), terminalPeer: data.terminalPeer ? Object.freeze({...data.terminalPeer}) : null});
}

// The actual Auth bridge assigns handle=await open(...) BEFORE calling Current.
// Even an opening error therefore returns its genuine private partial. The
// following Current raises the same retained error after that adoption.
export async function openOriginalTaskReadResourceCaller(profile, options) {
  if (arguments.length < 1 || arguments.length > 2) throw fault('TASK_RESOURCE_OPEN_ARITY');
  const handle = Object.freeze(Object.create(null));
  const s = {pid: process.pid, owner: null, firstPresent: false, first: undefined, firstObserved: false,
    cleanupFirstPresent: false, cleanupFirst: undefined, cleanupFirstObserved: false,
    retired: false, joined: false, closed: false, selected: false, openUnknown: false,
    response: null, responseReleased: false, packet: null, originalBody: null, work: null, closeWork: null};
  handles.set(handle, s);
  try {
    const opened = await openPhysical(profile, options);
    // Adopt before looking at error presence. The primitive's genuine owner
    // supplies the eventual descriptor/work facts, never a caller bool.
    s.owner = opened?.owner ?? null;
    if (!s.owner || typeof opened.errorPresent !== 'boolean') {
      s.openUnknown = true; remember(s, fault('TASK_RESOURCE_PHYSICAL_OPEN_UNKNOWN'));
    } else if (opened.errorPresent) remember(s, opened.error);
  } catch (error) {s.openUnknown = true; remember(s, error);}
  return handle;
}

export function currentOriginalTaskReadResourceCaller(handle) {
  if (arguments.length !== 1) throw fault('TASK_RESOURCE_CURRENT_ARITY');
  const s = stateOf(handle);
  harvest(s);
  if (s.firstPresent) deliver(s, s.first);
  if (s.cleanupFirstPresent) deliver(s, s.cleanupFirst);
  if (s.retired || s.closed || !s.owner) throw fault('TASK_RESOURCE_ORIGINAL_CALLER_RETIRED');
  if (!s.selected || !s.packet) {s.owner.current(); return;}
  // Complete HTTP from the SAME held attempt can legitimately end in server
  // FIN. This is a held-response integrity observation, not a fresh live-peer
  // Current or Source approval. Auth's nativeRoot current remains a separate
  // required AND before/after its result decoding.
  const life = s.owner.lifetime(), data = s.packet;
  if (life.requestInFlight || !life.localFDClosed || !life.packetHolds || !data.bodyComplete || !data.dispatchPossible ||
      !data.terminalPeer || data.terminalPeer.livenessProved !== false ||
      !(data.terminalPeer.peerIdentityAvailable || data.terminalPeer.terminalEOFObserved) ||
      !Buffer.isBuffer(data.body) || !data.body.equals(s.originalBody))
    deliver(s, remember(s, lateFault(s, 'TASK_RESOURCE_ORIGINAL_PACKET_CHANGED')));
}

export function exchangeOriginalTaskReadResource(handle, stage, input, options) {
  if (arguments.length < 3 || arguments.length > 4) return Promise.reject(fault('TASK_RESOURCE_EXCHANGE_ARITY'));
  const s = stateOf(handle);
  harvest(s);
  if (s.firstPresent) {s.firstObserved = true; return Promise.reject(s.first);}
  if (s.retired || s.closed || s.selected || !s.owner) return Promise.reject(fault('TASK_RESOURCE_ORIGINAL_CALLER_CONSUMED'));
  // Execute requires the SAME original continuation carrier retained into the
  // receiver's final Store.mu claim. No wire/opID/proof DATA can supply it.
  // This normal DATA adapter serves the actual input/query call sites only.
  if (stage !== 'input' && stage !== 'query') return Promise.reject(fault('TASK_RESOURCE_PROTECTED_CONTINUATION_REQUIRED'));
  s.selected = true;
  s.work = (async () => {
    const opened = await s.owner.exchange(stage, input, options);
    s.response = opened?.response ?? null; // Adopt original loan BEFORE error.
    if (!opened || typeof opened.errorPresent !== 'boolean') remember(s, lateFault(s, 'TASK_RESOURCE_EXCHANGE_STATUS'));
    else if (opened.errorPresent) remember(s, opened.error);
    if (s.response) {
      try {
        s.packet = ownPacket(s.response.copyDATA());
        s.originalBody = Buffer.from(s.packet.body);
      } catch (error) {remember(s, error);}
    }
    // Actual Auth does packet=await exchange, then Current. Returning first is
    // essential: throwing a late error here would discard that assignment's
    // only transport partial. Current never washes away this retained error.
    return s.packet;
  })().catch(error => {remember(s, error); return s.packet;});
  return s.work;
}

export function retireOriginalTaskReadResourceCaller(handle) {
  if (arguments.length !== 1) throw fault('TASK_RESOURCE_RETIRE_ARITY');
  const s = stateOf(handle);
  if (!s.retired) {
    s.retired = true;
    try {s.owner?.retire();}
    catch (error) {cleanupFailure(s, error); deliver(s, error);}
    finally {harvest(s);}
  }
}

async function drain(s, options) {
  if (!s.retired) throw fault('TASK_RESOURCE_RETIRE_REQUIRED');
  if (s.openUnknown || !s.owner) throw s.firstPresent ? s.first : fault('TASK_RESOURCE_PHYSICAL_OPEN_UNKNOWN');
  if (s.work) await s.work;
  if (s.response && !s.responseReleased) {
    try {s.response.release(); s.responseReleased = true;}
    catch (error) {cleanupFailure(s, error); deliver(s, error);}
  }
  try {await s.owner.join(options);}
  catch (error) {
    // A known original request failure was already delivered through Current.
    // It does not turn actually returned descriptors/work into unknown debt.
    // Conversely an aborted wait/cleanup UNKNOWN cannot assert physical join.
    harvest(s);
    if (!physical(s)) deliver(s, error);
    s.joined = true;
    if (!(s.firstPresent && error === s.first && s.firstObserved) &&
        !(s.cleanupFirstPresent && error === s.cleanupFirst && s.cleanupFirstObserved)) {
      if (!(s.firstPresent && error === s.first)) cleanupFailure(s, error);
      deliver(s, error);
    }
  }
  if (!physical(s)) throw fault('TASK_RESOURCE_PHYSICAL_JOIN_PENDING');
  s.joined = true; harvest(s); pendingError(s);
}

export async function joinOriginalTaskReadResourceCaller(handle, options) {
  if (arguments.length < 1 || arguments.length > 2) throw fault('TASK_RESOURCE_JOIN_ARITY');
  await drain(stateOf(handle), options);
}

export async function closeOriginalTaskReadResourceCaller(handle, options) {
  if (arguments.length < 1 || arguments.length > 2) throw fault('TASK_RESOURCE_CLOSE_ARITY');
  const s = stateOf(handle);
  if (s.closed) return;
  if (!s.retired) retireOriginalTaskReadResourceCaller(handle);
  await drain(s, options);
  if (!s.closeWork) s.closeWork = (async () => {
    let outcome;
    try {outcome = await s.owner.close();}
    catch (error) {
      cleanupFailure(s, error); harvest(s);
      if (physical(s) && s.owner.lifetime().closed === true) s.closed = true;
      deliver(s, error);
    }
    harvest(s);
    if (outcome?.errorPresent === true) {
      if (!(s.firstPresent && outcome.error === s.first)) cleanupFailure(s, outcome.error);
      else remember(s, outcome.error);
    }
    if (!outcome || outcome.physicalDone !== true || !physical(s)) {
      const error = outcome?.errorPresent === true ? outcome.error : fault('TASK_RESOURCE_PHYSICAL_CLOSE_UNKNOWN');
      cleanupFailure(s, error); deliver(s, error);
    }
    s.closed = true; pendingError(s);
  })();
  await s.closeWork;
}

// Evidence only. No setter, private reservation/Source constructor, receipt
// verifier, completion bool installer or new resource selection is exposed.
export function inspectOriginalTaskReadResourceCallerLifetime(handle) {
  if (arguments.length !== 1) throw fault('TASK_RESOURCE_LIFETIME_ARITY');
  const s = stateOf(handle);
  return Object.freeze({retired: s.retired, joined: s.joined, closed: s.closed,
    firstCausePresent: s.firstPresent, firstCause: s.firstPresent ? s.first : undefined,
    firstObserved: s.firstObserved, cleanupFirstPresent: s.cleanupFirstPresent,
    cleanupFirst: s.cleanupFirstPresent ? s.cleanupFirst : undefined, cleanupFirstObserved: s.cleanupFirstObserved,
    responseHeld: !!s.response && !s.responseReleased, physical: s.owner?.lifetime() ?? null,
    dataOnly: true, sourceVerified: false, operationVerified: false});
}
