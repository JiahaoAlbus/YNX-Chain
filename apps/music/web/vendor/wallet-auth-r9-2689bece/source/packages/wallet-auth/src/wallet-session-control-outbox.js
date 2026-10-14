import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { httpBodyDigest } from "./session-proof.js";
import { parseProductSessionControlIntent, productSessionControlIntentDigest } from "./product-session-control-intent.js";
import { WALLET_SESSION_CONTROL_AUDIENCE, WALLET_SESSION_CONTROL_INTENT_PATHS } from "./wallet-session-control.js";

/**
 * First client layer only: immutable, pure outbox transitions. No storage,
 * network, clock, keys, signing, or automatic Retry lives here. An observation
 * is NOT authenticated just because its HTTP metadata or JSON looks right.
 *
 * Adapter contract, in order:
 * 1. Serialize by storageKey; read protected bytes; validate the expected owner.
 * 2. Recompute the plan against that latest state, CAS-write candidateText and
 *    read back exact bytes before progressing. A write/ACK/readback failure is
 *    unknown: never roll back, delete, sign, or POST using an older snapshot.
 * 3. For attempt, authenticate a fresh /time exchange at the fixed authority.
 *    Monotonic epoch is local-process specific; never reuse it after restart.
 * 4. Recheck the current owner/unlock/cancellation lease, sign signingInput with
 *    that owner, verify the resulting proof's full binding, then commit dispatch
 *    and read back. Recheck lease and clock after the awaits, immediately before
 *    handing the ORIGINAL bodyText to the pinned, non-redirecting transport.
 * 5. Receive using the ORIGINAL attempt context, not the currently selected
 *    account. Authenticate the exchange independently, including exact URL,
 *    request ID, response limits and canonical envelope; then prepare observe
 *    against latest storage. Late facts survive cancellation; stale plans do not.
 *
 * This layer deliberately has no confirm/archive operation. receipt-observed
 * and expiry-observed remain blocked for a future authenticated adapter's
 * durable promotion. Every returned summary/plan has revocationConfirmed=false.
 * Structural parsing, matching bytes, or caller-provided booleans do not attest
 * authentication/durability. No platform may show logout success from them.
 * Before-dispatch local cancellation alone is terminal and retains all history.
 */
const CHAIN = "ynx_6423-1";
const PATHS = Object.freeze({ "account-logout": WALLET_SESSION_CONTROL_INTENT_PATHS[0], "device-logout": WALLET_SESSION_CONTROL_INTENT_PATHS[1] });
const ACCOUNT = /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const REQUEST = /^req_[A-Za-z0-9_-]{12,80}$/;
const MAX_RECORDS = 128, MAX_ATTEMPTS = 256, MAX_BYTES = 16 * 1024 * 1024;
const RECEIPT_FIELDS = ["version", "account", "intentId", "intentDigest", "operation", "target", "cutoff", "appliedAt", "revoked", "sessionBindings", "challengeIds", "revokedSessionCount", "cancelledChallengeCount"];
const RECORD_FIELDS = ["intent", "path", "bodyText", "bodyDigest", "intentDigest", "cancelRequested", "attempts"];
const ATTEMPT_FIELDS = ["requestId", "nonce", "issuedAt", "expiresAt", "clock", "stage", "response"];

export function walletSessionControlOutboxKey(scopeInput) {
  return `ynx:wallet-control-outbox:v1:${digestHex("YNX_WALLET_CONTROL_OUTBOX_OWNER_V1", scope(scopeInput))}`;
}

export function createWalletSessionControlOutbox(scopeInput) {
  return freeze({ version: 1, scope: scope(scopeInput), revision: 0, records: [] });
}

