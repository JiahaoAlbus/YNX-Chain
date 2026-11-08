import {decodeBase64url} from './base64url.js';
import {decodeProductSessionProofHeaderV4,encodeProductSessionProofHeaderV4,PRODUCT_SESSION_PROOF_HEADER_V4} from './product-session-proof-v4.js';
import {types} from 'node:util';
import {readOriginalProductWalletBusinessReadHolder} from './product-wallet-connection-holder-private.js';
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
  async createBusinessProof(input){current();try{const result=await child.createBusinessProof(input);current();return result;}catch(error){child.retainFirstCause(error);throw error;}},
  release(){if(!released){released=true;child.release();}},
  statusDATA(){return Object.freeze({released,readOnly:true,NativeAdmission:false,SourceAdmission:false});}
 });
 heldLoans.set(loan,Object.freeze({origin,current,child,loan,getState:{selected:false,path:undefined,flight:null}}));
 return loan;
}

/** Fixed private GET operation. The original Native caller must first bind its
 * SAME Source/order to this loan; no request scopes, method, body or TTL input.
 * The existing read child alone constructs and verifies the V4 proof. */
export function createOriginalRegisteredClientGETProof(loan,originalPath){
 const held=heldLoans.get(loan);if(!held)return Promise.reject(new Error('ORIGINAL_REGISTERED_READ_LOAN_REQUIRED'));
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
 const original=await loan.createBusinessProof(Object.freeze({method:'GET',path:originalPath,body:'',requiredScopes:Object.freeze(scopes)}));
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
