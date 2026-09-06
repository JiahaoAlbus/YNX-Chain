import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { productPlatformBinding } from "./product-session-registry.js";
import { parseProductSession } from "./product-session-v2.js";
import { RecoverableProductSessionClient } from "./product-session-recovery.js";
import { createProductSessionProofV2With } from "./product-session-proof-v2.js";
import { encodeProductSessionGatewayProofHeaderV2 } from "./product-session-gateway-client.js";
import { httpBodyDigest } from "./session-proof.js";
import { createRevocationIntent, parseRevocationIntent, revocationSessionMatches } from "./product-session-revocation-intent.js";
import { parseCompletionRecord } from "./product-session-completion-record.js";

export const BROWSER_PRODUCT_SESSION_SECURITY_LEVEL = "webcrypto-nonextractable";
const DATABASE = "ynx-product-session-web-v2";
const DEVICE_STORE = "devices", STATE_STORE = "state";

// The browser protects key export, not access by scripts executing in this origin.
export async function createBrowserProductSessionClient(config) {
  const { registry, productId, scopes, purpose, gateway, environment = globalThis, clock = () => new Date() } = config ?? {};
  if (!config || Object.keys(config).some(key => !["registry", "productId", "scopes", "purpose", "gateway", "environment", "clock"].includes(key))) fail("INVALID_DEVICE", "Browser Product Session configuration is invalid");
  const binding = productPlatformBinding(registry, productId, "web");
  if (environment?.isSecureContext !== true || environment.location?.origin !== binding.origin) fail("ORIGIN_NOT_ALLOWED", "Browser Product Sessions require the registered product HTTPS origin");
  const crypto = environment.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== "function" || typeof environment.indexedDB?.open !== "function") fail("INSECURE_STORAGE", "This browser cannot persist a non-extractable WebCrypto device key");
  validateScopes(scopes, binding.scopes);
  if (typeof purpose !== "string" || purpose.length < 1 || purpose.length > 180 || purpose.trim() !== purpose || typeof clock !== "function") fail("INVALID_DEVICE", "Browser Product Session purpose or clock is invalid");
  const approvedScopes = Object.freeze([...scopes]);
  const namespace = canonicalJSON({ chainId: binding.chainId, productId, clientId: binding.clientId, applicationId: binding.applicationId, origin: binding.origin, callback: binding.callback, scopes: approvedScopes });
  const storageKey = `ynx.product-session.v2:${productId}:web:${binding.applicationId}`;
  const revocationKey = `${storageKey}:revoke`;
  const allowedKeys = new Set([storageKey, `${storageKey}:pending`, `${storageKey}:return`, `${storageKey}:completion`, revocationKey]);
  const randomToken = () => encodeBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const db = await openDatabase(environment.indexedDB);
  let closed = false, revocationAttempted = false;
  const close = () => { closed = true; db.close(); };
  db.onversionchange = close;
  try {
    let record = await transact(db, "readonly", namespace, ({ device, state }) => {
      if (device === undefined && state === undefined) return null;
      assertRecord(device, state, namespace, allowedKeys);
      return device;
    });
    if (record === null) {
      let pair;
      try { pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]); }
      catch { fail("INSECURE_STORAGE", "Browser WebCrypto device key generation failed"); }
      const candidate = { version: 1, namespace, deviceId: `web_${randomToken()}`, deviceKey: await publicDeviceKey(crypto, pair.publicKey), privateKey: pair.privateKey, publicKey: pair.publicKey };
      record = await transact(db, "readwrite", namespace, ({ device, state, devices, states }) => {
        // A second tab may have initialized the device while WebCrypto was generating our candidate.
        if (device !== undefined || state !== undefined) { assertRecord(device, state, namespace, allowedKeys); return device; }
        const initial = { version: 1, deviceId: candidate.deviceId, deviceKey: candidate.deviceKey, values: {} };
        assertRecord(candidate, initial, namespace, allowedKeys);
        devices.add(candidate, namespace); states.add(initial, namespace); return candidate;
      });
    }
    // Read structured-cloned CryptoKeys back before accepting the persistence capability.
    const persisted = await currentRecord();
    await verifyKeyPair(crypto, persisted);
    const device = Object.freeze({ id: record.deviceId, key: record.deviceKey, scopes: approvedScopes, purpose, sign });
    const storage = Object.freeze({
      securityLevel: BROWSER_PRODUCT_SESSION_SECURITY_LEVEL,
      async get(key) { assertStorageKey(key); return stateOperation("readonly", ({ state }) => { const value = state.values[key] ?? null; if (value !== null) assertStoredValue(key, value); return value; }); },
      async set(key, value) { assertStorageKey(key); assertStoredValue(key, value); return stateOperation("readwrite", ({ state, states }) => {
        const pending = readIntent(state);
        if (pending && key !== revocationKey) {
          if (key !== storageKey) fail("REVOCATION_PENDING", "Sign-out blocks new connection requests");
          const session = parseProductSession(JSON.parse(value));
          if (pending.session !== null && !revocationSessionMatches(value, pending.session)) fail("REVOCATION_PENDING", "Sign-out target cannot be replaced by another session");
          if (pending.session === null) state.values[revocationKey] = canonicalJSON(createRevocationIntent(binding, device, pending.intentId, session));
        }
        state.values[key] = value; states.put(state, namespace);
      }); },
      async remove(key) { assertStorageKey(key); return stateOperation("readwrite", ({ state, states }) => { delete state.values[key]; states.put(state, namespace); }); },
      async saveRevocationIntent(key, raw) {
        if (key !== revocationKey) fail("CROSS_PRODUCT_SESSION", "Sign-out intent key is invalid");
        revocationAttempted = true;
        const candidate = parseRevocationIntent(raw, binding, device);
        return stateOperation("readwrite", ({ state, states }) => {
          let intent = readIntent(state);
          if (intent === null) intent = candidate;
          else if (intent.intentId === candidate.intentId && intent.session === null && candidate.session !== null) intent = candidate;
          if (intent.session === null && state.values[storageKey]) intent = createRevocationIntent(binding, device, intent.intentId, parseProductSession(JSON.parse(state.values[storageKey])));
          const value = canonicalJSON(intent); state.values[revocationKey] = value; states.put(state, namespace); return value;
        });
      },
      async finishRevocationIntent(key, raw) {
        if (key !== revocationKey) fail("CROSS_PRODUCT_SESSION", "Sign-out intent key is invalid");
        const intent = parseRevocationIntent(raw, binding, device);
        await stateOperation("readwrite", ({ state, states }) => {
          if (state.values[revocationKey] !== raw) fail("REVOCATION_CHANGED", "Sign-out target changed before secure cleanup");
          const current = state.values[storageKey] ?? null;
          if (revocationSessionMatches(current, intent.session)) delete state.values[storageKey];
          // A late receipt for A must never delete a newer session B or its request.
          if (current === null || revocationSessionMatches(current, intent.session)) {
            delete state.values[`${storageKey}:pending`]; delete state.values[`${storageKey}:return`]; delete state.values[`${storageKey}:completion`];
          }
          delete state.values[revocationKey]; states.put(state, namespace);
        });
        revocationAttempted = false;
      },
    });
    const client = new RecoverableProductSessionClient({ registry, productId, platform: "web", storage, gateway, device, tokenFactory: randomToken, clock });
    const capabilities = Object.freeze({ securityLevel: BROWSER_PRODUCT_SESSION_SECURITY_LEVEL, privateKeyExtractable: false, persistedCryptoKey: true, osProtected: false, hardwareBacked: false, origin: binding.origin, productId, scopes: approvedScopes });
    return Object.freeze({ client, device, storage, capabilities, createIntrospectionProof, close });

    function assertStorageKey(key) { if (!allowedKeys.has(key)) fail("CROSS_PRODUCT_SESSION", "Browser storage key is outside this product binding"); }
    function assertStoredValue(key, value) {
      if (typeof value !== "string" || value.length > 16_384) fail("INSECURE_STORAGE", "Browser Product Session storage value is invalid");
      if (key === `${storageKey}:return`) return;
      if (key === revocationKey) { parseRevocationIntent(value, binding, device); return; }
      let input; try { input = JSON.parse(value); } catch { fail("INVALID_SESSION_STORE", "Browser Product Session storage is invalid JSON"); }
      if (key === `${storageKey}:completion`) input = parseCompletionRecord(registry, value, new Date(input.completion?.challenge?.issuedAt)).request;
      if (key === storageKey) input = parseProductSession(input);
      for (const field of ["chainId", "productId", "clientId", "applicationId", "origin", "callback"]) if (input?.[field] !== binding[field]) fail("CROSS_PRODUCT_SESSION", "Stored browser session crosses its registered product binding");
      if (input.platform !== "web" || input.bundleId !== null || input.packageId !== null || input.deviceId !== record.deviceId || input.deviceKey !== record.deviceKey) fail("DEVICE_CHANGED", "Stored browser session does not match this device key");
      if (canonicalJSON(input.scopes) !== canonicalJSON(approvedScopes)) fail("SCOPE_WIDENING", "Stored browser session does not match this scope binding");
    }
    function readIntent(state) { const raw = state.values[revocationKey] ?? null; return raw === null ? null : parseRevocationIntent(raw, binding, device); }
    function stateOperation(mode, callback) {
      if (closed || environment.location?.origin !== binding.origin) fail("INSECURE_STORAGE", "Browser Product Session storage is no longer available at this origin");
      return transact(db, mode, namespace, context => {
        assertRecord(context.device, context.state, namespace, allowedKeys);
        if (context.device.deviceId !== record.deviceId || context.device.deviceKey !== record.deviceKey) fail("DEVICE_CHANGED", "Persisted browser device changed; start a new explicit connection");
        return callback(context);
      });
    }
    function currentRecord() { return stateOperation("readonly", ({ device }) => device); }
    async function sign(input) {
      exactFields(input, ["purpose", "algorithm", "deviceKey", "payload"], "Browser device signing request");
      if (!["challenge", "http-proof"].includes(input.purpose) || input.algorithm !== "p256-sha256" || input.deviceKey !== record.deviceKey || typeof input.payload !== "string" || input.payload.length > 16_384) fail("INVALID_DEVICE_PROOF", "Browser device signing request does not match this key");
      const payload = decodeBase64url(input.payload, "browser signing payload");
      const prefix = input.purpose === "challenge" ? "YNX_PRODUCT_SESSION_CHALLENGE_V2\n" : "YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n";
      const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
      if (!text.startsWith(prefix)) fail("INVALID_DEVICE_PROOF", "Browser device signing purpose does not match its payload");
      let subject; try { subject = JSON.parse(text.slice(prefix.length)); } catch { fail("INVALID_DEVICE_PROOF", "Browser device signing payload is invalid"); }
      for (const field of ["productId", "clientId", "applicationId", "origin", "callback"]) if (subject[field] !== binding[field]) fail("CROSS_PRODUCT_SESSION", "Browser signer cannot sign for another product binding");
      if (subject.deviceId !== record.deviceId || subject.deviceKey !== record.deviceKey || subject.bundleId !== null || subject.packageId !== null) fail("DEVICE_CHANGED", "Browser signing payload does not match this device");
      if (input.purpose === "challenge" && (subject.platform !== "web" || canonicalJSON(subject.scopes) !== canonicalJSON(approvedScopes))) fail("SCOPE_WIDENING", "Browser challenge crosses the configured scope binding");
      const active = await signingRecord(subject, input.purpose);
      let signature;
      try {
        signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, active.privateKey, payload));
        if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, active.publicKey, signature, payload)) fail("DEVICE_CHANGED", "Browser device key pair no longer matches");
      } catch (error) { if (error instanceof WalletAuthError) throw error; fail("DEVICE_SIGNING_FAILED", "Browser device signing failed"); }
      await signingRecord(subject, input.purpose); // Recheck persisted sign-out and target after signing.
      return encodeBase64url(p1363ToDER(signature));
    }
    function signingRecord(subject, purpose) {
      return stateOperation("readonly", ({ device: current, state }) => {
        const pending = readIntent(state);
        if (pending || revocationAttempted) {
          const target = pending?.session;
          if (purpose !== "http-proof" || subject.path !== "/v2/product-sessions/revoke" || subject.method !== "POST" || subject.bodyDigest !== httpBodyDigest("{}") || !target || subject.sessionBinding !== target.sessionBinding || subject.account !== target.account) fail("REVOCATION_PENDING", "Pending sign-out permits only the exact target revocation proof");
        } else if (purpose === "http-proof") {
          const raw = state.values[storageKey], session = raw ? parseProductSession(JSON.parse(raw)) : null;
          if (!session || subject.sessionBinding !== session.sessionBinding || subject.account !== session.account) fail("SESSION_INACTIVE", "Stored Product Session changed before signing");
        }
        return current;
      });
    }
    async function assertAPIActive(expected) {
      if (client.current !== expected) fail("SESSION_INACTIVE", "Product Session changed during API authorization");
      await stateOperation("readonly", ({ state }) => {
        if (readIntent(state) !== null || revocationAttempted || !revocationSessionMatches(state.values[storageKey] ?? null, expected.session)) fail("SESSION_INACTIVE", "Pending sign-out or a changed stored session blocks API authorization");
      });
    }
    async function createIntrospectionProof(requiredScopes) {
      validateScopes(requiredScopes, approvedScopes);
      const state = client.current;
      if (state.status !== "connected" || !state.session) fail("SESSION_INACTIVE", "Connect and verify a Product Session before signing an API proof");
      await assertAPIActive(state);
      const session = state.session;
      const now = typeof gateway.currentTime === "function"
        ? await gateway.currentTime({ requestId: `req_web_t_${randomToken()}` }) : clock();
      if (client.current !== state) fail("SESSION_INACTIVE", "Product Session changed while reading authority time");
      await assertAPIActive(state);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(session.expiresAt) <= now.getTime()) fail("SESSION_EXPIRED", "Product Session expired before API authorization");
      const body = canonicalJSON({ requiredScopes: [...requiredScopes] });
      const proof = await createProductSessionProofV2With(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(body), nonce: randomToken(), issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + 30_000, Date.parse(session.expiresAt))).toISOString() }, sign);
      if (client.current !== state) fail("SESSION_INACTIVE", "Product Session changed during API proof signing");
      await assertAPIActive(state);
      return Object.freeze({ proof, proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), requestId: `req_web_${randomToken()}`, body });
    }
  } catch (error) { close(); throw error; }
}