/** expectedScope is mandatory: a copied store must not silently switch owner. */
export function parseWalletSessionControlOutbox(input, expectedScope) {
  const value = typeof input === "string" ? json(input, MAX_BYTES) : input;
  exactFields(value, ["version", "scope", "revision", "records"], "Owner control outbox");
  const owner = scope(value.scope);
  if (canonicalJSON(owner) !== canonicalJSON(scope(expectedScope))) fail("OUTBOX_OWNER_MISMATCH", "Outbox authority, chain and account must match the selected owner");
  if (value.version !== 1) fail("INVALID_CONTROL_OUTBOX", "Unsupported owner outbox version");
  uint(value.revision);
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) fail("OUTBOX_CAPACITY", "Owner outbox history exceeds capacity");
  const records = value.records.map((input) => record(input, owner));
  const ids = new Set(), requests = new Set(), nonces = new Set();
  let unresolved = 0;
  for (const entry of records) {
    if (ids.has(entry.intent.body.intentId)) fail("INVALID_CONTROL_OUTBOX", "Duplicate original intent ID");
    ids.add(entry.intent.body.intentId);
    if (phase(entry) !== "cancelled-before-dispatch") unresolved++;
    for (const attempt of entry.attempts) {
      if (requests.has(attempt.requestId) || nonces.has(attempt.nonce)) fail("OUTBOX_REPLAY", "Request IDs and nonces must never be reused within owner history");
      requests.add(attempt.requestId); nonces.add(attempt.nonce);
    }
  }
  if (unresolved > 1) fail("INVALID_CONTROL_OUTBOX", "Only one unresolved intent is allowed for an owner");
  const parsed = { version: 1, scope: owner, revision: value.revision, records };
  if (bytes(canonicalJSON(parsed)) > MAX_BYTES) fail("OUTBOX_CAPACITY", "Owner outbox bytes exceed capacity; history cannot be silently discarded");
  return freeze(parsed);
}

