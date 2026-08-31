import { exactFields, WalletAuthError } from "./canonical.js";
import { CentralWalletSessionStore, parseCentralWalletStoreSnapshot } from "./lifecycle.js";
import { StrategyMandateStore, parseStrategyMandateStoreSnapshot } from "./mandate-lifecycle.js";
import { parseStrategyAction, parseStrategyMandate } from "./mandate.js";
import { centralProtocolEntry, parseCentralRegistryDocument } from "./registry.js";
import { productSessionProofDigest, verifyProductSessionProof } from "./session-proof.js";
import { parseAuthorizationRequest, verifyAuthorizationRejection } from "./protocol.js";

export const CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION = 2;

const SNAPSHOT_V1_FIELDS = ["schemaVersion", "registryVersion", "sessionStore", "consumedProductProofs"];
const SNAPSHOT_FIELDS = [...SNAPSHOT_V1_FIELDS, "mandateStore"];
const COMPLETE_FIELDS = ["authorizationRequest", "walletApproval", "gatewayCompletion"];
const REJECT_FIELDS = ["authorizationRequest", "walletRejection"];
const AUTH_FIELDS = ["proof", "requiredScopes"];
const PROOF_FIELDS = ["proof"];
const MANDATE_ACTIVATE_FIELDS = ["proof", "mandate"];
const MANDATE_ACTION_FIELDS = ["proof", "mandateId", "action"];
const MANDATE_TERMINAL_FIELDS = ["proof", "mandateId"];
const MANDATE_EXIT_FIELDS = ["proof", "mandateId", "reason"];
const REQUEST_FIELDS = ["method", "path", "bodyDigest"];

export class CanonicalWalletGatewayAdapter {
  #registry;
  #store;
  #proofs;
  #mandates;

