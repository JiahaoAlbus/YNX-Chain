import {types} from 'node:util';
const fail=()=>{throw Object.assign(Error('NATIVE_PAY_ARCHIVE_RECEIPT_BINDING'),{code:'NATIVE_PAY_ARCHIVE_RECEIPT_BINDING'});};
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const nativeHash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;
const common=['version','productId','storeId','sourceOrder','merchant','invoiceId','genesis','nativeChainId','principalAtoms','paidAtoms','refundedAtoms','netPaidAtoms','proofVerification','dataOnly','queryOnly','canRetry','SourceAdmission','nativeGrant'];
const receiptFields=[...common,'sessionId','nativeHash','abciHash','kind','status','archiveDigest','termsHash','settlementNativeHash','eventClaim','executionHeight'];
function data(value,fields,optional=[]){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.some(k=>typeof k!=='string'||!fields.includes(k)||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value'))||fields.some(k=>!optional.includes(k)&&!Object.hasOwn(descriptors,k)))fail();
 return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
}
function bound(value,original,ref){
 for(const key of ['productId','sourceOrder','merchant','genesis','nativeChainId'])if(value[key]!==original[key])fail();
 if(value.storeId!==original.storeId||value.invoiceId!==ref.invoiceId||value.merchant!==ref.merchant||value.dataOnly!==true||value.queryOnly!==true||value.canRetry!==false||value.SourceAdmission!==false||value.nativeGrant!==false||value.proofVerification!=='original-independent-core-verifier')fail();
 for(const key of ['principalAtoms','paidAtoms','refundedAtoms','netPaidAtoms'])if(!uint(value[key]))fail();
 if(BigInt(value.paidAtoms)<BigInt(value.refundedAtoms)||BigInt(value.netPaidAtoms)!==BigInt(value.paidAtoms)-BigInt(value.refundedAtoms))fail();
}
function arrayData(value){
 if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail();
 const d=Object.getOwnPropertyDescriptors(value),size=d.length.value;
 if(size>1024||Reflect.ownKeys(d).length!==size+1)fail();const result=[];
 for(let i=0;i<size;i++){const field=d[String(i)];if(!field?.enumerable||!Object.hasOwn(field,'value'))fail();result.push(field.value);}
 return result;
}
// Schema/binding checks on the original qualified Go reader's compact public
// DATA. No JS signature codec, trust anchor, receipt verifier or grant is added.
export function nativeArchiveReceiptData(value,original,ref){
 const out=data(value,receiptFields,['storeId','settlementNativeHash','eventClaim']);bound(out,original,ref);
 if(out.version!=='ynx.pay.native.archive-receipt/v1'||out.nativeHash!==ref.nativeHash||!nativeHash(out.nativeHash)||!nativeHash(out.abciHash)||!hash(out.archiveDigest)||!hash(out.termsHash)||!['invoice_settle','invoice_refund'].includes(out.kind)||!['confirmed','confirmed_failed'].includes(out.status)||!uint(out.executionHeight)||BigInt(out.executionHeight)===0n||typeof out.sessionId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(out.sessionId))fail();
 if(out.status==='confirmed'){
  if(!hash(out.eventClaim)||out.paidAtoms!==original.amountAtoms)fail();
  if(out.kind==='invoice_settle'&&(out.principalAtoms!==original.amountAtoms||out.refundedAtoms!=='0'))fail();
  if(out.kind==='invoice_refund'&&(!nativeHash(out.settlementNativeHash)||BigInt(out.principalAtoms)>BigInt(out.paidAtoms)))fail();
 }else if(['principalAtoms','paidAtoms','refundedAtoms','netPaidAtoms'].some(k=>out[k]!=='0')||out.eventClaim!==undefined)fail();
 return Object.freeze(out);
}
export function nativeArchiveReconciliationData(value,original,ref){
 const out=data(value,[...common,'receipts','pendingOriginals','completeKnownOriginals'],['storeId']);bound(out,original,ref);
 if(out.version!=='ynx.pay.native.archive-reconciliation/v1'||out.principalAtoms!==original.amountAtoms)fail();
 const receipts=arrayData(out.receipts).map(row=>{const safe=data(row,receiptFields,['storeId','settlementNativeHash','eventClaim']);return nativeArchiveReceiptData(safe,original,{...ref,nativeHash:safe.nativeHash});}),pending=arrayData(out.pendingOriginals);
 if(new Set(receipts.map(row=>row.nativeHash)).size!==receipts.length||pending.some(value=>!nativeHash(value))||new Set(pending).size!==pending.length||out.completeKnownOriginals!==(pending.length===0))fail();
 return Object.freeze({...out,receipts:Object.freeze(receipts),pendingOriginals:Object.freeze(pending)});
}
