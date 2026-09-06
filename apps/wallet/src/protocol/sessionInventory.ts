import {
  canonicalJSON, createWalletSessionControlProof, encodeWalletSessionControlProofHeader, httpBodyDigest, walletIdentity,
  WALLET_SESSION_CONTROL_AUDIENCE, WALLET_SESSION_CONTROL_PROOF_HEADER,
  type WalletControlledSession, type WalletSessionControlInventory, type WalletSessionControlPath,
  type WalletSessionControlProof, type WalletSessionControlRevocation,
} from "@ynx-chain/wallet-auth";
import type { WalletOperationLease } from "../security/operationLifecycle";
import type { WalletAccount } from "../storage/walletRepository";

export type WalletSessionInventory = WalletSessionControlInventory;
export type SessionInventoryItem = WalletControlledSession;
export type WalletSessionAuthorization = "wallet-sessions-view" | "wallet-session-revoke";
export type WalletSessionControlDependencies = Readonly<{
  fetch: typeof fetch;
  randomBytes: (length: number) => Promise<Uint8Array>;
  authorize: (purpose: WalletSessionAuthorization) => Promise<void>;
  accountSecret: (account: string, assertCurrent: () => void) => Promise<string>;
  timeoutMs?: number;
}>;

const INVENTORY_PATH = "/v2/product-sessions/wallet/sessions";
const REVOKE_PATH = "/v2/product-sessions/wallet/sessions/revoke";
const MAX_RESPONSE_BYTES = 1_048_576;
const INACTIVE_REASONS = new Set(["session-revoked", "device-revoked", "account-revoked", "expired", "issued-in-future"]);

export class WalletSessionRevocationUnknown extends Error {
  readonly code = "REVOCATION_UNKNOWN";
  constructor(readonly sessionBinding: string) {
    super("Auth has not confirmed the outcome. This session may still be connected. Retry this same session to confirm its revocation.");
  }
}

/** Called only after the user reviews the displayed account and, for revoke, exact session. */
export class WalletSessionInventoryClient {
  readonly #dependencies: WalletSessionControlDependencies;
  readonly #timeoutMs: number;
  constructor(dependencies: WalletSessionControlDependencies) {
    for (const field of ["fetch", "randomBytes", "authorize", "accountSecret"] as const) if (typeof dependencies?.[field] !== "function") throw new Error("Wallet session control dependencies are unavailable");
    this.#timeoutMs = dependencies.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 30_000) throw new Error("Wallet session control timeout is invalid");
    this.#dependencies = dependencies;
  }

