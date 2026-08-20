import { ChainNetworkError } from "../chain/nativeTransfer";

export const OFFICIAL_FAUCET_URL = "https://faucet.ynxweb4.com";
const HEALTH_URL = `${OFFICIAL_FAUCET_URL}/health`;
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

export async function loadPublicFaucetHealth(fetcher: FetchLike = fetch): Promise<PublicFaucetHealth> {
  const value = await readJSON(fetcher, HEALTH_URL, { method: "GET", headers: { Accept: "application/json" } });
  if (!record(value) || "rpcUrl" in value || "requestLog" in value || "lastError" in value || value.ok !== true || value.service !== "ynx-faucetd" || value.upstreamOk !== true || value.chainId !== 6423 || value.nativeSymbol !== "YNXT" || value.requestPath !== "/request" || (value.upstreamMode !== "authoritative" && value.upstreamMode !== "bft") || (value.truthfulStatus !== "rpc-backed-faucet" && value.truthfulStatus !== "bft-gateway-signed-faucet") || !positive(value.defaultAmount) || !positive(value.maxAmount) || value.defaultAmount > value.maxAmount || typeof value.rateLimit !== "string" || value.rateLimit.length < 3) {
    throw new Error("Public Faucet health response is invalid or leaks an internal endpoint");
  }
  return Object.freeze(value as PublicFaucetHealth);
}

export async function requestPublicFaucet(account: string, fetcher: FetchLike = fetch): Promise<FaucetRequestResult> {
  if (!/^ynx1[0-9a-z]{20,90}$/.test(account)) throw new Error("Faucet recipient must be a canonical YNX Wallet address");
  const value = await readJSON(fetcher, REQUEST_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ address: account }),
  });
  if (!record(value) || !record(value.transaction) || typeof value.transaction.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(value.transaction.hash) || !positive(value.amount) || value.nativeSymbol !== "YNXT" || (value.truthfulStatus !== "rpc-backed-faucet" && value.truthfulStatus !== "bft-gateway-signed-faucet")) {
    throw new Error("Public Faucet request response is invalid");
  }
  return Object.freeze({ hash: value.transaction.hash, amount: value.amount, nativeSymbol: value.nativeSymbol, truthfulStatus: value.truthfulStatus });
}

async function readJSON(fetcher: FetchLike, url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new ChainNetworkError("transport");
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("Public Faucet response exceeds the safe size limit");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Public Faucet response is not JSON"); }
  if (!response.ok) {
    const detail = record(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
    throw new Error(`Faucet request rejected: ${detail}`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
