// Before-keygen immutable DATA, never a user approval, Source, proof or factory.
import{types}from'node:util';
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{ynxAddressFromEVM}from'./crypto.js';
import{productPlatformBinding}from'./product-session-registry.js';
import registry from'../product-session-registry.json' with{type:'json'};
import{bindPublicContentBytes}from'./public-content-binding.js';
export const DEVICE_CREATE_INTENT_DOMAIN='YNX-PRODUCT-DEVICE-CREATE/v1';
export const DEVICE_CREATE_IDENTITY_DOMAIN='YNX-PRODUCT-DEVICE-IDENTITY/v1';
export const DEVICE_PROVISIONING_SOURCE_PURPOSE='product-session-device-provisioning-source-v4';
const INPUT=['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','operationId','nonce','issuedAt','expiresAt'];
const STABLE=['networkId','canonicalOwner','account','productId','clientId','deviceId'];
const ta=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,setBytes=Uint8Array.prototype.set;
const views=new WeakMap(),encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const FLAGS=Object.freeze({dataOnly:true,userApproved:false,SourceAdmission:false,NativeAdmission:false});
const fail=(code='DEVICE_CREATE_INTENT_DATA_INVALID')=>{throw new WalletAuthError(code,'Original device creation intent DATA is invalid');};
function plain(v,keys){if(!v||typeof v!=='object'||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);if(names.length!==keys.length||names.some(n=>typeof n!=='string')||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function str(v,re,max){if(typeof v!=='string'||v.length>max||re.exec(v)?.[0]!==v)fail();return v;}
function instant(v){str(v,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,24);const n=Date.parse(v);if(!Number.isSafeInteger(n)||n<0||new Date(n).toISOString()!==v)fail();return n;}
function parseInput(raw){const v=plain(raw,INPUT);str(v.networkId,/^[a-f0-9]{64}$/,64);str(v.canonicalOwner,/^0x[a-f0-9]{40}$/,42);if(typeof v.account!=='string'||v.account!==ynxAddressFromEVM(v.canonicalOwner))fail();str(v.deviceId,/^[A-Za-z0-9._:-]{8,128}$/,128);str(v.generation,/^[1-9][0-9]{0,19}$/,20);if(BigInt(v.generation)>18446744073709551615n)fail();str(v.operationId,/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,128);str(v.nonce,/^[a-f0-9]{64}$/,64);const begins=instant(v.issuedAt),end=instant(v.expiresAt);if(end<=begins||end-begins>30000)fail();const b=productPlatformBinding(registry,v.productId,v.platform);for(const key of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'])if(v[key]!==b[key])fail();return{value:Object.freeze(v),begins,end};}
function make(raw){const p=parseInput(raw),terms=Object.freeze({version:'1',domain:DEVICE_CREATE_INTENT_DOMAIN,...p.value}),approvedTerms=canonicalJSON(terms),stable=Object.freeze({version:'1',domain:DEVICE_CREATE_IDENTITY_DOMAIN,...Object.fromEntries(STABLE.map(k=>[k,p.value[k]]))}),stableDeviceIdentity=canonicalJSON(stable);if(encoder.encode(approvedTerms).length>16384||encoder.encode(stableDeviceIdentity).length>1024)fail();const nativeIntentDATA=Object.freeze({network:p.value.networkId,stableDeviceIdentity,approvedTerms,issuedAtMs:String(p.begins),expiresAtMs:String(p.end)}),view=Object.freeze({terms,approvedTerms,stableDeviceIdentity,binding:bindPublicContentBytes(encoder.encode(approvedTerms)),stableIdentityBinding:bindPublicContentBytes(encoder.encode(stableDeviceIdentity)),nativeIntentDATA,timeBasis:'original-issued-at-data-only',...FLAGS});views.set(view,p.value);return view;}
export function createOriginalDeviceCreateIntentDATA(input){return make(input);}
function copyBytes(v){if(types.isProxy(v)||!types.isUint8Array(v))fail();const length=getLength.call(v),buffer=getBuffer.call(v);if(!length||length>16384||types.isSharedArrayBuffer(buffer))fail();const out=new Uint8Array(length);try{setBytes.call(out,v);}catch{fail();}return out;}
export function inspectOriginalDeviceCreateIntentDATA(originalBytes){let raw,value;try{raw=decoder.decode(copyBytes(originalBytes));value=JSON.parse(raw);}catch{fail();}const t=plain(value,['version','domain',...INPUT]);if(t.version!=='1'||t.domain!==DEVICE_CREATE_INTENT_DOMAIN)fail();const input=Object.fromEntries(INPUT.map(k=>[k,t[k]])),v=make(input);if(v.approvedTerms!==raw)fail();return v;}
function own(view){const v=views.get(view);if(!v)fail();return v;}
// Expected selection is independently read by Main/Auth; this comparison alone
// cannot establish its origin/currentness, user consent or a Source admission.
export function assertOriginalDeviceCreateSelectionDATA(view,independent){const actual=own(view),expected=plain(independent,STABLE);for(const key of STABLE)if(actual[key]!==expected[key])fail('DEVICE_CREATE_SELECTION_DATA_MISMATCH');return Object.freeze({selectionMatches:true,...FLAGS});}
// Caller retains the original through UI/cold reconciliation. Generation,
// nonce, operation or expiry changes never authorize replacing an original.
export function assertOriginalDeviceCreateIntentUnchangedDATA(original,current){own(original);own(current);if(original.stableDeviceIdentity!==current.stableDeviceIdentity||original.approvedTerms!==current.approvedTerms)fail('DEVICE_CREATE_INTENT_CONFLICT');return Object.freeze({originalMatches:true,...FLAGS});}
