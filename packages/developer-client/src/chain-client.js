import { DeveloperError, invariant } from "./errors.js";

const PINNED = { compiler: "solc", version: "0.8.24", optimizer: true, optimizerRuns: 200 };

async function jsonRequest(fetcher, url, options = {}) {
  let response;
  try { response = await fetcher(url, { ...options, headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } }); }
  catch (error) { throw new DeveloperError("network_unavailable", "YNX service is unreachable.", { cause: String(error) }); }
  let value = null;
  try { value = await response.json(); } catch { /* explicit protocol failure below */ }
  if (!response.ok) throw new DeveloperError("upstream_rejected", value?.error || `YNX service returned HTTP ${response.status}.`, { status: response.status, response: value });
  invariant(value && typeof value === "object", "invalid_response", "YNX service returned a non-JSON response.");
  return value;
}

export class YNXChainClient {
  constructor({ baseURL = "http://127.0.0.1:6420", fetcher = fetch } = {}) { this.baseURL = baseURL.replace(/\/$/, ""); this.fetcher = fetcher; }
  health() { return jsonRequest(this.fetcher, `${this.baseURL}/status`); }
  compiler() { return jsonRequest(this.fetcher, `${this.baseURL}/ide/compiler`); }
  async assertPinnedCompiler() {
    const config = await this.compiler();
    invariant(String(config.version ?? config.compilerVersion) === PINNED.version, "compiler_mismatch", `YNX Developer requires pinned Solidity ${PINNED.version}.`, { config });
    invariant((config.optimizer?.enabled ?? config.optimizerEnabled) === true && Number(config.optimizer?.runs ?? config.optimizerRuns) === PINNED.optimizerRuns, "compiler_mismatch", "Pinned optimizer settings must be enabled with 200 runs.", { config });
    return config;
  }
  async compile({ name, source }) {
    invariant(typeof source === "string" && source.length > 0 && source.length <= 512 * 1024, "invalid_source", "Compile requires a Solidity source up to 512 KiB.");
    invariant(/pragma\s+solidity\s+(?:=\s*)?0\.8\.24\s*;/u.test(source), "unsupported_compiler_path", "Only exact pragma Solidity 0.8.24 is supported by this product.");
    await this.assertPinnedCompiler();
    const result = await jsonRequest(this.fetcher, `${this.baseURL}/ide/compile`, { method: "POST", body: JSON.stringify({ name, source }) });
    invariant(result.ok === true || result.OK === true, "compile_failed", "Compiler did not return successful evidence.", { result });
    return result;
  }
  transaction(hash) { invariant(/^0x[0-9a-f]{64}$/i.test(hash), "invalid_tx_hash", "Transaction hash must be 32-byte hex."); return jsonRequest(this.fetcher, `${this.baseURL}/txs/${hash}`); }
  receipt(hash) { return this.rpc("eth_getTransactionReceipt", [hash]); }
  logs(filter) { return this.rpc("eth_getLogs", [filter]); }
  contract(address) { return jsonRequest(this.fetcher, `${this.baseURL}/contracts/${encodeURIComponent(address)}`); }
  verifier(address) { return jsonRequest(this.fetcher, `${this.baseURL}/ide/verifier/${encodeURIComponent(address)}`); }
  verify({ address, source }) { return jsonRequest(this.fetcher, `${this.baseURL}/ide/verify`, { method: "POST", body: JSON.stringify({ address, source }) }); }
  rpc(method, params = []) {
    const allowed = new Set(["eth_chainId", "net_version", "eth_blockNumber", "eth_getBalance", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_call", "eth_getLogs", "eth_getBlockByNumber", "eth_getBlockByHash"]);
    invariant(allowed.has(method), "rpc_method_not_allowed", "RPC Tools are read-only and bounded to the documented YNX methods.", { method });
    return jsonRequest(this.fetcher, `${this.baseURL}/evm`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }) }).then((value) => {
      if (value.error) throw new DeveloperError("rpc_rejected", value.error.message || "RPC request failed.", { error: value.error });
      return value.result;
    });
  }
}

export const PINNED_COMPILER = Object.freeze(PINNED);
