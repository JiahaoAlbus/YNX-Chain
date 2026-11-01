/* Fixed App transport only. Presence and kernel peer metadata never grant a
 * webpage OS identity, Wallet approval, signing or production execution. */
(() => {
  'use strict';
  const VERSION = 'YNX-NETWORK-NATIVE-BRIDGE/v1';
  const IPC = 'YNX-NETWORK-LOCAL-IPC/v1';
  const LIMIT = 12 << 10;
  const operations = new Set([
    'status', 'node_prepare', 'node_install', 'node_start', 'node_stop',
    'node_restart', 'node_status', 'node_artifact', 'resource_status',
    'resource_meter', 'resource_stop', 'resource_review', 'resource_review_cancel',
    'participation_prepare', 'participation_review', 'participation_cancel',
    'participation_reconcile', 'participation_revoke', 'participation_get',
    'participation_submit', 'participation_list', 'participation_resolve'
  ]);
  const entryOperations = new Set(['participation_review', 'participation_cancel',
    'participation_reconcile', 'participation_get', 'participation_submit']);
  const nodeDecisions = new Set(['node_install', 'node_start', 'node_stop']);
  const handler = window.webkit?.messageHandlers?.networkNative;
  const origin = window.location.origin;
  const local = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  const present = window.top === window && !!local && Number(local[1]) <= 65535 &&
    typeof handler?.postMessage === 'function';
  const pending = new Map();
  let session = null, last = null, retired = false;
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const token = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
  // Original participation Service.reference; distinct from the IPC packet ID.
  const requestReference = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
  const generation = v => typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v);
  const keys = (v, allowed, required = allowed) => object(v) &&
    Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k));
  const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;
  const failure = (code, outcome = 'NOT_SENT', requestId = '') =>
    Object.assign(new Error(code), { code, outcome, requestId });
  const state = code => window.dispatchEvent(new CustomEvent('network:native-state', {
    detail: Object.freeze({ version: VERSION, available: present, ready: !!session,
      code, authority: false })
  }));
  function rejectPending(code) {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(failure(code, 'UNKNOWN', id));
    }
    pending.clear();
  }
  function payloadFor(operation, payload) {
    let allowed = [], required = [];
    if (entryOperations.has(operation)) allowed = required = ['id'];
    else if (operation === 'participation_resolve') allowed = required = ['requestId'];
    else if (operation === 'participation_prepare') {
      allowed = ['requestId', 'owner', 'action', 'proposal', 'choice', 'validator',
        'delegationId', 'unbondingId', 'amountYnxt', 'feeCapYnxt', 'expiresAt'];
      required = ['requestId', 'owner', 'action', 'feeCapYnxt', 'expiresAt'];
    } else if (operation === 'node_prepare') allowed = required = ['action', 'artifactSHA256'];
    else if (nodeDecisions.has(operation)) allowed = required =
      ['managerId', 'nodeId', 'action', 'artifactSHA256', 'generation'];
    else if (operation === 'participation_list') allowed = ['cursor', 'limit'];
    if (!keys(payload, allowed, required) ||
      Object.entries(payload).some(([k, v]) => operation === 'participation_list' && k === 'limit' ?
        !Number.isInteger(v) || v < 1 || v > 50 : typeof v !== 'string') || bytes(payload) > LIMIT ||
      ('cursor' in payload && new TextEncoder().encode(payload.cursor).length > 512) ||
      ('id' in payload && !token(payload.id)) ||
      ('requestId' in payload && !requestReference(payload.requestId)) ||
      ('generation' in payload && !generation(payload.generation)) ||
      ('artifactSHA256' in payload && payload.artifactSHA256 !== '' && !/^[0-9a-fA-F]{64}$/.test(payload.artifactSHA256))) {
      throw failure('NATIVE_INVALID_REQUEST');
    }
    return JSON.parse(JSON.stringify(payload));
  }
  const same = (a, b) => a && b && a.session === b.session &&
    a.helperGeneration === b.helperGeneration && a.documentGeneration === b.documentGeneration;
  const compareGeneration = (a, b) => a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
  const compare = (a, b) => compareGeneration(a.helperGeneration, b.helperGeneration) ||
    compareGeneration(a.documentGeneration, b.documentGeneration);
  window.addEventListener('network:native-session', event => {
    const v = event.detail;
    if (!present || !object(v) || v.version !== VERSION || v.origin !== origin ||
      !generation(v.helperGeneration) || !generation(v.documentGeneration) ||
      typeof v.ready !== 'boolean' || (v.ready && !token(v.session))) return;
    if (last && (compare(v, last) < 0 || (compare(v, last) === 0 &&
      (retired || (v.ready && v.session !== last.session))))) return;
    if (!same(v, session)) rejectPending('NATIVE_DOCUMENT_CHANGED');
    last = v;
    session = v.ready ? { session: v.session, helperGeneration: v.helperGeneration,
      documentGeneration: v.documentGeneration } : null;
    retired = !v.ready;
    state(v.ready ? 'NATIVE_READY' : 'NATIVE_DOCUMENT_CHANGED');
  });
  window.addEventListener('network:native-result', event => {
    const v = event.detail;
    if (!object(v) || v.version !== VERSION || !same(v, session)) return;
    const entry = pending.get(v.id);
    if (!entry || !same(v, entry.session)) return;
    let response;
    try {
      response = v.response;
      if (typeof v.ok !== 'boolean' || bytes(v) > (20 << 10)) throw Error();
      if (v.ok && (!keys(response, ['version', 'id', 'code', 'peer', 'result']) ||
        response.version !== IPC || response.id !== v.id || response.code !== 'OK' ||
        !object(response.peer) || response.peer.nativeIPCVerified !== true ||
        response.peer.browserIdentityVerified !== false || !object(response.result) ||
        (entry.operation === 'status' ? !keys(response.result, ['status']) || !object(response.result.status) :
          !keys(response.result, ['payload']) || !object(response.result.payload) || bytes(response.result.payload) > LIMIT))) throw Error();
      if (!v.ok && (typeof v.code !== 'string' || !/^NATIVE_[A-Z_]{1,64}$/.test(v.code) ||
        !['UNKNOWN', 'NOT_SENT'].includes(v.outcome))) throw Error();
    } catch (_) {
      pending.delete(v.id); clearTimeout(entry.timer);
      entry.reject(failure('NATIVE_RESPONSE_INVALID', 'UNKNOWN', v.id)); return;
    }
    pending.delete(v.id); clearTimeout(entry.timer);
    // Business codes remain original DATA, including UNKNOWN/NOT_SUPPLIED.
    if (v.ok) entry.resolve(response);
    else entry.reject(failure(v.code, v.outcome, v.id));
  });
  window.addEventListener('pagehide', () => {
    session = null; retired = true; rejectPending('NATIVE_DOCUMENT_CHANGED');
    state('NATIVE_DOCUMENT_CHANGED');
  });
  function request(operation, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!present) { reject(failure('NATIVE_REQUIRED')); return; }
      if (!session) { reject(failure('NATIVE_NOT_READY')); return; }
      if (pending.size) { reject(failure('NATIVE_BUSY')); return; }
      let clean, id;
      try {
        if (!operations.has(operation)) throw failure('NATIVE_OPERATION_DENIED');
        clean = payloadFor(operation, payload);
        const random = new Uint8Array(16); window.crypto.getRandomValues(random);
        id = 'n_' + Array.from(random, b => b.toString(16).padStart(2, '0')).join('');
      } catch (error) { reject(error.code ? error : failure('NATIVE_INVALID_REQUEST')); return; }
      const current = { ...session };
      const budget = operation === 'node_restart' ? 146000 : nodeDecisions.has(operation) ? 76000 : 18000;
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(failure('NATIVE_TIMEOUT', 'UNKNOWN', id));
        // No retry, new nonce, generic cancel, replacement approval or send.
      }, budget);
      pending.set(id, { resolve, reject, timer, session: current, operation });
      try { handler.postMessage({ version: VERSION, type: 'request', id, ...current, operation, payload: clean }); }
      catch (_) {
        pending.delete(id); clearTimeout(timer);
        // A throwing transport might already have delivered the message.
        reject(failure('NATIVE_TRANSPORT_FAILED', 'UNKNOWN', id));
      }
    });
  }
  const api = Object.freeze({ version: VERSION, get available() { return present; },
    get ready() { return !!session; }, request });
  Object.defineProperty(window, 'NetworkNative', { value: api, writable: false, configurable: false });
  if (present) {
    try { handler.postMessage({ version: VERSION, type: 'hello' }); } catch (_) { /* Native didFinish can announce. */ }
  }
  state(present ? 'NATIVE_NOT_READY' : 'NATIVE_REQUIRED');
})();
