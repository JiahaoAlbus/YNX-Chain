import {
  canonicalJSON,
  createDexActionDeepLink,
  createGatewayChallenge,
  createProductDeviceIdentity,
  createProductSessionProof,
  encodeBase64url,
  encodeProductSessionProofHeader,
  encodeRequestDeepLink,
  httpBodyDigest,
  parseAuthorizationRequest,
  parseCallbackURL,
  parseCentralWalletSession,
  parseDexActionResponse,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type CentralWalletSession,
  type DexActionName,
  type DexActionPayload,
  type DexActionRequest,
  type DexActionResponse,
  type DexQuote,
  type ProductBinding,
} from "@ynx-chain/wallet-auth";

export const DEX_WALLET_CALLBACK =
  "https://dex.ynxweb4.com/wallet-auth/callback";
export const DEX_ACTION_CALLBACK =
  "https://dex.ynxweb4.com/wallet-action/callback";
export const DEX_WALLET_CLIENT = "ynx-dex-web-v1";
export const DEX_WALLET_BUNDLE = "com.ynxweb4.dex.web";
export const DEX_WALLET_SCOPES = [
  "account:read",
  "dex:positions:read",
  "dex:transaction:request",
] as const;
const PENDING_AUTH = "ynx-dex-wallet-pending-v1",
  PENDING_ACTION = "ynx-dex-action-pending-v1";
const DB = "ynx-dex-device-v2",
  STORE = "auth",
  DEVICE = "device",
  SESSION = "session";

type ProductDevice = Readonly<{
  productDeviceSecret: string;
  productDeviceKey: string;
}>;
export type DexWalletSession = Readonly<{
  session: CentralWalletSession;
  device: ProductDevice;
}>;

export const DEX_WALLET_REGISTRY: Readonly<Record<string, ProductBinding>> =
  Object.freeze({
    [DEX_WALLET_CLIENT]: Object.freeze({
      requestingProduct: "dex",
      bundleId: DEX_WALLET_BUNDLE,
      callbacks: Object.freeze([DEX_WALLET_CALLBACK]),
      scopes: Object.freeze([...DEX_WALLET_SCOPES]),
      maxScopes: DEX_WALLET_SCOPES.length,
    }),
  });

export class WalletRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function buildWalletRequest(input: {
  nonce: string;
  productDeviceKey: string;
  now?: Date;
}): AuthorizationRequest {
  const now = input.now ?? new Date();
  const request = {
    version: "1" as const,
    nonce: input.nonce,
    chainId: "ynx_6423-1" as const,
    requestingProduct: "dex",
    productClientId: DEX_WALLET_CLIENT,
    bundleId: DEX_WALLET_BUNDLE,
    productDeviceAlgorithm: "p256-sha256" as const,
    productDeviceKey: input.productDeviceKey,
    callback: DEX_WALLET_CALLBACK,
    scopes: [...DEX_WALLET_SCOPES],
    purpose:
      "Connect this account to YNX DEX to read its positions and request separately reviewed Testnet transactions. DEX cannot sign or move assets.",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.valueOf() + 5 * 60_000).toISOString(),
  };
  try {
    return parseAuthorizationRequest(request, {
      now,
      registry: DEX_WALLET_REGISTRY,
    });
  } catch (reason) {
    throw walletError(reason);
  }
}

export function walletDeepLink(request: AuthorizationRequest) {
  try {
    return encodeRequestDeepLink(
      parseAuthorizationRequest(request, {
        now: new Date(request.issuedAt),
        registry: DEX_WALLET_REGISTRY,
      }),
    );
  } catch (reason) {
    throw walletError(reason);
  }
}

export async function beginWalletAuthorization(
  storage: Storage = sessionStorage,
  now = new Date(),
) {
  const device = await getOrCreateDevice(),
    request = buildWalletRequest({
      nonce: nonce(),
      productDeviceKey: device.productDeviceKey,
      now,
    });
  storage.setItem(PENDING_AUTH, JSON.stringify(request));
  return { request, url: walletDeepLink(request) };
}

