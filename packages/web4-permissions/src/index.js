import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export * from "./contracts.js";
export * from "./i18n.js";

export const SITE_PERMISSIONS = Object.freeze([
  "camera",
  "microphone",
  "geolocation",
  "notifications",
  "clipboard-read",
  "wallet-connect"
]);

const WALLET_FIELDS = new Set([
  "version", "requestId", "chainId", "origin", "callback", "account",
  "scopes", "issuedAt", "expiresAt", "purpose", "transaction"
]);

export function canonicalOrigin(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error("unsupported origin scheme");
  if (url.username || url.password) throw new Error("credentials are not allowed in origins");
  return url.origin;
}

export function originPartition(origin, { privateSessionId } = {}) {
  const normalized = canonicalOrigin(origin);
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return privateSessionId ? `web4-private-${privateSessionId}-${digest}` : `persist:web4-${digest}`;
}

export function validatePermission(permission) {
  if (!SITE_PERMISSIONS.includes(permission)) throw new Error(`unsupported permission: ${permission}`);
  return permission;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

export class PermissionStore {
  #path;
  #private = new Map();
  constructor(path) { this.#path = path; }

  async decide(origin, permission, decision, { privateSessionId, expiresAt = null } = {}) {
    const key = canonicalOrigin(origin);
    validatePermission(permission);
    if (!['allow', 'deny', 'ask'].includes(decision)) throw new Error("invalid permission decision");
    const record = { decision, expiresAt, updatedAt: new Date().toISOString() };
    if (privateSessionId) {
      const privateKey = `${privateSessionId}:${key}:${permission}`;
      this.#private.set(privateKey, record);
      return record;
    }
    const state = await readJson(this.#path, { version: 1, origins: {} });
    state.origins[key] ??= {};
    state.origins[key][permission] = record;
    await writeJsonAtomic(this.#path, state);
    return record;
  }

  async get(origin, permission, { privateSessionId } = {}) {
    const key = canonicalOrigin(origin);
    validatePermission(permission);
    const record = privateSessionId
      ? this.#private.get(`${privateSessionId}:${key}:${permission}`)
      : (await readJson(this.#path, { version: 1, origins: {} })).origins[key]?.[permission];
    if (!record) return "ask";
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return "ask";
    return record.decision;
  }

  forgetPrivateSession(privateSessionId) {
    for (const key of this.#private.keys()) if (key.startsWith(`${privateSessionId}:`)) this.#private.delete(key);
  }
}

export function validateWalletRequest(input, policy, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("wallet request must be an object");
  for (const key of Object.keys(input)) if (!WALLET_FIELDS.has(key)) throw new Error(`unknown wallet field: ${key}`);
  if (input.version !== "1") throw new Error("unsupported wallet request version");
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(input.requestId ?? "")) throw new Error("invalid requestId");
  if (input.chainId !== "ynx_6423-1") throw new Error("wrong chain");
  const origin = canonicalOrigin(input.origin);
  const callback = new URL(input.callback);
  if (callback.origin !== origin) throw new Error("callback origin mismatch");
  if (!(policy.allowedCallbacks?.[origin] ?? []).includes(callback.href)) throw new Error("callback not allowlisted");
  const issued = Date.parse(input.issuedAt);
  const expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30_000) throw new Error("invalid issue time");
  if (expires <= now || expires - issued > 5 * 60_000) throw new Error("invalid expiry");
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) throw new Error("scopes required");
  const allowed = new Set(policy.allowedScopes?.[origin] ?? []);
  for (const scope of input.scopes) if (!allowed.has(scope)) throw new Error(`scope not allowed: ${scope}`);
  if (typeof input.purpose !== "string" || input.purpose.length < 3 || input.purpose.length > 240) throw new Error("invalid purpose");
  return { ...input, origin, callback: callback.href };
}

export class ReplayGuard {
  #seen = new Map();
  consume(requestId, expiresAt, now = Date.now()) {
    for (const [id, expiry] of this.#seen) if (expiry <= now) this.#seen.delete(id);
    if (this.#seen.has(requestId)) throw new Error("wallet request replayed");
    this.#seen.set(requestId, Date.parse(expiresAt));
  }
}

export function reviewTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") throw new Error("transaction required");
  const { from, to, amount, asset, fee, memo = "", data = "" } = transaction;
  if (asset !== "YNXT") throw new Error("unsupported asset");
  if (!/^ynx1[0-9a-z]{20,90}$/.test(from ?? "") || !/^ynx1[0-9a-z]{20,90}$/.test(to ?? "")) throw new Error("invalid native address");
  if (!/^\d+(\.\d{1,18})?$/.test(amount ?? "") || Number(amount) <= 0) throw new Error("invalid amount");
  if (!/^\d+(\.\d{1,18})?$/.test(fee ?? "")) throw new Error("invalid fee");
  if (memo.length > 280 || data.length > 8192) throw new Error("transaction field too large");
  return { from, to, amount, asset, fee, memo, data, warnings: data ? ["This transaction includes contract data."] : [] };
}

export function selectAiContext({ action, currentPage, selectedTabs = [], includeWalletIdentity = false, includeHistory = false }) {
  if (!['summarize-page', 'compare-tabs', 'explain-permission', 'explain-signing'].includes(action)) throw new Error("unsupported AI action");
  if (includeWalletIdentity || includeHistory) throw new Error("sensitive context is not permitted");
  const pages = action === "compare-tabs" ? selectedTabs : [currentPage].filter(Boolean);
  if (!pages.length) throw new Error("authorized context required");
  for (const page of pages) {
    if (!page.authorized || page.private) throw new Error("unauthorized or private page context");
    canonicalOrigin(page.url);
    if (typeof page.text !== "string" || page.text.length > 50_000) throw new Error("page context size invalid");
  }
  return { action, contextClasses: ["authorized-page-content"], pages: pages.map(({ url, title, text }) => ({ url, title, text })) };
}

export function securitySummary(url, certificate = null) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return { level: "warning", secureTransport: false, message: "Connection is not encrypted with HTTPS." };
  if (!certificate) return { level: "unknown", secureTransport: true, message: "HTTPS is in use; certificate details are unavailable." };
  return { level: certificate.isValid === false ? "danger" : "secure", secureTransport: true, issuer: certificate.issuerName, validStart: certificate.validStart, validExpiry: certificate.validExpiry };
}
