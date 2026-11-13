import {types} from 'node:util';
const fail=()=>{throw Object.assign(Error('NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID'),{code:'NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID'});};
const fields=['productId','sourceOrder','merchant','recipient','genesis','nativeChainId','assetId','unitVersion','amountAtoms','domainData'];
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;
const positiveUint=value=>value!=='0'&&uint(value);
function descriptors(value,domain=false){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype&&!(domain&&Object.getPrototypeOf(value)===null))fail();
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail();
 return d;
}
// A detached bounded copy of original product DATA, never a Source brand or
// approval. Reading this object cannot execute getters/toJSON/proxy traps.
export function nativeInvoiceProductIntentData(value){
 const d=descriptors(value),keys=Object.keys(d);
 if(fields.some(k=>!Object.hasOwn(d,k))||keys.some(k=>!fields.includes(k)&&k!=='storeId'))fail();
 const out={};for(const k of keys)if(k!=='domainData'){if(typeof d[k].value!=='string')fail();out[k]=d[k].value;}
 const id=v=>/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v??'');
 if(!id(out.productId)||!id(out.sourceOrder)||out.storeId!==undefined&&!id(out.storeId)||
  !/^0x[0-9a-f]{40}$/.test(out.merchant)||!/^0x[0-9a-f]{40}$/.test(out.recipient)||
  !/^[0-9a-f]{64}$/.test(out.genesis)||!positiveUint(out.nativeChainId)||!positiveUint(out.amountAtoms)||out.assetId!=='YNXT'||out.unitVersion!=='1')fail();
 let nodes=0;const seen=new Set();
 function copy(v,depth=0){
  if(++nodes>4096||depth>16)fail();
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))fail();return v;}
  if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();
  seen.add(v);let result;
  if(Array.isArray(v)){
   const d=Object.getOwnPropertyDescriptors(v),n=d.length.value;
   if(Reflect.ownKeys(d).length!==n+1)fail();result=[];
   for(let i=0;i<n;i++){const p=d[String(i)];if(!p||!Object.hasOwn(p,'value')||!p.enumerable)fail();result.push(copy(p.value,depth+1));}
  }else{const d=descriptors(v,true);result=Object.create(null);for(const k of Object.keys(d))result[k]=copy(d[k].value,depth+1);}
  seen.delete(v);return Object.freeze(result);
 }
 descriptors(d.domainData.value,true);out.domainData=copy(d.domainData.value);
 if(Buffer.byteLength(JSON.stringify(out.domainData))>64*1024)fail();
 // Fixed top-level order also keeps original create and lookup bodies equal.
 return Object.freeze(Object.fromEntries(['productId','storeId',...fields.slice(1)].filter(k=>out[k]!==undefined).map(k=>[k,out[k]])));
}

export function assertNativeInvoiceIntentView(value,original){
 const request=nativeInvoiceProductIntentData(original),saved=nativeInvoiceProductIntentData(value?.request);
 if(JSON.stringify(saved)!==JSON.stringify(request)||!/^npi_[0-9a-f]{48}$/.test(value?.intentId??'')||value.originalOperation!==value.intentId||
  value.merchant!==request.merchant||!['PREPARED','ISSUED'].includes(value.state)||typeof value.phase!=='string'||!value.phase||value.phase.length>96||
  value.terms?.recipient!==request.recipient||value.terms.amountAtoms!==request.amountAtoms||value.terms.assetId!==request.assetId||value.terms.unitVersion!==request.unitVersion)fail();
 return value;
}

