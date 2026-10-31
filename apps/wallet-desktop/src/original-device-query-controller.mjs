// Main-only read of an original application's selected device. It never
// creates keys, approves the account, registers, signs or submits anything.
import * as fixedImage from '../../../packages/wallet-auth/src/original-auth-identity-fixed-native-image.js';
import {canonicalJSON,parseProductSessionRequest,ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {createOriginalDeviceIdentityDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';
import {productPlatformBinding} from '../../../packages/wallet-auth/src/product-session-registry.js';
import {PRODUCT_SESSION_REGISTRY} from './wallet-auth-contract.mjs';
import {captureOriginalDeviceQuerySelectionDATA} from './original-policy-supplier/device-query-selection.mjs';
import {types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
const partial=e=>Object.getOwnPropertyDescriptor(Object(e),'partial')?.value;
const safeCode=e=>{const c=Object.getOwnPropertyDescriptor(Object(e),'code')?.value;return typeof c==='string'&&/^[A-Z0-9_]{1,96}$/.test(c)?c:'DEVICE_QUERY_ORIGINAL_FAILURE';};
const fields=['operation','state','authority','hasPublicPair','unknownMarkerObserved','localTerminalObserved','registeredCurrentObserved','creatorOutcomeObserved'];
function projection(value){
 if(!value||types.isProxy(value)||!Object.isFrozen(value))fail('DEVICE_QUERY_ORIGINAL_OUTCOME_REQUIRED');
 const ds=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(ds).some(k=>!fields.includes(k)&&!['publicPairDATA','creatorOutcomeDATA'].includes(k))||fields.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value'))||Object.values(ds).some(d=>!Object.hasOwn(d,'value')))fail('DEVICE_QUERY_ORIGINAL_OUTCOME_REQUIRED');
 if(!['ABSENT','UNKNOWN','PENDING_LOCAL_PUBLIC','REGISTERED_LOCAL_PUBLIC'].includes(value.state)||value.authority!==false||typeof value.operation!=='string'||fields.slice(3).some(k=>typeof value[k]!=='boolean'))fail('DEVICE_QUERY_ORIGINAL_OUTCOME_REQUIRED');
 return Object.freeze(Object.fromEntries(fields.map(k=>[k,value[k]])));
}
export function createOriginalDeviceQueryController({vault,networkId}){
 let active=null,closed=false;
 const remember=(r,e)=>{if(!r.firstPresent){r.firstPresent=true;r.first=e;}};
 function retire(r){
  r.retired=true;
  // Do not re-read a retired Native child or translate any failure to ABSENT.
  for(const name of ['child','source'])if(r[name]&&!r.cleanup[name].retired){r.cleanup[name].retired=true;try{r[name].retire();}catch(e){r.cleanup[name].failed=true;remember(r,e);}}
  r.peer?.retire();
 }
 async function drain(r){
  retire(r);let childClosed=!r.child;
  for(const name of ['child','source']){
   if(name==='source'&&!childClosed)break;
   const owner=r[name],c=r.cleanup[name];if(!owner)continue;if(c.failed)break;
   try{if(!c.joined){c.joined=true;await owner.join();}if(!c.closeSelected){c.closeSelected=true;await owner.close();c.closed=true;}if(name==='child')childClosed=c.closed;}
   catch(e){c.failed=true;remember(r,e);break;}
  }
  r.cleanupDebt=Boolean(r.child&&!r.cleanup.child.closed||r.source&&!r.cleanup.source.closed);
  if(!r.cleanupDebt){r.unsubscribe?.();r.peer?.close();r.selected?.close();}
  if(r.cleanupDebt)fail('DEVICE_QUERY_ORIGINAL_CLEANUP_UNRESOLVED');
 }
 function current(r){
  if(closed||r.retired)fail('DEVICE_QUERY_RETIRED');vault.authorization.current().assert();
  const s=vault.authorization.status();if(s.account!==r.security.account||s.revision!==r.security.revision)fail('DEVICE_QUERY_SELECTED_SESSION_CHANGED');
  r.selected?.assertCurrent();r.source?.assertCurrent();r.child?.assertCurrent();
 }
 const status=()=>Object.freeze({account:active?.security.account??null,phase:active?.phase??'idle',retired:active?.retired??false,originalOutcomeRetained:active?.rawRetained??false,outcome:active?.view??null,cleanupUnresolved:active?.cleanupDebt??false,authority:false,creationInvoked:false,...(active?.firstPresent?{firstCauseCode:safeCode(active.first)}:{})});
 async function queryOriginal(originalRequest){
  if(arguments.length!==1)fail('DEVICE_QUERY_ORIGINAL_REQUEST_REQUIRED');
  if(closed)fail('DEVICE_QUERY_RETIRED');if(active?.inFlight||active?.cleanupDebt)fail('DEVICE_QUERY_ORIGINAL_UNRESOLVED');
  const request=parseProductSessionRequest(PRODUCT_SESSION_REGISTRY,originalRequest,new Date());if(request.version!=='4')fail('DEVICE_QUERY_ORIGINAL_V4_REQUEST_REQUIRED');
  vault.authorization.current().assert();const r={security:vault.authorization.status(),phase:'querying',cleanup:{child:{},source:{}},cleanupDebt:false};active=r;
  r.unsubscribe=vault.authorization.subscribe(s=>{if(s.locked||s.account!==r.security.account||s.revision!==r.security.revision)retire(r);});
  const task=(async()=>{try{
   r.selected=await vault.captureSelectedPQAccountPublic(networkId);current(r);
   const selected=r.selected.readPublic(),binding=productPlatformBinding(PRODUCT_SESSION_REGISTRY,request.productId,request.platform),app=Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'].map(k=>[k,binding[k]]));
   for(const [k,v]of Object.entries(app))if(request[k]!==v)fail('DEVICE_QUERY_ORIGINAL_APPLICATION_CHANGED');
   const expected=createOriginalDeviceIdentityDATA({networkId,canonicalOwner:selected.account,account:ynxAddressFromEVM(selected.account),deviceId:request.deviceId,...app});
   // Account text comes from the protected lease, never the incoming app.
   if(typeof fixedImage.acquireOriginalProductSessionDeviceV4QuerySourceStage!=='function')fail('DEVICE_QUERY_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
   try{r.source=fixedImage.acquireOriginalProductSessionDeviceV4QuerySourceStage();}catch(e){r.source=partial(e);throw e;}current(r);
   const raw=Buffer.from(r.source.readQueryScopeOriginalDATA()),scope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
   const {version,domain,...stable}=expected.identity,identityBinding={...stable,...expected.applicationBinding};
   if(raw.length>16384||canonicalJSON(scope)!==raw.toString('utf8')||canonicalJSON(scope)!==canonicalJSON({version:'4',stableDeviceIdentity:expected.stableDeviceIdentity,identityBinding}))fail('DEVICE_QUERY_ORIGINAL_SELECTION_CHANGED');
   r.peer=captureOriginalDeviceQuerySelectionDATA(Buffer.from(expected.stableDeviceIdentity),app,r.selected);current(r);
   try{r.child=r.source.captureOriginalQuerySelection(r.peer);}catch(e){r.child=partial(e);throw e;}
   current(r);await r.child.recheck();current(r);
   // Retain the original before interpretation and any late lock/current check.
   r.raw=r.child.readOriginalOutcomeDATA();r.rawRetained=true;r.view=projection(r.raw);current(r);r.phase='original-result-retained';
  }catch(e){r.operationFailed=true;remember(r,e);r.phase=r.rawRetained?'original-result-retained-after-failure':'query-failed';throw e;}
  finally{try{await drain(r);}catch(e){remember(r,e);if(!r.operationFailed)throw e;}}})();r.inFlight=task;try{await task;return status();}finally{r.inFlight=null;}
 }
 async function close(){closed=true;if(!active)return;retire(active);if(active.inFlight)try{await active.inFlight;}catch{}await drain(active);}
 return Object.freeze({queryOriginal,readStatusDATA:status,close});
}
