import { randomUUID } from "node:crypto";
import { WalletAuthError, createProductSessionReturnURL, parseProductSessionRequest, parseProductSessionWalletURL } from "@ynx-chain/wallet-auth";
import { PRODUCT_SESSION_REGISTRY, WALLET_AUTH_PROTOCOL_SOURCE } from "./wallet-auth-contract.mjs";

export const CALLBACK_PROTOCOL_SOURCE = Object.freeze({
  protocolCommit: WALLET_AUTH_PROTOCOL_SOURCE.sourceCommit,
  protocol: "product-session-v2",
  bundleIdentifier: "com.ynxweb4.wallet.macos",
  scheme: "ynxwallet",
  associatedDomainsAuthorized: false
});
export const CANONICAL_AUTHORIZATION_REVIEW_REQUIRED = "CANONICAL_AUTHORIZATION_REVIEW_REQUIRED";
export const CANONICAL_AUTHORIZATION_APPROVED = "CANONICAL_AUTHORIZATION_APPROVED";

function reject(code) {
  return Object.freeze({ acceptedForReview: false, code, callbackEmitted: false, authorityGranted: false });
}

export function evaluateWalletCallback(rawValue, { now = new Date() } = {}) {
  try {
    const request = parseProductSessionWalletURL(PRODUCT_SESSION_REGISTRY, rawValue, now);
    const product = PRODUCT_SESSION_REGISTRY.products.find(item => item.productId === request.productId);
    return Object.freeze({
      acceptedForReview: true, protocol: "product-session-v2", code: CANONICAL_AUTHORIZATION_REVIEW_REQUIRED,
      callbackEmitted: false, authorityGranted: false, request, displayName: product.displayName,
      origin: request.origin, callback: request.callback, scopes: request.scopes,
      purpose: request.purpose, expiresAt: request.expiresAt
    });
  } catch (error) {
    // Legacy v1 is deliberately not reinterpreted as a v2 authorization.
    return reject(error instanceof WalletAuthError ? error.code : "INVALID_AUTHORIZATION_REQUEST");
  }
}

