import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createChainService } from '../src/service.mjs';
import { CHAIN_PROTOCOL, createChainReader, validateChainStatus } from '../src/chain-reader.mjs';
const status = { chainId: 6423, nativeCurrencySymbol: 'YNXT', network: 'YNX Testnet', publicNetwork: true, height: 42 };

test('shared reader consumes actual service HTTP routes without inventing deployment capability', async t => {
  const calls = [];
  const service = createChainService({ ownerForRequest: request => request.headers['x-test-owner'],
    fetcher: async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).endsWith('/status')) return Response.json(status);
      if (String(url).endsWith('/ide/compiler')) return Response.json({ runtimeMode: 'bounded', limitations: ['No arbitrary EVM'] });
      if (!options.body) return Response.json(null);
      const body = JSON.parse(options.body);
      return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x1917' : null });
    } });
  const server = createServer((request, response) => service.handler(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const reader = createChainReader(async (path, options) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/runtime/chain${path}`, {
      ...options, headers: { 'x-test-owner': 'synthetic-qa-owner', 'content-type': 'application/json' },
    });
    assert.equal(response.status, 200);
    return response.json();
  });
  assert.deepEqual(await reader.status(), status);
  assert.equal(await reader.rpc('eth_chainId'), '0x1917');
  assert.equal(await reader.rpc('eth_getBalance', ['0x' + '1'.repeat(40), 'latest']), null);
  assert.deepEqual((await reader.compiler()).limitations, ['No arbitrary EVM']);
  const transaction = await reader.transaction('0x' + 'a'.repeat(64));
  assert.equal(transaction.confirmed, false);
  assert.equal(transaction.receipt, null);
  const count = calls.length;
  await assert.rejects(reader.rpc('eth_sendTransaction', [{}]), { code: 'rpc_method_not_allowed' });
  await assert.rejects(reader.transaction('../wallet'), { code: 'chain_transaction_invalid' });
  assert.equal(calls.length, count);
  assert.equal('deploy' in reader, false);
});

test('reader rejects incompatible, wrong-chain and mismatched RPC responses', async () => {
  for (const value of [{ protocolVersion: 'other', status },
    { protocolVersion: CHAIN_PROTOCOL, status: { ...status, chainId: 1 } },
    { protocolVersion: CHAIN_PROTOCOL, status: { ...status, height: null } }]) {
    await assert.rejects(createChainReader(async () => value).status());
  }
  for (const value of [{ protocolVersion: CHAIN_PROTOCOL, method: 'eth_chainId', result: '0x1' },
    { protocolVersion: CHAIN_PROTOCOL, method: 'eth_blockNumber', result: '0x1917' },
    { protocolVersion: CHAIN_PROTOCOL, method: 'eth_chainId' }]) {
    await assert.rejects(createChainReader(async () => value).rpc('eth_chainId'));
  }
});

test('lookup preserves pending results and rejects confirmation contradictions or wrong references', async () => {
  const hash = '0x' + 'b'.repeat(64);
  const pending = { protocolVersion: CHAIN_PROTOCOL, hash, confirmed: false, receipt: null };
  assert.deepEqual(await createChainReader(async () => pending).transaction(hash), pending);
  for (const patch of [{ hash: '0x' + 'a'.repeat(64) }, { confirmed: true }, { receipt: {} },
    { confirmed: true, receipt: { transactionHash: '0x' + 'a'.repeat(64), blockNumber: '0x2a', status: '0x1' } },
    { confirmed: true, receipt: { transactionHash: hash, blockNumber: null, status: '0x1' } }]) {
    await assert.rejects(createChainReader(async () => ({ ...pending, ...patch })).transaction(hash), { code: 'chain_transaction_mismatch' });
  }
  await assert.rejects(createChainReader(async () => ({ protocolVersion: CHAIN_PROTOCOL, id: '43' })).block('42'), { code: 'chain_block_mismatch' });
  assert.throws(() => validateChainStatus({ ...status, height: -1 }), { code: 'chain_identity_mismatch' });
  const failed = { ...pending, confirmed: true, receipt: { transactionHash: hash, blockNumber: '0x2a', status: '0x0' } };
  assert.equal((await createChainReader(async () => failed).transaction(hash)).receipt.status, '0x0');
  assert.equal('sourceVerified' in failed, false);
});

test('transport rejection propagates without a fallback endpoint, retry or fabricated data', async () => {
  let requests = 0;
  const denied = Object.assign(new Error('Project service permission revoked'), { code: 'permission_revoked' });
  const reader = createChainReader(async () => { requests++; throw denied; });
  await assert.rejects(reader.status(), error => error === denied);
  assert.equal(requests, 1);
});
