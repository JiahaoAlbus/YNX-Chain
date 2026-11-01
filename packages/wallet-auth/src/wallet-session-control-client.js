import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { walletIdentity } from "./crypto.js";
import { createWalletSessionControlProof, encodeWalletSessionControlProofHeader, verifyWalletSessionControlProof, WALLET_SESSION_CONTROL_AUDIENCE, WALLET_SESSION_CONTROL_PROOF_HEADER } from "./wallet-session-control.js";
import { assertWalletSessionControlOutboxPlanBase, createWalletSessionControlOutbox, parseWalletSessionControlOutbox, prepareWalletSessionControlOutbox, summarizeWalletSessionControlOutbox, walletSessionControlOutboxKey, walletSessionControlOutboxRequestCandidate } from "./wallet-session-control-outbox.js";

const TIME_PATH = "/v2/product-sessions/time", MAX_BYTES = 4 * 1024 * 1024, MAX_STORE_BYTES = 32 * 1024 * 1024, CAPACITY = 128;
const stores = new WeakMap();

/**
 * Instantiate only in a trusted Wallet host, never from page-supplied options.
 * storage is the platform's protected getItem/setItem adapter, optionally with
 * withLock(key, callback). A shared adapter object shares the owner mutex across
 * client instances. Multiple processes must supply a real common withLock;
 * read/compare/set alone is not cross-process CAS. No boolean attests protection.
 * withLock serializes storage transactions, not the entire network operation.
 * Operation/key leases are host-process scoped; a multi-process host also needs
 * a shared owner-operation authority. Duplicate same-intent requests remain
 * server-idempotent, but this mutex is not cross-process UI cancellation.
 *
 * withOwner(scope, purpose, use) performs ONE owner/OS authorization and calls
 * use({ accountSecret, assertCurrent }) only inside its bounded secret lease.
 * The host clears secret references on exit. This client never caches secrets.
 * Fetch and storage dependencies are trusted host capabilities, not UI data.
 * Only this module's completed pinned exchange can promote a stored resolution.
 * Historical public proofs bind the request; they do not sign the server reply.
 * Reply provenance on restart relies on the protected, host-only journal.
 */
