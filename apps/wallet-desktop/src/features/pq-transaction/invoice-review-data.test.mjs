import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import core from './invoice-review-data.fixture.mjs';
import {projectPQInvoiceReviewData} from './invoice-review-data.mjs';
import {preparePQTypedActionReview,recheckPQTypedActionReview,signPQReviewedTypedAction,
  pqTypedActionInvocationData,readPQTypedActionInvoiceReviewData,cancelPQTypedActionReview} from './typed-action-caller.mjs';
import {encodePQNativeAction,decodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// PUBLIC syntax inputs and controlled policy only. No Source/Native authority,
// live account, signing, Member creation, RPC, journal or broadcast is invoked.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const merchant = core.envelope.owner, payer = '0x' + '22'.repeat(20);
const envelope = {chainId:core.envelope.networkHex,nativeChainId:core.envelope.nativeChainID,
  owner:merchant,nonce:core.envelope.nonce,fee:'1'};
function vector(name) {
  const v = core.vectors.find(row => row.name === name), payload = {...v.input};
  if (payload.termsHashHex) {payload.termsHash = payload.termsHashHex; delete payload.termsHashHex;}
  if (payload.settlementHashHex) {payload.settlementHash = payload.settlementHashHex; delete payload.settlementHashHex;}
  return {...envelope,kind:v.kind,payload};
}
function inputs(open = false) {
  const terms = vector(open ? 'terms-open-payer' : 'terms-specific-payer');
  if (!open) terms.payload.payer = payer;
  const termsDigest = 'a5'.repeat(32), settlementHash = '5a'.repeat(32);
  const settle = {...vector('settle'),owner:payer};
  const refund = vector('refund');
  return {terms,termsDigest,settle,refund,settlement:{action:settle,memberHash:'0x' + settlementHash}};
}
const refs = f => ({terms:f.terms,termsDigest:f.termsDigest,settlement:null});
const clone = value => structuredClone(value);

test('invoice terms projects every immutable signed term and raw units without floating point', () => {
  for (const open of [false,true]) {
    const f = inputs(open), out = projectPQInvoiceReviewData(f.terms,{termsDigest:f.termsDigest});
    assert.deepEqual(out.terms,f.terms.payload); assert.deepEqual(out.actionPayload,f.terms.payload);
    assert.equal(out.merchant,merchant); assert.equal(out.payer,open ? null : payer);
    assert.equal(out.payerRule,open ? 'independently-approved-payer' : 'exact-payer');
    assert.equal(out.recipient,f.terms.payload.recipient); assert.equal(out.principalMoves,false);
    assert.equal(out.amount.atoms,'9007199254740997'); assert.equal(out.fee.atoms,'1');
    assert.equal(out.terms.expiresAt,'9223372036854775807'); assert.equal(out.expiryRule,'execution-height-inclusive');
    for (const u of [out.amount,out.fee]) assert.deepEqual(Object.keys(u),['atoms','assetID','unitVersion','notation']);
    assert.equal(out.amount.assetID,'YNXT'); assert.equal(out.amount.unitVersion,'1'); assert.equal(out.amount.notation,'raw-atoms');
    assert.equal(out.nativeChainId,core.envelope.nativeChainID); assert.equal(out.nonce,core.envelope.nonce);
    assert.equal(out.permissionGranted,false); assert.equal(out.dataOnly,true); assert.equal(out.consensusFinality,false);
    assert.equal(out.memberCount,1); assert.equal(out.memberIndex,0); assert.equal(out.purpose,'TX-BATCH');
  }
});

test('settle shows the independent payer, merchant recipient and all original terms', () => {
  for (const open of [false,true]) {
    const f = inputs(open), out = projectPQInvoiceReviewData(f.settle,refs(f));
    assert.equal(out.owner,payer); assert.equal(out.payer,payer); assert.equal(out.merchant,merchant);
    assert.equal(out.recipient,f.terms.payload.recipient); assert.deepEqual(out.terms,f.terms.payload);
    assert.equal(out.amount.atoms,f.terms.payload.amount); assert.equal(out.termsHash,f.termsDigest);
    assert.equal(out.principalMoves,true); assert.equal(out.currentLedgerChecksRequired,true);
  }
});

test('refund recipient is derived only from the retained settlement payer, including open-payer terms', () => {
  for (const open of [false,true]) {
    const f = inputs(open), out = projectPQInvoiceReviewData(f.refund,{...refs(f),settlement:f.settlement});
    assert.equal(out.payer,payer); assert.equal(out.recipient,payer); assert.equal(out.owner,merchant);
    assert.equal(out.refundRecipientEditable,false); assert.equal(out.payerRule,'original-settlement-payer');
    assert.equal(out.refundID,f.refund.payload.refundID); assert.equal(out.settlementNativeHash,f.settlement.memberHash);
    assert.deepEqual(out.terms,f.terms.payload); assert.equal(out.amount.atoms,'4294967301');
    assert.equal(out.currentLedgerChecksRequired,true); assert.equal(out.submitted,false);
  }
});

test('projection is detached and deeply immutable; a changed request cannot alter the reviewed recipient or amount', () => {
  const f = inputs(), out = projectPQInvoiceReviewData(f.refund,{...refs(f),settlement:f.settlement});
  f.terms.payload.recipient = merchant; f.terms.payload.amount = '1'; f.settle.owner = merchant; f.refund.payload.amount = '99';
  assert.equal(out.recipient,payer); assert.equal(out.amount.atoms,'4294967301'); assert.equal(out.terms.amount,'9007199254740997');
  for (const item of [out,out.terms,out.actionPayload,out.amount,out.fee]) assert.equal(Object.isFrozen(item),true);
  assert.throws(() => {out.terms.payer = merchant;},TypeError);
});

test('all terms, network, fee, amount and reference substitutions refuse instead of silently approving', () => {
  const edits = [
    f => {f.settle.chainId = '77'.repeat(32);}, f => {f.settle.nativeChainId = '6423';},
    f => {f.settle.payload.merchant = payer;}, f => {f.settle.payload.invoiceID = 'another-invoice';},
    f => {f.settle.payload.termsHash = '33'.repeat(32);}, f => {f.settle.payload.amount = '1';},
    f => {f.settle.owner = merchant;}, f => {f.settle.owner = f.terms.payload.recipient;},
    f => {f.terms.payload.payer = merchant;}, f => {f.settle.fee = '2';},
  ];
  for (const edit of edits) {const f = inputs(); edit(f); assert.throws(() => projectPQInvoiceReviewData(f.settle,refs(f)));}
  for (const field of ['sessionID','keyEpoch','revision','maxFee','expiresAt']) {
    const f = inputs(); f.terms.payload[field] = field === 'sessionID' ? '' : '0';
    assert.throws(() => projectPQInvoiceReviewData(f.settle,refs(f)));
  }
});

test('refund rejects missing/foreign settlement, different native hash, excess principal and caller supplied refund-to', () => {
  const edits = [
    f => {f.settlement = null;}, f => {f.settlement.memberHash = '0x' + '33'.repeat(32);},
    f => {f.settlement.action = f.terms;}, f => {f.settle.payload.invoiceID = 'other';},
    f => {f.settle.payload.merchant = payer;}, f => {f.settle.payload.termsHash = '33'.repeat(32);},
    f => {f.settle.chainId = '33'.repeat(32);}, f => {f.refund.owner = payer;},
    f => {f.settle.owner = merchant;}, f => {f.refund.payload.amount = '9007199254740998';},
    f => {f.refund.payload.recipient = '0x' + '44'.repeat(20);},
  ];
  for (const edit of edits) {const f = inputs(); edit(f); assert.throws(() => projectPQInvoiceReviewData(f.refund,{...refs(f),settlement:f.settlement}));}
});

test('display parser rejects getters, proxies, missing fields, binary hash confusion and noncanonical integers without executing hooks', () => {
  let calls = 0; const f = inputs();
  for (const value of [new Proxy(f.terms,{getPrototypeOf(){calls++;return Object.prototype;}}),
    {...f.terms,get payload(){calls++;return f.terms.payload;}}]) assert.throws(() => projectPQInvoiceReviewData(value,{termsDigest:f.termsDigest}));
  assert.equal(calls,0);
  for (const amount of [1,1n,'01','1.0','-1','0','9223372036854775808']) {
    const a = clone(f.terms); a.payload.amount = amount; assert.throws(() => projectPQInvoiceReviewData(a,{termsDigest:f.termsDigest}));
  }
  for (const digest of ['0x' + f.termsDigest,'A5'.repeat(32),'0'.repeat(64)]) assert.throws(() => projectPQInvoiceReviewData(f.terms,{termsDigest:digest}));
  assert.throws(() => projectPQInvoiceReviewData({...f.terms,approved:true},{termsDigest:f.termsDigest}));
  assert.throws(() => projectPQInvoiceReviewData(f.settle,null));
});

const chain = 'a'.repeat(64), at = Date.parse('2026-10-31T00:00:00.000Z');
function snapshot(owner = merchant, executionHeight = '100') {
  return parsePQAccountAuthorization({owner,executionHeight,ledgerNonce:'7',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,
    policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:chain,enableAt:'10',activeRevision:'1',
    records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:'11'.repeat(2592),pkB:'22'.repeat(64),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]},
    {owner,chainId:chain,nativeChainId:'6423'});
}
const selected = {account:merchant,networkId:chain};
const meta = id => ({...selected,operationId:id,createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()});
const stake = {chainId:chain,nativeChainId:'6423',owner:merchant,nonce:'8',fee:'0',kind:'stake',payload:{amount:'5'}};

