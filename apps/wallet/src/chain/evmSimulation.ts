import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { DEFAULT_CHAIN_RPC } from "./nativeTransfer";

const EVM_CHAIN_ID = 6423;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_UINT256 = (1n << 256n) - 1n;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type EvmSimulationInput = Readonly<{
  from: string;
  to: string;
  data: string;
  valueWei: string;
}>;

export type EvmSimulationResult = Readonly<{
  chainId: 6423;
  blockNumber: number;
  from: string;
  to: string;
  data: string;
  methodSelector: string;
  valueWei: string;
  gasEstimate: string;
  returnData: string;
  contractCodeHash: string;
  contractCodeBytes: number;
  source: string;
  asOf: string;
  truthfulStatus: "read-only-evm-simulation-no-sign-no-broadcast";
}>;

export class EvmSimulationClient {
  readonly #origin: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  #id = 0;

  constructor(baseURL = DEFAULT_CHAIN_RPC, fetcher: FetchLike = fetch, now: () => Date = () => new Date()) {
    this.#origin = strictOrigin(baseURL);
    this.#fetch = fetcher;
    this.#now = now;
  }

  async simulate(raw: EvmSimulationInput): Promise<EvmSimulationResult> {
    const input = parseInput(raw);
    const chainId = parseQuantity(await this.#rpc("eth_chainId", []), "chainId");
    if (chainId !== EVM_CHAIN_ID) throw new Error(`EVM RPC chain mismatch: expected ${EVM_CHAIN_ID}, received ${chainId}`);
    const blockNumber = parseQuantity(await this.#rpc("eth_blockNumber", []), "blockNumber");
    const blockTag = quantityHex(BigInt(blockNumber));
    const code = parseData(await this.#rpc("eth_getCode", [input.to, blockTag]), "contract code", 2_000_000);
    if (code === "0x" || /^0x0*$/.test(code)) throw new Error("EVM target has no deployed contract code");
    const transaction = Object.freeze({ from: input.from, to: input.to, data: input.data, value: quantityHex(BigInt(input.valueWei)) });
    const returnData = parseData(await this.#rpc("eth_call", [transaction, blockTag]), "simulation return data", 2_000_000);
    const gasEstimate = parseQuantityBigInt(await this.#rpc("eth_estimateGas", [transaction]), "gasEstimate");
    if (gasEstimate <= 0n) throw new Error("EVM gas estimate must be positive");
    const asOf = strictNow(this.#now()).toISOString();
    const codeBytes = hexToBytes(code.slice(2));
    return Object.freeze({
      chainId: EVM_CHAIN_ID,
      blockNumber,
      from: input.from,
      to: input.to,
      data: input.data,
      methodSelector: input.data.length >= 10 ? input.data.slice(0, 10) : "receive-or-fallback",
      valueWei: input.valueWei,
      gasEstimate: gasEstimate.toString(),
      returnData,
      contractCodeHash: `0x${bytesToHex(keccak_256(codeBytes))}`,
      contractCodeBytes: codeBytes.length,
      source: this.#origin,
      asOf,
      truthfulStatus: "read-only-evm-simulation-no-sign-no-broadcast",
    });
  }

  async #rpc(method: string, params: readonly unknown[]): Promise<unknown> {
    const id = ++this.#id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.#fetch(this.#origin, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const text = await boundedText(response);
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error(`EVM RPC returned non-JSON (${response.status})`); }
      if (!response.ok) throw new Error(`EVM RPC rejected ${method} (${response.status})`);
      if (!plainObject(value)) throw new Error(`EVM RPC ${method} response is invalid`);
      const keys = Object.keys(value).sort().join(",");
      if ("error" in value) {
        if (keys !== "error,id,jsonrpc" || value.jsonrpc !== "2.0" || value.id !== id || !plainObject(value.error) || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== "string" || value.error.message.length < 1 || value.error.message.length > 500) {
          throw new Error(`EVM RPC ${method} error response is invalid`);
        }
        throw new Error(`EVM RPC ${method} failed (${value.error.code}): ${value.error.message}`);
      }
      if (keys !== "id,jsonrpc,result" || value.jsonrpc !== "2.0" || value.id !== id) throw new Error(`EVM RPC ${method} response binding is invalid`);
      return value.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseInput(value: EvmSimulationInput) {
  if (!plainObject(value) || Object.keys(value).sort().join(",") !== "data,from,to,valueWei") throw new Error("EVM simulation input has unknown or missing fields");
  const from = strictAddress(value.from, "from");
  const to = strictAddress(value.to, "to");
  if (from === to) throw new Error("EVM simulation target must differ from the Wallet account");
  const data = parseData(value.data, "calldata", 131_072);
  if (typeof value.valueWei !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value.valueWei)) throw new Error("EVM valueWei must be a canonical unsigned decimal string");
  const valueWei = BigInt(value.valueWei);
  if (valueWei > MAX_UINT256) throw new Error("EVM valueWei exceeds uint256");
  return Object.freeze({ from, to, data, valueWei: value.valueWei });
}

function strictAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) throw new Error(`EVM ${label} address must be lowercase canonical hex`);
  return value;
}

function parseData(value: unknown, label: string, maxHexCharacters: number): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(value) || value.length > maxHexCharacters + 2) throw new Error(`EVM ${label} must be bounded lowercase even-length hex data`);
  return value;
}

function parseQuantity(value: unknown, label: string): number {
  const parsed = parseQuantityBigInt(value, label);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`EVM ${label} exceeds safe integer range`);
  return Number(parsed);
}

function parseQuantityBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) throw new Error(`EVM ${label} is not a canonical hex quantity`);
  return BigInt(value);
}

function quantityHex(value: bigint): string { return `0x${value.toString(16)}`; }

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw new Error("EVM RPC response exceeds Wallet policy");
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new Error("EVM RPC response exceeds Wallet policy");
  return text;
}

function strictOrigin(value: string): string {
  if (typeof value !== "string") throw new Error("EVM RPC URL is invalid");
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !["/", "/evm"].includes(parsed.pathname)) throw new Error("EVM RPC URL must be the exact root or /evm endpoint");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "10.0.2.2"].includes(parsed.hostname))) throw new Error("EVM RPC requires HTTPS except local development");
  return parsed.pathname === "/" ? parsed.origin : `${parsed.origin}/evm`;
}

function strictNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("EVM simulation clock is invalid");
  return value;
}

function plainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
