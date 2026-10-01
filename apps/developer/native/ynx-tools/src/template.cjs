module.exports = `// YNX Testnet: read-only RPC starter. Node.js 20+. No signing or deployment.
const endpoint = 'https://rpc.ynxweb4.com/evm';
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('RPC HTTP ' + response.status);
  const value = await response.json(); if (value.error) throw new Error(value.error.message); return value.result;
}
if (BigInt(await rpc('eth_chainId')) !== 6423n) throw new Error('Unexpected chain');
console.log({ chainId: 6423, block: await rpc('eth_blockNumber') });
// Run: node ynx-testnet-readonly.mjs. Verify current compiler capabilities in YNX Tools.
`;
