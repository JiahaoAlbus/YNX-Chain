import test from 'node:test';
import assert from 'node:assert/strict';
import { BitcoinReadAdapter, bitcoinDerivationPath, validateBitcoinAddress, parseBitcoinAmount, formatBitcoinAmount, normalizeBitcoinUtxos, createBitcoinPreview } from '../src/multichain-bitcoin.mjs';
import { BitcoinSigningAdapter } from '../src/multichain-bitcoin.mjs';
import { Transaction, payments, networks } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
// PUBLIC BIP84 receiving/change address vectors. No human keys/phrases.
const FROM = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const TO = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const CHANGE = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
const GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const utxo = (value = 100000, id = 'a', confirmed = true) => ({ txid: id.repeat(64), vout: 0, value, status: { confirmed, block_height: 1, block_hash: 'b'.repeat(64) } });
const request = () => ({ requestId: 'public-qa-1', network: 'mainnet', from: FROM, to: TO, changeAddress: CHANGE, amount: '0.0005', feeRateSatPerVbyte: '2', utxos: [utxo()] });

test('BTC exact decimal/satoshi conversion rejects float coercion and range', () => {
  assert.equal(parseBitcoinAmount('0.00000001'), '1');
  assert.equal(formatBitcoinAmount('2100000000000000'), '21000000.00000000');
  for (const amount of [0.1, '1e-8', '-1', '01', '0.000000001', '21000000.00000001', ' 1']) assert.throws(() => parseBitcoinAmount(amount));
});
test('BTC BIP84 path is explicit and never EVM coin type', () => {
  assert.equal(bitcoinDerivationPath('mainnet'), "m/84'/0'/0'/0/0");
  assert.equal(bitcoinDerivationPath('testnet4', { change: 1, index: 7 }), "m/84'/1'/0'/1/7");
  assert.throws(() => bitcoinDerivationPath('ethereum'));
  assert.throws(() => bitcoinDerivationPath('mainnet', { account: 2147483648 }));
});
test('BTC BIP84 public vectors validate checksum/network/type strictly', () => {
  for (const a of [FROM, TO, CHANGE]) assert.match(validateBitcoinAddress(a, 'mainnet').scriptPubKey, /^0014[0-9a-f]{40}$/);
  assert.equal(validateBitcoinAddress(FROM.toUpperCase(), 'mainnet').address, FROM);
  for (const a of [FROM.slice(0, -1) + 'q', 'bC' + FROM.slice(2), '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', '0x' + 'a'.repeat(40)]) assert.throws(() => validateBitcoinAddress(a, 'mainnet'));
  assert.throws(() => validateBitcoinAddress(FROM, 'testnet4'), { code: 'BTC_ADDRESS_NETWORK' });
});
test('BTC UTXO conversion rejects malformed, unsafe, duplicates and aggregate overflow', () => {
  const rows = normalizeBitcoinUtxos([utxo(), utxo(200, 'c', false)]);
  assert.equal(rows[0].valueSats, '100000'); assert.equal(rows[1].status.confirmed, false);
  for (const list of [[utxo(), utxo()], [utxo(1.2)], [utxo(-1)], [utxo(Number.MAX_SAFE_INTEGER + 1)], [utxo(2100000000000000), utxo(1, 'c')], [{ ...utxo(), status: { confirmed: true } }]]) assert.throws(() => normalizeBitcoinUtxos(list));
});
test('BTC unsigned review preserves immutable request and exact input/output/fee arithmetic', () => {
  const r = request(), preview = createBitcoinPreview(r);
  assert.equal(preview.feeSats, '284'); assert.equal(preview.outputs[1].valueSats, '49716');
  assert.equal(preview.state, 'unsigned-preview'); assert.equal(preview.signingSupported, false);
  assert.equal(BigInt(preview.inputs[0].valueSats), preview.outputs.reduce((s, o) => s + BigInt(o.valueSats), BigInt(preview.feeSats)));
  r.amount = '1'; assert.equal(preview.originalRequest.amount, '0.0005');
  assert.throws(() => { preview.outputs[0].valueSats = '1'; });
  assert.match(preview.requestDigest, /^[0-9a-f]{64}$/);
});
test('BTC dust change is displayed as fee and unconfirmed outputs are not spendable', () => {
  const p = createBitcoinPreview({ ...request(), utxos: [utxo(50400)] });
  assert.equal(p.outputs.length, 1); assert.equal(p.feeSats, '400');
  assert.throws(() => createBitcoinPreview({ ...request(), utxos: [utxo(100000, 'a', false)] }), { code: 'BTC_INSUFFICIENT_CONFIRMED_FUNDS' });
  assert.throws(() => createBitcoinPreview({ ...request(), amount: '0.00000001' }));
});
test('BTC transport has no default provider and validates genesis before reads', async () => {
  assert.throws(() => new BitcoinReadAdapter({ network: 'mainnet' }), { code: 'BTC_TRANSPORT_NOT_CONFIGURED' });
  const calls = [];
  const adapter = new BitcoinReadAdapter({ network: 'mainnet', request: async r => { calls.push(r); return r.path === '/block-height/0' ? GENESIS : [utxo(), utxo(5, 'c', false)]; } });
  const balance = await adapter.readAddress(FROM);
  assert.equal(balance.confirmedSats, '100000'); assert.equal(balance.unconfirmedSats, '5');
  assert.equal(balance.verification, 'provider-reported-not-spv'); assert.ok(calls.every(c => c.method === 'GET'));
  const badCalls = [];
  const wrong = new BitcoinReadAdapter({ network: 'mainnet', request: async r => { badCalls.push(r.path); return '0'.repeat(64); } });
  await assert.rejects(wrong.readAddress(FROM), { code: 'BTC_PROVIDER_NETWORK_MISMATCH' });
  assert.deepEqual(badCalls, ['/block-height/0']);
});
test('BTC cancelled reads do not retry; snapshot survives mutable caller across await', async () => {
  const controller = new AbortController(); let calls = 0;
  const cancel = new BitcoinReadAdapter({ network: 'mainnet', request: async () => { calls++; controller.abort(); return GENESIS; } });
  await assert.rejects(cancel.readAddress(FROM, { signal: controller.signal }), { code: 'BTC_REQUEST_CANCELLED' }); assert.equal(calls, 1);
  const r = request();
  const adapter = new BitcoinReadAdapter({ network: 'mainnet', request: async q => { r.amount = '10'; return q.path === '/block-height/0' ? GENESIS : [utxo()]; } });
  assert.equal((await adapter.preview(r)).originalRequest.amount, '0.0005');
});
test('BTC sign/broadcast fail closed without transport invocation', () => {
  let calls = 0; const adapter = new BitcoinReadAdapter({ network: 'mainnet', request: () => { calls++; } });
  assert.throws(() => adapter.sign(), { code: 'BTC_SIGNING_NOT_IMPLEMENTED' });
  assert.throws(() => adapter.broadcast(), { code: 'BTC_BROADCAST_NOT_IMPLEMENTED' }); assert.equal(calls, 0);
});
test('BTC rejects caller network mismatch before transport and insufficient multi-input funding', async () => {
  let calls = 0;
  const adapter = new BitcoinReadAdapter({ network: 'mainnet', request: async () => { calls++; } });
  await assert.rejects(adapter.preview({ ...request(), network: 'testnet4' }), { code: 'BTC_REQUEST_NETWORK_MISMATCH' });
  assert.equal(calls, 0);
  assert.throws(() => createBitcoinPreview({ ...request(), utxos: [utxo(20000), utxo(30000, 'c')] }), { code: 'BTC_INSUFFICIENT_CONFIRMED_FUNDS' });
});

