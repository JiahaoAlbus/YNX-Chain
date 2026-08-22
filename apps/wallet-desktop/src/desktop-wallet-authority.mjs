import { randomUUID } from "node:crypto";
import { Wallet, getBytes, isAddress, isHexString } from "ethers";
import { createCallbackURL, signAuthorization, STANDARD_WALLET_CHAIN_ID } from "@ynx-chain/wallet-auth";
import { providerError } from "./desktop-wallet-vault.mjs";

export const YNX_EIP155_CHAIN = "eip155:6423";
export const YNX_EVM_CHAIN_ID = STANDARD_WALLET_CHAIN_ID;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_REQUESTS = 64;
const MAX_PENDING_REQUESTS_PER_ORIGIN = 8;
export const APPROVAL_METHODS = Object.freeze([
  "eth_requestAccounts",
  "wallet_requestPermissions",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction"
]);

export class DesktopWalletAuthority {
  constructor({ vault, permissions, transactionSender, requestId = randomUUID, clock = () => new Date() }) {
    this.vault = vault;
    this.permissions = permissions;
    this.transactionSender = transactionSender;
    this.requestId = requestId;
    this.clock = clock;
    this.pending = new Map();
  }

  async accountStatus() { return this.vault.status(); }
  async createAccount() { return this.vault.createAccount(); }
  async addAccountAndSelect() { this.pending.clear(); await this.permissions.revokeAll(); return this.vault.addAccountAndSelect(); }
  async selectAccount(account) { this.pending.clear(); await this.permissions.revokeAll(); return this.vault.selectAccount(account); }
  async approveCanonicalAuthorization(request, issuedAt) {
    return this.vault.withSecret(secret => {
      const response = signAuthorization(request, { accountSecret: secret, issuedAt });
      return Object.freeze({ response, callbackUrl: createCallbackURL(response) });
    });
  }
  async approveOrigin(originInput) {
    const origin = exactHttpsOrigin(originInput);
    const status = await this.vault.status();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before connecting a DApp");
    await this.permissions.grantAccount(origin, status.account, this.clock().toISOString());
    return Object.freeze({ origin, account: status.account });
  }
  async revokeOrigin(originInput) { const origin = exactHttpsOrigin(originInput); await this.permissions.revoke(origin); this.#clearOriginPending(origin); return Object.freeze({ origin, revoked: true }); }

  async request(input) {
    const origin = exactHttpsOrigin(input?.origin);
    const method = methodName(input?.method);
    const params = Array.isArray(input?.params) ? input.params : [];
    const status = await this.vault.status();
    if (method === "eth_chainId") return success(YNX_EVM_CHAIN_ID);
    if (method === "net_version") return success("6423");
    if (method === "eth_accounts") return success(await this.#approvedAccounts(origin, status));
    if (method === "wallet_getPermissions") return success(await this.permissions.list(origin));
    if (method === "wallet_revokePermissions") {
      validatePermissionRequest(params);
      await this.permissions.revoke(origin);
      this.#clearOriginPending(origin);
      return success(null);
    }
    if (!APPROVAL_METHODS.includes(method)) throw providerError(4200, "UNSUPPORTED_PROVIDER_METHOD", `Unsupported Provider method: ${method}`);
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before connecting a DApp");
    if (["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"].includes(method) && !(await this.permissions.hasAccount(origin, status.account))) {
      throw providerError(4100, "ACCOUNT_PERMISSION_REQUIRED", "The DApp has not been approved for this account");
    }
    const normalized = normalizeApproval(method, params, status.account);
    this.#pruneExpired();
    if (this.pending.size >= MAX_PENDING_REQUESTS || [...this.pending.values()].filter(item => item.origin === origin).length >= MAX_PENDING_REQUESTS_PER_ORIGIN) {
      throw providerError(4200, "PENDING_REQUEST_LIMIT", "Too many Wallet requests are awaiting review");
    }
    const id = this.requestId();
    const pending = Object.freeze({ id, origin, method, params: normalized.params, review: normalized.review, createdAt: this.clock().toISOString() });
    this.pending.set(id, pending);
    return Object.freeze({ status: "approval-required", request: pending });
  }

  async approve(id) {
    const pending = this.#take(id);
    const status = await this.vault.status();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Wallet account is unavailable");
    if (["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"].includes(pending.method) && !(await this.permissions.hasAccount(pending.origin, status.account))) {
      throw providerError(4100, "ACCOUNT_PERMISSION_REVOKED", "The DApp account permission was revoked before approval");
    }
    switch (pending.method) {
      case "eth_requestAccounts":
      case "wallet_requestPermissions":
        await this.permissions.grantAccount(pending.origin, status.account, this.clock().toISOString());
        return success(pending.method === "eth_requestAccounts" ? [status.account] : [{ parentCapability: "eth_accounts" }]);
      case "personal_sign":
        return this.vault.withSecret(async secret => success(await walletForSecret(secret).signMessage(getBytes(pending.params[0]))));
      case "eth_signTypedData_v4":
        return this.vault.withSecret(async secret => {
          const typed = JSON.parse(pending.params[1]);
          const types = { ...typed.types };
          delete types.EIP712Domain;
          return success(await walletForSecret(secret).signTypedData(typed.domain, types, typed.message));
        });
      case "eth_sendTransaction":
        if (!this.transactionSender) throw providerError(4200, "TRANSACTION_TRANSPORT_UNAVAILABLE", "Canonical transaction transport is unavailable");
        return this.vault.withSecret(async secret => success(await this.transactionSender.send(walletForSecret(secret), pending.params[0])));
      default:
        throw providerError(4200, "UNSUPPORTED_PROVIDER_METHOD", "Provider method is not implemented");
    }
  }

  reject(id) {
    this.#take(id);
    throw providerError(4001, "USER_REJECTED_REQUEST", "User rejected the request");
  }

  expire(id) { return typeof id === "string" && this.pending.delete(id); }

  pendingRequests() { return Object.freeze([...this.pending.values()]); }

  async #approvedAccounts(origin, status) {
    return status.initialized && await this.permissions.hasAccount(origin, status.account) ? [status.account] : [];
  }

  #take(id) {
    if (typeof id !== "string" || !this.pending.has(id)) throw providerError(4100, "UNKNOWN_OR_EXPIRED_REQUEST", "Provider request is unknown or already resolved");
    const value = this.pending.get(id);
    this.pending.delete(id);
    if (this.clock().getTime() - Date.parse(value.createdAt) > APPROVAL_TTL_MS) throw providerError(4100, "REQUEST_EXPIRED", "Provider request expired before approval");
    return value;
  }

