import { DeveloperError, invariant } from "./errors.js";

export const DEVELOPER_WALLET_BINDING = Object.freeze({
  version: "1", chainId: "ynx_6423-1", requestingProduct: "developer",
  productClientId: "ynx-developer-v1", bundleId: "com.ynxweb4.developer.testnetpreview",
  callback: "ynxdeveloper://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "developer:deploy"]),
});

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const randomNonce = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export class LocalNonceLedger {
  constructor(storage = globalThis.localStorage, key = "ynx.developer.wallet-auth.nonces.v1") { this.storage = storage; this.key = key; }
  values() { try { const value = JSON.parse(this.storage?.getItem(this.key) || "[]"); return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-127) : []; } catch { return []; } }
  consume(nonce) { const values = this.values(); invariant(!values.includes(nonce), "wallet_replay_rejected", "Wallet authorization callback was already consumed."); this.storage?.setItem(this.key, JSON.stringify([...values, nonce].slice(-128))); }
}

export class DeveloperWalletSession {
  constructor({ transport = globalThis.ynxDesktopWallet, authorizationBuilder = globalThis.ynxWalletAuthorization?.encodeRequestDeepLink, authorizationCallbackParser = globalThis.ynxWalletAuthorization?.parseAuthorizationCallbackURL, ledger = new LocalNonceLedger(), clock = Date.now } = {}) {
    this.transport = transport; this.authorizationBuilder = authorizationBuilder; this.authorizationCallbackParser = authorizationCallbackParser; this.ledger = ledger; this.clock = clock; this.pending = null; this.approval = null; this.session = null; this.audit = [];
  }
  async open({ approved = false } = {}) {
    invariant(approved, "wallet_permission_required", "Opening YNX Wallet requires explicit approval.");
    invariant(this.transport && typeof this.transport.getProductDevicePublicKey === "function" && typeof this.transport.openAuthorization === "function", "wallet_native_transport_required", "This Web surface cannot receive the registered ynxdeveloper callback. Install or open the reviewed desktop Developer client and YNX Wallet.");
    invariant(typeof this.authorizationBuilder === "function", "wallet_canonical_builder_required", "This surface has no accepted Wallet authorization builder. Open the reviewed desktop Developer client.");
    const productDeviceKey = await this.transport.getProductDevicePublicKey(DEVELOPER_WALLET_BINDING.productClientId);
    invariant(/^[A-Za-z0-9_-]{44}$/.test(productDeviceKey), "wallet_device_key_invalid", "Developer did not expose a canonical compressed P-256 product-device key.");
    const issuedAt = new Date(this.clock()).toISOString();
    const request = Object.freeze({ ...DEVELOPER_WALLET_BINDING, nonce: randomNonce(), productDeviceAlgorithm: "p256-sha256", productDeviceKey, purpose: "Sign in to YNX Developer and review one exact Testnet deployment.", issuedAt, expiresAt: new Date(this.clock() + 5 * 60_000).toISOString() });
    const deepLink = this.authorizationBuilder(request);
    let parsed;
    try { parsed = new URL(deepLink); } catch { throw new DeveloperError("wallet_canonical_builder_invalid", "The Wallet authorization builder returned an invalid canonical request."); }
    invariant(parsed.protocol === "ynxwallet:" && parsed.hostname === "authorize" && parsed.pathname === "" && !parsed.hash && [...parsed.searchParams.keys()].join("\n") === "request" && /^[A-Za-z0-9_-]{80,8192}$/.test(parsed.searchParams.get("request") || ""), "wallet_canonical_builder_invalid", "The Wallet authorization builder returned an invalid canonical request.");
    this.pending = request;
    await this.transport.openAuthorization(deepLink);
    this.audit.push({ at: issuedAt, event: "wallet.authorization.opened", productClientId: request.productClientId, scopes: request.scopes });
    return Object.freeze({ status: "wallet-review-opened", deepLink, expiresAt: request.expiresAt });
  }
  acceptCallback(callbackURL) {
    invariant(this.pending, "wallet_request_missing", "No pending Wallet authorization request exists.");
    invariant(typeof this.authorizationCallbackParser === "function", "wallet_canonical_parser_required", "This surface has no accepted Wallet authorization callback parser. Open the reviewed desktop Developer client.");
    let approval;
    try { approval = this.authorizationCallbackParser(callbackURL, this.pending, new Date(this.clock())); }
    catch { throw new DeveloperError("wallet_callback_invalid", "Wallet callback failed canonical signature, binding, callback or expiry validation."); }
    this.ledger.consume(this.pending.nonce);
    this.approval = Object.freeze({ ...approval, grantedScopes: Object.freeze([...approval.grantedScopes]) });
    this.audit.push({ at: new Date(this.clock()).toISOString(), event: "wallet.approval.received", account: approval.account, scopes: approval.grantedScopes });
    this.pending = null;
    return Object.freeze({ status: "wallet-approved-gateway-required", account: approval.account, expiresAt: approval.expiresAt, scopes: approval.grantedScopes });
  }
  signOut() { if (this.approval || this.session) this.audit.push({ at: new Date(this.clock()).toISOString(), event: "wallet.local-state.cleared" }); this.pending = null; this.approval = null; this.session = null; }
}