/** All events are explicit caller actions; none imply permission to perform I/O. */
export function prepareWalletSessionControlOutbox(input, expectedScope, event) {
  const state = parseWalletSessionControlOutbox(input, expectedScope), next = clone(state);
  const requirements = ["atomic-owner-cas", "protected-exact-readback"];
  if (!event || typeof event.type !== "string") fail("INVALID_OUTBOX_EVENT", "An explicit outbox event is required");
  let signingInput = null;
  if (event.type === "enqueue") {
    exactFields(event, ["type", "intent"], "Enqueue owner intent");
    const intent = parseProductSessionControlIntent(event.intent);
    if (intent.account !== state.scope.account) fail("OUTBOX_OWNER_MISMATCH", "Intent account differs from the owner");
    const old = next.records.find((entry) => entry.intent.body.intentId === intent.body.intentId);
    if (old) {
      if (canonicalJSON(old.intent) !== canonicalJSON(intent)) fail("IDEMPOTENCY_CONFLICT", "Original intent ID is bound to its exact original body and operation");
      fail("OUTBOX_INTENT_EXISTS", "Use explicit Retry on the original intent");
    }
    if (next.records.some((entry) => phase(entry) !== "cancelled-before-dispatch")) fail("OUTBOX_PENDING", "Resolve the original owner intent before creating another");
    if (next.records.length >= MAX_RECORDS) fail("OUTBOX_CAPACITY", "Owner history is full");
    next.records.push({ intent, path: PATHS[intent.operation], bodyText: canonicalJSON(intent.body), bodyDigest: httpBodyDigest(canonicalJSON(intent.body)), intentDigest: productSessionControlIntentDigest(intent), cancelRequested: false, attempts: [] });
    requirements.push("explicit-owner-intent-consent");
  } else {
    const entry = next.records.find((value) => value.intent.body.intentId === event.intentId);
    if (!entry) fail("OUTBOX_INTENT_NOT_FOUND", "Original owner intent is missing");
    if (event.type === "attempt") {
      exactFields(event, ["type", "intentId", "requestId", "nonce", "clock", "at"], "Prepare explicit owner Retry");
      protocol(state.scope);
      if (["receipt-observed", "expiry-observed", "cancelled-before-dispatch"].includes(phase(entry))) fail("OUTBOX_RESOLUTION_PENDING", "This intent requires adapter resolution; it cannot be silently retried or replaced");
      if (entry.attempts.length >= MAX_ATTEMPTS) fail("OUTBOX_CAPACITY", "Attempt history is full");
      const clock = clockSample(event.clock, state.scope); fresh(clock, event.at);
      // Intentionally no intentExpiresAt check. A previously committed expired
      // intent must recover its original receipt using a NEW valid owner proof.
      for (const old of entry.attempts) if (old.stage === "prepared") old.stage = "cancelled-before-dispatch";
      const attempt = {
        requestId: pattern(event.requestId, REQUEST), nonce: pattern(event.nonce, TOKEN),
        issuedAt: clock.serverTime, expiresAt: new Date(Date.parse(clock.serverTime) + 30_000).toISOString(),
        clock, stage: "prepared", response: null,
      };
      entry.cancelRequested = false; entry.attempts.push(attempt);
      signingInput = proofContext(entry, attempt);
      requirements.push("explicit-retry-consent", "authenticated-fresh-authority-time", "current-owner-lease-before-signing", "verify-signed-proof-full-binding");
    } else if (event.type === "dispatch") {
      exactFields(event, ["type", "intentId", "requestId", "at"], "Prepare owner dispatch marker");
      protocol(state.scope);
      const attempt = findAttempt(entry, event.requestId);
      if (entry.cancelRequested || attempt.stage !== "prepared" || entry.attempts.at(-1) !== attempt || observation(entry)) fail("OUTBOX_ATTEMPT_CANCELLED", "Only the current authorized prepared attempt can dispatch");
      fresh(attempt.clock, event.at);
      attempt.stage = "may-have-sent";
      requirements.push("current-owner-lease-after-awaits", "fresh-clock-after-readback", "verify-signed-proof-full-binding", "original-bytes-only");
    } else if (event.type === "cancel") {
      exactFields(event, ["type", "intentId"], "Cancel owner attempt");
      entry.cancelRequested = true;
      for (const attempt of entry.attempts) if (attempt.stage === "prepared") attempt.stage = "cancelled-before-dispatch";
      // may-have-sent and its late observations are deliberately retained.
    } else if (event.type === "observe") {
      exactFields(event, ["type", "intentId", "requestId", "response"], "Observe original owner response");
      const attempt = findAttempt(entry, event.requestId);
      if (attempt.stage !== "may-have-sent") fail("OUTBOX_NOT_DISPATCHED", "A response must bind a possibly dispatched original attempt");
      const response = exchange(event.response, state.scope, entry, attempt);
      if (attempt.response && canonicalJSON(attempt.response) !== canonicalJSON(response)) fail("OUTBOX_RESPONSE_CONFLICT", "One exact attempt cannot acquire conflicting responses");
      attempt.response = response;
      // A later read must not mutate an already frozen original receipt or turn
      // a confirmed receipt into an unapplied intent. Parser enforces both.
      requirements.push("authenticate-original-exchange", "retain-original-attempt-context", "no-public-confirmation-before-adapter-promotion");
    } else fail("INVALID_OUTBOX_EVENT", "Unsupported owner outbox event");
  }
  next.revision = state.revision + 1;
  const candidate = parseWalletSessionControlOutbox(next, state.scope);
  return freeze({
    version: 1, status: "prepared", revocationConfirmed: false, localCommitConfirmed: false,
    storageKey: walletSessionControlOutboxKey(state.scope), baseRevision: state.revision,
    baseDigest: stateDigest(state), candidateDigest: stateDigest(candidate),
    event: clone(event), requirements, signingInput, candidateText: canonicalJSON(candidate), candidate,
  });
}

