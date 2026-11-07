// Finite Source-v2 server credential qualification DATA. Existing Source frame,
// Root/enrollment/profile/current registered N1 math remains the sole verifier.
// No TLS private key bytes, application/principal rights or Root key is added.
import{isIP}from'node:net';
import{types}from'node:util';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
export const SERVER_TLS_SOURCE_PURPOSE='server-tls-identity-source-v1';
export const SERVER_TLS_SOURCE_SELECTION_KEY='serverTLSIdentityV1';
export const SERVER_TLS_SOURCE_OPERATIONS=Object.freeze(['server.tls.present']);
const fail=c=>{throw Object.assign(Error(c),{code:c})};
const exact=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('SERVER_TLS_SOURCE_SCHEMA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))fail('SERVER_TLS_SOURCE_SCHEMA');};
const token=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v),owner=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v),hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),ms=v=>Number.isSafeInteger(v)&&v>0;
export function inspectOriginalServerTLSIdentityScopeV1DATA(scope,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs){
 exact(scope,['version','networkId','subjectOwner','sourceId','instanceId','serverId','credentialRef','credentialEpoch','issuerRef','targetOrigin','serverName','peerSAN','listenAddress','certificateSHA256','spkiSHA256','caSHA256','notBeforeMs','expiresAtMs']);
 exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(scope.version!==1||!hex(networkId)||scope.networkId!==networkId||!owner(subjectOwner)||scope.subjectOwner!==subjectOwner||scope.sourceId!==sourceId||scope.instanceId!==instanceId||![sourceId,instanceId,scope.serverId,scope.credentialRef,scope.issuerRef].every(token)||typeof scope.credentialEpoch!=='string'||!/^[1-9][0-9]{0,19}$/.test(scope.credentialEpoch)||BigInt(scope.credentialEpoch)>0xffffffffffffffffn)fail('SERVER_TLS_SOURCE_IDENTITY');
 if(Object.values(association).some(v=>typeof v!=='string'||!v||v.length>512)||!['linux','macos','windows'].includes(association.platform)||!token(association.productId)||!token(association.applicationId))fail('SERVER_TLS_SOURCE_ASSOCIATION');
 let origin,listen;try{origin=new URL(scope.targetOrigin);listen=new URL('tcp://'+scope.listenAddress);}catch{fail('SERVER_TLS_SOURCE_ORIGIN');}
 if(origin.protocol!=='https:'||origin.origin!==scope.targetOrigin||origin.hostname!==scope.serverName||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||typeof scope.peerSAN!=='string'||!/^[\x21-\x7e]{1,512}$/.test(scope.peerSAN)||!isIP(listen.hostname.replace(/^\[|\]$/g,''))||listen.username||listen.password||listen.pathname||listen.search||listen.hash||!listen.port||!/^[1-9][0-9]*$/.test(listen.port)||Number(listen.port)>65535||listen.host!==scope.listenAddress)fail('SERVER_TLS_SOURCE_ORIGIN');
 if(![scope.certificateSHA256,scope.spkiSHA256,scope.caSHA256].every(hex)||!ms(scope.notBeforeMs)||!ms(scope.expiresAtMs)||scope.expiresAtMs<=scope.notBeforeMs||!ms(issuedAtMs)||!ms(expiresAtMs)||scope.notBeforeMs>issuedAtMs||scope.expiresAtMs<expiresAtMs||!ms(atMs)||atMs<scope.notBeforeMs||atMs>=scope.expiresAtMs)fail('SERVER_TLS_SOURCE_WINDOW');
 const scopeOriginal=canonical(scope);
 return Object.freeze({scopeOriginal,scopeHead:sha(scopeOriginal),effectExpiresAtMs:Math.min(expiresAtMs,scope.expiresAtMs),dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,tlsPermission:false});
}