// PUBLIC scalar-one/two synthetic fixtures only. Never funded or user keys.
function signingFixture() {
  const factory = ECPairFactory(ecc), bytes = new Uint8Array(32); bytes[31] = 1;
  const sender = factory.fromPrivateKey(Uint8Array.from(bytes)); bytes[31] = 2;
  const change = factory.fromPrivateKey(Uint8Array.from(bytes));
  const from = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.bitcoin });
  const changeAddress = payments.p2wpkh({ pubkey: change.publicKey, network: networks.bitcoin }).address;
  const previous = new Transaction(); previous.version = 2;
  previous.addInput(new Uint8Array(32), 0xffffffff);
  previous.addOutput(from.output, 100000n);
  const txid = previous.getId();
  const req = { ...request(), from: from.address, changeAddress, utxos: [{ ...utxo(), txid }] };
  return { sender, change, req, previous, prepared: { request: req, publicKey: sender.publicKey, changePublicKey: change.publicKey, previousTransactions: [{ txid, hex: previous.toHex() }], unspentChecks: [{ network: 'mainnet', txid, vout: 0, spent: false }], expiresAt: 120000, maxFeeSats: '500' } };
}
test('BTC R2 bound original prevout PSBT produces valid original raw/txid exactly once', async () => {
  const f = signingFixture(), adapter = new BitcoinSigningAdapter({ now: () => 1 });
  adapter.prepare(f.prepared); let signatures = 0, captured;
  const result = await adapter.sign(f.req.requestId, { signer: { publicKey: f.sender.publicKey, sign: hash => { signatures++; return f.sender.sign(hash); } }, guard: { assert() {} }, onProduced: r => { captured = r; } });
  assert.equal(result, captured); assert.equal(result.txid, Transaction.fromHex(result.rawTransaction).getId());
  assert.equal(result.feeSats, '284'); assert.equal(result.originalRequest.to, TO);
  assert.equal(adapter.status(f.req.requestId).state, 'signed-unsubmitted');
  await assert.rejects(adapter.sign(f.req.requestId, {}), { code: 'BTC_SIGNING_ALREADY_ATTEMPTED' });
  assert.equal(signatures, 1); assert.throws(() => adapter.broadcast());
});
test('BTC R2 rejects amount/script/txid/unspent/change/fee proof substitution before sign', () => {
  const scenarios = [
    f => { f.prepared.request.utxos[0].value = 100001; },
    f => { f.prepared.previousTransactions[0].txid = 'c'.repeat(64); },
    f => { f.prepared.previousTransactions[0].hex = f.previous.toHex().slice(0, -2) + '01'; },
    f => { f.prepared.unspentChecks[0].spent = true; },
    f => { f.prepared.unspentChecks[0].network = 'testnet4'; },
    f => { f.prepared.changePublicKey = f.sender.publicKey; },
    f => { f.prepared.maxFeeSats = '1'; },
    f => { f.prepared.previousTransactions = []; },
    f => { f.prepared.request.from = FROM; },
    f => { f.prepared.expiresAt = 120002; }
  ];
  for (const [index, change] of scenarios.entries()) { const f = signingFixture(); change(f); assert.throws(() => new BitcoinSigningAdapter({ now: () => 1 }).prepare(f.prepared), `scenario ${index}`); }
});
test('BTC R2 signed output survives callback failure and post-action lock without re-sign', async () => {
  for (const mode of ['callback', 'post-lock', 'expiry']) {
    const f = signingFixture(); let time = 1, locked = false, count = 0, captured;
    const adapter = new BitcoinSigningAdapter({ now: () => time }); adapter.prepare(f.prepared);
    await assert.rejects(adapter.sign(f.req.requestId, { signer: { publicKey: f.sender.publicKey, sign: hash => { count++; return f.sender.sign(hash); } }, guard: { assert() { if (locked) throw new Error('locked'); } }, onProduced: r => { captured = r; if (mode === 'callback') throw new Error('storage failed'); if (mode === 'post-lock') locked = true; if (mode === 'expiry') time = 120000; } }), { code: 'BTC_SIGNED_RESULT_HELD' });
    assert.ok(captured.rawTransaction); assert.equal(adapter.status(f.req.requestId).result, captured);
    assert.equal(adapter.status(f.req.requestId).state, 'signed-unsubmitted');
    await assert.rejects(adapter.sign(f.req.requestId, {}), { code: 'BTC_SIGNING_ALREADY_ATTEMPTED' }); assert.equal(count, 1);
  }
});
test('BTC R2 cancellation/expired authorization do not sign; partial signer failure stays unknown', async () => {
  const f = signingFixture(), adapter = new BitcoinSigningAdapter({ now: () => 1 }); adapter.prepare(f.prepared); adapter.cancel(f.req.requestId);
  await assert.rejects(adapter.sign(f.req.requestId, {}), { code: 'BTC_SIGNING_ALREADY_ATTEMPTED' });
  const fresh = new BitcoinSigningAdapter({ now: () => 1 }); fresh.prepare(f.prepared); let calls = 0;
  await assert.rejects(fresh.sign(f.req.requestId, { signer: { publicKey: f.sender.publicKey, sign: () => { calls++; throw new Error('ambiguous signer return'); } }, guard: { assert() {} }, onProduced() {} }), { code: 'BTC_SIGNING_OUTCOME_UNKNOWN' });
  assert.equal(fresh.status(f.req.requestId).state, 'unknown'); await assert.rejects(fresh.sign(f.req.requestId, {})); assert.equal(calls, 1);
  assert.ok(fresh.status(f.req.requestId).partialPsbt);
  await assert.rejects(async () => fresh.prepare({ ...f.prepared, request: { ...f.req, requestId: 'new-id-same-input' } }), { code: 'BTC_OUTPOINT_HELD' });
});
test('BTC R2 guard fails before signer and externally supplied PSBT cannot enter API', async () => {
  const f = signingFixture(), adapter = new BitcoinSigningAdapter({ now: () => 1 }); const p = adapter.prepare(f.prepared);
  let calls = 0; const signer = { publicKey: f.sender.publicKey, sign: hash => { calls++; return f.sender.sign(hash); } };
  await assert.rejects(adapter.sign(f.req.requestId, { signer, guard: { assert() { throw new Error('locked'); } }, onProduced() {} }));
  assert.equal(adapter.status(f.req.requestId).state, 'prepared'); assert.equal(calls, 0);
  await assert.rejects(adapter.sign(f.req.requestId, { signer, guard: { assert() {} }, onProduced() {}, psbt: 'malicious external bytes' }), { code: 'BTC_SIGN_OPTIONS_INVALID' });
  assert.equal(calls, 0);
  const result = await adapter.sign(f.req.requestId, { signer, guard: { assert() {} }, onProduced() {} });
  assert.equal(result.originalRequest.to, TO); assert.equal(calls, 1); assert.ok(p.unsignedPsbt);
});
test('BTC R2 explicit read proof fetch is network-bound GET-only and rejects spent results', async () => {
  const f = signingFixture(), calls = [];
  const adapter = new BitcoinReadAdapter({ network: 'mainnet', request: async r => { calls.push(r); if (r.path === '/block-height/0') return GENESIS; return r.path.endsWith('/hex') ? f.previous.toHex() : { spent: false }; } });
  const proofs = await adapter.fetchPrevoutProofs(f.req.utxos);
  assert.equal(proofs.previousTransactions[0].hex, f.previous.toHex());
  new BitcoinSigningAdapter({ now: () => 1 }).prepare({ ...f.prepared, ...proofs });
  assert.ok(calls.every(r => r.method === 'GET'));
  const spent = new BitcoinReadAdapter({ network: 'mainnet', request: async r => r.path === '/block-height/0' ? GENESIS : r.path.endsWith('/hex') ? f.previous.toHex() : { spent: true } });
  await assert.rejects(spent.fetchPrevoutProofs(f.req.utxos), { code: 'BTC_UNSPENT_CHECK_REQUIRED' });
});
