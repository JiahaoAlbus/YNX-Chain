// PRIVATE original-bootstrap transport, not a TaskGrant/Source constructor.
// The Auth normal owner must select and verify its original caller resource
// before invoking this package-internal constructor. The profile and handler
// are transport DATA; they cannot populate Auth's reviewed Source selection.
// Only the seven original desktop-TaskGrant POST routes are accepted. The
// separate legacy two-route L factory is unchanged.
import {
  openInboundDesktopTaskGrantServer, acquireInboundCaller, currentInboundCaller,
  assertCurrentInboundCaller, releaseInboundCaller,
  retireInboundAuthorityServer, joinInboundAuthorityServer,
  closeInboundAuthorityServer, inboundAuthorityServerLifetime,
} from './inbound-caller.mjs';
import {fault, signalOf, waitForChange, changed} from './task-grant-transport-private.mjs';

const owners = new WeakMap();
const callers = new WeakMap();

function stateOf(owner) {
  const s = owner && owners.get(owner);
  if (!s || s.pid !== process.pid) throw fault('TASK_GRANT_TRANSPORT_ORIGINAL_OWNER_REQUIRED');
  return s;
}
function alive(s) {
  if (s.retired || s.closed || !s.server) throw fault('TASK_GRANT_TRANSPORT_RETIRED');
  if (s.firstPresent) throw s.first;
}
function recordOf(s, caller, cleanup = false) {
  const r = caller && callers.get(caller);
  if (!r || r.owner !== s || !s.callers.has(r) || r.released || r.pid !== process.pid)
    throw fault('TASK_GRANT_TRANSPORT_ORIGINAL_CALLER_REQUIRED');
  if (!cleanup) { alive(s); if (r.releasing || r.releaseFailed) throw fault('TASK_GRANT_TRANSPORT_CALLER_RELEASING', r.releaseFailure); }
  return r;
}
function remember(s, error, cleanup = false) {
  if (!s.firstPresent) { s.firstPresent = true; s.first = error; }
  if (cleanup && !s.cleanupUnknown) { s.cleanupUnknown = true; s.cleanupFailure = error; }
  return error;
}
function rememberCaller(r, error) { if (!r.firstPresent) { r.firstPresent = true; r.first = error; } }
function originalHandlerFailure(error) {
  // Legacy L's failure slot uses truthiness. A real rejected undefined/false/0
  // must stay a rejection there too; our independent first slot keeps the raw
  // original value. This does not reinterpret a normal return of undefined.
  return fault('TASK_GRANT_TRANSPORT_ORIGINAL_HANDLER_FAILED', error);
}
function track(s, r, work) {
  s.pending.add(work); r?.pending.add(work);
  work.finally(() => { s.pending.delete(work); r?.pending.delete(work); changed(s); }).catch(() => {});
  return work;
}

