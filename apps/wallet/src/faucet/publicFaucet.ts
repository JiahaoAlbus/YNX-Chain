export const OFFICIAL_FAUCET_URL = "https://faucet.ynxweb4.com";
export const ACCEPTED_FAUCET_MANIFEST = Object.freeze({
  version: "1.0.0-p0.3",
  payloadSha256: "886ae7a2f4ef691301483da037cd4f5e1274b697865834769f20f0e799952157",
  healthUrl: "https://faucet.ynxweb4.com/health",
  versionUrl: "https://faucet.ynxweb4.com/version",
  requestUrl: "https://faucet.ynxweb4.com/request",
  chainId: 6423,
  release: "ynx-chain-ea0e068becd9",
});
const HEALTH_URL = `${OFFICIAL_FAUCET_URL}/health`;
const VERSION_URL = `${OFFICIAL_FAUCET_URL}/version`;
const REQUEST_URL = `${OFFICIAL_FAUCET_URL}/request`;
const MAX_BYTES = 64 * 1024;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PublicFaucetHealth = Readonly<{
  ok: true;
  service: "ynx-faucetd";
  height: number;
  upstreamOk: true;
  chainId: 6423;
  nativeSymbol: "YNXT";
  dependencies: readonly Readonly<{name:"chain-rpc";required:true;ok:true}>[];
  build: Readonly<{commit:string;release:string;buildTime:string}>;
  startedAt: string;
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
  constructor(readonly code: "FAUCET_UNAVAILABLE" | "FAUCET_VERSION_INCOMPATIBLE", message: string, readonly diagnostic: "TRANSPORT_UNAVAILABLE" | "HEALTH_CONTRACT_INVALID" | "VERSION_PROOF_INCOMPLETE" | "UNSAFE_RESPONSE") {
    super(message);
    this.name = "FaucetEndpointError";
  }
}

export async function loadPublicFaucetHealth(fetcher: FetchLike = fetch): Promise<PublicFaucetHealth> {
  const value = await readJSON(fetcher, HEALTH_URL, { method: "GET", headers: { Accept: "application/json" } }, "health");
  if (!safePublicHealth(value)) {
    throw new FaucetEndpointError("FAUCET_VERSION_INCOMPATIBLE", "Faucet health contract is invalid. Only Testnet Faucet is degraded; Wallet accounts, chain reads, and Connected Apps remain separate.", "HEALTH_CONTRACT_INVALID");
  }
  const version = await readJSON(fetcher, VERSION_URL, { method: "GET", headers: { Accept: "application/json" } }, "version");
  if (!safePublicVersion(version) || version.build.commit !== value.build.commit || version.build.release !== value.build.release || version.build.commit !== "ea0e068becd9" || version.build.release !== ACCEPTED_FAUCET_MANIFEST.release) {
    throw new FaucetEndpointError("FAUCET_VERSION_INCOMPATIBLE", "Faucet version proof is incomplete. Only Testnet Faucet is degraded; Wallet accounts, chain reads, and Connected Apps remain separate.", "VERSION_PROOF_INCOMPLETE");
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
    throw new FaucetEndpointError("FAUCET_UNAVAILABLE", "Faucet transport is unavailable. Only Testnet Faucet is degraded; Wallet accounts, chain reads, and Connected Apps remain separate.", "TRANSPORT_UNAVAILABLE");
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new FaucetEndpointError("FAUCET_VERSION_INCOMPATIBLE", "Faucet response exceeds the safe size limit. Only Testnet Faucet is degraded; Wallet accounts, chain reads, and Connected Apps remain separate.", "UNSAFE_RESPONSE");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new FaucetEndpointError(endpoint === "request" ? "FAUCET_UNAVAILABLE" : "FAUCET_VERSION_INCOMPATIBLE", "Faucet response is not valid JSON. Only Testnet Faucet is degraded; Wallet accounts, chain reads, and Connected Apps remain separate.", "UNSAFE_RESPONSE"); }
  if (!response.ok) {
    const detail = record(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
    if (endpoint === "request") throw new Error(`Faucet request rejected: ${detail}`);
    throw new FaucetEndpointError(endpoint === "version" ? "FAUCET_VERSION_INCOMPATIBLE" : "FAUCET_UNAVAILABLE", `Faucet ${endpoint} rejected: ${detail}. Only Testnet Faucet is degraded; Wallet accounts, chain reads, and Connected Apps remain separate.`, endpoint === "version" ? "VERSION_PROOF_INCOMPLETE" : "HEALTH_CONTRACT_INVALID");
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function timestamp(value: unknown): value is string { return typeof value === "string" && value.length >= 20 && Number.isFinite(Date.parse(value)); }
function safeBuild(value: unknown): value is {commit:string;release:string;buildTime:string} { return record(value) && typeof value.commit === "string" && /^[0-9a-f]{12,40}$/i.test(value.commit) && typeof value.release === "string" && value.release.length >= 12 && timestamp(value.buildTime); }
function safeDependencies(value: unknown): boolean { return Array.isArray(value) && value.length === 1 && record(value[0]) && value[0].name === "chain-rpc" && value[0].required === true && value[0].ok === true; }
function safePublicHealth(value: unknown): value is PublicFaucetHealth { return record(value) && !["rpcUrl","requestLog","lastError","requestPath","defaultAmount","maxAmount","rateLimit","upstreamMode"].some((key)=>key in value) && value.ok === true && value.service === "ynx-faucetd" && value.chainId === ACCEPTED_FAUCET_MANIFEST.chainId && positive(value.height) && value.nativeSymbol === "YNXT" && value.upstreamOk === true && safeDependencies(value.dependencies) && safeBuild(value.build) && timestamp(value.startedAt) && (value.truthfulStatus === "rpc-backed-faucet" || value.truthfulStatus === "bft-gateway-signed-faucet"); }
function safePublicVersion(value: unknown): value is {service:"ynx-faucetd";build:{commit:string;release:string;buildTime:string};startedAt:string;dependencies:unknown[]} { return record(value) && value.service === "ynx-faucetd" && safeBuild(value.build) && timestamp(value.startedAt) && safeDependencies(value.dependencies); }
