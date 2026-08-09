export type DeveloperWalletBridge = {
  openAuthorization: (deepLink: string) => Promise<void>;
};

declare global {
  interface Window {
    ynxDesktopWallet?: DeveloperWalletBridge;
  }
}

const binding = Object.freeze({
  version: "1",
  chainId: "ynx_6423-1",
  requestingProduct: "developer",
  productClientId: "ynx-developer-v1",
  bundleId: "com.ynxweb4.developer.testnetpreview",
  productDeviceAlgorithm: "p256-sha256",
  callback: "ynxdeveloper://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "developer:deploy"]),
});

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Wallet protocol numbers must be safe integers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Wallet request is not canonical JSON.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(",")}}`;
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function desktopWalletBridge(): DeveloperWalletBridge | undefined {
  const candidate = window.ynxDesktopWallet;
  return candidate && typeof candidate.openAuthorization === "function" ? candidate : undefined;
}

export async function openDeveloperWalletReview(bridge: DeveloperWalletBridge, now = new Date()) {
  const productDeviceKey = await productDevicePublicKey();
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const request = Object.freeze({
    ...binding,
    productDeviceKey,
    nonce: base64url(crypto.getRandomValues(new Uint8Array(32))),
    purpose: "Sign in to YNX Developer and review one exact Testnet deployment.",
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const deepLink = `ynxwallet://authorize?request=${base64url(new TextEncoder().encode(canonicalJSON(request)))}`;
  sessionStorage.setItem(PENDING_REQUEST, canonicalJSON(request));
  try { await bridge.openAuthorization(deepLink); }
  catch (error) { sessionStorage.removeItem(PENDING_REQUEST); throw error; }
  return Object.freeze({ status: "wallet-review-opened" as const, expiresAt: request.expiresAt });
}

type StoredDevice = { version: 1; privateKey: CryptoKey; publicKey: CryptoKey };
const DATABASE = "ynx-code-wallet-v1", STORE = "product-device-keys", KEY = "ynx-developer-v1";
const PENDING_REQUEST = "ynx-code-wallet-pending-v1";

export function subscribeDeveloperWalletCallbacks(listener: (callbackURL: string) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string") listener(detail);
  };
  window.addEventListener("ynx-wallet-callback", handler);
  return () => window.removeEventListener("ynx-wallet-callback", handler);
}

export async function createDeveloperWalletCompletion(callbackURL: string, now = new Date()) {
  const request = pendingAuthorizationRequest(now), approval = callbackApproval(callbackURL, request, now);
  const issuedAt = now.toISOString(), expiresAt = new Date(Math.min(Date.parse(approval.expiresAt as string), now.getTime() + 90_000)).toISOString();
  if (expiresAt <= issuedAt) throw new Error("YNX Wallet approval expired before the device challenge could be signed.");
  const challenge = Object.freeze({
    version: "1", challenge: base64url(crypto.getRandomValues(new Uint8Array(32))), requestDigest: approval.requestDigest,
    productClientId: approval.productClientId, bundleId: approval.bundleId, productDeviceAlgorithm: approval.productDeviceAlgorithm,
    productDeviceKey: approval.productDeviceKey, account: approval.account, scopes: approval.grantedScopes, issuedAt, expiresAt,
  });
  const pair = await productDeviceKeyPair();
  const signed = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`)));
  const completion = Object.freeze({ authorizationRequest: request, walletApproval: approval, gatewayCompletion: { challenge, deviceSignature: base64url(derSignature(signed)) } });
  return Object.freeze({ body: canonicalJSON(completion), account: approval.account, expiresAt });
}

export function consumeDeveloperWalletRequest() { sessionStorage.removeItem(PENDING_REQUEST); }

function pendingAuthorizationRequest(now: Date) {
  const encoded = sessionStorage.getItem(PENDING_REQUEST);
  if (!encoded) throw new Error("No pending Developer Wallet request exists on this device.");
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new Error("Pending Developer Wallet request is corrupted."); }
  const request = plainRecord(value, "Pending Developer Wallet request");
  const fields = ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","scopes","purpose","issuedAt","expiresAt"];
  exactFields(request, fields, "Pending Developer Wallet request");
  if (request.version !== binding.version || request.chainId !== binding.chainId || request.requestingProduct !== binding.requestingProduct || request.productClientId !== binding.productClientId || request.bundleId !== binding.bundleId || request.productDeviceAlgorithm !== binding.productDeviceAlgorithm || request.callback !== binding.callback || !sameStrings(request.scopes, binding.scopes) || typeof request.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(request.nonce) || typeof request.productDeviceKey !== "string" || !/^[A-Za-z0-9_-]{44}$/.test(request.productDeviceKey) || typeof request.purpose !== "string" || !validTime(request.issuedAt) || !validTime(request.expiresAt) || Date.parse(request.expiresAt as string) <= now.getTime()) throw new Error("Pending Developer Wallet request does not match the reviewed product binding.");
  return request;
}

function callbackApproval(callbackURL: string, request: Record<string, unknown>, now: Date) {
  let parsed: URL;
  try { parsed = new URL(callbackURL); } catch { throw new Error("YNX Wallet callback URL is invalid."); }
  const keys = [...parsed.searchParams.keys()], response = keys.length === 1 && keys[0] === "response" ? parsed.searchParams.get("response") : null;
  if (parsed.protocol !== "ynxdeveloper:" || parsed.hostname !== "wallet-auth" || parsed.pathname !== "/callback" || parsed.hash || parsed.username || parsed.password || !response) throw new Error("YNX Wallet callback route was substituted.");
  const decoded = decodeBase64url(response);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)); } catch { throw new Error("YNX Wallet callback response is invalid."); }
  const approval = plainRecord(value, "YNX Wallet approval");
  const fields = ["version","requestDigest","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","account","accountPublicKey","grantedScopes","purpose","issuedAt","expiresAt","walletSignature"];
  exactFields(approval, fields, "YNX Wallet approval");
  for (const key of ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"]) if (approval[key] !== request[key]) throw new Error(`YNX Wallet approval ${key} does not match the pending request.`);
  if (!sameStrings(approval.grantedScopes, request.scopes) || typeof approval.requestDigest !== "string" || !/^[0-9a-f]{64}$/.test(approval.requestDigest) || typeof approval.walletSignature !== "string" || !/^[0-9a-f]{128}$/.test(approval.walletSignature) || typeof approval.account !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(approval.account) || typeof approval.accountPublicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(approval.accountPublicKey) || !validTime(approval.issuedAt) || !validTime(approval.expiresAt) || Date.parse(approval.issuedAt as string) < Date.parse(request.issuedAt as string) || Date.parse(approval.issuedAt as string) > now.getTime() || Date.parse(approval.expiresAt as string) > Date.parse(request.expiresAt as string) || Date.parse(approval.expiresAt as string) <= now.getTime()) throw new Error("YNX Wallet approval fields, scope, signature shape or lifetime are invalid.");
  return approval;
}

function derSignature(signature: Uint8Array) {
  if (signature.length >= 68 && signature.length <= 72 && signature[0] === 0x30 && signature[1] === signature.length - 2) return signature;
  if (signature.length !== 64) throw new Error("Developer device returned an unsupported P-256 signature.");
  const integer = (part: Uint8Array) => { let offset = 0; while (offset < part.length - 1 && part[offset] === 0) offset++; const body = part.slice(offset), prefix = body[0] & 0x80 ? 1 : 0, value = new Uint8Array(2 + prefix + body.length); value[0] = 0x02; value[1] = prefix + body.length; value.set(body, 2 + prefix); return value; };
  const r = integer(signature.slice(0, 32)), s = integer(signature.slice(32));
  const result = new Uint8Array(2 + r.length + s.length); result[0] = 0x30; result[1] = r.length + s.length; result.set(r, 2); result.set(s, 2 + r.length); return result;
}

function decodeBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("YNX Wallet callback encoding is not canonical.");
  let binary: string;
  try { binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)); } catch { throw new Error("YNX Wallet callback encoding is invalid."); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error("YNX Wallet callback encoding is not canonical.");
  return bytes;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} is invalid.`); return value as Record<string, unknown>; }
