import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {utils as tronUtils} from 'tronweb';
import {tronAddress, tronIntentPreview, buildTronUnsigned, TronSignReview} from '../src/multichain-tron.mjs';
import {FamilyRecovery, verifyFamilyProduced, queryFamilyOriginal} from '../src/multichain-family-recovery.mjs';
import {BitcoinSigningAdapter} from '../src/multichain-bitcoin.mjs';
import {Transaction, payments, networks as btcNetworks} from 'bitcoinjs-lib';
import {ECPairFactory} from 'ecpair';
import * as ecc from 'tiny-secp256k1';
const id = '00000000-0000-4000-8000-000000000001';
const chain = {id: 'shasta', genesisBlockId: 'a'.repeat(64)};
const network = {family: 'tron', network: 'shasta', rpcUrl: 'https://public.example/', genesis: chain.genesisBlockId};
// PUBLIC scalar one, never a real funded account.
const publicScalar = '1'.padStart(64, '0'), owner = tronAddress(tronUtils.crypto.pkToAddress(publicScalar)).hex;
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ynx-family-recovery-public-')), filePath = path.join(directory, 'journal.json');
  let context = {account: 'PUBLIC-QA', revision: 1, locked: false};
  const recovery = new FamilyRecovery({filePath, getContext: async () => context});
  const intent = tronIntentPreview({network: chain, owner, to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', amount: '1.000001'});
  const operationContext = {network: chain, reference: {number: 65537, blockID: '0000000000010001' + 'aa'.repeat(24), timestamp: 1000}, timestamp: 1100, expiration: 61000, feeLimitSun: '0'};
  const operation = {intent, context: operationContext};
  const permit = await recovery.journal.reserve({id, family: 'tron', networkId: 'shasta', account: context.account, request: {network, operation}}); await permit.beginSigning();
  const review = new TronSignReview({transaction: buildTronUnsigned(intent, operationContext, 1200), intent, context: operationContext, now: 1200});
  const guard = {assert() {}};
  await review.sign({guard, now: () => 1200, withSecret: action => action(publicScalar, {account: context.account}, guard), onProduced: produced => permit.capture({txid: produced.txID, produced})});
  await permit.saveProduced(); permit.retire();
  return {recovery, filePath, change: value => {context = {...context, ...value};}, getContext: async () => context, record: (await recovery.journal.list())[0]};
}
const select = {family: 'tron', network: 'shasta'};
function responses(record, mode = 'included') {
  const produced = record.result.produced, body = {...structuredClone(produced.transaction), ret: [{contractRet: 'SUCCESS'}]}, blockID = '000000000000002a' + 'c'.repeat(48);
  return async (_network, route, input) => {
    if (route === '/wallet/getblockbynum' && input.num === 0) return {blockID: chain.genesisBlockId, block_header: {raw_data: {}}};
    if (route === '/wallet/gettransactionbyid') return mode === 'missing' ? {} : body;
    if (route === '/wallet/gettransactioninfobyid') return mode === 'receipt-missing' ? {} : {id: produced.txID, blockNumber: 42, receipt: {result: 'SUCCESS'}};
    if (route === '/wallet/getblockbynum' && input.num === 42) return {blockID, block_header: {raw_data: {number: 42}}, transactions: [body]};
    throw Error('PUBLIC unexpected route');
  };
}
test('actual TRON result verifies and public projection never exports signed raw or PSBT', async () => {
  const f = await fixture(); assert.equal(verifyFamilyProduced(f.record, f.record.result), true);
  const list = await f.recovery.list(select); assert.equal(list[0].state, 'signed-unsubmitted'); assert.equal(list[0].txid, f.record.result.txid);
  assert.equal(list[0].produced, undefined); assert.equal(list[0].raw_data_hex, undefined); assert.equal((await stat(f.filePath)).mode & 0o777, 0o600);
  const reopened = new FamilyRecovery({filePath: f.filePath, getContext: f.getContext}); assert.deepEqual(await reopened.list(select), list);
});
test('production query bridge normalizes actual TRON receipt and retains execution evidence', async () => {
  const f = await fixture(); f.recovery.query = r => queryFamilyOriginal(r, {createTransport: () => responses(r)});
  const checked = await f.recovery.check({id}); assert.equal(checked.state, 'included'); assert.equal(checked.receipt.blockHeight, '42'); assert.equal(checked.receipt.confirmationScope, 'rpc-block-inclusion'); assert.equal(checked.evidence.contractRet, 'SUCCESS');
  assert.deepEqual((await f.recovery.journal.list())[0].result, f.record.result);
});
test('missing receipt and offline error persist unknown with evidence, not unsigned or failed', async () => {
  for (const mode of ['receipt-missing', 'offline']) {
    const f = await fixture(); f.recovery.query = r => mode === 'offline' ? Promise.reject(Object.assign(Error('PUBLIC offline'), {code: 'FAMILY_RPC_TIMEOUT'})) : queryFamilyOriginal(r, {createTransport: () => responses(r, mode)});
    const checked = await f.recovery.check({id}); assert.equal(checked.state, 'unknown'); assert.equal(checked.resultRetained, true); assert.ok(checked.evidence);
    assert.deepEqual((await f.recovery.journal.list())[0].result, f.record.result);
  }
});
test('focus lock during query saves original observation but rejects renderer result', async () => {
  const f = await fixture(); f.recovery.query = async r => {const observed = await queryFamilyOriginal(r, {createTransport: () => responses(r)}); f.change({locked: true, revision: 2}); return observed;};
  await assert.rejects(f.recovery.check({id}), {code: 'MULTICHAIN_CONTEXT_CHANGED'});
  assert.equal((await f.recovery.journal.list())[0].state, 'included'); assert.deepEqual((await f.recovery.journal.list())[0].result, f.record.result);
});
test('other accounts and locked check cannot query original record', async () => {
  const f = await fixture(); let calls = 0; f.recovery.query = async () => {calls++;};
  f.change({account: 'PUBLIC-other', revision: 2}); assert.deepEqual(await f.recovery.list(select), []); await assert.rejects(f.recovery.check({id}));
  f.change({account: 'PUBLIC-QA', locked: true}); await assert.rejects(f.recovery.check({id}), {code: 'WALLET_LOCKED'}); assert.equal(calls, 0);
});
test('unresolved record prevents endpoint/genesis edits while original request remains pinned', async () => {
  const f = await fixture(); await assert.rejects(f.recovery.assertNetworkEditable(network), {code: 'FAMILY_RESOLUTION_REQUIRED'});
  await f.recovery.assertNetworkEditable({...network, network: 'nile'});
  const before = await readFile(f.filePath, 'utf8'); const bad = structuredClone(f.record.result); bad.produced.signature = 'b'.repeat(130);
  assert.throws(() => verifyFamilyProduced(f.record, bad)); assert.equal(await readFile(f.filePath, 'utf8'), before);
});
test('actual BTC signature verifier and query bridge compose with durable outpoint binding', async () => {
  const f = await fixture(), bitcoinId = '00000000-0000-4000-8000-000000000002';
  const factory = ECPairFactory(ecc), bytes = new Uint8Array(32); bytes[31] = 1;
  const sender = factory.fromPrivateKey(Uint8Array.from(bytes)); bytes[31] = 2; const change = factory.fromPrivateKey(Uint8Array.from(bytes));
  const from = payments.p2wpkh({pubkey: sender.publicKey, network: btcNetworks.bitcoin});
  const changeAddress = payments.p2wpkh({pubkey: change.publicKey, network: btcNetworks.bitcoin}).address;
  const previous = new Transaction(); previous.version = 2; previous.addInput(new Uint8Array(32), 0xffffffff); previous.addOutput(from.output, 100000n);
  const txid = previous.getId(), previousTransactions = [{txid, hex: previous.toHex()}];
  const previewRequest = {requestId: bitcoinId, network: 'mainnet', from: from.address, to: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', changeAddress, amount: '0.0005', feeRateSatPerVbyte: '2', utxos: [{txid, vout: 0, value: 100000, status: {confirmed: true, block_height: 1, block_hash: 'b'.repeat(64)}}]};
  const operation = {previewRequest, publicKey: Buffer.from(sender.publicKey).toString('hex'), changePublicKey: Buffer.from(change.publicKey).toString('hex'), previousTransactions, maxFeeSats: '500'};
  const bitcoinNetwork = {family: 'bitcoin', network: 'mainnet', rpcUrl: 'https://public.example/api', genesis: null};
  const permit = await f.recovery.journal.reserve({id: bitcoinId, family: 'bitcoin', networkId: 'mainnet', account: 'PUBLIC-QA', request: {network: bitcoinNetwork, operation}, outpoints: [txid + ':0']});
  const signer = new BitcoinSigningAdapter({now: () => 1}); signer.prepare({request: previewRequest, publicKey: sender.publicKey, changePublicKey: change.publicKey, previousTransactions, unspentChecks: [{network: 'mainnet', txid, vout: 0, spent: false}], expiresAt: 120000, maxFeeSats: '500'});
  await permit.beginSigning(); await signer.sign(bitcoinId, {signer: sender, guard: {assert() {}}, onProduced: produced => permit.capture({txid: produced.txid, produced})}); await permit.saveProduced(); permit.retire();
  const original = (await f.recovery.journal.list()).find(r => r.id === bitcoinId); assert.equal(verifyFamilyProduced(original, original.result), true);
  assert.throws(() => verifyFamilyProduced({...original, outpoints: ['b'.repeat(64) + ':0']}, original.result));
  f.recovery.query = r => queryFamilyOriginal(r, {createTransport: () => async input => {
    if (input.path === '/block-height/0') return '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
    if (input.path.endsWith('/hex')) return r.result.produced.rawTransaction;
    if (input.path.endsWith('/status')) return {confirmed: false};
    if (input.path === '/mempool/txids') return [r.result.txid];
    throw Error('PUBLIC unexpected BTC route');
  }});
  const checked = await f.recovery.check({id: bitcoinId}); assert.equal(checked.state, 'submitted-unconfirmed'); assert.equal(checked.receipt, null);
  assert.deepEqual((await f.recovery.journal.list()).find(r => r.id === bitcoinId).result, original.result);
  assert.equal((await f.recovery.list({family: 'bitcoin', network: 'mainnet'})).length, 1);
});