  #clearOriginPending(origin) { for (const [id, request] of this.pending) if (request.origin === origin) this.pending.delete(id); }
  #pruneExpired() { const now = this.clock().getTime(); for (const [id, request] of this.pending) if (now - Date.parse(request.createdAt) > APPROVAL_TTL_MS) this.pending.delete(id); }
}

export class MemoryPermissionStore {
  constructor() { this.records = new Map(); }
  async grantAccount(origin, account, approvedAt) { this.records.set(origin, Object.freeze({ parentCapability: "eth_accounts", accounts: [account], approvedAt })); }
  async revoke(origin) { this.records.delete(origin); }
  async revokeAll() { this.records.clear(); }
  async hasAccount(origin, account) { return this.records.get(origin)?.accounts.includes(account) ?? false; }
  async list(origin) { const record = this.records.get(origin); return record ? [record] : []; }
}

function normalizeApproval(method, params, activeAccount) {
  if (method === "eth_requestAccounts") return { params: [], review: { title: "Connect account", account: activeAccount, permissions: ["eth_accounts"] } };
  if (method === "wallet_requestPermissions") {
    validatePermissionRequest(params);
    return { params, review: { title: "Grant account permission", account: activeAccount, permissions: ["eth_accounts"] } };
  }
  if (method === "personal_sign") {
    if (params.length !== 2 || !isHexString(params[0]) || normalizeAccount(params[1]) !== activeAccount) invalidParams("personal_sign requires hex data and the active approved account");
    return { params: [params[0], activeAccount], review: { title: "Sign message", account: activeAccount, message: params[0], warning: "This signature may authorize an external action." } };
  }
  if (method === "eth_signTypedData_v4") {
    if (params.length !== 2 || normalizeAccount(params[0]) !== activeAccount || typeof params[1] !== "string") invalidParams("eth_signTypedData_v4 requires the active approved account and JSON typed data");
    let typed;
    try { typed = JSON.parse(params[1]); } catch { invalidParams("Typed data is not valid JSON"); }
    if (!typed?.domain || !typed?.types || !typed?.primaryType || !typed?.message) invalidParams("Typed data is incomplete");
    if (typed.domain.chainId !== undefined && Number(typed.domain.chainId) !== 6423) invalidParams("Typed data targets a different chain");
    return { params: [activeAccount, JSON.stringify(typed)], review: { title: "Sign typed data", account: activeAccount, domain: typed.domain, primaryType: typed.primaryType, message: typed.message } };
  }
  if (method === "eth_sendTransaction") {
    if (params.length !== 1 || typeof params[0] !== "object" || params[0] === null) invalidParams("eth_sendTransaction requires one transaction object");
    const tx = { ...params[0], from: normalizeAccount(params[0].from) };
    if (tx.from !== activeAccount || (tx.to !== undefined && tx.to !== null && !isAddress(tx.to))) invalidParams("Transaction account or destination is invalid");
    if (tx.chainId !== undefined && Number(tx.chainId) !== 6423) invalidParams("Transaction targets a different chain");
    for (const field of ["value", "data", "gas", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]) if (tx[field] !== undefined && !isHexString(tx[field])) invalidParams(`Transaction ${field} must be hexadecimal`);
    return { params: [tx], review: { title: "Send transaction", account: activeAccount, to: tx.to ?? null, value: tx.value ?? "0x0", data: tx.data ?? "0x", chainId: YNX_EVM_CHAIN_ID } };
  }
  invalidParams("Provider request cannot be reviewed");
}

function validatePermissionRequest(params) {
  const request = params[0];
  if (params.length !== 1 || typeof request !== "object" || request === null || Array.isArray(request) || Object.keys(request).join(",") !== "eth_accounts" || typeof request.eth_accounts !== "object" || request.eth_accounts === null || Object.keys(request.eth_accounts).length !== 0) {
    invalidParams("Only the exact eth_accounts permission is supported");
  }
}
function exactHttpsOrigin(value) { try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(); return url.origin; } catch { throw providerError(4100, "INVALID_DAPP_ORIGIN", "DApp origin must be an exact HTTPS origin"); } }
function methodName(value) { if (typeof value !== "string" || !/^[a-z][A-Za-z0-9_]{1,63}$/.test(value)) invalidParams("Provider method is invalid"); return value; }
function normalizeAccount(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) invalidParams("Provider account is invalid"); return value.toLowerCase(); }
function invalidParams(message) { throw providerError(-32602, "INVALID_PROVIDER_PARAMS", message); }
function success(result) { return Object.freeze({ status: "success", result }); }
function walletForSecret(secret) { return new Wallet(secret.startsWith("0x") ? secret : `0x${secret}`); }