/** Must run while holding the adapter's owner serialization / CAS boundary. */
export function assertWalletSessionControlOutboxPlanBase(plan, latest, expectedScope) {
  exactFields(plan, ["version", "status", "revocationConfirmed", "localCommitConfirmed", "storageKey", "baseRevision", "baseDigest", "candidateDigest", "event", "requirements", "signingInput", "candidateText", "candidate"], "Prepared owner outbox plan");
  const state = parseWalletSessionControlOutbox(latest, expectedScope);
  if (state.revision !== plan.baseRevision || stateDigest(state) !== plan.baseDigest) fail("STALE_CONTROL_OUTBOX", "Re-read the latest original owner outbox before preparing this transition");
  const expected = prepareWalletSessionControlOutbox(state, expectedScope, plan.event);
  if (canonicalJSON(expected) !== canonicalJSON(plan)) fail("INVALID_OUTBOX_PLAN", "Prepared plan changes unrelated owner history or requirements");
  return expected.candidate;
}

/** Byte equality only, not evidence that a write occurred or was durable. */
export function compareWalletSessionControlOutboxReadback(plan, readbackText, expectedScope) {
  const candidate = parseWalletSessionControlOutbox(plan.candidateText, expectedScope);
  if (readbackText !== plan.candidateText || stateDigest(candidate) !== plan.candidateDigest) fail("OUTBOX_READBACK_UNKNOWN", "Exact owner outbox readback was not observed; do not dispatch or restore old bytes");
  return freeze({ bytesMatch: true, storageKey: walletSessionControlOutboxKey(candidate.scope), candidateDigest: plan.candidateDigest, localCommitConfirmed: false, revocationConfirmed: false });
}

/**
 * Re-evaluate AFTER the dispatch marker's readback and signer awaits, against
 * the latest protected owner state, immediately before transport dispatch.
 * Adapter still owns the live lease, proof verification, storage and TLS checks.
 * No await is allowed between that final lease/clock check and dispatch itself.
 */
export function walletSessionControlOutboxRequestCandidate(input, expectedScope, context) {
  exactFields(context, ["intentId", "requestId", "revision", "at"], "Final original owner dispatch context");
  const state = parseWalletSessionControlOutbox(input, expectedScope); protocol(state.scope);
  if (context.revision !== state.revision) fail("STALE_CONTROL_OUTBOX", "The original dispatch revision changed during an await");
  const entry = state.records.find((value) => value.intent.body.intentId === context.intentId);
  if (!entry) fail("OUTBOX_INTENT_NOT_FOUND", "The original owner intent is missing");
  const attempt = findAttempt(entry, context.requestId);
  if (entry.cancelRequested || entry.attempts.at(-1) !== attempt || attempt.stage !== "may-have-sent" || attempt.response !== null || observation(entry)) fail("OUTBOX_ATTEMPT_CANCELLED", "The original current dispatch was cancelled, superseded or observed");
  fresh(attempt.clock, context.at);
  return freeze({
    status: "request-candidate", dispatchAuthorized: false, revocationConfirmed: false,
    scope: state.scope, requestId: attempt.requestId, revision: state.revision,
    method: "POST", url: `${state.scope.authority}${entry.path}`, bodyText: entry.bodyText,
    signingInput: proofContext(entry, attempt),
    requirements: ["protected-exact-readback", "live-original-attempt-lease", "verify-signed-proof-full-binding", "no-await-before-dispatch", "pinned-nonredirecting-transport"],
  });
}

export function summarizeWalletSessionControlOutbox(input, expectedScope) {
  const state = parseWalletSessionControlOutbox(input, expectedScope);
  return freeze({
    storageKey: walletSessionControlOutboxKey(state.scope), revision: state.revision,
    revocationConfirmed: false, authenticationConfirmed: false, localCommitConfirmed: false,
    records: state.records.map((entry) => ({
      intentId: entry.intent.body.intentId, operation: entry.intent.operation,
      status: phase(entry), cancelRequested: entry.cancelRequested,
      unknownHistory: entry.attempts.some((attempt) => attempt.stage === "may-have-sent"),
      retryRequiresExplicitConsent: true, originalBodyText: entry.bodyText,
      // This is still an untrusted structural candidate, never a success receipt.
      observation: observation(entry),
    })),
  });
}

