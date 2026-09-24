import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Interface } from "ethers";
import { DEFAULT_CHAIN_API } from "./nativeTransfer";

const ABI = new Interface([
  "function TEST_MARKER() view returns (bytes32)", "function CHAIN_ID() view returns (uint256)",
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)", "function cap() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function stock() view returns (address)", "function tusd() view returns (address)",
  "function stockCodeHash() view returns (bytes32)", "function tusdCodeHash() view returns (bytes32)",
]);
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const DATA = /^0x(?:[0-9a-f]{2})*$/;
const MARKER = `0x${markerHex()}`;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type AssetSymbol = "TEST-AAPL" | "tUSD";
export type TestMarketDirectory = Readonly<{
  version: "ynx-test-market-wallet-v1";
  network: "ynx_6423-1";
  chainId: 6423;
  testOnly: true;
  status: "NOT_VERIFIED" | "VERIFIED";
  sourceManifestSha256: string | null;
  deployment: null | Readonly<{
    stock: string; cash: string; dvp: string;
    stockCodeHash: string; cashCodeHash: string; dvpCodeHash: string;
    receipts: Readonly<Record<"stock" | "cash" | "dvp", Readonly<{blockNumber:number;blockHash:string;transactionHash:string}>>>;
  }>;
}>;

// No public deployment has been established. A future reviewed source update must
// pin actual addresses, receipt and code hashes before this can read balances.
export const TEST_MARKET_DIRECTORY: TestMarketDirectory = Object.freeze({
  version: "ynx-test-market-wallet-v1", network: "ynx_6423-1", chainId: 6423,
  testOnly: true, status: "NOT_VERIFIED", sourceManifestSha256: null, deployment: null,
});

const ASSETS = Object.freeze([
  { symbol: "TEST-AAPL" as const, name: "YNX Test AAPL", cap: 1_000_000_000_000n },
  { symbol: "tUSD" as const, name: "YNX Test USD", cap: 10_000_000_000_000n },
]);

export type TestMarketAssetView = Readonly<{
  symbol: AssetSymbol; name: string; decimals: 6; balanceUnits: string;
  allowanceToDvpUnits: string; blockNumber: number; blockHash: string;
  source: string; asOf: string;
  transferAvailable: false; approvalAvailable: false; orderApprovalAvailable: false;
}>;