export function consumeWalletCallback(
  url: string,
  storage: Storage = sessionStorage,
  now = new Date(),
): AuthorizationResponse | null {
  const parsed = new URL(url);
  if (
    parsed.origin + parsed.pathname !== DEX_WALLET_CALLBACK ||
    !parsed.searchParams.has("response")
  )
    return null;
  const raw = storage.getItem(PENDING_AUTH);
  if (!raw)
    throw new WalletRequestError(
      "MISSING_PENDING_REQUEST",
      "This Wallet return has no pending DEX request on this browser tab.",
    );
  try {
    const input = JSON.parse(raw),
      request = parseAuthorizationRequest(input, {
        now: new Date(input.issuedAt),
        registry: DEX_WALLET_REGISTRY,
      }),
      response = parseCallbackURL(url, DEX_WALLET_CALLBACK),
      verified = verifyAuthorization(response, {
        ...request,
        requestDigest: requestDigest(request),
        now,
      });
    storage.removeItem(PENDING_AUTH);
    return verified;
  } catch (reason) {
    throw walletError(reason);
  }
}

export async function completeWalletCallback(
  url: string,
  storage: Storage = sessionStorage,
  now = new Date(),
): Promise<DexWalletSession | null> {
  const raw = storage.getItem(PENDING_AUTH),
    approval = consumeWalletCallback(url, storage, now);
  if (!approval) return null;
  if (!raw)
    throw new WalletRequestError(
      "MISSING_PENDING_REQUEST",
      "The DEX authorization request disappeared before Product Session completion.",
    );
  try {
    const authorizationRequest = JSON.parse(raw) as AuthorizationRequest,
      device = await getOrCreateDevice();
    if (authorizationRequest.productDeviceKey !== device.productDeviceKey)
      throw new WalletRequestError(
        "DEVICE_MISMATCH",
        "Wallet approval belongs to another DEX browser device.",
      );
    const challengeExpiry = new Date(
        Math.min(now.getTime() + 60_000, Date.parse(approval.expiresAt)),
      ),
      gatewayCompletion = signGatewayChallenge(
        createGatewayChallenge(
          approval,
          { challenge: nonce(), expiresAt: challengeExpiry.toISOString() },
          now,
        ),
        device.productDeviceSecret,
      );
    const response = await fetch("/api/v1/wallet/sessions/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: canonicalJSON({
          authorizationRequest,
          walletApproval: approval,
          gatewayCompletion,
        }),
        credentials: "omit",
      }),
      envelope = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: unknown;
      } | null;
    if (!response.ok || !envelope?.ok || !envelope.result)
      throw new WalletRequestError(
        "SESSION_COMPLETION_FAILED",
        `Central Wallet session completion failed closed (${response.status}).`,
      );
    const session = parseCentralWalletSession(envelope.result);
    if (
      session.productClientId !== DEX_WALLET_CLIENT ||
      session.bundleId !== DEX_WALLET_BUNDLE ||
      session.productDeviceKey !== device.productDeviceKey ||
      session.account !== approval.account
    )
      throw new WalletRequestError(
        "SESSION_BINDING_MISMATCH",
        "Central Wallet returned a session for another DEX identity, device or account.",
      );
    const current = Object.freeze({ session, device });
    await write(SESSION, session);
    return current;
  } catch (reason) {
    storage.setItem(PENDING_AUTH, raw);
    throw walletError(reason);
  }
}

export async function restoreWalletSession(
  now = new Date(),
): Promise<DexWalletSession | null> {
  const [input, device] = (await Promise.all([
    read(SESSION),
    read(DEVICE),
  ])) as [unknown, ProductDevice | null];
  if (!input || !validDevice(device)) return null;
  try {
    const session = parseCentralWalletSession(input);
    if (
      session.expiresAt <= now.toISOString() ||
      session.productClientId !== DEX_WALLET_CLIENT ||
      session.bundleId !== DEX_WALLET_BUNDLE ||
      session.productDeviceKey !== device.productDeviceKey
    ) {
      await remove(SESSION);
      return null;
    }
    return Object.freeze({ session, device });
  } catch {
    await remove(SESSION);
    return null;
  }
}

