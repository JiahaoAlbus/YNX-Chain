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

function canonicalJSON(value: unknown): string {
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
  await bridge.openAuthorization(deepLink);
  return Object.freeze({ status: "wallet-review-opened" as const, expiresAt: request.expiresAt });
}

type StoredDevice = { version: 1; privateKey: CryptoKey; publicKey: CryptoKey };
const DATABASE = "ynx-code-wallet-v1", STORE = "product-device-keys", KEY = "ynx-developer-v1";

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