function record(input, owner) {
  exactFields(input, RECORD_FIELDS, "Owner outbox original intent");
  const intent = parseProductSessionControlIntent(input.intent);
  if (intent.account !== owner.account || input.path !== PATHS[intent.operation] || input.bodyText !== canonicalJSON(intent.body) || input.bodyDigest !== httpBodyDigest(input.bodyText) || input.intentDigest !== productSessionControlIntentDigest(intent) || typeof input.cancelRequested !== "boolean") fail("INVALID_CONTROL_OUTBOX", "Original owner, path, body bytes or digest changed");
  if (!Array.isArray(input.attempts) || input.attempts.length > MAX_ATTEMPTS) fail("OUTBOX_CAPACITY", "Attempt history is invalid");
  const parsed = { ...input, intent, attempts: [] };
  let prepared = 0;
  parsed.attempts = input.attempts.map((value, index) => {
    exactFields(value, ATTEMPT_FIELDS, "Original owner attempt");
    pattern(value.requestId, REQUEST); pattern(value.nonce, TOKEN); time(value.issuedAt); time(value.expiresAt);
    const clock = clockSample(value.clock, owner);
    if (value.issuedAt !== clock.serverTime || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) !== 30_000 || !["prepared", "may-have-sent", "cancelled-before-dispatch"].includes(value.stage)) fail("INVALID_CONTROL_OUTBOX", "Attempt proof window or stage is invalid");
    if (value.stage === "prepared") {
      prepared++;
      if (index !== input.attempts.length - 1 || input.cancelRequested) fail("INVALID_CONTROL_OUTBOX", "A superseded or cancelled attempt cannot remain prepared");
    }
    if (value.response !== null && value.stage !== "may-have-sent") fail("INVALID_CONTROL_OUTBOX", "Undispatched attempt cannot contain a response");
    return { ...value, clock, response: value.response === null ? null : exchange(value.response, owner, parsed, value) };
  });
  if (prepared > 1) fail("INVALID_CONTROL_OUTBOX", "Only one prepared attempt is allowed");
  observation(parsed); // Detect conflicting terminal candidates on reload too.
  return parsed;
}

function exchange(input, owner, entry, attempt) {
  exactFields(input, ["url", "redirected", "status", "requestId", "contentType", "cacheControl", "bodyText"], "Original owner HTTP observation");
  if (input.url !== `${owner.authority}${entry.path}` || input.redirected !== false || input.requestId !== attempt.requestId || input.contentType !== "application/json; charset=utf-8" || input.cacheControl !== "no-store") fail("OUTBOX_RESPONSE_BINDING", "Response must match the original authority, path and request without redirects");
  if (!Number.isInteger(input.status) || input.status < 200 || input.status > 599) fail("OUTBOX_RESPONSE_BINDING", "Response HTTP status is invalid");
  const envelope = json(input.bodyText, 4 * 1024 * 1024);
  if (envelope.ok === true) {
    exactFields(envelope, ["ok", "requestId", "schemaVersion", "result"], "Owner success envelope");
    exactFields(envelope.result, ["status", "revocationConfirmed", "receipt"], "Owner durable receipt envelope");
    if (input.status !== 200 || envelope.result.status !== "confirmed" || envelope.result.revocationConfirmed !== true) fail("OUTBOX_RESPONSE_BINDING", "Prepared or unknown server output is not a durable receipt candidate");
    receipt(envelope.result.receipt, entry.intent);
  } else if (envelope.ok === false) {
    const unknown = Object.hasOwn(envelope, "status") || Object.hasOwn(envelope, "revocationConfirmed");
    exactFields(envelope, ["ok", "requestId", "schemaVersion", "error", ...(unknown ? ["status", "revocationConfirmed"] : [])], "Owner error envelope");
    exactFields(envelope.error, ["code", "message"], "Owner error");
    pattern(envelope.error.code, /^[A-Z][A-Z0-9_]{0,95}$/);
    if (typeof envelope.error.message !== "string" || envelope.error.message.length > 2048 || input.status < 400 || (unknown && (envelope.status !== "unknown" || envelope.revocationConfirmed !== false))) fail("OUTBOX_RESPONSE_BINDING", "Owner error envelope is invalid");
    // The real server checks its committed receipt before intent expiry. Only
    // this exact exchange can be considered an UNAPPLIED expiry candidate.
    if (envelope.error.code === "INTENT_EXPIRED" && (input.status !== 409 || unknown || attempt.issuedAt < entry.intent.body.intentExpiresAt)) fail("OUTBOX_RESPONSE_BINDING", "Intent expiry does not match the original request and fresh authority time");
  } else fail("OUTBOX_RESPONSE_BINDING", "Owner envelope must have a boolean ok field");
  if (envelope.schemaVersion !== 2 || envelope.requestId !== attempt.requestId) fail("OUTBOX_RESPONSE_BINDING", "Envelope is not bound to the original attempt");
  return clone(input);
}