export class WalletSessionControlClient {
  #storage; #fetch; #withOwner; #random; #now; #epoch; #timeout;
  constructor({ storage, withOwner, fetchImpl = globalThis.fetch, randomBytes = secureRandom, monotonicNow = () => Math.floor(globalThis.performance.now()), timeoutMs = 15_000 }) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof withOwner !== "function" || typeof fetchImpl !== "function" || typeof randomBytes !== "function" || typeof monotonicNow !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail("INVALID_CONTROL_CLIENT", "Trusted Wallet host dependencies are required");
    this.#storage = storage; this.#withOwner = withOwner; this.#fetch = fetchImpl; this.#random = randomBytes; this.#now = monotonicNow; this.#timeout = timeoutMs;
    this.#epoch = null;
  }

  async status(scopeInput) {
    const scope = owner(scopeInput);
    return this.#locked(scope, async () => summary(await this.#read(scope)));
  }

  /** A new explicit user action, including trusted time before the first write. */
  async begin(scopeInput, operationInput) {
    const scope = owner(scopeInput);
    exactFields(operationInput, ["operation", ...(operationInput?.operation === "device-logout" ? ["deviceBinding"] : [])], "Reviewed owner logout scope");
    if (!["account-logout", "device-logout"].includes(operationInput.operation)) fail("INVALID_CONTROL_INTENT", "Unknown owner operation");
    const reviewed = freeze(clone(operationInput)); // Snapshot UI data before the first await.
    return this.#operation(scope, null, async token => {
      await this.#locked(scope, async () => {
        const state = await this.#read(scope);
        if (state.active) fail("OUTBOX_PENDING", "The original owner logout still needs confirmation");
        if (state.history.length >= CAPACITY) fail("OUTBOX_CAPACITY", "Owner logout history is full; existing recovery remains available");
      });
      const clock = await this.#time(scope); token.assert();
      const intent = { account: scope.account, operation: reviewed.operation, body: {
        intentId: await this.#token(), intentIssuedAt: clock.serverTime,
        intentExpiresAt: new Date(Date.parse(clock.serverTime) + 600_000).toISOString(),
        ...(reviewed.operation === "device-logout" ? { deviceBinding: reviewed.deviceBinding } : {}),
      } };
      token.intentId = intent.body.intentId; token.assert();
      await this.#change(scope, state => {
        token.assert();
        if (state.active) fail("OUTBOX_PENDING", "The original owner logout still needs confirmation");
        if (state.history.length >= CAPACITY) fail("OUTBOX_CAPACITY", "Owner logout history is full");
        const outbox = apply(createWalletSessionControlOutbox(scope), scope, { type: "enqueue", intent });
        state.active = { outbox, proofs: [] }; return state;
      });
      return this.#send(scope, token);
    });
  }

  async retry(scopeInput, intentId) {
    const scope = owner(scopeInput);
    const known = await this.#locked(scope, async () => {
      const state = await this.#read(scope), archived = history(state, intentId);
      if (archived) return resolved(archived);
      original(state, intentId); return null;
    });
    // Same resolved intent never signs again, extends cutoff or creates a new ID.
    if (known) return known;
    return this.#operation(scope, intentId, token => this.#send(scope, token));
  }

  async cancel(scopeInput, intentId) {
    const scope = owner(scopeInput), slot = this.#slot(scope);
    if (slot.operation?.intentId === intentId) slot.operation.cancelled = true;
    const state = await this.#change(scope, value => {
      if (history(value, intentId)) return value;
      const active = original(value, intentId);
      active.outbox = apply(active.outbox, scope, { type: "cancel", intentId });
      if (outboxStatus(active) === "cancelled-before-dispatch") archive(value, "cancelled", null);
      return value;
    });
    return history(state, intentId) ? resolved(history(state, intentId)) : activeSummary(state.active);
  }

  async #send(scope, token) {
    const initial = await this.#locked(scope, async () => original(await this.#read(scope), token.intentId));
    const operation = initial.outbox.records[0].intent.operation;
    // Human consent and OS key access happen BEFORE the fresh proof clock.
    // No 5-second clock is carried across a potentially slow biometric prompt.
    let calls = 0, callbackResult;
    const delivered = await this.#withOwner(scope, operation, async access => {
      if (++calls !== 1) fail("INVALID_OWNER_ACCESS", "The private owner callback is single use");
      if (!access || typeof access.accountSecret !== "string" || typeof access.assertCurrent !== "function") fail("INVALID_OWNER_ACCESS", "A private scoped owner key callback is required");
      const assertCurrent = () => { token.assert(); access.assertCurrent(); };
      assertCurrent();
      const identity = walletIdentity(access.accountSecret);
      if (identity.account !== scope.account) fail("OUTBOX_OWNER_MISMATCH", "OS key access returned another owner");
      let prepared;
      for (let refresh = 0; refresh < 3; refresh++) {
        try { prepared = await this.#prepareRequest(scope, token, access, assertCurrent); break; }
        catch (error) { if (error?.code !== "OUTBOX_CLOCK_STALE" || refresh === 2) throw error; assertCurrent(); }
      }
      const { request, requestId, proof, clock } = prepared;
      // Returning from an async helper adds one more await boundary.
      assertCurrent(); freshClock(clock, this.#stamp(clock.epoch));
      if (token.submitted) fail("OUTBOX_ATTEMPT_CANCELLED", "Original transport lease was already consumed");
      token.submitted = true; // no await between final owner/clock check and fetch
      let exchange;
      try { exchange = await this.#http(request.url, requestId, request.bodyText, proof); }
      catch { fail("CONTROL_RESULT_UNKNOWN", "The original logout is saved; its result is not yet confirmed"); }
      // Once submitted, cancellation must not discard an authenticated late fact.
      // This mutation intentionally does not require the old UI/key lease.
      const updated = await this.#change(scope, state => {
        const existing = history(state, token.intentId);
        if (existing) return state;
        const latest = original(state, token.intentId);
        latest.outbox = apply(latest.outbox, scope, { type: "observe", intentId: token.intentId, requestId, response: exchange });
        const status = outboxStatus(latest);
        if (status === "receipt-observed") archive(state, "revoked", requestId);
        if (status === "expiry-observed") archive(state, "expired", requestId);
        return state;
      });
      assertCurrent();
      const terminal = history(updated, token.intentId);
      callbackResult = terminal ? resolved(terminal) : activeSummary(updated.active);
      return callbackResult;
    });
    if (calls !== 1 || callbackResult === undefined || delivered !== callbackResult) fail("INVALID_OWNER_ACCESS", "The owner host must deliver only the actual client callback result");
    return callbackResult;
  }

  async #prepareRequest(scope, token, access, assertCurrent) {
    const clock = await this.#time(scope); assertCurrent();
    const requestId = `req_${await this.#token()}`, nonce = await this.#token(); assertCurrent();
    let signingInput;
    await this.#change(scope, state => {
      assertCurrent(); const active = original(state, token.intentId);
      const plan = prepareWalletSessionControlOutbox(active.outbox, scope, { type: "attempt", intentId: token.intentId, requestId, nonce, clock, at: this.#stamp(clock.epoch) });
      assertWalletSessionControlOutboxPlanBase(plan, active.outbox, scope); signingInput = plan.signingInput;
      active.outbox = plan.candidate; return state;
    });
    assertCurrent(); freshClock(clock, this.#stamp(clock.epoch));
    const proof = createWalletSessionControlProof({ accountSecret: access.accountSecret, ...signingInput });
    verifyBinding(proof, scope, signingInput);
    const marked = await this.#change(scope, state => {
      assertCurrent(); const active = original(state, token.intentId);
      active.outbox = apply(active.outbox, scope, { type: "dispatch", intentId: token.intentId, requestId, at: this.#stamp(clock.epoch) });
      active.proofs.push({ requestId, proof }); return state;
    });
    assertCurrent();
    const active = original(marked, token.intentId);
    const request = walletSessionControlOutboxRequestCandidate(active.outbox, scope, { intentId: token.intentId, requestId, revision: active.outbox.revision, at: this.#stamp(clock.epoch) });
    verifyBinding(proof, scope, request.signingInput);
    return { request, requestId, proof, clock };
  }

  async #operation(scope, intentId, action) {
    const slot = this.#slot(scope);
    if (slot.operation) fail("CONTROL_OPERATION_BUSY", "An owner action is already awaiting approval or confirmation");
    const token = { intentId, cancelled: false, submitted: false, assert() { if (this.cancelled) fail("CONTROL_OPERATION_CANCELLED", "The original owner action was cancelled"); } };
    slot.operation = token;
    try { return await action(token); }
    finally { if (slot.operation === token) slot.operation = null; }
  }

  async #time(scope) {
    const requestId = `req_${await this.#token()}`, epoch = await (this.#epoch ??= this.#token()), started = this.#monotonic();
    const exchange = await this.#http(`${scope.authority}${TIME_PATH}`, requestId, null, null);
    const received = this.#monotonic(), envelope = JSON.parse(exchange.bodyText);
    exactFields(envelope, ["ok", "requestId", "schemaVersion", "result"], "Authenticated Auth time envelope");
    exactFields(envelope.result, ["serverTime"], "Authenticated authority time");
    if (exchange.status !== 200 || envelope.ok !== true) fail("CONTROL_TIME_UNAVAILABLE", "Fresh authority time is unavailable");
    const clock = { authority: scope.authority, chainId: scope.chainId, requestId, serverTime: timestamp(envelope.result.serverTime), epoch, receivedAtMs: received, roundTripMs: received - started };
    freshClock(clock, this.#stamp(epoch)); return clock;
  }

  async #http(url, requestId, bodyText, proof) {
    const urlObject = new URL(url);
    if (urlObject.origin !== WALLET_SESSION_CONTROL_AUDIENCE || urlObject.href !== url || urlObject.search || urlObject.hash) fail("CONTROL_HTTP_BINDING", "Only the fixed authority is supported");
    const headers = { accept: "application/json", "x-request-id": requestId };
    if (bodyText !== null) { headers["content-type"] = "application/json"; headers[WALLET_SESSION_CONTROL_PROOF_HEADER] = encodeWalletSessionControlProofHeader(proof); }
    const controller = new AbortController(); let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new WalletAuthError("CONTROL_HTTP_TIMEOUT", "Authority request timed out")); }, this.#timeout); });
    const read = async () => {
      const response = await this.#fetch(url, { method: bodyText === null ? "GET" : "POST", headers, ...(bodyText === null ? {} : { body: bodyText }), redirect: "error", credentials: "omit", cache: "no-store", mode: "cors", signal: controller.signal });
      if (response.url !== url || response.redirected !== false || ["opaque", "opaqueredirect"].includes(response.type) || response.headers.get("x-request-id") !== requestId || response.headers.get("content-type") !== "application/json; charset=utf-8" || response.headers.get("cache-control") !== "no-store") fail("CONTROL_HTTP_BINDING", "Authority response identity or headers differ from the original request");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > MAX_BYTES)) fail("CONTROL_RESPONSE_LIMIT", "Authority response exceeds its byte limit");
      const text = await boundedText(response, controller), parsed = canonicalParse(text, MAX_BYTES);
      if (parsed.requestId !== requestId || parsed.schemaVersion !== 2) fail("CONTROL_HTTP_BINDING", "Authority envelope differs from its exact original request");
      return { url, redirected: false, status: response.status, requestId, contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control"), bodyText: text };
    };
    try { return await Promise.race([read(), deadline]); }
    catch (error) { controller.abort(); throw error; }
    finally { clearTimeout(timer); }
  }

  #slot(scope) {
    let map = stores.get(this.#storage); if (!map) { map = new Map(); stores.set(this.#storage, map); }
    const key = storageKey(scope); let slot = map.get(key);
    if (!slot) { slot = { tail: Promise.resolve(), operation: null }; map.set(key, slot); }
    return slot;
  }
  async #locked(scope, action) {
    const slot = this.#slot(scope), previous = slot.tail; let release;
    slot.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return typeof this.#storage.withLock === "function" ? await this.#storage.withLock(storageKey(scope), action) : await action(); }
    finally { release(); }
  }
  async #read(scope) {
    const text = await this.#storage.getItem(storageKey(scope));
    if (text === null) return empty(scope);
    return parseEnvelope(text, scope);
  }
  async #change(scope, transition) {
    return this.#locked(scope, async () => {
      const beforeText = await this.#storage.getItem(storageKey(scope));
      const base = beforeText === null ? empty(scope) : parseEnvelope(beforeText, scope);
      const candidate = transition(clone(base)); candidate.revision = base.revision + 1;
      const text = canonicalJSON(parseEnvelope(canonicalJSON(candidate), scope));
      // Exact version CAS while holding the actual shared writer boundary.
      if (await this.#storage.getItem(storageKey(scope)) !== beforeText) fail("STALE_CONTROL_OUTBOX", "Protected owner storage changed during this operation");
      try {
        await this.#storage.setItem(storageKey(scope), text);
        const readbackText = await this.#storage.getItem(storageKey(scope));
        if (readbackText !== text) fail("CONTROL_STORAGE_UNKNOWN", "Exact protected owner readback is unavailable");
        const readback = parseEnvelope(readbackText, scope);
        if (readback.active) {
          const activeText = canonicalJSON(readback.active.outbox);
          // Parser/full-envelope equality are the real readback here; pure helper
          // remains a byte comparison, never a boolean durability credential.
          if (activeText !== canonicalJSON(candidate.active.outbox)) fail("CONTROL_STORAGE_UNKNOWN", "Original outbox readback changed");
        }
        return readback;
      } catch { fail("CONTROL_STORAGE_UNKNOWN", "Owner write or readback is uncertain; retain the latest original journal"); }
    });
  }
  #monotonic() { const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) fail("CONTROL_CLOCK_UNAVAILABLE", "A monotonic host clock is required"); return value; }
  #stamp(epoch) { return { epoch, monotonicMs: this.#monotonic() }; }
  async #token() { const data = await this.#random(32); if (!(data instanceof Uint8Array) || data.length !== 32) fail("CONTROL_RANDOM_UNAVAILABLE", "Secure host randomness is required"); try { return [...data].map(value => value.toString(16).padStart(2, "0")).join(""); } finally { data.fill(0); } }
}

