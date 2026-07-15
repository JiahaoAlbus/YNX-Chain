import { addressIdentity, type SignedNativeTransfer } from "../crypto/ynxSigner";

const DEFAULT_RPC_URL = "https://rpc.ynxweb4.com";
const REQUEST_TIMEOUT_MS = 8_000;

export type NativeAccount = Readonly<{
  address: string;
  ynxAddress: string;
  balance: number;
  staked: number;
  nonce: number;
  exists: boolean;
}>;

export type NativeTransaction = Readonly<{
  hash: string;
  type: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  nonce: number;
  blockNumber: number;
  timestamp: string;
}>;

export type NativeWalletSnapshot = Readonly<{
  account: NativeAccount;
  activity: readonly NativeTransaction[];
  activityScope: "latest-100-network-transactions";
  activityAvailable: boolean;
  activityError?: string;
  fetchedAt: string;
}>;

export type BroadcastResult = Readonly<{
  transaction: NativeTransaction;
  replayed: boolean;
  committed: boolean;
  truthfulStatus: string;
}>;

export type FinalityResult = Readonly<{
  status: "confirmed" | "submitted";
  transaction: NativeTransaction;
}>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type RequestOptions = { fetchImpl?: FetchLike; rpcURL?: string; signal?: AbortSignal };

export class YNXRPCError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "YNXRPCError";
    this.status = status;
  }
}

export async function fetchNativeAccount(address: string, options: RequestOptions = {}): Promise<NativeAccount> {
  const identity = addressIdentity(address);
  try {
    const value = await requestJSON(`/accounts/${encodeURIComponent(identity.ynxAddress)}`, { ...options, method: "GET" });
    const candidate = isPlainObject(value) && isPlainObject(value.account) ? value.account : value;
    if (!isPlainObject(candidate)) throw new Error("YNX account endpoint returned an invalid payload");
    const responseAddress = requiredString(candidate.address, "account address").toLowerCase();
    if (responseAddress !== identity.evmAddress) throw new Error("YNX account endpoint returned a different account");
    return Object.freeze({
      address: responseAddress,
      ynxAddress: identity.ynxAddress,
      balance: nonNegativeInteger(candidate.balance, "account balance"),
      staked: nonNegativeInteger(candidate.staked, "staked balance"),
      nonce: nonNegativeInteger(candidate.nonce, "account nonce"),
      exists: true,
    });
  } catch (error) {
    if (error instanceof YNXRPCError && error.status === 404) {
      return Object.freeze({ address: identity.evmAddress, ynxAddress: identity.ynxAddress, balance: 0, staked: 0, nonce: 0, exists: false });
    }
    throw error;
  }
}

export async function fetchNativeActivity(address: string, options: RequestOptions = {}): Promise<readonly NativeTransaction[]> {
  const identity = addressIdentity(address);
  const value = await requestJSON("/txs?limit=100", { ...options, method: "GET" });
  if (!isPlainObject(value) || !Array.isArray(value.transactions)) throw new Error("YNX transaction endpoint returned an invalid payload");
  return Object.freeze(value.transactions.map(parseTransaction).filter((transaction) => transaction.from.toLowerCase() === identity.evmAddress || transaction.to.toLowerCase() === identity.evmAddress));
}

export async function fetchNativeWalletSnapshot(address: string, options: RequestOptions = {}): Promise<NativeWalletSnapshot> {
  const [accountResult, activityResult] = await Promise.allSettled([fetchNativeAccount(address, options), fetchNativeActivity(address, options)]);
  if (accountResult.status === "rejected") throw accountResult.reason;
  if (activityResult.status === "fulfilled") {
    return Object.freeze({ account: accountResult.value, activity: activityResult.value, activityScope: "latest-100-network-transactions", activityAvailable: true, fetchedAt: new Date().toISOString() });
  }
  return Object.freeze({
    account: accountResult.value,
    activity: Object.freeze([]),
    activityScope: "latest-100-network-transactions",
    activityAvailable: false,
    activityError: errorMessage(activityResult.reason),
    fetchedAt: new Date().toISOString(),
  });
}