export async function assertWalletSession(
  scope: (typeof DEX_WALLET_SCOPES)[number],
  now = new Date(),
): Promise<DexWalletSession> {
  const current = await restoreWalletSession(now);
  if (!current)
    throw new WalletRequestError(
      "SESSION_REQUIRED",
      "Connect YNX Wallet before requesting a DEX transaction. Read-only DEX data remains available without login.",
    );
  if (
    !DEX_WALLET_SCOPES.includes(scope) ||
    !current.session.scopes.includes(scope)
  )
    throw new WalletRequestError(
      "SCOPE_REQUIRED",
      `The DEX Product Session does not grant ${scope}.`,
    );
  const body = canonicalJSON({ requiredScopes: [scope] }),
    proof = createProductSessionProof(
      current.session,
      {
        method: "POST",
        path: "/v1/wallet/sessions/introspect",
        bodyDigest: httpBodyDigest(body),
        nonce: nonce(),
        issuedAt: now.toISOString(),
        expiresAt: new Date(
          Math.min(
            now.getTime() + 30_000,
            Date.parse(current.session.expiresAt),
          ),
        ).toISOString(),
      },
      current.device.productDeviceSecret,
    );
  const response = await fetch("/api/v1/wallet/sessions/introspect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-YNX-Product-Session-Proof": encodeProductSessionProofHeader(proof),
      },
      body,
      credentials: "omit",
    }),
    envelope = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: { active?: boolean };
    } | null;
  if (!response.ok || !envelope?.ok || !envelope.result?.active)
    throw new WalletRequestError(
      "SESSION_INACTIVE",
      `Central Wallet session introspection failed closed (${response.status}).`,
    );
  return current;
}

export async function beginDexAction(
  input: {
    action: DexActionName;
    payload: DexActionPayload;
    quote: DexQuote;
    accountNonce: number;
  },
  storage: Storage = sessionStorage,
  now = new Date(),
) {
  const current = await assertWalletSession("dex:transaction:request", now),
    request: DexActionRequest = {
      version: "1",
      chainId: 6423,
      productClientId: DEX_WALLET_CLIENT,
      bundleId: DEX_WALLET_BUNDLE,
      callback: DEX_ACTION_CALLBACK,
      sessionBinding: current.session.sessionBinding,
      account: current.session.account,
      nonce: input.accountNonce + 1,
      action: input.action,
      payload: input.payload,
      quote: input.quote,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    };
  const url = createDexActionDeepLink(request, now);
  storage.setItem(PENDING_ACTION, JSON.stringify(request));
  return { request, url };
}

export function consumeDexActionCallback(
  url: string,
  storage: Storage = sessionStorage,
  now = new Date(),
): DexActionResponse | null {
  const parsed = new URL(url);
  if (
    parsed.origin + parsed.pathname !== DEX_ACTION_CALLBACK ||
    !parsed.searchParams.has("response")
  )
    return null;
  const raw = storage.getItem(PENDING_ACTION);
  if (!raw)
    throw new WalletRequestError(
      "MISSING_PENDING_ACTION",
      "This Wallet return has no pending DEX transaction on this browser tab.",
    );
  try {
    const request = JSON.parse(raw) as DexActionRequest,
      response = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          decodeBase64url(parsed.searchParams.get("response") || ""),
        ),
      );
    const verified = parseDexActionResponse(response, request, now);
    storage.removeItem(PENDING_ACTION);
    return verified;
  } catch (reason) {
    throw walletError(reason);
  }
}

function decodeBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new WalletRequestError(
      "INVALID_CALLBACK",
      "DEX Wallet action callback encoding is invalid.",
    );
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded),
    bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function getOrCreateDevice(): Promise<ProductDevice> {
  const existing = await read(DEVICE);
  if (validDevice(existing)) return existing;
  const device = createProductDeviceIdentity();
  await write(DEVICE, device);
  return device;
}
function validDevice(value: unknown): value is ProductDevice {
  return Boolean(
    value &&
    typeof value === "object" &&
    "productDeviceSecret" in value &&
    "productDeviceKey" in value &&
    /^[A-Za-z0-9_-]{43}$/.test(
      String((value as ProductDevice).productDeviceSecret),
    ) &&
    /^[A-Za-z0-9_-]{44}$/.test(
      String((value as ProductDevice).productDeviceKey),
    ),
  );
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode),
        request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function read(key: string) {
  return transaction("readonly", (store) => store.get(key));
}
function write(key: string, value: unknown) {
  return transaction("readwrite", (store) => store.put(value, key));
}
function remove(key: string) {
  return transaction("readwrite", (store) => store.delete(key));
}
function nonce() {
  return encodeBase64url(crypto.getRandomValues(new Uint8Array(24)));
}
function code(value: unknown) {
  return value && typeof value === "object" && "code" in value
    ? String(value.code)
    : "WALLET_AUTH_FAILED";
}
function message(value: unknown) {
  return value instanceof Error
    ? value.message
    : "Wallet authorization failed.";
}
function walletError(value: unknown) {
  return value instanceof WalletRequestError
    ? value
    : new WalletRequestError(code(value), message(value));
}
