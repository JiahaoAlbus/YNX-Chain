import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { httpBodyDigest } from "./session-proof.js";
import { createProductSessionProofV2, createProductSessionProofV2With } from "./product-session-proof-v2.js";
import { createProductSessionChallenge, createProductSessionRequest, parseProductSession, parseProductSessionChallenge, parseProductSessionRequest, signProductSessionChallenge, signProductSessionChallengeWith } from "./product-session-v2.js";
import { parseProductSessionRegistry, productPlatformBinding } from "./product-session-registry.js";
import { parseProductSessionReturnURL, prepareWalletAttempt, prepareWalletOpen, walletConnectionChoices, WALLET_ROUTE_STATUS } from "./product-session-router.js";
import { createRevocationIntent, parseRevocationIntent, revocationSessionMatches } from "./product-session-revocation-intent.js";
import { deriveCompletionTarget, parseCompletionRecord } from "./product-session-completion-record.js";

export const PRODUCT_SESSION_CLIENT_STATE = Object.freeze({
  DISCONNECTED: "disconnected", CONNECTING: "connecting", CONNECTED: "connected", GUEST: "guest", EXPIRED: "expired",
  NETWORK_UNAVAILABLE: "network-unavailable", RETRY_REQUIRED: "retry-required",
});

const REVOCATION_PENDING = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Product Session revocation is pending; API authorization is suspended", { actions: ["retry"] });

