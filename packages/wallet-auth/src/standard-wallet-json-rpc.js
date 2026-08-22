import { canonicalJSON } from "./canonical.js";
import { providerError } from "./standard-wallet-permissions.js";

const STANDARD_CHAIN_QUANTITY = "0x1917";

export const STANDARD_WALLET_CHAIN_METADATA = Object.freeze({
  chainId: STANDARD_CHAIN_QUANTITY,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

export const STANDARD_WALLET_NETWORK = Object.freeze({
  nativeChainId: "ynx_6423-1",
  evmChainId: 6423,
  chainId: STANDARD_CHAIN_QUANTITY,
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
});

export const STANDARD_WALLET_READ_METHODS = Object.freeze([
  "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice",
  "eth_getBalance", "eth_getBlockByHash", "eth_getBlockByNumber", "eth_getCode",
  "eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

export class StandardWalletJsonRpcRouter {
  #permissions;
  #rpcTransport;
  #signMessage;
  #signTypedData;
  #sendTransaction;

  constructor({ permissions, rpcTransport, signMessage, signTypedData, sendTransaction }) {
    if (!permissions || typeof permissions.requestAccounts !== "function" || typeof permissions.requireAccount !== "function") throw new TypeError("Wallet permission controller is invalid");
    for (const [name, value] of Object.entries({ rpcTransport, signMessage, signTypedData, sendTransaction })) if (value !== undefined && typeof value !== "function") throw new TypeError(`Wallet ${name} callback is invalid`);
    this.#permissions = permissions;
    this.#rpcTransport = rpcTransport;
    this.#signMessage = signMessage;
    this.#signTypedData = signTypedData;
    this.#sendTransaction = sendTransaction;
  }

  async request(input) {
    const { method, params } = parseRequest(input);
    switch (method) {
      case "eth_chainId": return STANDARD_WALLET_NETWORK.chainId;
      case "net_version": return String(STANDARD_WALLET_NETWORK.evmChainId);
      case "eth_accounts": requireNoParams(params); return this.#permissions.accounts;
      case "eth_requestAccounts": requireNoParams(params); return this.#permissions.requestAccounts();
      case "wallet_getPermissions": requireNoParams(params); return this.#permissions.permissions();
      case "wallet_requestPermissions": return this.#permissions.requestPermissions(singleObject(params));
      case "wallet_switchEthereumChain": return switchChain(singleObject(params));
      case "wallet_addEthereumChain": return addChain(singleObject(params));
      case "personal_sign": return this.#personalSign(params);
      case "eth_signTypedData_v4": return this.#typedSign(params);
      case "eth_sendTransaction": return this.#send(params);
      default:
        if (STANDARD_WALLET_READ_METHODS.includes(method)) return this.#read(method, params);
        throw providerError(4200, "The requested JSON-RPC method is not supported");
    }
  }

  async #personalSign(params) {
    if (!Array.isArray(params) || params.length !== 2 || typeof params[0] !== "string") throw providerError(-32602, "personal_sign parameters are invalid");
    if (new TextEncoder().encode(params[0]).byteLength > 131072 || (params[0].startsWith("0x") && !/^0x(?:[0-9a-fA-F]{2})*$/.test(params[0]))) throw providerError(-32602, "personal_sign message is invalid or too large");
    const account = this.#permissions.requireAccount(params[1]);
    if (typeof this.#signMessage !== "function") throw providerError(4200, "Message signing is unavailable");
    return signature(await this.#signMessage(Object.freeze({ origin: this.#permissions.origin, account, message: params[0], method: "personal_sign" })));
  }

  async #typedSign(params) {
    if (!Array.isArray(params) || params.length !== 2) throw providerError(-32602, "eth_signTypedData_v4 parameters are invalid");
    const account = this.#permissions.requireAccount(params[0]);
    let typedData = params[1];
    if (typeof typedData === "string") try { typedData = JSON.parse(typedData); } catch { throw providerError(-32602, "Typed data JSON is invalid"); }
    if (!object(typedData)) throw providerError(-32602, "Typed data is invalid");
    const frozenJson = canonicalJSON(typedData);
    if (new TextEncoder().encode(frozenJson).byteLength > 131072) throw providerError(-32602, "Typed data exceeds the Wallet limit");
    if (typeof this.#signTypedData !== "function") throw providerError(4200, "Typed data signing is unavailable");
    return signature(await this.#signTypedData(Object.freeze({ origin: this.#permissions.origin, account, typedData: JSON.parse(frozenJson), method: "eth_signTypedData_v4" })));
  }

  async #send(params) {
    const transaction = singleObject(params);
    const allowed = new Set(["from", "to", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "value", "data", "nonce", "chainId", "type", "accessList"]);
    if (Object.keys(transaction).some((key) => !allowed.has(key))) throw providerError(-32602, "Transaction contains an unsupported field");
    const from = this.#permissions.requireAccount(transaction.from);
    if (transaction.chainId !== undefined && transaction.chainId !== STANDARD_WALLET_NETWORK.chainId) throw providerError(4901, "Transaction targets a different chain");
    validateTransaction(transaction);
    if (typeof this.#sendTransaction !== "function") throw providerError(4200, "Transaction submission is unavailable");
    const hash = await this.#sendTransaction(Object.freeze({ origin: this.#permissions.origin, account: from, transaction: Object.freeze({ ...transaction, from, chainId: STANDARD_WALLET_NETWORK.chainId }) }));
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw providerError(-32603, "Wallet returned an invalid transaction hash");
    return hash.toLowerCase();
  }

  async #read(method, params) {
    if (typeof this.#rpcTransport !== "function") throw providerError(4900, "YNX Testnet RPC is unavailable");
    try { return await this.#rpcTransport(Object.freeze({ method, params: params ?? [] }), STANDARD_WALLET_NETWORK); }
    catch { throw providerError(4900, "YNX Testnet RPC request failed"); }
  }
}

function parseRequest(value) {
  if (!object(value) || Object.keys(value).some((key) => key !== "method" && key !== "params") || typeof value.method !== "string" || !/^[a-z][A-Za-z0-9_]{1,63}$/.test(value.method)) throw providerError(-32600, "EIP-1193 request is invalid");
  if (value.params !== undefined && !Array.isArray(value.params) && !object(value.params)) throw providerError(-32602, "JSON-RPC parameters are invalid");
  let encoded;
  try { encoded = canonicalJSON(value); } catch { throw providerError(-32600, "EIP-1193 request is not canonicalizable"); }
  if (new TextEncoder().encode(encoded).byteLength > 262144) throw providerError(-32600, "EIP-1193 request exceeds the Wallet limit");
  return { method: value.method, params: value.params };
}
function requireNoParams(params) { if (params !== undefined && (!Array.isArray(params) || params.length !== 0)) throw providerError(-32602, "This method does not accept parameters"); }
function singleObject(params) { if (!Array.isArray(params) || params.length !== 1 || !object(params[0])) throw providerError(-32602, "JSON-RPC parameters are invalid"); return params[0]; }
function switchChain(value) { if (Object.keys(value).join(",") !== "chainId" || value.chainId !== STANDARD_WALLET_NETWORK.chainId) throw providerError(4902, "Only YNX Testnet chain 0x1917 is available"); return null; }
function addChain(value) {
  const exact = { ...STANDARD_WALLET_CHAIN_METADATA, nativeCurrency: { ...STANDARD_WALLET_CHAIN_METADATA.nativeCurrency }, rpcUrls: [...STANDARD_WALLET_CHAIN_METADATA.rpcUrls], blockExplorerUrls: [...STANDARD_WALLET_CHAIN_METADATA.blockExplorerUrls] };
  if (canonicalJSON(value) !== canonicalJSON(exact)) throw providerError(-32602, "YNX Testnet chain metadata is not canonical");
  return null;
}
function signature(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) throw providerError(-32603, "Wallet returned an invalid signature"); return value.toLowerCase(); }
function validateTransaction(value) {
  if (value.to !== undefined && value.to !== null && (typeof value.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.to))) throw providerError(-32602, "Transaction recipient is invalid");
  for (const field of ["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "value", "nonce", "type"]) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value[field]))) throw providerError(-32602, `Transaction ${field} is not a canonical quantity`);
  }
  if (value.data !== undefined && (typeof value.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.data))) throw providerError(-32602, "Transaction data is invalid");
  if (value.accessList !== undefined && !Array.isArray(value.accessList)) throw providerError(-32602, "Transaction accessList is invalid");
  if (new TextEncoder().encode(canonicalJSON(value)).byteLength > 131072) throw providerError(-32602, "Transaction exceeds the Wallet limit");
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
