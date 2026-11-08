import {inspectOriginalWalletProductScopeShapeV1DATA} from '../native/original-wallet-product-source-contract.mjs';
import {evmAddressFromYNX} from './crypto.js';
import {pqHexBytes} from './pq-public-bytes.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {decodeBase64url} from './base64url.js';
import {decodeProductSessionProofHeaderV4,encodeProductSessionProofHeaderV4,PRODUCT_SESSION_PROOF_HEADER_V4} from './product-session-proof-v4.js';
import {types} from 'node:util';
import {readOriginalProductWalletBusinessReadHolder,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN} from './product-wallet-connection-holder-private.js';
import {readOriginalProductSessionDeviceV4ReadOrigin} from './original-product-device-v4-source-stage-private.js';
const heldLoans=new WeakMap();
/** Node-only private composition. No install/setter, session DTO, signing callback
 * or Source creation. Both inventories must originate in their normal factories.
 * This loan holds only the existing GET child; Native keeps its strong owner.
 * assertCurrent is a freshness fence, never registered-session authorization. */
export function captureOriginalRegisteredClientReadHolder(read){
 if(arguments.length!==1)throw new Error('ORIGINAL_READ_CAPTURE_COMPARISON_NOT_SUPPLIED');
 const client=readOriginalProductWalletBusinessReadHolder(read);
 const origin=readOriginalProductSessionDeviceV4ReadOrigin(client.device,client.deviceCurrent);
 client.assertCurrent();origin.assertCurrent();
 const child=client.retain();let released=false;
 const current=()=>{if(released)throw new Error('ORIGINAL_SHOP_READ_HOLDER_RELEASED');child.assertCurrent();origin.assertCurrent();child.assertCurrent();};
 try{current();}catch(error){child.release();throw error;}
 const loan=Object.freeze({
  assertCurrent:current,
  // Fixed lexical getter for Auth's separately supplied strong matcher only.
  // No new Source is acquired and this reference must never be closed here.
  readOriginalNativeDeviceSource(){if(arguments.length)throw new Error('ORIGINAL_NATIVE_SOURCE_ZERO_ARGUMENTS');current();const original=origin.readNativeDeviceSource();current();return original;},
  async createBusinessProof(input){current();try{const result=await child.createBusinessProof(input);current();return result;}catch(error){child.retainFirstCause(error);throw error;}},
  release(){if(!released){released=true;child.release();}},
  statusDATA(){return Object.freeze({released,readOnly:true,NativeAdmission:false,SourceAdmission:false});}
 });
 heldLoans.set(loan,Object.freeze({origin,current,child,loan,productId:client.productId,productScope:null,getState:{selected:false,path:undefined,flight:null}}));
 return loan;
}

/** Fixed private GET operation. The original Native caller must first bind its
 * SAME Source/order to this loan; no request scopes, method, body or TTL input.
 * The existing read child alone constructs and verifies the V4 proof. */
export function createOriginalRegisteredClientGETProof(loan,originalPath){
 const held=heldLoans.get(loan);if(!held)return Promise.reject(new Error('ORIGINAL_REGISTERED_READ_LOAN_REQUIRED'));
 if(held.productScope){
  const prefix='/v5/shop/source/shop.order/invoice-intents/';
  if(typeof originalPath!=='string'||!originalPath.startsWith(prefix)||!held.productScope.products.some(p=>p.productId==='shop.order'&&prefix+p.sourceOrder===originalPath))return Promise.reject(new Error('PRODUCT_SOURCE_SHOP_ORDER_NOT_SELECTED'));
 }
 const state=held.getState;
 if(state.selected){if(state.path!==originalPath)return Promise.reject(new Error('ORIGINAL_GET_ORDER_PATH_CHANGED'));return state.flight;}
 state.selected=true;state.path=originalPath;
 // Install the only flight before any foreign current/context/proof method.
 state.flight=Promise.resolve().then(async()=>{
 held.current();
 const context=held.origin.readContext();
 if(types.isProxy(context)||!context||typeof context!=='object')throw new Error('ORIGINAL_REGISTERED_CONTEXT_REQUIRED');
 const field=Object.getOwnPropertyDescriptor(context,'scopes');
 if(!field||!Object.hasOwn(field,'value')||types.isProxy(field.value)||!Array.isArray(field.value))throw new Error('ORIGINAL_REGISTERED_SCOPES_REQUIRED');
 const descriptors=Object.getOwnPropertyDescriptors(field.value),scopes=[],length=descriptors.length?.value;
 // Same finite Native context bound as the existing original V4 consumer.
 if(!Number.isInteger(length)||length<1||length>8)throw new Error('ORIGINAL_REGISTERED_SCOPES_REQUIRED');
 for(let i=0;i<length;i++){
  const d=descriptors[String(i)];if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!d.value.length||d.value.length>64)throw new Error('ORIGINAL_REGISTERED_SCOPES_REQUIRED');scopes.push(d.value);
 }
 const original=await held.loan.createBusinessProof(Object.freeze({method:'GET',path:originalPath,body:'',requiredScopes:Object.freeze(scopes)}));
 try{
  held.current();
  if(!original||original.version!=='4'||original.proofHeaderName!==PRODUCT_SESSION_PROOF_HEADER_V4||original.body!==''||original.signatureVerified!==true)throw new Error('ORIGINAL_V4_GET_PROOF_REQUIRED');
  const decoded=decodeProductSessionProofHeaderV4(original.proofHeader);
  const {member,...unsigned}=decoded;
  if(encodeProductSessionProofHeaderV4(unsigned,decodeBase64url(member))!==original.proofHeader)throw new Error('ORIGINAL_V4_HEADER_NOT_CANONICAL');
  if(decoded.method!=='GET'||decoded.path!==originalPath)throw new Error('ORIGINAL_V4_GET_REQUEST_CHANGED');
  held.current();
  return Object.freeze({proofHeaderName:original.proofHeaderName,proofHeader:original.proofHeader,issuedAt:decoded.issuedAt,expiresAt:decoded.expiresAt,issuedAtMs:Date.parse(decoded.issuedAt),expiresAtMs:Date.parse(decoded.expiresAt)});
 }catch(error){held.child.retainFirstCause(error);throw error;}
 });
 return state.flight;
}