// Detached selector DATA for one original order continuation. This does not
// grant Source, choose terms, or verify a receipt. The original service and
// Main still own those decisions; every later read is checked against this
// exact captured request, not a renderer-supplied merchant/invoice pair.
export function nativeInvoiceOrderBindingDATA(value,original){
 const request=nativeInvoiceProductIntentData(original),d=descriptors(value),get=k=>d[k]?.value;
 const saved=nativeInvoiceProductIntentData(get('request'));
 const td=descriptors(get('terms')),keys=['invoiceId','sessionId','recipient','payer','assetId','unitVersion','feeRule','keyEpoch','revision','amountAtoms','maxFeeAtoms','expiresAtHeight'];
 if(Reflect.ownKeys(td).length!==keys.length||keys.some(k=>typeof td[k]?.value!=='string'))fail();
 const terms=Object.freeze(Object.fromEntries(keys.map(k=>[k,td[k].value]))),id=v=>/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(v),hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
 const termsNativeHash=get('termsNativeHash')??'',termsAbciHash=get('termsAbciHash')??'';
 if(JSON.stringify(saved)!==JSON.stringify(request)||request.productId!=='shop.order'||!request.storeId||
  !/^npi_[0-9a-f]{48}$/.test(get('intentId')??'')||get('originalOperation')!==get('intentId')||get('merchant')!==request.merchant||
  !['PREPARED','ISSUED'].includes(get('state'))||typeof get('phase')!=='string'||!/^[a-z_]{1,96}$/.test(get('phase'))||
  typeof get('signingMessageHash')!=='string'||!/^[0-9a-f]{64}$/.test(get('signingMessageHash'))||
  !id(terms.invoiceId)||!id(terms.sessionId)||terms.recipient!==request.recipient||
  terms.payer!==''&&!/^0x[0-9a-f]{40}$/.test(terms.payer)||terms.assetId!==request.assetId||terms.unitVersion!==request.unitVersion||terms.amountAtoms!==request.amountAtoms||
  terms.feeRule!=='native-transfer-fee-one/v1'||terms.maxFeeAtoms!=='1'||!['keyEpoch','revision','expiresAtHeight'].every(k=>positiveUint(terms[k]))||
  !(termsNativeHash===''&&termsAbciHash===''||hash(termsNativeHash)&&hash(termsAbciHash))||
  get('state')==='ISSUED'&&!hash(termsNativeHash))fail();
 return Object.freeze({original:request,intentId:get('intentId'),originalOperation:get('originalOperation'),merchant:request.merchant,
  state:get('state'),phase:get('phase'),signingMessageHash:get('signingMessageHash'),termsNativeHash,termsAbciHash,terms});
}
export function assertNativeInvoiceOrderIntentDATA(value,expected){
 const observed=nativeInvoiceOrderBindingDATA(value,expected.original);
 if(['intentId','merchant','state','phase','signingMessageHash','termsNativeHash','termsAbciHash'].some(k=>observed[k]!==expected[k])||JSON.stringify(observed.terms)!==JSON.stringify(expected.terms))
  throw Object.assign(Error('NATIVE_PAY_ORIGINAL_ORDER_BINDING'),{code:'NATIVE_PAY_ORIGINAL_ORDER_BINDING'});
 return value;
}
export function assertNativeInvoiceOrderBillDATA(value,expected,allowPendingTerms=false){
 const d=descriptors(value),original=expected.original,terms=expected.terms;
 const selected={merchant:original.merchant,invoiceId:terms.invoiceId,sessionId:terms.sessionId,sourceOrder:original.sourceOrder,
  genesis:original.genesis,nativeChainId:original.nativeChainId,assetId:original.assetId,unitVersion:original.unitVersion,
  principalAtoms:original.amountAtoms,feeRule:terms.feeRule,maxFeeAtoms:terms.maxFeeAtoms,expiresAtHeight:terms.expiresAtHeight,termsNativeHash:expected.termsNativeHash,termsHash:expected.signingMessageHash};
 const pending=allowPendingTerms&&expected.state==='PREPARED'&&/^0x[0-9a-f]{64}$/.test(expected.termsNativeHash);
 const invalid=()=>Object.assign(Error('NATIVE_PAY_ORIGINAL_ORDER_BINDING'),{code:'NATIVE_PAY_ORIGINAL_ORDER_BINDING'});
 if(expected.state!=='ISSUED'&&!pending||Object.entries(selected).some(([key,v])=>d[key]?.value!==v))throw invalid();
 const paid=d.paidAtoms?.value,refunded=d.refundedAtoms?.value,net=d.netPaidAtoms?.value;
 if(!uint(paid)||!uint(refunded)||!uint(net)||BigInt(refunded)>BigInt(paid)||BigInt(net)!==BigInt(paid)-BigInt(refunded))throw invalid();
 const committed=d.status?.value==='committed_paid';
 const knownRefundStatus=refunded==='0'?'none':refunded===paid?'refunded':'partial_refund';
 if(paid!==(committed?original.amountAtoms:'0')||pending&&committed||
  d.refundStatus?.value!=='unknown'&&d.refundStatus?.value!==knownRefundStatus)throw invalid();
 return value;
}
// The retained original operation, never an ABCI hash retargeted as a native
// hash. No Member is decoded/replaced and no approval is constructed here.
export function nativeInvoiceOrderOperationDATA(value,expected,nativeHash){
 assertNativeInvoiceOrderBillDATA(value,expected,true);
 const d=descriptors(value),operations=descriptors(d.operations?.value),saved=operations[nativeHash]?.value;
 if(!saved)throw Object.assign(Error('NATIVE_PAY_ORIGINAL_HASH_REQUIRED'),{code:'NATIVE_PAY_ORIGINAL_HASH_REQUIRED'});
 const op=descriptors(saved),keys=['merchant','invoiceId','nativeHash','abciHash','kind','owner','status'];
 const out=Object.fromEntries(keys.map(k=>[k,op[k]?.value]));
 if(out.nativeHash!==nativeHash||out.merchant!==expected.merchant||out.invoiceId!==expected.terms.invoiceId||
  !/^0x[0-9a-f]{64}$/.test(out.abciHash??'')||!['invoice_terms','invoice_settle','invoice_refund'].includes(out.kind)||
  !['unknown','submitted','confirmed','confirmed_failed'].includes(out.status)||!/^0x[0-9a-f]{40}$/.test(out.owner??'')||
  out.kind==='invoice_terms'&&(nativeHash!==expected.termsNativeHash||out.owner!==expected.merchant||out.abciHash!==expected.termsAbciHash)||
  out.kind==='invoice_refund'&&out.owner!==expected.merchant||
  out.kind==='invoice_settle'&&(out.owner===expected.merchant||expected.terms.payer!==''&&out.owner!==expected.terms.payer)||
  out.kind!=='invoice_terms'&&expected.state!=='ISSUED')
  throw Object.assign(Error('NATIVE_PAY_ORIGINAL_OPERATION_CHANGED'),{code:'NATIVE_PAY_ORIGINAL_OPERATION_CHANGED'});
 return Object.freeze(out);
}
export function assertNativeInvoiceOriginalOperationDATA(value,original){
 const d=descriptors(value);
 if(['merchant','invoiceId','nativeHash','abciHash','kind','owner'].some(k=>d[k]?.value!==original[k])||
  !['unknown','submitted','confirmed','confirmed_failed'].includes(d.status?.value)||
  ['confirmed','confirmed_failed'].includes(original.status)&&d.status?.value!==original.status)
  throw Object.assign(Error('NATIVE_PAY_ORIGINAL_OPERATION_CHANGED'),{code:'NATIVE_PAY_ORIGINAL_OPERATION_CHANGED'});
 return value;
}