// One immutable review at a time. A launch retry reuses the same signed result.
export class DesktopAuthorizationController {
  constructor({ authority, openExternal, clock = () => new Date(), requestId = randomUUID }) {
    this.authority = authority; this.openExternal = openExternal; this.clock = clock; this.requestId = requestId;
    this.pending = null; this.inFlight = false; this.prepared = null; this.generation = 0;
  }
  async receive(url) {
    if (!this.inFlight && this.pending && Date.parse(this.pending.expiresAt) <= this.clock().getTime()) this.invalidate();
    if (this.pending || this.inFlight) return reject("AUTHORIZATION_REQUEST_IN_PROGRESS");
    const review = evaluateWalletCallback(url, { now: this.clock() });
    if (!review.acceptedForReview) return review;
    const id = this.requestId();
    this.pending = Object.freeze({ ...review, id, account: null, ynxAccount: null, loadingAccount: true });
    try {
      const status = await this.authority.accountStatus();
      if (this.pending?.id !== id) return reject("ACCOUNT_CHANGED");
      this.pending = Object.freeze({ ...this.pending, account: status.account, ynxAccount: status.ynxAccount, loadingAccount: false });
      return this.pending;
    } catch (error) {
      this.pending = null;
      return reject(error?.data?.code ?? error?.code ?? "ACCOUNT_UNAVAILABLE");
    }
  }
  async refreshAccount() {
    if (this.inFlight) throw authError("AUTHORIZATION_ACTION_IN_PROGRESS");
    const review = this.pending;
    if (!review) return null;
    const status = await this.authority.accountStatus();
    if (this.pending?.id !== review.id) return null;
    if (review.account && review.account !== status.account) {
      this.invalidate();
      return reject("ACCOUNT_CHANGED");
    }
    this.pending = Object.freeze({ ...review, account: status.account, ynxAccount: status.ynxAccount, loadingAccount: false });
    return this.pending;
  }
  cancel() { const hadPending = Boolean(this.pending); this.generation++; this.pending = null; this.prepared = null; return hadPending; }
  invalidate() {
    if (this.inFlight) throw authError("AUTHORIZATION_ACTION_IN_PROGRESS");
    const hadPending = Boolean(this.pending);
    this.pending = null; this.prepared = null;
    return hadPending;
  }
  async act(input) {
    if (this.inFlight || this.pending?.loadingAccount) throw authError("AUTHORIZATION_ACTION_IN_PROGRESS");
    const review = this.pending;
    if (!review) throw authError("NO_PENDING_AUTHORIZATION_REQUEST");
    const action = typeof input === "string" ? input : input?.action;
    if (!["approve", "reject"].includes(action)) throw authError("INVALID_AUTHORIZATION_ACTION");
    if (typeof input !== "string" && (!input || Object.keys(input).sort().join(",") !== "account,action,id" || input.id !== review.id || input.account !== review.account)) throw authError("AUTHORIZATION_REVIEW_MISMATCH");
    if (this.prepared && this.prepared.action !== action) throw authError("AUTHORIZATION_RESULT_ALREADY_PREPARED");
    if (action === "approve" && !review.account) throw authError("ACCOUNT_NOT_CREATED");
    this.inFlight = true;
    const generation = this.generation;
    const assertCurrent = () => { if (generation !== this.generation || this.pending?.id !== review.id) throw authError("WALLET_OPERATION_CANCELLED"); };
    let stage = "CANONICAL_AUTHORIZATION_SIGN_FAILED";
    try {
      const now = this.clock();
      parseProductSessionRequest(PRODUCT_SESSION_REGISTRY, review.request, now);
      if (!this.prepared) {
        const callback = action === "approve"
          ? await this.authority.approveCanonicalAuthorization(review.request, now.toISOString(), review.account)
          : { callbackUrl: createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, review.request, { result: "rejected", reason: "user_rejected" }, now) };
        assertCurrent();
        this.prepared = Object.freeze({ action, callbackUrl: callback.callbackUrl });
      }
      stage = "CANONICAL_CALLBACK_LAUNCH_FAILED";
      assertCurrent();
      await this.openExternal(this.prepared.callbackUrl);
      // Opening the destination normally blurs and locks Wallet. A completed
      // external launch remains a launch, even when that invalidated the review.
      if (this.pending?.id === review.id) { this.pending = null; this.prepared = null; }
      return Object.freeze({
        acceptedForReview: true, requestId: review.id, action,
        code: action === "approve" ? CANONICAL_AUTHORIZATION_APPROVED : "USER_REJECTED",
        callbackEmitted: true, callbackReceivedProved: false,
        authorityGranted: action === "approve", productSessionCreated: false
      });
    } catch (error) {
      if (error?.code === "SESSION_EXPIRED") { this.pending = null; this.prepared = null; }
      throw Object.assign(error, { authorizationStage: stage });
    } finally { this.inFlight = false; }
  }
}

export function parseWalletConnectActivation(value, platform = process.platform) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "ynxwallet:" || url.hostname !== "wc") return null;
  const keys = [...url.searchParams.keys()];
  if (typeof value !== "string" || value.length > 12_000 || url.username || url.password || url.port || url.hash || (url.pathname !== "" && !(platform === "win32" && url.pathname === "/"))) throw authError("INVALID_WALLETCONNECT_URI");
  // A bare redirect foregrounds the wallet for an existing session request.
  if (keys.length === 0) return Object.freeze({ route: "walletconnect", uri: null });
  const uri = url.searchParams.get("uri");
  if (keys.length !== 1 || keys[0] !== "uri" || typeof uri !== "string" || !/^wc:[0-9a-f-]+@2\?/.test(uri) || uri.length > 8192) throw authError("INVALID_WALLETCONNECT_URI");
  return Object.freeze({ route: "walletconnect", uri });
}
function authError(code) { return Object.assign(new Error(code), { code }); }