function exactFields(value: Record<string, unknown>, fields: string[], label: string) { if (Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n")) throw new Error(`${label} fields are invalid.`); }
function sameStrings(value: unknown, expected: unknown) { return Array.isArray(value) && Array.isArray(expected) && value.length === expected.length && value.every((item, index) => item === expected[index]); }
function validTime(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; }

async function productDevicePublicKey() {
  const pair = await productDeviceKeyPair();
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Developer P-256 public key is invalid.");
  const compressed = new Uint8Array(33);
  compressed[0] = raw[64] % 2 ? 3 : 2;
  compressed.set(raw.slice(1, 33), 1);
  const encoded = base64url(compressed);
  if (!/^[A-Za-z0-9_-]{44}$/.test(encoded)) throw new Error("Developer product-device public key is not canonical.");
  return encoded;
}

async function productDeviceKeyPair(): Promise<CryptoKeyPair> {
  const database = await openDeviceDatabase();
  try {
    const stored = await transactionRequest<StoredDevice | undefined>(database, "readonly", (store) => store.get(KEY));
    if (stored?.version === 1 && validPair(stored)) return { privateKey: stored.privateKey, publicKey: stored.publicKey };
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    await transactionRequest(database, "readwrite", (store) => store.put({ version: 1, privateKey: pair.privateKey, publicKey: pair.publicKey } satisfies StoredDevice, KEY));
    return pair;
  } finally {
    database.close();
  }
}

function validPair(value: StoredDevice) {
  const privateAlgorithm = value.privateKey?.algorithm as EcKeyAlgorithm | undefined;
  const publicAlgorithm = value.publicKey?.algorithm as EcKeyAlgorithm | undefined;
  return value.privateKey instanceof CryptoKey && value.publicKey instanceof CryptoKey && value.privateKey.type === "private" && value.privateKey.extractable === false && value.privateKey.usages.length === 1 && value.privateKey.usages[0] === "sign" && value.publicKey.type === "public" && value.publicKey.extractable === true && value.publicKey.usages.length === 1 && value.publicKey.usages[0] === "verify" && privateAlgorithm?.name === "ECDSA" && privateAlgorithm.namedCurve === "P-256" && publicAlgorithm?.name === "ECDSA" && publicAlgorithm.namedCurve === "P-256";
}

function openDeviceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Developer product-device storage is unavailable."));
    request.onblocked = () => reject(new Error("Developer product-device storage upgrade is blocked."));
  });
}

function transactionRequest<T = IDBValidKey>(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode), request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Developer product-device storage operation failed."));
    transaction.onabort = () => reject(new Error("Developer product-device storage transaction was aborted."));
  });
}