test('real original caller cancellation fences late approval before any signer/Member entry, not just a UI flag', () => {
  const s = snapshot(), review = preparePQTypedActionReview(s,stake,meta('cancelled-original'));
  assert.equal(readPQTypedActionInvoiceReviewData(review),null);
  assert.deepEqual(cancelPQTypedActionReview(review),{operationId:review.operationId,signerEntered:false,dataOnly:true,canRetry:false});
  assert.throws(() => recheckPQTypedActionReview(review,s,selected,at),{code:'PQ_TYPED_ACTION_REVIEW_CANCELLED'});
  assert.throws(() => signPQReviewedTypedAction(review,s,{},selected,at),{code:'PQ_TYPED_ACTION_REVIEW_CANCELLED'});
  assert.equal(pqTypedActionInvocationData(review).signerEntered,false);
  assert.throws(() => cancelPQTypedActionReview({...review}),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
});

test('existing normal caller freezes exact canonical bytes and denies copied reviews or extra invoice authority DTOs', () => {
  const s = snapshot(), input = clone(stake), review = preparePQTypedActionReview(s,input,meta('immutable-original'));
  input.payload.amount = '100'; input.owner = payer;
  assert.equal(review.action.payload.amount,'5'); assert.equal(review.requestDigest,sha(encodePQNativeAction(stake)));
  assert.deepEqual(recheckPQTypedActionReview(review,s,selected,at).action,stake);
  for (const fn of [readPQTypedActionInvoiceReviewData,cancelPQTypedActionReview]) assert.throws(() => fn({...review}));
  assert.throws(() => preparePQTypedActionReview(s,stake,meta('no-pay-authority'),{termsMessage:new Uint8Array(),settlement:null}));
  assert.equal(pqTypedActionInvocationData(review).signerEntered,false);
});

test('sole SDK invoice capability is explicit; unsupported three kinds never create signable reviews', t => {
  const s = snapshot(), f = inputs(), candidates = [f.terms,f.settle,f.refund];
  for (const [i,a] of candidates.entries()) {
    a.chainId = chain; a.nativeChainId = '6423'; a.nonce = '8'; a.owner = merchant;
    if (a.kind === 'invoice_terms') {a.payload.keyEpoch = '1'; a.payload.expiresAt = '101';}
    let supported = false;
    try {const wire = encodePQNativeAction(a); assert.deepEqual(decodePQNativeAction(wire),a); supported = true;}
    catch (error) {assert.equal(error.code,'PQ_NATIVE_ACTION_INVALID');}
    if (!supported) {
      assert.throws(() => preparePQTypedActionReview(s,a,meta('unsupported-invoice-' + i)),{code:'PQ_NATIVE_ACTION_INVALID'});
      t.diagnostic(a.kind + ': SOLE_SDK_UNAVAILABLE; no live invoice-positive claim');
    } else if (a.kind === 'invoice_terms') {
      const review = preparePQTypedActionReview(s,a,meta('live-invoice-terms'));
      const display = readPQTypedActionInvoiceReviewData(review);
      assert.equal(display.kind,'invoice_terms'); assert.equal(display.operationId,review.operationId);
      assert.equal(display.requestDigest,review.requestDigest); assert.equal(display.broadcastRequiresSeparateApproval,true);
      assert.equal(recheckPQTypedActionReview(review,s,selected,at).action.kind,'invoice_terms');
      cancelPQTypedActionReview(review);
      assert.throws(() => signPQReviewedTypedAction(review,s,{},selected,at),{code:'PQ_TYPED_ACTION_REVIEW_CANCELLED'});
    } else {
      assert.throws(() => preparePQTypedActionReview(s,a,meta('missing-original-' + i)));
    }
  }
});

test('invoice port declarations keep raw units, immutable terms, original snapshot requirements and false authority', () => {
  const require = createRequire(import.meta.resolve('@ynx-chain/wallet-auth'));
  const compiler = require.resolve('typescript/bin/tsc');
  try {
    execFileSync(process.execPath,[compiler,'--noEmit','--strict','--skipLibCheck','--module','NodeNext',
      '--moduleResolution','NodeNext','--target','ES2022',fileURLToPath(new URL('./invoice-review-data.typecheck.mts',import.meta.url))],
      {stdio:'pipe',timeout:30000});
  } catch (error) {throw Error(Buffer.concat([error.stdout ?? Buffer.alloc(0),error.stderr ?? Buffer.alloc(0)]).toString('utf8'),{cause:error});}
});