function assertRecord(device, state, namespace, allowedKeys) {
  if (!device || !state) fail("DEVICE_CHANGED", "Browser device or session storage is missing; automatic key replacement is forbidden");
  exactFields(device, ["version", "namespace", "deviceId", "deviceKey", "privateKey", "publicKey"], "Persisted browser device");
  exactFields(state, ["version", "deviceId", "deviceKey", "values"], "Persisted browser session state");
  if (device.version !== 1 || device.namespace !== namespace || !/^web_[A-Za-z0-9_-]{43}$/.test(device.deviceId) || !/^[A-Za-z0-9_-]{44}$/.test(device.deviceKey) || state.version !== 1 || state.deviceId !== device.deviceId || state.deviceKey !== device.deviceKey) fail("DEVICE_CHANGED", "Persisted browser device binding is invalid");
  for (const [key, type, usage] of [[device.privateKey, "private", "sign"], [device.publicKey, "public", "verify"]]) {
    if (!key || key.type !== type || key.algorithm?.name !== "ECDSA" || key.algorithm.namedCurve !== "P-256" || key.usages?.length !== 1 || key.usages[0] !== usage || (type === "private" && key.extractable !== false)) fail("INSECURE_STORAGE", "Persisted browser key must be a non-extractable P-256 signing key");
  }
  if (!state.values || typeof state.values !== "object" || Array.isArray(state.values) || Object.keys(state.values).some(key => !allowedKeys.has(key) || typeof state.values[key] !== "string" || state.values[key].length > 16_384)) fail("INVALID_SESSION_STORE", "Persisted browser session state crosses its storage binding");
}
async function publicDeviceKey(crypto, key) {
  let raw; try { raw = new Uint8Array(await crypto.subtle.exportKey("raw", key)); } catch { fail("INSECURE_STORAGE", "Browser device public key cannot be verified"); }
  if (raw.length !== 65 || raw[0] !== 4) fail("INVALID_DEVICE_KEY", "Browser P-256 public key encoding is invalid");
  return encodeBase64url(Uint8Array.of(2 | (raw[64] & 1), ...raw.slice(1, 33)));
}
async function verifyKeyPair(crypto, record) {
  if (await publicDeviceKey(crypto, record.publicKey) !== record.deviceKey) fail("DEVICE_CHANGED", "Persisted browser public key does not match its device binding");
  const payload = crypto.getRandomValues(new Uint8Array(32));
  try {
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, record.privateKey, payload);
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, record.publicKey, signature, payload)) fail("DEVICE_CHANGED", "Persisted browser private and public keys do not match");
  } catch (error) { if (error instanceof WalletAuthError) throw error; fail("INSECURE_STORAGE", "Persisted browser CryptoKey cannot sign after restoration"); }
}
function p1363ToDER(signature) {
  if (signature.length !== 64) fail("INVALID_DEVICE_PROOF", "Browser ECDSA signature must use P-256 IEEE P1363 encoding");
  const integer = bytes => { let start = 0; while (start < bytes.length - 1 && bytes[start] === 0) start++; const value = bytes.slice(start); return value[0] & 128 ? Uint8Array.of(0, ...value) : value; };
  const r = integer(signature.slice(0, 32)), s = integer(signature.slice(32));
  return Uint8Array.of(0x30, r.length + s.length + 4, 0x02, r.length, ...r, 0x02, s.length, ...s);
}
function validateScopes(scopes, allowed) {
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 8 || scopes.some(scope => typeof scope !== "string" || !allowed.includes(scope)) || new Set(scopes).size !== scopes.length || [...scopes].sort().join("\n") !== scopes.join("\n")) fail("SCOPE_WIDENING", "Browser Product Session scopes must be an exact sorted registered subset");
}
function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let settled = false, request;
    const rejected = () => { settled = true; reject(new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device storage is unavailable")); };
    try { request = indexedDB.open(DATABASE, 1); } catch { rejected(); return; }
    request.onupgradeneeded = () => { const db = request.result; for (const name of [DEVICE_STORE, STATE_STORE]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name); };
    request.onerror = rejected; request.onblocked = rejected;
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
  });
}
// No async work is performed inside IndexedDB transactions; resolve only after commit.
function transact(db, mode, namespace, operation) {
  return new Promise((resolve, reject) => {
    let transaction, result, caught;
    try {
      transaction = db.transaction([DEVICE_STORE, STATE_STORE], mode);
      const devices = transaction.objectStore(DEVICE_STORE), states = transaction.objectStore(STATE_STORE);
      const deviceRequest = devices.get(namespace), stateRequest = states.get(namespace);
      let received = 0;
      const ready = () => { if (++received !== 2) return; try { result = operation({ device: deviceRequest.result, state: stateRequest.result, devices, states }); } catch (error) { caught = error; transaction.abort(); } };
      deviceRequest.onsuccess = ready; stateRequest.onsuccess = ready;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(caught ?? new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device transaction failed"));
    } catch { reject(new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device transaction is unavailable")); }
  });
}
function fail(code, message) { throw new WalletAuthError(code, message); }
