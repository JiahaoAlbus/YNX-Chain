import { DEFAULT_EVM_RPC_URL } from "./evmSimulation";

const CHAIN_ID = "0x1917";
const MAX_RESPONSE_BYTES = 256 * 1024;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class EvmBroadcastClient {
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMS: number;
  #id = 0;

  constructor(endpoint = DEFAULT_EVM_RPC_URL, fetcher: FetchLike = fetch, timeoutMS = 15_000) {
    this.#endpoint = strictEndpoint(endpoint);
    this.#fetch = fetcher;
    if (!Number.isSafeInteger(timeoutMS) || timeoutMS < 1 || timeoutMS > 30_000) throw new Error("EVM broadcast timeout is invalid");
    this.#timeoutMS = timeoutMS;
  }

  async broadcastRawTransaction(rawTransaction: string): Promise<string> {
    if (typeof rawTransaction !== "string" || !/^0x[0-9a-f]+$/.test(rawTransaction) || rawTransaction.length % 2 !== 0 || rawTransaction.length > 262_146) {
      throw new Error("Signed EVM transaction must be bounded canonical lowercase hex");
    }
    const chainId = await this.#rpc("eth_chainId", []);
    if (chainId !== CHAIN_ID) throw new Error("EVM RPC chain identity does not match YNX Testnet 0x1917");
    const hash = await this.#rpc("eth_sendRawTransaction", [rawTransaction]);
    if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("EVM RPC returned an invalid transaction hash");
    return hash;
  }

  async #rpc(method: "eth_chainId" | "eth_sendRawTransaction", params: readonly unknown[]): Promise<unknown> {
    const id = ++this.#id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMS);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const text = await boundedText(response);
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error(`EVM RPC returned non-JSON (${response.status})`); }
      if (!response.ok) throw new Error(`EVM RPC rejected ${method} (${response.status})`);
      if (!plainObject(value) || value.jsonrpc !== "2.0" || value.id !== id) throw new Error(`EVM RPC ${method} response binding is invalid`);
      const keys = Object.keys(value).sort().join(",");
      if ("error" in value) {
        if (keys !== "error,id,jsonrpc" || !plainObject(value.error) || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== "string" || value.error.message.length < 1 || value.error.message.length > 500) throw new Error(`EVM RPC ${method} error response is invalid`);
        throw new Error(`EVM RPC ${method} failed (${value.error.code}): ${value.error.message}`);
      }
      if (keys !== "id,jsonrpc,result") throw new Error(`EVM RPC ${method} response is invalid`);
      return value.result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("EVM RPC request timed out");
      throw error;
    } finally { clearTimeout(timeout); }
  }
}

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw new Error("EVM RPC response exceeds Wallet policy");
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new Error("EVM RPC response exceeds Wallet policy");
  return text;
}

function strictEndpoint(value: string): string {
  if (typeof value !== "string") throw new Error("EVM RPC URL is invalid");
  const parsed = new URL(value);
  const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "10.0.2.2"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.protocol !== "https:" && !local) throw new Error("EVM RPC URL is invalid");
  if (!local && parsed.pathname !== "/evm") throw new Error("EVM RPC HTTPS URL must use the frozen /evm path");
  if (local && parsed.pathname !== "/" && parsed.pathname !== "") throw new Error("Local EVM RPC URL must be an origin");
  return local ? parsed.origin : `${parsed.origin}/evm`;
}

function plainObject(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
