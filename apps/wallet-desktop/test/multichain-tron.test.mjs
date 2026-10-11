import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {utils as tronUtils} from 'tronweb';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {AbiCoder} from 'ethers';
import {tronAddress, tronUnits, tronDisplay, tronNetwork, tronDerivationPath,
  tronMnemonicAddress, trc20Parameter, tronBalance, trc20Balance, tronResources,
  tronResourceEstimate, tronIntentPreview, inspectTronEnvelope, TronReadAdapter,
  TRON_CAPABILITIES, buildTronUnsigned, verifyTronUnsigned, verifyTronSigned,
  TronSignReview, normalizeTronReceipt, TronTransactionQuery, TRON_QUERY_ENDPOINTS,
  trc20Decimals, trc20Text, TRC20_METADATA_SELECTORS, TRC20_METADATA_LIMITS} from '../src/multichain-tron.mjs';
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
function r3Fixture(token = false, success = true) {
  const f = r2Fixture(token);
  // PUBLIC deterministic fixture signing only, not a user approval or broadcast.
  const transaction = tronUtils.crypto.signTransaction(PUBLIC_SCALAR_ONE, structuredClone(f.transaction));
  const original = {network, owner: f.intent.owner, binding: f.intent.binding, txID: transaction.txID,
    raw_data_hex: transaction.raw_data_hex, signature: transaction.signature[0], transaction};
  const body = {...structuredClone(transaction), ret: [{contractRet: success ? 'SUCCESS' : 'REVERT'}]};
  const info = {id: transaction.txID, blockNumber: 77, ...(token || !success ? {receipt: {result: success ? 'SUCCESS' : 'REVERT'}} : {}),
    ...(!success ? {result: 'FAILED', resMessage: '726576657274'} : {})};
  const block = {blockID: '000000000000004d' + 'bb'.repeat(24), block_header: {raw_data: {number: 77}}, transactions: [structuredClone(body)]};
  return {...f, original, body, info, block};
}
function r3Transport(f, mutate = () => {}) {
  const calls = []; const transport = async (n, endpoint, request) => {
    calls.push({network: n, endpoint, request: structuredClone(request)});
    let response = endpoint === '/wallet/getblockbynum' ? (request.num === 0 ? {blockID: n.genesisBlockId, block_header: {raw_data: {number: 0}}} : structuredClone(f.block))
      : endpoint === '/wallet/gettransactionbyid' ? structuredClone(f.body) : structuredClone(f.info);
    const changed = mutate(endpoint, response, request); return changed === undefined ? response : changed;
  };
  return {calls, transport};
}
test('R3 included native/TRC20 original tuple yields only RPC block inclusion, never finality', async () => {
  for (const token of [false, true]) {
    const f = r3Fixture(token), rpc = r3Transport(f), before = JSON.stringify(f.original);
    const result = await new TronTransactionQuery({network, transport: rpc.transport}).check(f);
    assert.deepEqual(result.receipt, {txid: f.original.txID, blockHash: f.block.blockID, blockHeight: 77, success: true, confirmationScope: 'rpc-block-inclusion'});
    assert.equal(result.txid, f.original.txID); assert.equal(result.networkId, 'shasta'); assert.equal(result.state, 'included');
    assert.equal('finality' in result, false); assert.equal(JSON.stringify(f.original), before);
    assert.equal(rpc.calls.length, 4); assert.ok(rpc.calls.every(c => TRON_QUERY_ENDPOINTS.includes(c.endpoint)));
  }
});
test('R3 FullNode JSON order, default zero, hex case/int64 strings normalize without changing original bytes', () => {
  const f = r3Fixture(true); const remote = structuredClone(f.body);
  delete remote.visible; remote.raw_data.contract[0].Permission_id = 0;
  delete remote.raw_data.contract[0].parameter.value.call_value;
  remote.raw_data.contract[0].parameter.value.call_token_value = 0;
  remote.raw_data.contract[0].parameter.value.token_id = 0;
  remote.raw_data.contract[0].parameter.value.owner_address = remote.raw_data.contract[0].parameter.value.owner_address.toUpperCase();
  remote.raw_data.timestamp = String(remote.raw_data.timestamp); remote.raw_data.expiration = String(remote.raw_data.expiration);
  remote.raw_data = Object.fromEntries(Object.entries(remote.raw_data).reverse());
  assert.equal(normalizeTronReceipt({...f, network, body: remote}).state, 'included');
});
test('R3 failed requires original included tuple and agreeing explicit node execution evidence', () => {
  const f = r3Fixture(true, false), result = normalizeTronReceipt({...f, network});
  assert.equal(result.state, 'failed'); assert.equal(result.receipt.success, false);
  assert.deepEqual(result.evidence, {contractRet: 'REVERT', receiptResult: 'REVERT', infoResult: 'FAILED', resMessageHex: '726576657274'});
  assert.throws(() => normalizeTronReceipt({...f, network, info: {...f.info, receipt: {result: 'SUCCESS'}}}));
  const success = r3Fixture(true);
  assert.throws(() => normalizeTronReceipt({...success, network, info: {...success.info, result: 'FAILED'}}));
});
test('R3 missing/expired query and disconnect are UNKNOWN, no retry/re-sign/broadcast/cancellation', async () => {
  const f = r3Fixture();
  const missing = r3Transport(f, endpoint => endpoint === '/wallet/gettransactionbyid' ? {} : undefined);
  const result = await new TronTransactionQuery({network, transport: missing.transport}).check(f);
  assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null); assert.equal(missing.calls.length, 2);
  let calls = 0; const query = new TronTransactionQuery({network, transport: async () => {calls++; throw Error('offline');}});
  const offline = await query.check(f); assert.equal(offline.state, 'unknown'); assert.equal(calls, 1);
  assert.equal(offline.evidence.queryError, 'TRON_QUERY_UNAVAILABLE');
  assert.equal(normalizeTronReceipt({...f, network}).state, 'included'); // original lifetime, not wall-clock resign
});
test('R3 body matched but missing execution receipt remains UNKNOWN, not inferred submitted/included', async () => {
  const f = r3Fixture(), rpc = r3Transport(f, endpoint => endpoint === '/wallet/gettransactioninfobyid' ? {} : undefined);
  const result = await new TronTransactionQuery({network, transport: rpc.transport}).check(f);
  assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null); assert.equal(result.evidence.bodyMatched, true); assert.equal(result.evidence.receiptMissing, true); assert.equal(rpc.calls.length, 3);
});
test('R3 wrong network/body/hash/signature/receipt/block/unknown result cannot create terminal success/fail', async () => {
  const f = r3Fixture();
  const cases = [
    (ep, r, req) => {if(ep === '/wallet/getblockbynum' && req.num === 0)r.blockID = 'ff'.repeat(32);},
    (ep, r) => {if(ep === '/wallet/gettransactionbyid')r.raw_data.contract[0].parameter.value.to_address = H;},
    (ep, r) => {if(ep === '/wallet/gettransactionbyid')r.signature[0] = '00'.repeat(65);},
    (ep, r) => {if(ep === '/wallet/gettransactionbyid')r.raw_data_hex += '00';},
    (ep, r) => {if(ep === '/wallet/gettransactioninfobyid')r.id = 'ff'.repeat(32);},
    (ep, r, req) => {if(ep === '/wallet/getblockbynum' && req.num === 77)r.transactions = [];},
    (ep, r, req) => {if(ep === '/wallet/getblockbynum' && req.num === 77)r.transactions.push(structuredClone(r.transactions[0]));},
    (ep, r) => {if(ep === '/wallet/gettransactionbyid')r.ret[0].contractRet = 'DEFAULT';},
    ep => ep === '/wallet/gettransactioninfobyid' ? {Error: 'node temporarily unavailable'} : undefined
  ];
  for (const mutate of cases) {
    const rpc = r3Transport(f, mutate), result = await new TronTransactionQuery({network, transport: rpc.transport}).check(f);
    assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null); assert.equal(result.txid, f.original.txID);
    assert.ok(rpc.calls.length <= 4);
  }
});
test('R3 original binding mismatch rejects before query, in-flight mutation cannot replace snapshot', async () => {
  const f = r3Fixture(); let calls = 0;
  const bad = {...f.original, txID: 'ff'.repeat(32)};
  await assert.rejects(new TronTransactionQuery({network, transport: async () => {calls++;}}).check({...f, original: bad}), code('TRON_ORIGINAL_TUPLE_MISMATCH'));
  assert.equal(calls, 0);
  f.intent = structuredClone(f.intent);
  const rpc = r3Transport(f); const q = new TronTransactionQuery({network, transport: rpc.transport});
  const originalTxID = f.original.txID, pending = q.check(f); f.original.txID = 'ff'.repeat(32); f.intent.to = H;
  // Mutable caller input cannot alter the internally captured original.
  const result = await pending; assert.equal(result.txid, originalTxID); assert.equal(result.state, 'included');
});

