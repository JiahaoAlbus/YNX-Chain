// Closed Browser SourceV2 selection DATA. Sole generic SourceV2 owns math,
// original release signature frames and admission. This never acquires Source.
import {types} from 'node:util';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
export const BROWSER_SELECTED_PAGES_SOURCE_PURPOSE='browser-selected-pages-source-v1';
export const BROWSER_SELECTED_PAGES_SOURCE_SELECTION_KEY='browserSelectedPagesV1';
export const BROWSER_SELECTED_PAGES_SOURCE_OPERATIONS=Object.freeze(['read-selected-pages']);
export const BROWSER_SELECTED_PAGES_APPLICATION_ID='com.ynxweb4.browser.macos';
const E='BROWSER_SELECTED_PAGES_SOURCE_DATA_INVALID';
const fail=(code=E)=>{throw Object.assign(Error(code),{code});};
function exact(v,fields){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();}
function list(v,max){if(types.isProxy(v)||!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length<1||v.length>max)fail();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==v.length+1)fail();for(let i=0;i<v.length;i++)if(!d[i]||!d[i].enumerable||!Object.hasOwn(d[i],'value'))fail();return v;}
function text(v,max=512,empty=false){if(typeof v!=='string'||!v.isWellFormed()||(!empty&&!v)||Buffer.byteLength(v)>max||/[\x00-\x1f\x7f]/.test(v))fail();}
function hex(v,n=64){if(typeof v!=='string'||!new RegExp('^[a-f0-9]{'+n+'}$').test(v))fail();}
function u64(v){if(typeof v!=='string'||!/^[1-9][0-9]{0,19}$/.test(v)||BigInt(v)>18446744073709551615n)fail();}
function owner(v){if(typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v))fail();}
const flags=()=>({dataOnly:true,authorized:false,SourceAdmission:false,NativeAdmission:false,registered:false,approval:false,signatureVerified:false});
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function session(v){exact(v,['id','account','deviceId','productClientId','bundleId','sessionBinding']);text(v.id);owner(v.account);text(v.deviceId);for(const k of ['productClientId','bundleId','sessionBinding'])text(v[k],512,true);}
function request(v,subjectOwner){
 exact(v,['originalRequestSHA256','preparationID','profileID','runId','session','task','references','queryOriginal','authorizationRef']);hex(v.originalRequestSHA256);text(v.preparationID);text(v.profileID);if(typeof v.runId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v.runId))fail();session(v.session);
 exact(v.task,['id','account','holder','revision','generation']);text(v.task.id);owner(v.task.account);text(v.task.holder);u64(v.task.revision);u64(v.task.generation);
 if(v.session.account!==subjectOwner||v.task.account!==subjectOwner||v.session.deviceId!==v.task.holder)fail('BROWSER_SELECTED_PAGES_SOURCE_TASK_IDENTITY');
 list(v.references,16);const ids=new Set();for(const r of v.references){exact(r,['selectionId','version']);if(typeof r.selectionId!=='string'||!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(r.selectionId)||ids.has(r.selectionId))fail('BROWSER_SELECTED_PAGES_SOURCE_REFERENCE');hex(r.version,128);ids.add(r.selectionId);}
 if(typeof v.queryOriginal!=='boolean')fail();text(v.authorizationRef,256,true);if(!v.queryOriginal&&!v.authorizationRef)fail('BROWSER_SELECTED_PAGES_SOURCE_AUTHORIZATION_REF');
}
function peer(v){exact(v,['pid','uid','applicationId','codeDirectoryHash']);if(!Number.isSafeInteger(v.pid)||v.pid<=1||v.pid>2147483647||!Number.isSafeInteger(v.uid)||v.uid<0||v.uid>4294967295||v.applicationId!==BROWSER_SELECTED_PAGES_APPLICATION_ID||typeof v.codeDirectoryHash!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(v.codeDirectoryHash))fail('BROWSER_SELECTED_PAGES_SOURCE_OS_PEER');}
export function inspectOriginalBrowserSelectedPagesScopeV1DATA(value,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs){
 hex(networkId);owner(subjectOwner);text(sourceId,128);text(instanceId,128);
 if(![issuedAtMs,expiresAtMs,atMs].every(Number.isSafeInteger)||issuedAtMs<0||expiresAtMs<=issuedAtMs||expiresAtMs-issuedAtMs>86400000||atMs<issuedAtMs||atMs>=expiresAtMs)fail('BROWSER_SELECTED_PAGES_SOURCE_WINDOW');
 exact(association,['account','clientId','productId','platform','applicationId','deviceId']);for(const k of Object.keys(association))text(association[k]);if(association.account!==subjectOwner||association.productId!=='browser'||association.platform!=='macos'||association.applicationId!==BROWSER_SELECTED_PAGES_APPLICATION_ID)fail('BROWSER_SELECTED_PAGES_SOURCE_APPLICATION');
 exact(value,['version','protectedResourceRef','nativeIdentity','operations','currentSelector','peer','request','untilMs']);if(value.version!==1)fail();if(typeof value.protectedResourceRef!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.protectedResourceRef))fail('BROWSER_SELECTED_PAGES_SOURCE_RESOURCE');
 exact(value.nativeIdentity,['networkId','productId','platform','applicationId']);if(value.nativeIdentity.networkId!==networkId||value.nativeIdentity.productId!=='browser'||value.nativeIdentity.platform!=='macos'||value.nativeIdentity.applicationId!==BROWSER_SELECTED_PAGES_APPLICATION_ID)fail('BROWSER_SELECTED_PAGES_SOURCE_APPLICATION');
 list(value.operations,1);if(value.operations[0]!==BROWSER_SELECTED_PAGES_SOURCE_OPERATIONS[0])fail('BROWSER_SELECTED_PAGES_SOURCE_OPERATION');
 exact(value.currentSelector,['sourceId','instanceId','epoch']);if(value.currentSelector.sourceId!==sourceId||value.currentSelector.instanceId!==instanceId)fail('BROWSER_SELECTED_PAGES_SOURCE_SELECTOR');u64(value.currentSelector.epoch);peer(value.peer);request(value.request,subjectOwner);
 if(!Number.isSafeInteger(value.untilMs)||value.untilMs<=atMs||value.untilMs>expiresAtMs)fail('BROWSER_SELECTED_PAGES_SOURCE_WINDOW');const scopeOriginal=canonical(value);if(Buffer.byteLength(scopeOriginal)>49152)fail('BROWSER_SELECTED_PAGES_SOURCE_LIMIT');
 return Object.freeze({scopeOriginal,scope:freeze(JSON.parse(scopeOriginal)),effectExpiresAtMs:value.untilMs,...flags()});
}
// scope.peer / actualBrowserPeer are the remote Browser target only. P05
// separately authenticates its genuine consumer OriginalCaller; no one peer
// operand serves both ends. Same code hash on a new endpoint is not incarnation.
// NSXPC is same-host only; no portable endpoint or remote LINK bridge is created.
// Inputs below must be independently held originals from Auth/Core/P05, never
// Expected copied out of received JSON. DATA comparisons cannot enforce custody.
export function inspectOriginalBrowserSelectedPagesBorrowV1DATA(value,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs,originalRequest,expected,actualBrowserPeer,currentSelector){
 if(!originalRequest||types.isProxy(originalRequest)||!types.isUint8Array(originalRequest)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(originalRequest)))fail('BROWSER_SELECTED_PAGES_SOURCE_REQUEST_BYTES');
 const own=Object.getOwnPropertyDescriptors(originalRequest);if(Reflect.ownKeys(own).some(k=>typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||!Object.hasOwn(own[k],'value')))fail('BROWSER_SELECTED_PAGES_SOURCE_REQUEST_BYTES');
 if(types.isSharedArrayBuffer(originalRequest.buffer)||originalRequest.byteLength<1||originalRequest.byteLength>32768)fail('BROWSER_SELECTED_PAGES_SOURCE_REQUEST_BYTES');
 const raw=Uint8Array.from(originalRequest); // capture exact bytes, no JSON parse/re-encode
 const s=inspectOriginalBrowserSelectedPagesScopeV1DATA(value,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs).scope;
 request(expected,subjectOwner);peer(actualBrowserPeer);exact(currentSelector,['sourceId','instanceId','epoch']);u64(currentSelector.epoch);
 if(sha(raw)!==s.request.originalRequestSHA256||canonical(expected)!==canonical(s.request))fail('BROWSER_SELECTED_PAGES_SOURCE_ORIGINAL_REQUEST');
 if(canonical(actualBrowserPeer)!==canonical(s.peer))fail('BROWSER_SELECTED_PAGES_SOURCE_PEER_CHANGED');if(canonical(currentSelector)!==canonical(s.currentSelector))fail('BROWSER_SELECTED_PAGES_SOURCE_CURRENT_CHANGED');
 return Object.freeze({originalRequestSHA256:sha(raw),requestBytes:raw.byteLength,preparationID:s.request.preparationID,profileID:s.request.profileID,scopeOriginal:canonical(s),queryOriginal:s.request.queryOriginal,readOnly:true,...flags()});
}