export class RecoverableProductSessionClient {
  #registry; #binding; #storage; #gateway; #device; #tokens; #clock; #state; #autoReconnectAttempted; #networkAvailable; #networkEpoch; #disconnectPromise; #returnOperation; #recoveryPromise;
  #revocationRequested = false; #revocationIntent = null;
  #beginEpoch = 0; #beginMutation = Promise.resolve();
  constructor(config) {
    exactFields(config, ["registry", "productId", "platform", "storage", "gateway", "device", "tokenFactory", "clock"], "Recoverable Product Session client configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    this.#binding = productPlatformBinding(this.#registry, config.productId, config.platform);
    this.#storage = secureStorage(config.storage, config.platform, config.device);
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
  }

  // Suspend outward authority as soon as disconnect starts, including while its
  // clock lookup or a prior recovery is pending. Keep protected state for Retry.
  get current() { return this.#disconnectPromise !== null || this.#revocationRequested && [PRODUCT_SESSION_CLIENT_STATE.CONNECTED, PRODUCT_SESSION_CLIENT_STATE.CONNECTING, PRODUCT_SESSION_CLIENT_STATE.GUEST].includes(this.#state.status) ? REVOCATION_PENDING : this.#state; }
  get storageKey() { return `ynx.product-session.v2:${this.#binding.productId}:${this.#binding.platform}:${this.#binding.applicationId}`; }
  get connectionBinding() { return Object.freeze({ productId: this.#binding.productId, platform: this.#binding.platform, applicationId: this.#binding.applicationId }); }

  async detectWalletEnvironment() {
    let walletInstalled, schemeRegistered;
    try { [walletInstalled, schemeRegistered] = await Promise.all([this.#gateway.walletInstalled(), this.#gateway.schemeRegistered()]); }
    catch (error) { if (error instanceof WalletAuthError) throw error; fail("WALLET_UNAVAILABLE", "Wallet availability detection failed closed"); }
    if (typeof walletInstalled !== "boolean" || typeof schemeRegistered !== "boolean") fail("INVALID_GATEWAY_RESPONSE", "Wallet availability detection returned invalid values");
    return Object.freeze({ walletInstalled, schemeRegistered });
  }
  async beginDetected(automatic = false) {
    const epoch = ++this.#beginEpoch;
    let environment;
    try { environment = await this.detectWalletEnvironment(); }
    catch (error) { if (epoch !== this.#beginEpoch) return this.current; throw error; }
    if (epoch !== this.#beginEpoch) return this.current;
    return this.#begin(environment, automatic, false, epoch);
  }
  async beginExplicit() { return this.#begin(null, false, true, ++this.#beginEpoch); }
  async retryDetected() {
    const epoch = ++this.#beginEpoch;
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) { this.#networkAvailable = true; return this.disconnect(); }
    let environment;
    try { environment = await this.detectWalletEnvironment(); }
    catch (error) { if (epoch !== this.#beginEpoch) return this.current; throw error; }
    if (epoch !== this.#beginEpoch) return this.current;
    return this.retry(environment);
  }

  async restore(networkAvailable = true) {
    const epoch = this.#beginEpoch;
    await this.#recover(() => this.#restore(networkAvailable, epoch));
    return this.current;
  }
  async #restore(networkAvailable, epoch) {
    this.#networkAvailable = Boolean(networkAvailable);
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const restored = await this.#restoreStoredSession(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    const pending = await this.#restorePendingRequest(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pending !== null) return pending;
    if (!this.#autoReconnectAttempted) {
      this.#autoReconnectAttempted = true;
      return this.beginDetected(true);
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Stored Product Session is invalid; explicit Retry is required", { actions: ["retry", "guest"] });
    return this.#state;
  }

  async begin(environment, automatic = false) {
    exactFields(environment, ["walletInstalled", "schemeRegistered"], "Product Session connection environment");
    return this.#begin(environment, automatic, false, ++this.#beginEpoch);
  }
  async #restorePendingRequest(epoch) {
    // A pending write whose ACK is late must settle before recovery decides
    // whether there is an original request to preserve.
    await this.#beginMutation;
    if (epoch !== this.#beginEpoch) return this.current;
    const key = `${this.storageKey}:pending`, raw = await this.#storage.get(key);
    if (epoch !== this.#beginEpoch) return this.current;
    if (raw === null) return null;
    if (this.#revocationRequested) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    const retained = message => {
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
      return this.#state;
    };
    let request;
    try {
      if (typeof raw !== "string" || raw.length > 16_384) fail("INVALID_SESSION_STORE", "Pending Wallet request exceeds policy");
      const input = JSON.parse(raw);
      // Validate historical shape before any time lookup. The second parse
      // below requires fresh authority time before offering the original URL.
      request = parseProductSessionRequest(this.#registry, input, new Date(input?.issuedAt));
      for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
        if (request[field] !== this.#binding[field]) fail("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another product binding");
      }
      if (request.deviceId !== this.#device.id || request.deviceKey !== this.#device.key || canonicalJSON(request.scopes) !== canonicalJSON(this.#device.scopes)) fail("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another device or scope selection");
    } catch {
      return retained("The saved Wallet request is invalid or belongs to another binding; it was retained. Start a new explicit request to replace it.");
    }
    let now;
    try {
      if (typeof this.#gateway.currentTime !== "function") fail("CLOCK_UNAVAILABLE", "Pending request recovery requires authority time");
      now = await this.#now();
    } catch {
      if (epoch !== this.#beginEpoch) return this.current;
      return this.#offline("Authority time is unavailable; the original Wallet request was retained for Retry");
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while checking the original Wallet request; it was retained for Retry");
    try { request = parseProductSessionRequest(this.#registry, request, now); }
    catch { return retained("The saved Wallet request expired or is invalid; it was retained. Start a new explicit request to replace it."); }
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    const readback = await this.#storage.get(key);
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading the original Wallet request; explicit Retry is required");
    if (readback !== raw) return retained("The saved Wallet request changed during recovery; no replacement request was created");
    const route = prepareWalletAttempt(this.#registry, request, now);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, "The original Wallet approval is still pending; explicitly open the same request", { request, route, automatic: false, installation: "unverified" });
    return this.#state;
  }
  async #begin(environment, automatic, explicit, epoch) {
    try { return await this.#beginRequest(environment, automatic, explicit, epoch); }
    catch (error) { if (epoch !== this.#beginEpoch) return this.current; throw error; }
  }
  async #beginRequest(environment, automatic, explicit, epoch) {
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    let now;
    try {
      if (explicit && typeof this.#gateway.currentTime !== "function") fail("CLOCK_UNAVAILABLE", "Explicit Wallet opening requires the authority-time adapter");
      now = await this.#now();
    }
    catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (isNetworkUnavailable(error) || explicit && !(error instanceof WalletAuthError)) return this.#offline("Authority time is unavailable; Retry before opening Wallet");
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading authority time; explicit Retry is required");
    const pendingRevocation = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingRevocation) return this.#pendingRevocation();
    const request = createProductSessionRequest(this.#registry, {
      productId: this.#binding.productId, platform: this.#binding.platform,
      deviceId: this.#device.id, deviceKey: this.#device.key, scopes: this.#device.scopes,
      purpose: this.#device.purpose, nonce: this.#tokens(), state: this.#tokens(),
    }, now);
    // Serialize the write phase, not time lookup: a newer attempt can supersede
    // a stalled clock, but must wait for an already-started storage mutation.
    const mutation = this.#beginMutation.then(async () => {
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
      const key = `${this.storageKey}:pending`, raw = canonicalJSON(request);
      let wrote = false;
      const cancelled = async () => {
        if (wrote && await this.#storage.get(key) === raw) await this.#storage.remove(key);
        return this.current;
      };
      try {
        for (const suffix of ["pending", "return", "completion"]) {
          if (epoch !== this.#beginEpoch) return cancelled();
          await this.#storage.remove(`${this.storageKey}:${suffix}`);
        }
        if (epoch !== this.#beginEpoch) return cancelled();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
        // Mark before awaiting: an adapter can commit a write and then reject.
        wrote = true;
        await this.#storage.set(key, raw);
        if (epoch !== this.#beginEpoch) return cancelled();
        const stored = await this.#storage.get(key);
        if (epoch !== this.#beginEpoch) return cancelled();
        if (stored !== raw) fail("INSECURE_STORAGE", "Pending Wallet request did not read back exactly");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while protecting the Wallet request; explicit Retry is required");
        const route = explicit ? prepareWalletAttempt(this.#registry, request, now)
          : prepareWalletOpen(this.#registry, request, { networkAvailable: true, walletInstalled: environment.walletInstalled, schemeRegistered: environment.schemeRegistered }, now);
        this.#state = route.status === WALLET_ROUTE_STATUS.READY
          ? state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, automatic ? "Controlled reconnect requires Wallet approval" : "Wallet approval is pending", { request, route, automatic, ...(explicit ? { installation: "unverified" } : {}) })
          : state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, route.message, { request, route, automatic, actions: route.actions });
        return this.#state;
      } catch (error) {
        if (epoch !== this.#beginEpoch) return cancelled();
        throw error;
      }
    });
    this.#beginMutation = mutation.catch(() => {});
    return mutation;
  }

  async handleReturn(url) {
    if (this.#returnOperation !== null) {
      if (this.#returnOperation.url !== url) fail("CONCURRENT_CALLBACK", "A different Wallet callback is already being verified");
      await this.#returnOperation.promise;
      return this.current;
    }
    const operation = this.#handleReturn(url);
    this.#returnOperation = { url, promise: operation };
    try { await operation; return this.current; }
    finally { if (this.#returnOperation?.promise === operation) this.#returnOperation = null; }
  }
  async #handleReturn(url) {
    if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
    if (!this.#networkAvailable) {
      if (typeof url === "string" && url.length <= 16_384 && await this.#storage.get(`${this.storageKey}:pending`) !== null) await this.#storage.set(`${this.storageKey}:return`, url);
      return this.#offline();
    }
    const networkEpoch = this.#networkEpoch;
    const raw = await this.#storage.get(`${this.storageKey}:pending`);
    if (raw === null) { await this.#storage.remove(`${this.storageKey}:return`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "No pending Wallet request matches this callback", { actions: ["retry", "guest"] }); return this.#state; }
    let now;
    try { now = await this.#now(); }
    catch (error) {
      if (isNetworkUnavailable(error)) {
        // Retain the bounded callback as pending data; Retry still verifies every
        // binding and signature before it can grant authority.
        if (typeof url === "string" && url.length <= 16_384) await this.#storage.set(`${this.storageKey}:return`, url);
        return this.#offline("Authority time is unavailable; the pending Wallet callback was retained for Retry");
      }
      throw error;
    }
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) {
      if (typeof url === "string" && url.length <= 16_384) await this.#storage.set(`${this.storageKey}:return`, url);
      return this.#networkTransition("Network changed while reading authority time; Wallet callback was retained for Retry");
    }
    let request;
    try { request = parseProductSessionRequest(this.#registry, JSON.parse(raw), now); } catch { await this.#clearPending(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Pending Wallet request expired or is invalid", { actions: ["retry", "guest"] }); return this.#state; }
    const returned = parseProductSessionReturnURL(this.#registry, request, url, now);
    if (returned.status === WALLET_ROUTE_STATUS.USER_REJECTED) { await this.#clearPending(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "Wallet approval was rejected; no session was created", { actions: returned.actions }); return this.#state; }
    if (returned.status !== WALLET_ROUTE_STATUS.READY) { await this.#storage.remove(`${this.storageKey}:return`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, returned.message, { actions: returned.actions }); return this.#state; }
    await this.#storage.set(`${this.storageKey}:return`, url);
    try {
      const storedCompletion = await this.#storage.get(`${this.storageKey}:completion`);
      let completion;
      if (storedCompletion !== null) {
        const record = parseCompletionRecord(this.#registry, storedCompletion, now);
        if (canonicalJSON(record.request) !== canonicalJSON(request) || canonicalJSON(record.approval) !== canonicalJSON(returned.approval) || record.completion.challenge.deviceId !== this.#device.id || record.completion.challenge.deviceKey !== this.#device.key) fail("SESSION_BINDING_MISMATCH", "Protected completion belongs to another exact Wallet approval");
        if (record.completion.challenge.sessionExpiresAt <= now.toISOString()) fail("SESSION_EXPIRED", "Previously completed Product Session has expired");
        // Reuse the original signed body. Never sign a now-expired challenge,
        // or change a WebCrypto signature under the same completion request ID.
        completion = record.completion;
      } else {
        const challenge = parseProductSessionChallenge(await this.#gateway.challenge({ requestId: gatewayRequestId("c", request.nonce), request, approval: returned.approval }));
        if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while receiving the Gateway challenge; protected callback was retained for Retry");
        const expectedChallenge = createProductSessionChallenge(this.#registry, request, returned.approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
        if (canonicalJSON(challenge) !== canonicalJSON(expectedChallenge)) fail("SESSION_BINDING_MISMATCH", "Gateway challenge did not match the exact product request and Wallet approval");
        if (challenge.expiresAt <= (await this.#now()).toISOString()) fail("SESSION_EXPIRED", "Gateway challenge expired before product device signing");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading challenge time; protected callback was retained for Retry");
        if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
        completion = this.#device.sign
          ? await signProductSessionChallengeWith(challenge, this.#device.sign)
          : signProductSessionChallenge(challenge, this.#device.secret);
        await this.#storage.set(`${this.storageKey}:completion`, canonicalJSON({ request, approval: returned.approval, completion }));
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during platform challenge signing; protected callback was retained for Retry");
      if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
      const session = parseProductSession(await this.#gateway.complete({ requestId: gatewayRequestId("f", request.state), request, approval: returned.approval, completion }));
      await this.#storage.set(this.storageKey, JSON.stringify(session));
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while protecting the issued Product Session; authoritative Retry is required");
      try {
        await this.#introspect(session);
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while confirming the issued Product Session; protected state was retained for Retry");
        throw error;
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while confirming the Product Session; authoritative Retry is required");
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session connected", { session });
      return this.#state;
    } catch (error) {
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while completing Wallet approval; the protected callback was retained for Retry");
      await this.#storage.remove(this.storageKey); await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not issue or confirm a valid Product Session", { actions: ["retry", "guest"] });
      return this.#state;
    }
  }

  async retry(environment) {
    const epoch = ++this.#beginEpoch;
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) { this.#networkAvailable = true; return this.disconnect(); }
    await this.#recover(() => this.#retry(environment, epoch));
    return this.current;
  }
  async #retry(environment, epoch) {
    this.#networkAvailable = true;
    const restored = await this.#restoreStoredSession(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    const pending = await this.#restorePendingRequest(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pending !== null) return pending;
    this.#autoReconnectAttempted = false;
    return this.begin(environment, false);
  }
  connectionChoices(availability) { return walletConnectionChoices(this.#registry, this.#binding.productId, availability); }
  setNetworkAvailable(available) { this.#networkEpoch += 1; this.#networkAvailable = Boolean(available); if (!this.#networkAvailable) return this.#offline(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Network restored; authoritative re-introspection is required", { actions: ["retry"] }); return this.#state; }
  enterGuest() { this.#beginEpoch += 1; if (this.#revocationRequested) return this.#pendingRevocation(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.GUEST, "Guest / Try mode: not signed in; balances, transactions and Chain authority are unavailable", { limitations: ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"] }); return this.#state; }
  async disconnect() {
    if (this.#disconnectPromise !== null) return this.#disconnectPromise;
    this.#beginEpoch += 1;
    this.#revocationRequested = true;
    const operation = this.#disconnect();
    this.#disconnectPromise = operation;
    try { return await operation; }
    finally { if (this.#disconnectPromise === operation) this.#disconnectPromise = null; }
  }
  async #disconnect() {
    // Persist the fixed target before clock lookup, signing, network I/O, or
    // waiting for earlier recovery. A reload must retain the user's sign-out.
    try { await this.#prepareRevocationIntent(); }
    catch { return this.#pendingRevocation("Sign-out could not be saved securely; authorization remains suspended. Retry to save the same target."); }
    await this.#beginMutation;
    const pendingRecovery = this.#recoveryPromise;
    if (pendingRecovery !== null) {
      try { await pendingRecovery; } catch { /* Disconnect still clears a failed recovery transaction. */ }
    }
    const pendingReturn = this.#returnOperation?.promise ?? null;
    if (pendingReturn !== null) {
      try { await pendingReturn; } catch { /* Disconnect still clears a rejected or invalid pending callback. */ }
    }
    await this.#loadRevocationIntent();
    let session = this.#revocationIntent.session;
    if (session === null) {
      const raw = await this.#storage.get(this.storageKey);
      if (raw !== null) {
        try { session = parseProductSession(JSON.parse(raw)); } catch { return this.#pendingRevocation("The pending sign-out target is unavailable; secure storage requires repair."); }
        await this.#saveRevocationIntent(createRevocationIntent(this.#binding, this.#device, this.#revocationIntent.intentId, session));
      }
    }
    let sessionExpired = false;
    if (session !== null) {
      try {
        const networkEpoch = this.#networkEpoch;
        if (!this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network unavailable before Product Session revocation");
        const now = await this.#now();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network changed while reading revocation authority time");
        // Only the authenticated authority-time adapter can establish expiry;
        // a custom/local clock must never resolve a pending logout by itself.
        sessionExpired = typeof this.#gateway.currentTime === "function" && session.expiresAt <= now.toISOString();
        if (!sessionExpired) {
          const body = {};
          const proof = await this.#proof(session, "/v2/product-sessions/revoke", body, now);
          if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network changed during Product Session revocation signing");
          const result = await this.#gateway.revoke({ requestId: gatewayRequestId("r", proof.nonce), sessionBinding: session.sessionBinding, proof });
          if (result?.revoked !== session.sessionBinding) fail("INVALID_GATEWAY_RESPONSE", "Gateway did not confirm the exact Product Session revocation");
        }
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while revoking the Product Session; protected state was retained for Retry");
        if (!(error instanceof WalletAuthError) || error.code !== "SESSION_REVOKED") {
          this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not confirm Product Session revocation; protected state was retained", { actions: ["retry"] });
          return this.#state;
        }
      }
    }
    if (session === null && await this.#storage.get(`${this.storageKey}:return`) !== null) return this.#pendingRevocation("A prior completion has not yielded its exact target; sign-out confirmation is still pending.");
    try { await this.#finishRevocationIntent(); }
    catch { return this.#pendingRevocation("The authority result was received but secure cleanup is pending; Retry the same sign-out target."); }
    this.#revocationRequested = false; this.#revocationIntent = null;
    this.#state = state(sessionExpired ? PRODUCT_SESSION_CLIENT_STATE.EXPIRED : PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, session === null ? "No authoritative Product Session was present; local connection request was removed" : sessionExpired ? "Auth confirmed that the exact Product Session expired; no revocation receipt was claimed" : "Auth confirmed revocation of the exact Product Session", { revocationConfirmed: session !== null && !sessionExpired, ...(session ? { sessionBinding: session.sessionBinding } : {}) });
    return this.#state;
  }

  async #introspect(session) {
    if (await this.#loadRevocationIntent()) fail("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    if (!this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network unavailable before Product Session introspection");
    const body = { requiredScopes: session.scopes };
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body);
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network changed during Product Session introspection signing");
    const result = await this.#gateway.introspect({ requestId: gatewayRequestId("i", proof.nonce), sessionBinding: session.sessionBinding, requiredScopes: session.scopes, proof });
    if (await this.#loadRevocationIntent()) fail("REVOCATION_PENDING", "Sign-out started during Product Session authorization");
    if (result?.active !== true || canonicalJSON(parseProductSession(result.session)) !== canonicalJSON(session)) fail("SESSION_INACTIVE", "Gateway did not confirm the exact Product Session");
    return result;
  }
  async #proof(session, path, body, authorityTime) {
    if (path !== "/v2/product-sessions/revoke" && await this.#loadRevocationIntent()) fail("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    const now = authorityTime ?? await this.#now();
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail("NETWORK_UNAVAILABLE", "Network changed while reading proof authority time");
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
  async #now() {
    const value = typeof this.#gateway.currentTime === "function"
      ? await this.#gateway.currentTime({ requestId: gatewayRequestId("t", this.#tokens()) })
      : this.#clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("CLOCK_UNAVAILABLE", "Product Session authority time is invalid");
    return value;
  }
  async #restoreStoredSession(epoch) {
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    const raw = await this.#storage.get(this.storageKey);
    if (epoch !== this.#beginEpoch) return this.current;
    if (raw === null) return null;
    const networkEpoch = this.#networkEpoch;
    try {
      const session = parseProductSession(JSON.parse(raw));
      await this.#introspect(session);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during Product Session re-introspection; protected state was retained for Retry");
      await this.#clearPending(epoch);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while restoring the Product Session; protected state was retained for Retry");
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session restored", { session });
      return this.#state;
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable during Product Session re-introspection; protected state was retained but is not authoritative");
      await this.#storage.remove(this.storageKey);
      return null;
    }
  }
  async #clearPending(epoch) {
    const mutation = this.#beginMutation.then(async () => {
      for (const suffix of ["pending", "return", "completion"]) {
        if (epoch !== undefined && epoch !== this.#beginEpoch) return;
        await this.#storage.remove(`${this.storageKey}:${suffix}`);
      }
    });
    this.#beginMutation = mutation.catch(() => {});
    return mutation;
  }
  async #loadRevocationIntent() {
    const raw = await this.#storage.get(`${this.storageKey}:revoke`);
    if (raw !== null) { this.#revocationRequested = true; this.#revocationIntent = parseRevocationIntent(raw, this.#binding, this.#device); }
    return this.#revocationRequested;
  }
  async #prepareRevocationIntent() {
    await this.#loadRevocationIntent();
    if (this.#revocationIntent !== null) {
      let intent = this.#revocationIntent;
      if (intent.session === null) {
        const completion = await this.#storage.get(`${this.storageKey}:completion`);
        if (completion !== null) intent = createRevocationIntent(this.#binding, this.#device, intent.intentId, deriveCompletionTarget(this.#registry, completion));
      }
      await this.#saveRevocationIntent(intent); return;
    }
    let session = this.#state.session ?? null;
    if (session === null) { const raw = await this.#storage.get(this.storageKey); if (raw !== null) session = parseProductSession(JSON.parse(raw)); }
    if (session === null) {
      const raw = await this.#storage.get(`${this.storageKey}:completion`);
      if (raw !== null) session = deriveCompletionTarget(this.#registry, raw);
    }
    const intent = createRevocationIntent(this.#binding, this.#device, this.#tokens(), session);
    // Retain the exact chosen target in memory even when the durable write fails.
    this.#revocationIntent = intent;
    await this.#saveRevocationIntent(intent);
  }
  async #saveRevocationIntent(intent) {
    const raw = canonicalJSON(intent), key = `${this.storageKey}:revoke`;
    if (typeof this.#storage.saveRevocationIntent === "function") {
      this.#revocationIntent = parseRevocationIntent(await this.#storage.saveRevocationIntent(key, raw), this.#binding, this.#device);
    } else {
      await this.#storage.set(key, raw);
      if (await this.#storage.get(key) !== raw) fail("INSECURE_STORAGE", "Pending sign-out intent did not read back exactly");
      this.#revocationIntent = intent;
    }
  }
  async #finishRevocationIntent() {
    const intent = this.#revocationIntent, key = `${this.storageKey}:revoke`, raw = canonicalJSON(intent);
    if (typeof this.#storage.finishRevocationIntent === "function") return this.#storage.finishRevocationIntent(key, raw);
    if (await this.#storage.get(key) !== raw) fail("REVOCATION_CHANGED", "Pending sign-out target changed during confirmation");
    if (revocationSessionMatches(await this.#storage.get(this.storageKey), intent.session)) await this.#storage.remove(this.storageKey);
    await this.#clearPending(); await this.#storage.remove(key);
  }
  #pendingRevocation(message = "Sign-out confirmation is pending; only explicit Retry may contact Auth. Product authorization is suspended.") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry"], revocationPending: true });
    return this.#state;
  }
  async #recover(operation) {
    if (this.#recoveryPromise !== null) return this.#recoveryPromise;
    const pending = operation();
    this.#recoveryPromise = pending;
    try { return await pending; }
    finally { if (this.#recoveryPromise === pending) this.#recoveryPromise = null; }
  }
  #offline(message = "Network unavailable; cached Product Session is not treated as authoritative") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE, message, { actions: this.#revocationRequested ? ["retry"] : ["retry", "guest"], ...(this.#revocationRequested ? { revocationPending: true } : {}) });
    return this.#state;
  }
  #networkTransition(message) { if (!this.#networkAvailable) return this.#offline(message); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] }); return this.#state; }
}

function state(status, message, extra = {}) { return Object.freeze({ status, message, ...extra, ...(extra.actions ? { actions: Object.freeze(extra.actions) } : {}), ...(extra.limitations ? { limitations: Object.freeze(extra.limitations) } : {}) }); }
function secureStorage(value, platform, device) {
  const nativeProtected = value && ["hardware-backed", "os-protected"].includes(value.securityLevel);
  const browserProtected = value?.securityLevel === "webcrypto-nonextractable" && platform === "web" && typeof device?.sign === "function" && !("secret" in device);
  if ((!nativeProtected && !browserProtected) || ["get", "set", "remove"].some((name) => typeof value[name] !== "function")) fail("INSECURE_STORAGE", "Product Sessions require OS/hardware protection or a Web-only non-extractable device signer");
  return value;
}
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
function isNetworkUnavailable(error) { return error instanceof WalletAuthError && ["NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE"].includes(error.code); }
function gatewayRequestId(kind, token) { return `req_ps_${kind}_${token}`; }
function fail(code, message) { throw new WalletAuthError(code, message); }
