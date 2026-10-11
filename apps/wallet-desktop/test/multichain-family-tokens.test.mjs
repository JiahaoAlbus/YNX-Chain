import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FamilyTokens} from '../src/multichain-family-tokens.mjs';
import {FamilyNetworks} from '../src/multichain-family-networks.mjs';
import {FamilyRead} from '../src/multichain-family-read.mjs';
import {TronReadAdapter, tronAddress} from '../src/multichain-tron.mjs';
const genesis = 'a'.repeat(64), contract = '41' + '2'.repeat(40), address = tronAddress('41' + '1'.repeat(40)).base58;
const word = n => BigInt(n).toString(16).padStart(64, '0');
const text = value => {const b = Buffer.from(value); return word(32) + word(b.length) + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0');};
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ynx-family-token-public-'));
  const tokens = new FamilyTokens({filePath: path.join(directory, 'tokens.json')}), networks = new FamilyNetworks({filePath: path.join(directory, 'networks.json')});
  await networks.put({family: 'tron', network: 'nile', rpcUrl: 'https://public.example', genesis}, 0);
  let context = {account: 'PUBLIC-base', revision: 1, locked: false};
  const state = {symbol: 'PUBLIC', failure: false, before: () => {}, calls: []};
  const createAdapter = async n => new TronReadAdapter({network: {id: n.network, genesisBlockId: n.genesis}, transport: async (_network, route, body) => {
    state.calls.push({route, body}); state.before(route, body);
    if (route === '/wallet/getblockbynum') return {blockID: n.genesis, block_header: {raw_data: {}}};
    if (route === '/wallet/getaccount') return {address: tronAddress(address).hex, balance: 1234567};
    if (state.failure) throw Error('PUBLIC offline token');
    const values = {'name()': text('Public Fixture'), 'symbol()': text(state.symbol), 'decimals()': word(6), 'balanceOf(address)': word(123456789)};
    return {result: {result: true}, constant_result: [values[body.function_selector]]};
  }});
  const service = new FamilyRead({networks, tokens, accounts: {account: async () => ({address})}, getContext: async () => context, createAdapter});
  return {directory, tokens, networks, service, state, change: value => {context = {...context, ...value};}};
}
const input = {family: 'tron', network: 'nile', contract};
test('actual TRON adapter metadata imports into separate catalog and exact token balances compose', async () => {
  const f = await fixture(), token = await f.service.importToken(input); assert.equal(token.decimals, 6); assert.equal(token.symbol, 'PUBLIC');
  const reopened = new FamilyTokens({filePath: path.join(f.directory, 'tokens.json')}); assert.deepEqual((await reopened.read()).tokens, [token]);
  const balances = await f.service.balances({family: 'tron', network: 'nile'});
  assert.equal(balances.assets[1].amount, '123456789'); assert.equal(balances.assets[1].display, '123.456789'); assert.deepEqual(balances.errors, []);
  assert.ok(f.state.calls.every(c => ['/wallet/getblockbynum', '/wallet/getaccount', '/wallet/triggerconstantcontract'].includes(c.route)));
});
test('token read failures remain explicit and do not replace native balance or invent zero token', async () => {
  const f = await fixture(); await f.service.importToken(input); f.state.failure = true;
  const result = await f.service.balances({family: 'tron', network: 'nile'});
  assert.equal(result.assets.length, 1); assert.equal(result.assets[0].display, '1.234567'); assert.equal(result.errors[0].contract, contract); assert.equal(result.errors[0].code, 'FAMILY_TOKEN_READ_FAILED');
});
test('changed token metadata requires explicit reimport instead of silent relabeling', async () => {
  const f = await fixture(); await f.service.importToken(input); f.state.symbol = 'CHANGED';
  const result = await f.service.balances({family: 'tron', network: 'nile'}); assert.equal(result.assets.length, 1); assert.equal(result.errors[0].code, 'FAMILY_TOKEN_METADATA_CHANGED');
  assert.equal((await f.tokens.read()).tokens[0].symbol, 'PUBLIC');
});
test('lock during metadata read cannot persist token catalog', async () => {
  const f = await fixture(); f.state.before = route => {if (route === '/wallet/triggerconstantcontract') f.change({locked: true, revision: 2});};
  await assert.rejects(f.service.importToken(input), {code: 'MULTICHAIN_CONTEXT_CHANGED'}); assert.equal((await f.tokens.read()).tokens.length, 0);
});
test('network genesis override does not silently reuse imported token identity', async () => {
  const f = await fixture(); await f.service.importToken(input); await f.networks.put({family: 'tron', network: 'nile', rpcUrl: 'https://public.example', genesis: 'b'.repeat(64)}, 1);
  const result = await f.service.balances({family: 'tron', network: 'nile'}); assert.equal(result.errors[0].code, 'FAMILY_TOKEN_NETWORK_CHANGED'); assert.equal(result.assets.length, 1);
});
test('catalog rejects injected text, secrets and stale writes without altering saved token', async () => {
  const f = await fixture(), token = await f.service.importToken(input), file = path.join(f.directory, 'tokens.json'), before = await readFile(file, 'utf8');
  for (const bad of [{...token, name: '<unsafe>'}, {...token, symbol: 'A\u202eB'}, {...token, decimals: 256}, {...token, privateKey: 'PUBLIC-rejected'}]) assert.throws(() => f.tokens.put(bad, 1));
  await assert.rejects(f.tokens.put(token, 0), {code: 'MULTICHAIN_CONTEXT_CHANGED'}); assert.equal(await readFile(file, 'utf8'), before);
});
test('lock after native read stops the remaining token RPC queue', async () => {
  const f = await fixture(); await f.service.importToken(input); f.state.calls.length = 0;
  f.state.before = route => {if (route === '/wallet/getaccount') f.change({locked: true, revision: 2});};
  await assert.rejects(f.service.balances({family: 'tron', network: 'nile'}), {code: 'MULTICHAIN_CONTEXT_CHANGED'});
  assert.equal(f.state.calls.filter(c => c.route === '/wallet/triggerconstantcontract').length, 0);
});
