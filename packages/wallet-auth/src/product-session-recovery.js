import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { httpBodyDigest } from "./session-proof.js";
import { createProductSessionProofV2, createProductSessionProofV2With } from "./product-session-proof-v2.js";
import { createProductSessionChallenge, createProductSessionRequest, parseProductSession, parseProductSessionChallenge, parseProductSessionChallengeCompletion, parseProductSessionRequest, signProductSessionChallenge, signProductSessionChallengeWith } from "./product-session-v2.js";
import { parseProductSessionRegistry, productPlatformBinding } from "./product-session-registry.js";
import { parseProductSessionReturnURL, prepareWalletOpen, walletConnectionChoices, WALLET_ROUTE_STATUS } from "./product-session-router.js";

export const PRODUCT_SESSION_CLIENT_STATE = Object.freeze({
  DISCONNECTED: "disconnected", CONNECTING: "connecting", CONNECTED: "connected", GUEST: "guest",
  NETWORK_UNAVAILABLE: "network-unavailable", RETRY_REQUIRED: "retry-required",
});

export class RecoverableProductSessionClient {
  #registry; #binding; #storage; #gateway; #device; #tokens; #clock; #state; #autoReconnectAttempted; #networkAvailable; #networkEpoch; #disconnectPromise; #returnOperation; #recoveryPromise; #intentEpoch; #guestOperation;
  constructor(config) {
    exactFields(config, ["registry", "productId", "platform", "storage", "gateway", "device", "tokenFactory", "clock"], "Recoverable Product Session client configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    this.#binding = productPlatformBinding(this.#registry, config.productId, config.platform);
    this.#storage = secureStorage(config.storage);
    this.#gateway = gateway(config.gateway);
    this.#device = device(config.device);
    this.#tokens = tokenFactory(config.tokenFactory);
    this.#clock = clock(config.clock);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "No authoritative Product Session is active");
    this.#autoReconnectAttempted = false;
    this.#networkAvailable = true;
    this.#networkEpoch = 0;
    this.#disconnectPromise = null;
    this.#returnOperation = null;
    this.#recoveryPromise = null;
    this.#intentEpoch = 0;
    this.#guestOperation = null;
  }

  get current() { return this.#state; }
  get storageKey() { return `ynx.product-session.v2:${this.#binding.productId}:${this.#binding.platform}:${this.#binding.applicationId}`; }
  get connectionBinding() { return Object.freeze({ productId: this.#binding.productId, platform: this.#binding.platform, applicationId: this.#binding.applicationId }); }

  async detectWalletEnvironment() {
    let walletInstalled, schemeRegistered;
    try { [walletInstalled, schemeRegistered] = await Promise.all([this.#gateway.walletInstalled(), this.#gateway.schemeRegistered()]); }
    catch (error) { if (error instanceof WalletAuthError) throw error; fail("WALLET_UNAVAILABLE", "Wallet availability detection failed closed"); }
    if (typeof walletInstalled !== "boolean" || typeof schemeRegistered !== "boolean") fail("INVALID_GATEWAY_RESPONSE", "Wallet availability detection returned invalid values");
    return Object.freeze({ walletInstalled, schemeRegistered });
  }
  async beginDetected(automatic = false) { return this.begin(await this.detectWalletEnvironment(), automatic); }
  async retryDetected() { return this.retry(await this.detectWalletEnvironment()); }

  async restore(networkAvailable = true) {
    return this.#recover(() => this.#restore(networkAvailable));
  }
  async #restore(networkAvailable) {
    this.#networkAvailable = Boolean(networkAvailable);
    if (!this.#networkAvailable) return this.#offline();
    if (await this.#storage.get(`${this.storageKey}:guest`) !== null) return this.#restoreGuestIntent();
    const restored = await this.#restoreStoredSession();
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    if (!this.#autoReconnectAttempted) {
      this.#autoReconnectAttempted = true;
      return this.beginDetected(true);
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Stored Product Session is invalid; explicit Retry is required", { actions: ["retry", "guest"] });
    return this.#state;
  }

  async begin(environment, automatic = false) {
    exactFields(environment, ["walletInstalled", "schemeRegistered"], "Product Session connection environment");
    if (!this.#networkAvailable) return this.#offline();
    await this.#settleGuestIntent();
    await this.#storage.remove(`${this.storageKey}:guest`);
    const networkEpoch = this.#networkEpoch;
    const now = this.#clock();
    const request = createProductSessionRequest(this.#registry, {
      productId: this.#binding.productId, platform: this.#binding.platform,
      deviceId: this.#device.id, deviceKey: this.#device.key, scopes: this.#device.scopes,
      purpose: this.#device.purpose, nonce: this.#tokens(), state: this.#tokens(),
    }, now);
    await this.#clearPending();
    if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
    await this.#storage.set(`${this.storageKey}:pending`, JSON.stringify(request));
    if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while protecting the Wallet request; explicit Retry is required");
    const route = prepareWalletOpen(this.#registry, request, { networkAvailable: true, walletInstalled: environment.walletInstalled, schemeRegistered: environment.schemeRegistered }, now);
    this.#state = route.status === WALLET_ROUTE_STATUS.READY
      ? state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, automatic ? "Controlled reconnect requires Wallet approval" : "Wallet approval is pending", { request, route, automatic })
      : state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, route.message, { request, route, automatic, actions: route.actions });
    return this.#state;
  }

  async handleReturn(url) {
    if (this.#returnOperation !== null) {
      if (this.#returnOperation.url !== url) fail("CONCURRENT_CALLBACK", "A different Wallet callback is already being verified");
      return this.#returnOperation.promise;
    }
    const operation = this.#handleReturn(url);
    this.#returnOperation = { url, promise: operation };
    try { return await operation; }
    finally { if (this.#returnOperation?.promise === operation) this.#returnOperation = null; }
  }
  async #handleReturn(url) {
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    const intentEpoch = this.#intentEpoch;
    const raw = await this.#storage.get(`${this.storageKey}:pending`);
    const cancelledBeforeParse = await this.#guestCancellation(intentEpoch);
    if (cancelledBeforeParse !== null) return cancelledBeforeParse;
    if (raw === null) { await this.#storage.remove(`${this.storageKey}:return`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "No pending Wallet request matches this callback", { actions: ["retry", "guest"] }); return this.#state; }
    let request;
    try { request = parseProductSessionRequest(this.#registry, JSON.parse(raw), this.#clock()); } catch { await this.#clearPending(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Pending Wallet request expired or is invalid", { actions: ["retry", "guest"] }); return this.#state; }
    const returned = parseProductSessionReturnURL(this.#registry, request, url, this.#clock());
    if (returned.status === WALLET_ROUTE_STATUS.USER_REJECTED) { await this.#clearPending(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "Wallet approval was rejected; no session was created", { actions: returned.actions }); return this.#state; }
    if (returned.status !== WALLET_ROUTE_STATUS.READY) { await this.#storage.remove(`${this.storageKey}:return`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, returned.message, { actions: returned.actions }); return this.#state; }
    await this.#storage.set(`${this.storageKey}:return`, url);
    const cancelledBeforeGateway = await this.#guestCancellation(intentEpoch);
    if (cancelledBeforeGateway !== null) return cancelledBeforeGateway;
    let issuedSession = null;
    try {
      const completionKey = `${this.storageKey}:completion`;
      const protectedCompletion = await this.#storage.get(completionKey);
      const storedCompletion = protectedCompletion === null ? null : JSON.parse(protectedCompletion);
      const challenge = storedCompletion === null
        ? parseProductSessionChallenge(await this.#gateway.challenge({ requestId: gatewayRequestId("c", request.nonce), request, approval: returned.approval }))
        : parseProductSessionChallenge(storedCompletion.challenge);
      const cancelledAfterChallenge = await this.#guestCancellation(intentEpoch);
      if (cancelledAfterChallenge !== null) return cancelledAfterChallenge;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while receiving the Gateway challenge; protected callback was retained for Retry");
      const expectedChallenge = createProductSessionChallenge(this.#registry, request, returned.approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
      if (canonicalJSON(challenge) !== canonicalJSON(expectedChallenge)) fail("SESSION_BINDING_MISMATCH", "Gateway challenge did not match the exact product request and Wallet approval");
      if (challenge.expiresAt <= this.#clock().toISOString()) fail("SESSION_EXPIRED", "Gateway challenge expired before product device signing");
      const completion = protectedCompletion === null
        ? (this.#device.sign ? await signProductSessionChallengeWith(challenge, this.#device.sign) : signProductSessionChallenge(challenge, this.#device.secret))
        : parseProductSessionChallengeCompletion(challenge, storedCompletion);
      const cancelledAfterSigning = await this.#guestCancellation(intentEpoch);
      if (cancelledAfterSigning !== null) return cancelledAfterSigning;
      if (protectedCompletion === null) await this.#storage.set(completionKey, JSON.stringify(completion));
      const cancelledAfterCompletionPersistence = await this.#guestCancellation(intentEpoch);
      if (cancelledAfterCompletionPersistence !== null) return cancelledAfterCompletionPersistence;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during platform challenge signing; protected callback was retained for Retry");
      const session = parseProductSession(await this.#gateway.complete({ requestId: gatewayRequestId("f", request.state), request, approval: returned.approval, completion }));
      issuedSession = session;
      const cancelledAfterCompletion = await this.#guestCancellation(intentEpoch, session);
      if (cancelledAfterCompletion !== null) return cancelledAfterCompletion;
      await this.#storage.set(this.storageKey, JSON.stringify(session));
      const cancelledAfterPersistence = await this.#guestCancellation(intentEpoch, session);
      if (cancelledAfterPersistence !== null) return cancelledAfterPersistence;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while protecting the issued Product Session; authoritative Retry is required");
      try {
        await this.#introspect(session);
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while confirming the issued Product Session; protected state was retained for Retry");
        throw error;
      }
      const cancelledAfterIntrospection = await this.#guestCancellation(intentEpoch, session);
      if (cancelledAfterIntrospection !== null) return cancelledAfterIntrospection;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while confirming the Product Session; authoritative Retry is required");
      await this.#clearPending();
      const cancelledAfterPendingClear = await this.#guestCancellation(intentEpoch, session);
      if (cancelledAfterPendingClear !== null) return cancelledAfterPendingClear;
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session connected", { session });
      return this.#state;
    } catch (error) {
      const cancelled = await this.#guestCancellation(intentEpoch, issuedSession);
      if (cancelled !== null) return cancelled;
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while completing Wallet approval; the protected callback was retained for Retry");
      await this.#storage.remove(this.storageKey); await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not issue or confirm a valid Product Session", { actions: ["retry", "guest"] });
      return this.#state;
    }
  }

  async retry(environment) {
    return this.#recover(() => this.#retry(environment));
  }
  async #retry(environment) {
    this.#networkAvailable = true;
    await this.#settleGuestIntent();
    await this.#storage.remove(`${this.storageKey}:guest`);
    const restored = await this.#restoreStoredSession();
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    this.#autoReconnectAttempted = false;
    return this.begin(environment, false);
  }
  connectionChoices(availability) { return walletConnectionChoices(this.#registry, this.#binding.productId, availability); }
  setNetworkAvailable(available) { this.#networkEpoch += 1; this.#networkAvailable = Boolean(available); if (!this.#networkAvailable) return this.#offline(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Network restored; authoritative re-introspection is required", { actions: ["retry"] }); return this.#state; }
  enterGuest() {
    this.#intentEpoch += 1;
    this.#state = guestState();
    const operation = this.#persistGuestIntent();
    this.#guestOperation = operation;
    operation.then(() => { if (this.#guestOperation === operation) this.#guestOperation = null; }, () => { if (this.#guestOperation === operation) this.#guestOperation = null; });
    return this.#state;
  }
  async disconnect() {
    if (this.#disconnectPromise !== null) return this.#disconnectPromise;
    const operation = this.#disconnect();
    this.#disconnectPromise = operation;
    try { return await operation; }
    finally { if (this.#disconnectPromise === operation) this.#disconnectPromise = null; }
  }
  async #disconnect() {
    const pendingRecovery = this.#recoveryPromise;
    if (pendingRecovery !== null) {
      try { await pendingRecovery; } catch { /* Disconnect still clears a failed recovery transaction. */ }
    }
    const pendingReturn = this.#returnOperation?.promise ?? null;
    if (pendingReturn !== null) {
      try { await pendingReturn; } catch { /* Disconnect still clears a rejected or invalid pending callback. */ }
    }
    let session = this.#state.status === PRODUCT_SESSION_CLIENT_STATE.CONNECTED ? this.#state.session : null;
    if (session === null) {
      const raw = await this.#storage.get(this.storageKey);
      if (raw !== null) {
        try { session = parseProductSession(JSON.parse(raw)); } catch { /* Invalid protected state grants no revocation authority. */ }
      }
    }
    if (session !== null && session.expiresAt > this.#clock().toISOString()) {
      try {
        const networkEpoch = this.#networkEpoch;
        if (!this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network unavailable before Product Session revocation");
        const body = {};
        const proof = await this.#proof(session, "/v2/product-sessions/revoke", body);
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network changed during Product Session revocation signing");
        const result = await this.#gateway.revoke({ requestId: gatewayRequestId("r", proof.nonce), sessionBinding: session.sessionBinding, proof });
        if (result?.revoked !== session.sessionBinding) fail("INVALID_GATEWAY_RESPONSE", "Gateway did not confirm the exact Product Session revocation");
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while revoking the Product Session; protected state was retained for Retry");
        if (!(error instanceof WalletAuthError) || error.code !== "SESSION_REVOKED") {
          this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not confirm Product Session revocation; protected state was retained", { actions: ["retry"] });
          return this.#state;
        }
      }
    }
    await this.#storage.remove(this.storageKey); await this.#storage.remove(`${this.storageKey}:guest`); await this.#clearPending();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, session === null ? "Product Session removed from secure storage" : "Authoritative Product Session revoked and removed from secure storage");
    return this.#state;
  }

  async #introspect(session) {
    const networkEpoch = this.#networkEpoch;
    if (!this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network unavailable before Product Session introspection");
    const body = { requiredScopes: session.scopes };
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body);
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network changed during Product Session introspection signing");
    const result = await this.#gateway.introspect({ requestId: gatewayRequestId("i", proof.nonce), sessionBinding: session.sessionBinding, requiredScopes: session.scopes, proof });
    if (result?.active !== true || canonicalJSON(parseProductSession(result.session)) !== canonicalJSON(session)) fail("SESSION_INACTIVE", "Gateway did not confirm the exact Product Session");
    return result;
  }
  async #proof(session, path, body) {
    const now = this.#clock();
    const expiresAt = new Date(Math.min(now.getTime() + 30_000, Date.parse(session.expiresAt))).toISOString();
    if (expiresAt <= now.toISOString()) fail("SESSION_EXPIRED", "Product Session expired before sender-constrained authorization");
    const input = {
      method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)),
      nonce: this.#tokens(), issuedAt: now.toISOString(), expiresAt,
    };
    return this.#device.sign
      ? createProductSessionProofV2With(session, input, this.#device.sign)
      : createProductSessionProofV2(session, input, this.#device.secret);
  }
  async #restoreStoredSession() {
    const raw = await this.#storage.get(this.storageKey);
    if (raw === null) return null;
    const networkEpoch = this.#networkEpoch;
    try {
      const session = parseProductSession(JSON.parse(raw));
      await this.#introspect(session);
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during Product Session re-introspection; protected state was retained for Retry");
      await this.#clearPending();
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while restoring the Product Session; protected state was retained for Retry");
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session restored", { session });
      return this.#state;
    } catch (error) {
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable during Product Session re-introspection; protected state was retained but is not authoritative");
      await this.#storage.remove(this.storageKey);
      return null;
    }
  }
  async #persistGuestIntent() {
    await this.#storage.set(`${this.storageKey}:guest`, "guest-v1");
    await this.#clearPending();
  }
  async #settleGuestIntent() {
    const operation = this.#guestOperation;
    if (operation !== null) try { await operation; } catch { /* A failed protected write cannot create authority. */ }
  }
  async #guestCancellation(intentEpoch, issuedSession = null) {
    if (intentEpoch === this.#intentEpoch) return null;
    await this.#settleGuestIntent();
    if (issuedSession !== null) {
      let revoked = false;
      try {
        const body = {};
        const proof = await this.#proof(issuedSession, "/v2/product-sessions/revoke", body);
        const result = await this.#gateway.revoke({ requestId: gatewayRequestId("r", proof.nonce), sessionBinding: issuedSession.sessionBinding, proof });
        if (result?.revoked !== issuedSession.sessionBinding) fail("INVALID_GATEWAY_RESPONSE", "Gateway did not confirm the exact Product Session revocation");
        revoked = true;
      } catch (error) {
        if (error instanceof WalletAuthError && error.code === "SESSION_REVOKED") revoked = true;
      }
      if (revoked) await this.#storage.remove(this.storageKey);
      else await this.#storage.set(this.storageKey, JSON.stringify(issuedSession));
    }
    await this.#clearPending();
    this.#state = guestState();
    return this.#state;
  }
  async #restoreGuestIntent() {
    const raw = await this.#storage.get(this.storageKey);
    if (raw !== null) {
      let session = null;
      try { session = parseProductSession(JSON.parse(raw)); } catch { await this.#storage.remove(this.storageKey); }
      if (session !== null) {
        const priorEpoch = this.#intentEpoch;
        this.#intentEpoch += 1;
        await this.#guestCancellation(priorEpoch, session);
      }
    }
    await this.#clearPending();
    this.#state = guestState();
    return this.#state;
  }
  async #clearPending() { await this.#storage.remove(`${this.storageKey}:pending`); await this.#storage.remove(`${this.storageKey}:return`); await this.#storage.remove(`${this.storageKey}:completion`); }
  async #recover(operation) {
    if (this.#recoveryPromise !== null) return this.#recoveryPromise;
    const pending = operation();
    this.#recoveryPromise = pending;
    try { return await pending; }
    finally { if (this.#recoveryPromise === pending) this.#recoveryPromise = null; }
  }
  #offline(message = "Network unavailable; cached Product Session is not treated as authoritative") { this.#state = state(PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE, message, { actions: ["retry", "guest"] }); return this.#state; }
  #networkTransition(message) { if (!this.#networkAvailable) return this.#offline(message); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] }); return this.#state; }
}

function state(status, message, extra = {}) { return Object.freeze({ status, message, ...extra, ...(extra.actions ? { actions: Object.freeze(extra.actions) } : {}), ...(extra.limitations ? { limitations: Object.freeze(extra.limitations) } : {}) }); }
function guestState() { return state(PRODUCT_SESSION_CLIENT_STATE.GUEST, "Guest / Try mode: not signed in; balances, transactions and Chain authority are unavailable", { limitations: ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"] }); }
function secureStorage(value) { if (!value || !["hardware-backed", "os-protected"].includes(value.securityLevel) || ["get", "set", "remove"].some((name) => typeof value[name] !== "function")) fail("INSECURE_STORAGE", "Product Sessions require injected OS-protected or hardware-backed storage"); return value; }
function gateway(value) { if (!value || ["challenge", "complete", "introspect", "revoke", "walletInstalled", "schemeRegistered"].some((name) => typeof value[name] !== "function")) fail("INVALID_GATEWAY", "Product Session client requires a real Gateway adapter"); return value; }
function device(value) {
  const fields = Object.keys(value ?? {}).sort().join("\n");
  const secretFields = ["id", "key", "secret", "scopes", "purpose"].sort().join("\n");
  const signerFields = ["id", "key", "sign", "scopes", "purpose"].sort().join("\n");
  if (fields !== secretFields && fields !== signerFields) fail("UNKNOWN_OR_MISSING_FIELD", "Product Session device configuration fields do not match the protocol schema");
  if (typeof value.id !== "string" || typeof value.key !== "string" || !Array.isArray(value.scopes) || typeof value.purpose !== "string" || (fields === secretFields ? typeof value.secret !== "string" : typeof value.sign !== "function")) fail("INVALID_DEVICE", "Product Session device configuration is invalid");
  return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) });
}
function tokenFactory(value) { if (typeof value !== "function") fail("INVALID_RANDOM_SOURCE", "Product Session client requires a cryptographic token factory"); return () => { const token = value(); if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) fail("INVALID_RANDOM_SOURCE", "Product Session token factory returned an invalid token"); return token; }; }
function clock(value) { if (typeof value !== "function") fail("INVALID_TIME", "Product Session client requires a clock"); return () => { const result = value(); if (!(result instanceof Date) || !Number.isFinite(result.getTime())) fail("INVALID_TIME", "Product Session clock returned invalid time"); return result; }; }
function isNetworkUnavailable(error) { return error instanceof WalletAuthError && error.code === "NETWORK_UNAVAILABLE"; }
function gatewayRequestId(kind, token) { return `req_ps_${kind}_${token}`; }
function fail(code, message) { throw new WalletAuthError(code, message); }
