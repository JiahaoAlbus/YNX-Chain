import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tronAddress, tronUnits, tronDisplay, tronNetwork, tronDerivationPath,
  tronMnemonicAddress, trc20Parameter, tronBalance, trc20Balance, tronResources,
  tronResourceEstimate, tronIntentPreview, inspectTronEnvelope, TronReadAdapter,
  TRON_CAPABILITIES} from '../src/multichain-tron.mjs';
// PUBLIC vectors only; never use these phrases/addresses for funded accounts.
const A = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const H = '415cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb';
const B = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const network = {id: 'shasta', genesisBlockId: '00'.repeat(32)}; // fake pinned genesis
const code = value => error => error.code === value;

test('TRON official address vector, strict base58check and 41 hex', () => {
  assert.deepEqual(tronAddress(A), {hex: H, base58: A}); assert.equal(tronAddress(H.toUpperCase()).base58, A);
  for (const invalid of [A.slice(0, -1) + '9', A + ' ', '0x' + H, 'a0' + H.slice(2), H.slice(2), '41' + '00'.repeat(20), 'T' + '0'.repeat(33)]) assert.throws(() => tronAddress(invalid), code('TRON_ADDRESS_INVALID'));
});
test('TRON sun and TRC20 exact integer conversions reject rounding/unsafe numeric inputs', () => {
  assert.equal(tronUnits('1.000001'), '1000001'); assert.equal(tronDisplay('1000001'), '1.000001');
  assert.equal(tronUnits('0.000000000000000001', 18, true), '1'); assert.equal(tronDisplay('0'), '0');
  for (const invalid of ['0', '-1', '1e6', '01', ' 1', '1.0000001', '9223372036854.775808']) assert.throws(() => tronUnits(invalid));
  assert.throws(() => tronDisplay(9007199254740992)); assert.throws(() => tronDisplay('1', 256));
});
test('TRON BIP44 coin195 public mnemonic fixture returns only address', () => {
  assert.equal(tronDerivationPath(), "m/44'/195'/0'/0/0");
  assert.equal(tronMnemonicAddress(phrase).base58, B);
  assert.deepEqual(Object.keys(tronMnemonicAddress(phrase)), ['hex', 'base58']);
  assert.notEqual(tronMnemonicAddress(phrase, 1).base58, B);
  assert.throws(() => tronDerivationPath(-1)); assert.throws(() => tronMnemonicAddress('abandon '.repeat(12)));
});
test('TRON network identity must be pinned independently of shared address prefix', () => {
  assert.equal(tronNetwork(network).id, 'shasta');
  assert.throws(() => tronNetwork({id: 'ethereum', genesisBlockId: network.genesisBlockId}));
  assert.throws(() => tronNetwork({id: 'nile'}));
});
test('TRX balance binds returned account; empty means unactivated and malformed is not zero', () => {
  assert.deepEqual(tronBalance({}, A), {sun: '0', display: '0', activated: false});
  assert.deepEqual(tronBalance({address: H, balance: 1000001}, A), {sun: '1000001', display: '1.000001', activated: true});
  assert.throws(() => tronBalance({address: tronAddress(B).hex, balance: 1}, A), code('TRON_ACCOUNT_MISMATCH'));
  assert.throws(() => tronBalance({balance: 1}, A));
  assert.throws(() => tronBalance({address: H, balance: Number.MAX_SAFE_INTEGER + 1}, A));
});
test('TRC20 ABI drops 41 and balance result validates successful exact 32 bytes', () => {
  const parameter = trc20Parameter(A, '1000000');
  assert.equal(parameter.slice(0, 64), H.slice(2).padStart(64, '0'));
  assert.equal(parameter.slice(64), 'f4240'.padStart(64, '0'));
  assert.deepEqual(trc20Balance({result: {result: true}, constant_result: ['f4240'.padStart(64, '0')]}, 6), {units: '1000000', display: '1'});
  assert.throws(() => trc20Balance({result: {result: false}, constant_result: ['0'.repeat(64)]}, 6));
  assert.throws(() => trc20Balance({result: {result: true}, constant_result: ['00']}, 6));
});
test('Resource fees use caller supplied live prices, not EVM gas or summed bandwidth pools', () => {
  const resources = tronResources({NetLimit: 100, NetUsed: 20, freeNetLimit: 100, freeNetUsed: 10, EnergyLimit: 20, EnergyUsed: 30});
  assert.deepEqual(resources, {stakedBandwidth: '80', freeBandwidth: '90', energy: '0'});
  const result = tronResourceEstimate({resources, bandwidth: '100', energy: '10', bandwidthPriceSun: '1000', energyPriceSun: '100', extraFeeSun: '20'});
  assert.equal(result.estimatedSun, '101020'); assert.equal(result.guaranteed, false);
  assert.throws(() => tronResources({NetUsed: -1}));
});
test('Unsigned intent binding changes for recipient/network/asset; no signable transaction claim', () => {
  const args = {network, owner: A, to: B, amount: '1'};
  const preview = tronIntentPreview(args);
  assert.equal(preview.call.amount, '1000000'); assert.equal(preview.canSign, false); assert.equal(preview.transactionVerified, false);
  assert.notEqual(preview.binding, tronIntentPreview({...args, to: A}).binding);
  assert.notEqual(preview.binding, tronIntentPreview({...args, network: {...network, id: 'nile'}}).binding);
  const token = tronIntentPreview({...args, asset: 'trc20', contract: A, decimals: 18});
  assert.notEqual(preview.binding, token.binding); assert.equal(token.call.parameter.length, 128);
  assert.throws(() => tronIntentPreview({...args, decimals: 18}));
  assert.equal(Object.isFrozen(preview.call), true);
});
test('Envelope diagnostics validate original byte hash, TAPOS and expiry but remain unverifiable', () => {
  const rawHex = '010203'; // Deliberately NOT protobuf: never considered signable.
  const txID = createHash('sha256').update(Buffer.from(rawHex, 'hex')).digest('hex');
  const reference = {number: 65537, blockID: '0000000000010001' + 'aa'.repeat(24), timestamp: 1000};
  const transaction = {raw_data_hex: rawHex, txID, raw_data: {timestamp: 1100, expiration: 61000, ref_block_bytes: '0001', ref_block_hash: 'aa'.repeat(8)}};
  const result = inspectTronEnvelope(transaction, reference, 1200);
  assert.equal(result.txID, txID); assert.equal(result.transactionVerified, false); assert.equal(result.canSign, false);
  assert.throws(() => inspectTronEnvelope({...transaction, txID: '00'.repeat(32)}, reference, 1200), code('TRON_TXID_MISMATCH'));
  assert.throws(() => inspectTronEnvelope({...transaction, raw_data: {...transaction.raw_data, ref_block_bytes: '0002'}}, reference, 1200), code('TRON_REFERENCE_MISMATCH'));
  assert.throws(() => inspectTronEnvelope(transaction, reference, 62000), code('TRON_EXPIRATION_INVALID'));
  assert.throws(() => inspectTronEnvelope({...transaction, signature: ['aa']}, reference, 1200));
});
test('Read adapter fake transport pins genesis, does not construct/sign/send/retry', async () => {
  const calls = [];
  const adapter = new TronReadAdapter({network, transport: async (n, endpoint, request) => {
    calls.push({n, endpoint, request});
    if (endpoint === '/wallet/getblockbynum') return {blockID: n.genesisBlockId, block_header: {raw_data: {number: 0}}};
    if (endpoint === '/wallet/getaccount') return {address: H, balance: '2'};
    if (endpoint === '/wallet/getaccountresource') return {};
    return {result: {result: true}, constant_result: ['00'.repeat(32)]};
  }});
  assert.equal((await adapter.balance(A)).sun, '2'); assert.equal((await adapter.tokenBalance(A, B, 6)).units, '0');
  await adapter.resources(A); assert.equal(calls.length, 6); assert.equal(calls[3].request.parameter.length, 64);
  assert.throws(() => {adapter.network = {...network, id: 'mainnet'};});
  assert.throws(() => adapter.sign(), code('TRON_SIGNING_DISABLED')); assert.throws(() => adapter.broadcast(), code('TRON_BROADCAST_DISABLED'));
  const wrong = new TronReadAdapter({network, transport: async () => ({blockID: 'ff'.repeat(32), block_header: {raw_data: {number: 0}}})});
  await assert.rejects(wrong.balance(A), code('TRON_NETWORK_MISMATCH'));
  await assert.rejects(new TronReadAdapter({network}).balance(A), code('TRON_TRANSPORT_UNAVAILABLE'));
  let count = 0; const disconnected = new TronReadAdapter({network, transport: async () => {count++; throw Error('offline');}});
  await assert.rejects(disconnected.balance(A), /offline/); assert.equal(count, 1);
  assert.equal(TRON_CAPABILITIES.broadcast, false);
});