const abi = AbiCoder.defaultAbiCoder();
const constant = value => ({result: {result: true}, constant_result: [value]});
const word = n => BigInt(n).toString(16).padStart(64, '0');
const text = value => abi.encode(['string'], [value]).slice(2);
function r4Transport({decimals = 6, name = 'TRON QA Token', symbol = 'QAT', balance = '1000001', mutate = () => {}} = {}) {
  const calls = [];
  return {calls, transport: async (chain, endpoint, request) => {
    calls.push({chain, endpoint, request: structuredClone(request)});
    const response = endpoint === '/wallet/getblockbynum' ? {blockID: chain.genesisBlockId, block_header: {raw_data: {number: 0}}}
      : constant(request.function_selector === 'decimals()' ? word(decimals)
        : request.function_selector === 'name()' ? text(name)
          : request.function_selector === 'symbol()' ? text(symbol) : word(balance));
    const changed = mutate(endpoint, request, response); return changed === undefined ? response : changed;
  }};
}
test('R4 metadata and tokenRead bind exact contract/network/account and exact base units', async () => {
  const rpc = r4Transport(), adapter = new TronReadAdapter({network, transport: rpc.transport});
  const read = await adapter.tokenRead(A, B);
  assert.deepEqual(read, {networkId: 'shasta', networkGenesis: network.genesisBlockId,
    contractHex: tronAddress(B).hex, contractAddress: B, name: 'TRON QA Token', symbol: 'QAT', decimals: 6,
    verification: 'provider-reported-not-consensus', accountHex: H, accountAddress: A, units: '1000001', display: '1.000001'});
  assert.equal(rpc.calls.length, 5); assert.equal(Object.isFrozen(read), true);
  assert.deepEqual(rpc.calls.slice(1).map(c => c.request.function_selector), ['decimals()', 'symbol()', 'name()', 'balanceOf(address)']);
  for (const call of rpc.calls.slice(1)) { assert.equal(call.request.contract_address, tronAddress(B).hex); assert.equal(call.request.owner_address, H); assert.equal(call.request.visible, false); }
  assert.ok(rpc.calls.slice(1,4).every(c => c.request.parameter === ''));
  assert.equal(rpc.calls[4].request.parameter, H.slice(2).padStart(64, '0'));
  assert.deepEqual(TRC20_METADATA_SELECTORS, {name: 'name()', symbol: 'symbol()', decimals: 'decimals()'});
});
test('R4 metadata decimal0/255 and uint256 balances preserve units, no float/rounding', async () => {
  for (const decimals of [0, 255]) {
    const units = ((1n << 256n) - 1n).toString(), rpc = r4Transport({decimals, balance: units});
    const read = await new TronReadAdapter({network, transport: rpc.transport}).tokenRead(A, B);
    assert.equal(read.decimals, decimals); assert.equal(read.units, units); assert.equal(read.display, tronDisplay(units, decimals));
  }
  const zero = r4Transport({balance: '0'}); assert.equal((await new TronReadAdapter({network, transport: zero.transport}).tokenRead(A, B)).display, '0');
});
test('R4 optional metadata failure/invalid decimals fail without guessed fallback or later calls', async () => {
  const cases = [{result: {result: false}, constant_result: [word(6)]}, {Error: 'contract unavailable'}, constant(word(256)), constant('00'), constant(word(6) + word(0))];
  for (const response of cases) {
    const rpc = r4Transport({mutate: (_, request) => request.function_selector === 'decimals()' ? response : undefined});
    await assert.rejects(new TronReadAdapter({network, transport: rpc.transport}).tokenMetadata(A, B));
    assert.equal(rpc.calls.length, 2);
  }
  assert.equal(trc20Decimals(constant(word(0))), 0);
  assert.equal(trc20Decimals(constant(word(255))), 255);
});
test('R4 canonical string ABI rejects wrong offset/padding/trailing/bytes32/invalid UTF8', () => {
  const canonical = text('QA');
  const malformed = [word(64) + canonical.slice(64), canonical.slice(0,-2) + '01', canonical + word(0), word(0x5141),
    word(32) + word(2) + 'c328' + '00'.repeat(30), word(32) + word((1n << 255n)) + word(0)];
  for (const raw of malformed) assert.throws(() => trc20Text(constant(raw), 'symbol'));
  assert.equal(trc20Text(constant(text('测试代币')), 'name'), '测试代币');
  assert.throws(() => trc20Text(constant(canonical), 'arbitrary'));
});
test('R4 bounded metadata text rejects controls/bidi/markup/empty and byte/codepoint limits', () => {
  for (const bad of ['', ' QA', 'QA ', 'QA\u0000', 'QA\n', 'QA\u202e', 'QA\u200b', '<script>', '\ufeffQA', 'A'.repeat(17), '测'.repeat(11)]) assert.throws(() => trc20Text(constant(text(bad)), 'symbol'));
  assert.equal(trc20Text(constant(text('A'.repeat(16))), 'symbol'), 'A'.repeat(16));
  assert.equal(trc20Text(constant(text('A'.repeat(64))), 'name'), 'A'.repeat(64));
  assert.throws(() => trc20Text(constant(text('A'.repeat(65))), 'name'));
  assert.throws(() => trc20Text(constant(text('测'.repeat(43))), 'name'));
  assert.deepEqual(TRC20_METADATA_LIMITS, {name: {codepoints: 64, utf8Bytes: 128}, symbol: {codepoints: 16, utf8Bytes: 32}});
  assert.equal(Object.isFrozen(TRC20_METADATA_LIMITS.name), true);
});
test('R4 API success with VM failure/contradiction or malformed output is not a zero balance', async () => {
  const bad = [constant('00'), {result: {result: true}, constant_result: [word(0), word(1)]},
    {...constant(word(0)), result: {result: true, code: 'CONTRACT_EXE_ERROR'}},
    {...constant(word(0)), transaction: {ret: [{ret: 'REVERT'}]}},
    {...constant(word(0)), transaction: {ret: [{ret: 'SUCCESS', contractRet: 'REVERT'}]}},
    {...constant(word(0)), transaction: {ret: []}}, {...constant(word(0)), Error: ''}];
  for (const response of bad) {
    const rpc = r4Transport({mutate: (_, request) => request.function_selector === 'balanceOf(address)' ? response : undefined});
    await assert.rejects(new TronReadAdapter({network, transport: rpc.transport}).tokenRead(A, B));
    assert.equal(rpc.calls.length, 5);
  }
});
test('R4 invalid account/contract/decimals and wrong genesis reject before metadata request', async () => {
  const rpc = r4Transport(), reader = new TronReadAdapter({network, transport: rpc.transport});
  await assert.rejects(reader.tokenMetadata('invalid', B)); await assert.rejects(reader.tokenMetadata(A, H.slice(2)));
  await assert.rejects(reader.tokenBalance(A, B, 256)); assert.equal(rpc.calls.length, 0);
  const wrong = r4Transport({mutate: endpoint => endpoint === '/wallet/getblockbynum' ? {blockID: 'ff'.repeat(32), block_header: {raw_data: {number: 0}}} : undefined});
  await assert.rejects(new TronReadAdapter({network, transport: wrong.transport}).tokenRead(A, B), code('TRON_NETWORK_MISMATCH'));
  assert.equal(wrong.calls.length, 1);
});
test('R4 metadata transport failures propagate once, with no retry/partial metadata/sign/send', async () => {
  let calls = 0;
  const reader = new TronReadAdapter({network, transport: async (_, endpoint) => {
    calls++; if(endpoint === '/wallet/getblockbynum')return {blockID: network.genesisBlockId, block_header: {raw_data: {number: 0}}};
    throw Object.assign(Error('offline'), {code: 'FIXTURE_OFFLINE'});
  }});
  await assert.rejects(reader.tokenRead(A, B), code('FIXTURE_OFFLINE')); assert.equal(calls, 2);
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