function sourceReferenceSnapshot(value){
 if(!value||typeof value!=='object'||types.isProxy(value))throw new Error('ORIGINAL_DEVICE_SOURCE_REFERENCE_DATA_INVALID');
 const keys=['purpose','sourceId','instanceId','generation','accountIssuer','accountSubject'];
 const d=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(d);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')))throw new Error('ORIGINAL_DEVICE_SOURCE_REFERENCE_DATA_INVALID');
 const result=Object.fromEntries(keys.map(k=>[k,d[k].value]));
 if(result.purpose!=='product-session-device-source-v4'||!Number.isSafeInteger(result.generation)||result.generation<1)throw new Error('ORIGINAL_DEVICE_SOURCE_REFERENCE_DATA_INVALID');
 for(const k of ['sourceId','instanceId','accountIssuer','accountSubject']){
  const s=result[k],cap=k==='sourceId'||k==='instanceId'?512:2048;
  if(typeof s!=='string'||!s.isWellFormed()||s.includes('\0')||!s.length||new TextEncoder().encode(s).length>cap)throw new Error('ORIGINAL_DEVICE_SOURCE_REFERENCE_DATA_INVALID');
 }
 return Object.freeze(result);
}
/** Readonly namespace DATA from the exact Native Source already held by the
 * original device/current pair. This does NOT prove ProductSource or engine
 * association. Missing optional capability does not retire the existing read. */
export function readOriginalRegisteredClientSourceReferenceDATA(loan){
 const held=heldLoans.get(loan);if(!held)throw new Error('ORIGINAL_REGISTERED_READ_LOAN_REQUIRED');
 held.current();const original=sourceReferenceSnapshot(held.origin.readSourceReferenceDATA());held.current();
 const repeated=sourceReferenceSnapshot(held.origin.readSourceReferenceDATA());
 for(const k of Object.keys(original))if(repeated[k]!==original[k])throw new Error('ORIGINAL_DEVICE_SOURCE_REFERENCE_CHANGED');
 held.current();return original;
}

function originalDeviceIdentityDATA(held){
 const value=held.origin.readContext();
 if(!value||typeof value!=='object'||types.isProxy(value))throw new Error('ORIGINAL_DEVICE_IDENTITY_DATA_REQUIRED');
 const d=Object.getOwnPropertyDescriptors(value);
 for(const key of ['account','networkId'])if(!d[key]||!Object.hasOwn(d[key],'value'))throw new Error('ORIGINAL_DEVICE_IDENTITY_DATA_REQUIRED');
 const account=d.account.value,canonicalOwner=evmAddressFromYNX(account),networkId=bytesToHex(pqHexBytes(d.networkId.value,32));
 return Object.freeze({account,canonicalOwner,networkId});
}
/** Private comparison against the true-borrow ProductScopeDATA copied by Auth.
 * DATA matching does not certify identity equality of ProductParent and DEVICE. Auth
 * separately holds its recognized true ProductBorrow/current and MUST execute
 * the actual ProductCurrent / recognized DEVICE env+actor+current matcher before enabling a Native slot. */
export function captureOriginalRegisteredClientReadHolderForProductSource(read,scopeDATA){
 if(arguments.length!==2)throw new Error('ORIGINAL_PRODUCT_SCOPE_ARGUMENTS');
 const loan=captureOriginalRegisteredClientReadHolder(read),held=heldLoans.get(loan);
 try{
  held.current();
  const identity=originalDeviceIdentityDATA(held);
  const {scope}=inspectOriginalWalletProductScopeShapeV1DATA(scopeDATA,identity.networkId,identity.canonicalOwner);
  if(held.productId!=='shop'||!scope.operations.includes('readOriginalInvoiceIntent')||!scope.products.some(p=>p.productId==='shop.order'))throw new Error('PRODUCT_SOURCE_SHOP_READ_NOT_SELECTED');
  const reference=readOriginalRegisteredClientSourceReferenceDATA(loan);
  if(reference.accountSubject!==identity.account||reference.accountIssuer!==PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN)throw new Error('ORIGINAL_DEVICE_NAMESPACE_ACCOUNT_MISMATCH');
  held.current();
  const latest=originalDeviceIdentityDATA(held);
  if(latest.account!==identity.account||latest.networkId!==identity.networkId)throw new Error('ORIGINAL_DEVICE_IDENTITY_DATA_CHANGED');
  const scoped=Object.freeze({
   assertCurrent:loan.assertCurrent,
   readOriginalNativeDeviceSource:loan.readOriginalNativeDeviceSource,
   release:loan.release,
   statusDATA:loan.statusDATA,
  });
  // No generic createBusinessProof on the product-scoped surface. The fixed
  // module creator alone reaches the existing original child through this map.
  heldLoans.set(scoped,Object.freeze({...held,productScope:scope}));
  return scoped;
 }catch(error){loan.release();throw error;}
}