export class TestMarketAssetClient {
  readonly #origin: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  #id = 0;
  constructor(baseURL = DEFAULT_CHAIN_API, fetcher: FetchLike = fetch, now: () => Date = () => new Date()) {
    const url = new URL(baseURL);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "") ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname))))
      throw new Error("Test market RPC origin is invalid");
    this.#origin = url.origin; this.#fetch = fetcher; this.#now = now;
  }

  async read(account: string, directory: TestMarketDirectory = TEST_MARKET_DIRECTORY): Promise<readonly TestMarketAssetView[]> {
    const deployment = verifiedDeployment(directory);
    if (!ADDRESS.test(account)) throw new Error("Test market account must be a canonical lowercase 0x address");
    if (quantity(await this.#rpc("eth_chainId", [])) !== 6423n) throw new Error("Test market RPC chain mismatch");
    const head = quantity(await this.#rpc("eth_blockNumber", []));
    if (head > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Test market head exceeds safe range");
    for (const key of ["stock", "cash", "dvp"] as const) {
      const pin = deployment.receipts[key];
      if (head < BigInt(pin.blockNumber)) throw new Error("Test market deployment block unavailable");
      const receipt = await this.#rpc("eth_getTransactionReceipt", [pin.transactionHash]);
      if (!plainObject(receipt) || receipt.transactionHash !== pin.transactionHash ||
        receipt.blockNumber !== `0x${pin.blockNumber.toString(16)}` || receipt.blockHash !== pin.blockHash ||
        receipt.contractAddress !== deployment[key] || receipt.status !== "0x1")
        throw new Error("Test market deployment receipt mismatch");
      const deploymentBlock = await this.#rpc("eth_getBlockByNumber", [`0x${pin.blockNumber.toString(16)}`, false]);
      if (!plainObject(deploymentBlock) || deploymentBlock.hash !== pin.blockHash ||
        deploymentBlock.number !== `0x${pin.blockNumber.toString(16)}`) throw new Error("Test market deployment block mismatch");
    }
    const blockTag = `0x${head.toString(16)}`;
    const block = await this.#rpc("eth_getBlockByNumber", [blockTag, false]);
    if (!plainObject(block) || block.number !== blockTag || !HASH.test(block.hash) ||
      (["stock", "cash", "dvp"] as const).some(key => head === BigInt(deployment.receipts[key].blockNumber) && block.hash !== deployment.receipts[key].blockHash))
      throw new Error("Test market block binding invalid");
    const contracts = [
      [deployment.stock, deployment.stockCodeHash], [deployment.cash, deployment.cashCodeHash], [deployment.dvp, deployment.dvpCodeHash],
    ] as const;
    for (const [address, expected] of contracts) {
      const code = data(await this.#rpc("eth_getCode", [address, blockTag]));
      if (code === "0x" || `0x${bytesToHex(keccak_256(hexToBytes(code.slice(2))))}` !== expected) throw new Error("Test market deployed code hash mismatch");
    }
    for (const [index, asset] of ASSETS.entries()) {
      const address = index === 0 ? deployment.stock : deployment.cash;
      if (await this.#call(address, "TEST_MARKER", [], blockTag) !== MARKER ||
        await this.#call(address, "CHAIN_ID", [], blockTag) !== 6423n ||
        await this.#call(address, "name", [], blockTag) !== asset.name ||
        await this.#call(address, "symbol", [], blockTag) !== asset.symbol ||
        await this.#call(address, "decimals", [], blockTag) !== 6n ||
        await this.#call(address, "cap", [], blockTag) !== asset.cap) throw new Error("Test market asset metadata mismatch");
    }
    for (const [method, expected] of [
      ["stock", deployment.stock], ["tusd", deployment.cash],
      ["stockCodeHash", deployment.stockCodeHash], ["tusdCodeHash", deployment.cashCodeHash],
    ] as const) {
      if (String(await this.#call(deployment.dvp, method, [], blockTag)).toLowerCase() !== expected)
        throw new Error("Test market settlement binding mismatch");
    }
    const result: TestMarketAssetView[] = [];
    for (const [index, asset] of ASSETS.entries()) {
      const address = index === 0 ? deployment.stock : deployment.cash;
      const balance = await this.#call(address, "balanceOf", [account], blockTag);
      const allowance = await this.#call(address, "allowance", [account, deployment.dvp], blockTag);
      if (typeof balance !== "bigint" || typeof allowance !== "bigint") throw new Error("Test market balance response invalid");
      const asOf = this.#now();
      if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) throw new Error("Test market clock invalid");
      result.push(Object.freeze({ symbol: asset.symbol, name: asset.name, decimals: 6,
        balanceUnits: balance.toString(), allowanceToDvpUnits: allowance.toString(),
        blockNumber: Number(head), blockHash: block.hash, source: this.#origin, asOf: asOf.toISOString(),
        transferAvailable: false, approvalAvailable: false, orderApprovalAvailable: false }));
    }
    const latest = await this.#rpc("eth_getBlockByNumber", [blockTag, false]);
    if (!plainObject(latest) || latest.hash !== block.hash || latest.number !== blockTag) throw new Error("Test market block changed during read");
    return Object.freeze(result);
  }

  async #call(address: string, method: string, args: readonly unknown[], blockTag: string): Promise<unknown> {
    const request = ABI.encodeFunctionData(method, [...args]);
    const response = data(await this.#rpc("eth_call", [{ to: address, data: request }, blockTag]));
    try { return ABI.decodeFunctionResult(method, response)[0]; }
    catch { throw new Error(`Test market ${method} response invalid`); }
  }

  async #rpc(method: string, params: readonly unknown[]): Promise<unknown> {
    const id = ++this.#id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.#fetch(this.#origin, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal });
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 262144)) throw new Error("Test market RPC response too large");
      const raw = await response.text();
      if (new TextEncoder().encode(raw).length > 262144) throw new Error("Test market RPC response too large");
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new Error("Test market RPC returned invalid JSON"); }
      if (!response.ok || !plainObject(value) || value.jsonrpc !== "2.0" || value.id !== id) throw new Error(`Test market RPC ${method} binding invalid`);
      if (Object.keys(value).sort().join(",") !== "id,jsonrpc,result") throw new Error(`Test market RPC ${method} failed or added unrecognized fields`);
      return value.result;
    } finally { clearTimeout(timeout); }
  }
}

function verifiedDeployment(directory: TestMarketDirectory): NonNullable<TestMarketDirectory["deployment"]> {
  if (!plainObject(directory) || Object.keys(directory).sort().join(",") !== "chainId,deployment,network,sourceManifestSha256,status,testOnly,version" ||
    directory.version !== "ynx-test-market-wallet-v1" || directory.network !== "ynx_6423-1" || directory.chainId !== 6423 ||
    directory.testOnly !== true || directory.status !== "VERIFIED" || typeof directory.sourceManifestSha256 !== "string" || !HASH.test(directory.sourceManifestSha256))
    throw new Error("Test market public deployment is not verified");
  const d = directory.deployment;
  if (!plainObject(d) || Object.keys(d).sort().join(",") !== "cash,cashCodeHash,dvp,dvpCodeHash,receipts,stock,stockCodeHash" ||
    !ADDRESS.test(d.stock) || !ADDRESS.test(d.cash) || !ADDRESS.test(d.dvp) ||
    new Set([d.stock, d.cash, d.dvp]).size !== 3 ||
    !HASH.test(d.stockCodeHash) || !HASH.test(d.cashCodeHash) || !HASH.test(d.dvpCodeHash))
    throw new Error("Test market deployment pin is incomplete");
  if (!plainObject(d.receipts) || Object.keys(d.receipts).sort().join(",") !== "cash,dvp,stock") throw new Error("Test market deployment receipts are incomplete");
  for (const key of ["stock", "cash", "dvp"] as const) {
    const pin = d.receipts[key];
    if (!plainObject(pin) || Object.keys(pin).sort().join(",") !== "blockHash,blockNumber,transactionHash" ||
      !Number.isSafeInteger(pin.blockNumber) || pin.blockNumber < 1 || !HASH.test(pin.blockHash) || !HASH.test(pin.transactionHash))
      throw new Error("Test market deployment receipt pin is incomplete");
  }
  return d;
}

function data(value: unknown): string {
  if (typeof value !== "string" || !DATA.test(value) || value.length > 2_000_002) throw new Error("Test market RPC data invalid");
  return value;
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) throw new Error("Test market RPC quantity invalid");
  return BigInt(value);
}
function plainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function markerHex(): string {
  return Array.from(new TextEncoder().encode("YNX-6423-TEST-ONLY"), byte => byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0");
}
