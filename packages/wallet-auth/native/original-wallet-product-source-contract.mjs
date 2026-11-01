// Frozen Auth CODE contract DATA. Never Root, Native Source or permission.
import{types}from'node:util';import{canonical}from'./original-auth-identity-source-verifier.mjs';
export const WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE='wallet-native-product-source-v1';
export const WALLET_NATIVE_PRODUCT_SELECTION_KEY='walletNativeProductV1';
export const WALLET_NATIVE_PRODUCT_LEGACY_OPERATIONS=Object.freeze(['createInvoiceIntent','lookupInvoiceIntent','merchantTermsReview','readInvoiceIntent','readInvoice','readInvoiceEvents','reviewSettlement','reviewRefund','reconcileInvoiceIntent','reconcileOperation','readOriginalInvoiceIntent','readInvoiceOriginals']);
export const WALLET_NATIVE_PRODUCT_ARCHIVE_READ_OPERATIONS=Object.freeze(['readOriginalArchiveReceipt','readOriginalArchiveReconciliation']);
export const WALLET_NATIVE_PRODUCT_OPERATIONS=Object.freeze([...WALLET_NATIVE_PRODUCT_LEGACY_OPERATIONS,...WALLET_NATIVE_PRODUCT_ARCHIVE_READ_OPERATIONS]);
const fail=c=>{throw Object.assign(Error(c),{code:c});},E='WALLET_PRODUCT_SOURCE_DATA_INVALID';
function record(v,keys){if(!v||types.isProxy(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail(E);const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail(E);return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function list(v,max,empty){if(types.isProxy(v)||!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype)fail(E);const d=Object.getOwnPropertyDescriptors(v),n=d.length.value;if(n>max||!empty&&n===0||Reflect.ownKeys(d).length!==n+1)fail(E);const out=[];for(let i=0;i<n;i++){if(!d[i]||!Object.hasOwn(d[i],'value')||!d[i].enumerable)fail(E);out.push(d[i].value);}return out;}
const token=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),owner=v=>typeof v==='string'&&/^0x[a-f0-9]{40}$/.test(v);
export function inspectOriginalWalletProductScopeV1DATA(value,networkId,subjectOwner,issuedAtMs,expiresAtMs,atMs){
 if(!hex(networkId)||!owner(subjectOwner)||![issuedAtMs,expiresAtMs,atMs].every(Number.isSafeInteger)||issuedAtMs<0||expiresAtMs<=issuedAtMs||expiresAtMs-issuedAtMs>86400000||atMs<issuedAtMs||atMs>=expiresAtMs)fail(E);
 const s=record(value,['version','networkId','account','protectedResourceRef','operations','products']);
 if(s.version!==1||!hex(s.networkId)||!owner(s.account)||!token(s.protectedResourceRef))fail(E);
 if(s.networkId!==networkId||s.account!==subjectOwner)fail('WALLET_PRODUCT_SOURCE_IDENTITY');
 const ops=list(s.operations,14,false),seenOps=new Set();for(const op of ops){if(!WALLET_NATIVE_PRODUCT_OPERATIONS.includes(op)||seenOps.has(op))fail(E);seenOps.add(op);}
 const products=list(s.products,64,true),seen=new Set(),owned=[];for(const v of products){const ref=record(v,['productId','sourceOrder']);if(!['shop.order','cloud.ide-usage'].includes(ref.productId)||!token(ref.sourceOrder))fail(E);const key=ref.productId+'/'+ref.sourceOrder;if(seen.has(key))fail(E);seen.add(key);owned.push(Object.freeze(ref));}
 if((ops.includes('readOriginalInvoiceIntent')||ops.some(op=>WALLET_NATIVE_PRODUCT_ARCHIVE_READ_OPERATIONS.includes(op)))&&owned.length===0)fail('WALLET_PRODUCT_SOURCE_ORIGINAL_PRODUCTS_REQUIRED');
 const scope=Object.freeze({...s,operations:Object.freeze(ops),products:Object.freeze(owned)}),scopeOriginal=canonical(scope);
 return Object.freeze({scopeOriginal,scope,effectExpiresAtMs:expiresAtMs,dataOnly:true,authorized:false,SourceAdmission:false,NativeAdmission:false,registered:false,approval:false});
}

/** Only the two new archive ports use this fixed GET DATA projection. Old
 * preparation/create/review operations retain their existing independent rules.
 * The scope must originate in original verified SourceV2; this comparison grants nothing. */
export function inspectOriginalWalletProductArchiveReadV1DATA(value,operation,reference,networkId,subjectOwner,issuedAtMs,expiresAtMs,atMs){
 const inspected=inspectOriginalWalletProductScopeV1DATA(value,networkId,subjectOwner,issuedAtMs,expiresAtMs,atMs),s=inspected.scope;
 if(!WALLET_NATIVE_PRODUCT_ARCHIVE_READ_OPERATIONS.includes(operation)||!s.operations.includes(operation))fail('WALLET_PRODUCT_ARCHIVE_OPERATION_NOT_SELECTED');
 const receipt=operation==='readOriginalArchiveReceipt',ref=record(reference,receipt?['productId','sourceOrder','merchant','invoiceId','nativeHash']:['productId','sourceOrder','merchant','invoiceId']);
 if(!['shop.order','cloud.ide-usage'].includes(ref.productId)||!token(ref.sourceOrder)||!token(ref.invoiceId)||!owner(ref.merchant)||receipt&&(typeof ref.nativeHash!=='string'||!/^0x[a-f0-9]{64}$/.test(ref.nativeHash)))fail('WALLET_PRODUCT_ARCHIVE_REFERENCE');
 if(!s.products.some(p=>p.productId===ref.productId&&p.sourceOrder===ref.sourceOrder))fail('WALLET_PRODUCT_ARCHIVE_PRODUCT_NOT_SELECTED');
 const prefix='/v5/pay/products/'+encodeURIComponent(ref.productId)+'/'+encodeURIComponent(ref.sourceOrder)+'/invoices/'+ref.merchant+'/'+encodeURIComponent(ref.invoiceId);
 const requestPath=prefix+(receipt?'/originals/'+ref.nativeHash+'/receipt':'/archive-reconciliation');
 return Object.freeze({operation,reference:Object.freeze(ref),method:'GET',requestPath,body:null,query:'',redirect:'error',dataOnly:true,authorized:false,SourceAdmission:false,NativeAdmission:false,registered:false,approval:false});
}
