// Main public-request comparison only. This creates no Source/Root, signed
// pending profile, DEVICE registration, permission, or approved brand.
import {types} from 'node:util';
import {canonicalJSON,parseProductSessionRequest,productSessionRequestDigest,evmAddressFromYNX} from '@ynx-chain/wallet-auth';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '@ynx-chain/wallet-auth/product-session-device-registration-v4';
import {PRODUCT_SESSION_REGISTRY} from './wallet-auth-contract.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
function data(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');const d=Object.getOwnPropertyDescriptors(v),actual=Reflect.ownKeys(d);if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
const p=Object.getPrototypeOf(Uint8Array.prototype),len=Object.getOwnPropertyDescriptor(p,'byteLength').get,buf=Object.getOwnPropertyDescriptor(p,'buffer').get,off=Object.getOwnPropertyDescriptor(p,'byteOffset').get;
function publicHex(v,n){if(types.isProxy(v)||!types.isUint8Array(v))fail('DEVICE_ACCOUNT_PUBLIC_PAIR_REQUIRED');const b=buf.call(v);if(len.call(v)!==n||types.isSharedArrayBuffer(b)||Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get.call(b))fail('DEVICE_ACCOUNT_PUBLIC_PAIR_REQUIRED');return Buffer.from(new Uint8Array(b,off.call(v),n)).toString('hex');}
function originalJSON(raw){if(typeof raw!=='string'||!raw.length||!raw.isWellFormed()||Buffer.byteLength(raw)>16384)fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');let v;try{v=JSON.parse(raw);}catch{fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');}if(canonicalJSON(v)!==raw)fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');return v;}
export function inspectOriginalDeviceAccountApprovalDATA(selection,originals,{networkId,account,at}){
 const s=data(selection,['identityBinding','generation','publicPair']),i=data(s.identityBinding,['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId']),pair=data(s.publicPair,['pkA','pkB']),o=data(originals,['operationId','requestOriginal','registrationOriginal']);
 if(typeof o.operationId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(o.operationId))fail('DEVICE_ACCOUNT_ORIGINAL_OPERATION_REQUIRED');
 if(i.networkId!==networkId||i.canonicalOwner!==account||evmAddressFromYNX(i.account)!==account)fail('DEVICE_REGISTRATION_SELECTED_ACCOUNT_CHANGED');
 if(typeof o.registrationOriginal!=='string'||!o.registrationOriginal.length||!o.registrationOriginal.isWellFormed()||Buffer.byteLength(o.registrationOriginal)>16384)fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');
 const inspected=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(o.registrationOriginal??'', 'utf8')),record=inspected.record;
 // Preserve the original JSON string; neither parse nor equality can prove a
 // proposed registration's issuer/current status. The later receiver must.
 if(canonicalJSON(record)!==o.registrationOriginal)fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');
 for(const key of ['networkId','canonicalOwner','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(record[key]!==i[key])fail('DEVICE_ACCOUNT_PUBLIC_SELECTION_CHANGED');
 if(record.generation!==s.generation||record.pkA!==publicHex(pair.pkA,2592)||record.pkB!==publicHex(pair.pkB,64))fail('DEVICE_ACCOUNT_PUBLIC_PAIR_CHANGED');
 const request=parseProductSessionRequest(PRODUCT_SESSION_REGISTRY,originalJSON(o.requestOriginal),at);
 if(request.version!=='4'||request.issuedAt>at.toISOString()||canonicalJSON(request)!==o.requestOriginal||record.revokedAt!==null||record.registeredAt>at.toISOString()||record.expiresAt<=at.toISOString())fail('DEVICE_ACCOUNT_PUBLIC_ORIGINAL_INVALID');
 for(const key of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(request[key]!==record[key])fail('DEVICE_ACCOUNT_PUBLIC_SELECTION_CHANGED');
 if(request.deviceRegistrationId!==record.registrationId||request.deviceRegistrationRevision!==record.revision||request.deviceRegistrationDigest!==inspected.registrationDigest)fail('DEVICE_ACCOUNT_PUBLIC_REQUEST_CHANGED');
 const expiresAt=request.expiresAt<record.expiresAt?request.expiresAt:record.expiresAt;
 return Object.freeze({request,record,requestDigest:productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,at),scope:Object.freeze({pendingId:o.operationId,registrationOriginal:o.registrationOriginal}),originalWindow:Object.freeze({beginsAt:request.issuedAt,expiresAt}),dataOnly:true,approvedAccount:false,registered:false,SourceAdmission:false,NativeAdmission:false});
}
