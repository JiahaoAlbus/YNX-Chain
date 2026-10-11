import test from 'node:test';
import assert from 'node:assert/strict';
import { BitcoinReadAdapter, bitcoinDerivationPath, validateBitcoinAddress, parseBitcoinAmount, formatBitcoinAmount, normalizeBitcoinUtxos, createBitcoinPreview } from '../src/multichain-bitcoin.mjs';
import { BitcoinSigningAdapter } from '../src/multichain-bitcoin.mjs';
import { Transaction, payments, networks } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { deriveBitcoinMnemonicAccount } from '../src/multichain-bitcoin.mjs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HDNodeWallet } from 'ethers';
import bs58check from 'bs58check';
import { createHash } from 'node:crypto';
import { verifyBitcoinInclusion } from '../src/multichain-bitcoin.mjs';
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

const PUBLIC_BIP84_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function fakeMnemonicCustody(phrase = PUBLIC_BIP84_PHRASE) {
  const guard = { assert() {}, async step(action) { return action(); } };
  return { guard, withMnemonic: (action, permission) => { assert.equal(permission, 'fixture-permission'); return action(phrase, { account: 'public-vault-account' }, guard); }, expectedVaultAccount: 'public-vault-account', permission: 'fixture-permission' };
}
test('BTC R3 complete BIP84 public receive 0/1 and change vector path/pubkey/address', async () => {
  const c = fakeMnemonicCustody();
  const publicZpub = path => { const hd = HDNodeWallet.fromPhrase(PUBLIC_BIP84_PHRASE, '', path).neuter(); const payload = Buffer.from(bs58check.decode(hd.extendedKey)); payload.writeUInt32BE(0x04b24746); return bs58check.encode(payload); };
  assert.equal(publicZpub('m'), 'zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQUKQGUTzyHACMF');
  assert.equal(publicZpub("m/84'/0'/0'"), 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
  const first = await deriveBitcoinMnemonicAccount({ ...c, derivation: { network: 'mainnet' } });
  assert.equal(first.senderPath, "m/84'/0'/0'/0/0"); assert.equal(first.changePath, "m/84'/0'/0'/1/0");
  assert.equal(first.publicKey, '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c');
  assert.equal(first.changePublicKey, '03025324888e429ab8e3dbaf1f7802648b9cd01e9b418485c5fa4c1b9b5700e1a6');
  assert.equal(first.address, FROM); assert.equal(first.changeAddress, CHANGE);
  const second = await deriveBitcoinMnemonicAccount({ ...c, derivation: { network: 'mainnet', index: 1 } });
  assert.equal(second.senderPath, "m/84'/0'/0'/0/1"); assert.equal(second.address, TO);
  assert.equal(second.publicKey, '03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77');
  for (const output of [first, second]) { assert.equal(Object.hasOwn(output, 'privateKey'), false); assert.equal(Object.hasOwn(output, 'phrase'), false); }
  const testnet = await deriveBitcoinMnemonicAccount({ ...c, derivation: { network: 'testnet4', account: 2, index: 3, changeIndex: 4 } });
  assert.equal(testnet.senderPath, "m/84'/1'/2'/0/3"); assert.equal(testnet.changePath, "m/84'/1'/2'/1/4");
  assert.match(testnet.address, /^tb1/); assert.notEqual(testnet.publicKey, first.publicKey);
});
async function mnemonicSigningFixture(custody = fakeMnemonicCustody()) {
  const d = { network: 'mainnet', account: 0, index: 0, changeIndex: 0 };
  const address = await deriveBitcoinMnemonicAccount({ ...custody, derivation: d });
  const previous = new Transaction(); previous.version = 2; previous.addInput(new Uint8Array(32), 0xffffffff);
  previous.addOutput(Buffer.from(validateBitcoinAddress(address.address, 'mainnet').scriptPubKey, 'hex'), 100000n);
  const txid = previous.getId(), adapter = new BitcoinSigningAdapter({ now: () => 1 });
  const req = { ...request(), from: address.address, changeAddress: address.changeAddress, utxos: [{ ...utxo(), txid }] };
  const input = { ...custody, derivation: d, request: req, previousTransactions: [{ txid, hex: previous.toHex() }], unspentChecks: [{ network: 'mainnet', txid, vout: 0, spent: false }], expiresAt: 120000, maxFeeSats: '500' };
  await adapter.prepareMnemonic(input);
  return { adapter, req, input, custody };
}
test('BTC R3 mnemonic sign requires durable fence ACK before onProduced and returns no secret', async () => {
  const f = await mnemonicSigningFixture(), events = [];
  const result = await f.adapter.signMnemonic(f.req.requestId, { ...f.custody, persistSigningAttempt: r => { events.push('persist-attempt'); assert.equal(r.state, 'signing-attempt'); assert.equal(r.seedBinding.senderPath, "m/84'/0'/0'/0/0"); return { requestId: r.requestId, requestDigest: r.requestDigest, state: r.state, durable: true }; }, onProduced: r => { events.push('capture-raw'); assert.equal(r.originalRequest.from, FROM); } });
  assert.deepEqual(events, ['persist-attempt', 'capture-raw']); assert.equal(result.txid, Transaction.fromHex(result.rawTransaction).getId());
  assert.equal(JSON.stringify(result).includes(PUBLIC_BIP84_PHRASE), false); assert.equal(Object.hasOwn(result, 'privateKey'), false);
  await assert.rejects(f.adapter.signMnemonic(f.req.requestId, { ...f.custody, persistSigningAttempt() {}, onProduced() {} }), { code: 'BTC_SIGNING_ALREADY_ATTEMPTED' });
  const noAck = await mnemonicSigningFixture();
  await assert.rejects(noAck.adapter.signMnemonic(noAck.req.requestId, { ...noAck.custody, persistSigningAttempt() {}, onProduced() { assert.fail('no-op journal cannot authorize signature'); } }), { code: 'BTC_SIGNING_FENCE_ACK_REQUIRED' });
});
test('BTC R3 rejects ETH scalar seed, foreign account/path/address and missing journal ACK', async () => {
  await assert.rejects(deriveBitcoinMnemonicAccount({ ...fakeMnemonicCustody('1'.padStart(64, '0')), derivation: { network: 'mainnet' } }), { code: 'BTC_MNEMONIC_REQUIRED' });
  const f = await mnemonicSigningFixture();
  await assert.rejects(new BitcoinSigningAdapter({ now: () => 1 }).prepareMnemonic({ ...f.input, derivation: { network: 'mainnet', index: 1 } }), { code: 'BTC_OWNERSHIP_BINDING' });
  await assert.rejects(f.adapter.signMnemonic(f.req.requestId, { ...f.custody, expectedVaultAccount: 'foreign', persistSigningAttempt() {}, onProduced() {} }), { code: 'BTC_VAULT_ACCOUNT_MISMATCH' });
  await assert.rejects(f.adapter.signMnemonic(f.req.requestId, { ...f.custody, onProduced() {} }), { code: 'BTC_MNEMONIC_CUSTODY_REQUIRED' });
  let capture = 0;
  await assert.rejects(f.adapter.signMnemonic(f.req.requestId, { ...f.custody, persistSigningAttempt() { throw new Error('durability ACK failed'); }, onProduced() { capture++; } }));
  assert.equal(capture, 0); assert.equal(f.adapter.status(f.req.requestId).state, 'unknown');
  await assert.rejects(f.adapter.signMnemonic(f.req.requestId, { ...f.custody, persistSigningAttempt() {}, onProduced() {} }), { code: 'BTC_SIGNING_ALREADY_ATTEMPTED' });
});
async function actualMnemonicVault(t) {
  if (!process.env.BTC_MNEMONIC_HARNESS_SOURCE) throw new Error('Explicit isolated actual 9bdd mnemonic-vault harness required');
  const base = join(process.env.BTC_MNEMONIC_HARNESS_SOURCE, 'apps/wallet-desktop/src');
  const [{ PasswordWalletVault }, { PasswordVaultFile }, { DesktopKeyLifecycle }] = await Promise.all(['password-wallet-vault.mjs', 'password-vault-file.mjs', 'key-lifecycle.mjs'].map(file => import(pathToFileURL(join(base, file)).href)));
  const directory = await fs.mkdtemp(join(tmpdir(), 'ynx-btc-public-mnemonic-r3-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'wallet-vault-v3.json'), life = new DesktopKeyLifecycle(); life.setFocused(true);
  const store = new PasswordVaultFile(filePath), vault = new PasswordWalletVault({ filePath, legacyFilePaths: [], safeStorage: { isEncryptionAvailable: () => true }, authorization: life, fileStore: store });
  life.authorizer = vault.authorizer(); t.after(() => life.lock());
  const password = 'PUBLIC independent BTC fixture password 2026';
  await life.custody(guard => vault.setup({ password, confirmation: password }, guard)); await life.unlock({ password });
  const status = await life.run(() => vault.importAccount({ kind: 'recovery-phrase', value: PUBLIC_BIP84_PHRASE })); life.setAccount(status.account); await life.unlock({ password });
  return { directory, filePath, life, vault, custody: { expectedVaultAccount: status.account, withMnemonic: (...args) => vault.withMnemonic(...args) } };
}
test('BTC R3 actual protected withMnemonic and lifecycle retain original raw when focus locks post-action', async t => {
  const v = await actualMnemonicVault(t), before = await fs.readFile(v.filePath);
  const f = await v.life.run(() => mnemonicSigningFixture(v.custody)); let capture;
  await assert.rejects(v.life.run(() => f.adapter.signMnemonic(f.req.requestId, { ...v.custody, persistSigningAttempt: r => { assert.equal(r.seedBinding.vaultAccount, v.life.status().account); return { requestId: r.requestId, requestDigest: r.requestDigest, state: r.state, durable: true }; }, onProduced: r => { capture = r; v.life.setFocused(false); } })));
  assert.ok(capture.rawTransaction); assert.equal(f.adapter.status(f.req.requestId).result, capture);
  assert.equal(f.adapter.status(f.req.requestId).state, 'signed-unsubmitted'); assert.equal(v.life.status().locked, true);
  assert.deepEqual(await fs.readFile(v.filePath), before); assert.equal(f.adapter.status(f.req.requestId).seedBinding.publicKey, undefined);
});

const dsha = b => createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
async function queryFixture() {
  const f = signingFixture(), signer = new BitcoinSigningAdapter({ now: () => 1 }); signer.prepare(f.prepared);
  const result = await signer.sign(f.req.requestId, { signer: f.sender, guard: { assert() {} }, onProduced() {} });
  const sibling = 'c'.repeat(64), root = dsha(Buffer.concat([Buffer.from(result.txid, 'hex').reverse(), Buffer.from(sibling, 'hex').reverse()]));
  const header = Buffer.alloc(80); header.writeInt32LE(4, 0); root.copy(header, 36); header.writeUInt32LE(123, 68);
  const blockHash = Buffer.from(dsha(header)).reverse().toString('hex');
  const proof = { block_height: 20, pos: 0, merkle: [sibling] }, status = { confirmed: true, block_hash: blockHash, block_height: 20 };
  return { result, blockHash, proof, status, header: header.toString('hex'), input: { networkId: 'qa-bitcoin-mainnet', network: 'mainnet', txid: result.txid, rawTransaction: result.rawTransaction }, calls: [] };
}
function queryAdapter(f, change = () => undefined) {
  return new BitcoinReadAdapter({ network: 'mainnet', networkId: f.input.networkId, request: async q => {
    f.calls.push(q); const override = change(q, f.calls); if (override !== undefined) return override;
    if (q.path === '/block-height/0') return GENESIS;
    if (q.path.endsWith('/hex')) return f.result.rawTransaction;
    if (q.path.endsWith('/status')) return f.status;
    if (q.path === '/block-height/20') return f.blockHash;
    if (q.path.endsWith('/merkle-proof')) return f.proof;
    if (q.path.endsWith('/header')) return f.header;
    if (q.path === '/mempool/txids') return [f.result.txid];
    throw new Error('unexpected fixture route');
  } });
}
test('BTC R4 original signed raw/txid/network yields exact custody receipt only with header Merkle/canonical evidence', async () => {
  const f = await queryFixture(), original = JSON.stringify(f.input), observation = await queryAdapter(f).querySigned(f.input);
  assert.deepEqual(Object.keys(observation).sort(), ['networkId', 'receipt', 'state', 'txid']);
  assert.equal(observation.state, 'included');
  assert.deepEqual(observation.receipt, { txid: f.result.txid, blockHash: f.blockHash, blockHeight: '20', success: true, confirmationScope: 'rpc-block-inclusion' });
  assert.equal(JSON.stringify(f.input), original); assert.ok(f.calls.every(q => q.method === 'GET'));
  assert.equal(f.calls.filter(q => q.path === '/block-height/20').length, 2);
  assert.equal(f.calls.filter(q => q.path.endsWith('/status')).length, 2);
});
test('BTC R4 valid unconfirmed exact raw requires actual RPC mempool membership', async () => {
  const f = await queryFixture(); f.status = { confirmed: false };
  const read = queryAdapter(f); assert.equal((await read.querySigned(f.input)).state, 'submitted-unconfirmed');
  const absent = await queryAdapter(f, q => q.path === '/mempool/txids' ? [] : undefined).querySigned(f.input);
  assert.equal(absent.state, 'unknown'); assert.equal(absent.receipt, null);
});
test('BTC R4 wrong original raw/txid/network is never queried or resubmitted', async () => {
  for (const change of [input => { input.network = 'testnet4'; }, input => { input.networkId = 'foreign-config'; }, input => { input.txid = 'a'.repeat(64); }, input => { input.rawTransaction = input.rawTransaction.slice(0, -2) + '01'; }]) {
    const f = await queryFixture(), adapter = queryAdapter(f); change(f.input); const r = await adapter.querySigned(f.input);
    assert.equal(r.state, 'unknown'); assert.equal(r.receipt, null); assert.equal(f.calls.length, 0);
  }
});
test('BTC R4 bad provider raw/genesis/Merkle/header/status and reorg all remain unknown', async () => {
  const cases = [
    q => q.path === '/block-height/0' ? '0'.repeat(64) : undefined,
    q => q.path.endsWith('/hex') ? 'deadbeef' : undefined,
    q => q.path.endsWith('/merkle-proof') ? { block_height: 20, pos: 0, merkle: ['d'.repeat(64)] } : undefined,
    q => q.path.endsWith('/merkle-proof') ? { block_height: 21, pos: 0, merkle: [] } : undefined,
    q => q.path.endsWith('/header') ? '0'.repeat(160) : undefined,
    q => q.path.endsWith('/status') ? { confirmed: true, block_height: -1, block_hash: 'a'.repeat(64) } : undefined,
    (q, calls) => q.path === '/block-height/20' && calls.filter(x => x.path === q.path).length === 2 ? '0'.repeat(64) : undefined,
    (q, calls) => q.path.endsWith('/status') && calls.filter(x => x.path === q.path).length === 2 ? { confirmed: false } : undefined
  ];
  for (const bad of cases) { const f = await queryFixture(); const r = await queryAdapter(f, bad).querySigned(f.input); assert.equal(r.state, 'unknown'); assert.equal(r.receipt, null); assert.ok(f.calls.every(q => q.method === 'GET')); }
});
test('BTC R4 outage/404/abort yields unknown once, preserves original tuple and never invokes signer/broadcast', async () => {
  const f = await queryFixture(); let attempts = 0;
  const adapter = new BitcoinReadAdapter({ network: 'mainnet', networkId: f.input.networkId, request: async () => { attempts++; throw Object.assign(new Error('404/offline'), { status: 404 }); } });
  assert.equal((await adapter.querySigned(f.input)).state, 'unknown'); assert.equal(attempts, 1);
  const controller = new AbortController(); controller.abort();
  assert.equal((await adapter.querySigned(f.input, { signal: controller.signal })).state, 'unknown'); assert.equal(attempts, 1);
  assert.equal(f.input.rawTransaction, f.result.rawTransaction);
  assert.throws(() => adapter.sign(), { code: 'BTC_SIGNING_NOT_IMPLEMENTED' }); assert.throws(() => adapter.broadcast(), { code: 'BTC_BROADCAST_NOT_IMPLEMENTED' });
});
test('BTC R4 Merkle branch index bounds and flipped concatenation are verified, not status boolean trusted', async () => {
  const f = await queryFixture();
  assert.throws(() => verifyBitcoinInclusion({ txid: f.result.txid, blockHash: f.blockHash, blockHeight: '20', proof: { ...f.proof, pos: 2 }, header: f.header }), { code: 'BTC_INCLUSION_POSITION' });
  assert.throws(() => verifyBitcoinInclusion({ txid: f.result.txid, blockHash: f.blockHash, blockHeight: '20', proof: { ...f.proof, pos: 1 }, header: f.header }), { code: 'BTC_INCLUSION_MERKLE_ROOT' });
  const header = Buffer.from(f.header, 'hex'); dsha(Buffer.concat([Buffer.from('c'.repeat(64), 'hex').reverse(), Buffer.from(f.result.txid, 'hex').reverse()])).copy(header, 36);
  const hash = Buffer.from(dsha(header)).reverse().toString('hex');
  assert.equal(verifyBitcoinInclusion({ txid: f.result.txid, blockHash: hash, blockHeight: '20', proof: { ...f.proof, pos: 1 }, header: header.toString('hex') }).txid, f.result.txid);
});
