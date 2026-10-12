// One read contract for IDE consumers. Transport is supplied by the admitted
// host; this module does not discover endpoints, obtain credentials or sign.
export const CHAIN_PROTOCOL = 'ynx-code-chain/v1';
export const TESTNET_CHAIN_ID = 6423;
export const READ_RPC_METHODS = Object.freeze(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_gasPrice',
  'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_call', 'eth_estimateGas', 'eth_getLogs', 'eth_getBlockByNumber', 'eth_getBlockByHash']);
const methods = new Set(READ_RPC_METHODS);
function fault(message, code, status) { return Object.assign(new Error(message), { code, status }); }
export function validateChainStatus(value) {
  if (!value || Number(value.chainId) !== TESTNET_CHAIN_ID || value.nativeCurrencySymbol !== 'YNXT' ||
      value.network !== 'YNX Testnet' || value.publicNetwork !== true ||
      !(typeof value.height === 'number' || (typeof value.height === 'string' && /^[0-9]+$/.test(value.height))) ||
      !Number.isSafeInteger(Number(value.height)) || Number(value.height) < 0)
    throw fault('Connected endpoint is not the canonical YNX Testnet.', 'chain_identity_mismatch', 502);
  return value;
}
export function validateReadRpc(value) {
  if (!value || value.protocolVersion !== CHAIN_PROTOCOL || !methods.has(value.method) ||
      !Array.isArray(value.params) || value.params.length > 8)
    throw fault('A supported read-only YNX RPC method is required.', 'rpc_method_not_allowed', 400);
  if (new TextEncoder().encode(JSON.stringify(value.params)).byteLength > 128 * 1024)
    throw fault('RPC parameters exceed their boundary.', 'rpc_params_too_large', 413);
}
function envelope(value) {
  if (!value || value.protocolVersion !== CHAIN_PROTOCOL)
    throw fault('YNX Chain returned an incompatible response.', 'chain_protocol_mismatch', 502);
  return value;
}
export function validateChainTransaction(value, hash) {
  envelope(value);
  const receipt = value.receipt;
  if (value.hash !== hash || typeof value.confirmed !== 'boolean' || value.confirmed !== Boolean(receipt) ||
      (receipt && (typeof receipt !== 'object' || Array.isArray(receipt) ||
        typeof receipt.transactionHash !== 'string' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
        !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber || '') || !['0x0', '0x1'].includes(receipt.status))))
    throw fault('Transaction confirmation evidence is inconsistent.', 'chain_transaction_mismatch', 502);
  // A confirmed failed receipt remains failed; indexing/source verification
  // are separate and must not be inferred from the presence of a receipt.
  return value;
}
export function createChainReader(request) {
  if (typeof request !== 'function') throw new TypeError('An admitted Chain transport is required.');
  async function send(path, base, options) {
    const signal = options?.signal;
    signal?.throwIfAborted();
    // Only cancellation crosses this API. Callers cannot replace the admitted
    // endpoint, credentials, headers, method or validated request body.
    const value = await request(path, signal ? { ...base, signal } : base);
    signal?.throwIfAborted();
    return value;
  }
  return Object.freeze({
    async status(options) { return validateChainStatus(envelope(await send('/status', undefined, options)).status); },
    async compiler(options) {
      const value = envelope(await send('/compiler', undefined, options));
      if (!value.compiler || typeof value.compiler !== 'object' || Array.isArray(value.compiler))
        throw fault('Chain compiler capabilities are unavailable.', 'chain_capabilities_unavailable', 502);
      // Preserve the owner payload and limitations; do not infer full EVM.
      return value.compiler;
    },
    async rpc(method, params = [], options) {
      const body = { protocolVersion: CHAIN_PROTOCOL, method, params };
      validateReadRpc(body);
      const value = envelope(await send('/rpc', { method: 'POST', body: JSON.stringify(body) }, options));
      if (value.method !== method || !Object.hasOwn(value, 'result'))
        throw fault('YNX RPC response does not match the request.', 'chain_rpc_response_mismatch', 502);
      if (method === 'eth_chainId' && value.result !== '0x1917')
        throw fault('Connected endpoint is not the canonical YNX Testnet.', 'chain_identity_mismatch', 502);
      return value.result;
    },
    async transaction(hash, options) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash || ''))
        throw fault('A transaction hash is required.', 'chain_transaction_invalid', 400);
      return validateChainTransaction(await send(`/transactions/${encodeURIComponent(hash)}`, undefined, options), hash);
    },
    async block(id, options) {
      if (!/^(0x[0-9a-fA-F]{64}|[0-9]{1,20})$/.test(String(id)))
        throw fault('A block height or hash is required.', 'chain_block_invalid', 400);
      const value = envelope(await send(`/blocks/${encodeURIComponent(id)}`, undefined, options));
      if (value.id !== String(id)) throw fault('Block response does not match the request.', 'chain_block_mismatch', 502);
      return value;
    },
  });
}
