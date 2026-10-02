import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { CENTRAL_IDENTITY, fault } from './central-identity.mjs';

const issuer = 'https://wallet-auth.ynxweb4.com', origin = 'https://developer.ynxweb4.com';
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const random = () => randomBytes(32).toString('base64url');
export const canonicalFamilyJSON = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value; }
const same = (a, b) => canonicalFamilyJSON(a) === canonicalFamilyJSON(b);
const unavailable = () => fault('Wallet identity is temporarily unavailable. Retry without discarding the saved session.', 'core_identity_unavailable', 503);
const invalid = () => fault('Wallet identity expired, changed or was signed out. Sign in explicitly.', 'core_identity_invalid', 401);

// Uses the existing Developer encrypted SQLite records through synchronous CAS.
// Neither rotating handles nor access grants are returned to the browser/core.
export async function createCentralFamily({ records, keyPath, keyId, fetchImpl = globalThis.fetch, now = Date.now }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(keyId || '') || !records?.get || !records?.put || !records?.install) throw unavailable();
  const file = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let privateKey;
  try {
    const st = await file.stat();
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600 || st.size > 8192) throw unavailable();
    privateKey = createPrivateKey(await file.readFile());
    if (privateKey.asymmetricKeyType !== 'ed25519') throw unavailable();
  } finally { await file.close(); }
  const flights = new Map();
  async function call(route, input, authenticated = true) {
    const path = '/v2/browser-sessions/' + route, body = canonicalFamilyJSON(input), headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (authenticated) {
      const proof = { version: 1, issuer, audience: issuer + '/v2/browser-sessions', clientId: CENTRAL_IDENTITY.clientId,
        keyId, method: 'POST', path, bodySha256: createHash('sha256').update(body).digest('hex'), issuedAt: new Date(now()).toISOString(), nonce: random() };
      proof.signature = sign(null, Buffer.from(canonicalFamilyJSON(proof)), privateKey).toString('base64url');
      headers['x-ynx-backend-proof'] = Buffer.from(canonicalFamilyJSON(proof)).toString('base64url');
    }
    let response, result;
    try { response = await fetchImpl(issuer + path, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(5000) }); result = await response.json(); }
    catch { throw unavailable(); }
    if (!response.ok) {
      const code = result?.error?.code || result?.code;
      if (['SSO_LOGIN_REQUIRED', 'SSO_GRANT_INVALID', 'SSO_GENERATION_REVOKED', 'SSO_FAMILY_INVALID', 'SSO_FAMILY_REPLAY', 'SSO_CODE_EXPIRED'].includes(code)) throw Object.assign(invalid(), { centralCode: code });
      if (code === 'SSO_FAMILY_CONFLICT') throw fault('Another request is updating this identity. Retry the original request.', 'core_identity_conflict', 409);
      throw unavailable();
    }
    return result;
  }
  function read(kind, id) { const record = records.get(kind, id); if (!record) throw invalid(); return record; }
  function bindingUnchanged(a, b) { return Boolean(a && b && a.remote.familyId === b.remote.familyId && same(a.remote.identity, b.remote.identity) && a.remote.absoluteExpiresAt === b.remote.absoluteExpiresAt && a.remote.approvedProfile === b.remote.approvedProfile && a.remote.approvedClientsDigest === b.remote.approvedClientsDigest); }
  function put(kind, id, before, value) {
    records.put(kind, id, before?.revision ?? null, { ...value, revision: (before?.revision ?? -1) + 1 }, value.retainedUntil ?? now() + 7500000);
    return read(kind, id);
  }
  function validate(value, previous) {
    const absolute = Date.parse(value?.absoluteExpiresAt), idle = Date.parse(value?.idleExpiresAt), expires = Date.parse(value?.expiresAt), identityEnd = Date.parse(value?.identity?.expiresAt);
    if (!value || Object.keys(value).sort().join(',') !== 'absoluteExpiresAt,approvedClientsDigest,approvedProfile,audience,expiresAt,familyEpoch,familyId,grantToken,identity,idleExpiresAt,refreshHandle,scopes' ||
      !value.identity || Object.keys(value.identity).sort().join(',') !== 'account,expiresAt,generation,subject' ||
      !opaque(value?.familyId) || !opaque(value?.refreshHandle) || !opaque(value?.grantToken) || !Number.isSafeInteger(value.familyEpoch) || value.familyEpoch < 0 ||
      value.audience !== CENTRAL_IDENTITY.audience || !same(value.scopes, ['identity:read']) || value.approvedProfile !== 6 || !/^[a-f0-9]{64}$/.test(value.approvedClientsDigest || '') ||
      typeof value.identity?.subject !== 'string' || value.identity.subject.length < 1 || value.identity.subject.length > 256 || !/^ynx1[0-9a-z]{38}$/.test(value.identity?.account || '') || !Number.isSafeInteger(value.identity.generation) || value.identity.generation < 0 ||
      ![absolute, idle, expires, identityEnd].every(Number.isFinite) || expires <= now() || expires > now() + 300000 || absolute !== identityEnd || absolute <= now() || absolute > now() + 7200000 || idle > absolute || idle > now() + 1800000 || expires > idle) throw invalid();
    if (previous && (value.familyId !== previous.familyId || absolute !== Date.parse(previous.absoluteExpiresAt) || !same(value.identity, previous.identity) || value.approvedProfile !== previous.approvedProfile || value.approvedClientsDigest !== previous.approvedClientsDigest || value.familyEpoch !== previous.familyEpoch + 1)) throw invalid();
    return value;
  }
  async function revoke(id) {
    const row = read('finite-family', id);
    if (!row.fenced) throw invalid();
    if (!row.revocationPending) return true;
    const acknowledged = await call('revoke-family', { clientId: CENTRAL_IDENTITY.clientId, familyId: row.remote.familyId, requestId: row.revokeRequestId });
    if (!acknowledged || Object.keys(acknowledged).join(',') !== 'revoked' || acknowledged.revoked !== true) throw unavailable();
    const current = read('finite-family', id);
    if (current.fenced && current.revokeRequestId === row.revokeRequestId) put('finite-family', id, current, { ...current, revocationPending: false });
    return true;
  }
  function fence(id) {
    const row = records.get('finite-family', id);
    if (!row || row.fenced) return row;
    return put('finite-family', id, row, { ...row, fenced: true, revocationPending: true, revokeRequestId: random() });
  }
  async function Prepare({ state, previousFamilyID = '' }) {
    if (!opaque(state)) throw invalid();
    if (previousFamilyID) { const row = fence(previousFamilyID); if (row?.revocationPending) await revoke(previousFamilyID); }
    const id = random(); put('finite-intent', id, null, { state, canceled: false, requestId: random(), expiresAt: now() + 120000 }); return id;
  }
  async function Redeem({ code, state, codeVerifier, intentID }) {
    let intent = read('finite-intent', intentID);
    if (intent.canceled || intent.expiresAt <= now() || intent.state !== state || !opaque(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier || '')) throw invalid();
    const input = { clientId: CENTRAL_IDENTITY.clientId, origin, redirectUri: CENTRAL_IDENTITY.callback, code, state, codeVerifier, requestId: intent.requestId };
    if (intent.input && !same(intent.input, input)) throw invalid();
    if (!intent.input) intent = put('finite-intent', intentID, intent, { ...intent, input });
    if (intent.familyID) return Resolve(intent.familyID);
    const result = validate(await call('token-family', input));
    const current = read('finite-intent', intentID); let id = current.familyID || random();
    if (!current.familyID) {
      const retainedUntil = Date.parse(result.absoluteExpiresAt) + 300000;
      id = records.install(intentID, current.revision, { ...current, familyID: id, revision: current.revision + 1 }, id,
        { remote: result, revision: 0, fenced: Boolean(current.canceled || current.expiresAt <= now()), revocationPending: Boolean(current.canceled || current.expiresAt <= now()), revokeRequestId: random(), retainedUntil }, retainedUntil);
    }
    const row = read('finite-family', id);
    if (row.fenced) { await revoke(id); throw invalid(); }
    return Resolve(id);
  }
  async function resolveOnce(id) {
    let row = read('finite-family', id);
    if (row.fenced) { if (row.revocationPending) { try { await revoke(id); } catch { throw Object.assign(unavailable(), { revocationPending: true, locallyFenced: true }); } } throw invalid(); }
    if (Date.parse(row.remote.absoluteExpiresAt) <= now() || Date.parse(row.remote.idleExpiresAt) <= now()) throw invalid();
    if (Date.parse(row.remote.expiresAt) <= now() + 60000) {
      if (!row.pending) row = put('finite-family', id, row, { ...row, pending: { clientId: CENTRAL_IDENTITY.clientId, familyId: row.remote.familyId, refreshHandle: row.remote.refreshHandle, expectedFamilyEpoch: row.remote.familyEpoch, requestId: random() } });
      const result = validate(await call('renew', row.pending), row.remote), current = read('finite-family', id);
      if (current.fenced) { await revoke(id); throw invalid(); }
      if (current.revision !== row.revision || !same(current.pending, row.pending)) throw fault('Identity changed during renewal.', 'core_identity_conflict', 409);
      row = put('finite-family', id, current, { ...current, remote: result, pending: null });
    }
    const fresh = await call('introspect', { clientId: CENTRAL_IDENTITY.clientId, grantToken: row.remote.grantToken }, false);
    if (fresh.audience !== CENTRAL_IDENTITY.audience || !same(fresh.scopes, ['identity:read']) || !same(fresh.identity, row.remote.identity) || fresh.expiresAt !== row.remote.expiresAt || Date.parse(fresh.expiresAt) <= now()) throw invalid();
    const current = read('finite-family', id);
    if (current.fenced || !bindingUnchanged(current, row)) throw invalid();
    return { familyID: id, ...row.remote, isCurrent: () => { const current = records.get('finite-family', id); return Boolean(current && !current.fenced && bindingUnchanged(current, row)); } };
  }
  function Resolve(id) {
    if (flights.has(id)) return flights.get(id);
    const promise = resolveOnce(id).finally(() => { if (flights.get(id) === promise) flights.delete(id); }); flights.set(id, promise); return promise;
  }
  async function Activity(id, eventId, observedAt) {
    if (!opaque(eventId) || !Number.isSafeInteger(observedAt) || observedAt > now() || now() - observedAt > 30000) throw invalid();
    await Resolve(id); let row = read('finite-family', id);
    const activityRequests = (row.activityRequests || []).filter(value => value.observedAt + 30000 >= now());
    const previous = activityRequests.find(value => value.eventId === eventId);
    if (previous) observedAt = previous.observedAt;
    else {
      if (activityRequests.length >= 128) throw unavailable();
      activityRequests.push({ eventId, observedAt }); row = put('finite-family', id, row, { ...row, activityRequests });
    }
    const result = await call('activity', { clientId: CENTRAL_IDENTITY.clientId, familyId: row.remote.familyId, eventId, observedAt: new Date(observedAt).toISOString() });
    const current = read('finite-family', id), idle = Date.parse(result.idleExpiresAt);
    if (current.fenced || current.revision !== row.revision || result.absoluteExpiresAt !== row.remote.absoluteExpiresAt || !same(result.identity, row.remote.identity) || !Number.isFinite(idle) || idle > Math.min(Date.parse(row.remote.absoluteExpiresAt), observedAt + 1800000)) throw invalid();
    put('finite-family', id, current, { ...current, remote: { ...current.remote, idleExpiresAt: result.idleExpiresAt } });
  }
  async function Logout({ familyID = '', intentID = '' }) {
    if (intentID) { const intent = records.get('finite-intent', intentID); if (intent) { if (!intent.canceled) put('finite-intent', intentID, intent, { ...intent, canceled: true }); if (intent.familyID) fence(intent.familyID); } }
    if (familyID) fence(familyID);
    const ids = new Set([familyID, records.get('finite-intent', intentID)?.familyID].filter(Boolean));
    for (const id of ids) await revoke(id);
    return { locallyFenced: true, revocationPending: false };
  }
  return { Prepare, Redeem, Resolve, Activity, Logout };
}
