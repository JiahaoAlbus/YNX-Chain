import {types} from 'node:util';

// Display DATA only. This is deliberately not an invoice wire codec, policy
// source, consent object, settlement receipt or authority recognizer. The live
// caller obtains actions/digests exclusively through the original SDK codecs
// and checks a refund's retained settlement Member before calling this port.
export const PQ_INVOICE_ACTION_KINDS = Object.freeze(['invoice_terms','invoice_settle','invoice_refund']);
const fail = code => {throw Object.assign(Error(code), {code});};
const invalid = () => fail('PQ_INVOICE_REVIEW_DATA_INVALID');
const mismatch = () => fail('PQ_INVOICE_REVIEW_REFERENCE_MISMATCH');
const actionKeys = ['chainId','nativeChainId','owner','nonce','fee','kind','payload'];
const termsKeys = ['invoiceID','sessionID','recipient','payer','assetID','unitVersion','feeRule','keyEpoch','revision','amount','maxFee','expiresAt'];
const payloadKeys = {
  invoice_terms:termsKeys,
  invoice_settle:['merchant','invoiceID','termsHashHex','amount'],
  invoice_refund:['invoiceID','refundID','termsHashHex','settlementHashHex','amount'],
};
function data(value, fields) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
  if (keys.length !== fields.length || keys.some(k => !fields.includes(k) || !ds[k].enumerable || !Object.hasOwn(ds[k],'value'))) invalid();
  return Object.fromEntries(fields.map(k => [k,ds[k].value]));
}
function uint(value, max = (1n << 63n) - 1n) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > max) invalid();
  return value;
}
function address(value) {if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/.test(value)) invalid(); return value;}
function hash(value) {if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) invalid(); return value;}
function id(value) {if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value)) invalid(); return value;}
function actionData(value) {
  const a = data(value, actionKeys);
  if (!PQ_INVOICE_ACTION_KINDS.includes(a.kind) || typeof a.chainId !== 'string' || !/^[0-9a-f]{64}$/.test(a.chainId)) invalid();
  uint(a.nativeChainId, (1n << 64n) - 1n); address(a.owner); uint(a.nonce, (1n << 64n) - 1n);
  if (a.fee !== '1') invalid();
  const p = data(a.payload, payloadKeys[a.kind]); id(p.invoiceID); uint(p.amount);
  if (a.kind === 'invoice_terms') {
    id(p.sessionID); address(p.recipient); if (p.payer !== '') address(p.payer);
    if (p.assetID !== 'YNXT' || p.unitVersion !== '1' || p.feeRule !== 'native-transfer-fee-one/v1') invalid();
    for (const k of ['keyEpoch','revision','maxFee','expiresAt']) uint(p[k]);
  } else {
    hash(p.termsHashHex);
    if (a.kind === 'invoice_settle') address(p.merchant);
    else {id(p.refundID); hash(p.settlementHashHex);}
  }
  return Object.freeze({...a, payload:Object.freeze(p)});
}
const units = atoms => Object.freeze({atoms, assetID:'YNXT', unitVersion:'1', notation:'raw-atoms'});

/** Complete immutable display of all signed terms and action fields. Missing
 * original references fail closed; a Pay intent/HTTP DTO is never permission.
 * references are main-only DATA inputs, not an alternative approval API. */
export function projectPQInvoiceReviewData(input, references = null) {
  const a = actionData(input), p = a.payload;
  let terms, termsHash, settlement = null;
  if (a.kind === 'invoice_terms') {
    const r = data(references, ['termsDigest']);
    terms = a; termsHash = hash(r.termsDigest);
  } else {
    const r = data(references, ['terms','termsDigest','settlement']);
    terms = actionData(r.terms); termsHash = hash(r.termsDigest);
    if (terms.kind !== 'invoice_terms' || terms.chainId !== a.chainId || terms.nativeChainId !== a.nativeChainId ||
        terms.payload.invoiceID !== p.invoiceID || termsHash !== p.termsHashHex ||
        terms.owner !== (a.kind === 'invoice_settle' ? p.merchant : a.owner)) mismatch();
    if (a.kind === 'invoice_settle') {
      if (r.settlement !== null || p.amount !== terms.payload.amount ||
          terms.payload.payer !== '' && terms.payload.payer !== a.owner ||
          a.owner === terms.owner || a.owner === terms.payload.recipient || BigInt(a.fee) > BigInt(terms.payload.maxFee)) mismatch();
    } else {
      const s = data(r.settlement, ['action','memberHash']);
      settlement = actionData(s.action);
      if (typeof s.memberHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(s.memberHash) || s.memberHash !== '0x' + p.settlementHashHex ||
          settlement.kind !== 'invoice_settle' || settlement.chainId !== a.chainId || settlement.nativeChainId !== a.nativeChainId ||
          settlement.payload.merchant !== a.owner || settlement.payload.invoiceID !== p.invoiceID ||
          settlement.payload.termsHashHex !== termsHash || settlement.payload.amount !== terms.payload.amount ||
          terms.payload.payer !== '' && terms.payload.payer !== settlement.owner ||
          settlement.owner === terms.owner || settlement.owner === terms.payload.recipient ||
          BigInt(p.amount) > BigInt(settlement.payload.amount)) mismatch();
    }
  }
  const t = terms.payload, merchant = terms.owner;
  const payer = a.kind === 'invoice_terms' ? t.payer || null : a.kind === 'invoice_settle' ? a.owner : settlement.owner;
  const refund = a.kind === 'invoice_refund';
  return Object.freeze({version:'YNX-WALLET-INVOICE-REVIEW-DATA/v1',kind:a.kind,
    title:a.kind === 'invoice_terms' ? 'Register immutable merchant terms' : refund ? 'Refund the original payer' : 'Pay the original merchant invoice',
    networkId:a.chainId,nativeChainId:a.nativeChainId,owner:a.owner,nonce:a.nonce,
    merchant,payer,payerRule:a.kind === 'invoice_terms' && t.payer === '' ? 'independently-approved-payer' : refund ? 'original-settlement-payer' : 'exact-payer',
    recipient:refund ? payer : t.recipient,refundRecipientEditable:false,
    invoiceID:p.invoiceID,termsHash,terms:Object.freeze({...t}),
    actionPayload:p,amount:units(p.amount),fee:units(a.fee),
    principalMoves:a.kind !== 'invoice_terms',refundID:refund ? p.refundID : null,
    settlementNativeHash:refund ? '0x' + p.settlementHashHex : null,
    expiryRule:'execution-height-inclusive',purpose:'TX-BATCH',memberCount:1,memberIndex:0,
    currentLedgerChecksRequired:true,permissionGranted:false,dataOnly:true,
    nativeAdmission:false,submitted:false,consensusFinality:false,
    warning:refund ? 'Refund goes only to the original payer. The chain must check settlement, remaining refundable principal and refund-ID uniqueness. Signing and broadcast require separate Wallet approvals.' :
      'These are exact signing data, not payment or merchant authority. The chain must check registered terms, current merchant epoch and the single principal slot. Signing and broadcast require separate Wallet approvals.'});
}