  constructor(registryInput, snapshot) {
    this.#registry = parseCentralRegistryDocument(registryInput);
    const parsed = snapshot === undefined
      ? emptySnapshot(this.#registry.registryVersion)
      : parseGatewayAdapterSnapshot(snapshot, this.#registry.registryVersion);
    this.#store = new CentralWalletSessionStore(parsed.sessionStore);
    this.#proofs = [...parsed.consumedProductProofs];
    this.#mandates = new StrategyMandateStore(parsed.mandateStore);
  }

  complete(input, at = new Date()) {
    exactFields(input, COMPLETE_FIELDS, "Canonical Gateway completion input");
    const client = input.authorizationRequest?.productClientId;
    if (typeof client !== "string") fail("UNKNOWN_PRODUCT", "Canonical Gateway request has no product client");
    const registration = this.#registry.products.find(product => product.productClientId === client);
    if (!registration) fail("UNKNOWN_PRODUCT", "Canonical Gateway product client is not registered");
    const registryEntry = centralProtocolEntry(registration);
    return this.#store.complete({ registryEntry, ...input }, at);
  }

  rejectAuthorization(input, at = new Date()) {
    exactFields(input, REJECT_FIELDS, "Canonical Gateway authorization rejection input");
    const client = input.authorizationRequest?.productClientId;
    if (typeof client !== "string") fail("UNKNOWN_PRODUCT", "Canonical Gateway rejection has no product client");
    const registration = this.#registry.products.find(product => product.productClientId === client);
    if (!registration) fail("UNKNOWN_PRODUCT", "Canonical Gateway rejection product client is not registered");
    const entry = centralProtocolEntry(registration);
    const request = parseAuthorizationRequest(input.authorizationRequest, { now: at, registry: { [client]: entry } });
    verifyAuthorizationRejection(input.walletRejection, request, at);
    fail("AUTHORIZATION_REJECTED", "Wallet user rejected the authorization request");
  }

  introspect(input, request, at = new Date()) {
    exactFields(input, AUTH_FIELDS, "Canonical Gateway introspection input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), input.requiredScopes, at);
    this.#consume(authenticated.proof);
    return authenticated.result;
  }

  revokeSession(input, request, at = new Date()) {
    exactFields(input, PROOF_FIELDS, "Canonical Gateway session revoke input");
    const authenticated = this.#authenticateRevocationProof(input.proof, parseRequest(request), at);
    const revoked = this.#store.revokeSession(authenticated.session.sessionBinding, at);
    this.#consume(authenticated.proof);
    return revoked;
  }

  revokeApproval(input, request, at = new Date()) {
    exactFields(input, PROOF_FIELDS, "Canonical Gateway approval revoke input");
    const authenticated = this.#authenticateRevocationProof(input.proof, parseRequest(request), at);
    const revoked = this.#store.revokeApproval(authenticated.session.approvalDigest, at);
    this.#consume(authenticated.proof);
    return revoked;
  }

  revokeDevice(input, request, at = new Date()) {
    exactFields(input, PROOF_FIELDS, "Canonical Gateway device revoke input");
    const authenticated = this.#authenticateRevocationProof(input.proof, parseRequest(request), at);
    const revoked = this.#store.revokeDevice(authenticated.session.deviceBinding, at);
    this.#consume(authenticated.proof);
    return revoked;
  }

  sessionInventory(input, request, at = new Date()) {
    exactFields(input, PROOF_FIELDS, "Canonical Gateway session inventory input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["wallet:sessions"], at);
    this.#assertWalletControlSession(authenticated.session, "Session inventory");
    const inventory = this.#store.inventory(authenticated.session.account, at);
    this.#consume(authenticated.proof);
    return inventory;
  }

  logoutAllDevices(input, request, at = new Date()) {
    exactFields(input, PROOF_FIELDS, "Canonical Gateway all-device logout input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["wallet:sessions"], at);
    this.#assertWalletControlSession(authenticated.session, "All-device logout");
    const logout = this.#store.logoutAllDevices(authenticated.session.account, at);
    this.#consume(authenticated.proof);
    return logout;
  }

  activateMandate(input, request, at = new Date()) {
    exactFields(input, MANDATE_ACTIVATE_FIELDS, "Canonical Gateway mandate activation input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:create"], at);
    const mandate = parseStrategyMandate(input.mandate);
    assertSessionSubject(mandate, authenticated.session);
    const activated = this.#mandates.activate(mandate, at);
    this.#consume(authenticated.proof);
    return activated;
  }

  authorizeMandateAction(input, request, at = new Date()) {
    exactFields(input, MANDATE_ACTION_FIELDS, "Canonical Gateway mandate action input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:execute"], at);
    const action = parseStrategyAction(input.action);
    if (action.mandateId !== input.mandateId) fail("MANDATE_BINDING_MISMATCH", "Strategy action mandateId does not match the requested mandate");
    assertSessionSubject(action, authenticated.session);
    const authorized = this.#mandates.authorize(input.mandateId, action, at);
    this.#consume(authenticated.proof);
    return authorized;
  }

  mandateInventory(input, request, at = new Date()) {
    exactFields(input, PROOF_FIELDS, "Canonical Gateway mandate inventory input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:account"], at);
    const inventory = Object.freeze(this.#mandates.inventory(authenticated.session.account, at)
      .filter(item => item.mandate.productClientId === authenticated.session.productClientId));
    this.#consume(authenticated.proof);
    return inventory;
  }

  revokeMandate(input, request, at = new Date()) {
    return this.#terminateMandate(input, request, at, "revoke");
  }

  killMandate(input, request, at = new Date()) {
    return this.#terminateMandate(input, request, at, "kill");
  }

  emergencyExitMandate(input, request, at = new Date()) {
    exactFields(input, MANDATE_EXIT_FIELDS, "Canonical Gateway mandate emergency exit input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:revoke"], at);
    this.#assertMandateOwner(input.mandateId, authenticated.session, at);
    const exited = this.#mandates.emergencyExit(input.mandateId, input.reason, at);
    this.#consume(authenticated.proof);
    return exited;
  }

  snapshot() {
    return Object.freeze({
      schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
      registryVersion: this.#registry.registryVersion,
      sessionStore: this.#store.snapshot(),
      consumedProductProofs: Object.freeze([...this.#proofs]),
      mandateStore: this.#mandates.snapshot(),
    });
  }

  #terminateMandate(input, request, at, action) {
    exactFields(input, MANDATE_TERMINAL_FIELDS, `Canonical Gateway mandate ${action} input`);
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:revoke"], at);
    this.#assertMandateOwner(input.mandateId, authenticated.session, at);
    const terminated = action === "revoke" ? this.#mandates.revoke(input.mandateId, at) : this.#mandates.kill(input.mandateId, at);
    this.#consume(authenticated.proof);
    return terminated;
  }

  #assertMandateOwner(mandateId, session, at) {
    const item = this.#mandates.inventory(session.account, at).find(entry => entry.mandate.mandateId === mandateId);
    if (!item || item.mandate.productClientId !== session.productClientId || item.mandate.sessionBinding !== session.sessionBinding) {
      fail("MANDATE_BINDING_MISMATCH", "Strategy mandate is not owned by this Product Session");
    }
    return item;
  }

  #assertWalletControlSession(session, operation) {
    if (session.productClientId !== "ynx-wallet-v1" || session.bundleId !== "com.ynxweb4.wallet") {
      fail("WALLET_CONTROL_REQUIRED", `${operation} requires the canonical Wallet Product Session`);
    }
  }