function receipt(value, intent) {
  exactFields(value, RECEIPT_FIELDS, "Fixed owner intent receipt");
  const target = { account: intent.account, ...(intent.operation === "device-logout" ? { deviceBinding: intent.body.deviceBinding } : {}) };
  time(value.cutoff); time(value.appliedAt);
  if (value.version !== 1 || value.revoked !== true || value.account !== intent.account || value.intentId !== intent.body.intentId || value.intentDigest !== productSessionControlIntentDigest(intent) || value.operation !== intent.operation || canonicalJSON(value.target) !== canonicalJSON(target) || value.cutoff !== value.appliedAt || value.cutoff < intent.body.intentIssuedAt || value.cutoff >= intent.body.intentExpiresAt) fail("OUTBOX_RECEIPT_BINDING", "Receipt does not match the exact original owner intent and first application time");
  sorted(value.sessionBindings, HASH); sorted(value.challengeIds, TOKEN);
  if (value.revokedSessionCount !== value.sessionBindings.length || value.cancelledChallengeCount !== value.challengeIds.length) fail("OUTBOX_RECEIPT_BINDING", "Receipt counts differ from its fixed target sets");
  return value;
}

function observation(entry) {
  let found = null;
  for (const attempt of entry.attempts) {
    if (attempt.response === null) continue;
    const envelope = JSON.parse(attempt.response.bodyText);
    const candidate = envelope.ok ? { type: "receipt", receipt: envelope.result.receipt }
      : envelope.error.code === "INTENT_EXPIRED" ? { type: "unapplied-expiry", code: "INTENT_EXPIRED" } : null;
    if (!candidate) continue;
    if (found && canonicalJSON(found) !== canonicalJSON(candidate)) fail("OUTBOX_RESPONSE_CONFLICT", "Later response changes the original frozen outcome or cutoff");
    found = candidate;
  }
  return found;
}

