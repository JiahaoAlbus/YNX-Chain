import {canonicalJSON, exactFields, WalletAuthError} from './canonical.js';
import {parseProductSessionControlSnapshot} from './product-session-control-intent.js';

// This is metadata inside the ORIGINAL authority writer, never a second store,
// issuer, device directory or a grant. Old sessions remain without a projection.
export const ORIGINAL_SESSION_PROJECTION_VERSION = 1;
const HASH = /^[0-9a-f]{64}$/;
const FAMILY = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_RECORDS = 100_000;

export function emptyOriginalSessionProjection() {
  return Object.freeze({version:1, nextGeneration:1, records:Object.freeze([]), effects:Object.freeze([])});
}

export function parseOriginalSessionProjection(input, controlInput) {
  const control = parseProductSessionControlSnapshot(controlInput);
  exactFields(input, ['version','nextGeneration','records','effects'], 'Original session projection');
  if (input.version !== 1 || !Number.isSafeInteger(input.nextGeneration) || input.nextGeneration < 1 ||
      !Array.isArray(input.records) || input.records.length > MAX_RECORDS) fail('PROJECTION_INVALID');
  const sessions = new Map(control.authority.sessions.map(session => [session.sessionBinding, session]));
  const families = new Set(), bindings = new Set(), generations = new Set();
  let previous = '';
  const records = input.records.map(record => {
    exactFields(record, ['sessionBinding','familyId','generation','revoked'], 'Original session projection record');
    if (typeof record.sessionBinding !== 'string' || typeof record.familyId !== 'string' || !HASH.test(record.sessionBinding) || !FAMILY.test(record.familyId) || typeof record.revoked !== 'boolean' ||
        !Number.isSafeInteger(record.generation) || record.generation < 1 || record.generation >= input.nextGeneration ||
        !sessions.has(record.sessionBinding) || record.sessionBinding <= previous ||
        families.has(record.familyId) || bindings.has(record.sessionBinding) || generations.has(record.generation)) fail('PROJECTION_INVALID');
    const session = sessions.get(record.sessionBinding);
    if (revoked(control, session) && !record.revoked) fail('PROJECTION_REVOCATION_MISMATCH');
    families.add(record.familyId); bindings.add(record.sessionBinding); generations.add(record.generation);
    previous = record.sessionBinding;
    return Object.freeze({...record});
  });
  const effects = parseEffects(input.effects, bindings);
  return Object.freeze({version:1, nextGeneration:input.nextGeneration, records:Object.freeze(records), effects});
}

// Called only by the original synchronous store transaction AFTER its original
// kernel has produced a candidate. No HTTP account/device/generation input is
// accepted here. Publication remains AFTER the same writer's durable readback.
export function advanceOriginalSessionProjection(beforeInput, afterInput, projectionInput, tokenFactory) {
  const before = parseProductSessionControlSnapshot(beforeInput);
  const after = parseProductSessionControlSnapshot(afterInput);
  const projection = parseOriginalSessionProjection(projectionInput, before);
  const priorSessions = new Map(before.authority.sessions.map(session => [session.sessionBinding, session]));
  const nextSessions = new Map(after.authority.sessions.map(session => [session.sessionBinding, session]));
  // Existing signed Session/approval/history bytes may never be replaced.
  for (const [binding, session] of priorSessions) {
    if (!nextSessions.has(binding) || canonicalJSON(nextSessions.get(binding)) !== canonicalJSON(session)) fail('PROJECTION_HISTORY_CHANGED');
  }
  const added = after.authority.sessions.filter(session => !priorSessions.has(session.sessionBinding));
  if (added.length > 1) fail('PROJECTION_COMPLETION_AMBIGUOUS');
  let nextGeneration = projection.nextGeneration;
  const records = projection.records.map(record => ({...record, revoked:record.revoked || revoked(after, nextSessions.get(record.sessionBinding))}));
  if (added.length) {
    const session = added[0];
    if (typeof tokenFactory !== 'function') fail('PROJECTION_TOKEN_SOURCE_UNAVAILABLE');
    if (revoked(after, session) || nextGeneration >= Number.MAX_SAFE_INTEGER) fail('PROJECTION_GENERATION_UNAVAILABLE');
    const familyId = tokenFactory();
    if (typeof familyId !== 'string' || !FAMILY.test(familyId) || records.some(record => record.familyId === familyId)) fail('PROJECTION_TOKEN_INVALID');
    records.push({sessionBinding:session.sessionBinding, familyId, generation:nextGeneration++, revoked:false});
  }
  records.sort((a,b) => a.sessionBinding < b.sessionBinding ? -1 : a.sessionBinding > b.sessionBinding ? 1 : 0);
  return parseOriginalSessionProjection({version:1, nextGeneration, records, effects:projection.effects}, after);
}

export function originalSessionProjectionRecord(controlInput, projectionInput, sessionBinding) {
  const control = parseProductSessionControlSnapshot(controlInput);
  const projection = parseOriginalSessionProjection(projectionInput, control);
  if (typeof sessionBinding !== 'string' || !HASH.test(sessionBinding)) fail('PROJECTION_INVALID');
  const record = projection.records.find(record => record.sessionBinding === sessionBinding);
  if (!record) fail('PROJECTION_ENROLLMENT_UNAVAILABLE');
  if (record.revoked) fail('PROJECTION_REVOKED');
  const session = control.authority.sessions.find(session => session.sessionBinding === sessionBinding);
  return Object.freeze({record, session});
}