export async function broadcastNativeTransfer(signed: SignedNativeTransfer, options: RequestOptions = {}): Promise<BroadcastResult> {
  const value = await requestJSON("/transactions/broadcast", { ...options, method: "POST", body: signed.payload });
  if (!isPlainObject(value) || !isPlainObject(value.transaction)) throw new Error("YNX broadcast endpoint returned an invalid payload");
  const transaction = parseTransaction(value.transaction);
  if (transaction.hash !== signed.hash || transaction.from !== signed.transaction.from || transaction.to !== signed.transaction.to || transaction.amount !== signed.transaction.amount || transaction.fee !== signed.transaction.fee || transaction.nonce !== signed.transaction.nonce) {
    throw new Error("YNX broadcast response does not match the signed transfer");
  }
  const truthfulStatus = requiredString(value.truthfulStatus, "broadcast truthful status");
  const replayed = value.replayed === true;
  const committed = value.committed === true || transaction.blockNumber > 0;
  return Object.freeze({ transaction, replayed, committed, truthfulStatus });
}

export async function fetchNativeTransaction(hash: string, options: RequestOptions = {}): Promise<NativeTransaction> {
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("Canonical lowercase YNX transaction hash is required");
  return parseTransaction(await requestJSON(`/txs/${hash}`, { ...options, method: "GET" }));
}

export async function trackNativeTransferFinality(hash: string, options: RequestOptions & { attempts?: number; intervalMs?: number; sleep?: (milliseconds: number) => Promise<void> } = {}): Promise<FinalityResult> {
  const attempts = options.attempts ?? 12;
  const intervalMs = options.intervalMs ?? 1_500;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 40) throw new Error("Finality attempts must be between 1 and 40");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 10_000) throw new Error("Finality interval must be between 0 and 10000 milliseconds");
  let latest: NativeTransaction | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);
    try {
      latest = await fetchNativeTransaction(hash, options);
      if (latest.blockNumber > 0) return Object.freeze({ status: "confirmed", transaction: latest });
    } catch (error) {
      if (!(error instanceof YNXRPCError) || error.status !== 404) throw error;
    }
  }
  if (!latest) throw new Error("YNX accepted the transfer but its transaction record is not observable yet");
  return Object.freeze({ status: "submitted", transaction: latest });
}

async function requestJSON(path: string, options: RequestOptions & { method: "GET" | "POST"; body?: string }): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${(options.rpcURL ?? DEFAULT_RPC_URL).replace(/\/$/, "")}${path}`, {
      method: options.method,
      body: options.body,
      headers: options.method === "POST" ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new YNXRPCError(`YNX RPC returned invalid JSON (${response.status})`, response.status);
  }
  if (!response.ok) throw new YNXRPCError(isPlainObject(value) && typeof value.error === "string" ? value.error : `YNX RPC failed (${response.status})`, response.status);
  return value;
}

function parseTransaction(value: unknown): NativeTransaction {
  if (!isPlainObject(value)) throw new Error("YNX transaction record is invalid");
  const hash = requiredString(value.hash, "transaction hash");
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("YNX transaction hash is not canonical");
  const timestamp = requiredString(value.timestamp, "transaction timestamp");
  if (Number.isNaN(new Date(timestamp).getTime())) throw new Error("YNX transaction timestamp is invalid");
  return Object.freeze({
    hash,
    type: requiredString(value.type, "transaction type"),
    from: optionalString(value.from),
    to: optionalString(value.to),
    amount: nonNegativeInteger(value.amount ?? 0, "transaction amount"),
    fee: nonNegativeInteger(value.fee ?? 0, "transaction fee"),
    nonce: nonNegativeInteger(value.nonce ?? 0, "transaction nonce"),
    blockNumber: nonNegativeInteger(value.blockNumber ?? 0, "transaction block number"),
    timestamp,
  });
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`YNX ${label} is not an exact non-negative integer`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`YNX ${label} is missing`);
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "YNX transaction activity is unavailable";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