function phase(entry) {
  const observed = observation(entry);
  if (observed) return observed.type === "receipt" ? "receipt-observed" : "expiry-observed";
  if (entry.attempts.some((attempt) => attempt.stage === "may-have-sent")) return "unknown";
  if (entry.cancelRequested) return "cancelled-before-dispatch";
  return entry.attempts.at(-1)?.stage === "prepared" ? "prepared" : "ready";
}
function proofContext(entry, attempt) { return { method: "POST", path: entry.path, bodyDigest: entry.bodyDigest, nonce: attempt.nonce, issuedAt: attempt.issuedAt, expiresAt: attempt.expiresAt }; }
function findAttempt(entry, requestId) { const result = entry.attempts.find((attempt) => attempt.requestId === requestId); if (!result) fail("OUTBOX_ATTEMPT_NOT_FOUND", "Response or action is missing its original attempt"); return result; }
function scope(input) {
  exactFields(input, ["authority", "chainId", "account"], "Owner authority scope");
  let url; try { url = new URL(input.authority); } catch { fail("INVALID_OUTBOX_SCOPE", "Authority must be a canonical HTTPS origin"); }
  if (typeof input.authority !== "string" || input.authority.length > 255 || url.protocol !== "https:" || url.origin !== input.authority || url.username || url.password || url.pathname !== "/" || url.search || url.hash) fail("INVALID_OUTBOX_SCOPE", "Authority must be a canonical HTTPS origin");
  return { authority: input.authority, chainId: pattern(input.chainId, /^[a-z][a-z0-9_-]{1,63}$/), account: pattern(input.account, ACCOUNT) };
}
function protocol(owner) { if (owner.authority !== WALLET_SESSION_CONTROL_AUDIENCE || owner.chainId !== CHAIN) fail("UNSUPPORTED_CONTROL_AUTHORITY", "The current owner proof protocol supports only its exact configured authority and chain"); }
function clockSample(input, owner) {
  exactFields(input, ["authority", "chainId", "requestId", "serverTime", "epoch", "receivedAtMs", "roundTripMs"], "Fresh Auth time observation");
  if (input.authority !== owner.authority || input.chainId !== owner.chainId) fail("OUTBOX_CLOCK_BINDING", "Auth time belongs to another authority or chain");
  pattern(input.requestId, REQUEST); time(input.serverTime); pattern(input.epoch, TOKEN); uint(input.receivedAtMs); uint(input.roundTripMs);
  if (input.roundTripMs > 5000) fail("OUTBOX_CLOCK_STALE", "Authority time request took too long");
  return clone(input);
}
function fresh(clock, input) {
  exactFields(input, ["epoch", "monotonicMs"], "Current monotonic sample"); uint(input.monotonicMs);
  if (input.epoch !== clock.epoch || input.monotonicMs < clock.receivedAtMs || input.monotonicMs - clock.receivedAtMs + clock.roundTripMs > 5000) fail("OUTBOX_CLOCK_STALE", "Require a new authenticated authority sample after unlock, delay or process restart");
}
function json(text, limit) { if (typeof text !== "string" || bytes(text) > limit) fail("INVALID_CONTROL_OUTBOX", "Canonical JSON byte limit exceeded"); let value; try { value = JSON.parse(text); } catch { fail("INVALID_CONTROL_OUTBOX", "Invalid canonical JSON"); } if (canonicalJSON(value) !== text) fail("INVALID_CONTROL_OUTBOX", "Persist and transport exact canonical JSON bytes"); return value; }
function sorted(values, expression) { if (!Array.isArray(values) || values.length > 20_000 || values.some((value, index) => typeof value !== "string" || !expression.test(value) || index > 0 && values[index - 1] >= value)) fail("OUTBOX_RECEIPT_BINDING", "Receipt targets must be bounded, unique and sorted in code-unit order"); }
function uint(value) { if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_CONTROL_OUTBOX", "Outbox counters must be nonnegative safe integers"); return value; }
function time(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0 || new Date(value).toISOString() !== value) fail("INVALID_TIME", "Require a canonical authority timestamp"); return value; }
function pattern(value, regex) { if (typeof value !== "string" || !regex.test(value)) fail("INVALID_CONTROL_OUTBOX", "Owner outbox field is invalid"); return value; }
function stateDigest(value) { return digestHex("YNX_WALLET_CONTROL_OUTBOX_STATE_V1", value); }
function bytes(value) { return new TextEncoder().encode(value).length; }
function clone(value) { return JSON.parse(canonicalJSON(value)); }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