  #authenticateRevocationProof(proofInput, request, at) {
    const session = this.#sessionForProof(proofInput);
    const proof = verifyProductSessionProof(proofInput, session, request, at);
    this.#assertUnused(proof);
    return Object.freeze({ proof, session });
  }

  #authenticateProof(proofInput, request, requiredScopes, at) {
    const session = this.#sessionForProof(proofInput);
    const proof = verifyProductSessionProof(proofInput, session, request, at);
    this.#assertUnused(proof);
    const result = this.#store.introspect(proof.sessionBinding, {
      productClientId: proof.productClientId,
      bundleId: proof.bundleId,
      productDeviceKey: proof.productDeviceKey,
      requiredScopes,
    }, at);
    return Object.freeze({ proof, session: result.session, result });
  }

  #sessionForProof(proofInput) {
    const session = this.#store.snapshot().sessions.find(item => item.sessionBinding === proofInput?.sessionBinding);
    if (!session) fail("SESSION_NOT_FOUND", "Canonical Gateway Product Session was not found");
    return session;
  }

  #assertUnused(proof) {
    if (this.#proofs.includes(productSessionProofDigest(proof))) fail("REPLAY", "Product Session HTTP proof was already consumed");
    if (this.#proofs.length >= 20000) fail("CAPACITY", "Product Session proof replay store reached its bound");
  }

  #consume(proof) {
    this.#proofs.push(productSessionProofDigest(proof));
    this.#proofs.sort();
  }
}

export function parseGatewayAdapterSnapshot(input, registryVersion) {
  const version = input?.schemaVersion;
  if (version === 1) {
    exactFields(input, SNAPSHOT_V1_FIELDS, "Canonical Gateway adapter snapshot v1");
    const common = parseCommonSnapshot(input, registryVersion);
    return Object.freeze({
      schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
      ...common,
      mandateStore: new StrategyMandateStore().snapshot(),
    });
  }
  exactFields(input, SNAPSHOT_FIELDS, "Canonical Gateway adapter snapshot");
  if (version !== CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION) fail("INVALID_STORE", "Canonical Gateway adapter snapshot schema is incompatible");
  return Object.freeze({
    schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
    ...parseCommonSnapshot(input, registryVersion),
    mandateStore: parseStrategyMandateStoreSnapshot(input.mandateStore),
  });
}

function parseCommonSnapshot(input, registryVersion) {
  const acceptedRegistryMigration = input.registryVersion === 1 && registryVersion === 2;
  if (input.registryVersion !== registryVersion && !acceptedRegistryMigration) fail("INVALID_STORE", "Canonical Gateway adapter registry version is incompatible");
  return {
    registryVersion,
    sessionStore: parseCentralWalletStoreSnapshot(input.sessionStore),
    consumedProductProofs: parseProofDigests(input.consumedProductProofs),
  };
}

function parseProofDigests(value) {
  if (!Array.isArray(value) || value.length > 20000 || value.some(item => typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) {
    fail("INVALID_STORE", "Consumed Product Session proofs must be bounded, unique and sorted");
  }
  return Object.freeze([...value]);
}

function emptySnapshot(registryVersion) {
  return {
    schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
    registryVersion,
    sessionStore: {
      schemaVersion: 1,
      consumedNonces: [],
      consumedRequestDigests: [],
      consumedChallenges: [],
      sessions: [],
      revokedSessionBindings: [],
      revokedApprovalDigests: [],
      revokedDeviceBindings: [],
      accountLogoutRecords: [],
      audit: [],
    },
    consumedProductProofs: [],
    mandateStore: new StrategyMandateStore().snapshot(),
  };
}

function assertSessionSubject(subject, session) {
  if (subject.account !== session.account || subject.productClientId !== session.productClientId || subject.sessionBinding !== session.sessionBinding) {
    fail("MANDATE_BINDING_MISMATCH", "Strategy subject does not match the authenticated Product Session");
  }
}

function parseRequest(input) {
  exactFields(input, REQUEST_FIELDS, "Canonical Gateway HTTP request context");
  return Object.freeze({ method: input.method, path: input.path, bodyDigest: input.bodyDigest });
}

function fail(code, message) {
  throw new WalletAuthError(code, message);
}