function empty(scope) { return { version: 1, scope, revision: 0, active: null, history: [] }; }
function owner(input) { const scope = createWalletSessionControlOutbox(input).scope; if (scope.authority !== WALLET_SESSION_CONTROL_AUDIENCE || scope.chainId !== "ynx_6423-1") fail("UNSUPPORTED_CONTROL_AUTHORITY", "The fixed owner authority and chain are required"); return scope; }
function storageKey(scope) { return walletSessionControlOutboxKey(scope).replaceAll(":", "."); } // Expo SecureStore key alphabet.
function apply(outbox, scope, event) { const plan = prepareWalletSessionControlOutbox(outbox, scope, event); return clone(assertWalletSessionControlOutboxPlanBase(plan, outbox, scope)); }
function original(state, intentId) { if (!state.active || state.active.outbox.records[0].intent.body.intentId !== intentId) fail("OUTBOX_INTENT_NOT_FOUND", "The original owner intent is not active"); return state.active; }
function history(state, intentId) { return state.history.find(entry => entry.record.outbox.records[0].intent.body.intentId === intentId); }
function outboxStatus(record) { return summarizeWalletSessionControlOutbox(record.outbox, record.outbox.scope).records[0].status; }
function archive(state, kind, requestId) { state.history.push({ record: state.active, resolution: { kind, requestId } }); state.active = null; }
function activeSummary(record) { const value = summarizeWalletSessionControlOutbox(record.outbox, record.outbox.scope).records[0]; return freeze({ status: value.status, intentId: value.intentId, revocationConfirmed: false, localCommitConfirmed: true, cancelRequested: value.cancelRequested, originalBodyText: value.originalBodyText }); }
function resolved(entry) {
  const intentId = entry.record.outbox.records[0].intent.body.intentId;
  if (entry.resolution.kind === "cancelled") return freeze({ status: "cancelled-before-dispatch", intentId, revocationConfirmed: false, localCommitConfirmed: true });
  if (entry.resolution.kind === "expired") return freeze({ status: "expired", intentId, unapplied: true, revocationConfirmed: false, localCommitConfirmed: true });
  const attempt = entry.record.outbox.records[0].attempts.find(value => value.requestId === entry.resolution.requestId);
  return freeze({ status: "confirmed", intentId, revocationConfirmed: true, localCommitConfirmed: true, receipt: JSON.parse(attempt.response.bodyText).result.receipt });
}
function summary(state) { return freeze({ scope: state.scope, revision: state.revision, active: state.active ? activeSummary(state.active) : null, history: state.history.map(resolved) }); }

