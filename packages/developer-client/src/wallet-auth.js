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
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const randomNonce = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

export class LocalNonceLedger {
  constructor(storage = globalThis.localStorage, key = "ynx.developer.wallet-auth.nonces.v1") { this.storage = storage; this.key = key; }
  values() { try { const value = JSON.parse(this.storage?.getItem(this.key) || "[]"); return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-127) : []; } catch { return []; } }
  consume(nonce) { const values = this.values(); invariant(!values.includes(nonce), "wallet_replay_rejected", "Wallet authorization callback was already consumed."); this.storage?.setItem(this.key, JSON.stringify([...values, nonce].slice(-128))); }
}

export class DeveloperWalletSession {
  constructor({ wallet = globalThis.ynxWallet, gatewayURL = "/app", fetcher = fetch, ledger = new LocalNonceLedger(), clock = Date.now } = {}) {
    this.wallet = wallet; this.gatewayURL = gatewayURL.replace(/\/$/, ""); this.fetcher = fetcher; this.ledger = ledger; this.clock = clock; this.session = null; this.audit = [];
  }
  async signIn({ approved = false } = {}) {
    invariant(approved, "wallet_permission_required", "Sign in with YNX Wallet requires explicit approval.");
    invariant(this.wallet && typeof this.wallet.getProductDevicePublicKey === "function" && typeof this.wallet.authorize === "function" && typeof this.wallet.signProductChallenge === "function", "wallet_unavailable", "YNX Wallet-only provider is unavailable.");
    const issuedAt = new Date(this.clock()).toISOString(); const nonce = randomNonce();
    const productDeviceKey = await this.wallet.getProductDevicePublicKey(DEVELOPER_WALLET_BINDING.productClientId);
    invariant(/^[A-Za-z0-9_-]{44}$/.test(productDeviceKey), "wallet_device_key_invalid", "Wallet provider did not expose a canonical compressed P-256 product device key.");
    const request = Object.freeze({ ...DEVELOPER_WALLET_BINDING, nonce, productDeviceAlgorithm: "p256-sha256", productDeviceKey, purpose: "Sign in to YNX Developer and review testnet deployments.", issuedAt, expiresAt: new Date(this.clock() + 5 * 60_000).toISOString() });
    const approval = await this.wallet.authorize(request);
    this.#verifyApproval(approval, request); this.ledger.consume(nonce);
    const challengeResponse = await this.fetcher(`${this.gatewayURL}/wallet-auth/challenges`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 1, request, approval }) });
    if (!challengeResponse.ok) throw new DeveloperError("wallet_gateway_unavailable", `Central Wallet Gateway challenge is unavailable (HTTP ${challengeResponse.status}). Retry later; no session was created.`);
    const challenge = await challengeResponse.json();
    const completion = await this.wallet.signProductChallenge(challenge);
    const completeResponse = await this.fetcher(`${this.gatewayURL}/wallet-auth/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 1, request, approval, completion }) });
    if (!completeResponse.ok) throw new DeveloperError("wallet_gateway_rejected", `Central Wallet Gateway rejected the device-bound completion (HTTP ${completeResponse.status}).`);
    const session = await completeResponse.json();
    exact(session, ["account", "expiresAt", "productClientId", "sessionToken", "scopes"], "Wallet session");
    invariant(session.productClientId === DEVELOPER_WALLET_BINDING.productClientId && session.account === approval.account && session.expiresAt <= approval.expiresAt, "wallet_session_tamper", "Wallet session binding does not match the approved request.");
    this.session = Object.freeze({ ...session }); this.audit.push({ at: new Date(this.clock()).toISOString(), event: "wallet.session.created", account: session.account, scopes: session.scopes });
    return this.session;
  }
  signOut() { if (this.session) this.audit.push({ at: new Date(this.clock()).toISOString(), event: "wallet.session.cleared", account: this.session.account }); this.session = null; }
  #verifyApproval(value, request) {
    const fields = ["version","requestDigest","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","account","accountPublicKey","grantedScopes","purpose","issuedAt","expiresAt","walletSignature"];
    exact(value, fields, "Wallet approval");
    for (const key of ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"]) invariant(value[key] === request[key], "wallet_tamper_rejected", `Wallet approval ${key} does not match the request.`);
    invariant(Array.isArray(value.grantedScopes) && value.grantedScopes.join("\n") === request.scopes.join("\n"), "wallet_scope_tamper", "Wallet approval scopes do not exactly match the request.");
    invariant(/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value.account) && /^[0-9a-f]{128}$/.test(value.walletSignature), "wallet_invalid_approval", "Wallet approval account or signature is invalid.");
    invariant(value.expiresAt <= request.expiresAt && value.expiresAt > new Date(this.clock()).toISOString(), "wallet_approval_expired", "Wallet approval is expired or exceeds the request lifetime.");
  }
}