// This name is intentionally not a public normal acquisition/provider setter.
// Auth's zero-input normal backend owns the one call and keeps the returned
// owner, including a non-null failure partial. No global listener registry or
// cross-image private-brand claim is installed here.
export async function openTaskGrantInboundTransportForOriginalBootstrap(profile, originalHandler) {
  const s = {pid: process.pid, server: null, retired: false, closed: false,
    first: null, firstPresent: false, cleanupFailure: undefined, cleanupUnknown: false, callers: new Set(), pending: new Set(),
    requests: new WeakMap(), waiters: new Set(), serverJoin: null, serverJoined: false, closeWork: null};
  const owner = Object.freeze({
    // Zero-input getter returns this owner's real opaque L listener, never a
    // reconstructed profile or an Auth caller context. No Source rights follow.
    registeredServer() {
      if (arguments.length) throw fault('TASK_GRANT_TRANSPORT_ZERO_INPUT_REQUIRED');
      const s = stateOf(owner); alive(s); return s.server;
    },
    acquireOriginalInbound(request) {
      const s = stateOf(owner);
      const run = (async () => {
        let caller, r;
        try {
          alive(s);
          if (s.requests.has(request)) throw fault('TASK_GRANT_TRANSPORT_REQUEST_ALREADY_CAPTURED');
          const handle = acquireInboundCaller(request, s.server);
          caller = Object.freeze(Object.create(null));
          r = {owner: s, pid: process.pid, request, handle, pending: new Set(),
            releasing: false, released: false, releaseFailed: false, releaseFailure: undefined, firstPresent: false, first: null};
          callers.set(caller, r); s.requests.set(request, r); s.callers.add(r); changed(s);
          // Mint/adopt before asynchronous freshness can fail. The caller must
          // release the non-null partial even after cancellation or retirement.
          await owner.currentOriginalInbound(caller);
          return Object.freeze({caller, errorPresent: false, error: null});
        } catch (error) {
          if (r) rememberCaller(r, error);
          return Object.freeze({caller: caller ?? null, errorPresent: true, error});
        }
      })();
      return track(s, null, run);
    },
    currentOriginalInbound(caller) {
      const s = stateOf(owner);
      let r;
      try { r = recordOf(s, caller); } catch (error) { return Promise.reject(error); }
      let material;
      const run = (async () => {
        recordOf(s, caller);
        material = await currentInboundCaller(r.request, r.handle, s.server);
        recordOf(s, caller);
        return material; // Original opaque body/transport DATA, no Auth parsing.
      })().catch(error => {
        const failure = material === undefined ? error
          : Object.assign(fault('TASK_GRANT_TRANSPORT_LATE_CALLER_FAILURE', error), {transportData: material});
        rememberCaller(r, failure);
        // Legacy L removes settled currents before Join takes its snapshot.
        // An operation rejected during retirement must therefore retain its
        // own original failure here. Active-listener refusals remain local to
        // their caller; neither case makes known physical drain UNKNOWN.
        if (s.retired) remember(s, failure);
        throw failure;
      });
      return track(s, r, run);
    },
    assertOriginalInboundAtCommit(caller) {
      // Error only; private flags + the original descriptor-only local fence.
      // No Source/full Current, control/OS IO, caller callback or body copying.
      const s = stateOf(owner), r = recordOf(s, caller);
      assertCurrentInboundCaller(r.request, r.handle, s.server);
    },
    releaseOriginalInbound(caller) {
      const s = stateOf(owner);
      let r;
      try { r = recordOf(s, caller, true); } catch (error) { return Promise.reject(error); }
      if (r.releasing) return r.releaseWork;
      if (r.releaseFailed) return Promise.reject(r.releaseFailure);
      r.releasing = true;
      const run = (async () => {
        await Promise.allSettled([...r.pending]);
        try {
          // Logical hold only. The original response may still need its socket
          // and control capability after the Auth resolver releases its caller.
          if (releaseInboundCaller(r.handle) !== undefined) throw fault('TASK_GRANT_TRANSPORT_RELEASE_RESULT');
          r.released = true; s.callers.delete(r); changed(s);
        } catch (error) {
          r.releaseFailed = true; r.releaseFailure = error; remember(s, error, true); throw error;
        }
      })();
      r.releaseWork = run;
      return track(s, null, run);
    },
    retire() {
      const s = stateOf(owner);
      if (!s.retired) {
        s.retired = true;
        try { if (s.server) retireInboundAuthorityServer(s.server); }
        catch (error) { remember(s, error, true); }
        changed(s);
      }
      if (s.cleanupUnknown) throw s.cleanupFailure;
    },
    async join(options) {
      const s = stateOf(owner), signal = signalOf(options);
      if (!s.retired) throw fault('TASK_GRANT_TRANSPORT_RETIRE_REQUIRED');
      if (!s.serverJoin) {
        s.serverJoin = (async () => {
          try {
            if (s.server) await joinInboundAuthorityServer(s.server);
          } catch (error) {
            remember(s, error);
            if (!s.server || !inboundAuthorityServerLifetime(s.server).physicalJoined) remember(s, error, true);
          } finally {
            s.serverJoined = !s.server || inboundAuthorityServerLifetime(s.server).physicalJoined;
            changed(s);
          }
        })();
        s.serverJoin.catch(error => { remember(s, error, true); changed(s); });
      }
      while (!s.serverJoined || s.pending.size || s.callers.size) {
        if (s.cleanupUnknown) throw s.cleanupFailure;
        await waitForChange(s, signal);
      }
      if (s.cleanupUnknown) throw s.cleanupFailure;
      if (s.firstPresent) throw s.first;
    },
    async close(options) {
      const s = stateOf(owner);
      if (s.closed) { if (s.firstPresent) throw s.first; return; }
      owner.retire();
      try { await owner.join(options); }
      catch (error) {
        // A known original failure can coexist with actual drain. An aborted
        // wait or unknown cleanup cannot select a physical close on its own.
        if (!s.serverJoined || s.pending.size || s.callers.size || s.cleanupUnknown) throw error;
      }
      if (!s.closeWork) s.closeWork = (async () => {
        try {
          if (s.server) await closeInboundAuthorityServer(s.server);
        } catch (error) { remember(s, error); }
        finally {
          s.closed = !s.server || inboundAuthorityServerLifetime(s.server).physicalClosed;
          if (!s.closed) remember(s, fault('TASK_GRANT_TRANSPORT_CLOSE_UNKNOWN'), true);
          changed(s);
        }
        if (s.cleanupUnknown) throw s.cleanupFailure;
        if (s.firstPresent) throw s.first;
      })();
      await s.closeWork;
    },
    lifetime() {
      if (arguments.length) throw fault('TASK_GRANT_TRANSPORT_ZERO_INPUT_REQUIRED');
      const s = stateOf(owner);
      return Object.freeze({retired: s.retired, joined: s.serverJoined && !s.pending.size && !s.callers.size && !s.cleanupUnknown,
        closed: s.closed, pending: s.pending.size, callerHolds: s.callers.size, cleanupUnknown: s.cleanupUnknown, firstCausePresent: s.firstPresent,
        sourceVerified: false, operationVerified: false});
    },
    firstCause() {
      if (arguments.length) throw fault('TASK_GRANT_TRANSPORT_ZERO_INPUT_REQUIRED');
      return stateOf(owner).first;
    },
    firstCallerCause(caller) { const s = stateOf(owner); return recordOf(s, caller, true).first; },
  });
  owners.set(owner, s);
  try {
    if (typeof originalHandler !== 'function') throw fault('TASK_GRANT_TRANSPORT_ORIGINAL_HANDLER_REQUIRED');
    s.server = await openInboundDesktopTaskGrantServer(profile, (req, res) => {
      alive(s);
      const work = Promise.resolve().then(() => { alive(s); return originalHandler(req, res); })
        .catch(error => { remember(s, error); throw originalHandlerFailure(error); });
      return track(s, null, work);
    });
    return Object.freeze({owner, errorPresent: false, error: null});
  } catch (error) {
    remember(s, error);
    return Object.freeze({owner, errorPresent: true, error});
  }
}