function parseEnvelope(text, scope) {
  const state = canonicalParse(text, MAX_STORE_BYTES);
  exactFields(state, ["version", "scope", "revision", "active", "history"], "Protected owner control envelope");
  if (state.version !== 1 || canonicalJSON(state.scope) !== canonicalJSON(scope) || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.history) || state.history.length + (state.active === null ? 0 : 1) > CAPACITY) fail("INVALID_CONTROL_JOURNAL", "Protected owner envelope scope, version or capacity is invalid");
  const ids = new Set(), nonces = new Set(), requests = new Set();
  function parseRecord(record) {
    exactFields(record, ["outbox", "proofs"], "Protected original owner record");
    record.outbox = clone(parseWalletSessionControlOutbox(record.outbox, scope));
    if (record.outbox.records.length !== 1 || !Array.isArray(record.proofs)) fail("INVALID_CONTROL_JOURNAL", "Protected record must retain one exact intent");
    const original = record.outbox.records[0], intentId = original.intent.body.intentId;
    if (ids.has(intentId)) fail("OUTBOX_REPLAY", "Owner intent ID already exists in retained history"); ids.add(intentId);
    const proofIds = new Set();
    for (const item of record.proofs) {
      exactFields(item, ["requestId", "proof"], "Historical public owner proof");
      const attempt = original.attempts.find(value => value.requestId === item.requestId);
      if (!attempt || attempt.stage !== "may-have-sent" || proofIds.has(item.requestId)) fail("INVALID_CONTROL_JOURNAL", "Public proof has no exact dispatched attempt");
      proofIds.add(item.requestId); verifyBinding(item.proof, scope, { method: "POST", path: original.path, bodyDigest: original.bodyDigest, nonce: attempt.nonce, issuedAt: attempt.issuedAt, expiresAt: attempt.expiresAt });
    }
    for (const attempt of original.attempts) {
      if (requests.has(attempt.requestId) || nonces.has(attempt.nonce)) fail("OUTBOX_REPLAY", "Original request ID or nonce was reused across owner history");
      requests.add(attempt.requestId); nonces.add(attempt.nonce);
      if (attempt.stage === "may-have-sent" && !proofIds.has(attempt.requestId)) fail("INVALID_CONTROL_JOURNAL", "Dispatched attempt lost its public request proof");
    }
    return record;
  }
  if (state.active !== null) {
    parseRecord(state.active);
    if (["receipt-observed", "expiry-observed", "cancelled-before-dispatch"].includes(outboxStatus(state.active))) fail("INVALID_CONTROL_JOURNAL", "A structural candidate alone cannot enter the authenticated journal");
  }
  for (const entry of state.history) {
    exactFields(entry, ["record", "resolution"], "Protected owner resolution"); parseRecord(entry.record);
    exactFields(entry.resolution, ["kind", "requestId"], "Protected resolution binding");
    const phase = outboxStatus(entry.record), kind = entry.resolution.kind;
    if (kind === "cancelled") {
      if (phase !== "cancelled-before-dispatch" || entry.resolution.requestId !== null) fail("INVALID_CONTROL_JOURNAL", "Local cancellation has possible dispatch history");
    } else {
      const attempt = entry.record.outbox.records[0].attempts.find(value => value.requestId === entry.resolution.requestId);
      if (!attempt?.response || !entry.record.proofs.some(value => value.requestId === entry.resolution.requestId)) fail("INVALID_CONTROL_JOURNAL", "Terminal resolution lacks its original request/response");
      const body = JSON.parse(attempt.response.bodyText);
      if (kind === "revoked" ? phase !== "receipt-observed" || body.ok !== true : kind !== "expired" || phase !== "expiry-observed" || body.ok !== false || body.error.code !== "INTENT_EXPIRED") fail("INVALID_CONTROL_JOURNAL", "Terminal resolution contradicts its exact original exchange");
    }
  }
  return state;
}
function verifyBinding(proof, scope, context) {
  const verified = verifyWalletSessionControlProof(proof, { method: context.method, path: context.path, bodyDigest: context.bodyDigest }, new Date(proof.issuedAt));
  if (verified.account !== scope.account || verified.audience !== scope.authority || verified.chainId !== scope.chainId || ["nonce", "issuedAt", "expiresAt"].some(key => verified[key] !== context[key])) fail("OUTBOX_OWNER_MISMATCH", "Public owner proof differs from the exact original request");
}
function freshClock(clock, at) { timestamp(clock.serverTime); if (at.epoch !== clock.epoch || !Number.isSafeInteger(clock.roundTripMs) || clock.roundTripMs < 0 || at.monotonicMs < clock.receivedAtMs || at.monotonicMs - clock.receivedAtMs + clock.roundTripMs > 5000) fail("OUTBOX_CLOCK_STALE", "Obtain fresh Auth time after authorization; the owner key need not be reauthorized"); }
async function boundedText(response, controller) {
  if (!response.body?.getReader) { const text = await response.text(); if (byteLength(text) > MAX_BYTES) fail("CONTROL_RESPONSE_LIMIT", "Authority response exceeds its byte limit"); return text; }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0, text = "";
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_BYTES) { controller.abort(); fail("CONTROL_RESPONSE_LIMIT", "Authority response exceeds its byte limit"); } text += decoder.decode(chunk.value, { stream: true }); } return text + decoder.decode(); }
  finally { reader.releaseLock(); }
}
function canonicalParse(text, limit) { if (typeof text !== "string" || byteLength(text) > limit) fail("INVALID_CONTROL_JOURNAL", "Canonical journal/envelope exceeds its byte limit"); let result; try { result = JSON.parse(text); } catch { fail("INVALID_CONTROL_JOURNAL", "Canonical journal/envelope is invalid"); } if (canonicalJSON(result) !== text) fail("INVALID_CONTROL_JOURNAL", "Exact canonical bytes are required"); return result; }
function timestamp(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0 || new Date(value).toISOString() !== value) fail("CONTROL_TIME_UNAVAILABLE", "Authority time must be canonical"); return value; }
function secureRandom(size) { if (!globalThis.crypto?.getRandomValues) fail("CONTROL_RANDOM_UNAVAILABLE", "Secure host randomness is unavailable"); return globalThis.crypto.getRandomValues(new Uint8Array(size)); }
function byteLength(text) { return new TextEncoder().encode(text).length; }
function clone(value) { return JSON.parse(canonicalJSON(value)); }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