function revoked(control, session) {
  const authority = control.authority;
  return authority.revokedSessions.includes(session.sessionBinding) || authority.revokedDevices.includes(session.deviceBinding) ||
    authority.revokedAccounts.some(record => record.account === session.account && session.issuedAt <= record.before) ||
    authority.revokedDeviceScopes.some(record => record.account === session.account && record.deviceBinding === session.deviceBinding && session.issuedAt <= record.before);
}
function fail(code) { throw new WalletAuthError(code, 'Original authority session projection is unavailable or invalid'); }

// Durable obligations remain after revoke and across cold opens. An intent is
// not a grant or proof that a remote effect did/did not occur.
function parseEffects(input, bindings) {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) fail('EFFECT_BARRIER_INVALID');
  let previous = '';
  return Object.freeze(input.map(effect => {
    exactFields(effect, ['operationId','sessionBinding','requestDigest','state','receiptDigest'], 'Original effect obligation');
    for (const field of ['operationId','sessionBinding','requestDigest']) {
      if (typeof effect[field] !== 'string' || !HASH.test(effect[field])) fail('EFFECT_BARRIER_INVALID');
    }
    if (!bindings.has(effect.sessionBinding) || effect.operationId <= previous ||
        !['unknown','committed','not_executed'].includes(effect.state) ||
        (effect.state === 'unknown' ? effect.receiptDigest !== null : typeof effect.receiptDigest !== 'string' || !HASH.test(effect.receiptDigest))) fail('EFFECT_BARRIER_INVALID');
    previous = effect.operationId;
    return Object.freeze({...effect});
  }));
}

export function reserveOriginalEffect(control, projectionInput, input, now) {
  exactFields(input, ['operationId','sessionBinding','requestDigest'], 'Original effect reservation');
  for (const field of ['operationId','sessionBinding','requestDigest']) {
    if (typeof input[field] !== 'string' || !HASH.test(input[field])) fail('EFFECT_BARRIER_INVALID');
  }
  const projection = parseOriginalSessionProjection(projectionInput, control);
  const prior = projection.effects.find(effect => effect.operationId === input.operationId);
  if (prior) {
    if (prior.sessionBinding !== input.sessionBinding || prior.requestDigest !== input.requestDigest) fail('EFFECT_BINDING_CONFLICT');
    return Object.freeze({projection, value:Object.freeze({dispatchAllowed:false, readbackOnly:true, obligation:prior})});
  }
  const {session} = originalSessionProjectionRecord(control, projection, input.sessionBinding);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || session.expiresAt <= now.toISOString()) fail('SESSION_EXPIRED');
  if (projection.effects.some(effect => effect.sessionBinding === input.sessionBinding && effect.state === 'unknown')) fail('EFFECT_OUTCOME_UNKNOWN');
  const obligation = Object.freeze({...input, state:'unknown', receiptDigest:null});
  const effects = [...projection.effects, obligation].sort((a,b)=>a.operationId < b.operationId ? -1 : 1);
  const next = parseOriginalSessionProjection({...projection, effects}, control);
  return Object.freeze({projection:next, value:Object.freeze({dispatchAllowed:true, readbackOnly:false, obligation})});
}

export function settleOriginalEffect(control, projectionInput, operationId, authenticatedResult) {
  const projection = parseOriginalSessionProjection(projectionInput, control);
  const prior = projection.effects.find(effect => effect.operationId === operationId);
  if (!prior) fail('EFFECT_ORIGINAL_NOT_FOUND');
  exactFields(authenticatedResult, ['operationId','sessionBinding','requestDigest','state','receiptDigest'], 'Authenticated original readback');
  const result = parseEffects([authenticatedResult], new Set(projection.records.map(record=>record.sessionBinding)))[0];
  if (result.operationId !== prior.operationId || result.sessionBinding !== prior.sessionBinding || result.requestDigest !== prior.requestDigest || result.state === 'unknown') fail('EFFECT_READBACK_MISMATCH');
  if (prior.state !== 'unknown' && canonicalJSON(prior) !== canonicalJSON(result)) fail('EFFECT_TERMINAL_CONFLICT');
  const effects = projection.effects.map(effect => effect.operationId === operationId ? result : effect);
  return Object.freeze({projection:parseOriginalSessionProjection({...projection, effects}, control), value:result});
}

export function originalRevocationBarrier(control, projectionInput, sessionBinding) {
  const projection = parseOriginalSessionProjection(projectionInput, control);
  const record = projection.records.find(record=>record.sessionBinding === sessionBinding);
  if (!record) fail('PROJECTION_ENROLLMENT_UNAVAILABLE');
  const pending = projection.effects.filter(effect=>effect.sessionBinding === sessionBinding && effect.state === 'unknown');
  return Object.freeze({entryRevoked:record.revoked, effectsExcluded:record.revoked && pending.length === 0,
    outcome:pending.length ? 'UNKNOWN' : record.revoked ? 'LOCAL_OBLIGATIONS_CLOSED' : 'NOT_REVOKED', pending:Object.freeze(pending)});
}
