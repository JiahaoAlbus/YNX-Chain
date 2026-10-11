import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createFamilyReadTransport} from '../src/multichain-family-transport.mjs';
function wire({status = 200, text = '{}', type = 'application/json', addresses = [{address: '8.8.8.8', family: 4}]} = {}) {
  const calls = [];
  const request = (url, options, reply) => {
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = body => { calls.push({url: url.href, options, body}); options.lookup(url.hostname, {all: true}, error => {
      if (error) {queueMicrotask(() => req.emit('error', error)); return;}
      const response = new EventEmitter(); response.statusCode = status; response.headers = {'content-type': type}; response.resume = () => {}; response.destroy = () => {};
      reply(response); queueMicrotask(() => {response.emit('data', Buffer.from(text)); response.emit('end');});
    }); }; return req;
  };
  return {request, dnsLookup: (_host, _opts, callback) => callback(null, addresses), calls};
}
const btc = w => createFamilyReadTransport({family: 'bitcoin', networkId: 'testnet4', baseURL: 'https://public.example/api', ...w});
test('BTC uses pinned public socket GET and endpoint prefix without secret/redirect routes', async () => {const w = wire({text: 'a'.repeat(64), type: 'text/plain'}); assert.equal(await btc(w)({method: 'GET', path: '/block-height/0', network: 'testnet4'}), 'a'.repeat(64)); assert.equal(w.calls[0].url, 'https://public.example/api/block-height/0'); assert.equal(w.calls[0].options.rejectUnauthorized, true); assert.equal(w.calls[0].options.agent, false); assert.equal(w.calls[0].body, undefined); await assert.rejects(btc(w)({method: 'POST', path: '/tx', network: 'testnet4'})); assert.equal(w.calls.length, 1);});
test('TRON endpoint/body allowlist cannot reach broadcast, signing or credential-bearing query', async () => {const w = wire(); const rpc = createFamilyReadTransport({family: 'tron', networkId: 'nile', baseURL: 'https://public.example', ...w}); await rpc({id: 'nile'}, '/wallet/getblockbynum', {num: 0}); await assert.rejects(rpc({id: 'nile'}, '/wallet/broadcasttransaction', {})); await assert.rejects(rpc({id: 'nile'}, '/wallet/getblockbynum', {num: 0, password: 'PUBLIC rejected'})); await assert.rejects(rpc({id: 'mainnet'}, '/wallet/getblockbynum', {num: 0})); assert.equal(w.calls.length, 1);});
test('mixed public/private DNS cannot connect to private destination', async () => {const w = wire({addresses: [{address: '8.8.8.8', family: 4}, {address: '127.0.0.1', family: 4}]}); await assert.rejects(btc(w)({method: 'GET', path: '/block-height/0', network: 'testnet4'}), {code: 'FAMILY_RPC_PRIVATE'}); assert.throws(() => createFamilyReadTransport({family: 'bitcoin', networkId: 'testnet4', baseURL: 'https://127.0.0.1'}));});
test('redirect, oversized body and malformed JSON are errors rather than zero balances', async () => {for (const [options, code] of [[{status: 302}, 'FAMILY_RPC_HTTP'], [{text: 'X'.repeat(100)}, 'FAMILY_RPC_RESPONSE_SIZE'], [{text: '{'}, 'FAMILY_RPC_INVALID']]) {const w = wire(options); const rpc = createFamilyReadTransport({family: 'tron', networkId: 'nile', baseURL: 'https://public.example', maxBytes: 50, ...w}); await assert.rejects(rpc({id: 'nile'}, '/wallet/getblockbynum', {num: 0}), {code}); assert.equal(w.calls.length, 1);}});
test('already cancelled requests produce no network calls or retries', async () => {const w = wire(); const controller = new AbortController(); controller.abort(); await assert.rejects(btc(w)({method: 'GET', path: '/block-height/0', network: 'testnet4', signal: controller.signal}), {code: 'FAMILY_RPC_CANCELLED'}); assert.equal(w.calls.length, 0);});
test('TRC20 metadata allowlist has empty parameters and never authorizes transfer', async () => {
  const w = wire(), rpc = createFamilyReadTransport({family: 'tron', networkId: 'nile', baseURL: 'https://public.example', ...w});
  const base = {owner_address: '41' + '1'.repeat(40), contract_address: '41' + '2'.repeat(40), visible: false};
  for (const selector of ['name()', 'symbol()', 'decimals()']) await rpc({id: 'nile'}, '/wallet/triggerconstantcontract', {...base, function_selector: selector, parameter: ''});
  for (const [selector, parameter] of [['transfer(address,uint256)', '0'.repeat(128)], ['approve(address,uint256)', '0'.repeat(128)], ['name()', '0'.repeat(64)], ['balanceOf(address)', '']]) await assert.rejects(rpc({id: 'nile'}, '/wallet/triggerconstantcontract', {...base, function_selector: selector, parameter}), {code: 'FAMILY_RPC_INPUT'});
  assert.equal(w.calls.length, 3); assert.ok(w.calls.every(c => c.url.endsWith('/wallet/triggerconstantcontract')));
});
test('BTC original transaction proof routes remain bound read-only and bounded', async () => {
  const hash = 'a'.repeat(64);
  for (const route of [`/tx/${hash}/status`, `/tx/${hash}/merkle-proof`, '/mempool/txids']) {
    const w = wire(); await btc(w)({method: 'GET', path: route, network: 'testnet4'}); assert.equal(w.calls[0].url, 'https://public.example/api' + route);
  }
  for (const route of [`/block/${hash}/header`, '/block-height/12345']) {
    const w = wire({text: 'a'.repeat(64), type: 'text/plain'}); assert.equal(await btc(w)({method: 'GET', path: route, network: 'testnet4'}), 'a'.repeat(64));
  }
  const w = wire(); for (const route of ['/block-height/2147483648', '/block-height/01', '/block-height/-1', `/block/${hash}/raw`, '/tx', '/mempool?broadcast=true']) await assert.rejects(btc(w)({method: 'GET', path: route, network: 'testnet4'}), {code: 'FAMILY_RPC_READ_ONLY'});
  assert.equal(w.calls.length, 0);
});
