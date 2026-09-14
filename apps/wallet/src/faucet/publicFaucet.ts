export const OFFICIAL_FAUCET_URL = "https://faucet.ynxweb4.com";
const HEALTH_URL = `${OFFICIAL_FAUCET_URL}/health`;
const VERSION_URL = `${OFFICIAL_FAUCET_URL}/version`;
const REQUEST_URL = `${OFFICIAL_FAUCET_URL}/request`;
const MAX_BYTES = 64 * 1024;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PublicFaucetHealth = Readonly<{
  ok: true;
  service: "ynx-faucetd";
  upstreamMode: "authoritative" | "bft";
  upstreamOk: true;
  chainId: 6423;
  nativeSymbol: "YNXT";
  defaultAmount: number;
  maxAmount: number;
  rateLimit: string;
  requestPath: "/request";
  truthfulStatus: "rpc-backed-faucet" | "bft-gateway-signed-faucet";
}>;

export type FaucetRequestResult = Readonly<{
  hash: string;
  amount: number;
  nativeSymbol: "YNXT";
  truthfulStatus: "rpc-backed-faucet" | "bft-gateway-signed-faucet";
}>;

/**
 * A Faucet service can be reachable while still being unsafe for an installed
 * Wallet to use. Keep that distinct from a transport outage: callers must not
 * label a bad release contract as a disconnected Wallet or chain.
 */
export class FaucetEndpointError extends Error {
  constructor(readonly code: "FAUCET_UNAVAILABLE" | "FAUCET_VERSION_INCOMPATIBLE", message: string) {
    super(message);
    this.name = "FaucetEndpointError";
  }
}

export async function loadPublicFaucetHealth(fetcher: FetchLike = fetch): Promise<PublicFaucetHealth> {
  const value = await readJSON(fetcher, HEALTH_URL, { method: "GET", headers: { Accept: "application/json" } }, "health");
  if (!record(value) || "rpcUrl" in value || "requestLog" in value || "lastError" in value || value.ok !== true || value.service !== "ynx-faucetd" || value.upstreamOk !== true || value.chainId !== 6423 || value.nativeSymbol !== "YNXT" || value.requestPath !== "/request" || (value.upstreamMode !== "authoritative" && value.upstreamMode !== "bft") || (value.truthfulStatus !== "rpc-backed-faucet" && value.truthfulStatus !== "bft-gateway-signed-faucet") || !positive(value.defaultAmount) || !positive(value.maxAmount) || value.defaultAmount > value.maxAmount || typeof value.rateLimit !== "string" || value.rateLimit.length < 3) {
    throw new FaucetEndpointError("FAUCET_VERSION_INCOMPATIBLE", "Public Faucet health response is invalid or leaks an internal endpoint");
  }
  const version = await readJSON(fetcher, VERSION_URL, { method: "GET", headers: { Accept: "application/json" } }, "version");
  if (!record(version) || version.service !== "ynx-faucetd" || !record(version.build) || typeof version.build.commit !== "string" || version.build.commit.length < 7 || typeof version.build.release !== "string" || version.build.release.length < 3 || typeof version.build.buildTime !== "string" || version.build.buildTime.length < 10) {
    throw new FaucetEndpointError("FAUCET_VERSION_INCOMPATIBLE", "Public Faucet version response is missing the required release identity");
  }
  return Object.freeze(value as PublicFaucetHealth);
}

export async function requestPublicFaucet(account: string, fetcher: FetchLike = fetch): Promise<FaucetRequestResult> {
  if (!/^ynx1[0-9a-z]{20,90}$/.test(account)) throw new Error("Faucet recipient must be a canonical YNX Wallet address");
  const value = await readJSON(fetcher, REQUEST_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ address: account }),
  }, "request");
  if (!record(value) || !record(value.transaction) || typeof value.transaction.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(value.transaction.hash) || !positive(value.amount) || value.nativeSymbol !== "YNXT" || (value.truthfulStatus !== "rpc-backed-faucet" && value.truthfulStatus !== "bft-gateway-signed-faucet")) {
    throw new Error("Public Faucet request response is invalid");
  }
  return Object.freeze({ hash: value.transaction.hash, amount: value.amount, nativeSymbol: value.nativeSymbol, truthfulStatus: value.truthfulStatus });
}

async function readJSON(fetcher: FetchLike, url: string, init: RequestInit, endpoint: "health" | "version" | "request"): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new FaucetEndpointError("FAUCET_UNAVAILABLE", "Public Faucet network transport is unavailable");
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new FaucetEndpointError("FAUCET_VERSION_INCOMPATIBLE", "Public Faucet response exceeds the safe size limit");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new FaucetEndpointError(endpoint === "request" ? "FAUCET_UNAVAILABLE" : "FAUCET_VERSION_INCOMPATIBLE", "Public Faucet response is not JSON"); }
  if (!response.ok) {
    const detail = record(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
    if (endpoint === "request") throw new Error(`Faucet request rejected: ${detail}`);
    throw new FaucetEndpointError(endpoint === "version" ? "FAUCET_VERSION_INCOMPATIBLE" : "FAUCET_UNAVAILABLE", `Public Faucet ${endpoint} rejected: ${detail}`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
