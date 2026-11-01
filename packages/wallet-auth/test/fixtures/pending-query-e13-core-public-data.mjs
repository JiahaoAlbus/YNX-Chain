// PUBLIC syntactic constants copied from Core's pendingQueryPUBLICFixture /
// productDeviceV4TestBinding/Fixture, not newly generated keys or a signed
// interoperability fixture. Full registered N1 positive awaits Core artifact.
import {canonicalJSON} from '../../src/canonical.js';import {createHash} from 'node:crypto';
export const sha=b=>createHash('sha256').update(b).digest('hex');
const raw=v=>new TextEncoder().encode(canonicalJSON(v));
export function fixture(){
 const record={version:'4',registrationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',networkId:'ab'.repeat(32),canonicalOwner:'0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',productId:'developer',clientId:'com.ynx.developer.macos',platform:'macos',applicationId:'com.ynx.developer',bundleId:'com.ynx.developer',packageId:null,origin:'https://developer.ynxweb4.com',callback:'ynxdeveloper://callback',deviceId:'PUBLIC-device-v4',generation:'18446744073709551615',revision:'1',pkA:'31'.repeat(2592),pkB:'32'.repeat(64),registeredAt:'2026-10-26T07:00:00.000Z',expiresAt:'2026-10-26T09:00:00.000Z',revokedAt:null};
 const registrationOriginal=raw(record),originalPairPost=raw({operationId:'a'.repeat(64),registrationOriginal:new TextDecoder().decode(registrationOriginal),registrationMember:'PUBLIC-syntax-only-no-grant',request:{},approval:{}}),queryOriginal=raw({version:'1',operationId:'a'.repeat(64),originalRequestBodyDigest:sha(originalPairPost)}),actor=Object.fromEntries(['applicationId','bundleId','callback','canonicalOwner','clientId','deviceId','networkId','origin','packageId','platform','productId'].map(k=>[k,record[k]])),at=Date.parse('2026-10-26T08:00:00.000Z');
 const expected={networkId:record.networkId,canonicalOwner:record.canonicalOwner,pkA:record.pkA,pkB:record.pkB,actorDigest:sha(raw(actor)),serviceOrigin:'https://wallet-auth.ynxweb4.com',nonce:'n'.repeat(43),issuedAt:'2026-10-26T08:00:00.000Z',expiresAt:'2026-10-26T08:00:30.000Z',atMs:at,sourceIssuedAtMs:at-60000,sourceExpiresAtMs:at+60000};
 return {queryOriginal,registrationOriginal,originalPairPost,expected};
}
