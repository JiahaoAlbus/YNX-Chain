import { DeveloperError, invariant } from "./errors.js";

export const DEVELOPER_WALLET_BINDING = Object.freeze({
  version: "1", chainId: "ynx_6423-1", requestingProduct: "developer",
  productClientId: "ynx-developer-v1", bundleId: "com.ynxweb4.developer.testnetpreview",
  callback: "ynxdeveloper://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "developer:deploy"]),
});

const exact = (value, fields, label) => {
  invariant(value && typeof value === "object" && !Array.isArray(value), "wallet_invalid_response", `${label} must be an object.`);
  invariant(Object.keys(value).sort().join("\n") === [...fields].sort().join("\n"), "wallet_tamper_rejected", `${label} contains missing or unknown fields.`);
};
const canonicalJSON = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { invariant(Number.isSafeInteger(value), "wallet_invalid_number", "Wallet protocol numbers must be safe integers."); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  invariant(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "wallet_invalid_shape", "Wallet protocol value must be canonical JSON.");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
};
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decodeB64url = (value) => {
  invariant(typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1, "wallet_invalid_encoding", "Wallet callback encoding is invalid.");
  const normalized=value.replaceAll("-", "+").replaceAll("_", "/")+"=".repeat((4-value.length%4)%4);
  try { return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)); } catch { throw new DeveloperError("wallet_invalid_encoding", "Wallet callback encoding is invalid."); }
};
const randomNonce = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const encodeRequestDeepLink = (request) => `ynxwallet://authorize?request=${b64url(new TextEncoder().encode(canonicalJSON(request)))}`;

export class LocalNonceLedger {
  constructor(storage = globalThis.localStorage, key = "ynx.developer.wallet-auth.nonces.v1") { this.storage = storage; this.key = key; }
  values() { try { const value = JSON.parse(this.storage?.getItem(this.key) || "[]"); return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-127) : []; } catch { return []; } }
  consume(nonce) { const values = this.values(); invariant(!values.includes(nonce), "wallet_replay_rejected", "Wallet authorization callback was already consumed."); this.storage?.setItem(this.key, JSON.stringify([...values, nonce].slice(-128))); }
}

export class DeveloperWalletSession {
  constructor({ transport = globalThis.ynxDesktopWallet, ledger = new LocalNonceLedger(), clock = Date.now } = {}) {
    this.transport = transport; this.ledger = ledger; this.clock = clock; this.pending = null; this.approval = null; this.session = null; this.audit = [];
  }
  async open({ approved = false } = {}) {
    invariant(approved, "wallet_permission_required", "Opening YNX Wallet requires explicit approval.");
    invariant(this.transport && typeof this.transport.getProductDevicePublicKey === "function" && typeof this.transport.openAuthorization === "function", "wallet_native_transport_required", "This Web surface cannot receive the registered ynxdeveloper callback. Install or open the reviewed desktop Developer client and YNX Wallet.");
    const productDeviceKey = await this.transport.getProductDevicePublicKey(DEVELOPER_WALLET_BINDING.productClientId);
    invariant(/^[A-Za-z0-9_-]{44}$/.test(productDeviceKey), "wallet_device_key_invalid", "Developer did not expose a canonical compressed P-256 product-device key.");
    const issuedAt = new Date(this.clock()).toISOString();
    const request = Object.freeze({ ...DEVELOPER_WALLET_BINDING, nonce: randomNonce(), productDeviceAlgorithm: "p256-sha256", productDeviceKey, purpose: "Sign in to YNX Developer and review one exact Testnet deployment.", issuedAt, expiresAt: new Date(this.clock() + 5 * 60_000).toISOString() });
    const deepLink = encodeRequestDeepLink(request);
    this.pending = request;
    await this.transport.openAuthorization(deepLink);
    this.audit.push({ at: issuedAt, event: "wallet.authorization.opened", productClientId: request.productClientId, scopes: request.scopes });
    return Object.freeze({ status: "wallet-review-opened", deepLink, expiresAt: request.expiresAt });
  }
  acceptCallback(callbackURL) {
    invariant(this.pending, "wallet_request_missing", "No pending Wallet authorization request exists.");
    let parsed; try { parsed = new URL(callbackURL); } catch { throw new DeveloperError("wallet_callback_invalid", "Wallet callback URL is invalid."); }
    invariant(parsed.protocol === "ynxdeveloper:" && parsed.hostname === "wallet-auth" && parsed.pathname === "/callback" && !parsed.hash && [...parsed.searchParams.keys()].join("\n") === "response", "wallet_callback_invalid", "Wallet callback route or fields do not match the registered Developer callback.");
    let approval; try { approval = JSON.parse(new TextDecoder().decode(decodeB64url(parsed.searchParams.get("response")))); } catch (error) { if (error instanceof DeveloperError) throw error; throw new DeveloperError("wallet_callback_invalid", "Wallet callback response is not valid JSON."); }
    this.#verifyApproval(approval, this.pending);
    this.ledger.consume(this.pending.nonce);
    this.approval = Object.freeze({ ...approval, grantedScopes: Object.freeze([...approval.grantedScopes]) });
    this.audit.push({ at: new Date(this.clock()).toISOString(), event: "wallet.approval.received", account: approval.account, scopes: approval.grantedScopes });
    this.pending = null;
    return Object.freeze({ status: "wallet-approved-gateway-required", account: approval.account, expiresAt: approval.expiresAt, scopes: approval.grantedScopes });
  }
  signOut() { if (this.approval || this.session) this.audit.push({ at: new Date(this.clock()).toISOString(), event: "wallet.local-state.cleared" }); this.pending = null; this.approval = null; this.session = null; }
  #verifyApproval(value, request) {
    const fields = ["version","requestDigest","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","account","accountPublicKey","grantedScopes","purpose","issuedAt","expiresAt","walletSignature"];
    exact(value, fields, "Wallet approval");
    for (const key of ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"]) invariant(value[key] === request[key], "wallet_tamper_rejected", `Wallet approval ${key} does not match the request.`);
    invariant(Array.isArray(value.grantedScopes) && value.grantedScopes.join("\n") === request.scopes.join("\n"), "wallet_scope_tamper", "Wallet approval scopes do not exactly match the request.");
    invariant(/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value.account) && /^(02|03)[0-9a-f]{64}$/.test(value.accountPublicKey) && /^[0-9a-f]{128}$/.test(value.walletSignature), "wallet_invalid_approval", "Wallet approval account, public key, or signature is invalid.");
    invariant(value.expiresAt <= request.expiresAt && value.expiresAt > new Date(this.clock()).toISOString(), "wallet_approval_expired", "Wallet approval is expired or exceeds the request lifetime.");
  }
}
