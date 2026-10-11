import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {utils as tronUtils} from 'tronweb';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {tronAddress, tronUnits, tronDisplay, tronNetwork, tronDerivationPath,
  tronMnemonicAddress, trc20Parameter, tronBalance, trc20Balance, tronResources,
  tronResourceEstimate, tronIntentPreview, inspectTronEnvelope, TronReadAdapter,
  TRON_CAPABILITIES, buildTronUnsigned, verifyTronUnsigned, verifyTronSigned,
  TronSignReview} from '../src/multichain-tron.mjs';
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

const PUBLIC_SCALAR_ONE = '1'.padStart(64, '0');
const scalarOwner = tronAddress(tronUtils.crypto.pkToAddress(PUBLIC_SCALAR_ONE)).hex;
const r2Context = {network, reference: {number: 65537, blockID: '0000000000010001' + 'aa'.repeat(24), timestamp: 1000},
  timestamp: 1100, expiration: 61000, feeLimitSun: '0'};
function r2Fixture(token = false) {
  const intent = tronIntentPreview({network, owner: scalarOwner, to: B, amount: '1.000001',
    ...(token ? {asset: 'trc20', decimals: 6, contract: A} : {})});
  const context = structuredClone(r2Context); if (token) context.feeLimitSun = '10000000';
  return {intent, context, transaction: buildTronUnsigned(intent, context, 1200)};
}
test('R2 official protobuf constructs and decodes native and exact TRC20 transfer', () => {
  for (const token of [false, true]) {
    const f = r2Fixture(token); const result = verifyTronUnsigned(f.transaction, f.intent, f.context, 1200);
    assert.equal(result.transactionVerified, true); assert.equal(result.broadcastAuthorized, false);
    assert.equal(f.transaction.txID, createHash('sha256').update(Buffer.from(f.transaction.raw_data_hex, 'hex')).digest('hex'));
    assert.equal(tronUtils.transaction.txCheck(f.transaction), true);
  }
  // Independently cross-run official TronWeb address derivation for PUBLIC phrase.
  const native = tronUtils.accounts.generateAccountWithMnemonic(phrase);
  assert.equal(native.address, B);
});
test('R2 JSON and protobuf tampering/unknown fields cannot pass intent equality', () => {
  for (const mutate of [t => t.raw_data.contract[0].parameter.value.to_address = H,
    t => t.raw_data.contract[0].parameter.value.amount++, t => t.raw_data.expiration++,
    t => t.raw_data.contract.push(structuredClone(t.raw_data.contract[0])),
    t => t.raw_data.contract[0].Permission_id = 2, t => t.raw_data.data = 'aa',
    t => t.raw_data.scripts = 'aa', t => t.raw_data.contract[0].parameter.value.extra = 1,
    t => t.raw_data_hex += 'a00601', // hidden unknown wire field, recomputed hash
    t => t.raw_data.contract[0].parameter.type_url = 'type.googleapis.com/protocol.TransferAssetContract']) {
    const f = r2Fixture(); const t = structuredClone(f.transaction); mutate(t);
    t.txID = createHash('sha256').update(Buffer.from(t.raw_data_hex, 'hex')).digest('hex');
    assert.throws(() => verifyTronUnsigned(t, f.intent, f.context, 1200));
  }
});
test('R2 TRC20 only transfer, no extra value/token fields or permission/fee expansion', () => {
  for (const mutate of [t => t.raw_data.contract[0].parameter.value.call_value = 1,
    t => t.raw_data.contract[0].parameter.value.call_token_value = 1,
    t => t.raw_data.contract[0].parameter.value.token_id = 1,
    t => t.raw_data.contract[0].parameter.value.data = '095ea7b3' + t.raw_data.contract[0].parameter.value.data.slice(8),
    t => t.raw_data.fee_limit++]) {
    const f = r2Fixture(true), t = structuredClone(f.transaction); mutate(t);
    assert.throws(() => verifyTronUnsigned(t, f.intent, f.context, 1200));
  }
  const f = r2Fixture(true);
  assert.throws(() => buildTronUnsigned(f.intent, {...f.context, feeLimitSun: '0'}, 1200), code('TRON_FEE_INVALID'));
  assert.throws(() => buildTronUnsigned(f.intent, {...f.context, permissionId: 2}, 1200), code('TRON_PERMISSION_UNSUPPORTED'));
});
test('R2 wrong network/reference/expiry and unsafe protobuf numeric range fail closed', () => {
  const f = r2Fixture();
  assert.throws(() => verifyTronUnsigned(f.transaction, f.intent, {...f.context, network: {...network, id: 'nile'}}, 1200), code('TRON_NETWORK_MISMATCH'));
  assert.throws(() => buildTronUnsigned(f.intent, {...f.context, reference: {...f.context.reference, blockID: 'ff'.repeat(32)}}, 1200));
  assert.throws(() => verifyTronUnsigned(f.transaction, f.intent, f.context, 62000), code('TRON_EXPIRATION_INVALID'));
  assert.throws(() => buildTronUnsigned(f.intent, {...f.context, expiration: 86402000}, 1200), code('TRON_EXPIRATION_INVALID'));
  const large = tronIntentPreview({network, owner: scalarOwner, to: B, amount: '9007199254.740992'});
  assert.throws(() => buildTronUnsigned(large, f.context, 1200), code('TRON_CODEC_INTEGER_RANGE'));
});
test('R2 public offline signing returns original verified tuple, once, without broadcast', async () => {
  for (const token of [false, true]) {
    const f = r2Fixture(token), review = new TronSignReview({...f, now: 1200});
    let signatures = 0, retained;
    const boundary = {now: () => 1200, guard: {assert() {}}, withSecret: async action => {signatures++; return action(PUBLIC_SCALAR_ONE, {}, {assert() {}});}, onProduced: value => {retained = value;}};
    const result = await review.sign(boundary);
    assert.equal(result.state, 'signed-unsubmitted'); assert.equal(result.txID, f.transaction.txID);
    assert.equal(result.signature.length, 130); assert.equal(retained, result); assert.equal(result.broadcastAuthorized, false);
    assert.equal(verifyTronSigned(result.transaction, f.intent, f.context, 1200).owner, scalarOwner);
    await assert.rejects(review.sign(boundary), code('TRON_REVIEW_CONSUMED')); assert.equal(signatures, 1);
    const wrong = structuredClone(result.transaction); wrong.signature[0] = '00'.repeat(65);
    assert.throws(() => verifyTronSigned(wrong, f.intent, f.context, 1200));
  }
});
test('R2 actual DesktopKeyLifecycle post-action gate retains raw/signature on focus loss', async () => {
  const f = r2Fixture(), review = new TronSignReview({...f, now: 1200});
  const life = new DesktopKeyLifecycle({now: () => 1200, authorizer: {available: () => true, authenticate: async () => ({account: scalarOwner}), method: 'PUBLIC-test-only'}, schedule: () => null, unschedule() {}});
  life.setFocused(true); await life.unlock(); let custody, actions = 0;
  await assert.rejects(life.run(() => review.sign({guard: life.current(), now: () => 1200,
    withSecret: async action => {const guard = life.current(); return guard.step(async () => {actions++; const result = await action(PUBLIC_SCALAR_ONE, {}, guard); life.setFocused(false); return result;});},
    onProduced: value => {custody = value;}})), code('TRON_RECORDED_OUTCOME_UNKNOWN'));
  assert.equal(life.status().locked, true); assert.equal(review.result.state, 'unknown');
  assert.equal(review.result.raw_data_hex, custody.raw_data_hex); assert.equal(review.result.signature, custody.signature);
  assert.equal(actions, 1); assert.equal(review.result.broadcastAuthorized, false);
});
test('R2 cancellation before generation creates no signature; custody failure after generation retains UNKNOWN', async () => {
  const f = r2Fixture(); let called = 0;
  const before = new TronSignReview({...f, now: 1200});
  await assert.rejects(before.sign({guard: {assert() {throw Error('locked');}}, now: () => 1200, withSecret: async () => {called++;}, onProduced() {}}), /locked/);
  assert.equal(called, 0); assert.equal(before.result, null);
  for (const mode of ['storage', 'post-guard', 'duplicate']) {
    const review = new TronSignReview({...f, now: 1200}); let retained, n = 0;
    await assert.rejects(review.sign({guard: {assert() {}}, now: () => 1200,
      withSecret: async action => {n++; const result = await action(PUBLIC_SCALAR_ONE, {}, {assert() {}}); if(mode === 'duplicate') await action(PUBLIC_SCALAR_ONE, {}, {assert() {}}); if(mode === 'post-guard') throw Error('post-action guard'); return result;},
      onProduced: value => {retained = value; if(mode === 'storage') throw Error('protected journal failed');}}), code('TRON_RECORDED_OUTCOME_UNKNOWN'));
    assert.equal(review.result.state, 'unknown'); assert.equal(review.result.signature, retained.signature); assert.equal(n, 1);
    await assert.rejects(review.sign({}), code('TRON_REVIEW_CONSUMED'));
  }
});
test('R2 guarded mnemonic callback derives TRON 195 key internally with no private-key export', async () => {
  const intent = tronIntentPreview({network, owner: B, to: A, amount: '1'}), context = {...r2Context, derivationIndex: 0};
  const transaction = buildTronUnsigned(intent, context, 1200), review = new TronSignReview({transaction, intent, context, now: 1200});
  let original;
  const result = await review.signMnemonic({guard: {assert() {}}, now: () => 1200,
    withMnemonic: action => action(phrase, {}, {assert() {}}), onProduced: value => {original = value;}});
  assert.equal(result.owner, tronAddress(B).hex); assert.equal(original, result);
  assert.equal(verifyTronSigned(result.transaction, intent, context, 1200).owner, tronAddress(B).hex);
  assert.equal('privateKey' in result, false); assert.equal('mnemonic' in result, false);
  await assert.rejects(review.signMnemonic({withMnemonic() {}, guard: {assert() {}}, onProduced() {}, now: () => 1200}), code('TRON_REVIEW_CONSUMED'));
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