  async load(account: WalletAccount, lease: WalletOperationLease): Promise<WalletSessionInventory> {
    const request = await this.#prepare(account, INVENTORY_PATH, {}, "wallet-sessions-view", lease);
    const result = await lease.step(() => this.#request(request.requestId, INVENTORY_PATH, request.body, request.proof));
    return parseInventory(result, account.account, request.proof);
  }

  async revoke(account: WalletAccount, sessionBinding: string, lease: WalletOperationLease): Promise<WalletSessionControlRevocation> {
    if (!digest(sessionBinding)) throw new Error("The reviewed session binding is invalid");
    const request = await this.#prepare(account, REVOKE_PATH, { sessionBinding }, "wallet-session-revoke", lease);
    // After submission, only an exact, fresh receipt can establish success. A new
    // biometric action and nonce can safely retry the same target after a lost reply.
    lease.assert();
    try {
      const result = await lease.step(() => this.#request(request.requestId, REVOKE_PATH, request.body, request.proof));
      return parseRevocation(result, account.account, sessionBinding, request.proof);
    } catch {
      lease.assert();
      throw new WalletSessionRevocationUnknown(sessionBinding);
    }
  }

  async #prepare(account: WalletAccount, path: WalletSessionControlPath, value: Readonly<Record<string, unknown>>, purpose: WalletSessionAuthorization, lease: WalletOperationLease) {
    if (lease.account !== account.account || !accountAddress(account.account)) throw new Error("The reviewed Wallet account does not match this operation");
    const reviewed = Object.freeze({ account: account.account, accountPublicKey: account.accountPublicKey });
    const body = canonicalJSON(value);
    await lease.step(() => this.#dependencies.authorize(purpose));
    const timeId = `req_${await lease.step(() => this.#randomToken())}`;
    // Fail before unlocking key storage when Auth is unavailable. This clock is
    // only a preflight: OS decryption/migration prompts may take over 30 seconds.
    await this.#authoritativeTime(timeId, lease);
    const nonce = await lease.step(() => this.#randomToken());
    const freshTimeId = `req_${await lease.step(() => this.#randomToken())}`;
    const proof = await lease.withSecret(() => this.#dependencies.accountSecret(reviewed.account, lease.assert), async (secret) => {
      lease.assert();
      const identity = walletIdentity(secret);
      if (identity.account !== reviewed.account || identity.accountPublicKey !== reviewed.accountPublicKey) throw new Error("The signing account changed after review");
      const issuedAt = await this.#authoritativeTime(freshTimeId, lease);
      lease.assert();
      return createWalletSessionControlProof({ accountSecret: secret, method: "POST", path, bodyDigest: httpBodyDigest(body), nonce, issuedAt, expiresAt: new Date(Date.parse(issuedAt) + 30_000).toISOString() });
    });
    return { body, proof, requestId: `req_${nonce}` };
  }

  async #authoritativeTime(requestId: string, lease: WalletOperationLease): Promise<string> {
    const result = exactObject(await lease.step(() => this.#request(requestId, "/v2/product-sessions/time", null, null)), ["serverTime"], "Auth time");
    return canonicalTime(result.serverTime, "Auth time");
  }

  async #randomToken(): Promise<string> {
    const bytes = await this.#dependencies.randomBytes(32);
    try {
      if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("Secure Wallet randomness is unavailable");
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } finally { bytes?.fill(0); }
  }

  async #request(requestId: string, path: string, body: string | null, proof: WalletSessionControlProof | null): Promise<unknown> {
    const url = `${WALLET_SESSION_CONTROL_AUDIENCE}${path}`;
    const headers: Record<string, string> = { accept: "application/json", "x-request-id": requestId };
    if (body !== null) headers["content-type"] = "application/json";
    if (proof !== null) headers[WALLET_SESSION_CONTROL_PROOF_HEADER] = encodeWalletSessionControlProofHeader(proof);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Auth timed out. Review and retry when it is available.")); }, this.#timeoutMs);
    });
    const read = async () => {
      let response: Response;
      try {
        response = await this.#dependencies.fetch(url, { method: body === null ? "GET" : "POST", headers, body: body ?? undefined, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
      } catch { throw new Error("Auth is unavailable. Check your connection and retry."); }
      if (!response || !Number.isInteger(response.status) || !response.headers || typeof response.headers.get !== "function" || typeof response.text !== "function" || response.redirected || response.url && response.url !== url) throw new Error("Auth returned an invalid response");
      const contentLength = response.headers.get("content-length");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "") || response.headers.get("x-request-id") !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(response.headers.get("cache-control") ?? "") || contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) throw new Error("Auth response verification failed");
      let text: string;
      try { text = await response.text(); } catch { throw new Error("The Auth response was interrupted. Retry to obtain a confirmed result."); }
      if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new Error("Auth response is too large");
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { throw new Error("Auth returned an unreadable response"); }
      if (canonicalJSON(payload) !== text) throw new Error("Auth response is not canonical");
      if (response.status === 200) {
        const envelope = exactObject(payload, ["ok", "requestId", "result", "schemaVersion"], "Auth response");
        if (envelope.ok !== true || envelope.schemaVersion !== 2 || envelope.requestId !== requestId) throw new Error("Auth response binding is invalid");
        return envelope.result;
      }
      const envelope = exactObject(payload, ["error", "ok", "requestId", "schemaVersion"], "Auth rejection");
      const error = exactObject(envelope.error, ["code", "message"], "Auth rejection");
      if (envelope.ok !== false || envelope.schemaVersion !== 2 || envelope.requestId !== requestId || typeof error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(error.code) || typeof error.message !== "string" || error.message.length > 300) throw new Error("Auth rejection binding is invalid");
      throw new Error(`Auth could not complete the request (${error.code}). Review and retry.`);
    };
    try { return await Promise.race([read(), timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }
}

function parseInventory(value: unknown, account: string, proof: WalletSessionControlProof): WalletSessionInventory {
  const result = exactObject(value, ["account", "asOf", "sessions"], "Wallet sessions");
  if (result.account !== account) throw new Error("Auth inventory account does not match the selected Wallet");
  const asOf = responseTime(result.asOf, proof);
  const sessions = array(result.sessions, "Wallet sessions", 10_000).map((item) => parseSession(item, asOf));
  unique(sessions.map((item) => item.sessionBinding), "sessions");
  return Object.freeze({ account, asOf, sessions: Object.freeze(sessions) });
}

function parseSession(value: unknown, asOf: string): SessionInventoryItem {
  const item = exactObject(value, ["sessionBinding", "productId", "clientId", "displayName", "platform", "applicationId", "origin", "callback", "deviceId", "deviceBinding", "scopes", "issuedAt", "expiresAt", "active", "inactiveReasons"], "Wallet session");
  if (!digest(item.sessionBinding) || !digest(item.deviceBinding) || typeof item.active !== "boolean") throw new Error("Wallet session identity is invalid");
  const issuedAt = canonicalTime(item.issuedAt, "Session issue time"), expiresAt = canonicalTime(item.expiresAt, "Session expiry");
  if (expiresAt <= issuedAt) throw new Error("Wallet session expiry is invalid");
  const inactiveReasons = textArray(item.inactiveReasons, "Inactive reasons");
  if (inactiveReasons.some((reason) => !INACTIVE_REASONS.has(reason)) || item.active !== (inactiveReasons.length === 0) || inactiveReasons.includes("expired") !== (expiresAt <= asOf) || inactiveReasons.includes("issued-in-future") !== (issuedAt > asOf)) throw new Error("Wallet session status is inconsistent");
  const scopes = textArray(item.scopes, "Session permissions");
  if (scopes.length === 0) throw new Error("Wallet session permissions are missing");
  return Object.freeze({ sessionBinding: item.sessionBinding, deviceBinding: item.deviceBinding, active: item.active, issuedAt, expiresAt, inactiveReasons, scopes,
    productId: text(item.productId), clientId: text(item.clientId), displayName: text(item.displayName), platform: text(item.platform), applicationId: text(item.applicationId), origin: text(item.origin, 512), callback: text(item.callback, 512), deviceId: text(item.deviceId) });
}

function parseRevocation(value: unknown, account: string, sessionBinding: string, proof: WalletSessionControlProof): WalletSessionControlRevocation {
  const result = exactObject(value, ["account", "sessionBinding", "revoked", "alreadyRevoked", "asOf"], "Session revocation receipt");
  if (result.account !== account || result.sessionBinding !== sessionBinding || result.revoked !== true || typeof result.alreadyRevoked !== "boolean") throw new Error("The revocation receipt does not match the reviewed account and session");
  return Object.freeze({ account, sessionBinding, revoked: true, alreadyRevoked: result.alreadyRevoked, asOf: responseTime(result.asOf, proof) });
}

function responseTime(value: unknown, proof: WalletSessionControlProof): string {
  const at = canonicalTime(value, "Auth response time");
  // Compare authority instants only. Device time cannot substitute for Auth time.
  if (at < proof.issuedAt || at >= proof.expiresAt) throw new Error("Auth response is stale or outside this proof's validity");
  return at;
}
function canonicalTime(value: unknown, label: string): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} is invalid`); return value; }
function exactObject(value: unknown, fields: readonly string[], label: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n")) throw new Error(`${label} fields are invalid`); return value as Record<string, unknown>; }
function array(value: unknown, label: string, limit = 100): unknown[] { if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} is invalid`); return value; }
function text(value: unknown, limit = 500): string { if (typeof value !== "string" || value.length === 0 || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Wallet session text is invalid"); return value; }
function textArray(value: unknown, label: string): readonly string[] { const values = array(value, label).map((item) => text(item)); unique(values, label); return Object.freeze(values); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function accountAddress(value: unknown): value is string { return typeof value === "string" && /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value); }
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Auth returned duplicate ${label}`); }
