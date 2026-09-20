// Shared bundled authority validation. No network, storage, signing or clock renewal.
export const ENDPOINT_AUTHORITY_CANONICALIZATION = 'UTF-8 stable JSON recursively sorted keys, integrity omitted';
export const ENDPOINT_AUTHORITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ENDPOINT_AUTHORITY_URLS = Object.freeze({
  rpc:'https://rpc-testnet.ynxweb4.com', evmRpc:'https://rpc-testnet.ynxweb4.com',
  rest:'https://rest.ynxweb4.com', walletGateway:'https://wallet-auth.ynxweb4.com',
  appGateway:'https://gateway.ynxweb4.com', faucet:'https://faucet-testnet.ynxweb4.com',
  explorer:'https://explorer.ynxweb4.com', indexer:'https://indexer.ynxweb4.com', monitor:'https://monitor.ynxweb4.com',
});
function requireValue(value,code){if(!value)throw new Error(code);}
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){requireValue(Number.isFinite(value),'AUTHORITY_NON_JSON');return value;}
  if(Array.isArray(value))return value.map(canonical);
  requireValue(value&&Object.getPrototypeOf(value)===Object.prototype,'AUTHORITY_NON_JSON');
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
export function canonicalEndpointAuthorityPayload(manifest){
  requireValue(manifest&&Object.getPrototypeOf(manifest)===Object.prototype,'AUTHORITY_NON_JSON');
  return JSON.stringify(canonical(Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='integrity'))));
}
export function endpointAuthorityTime(value){
  requireValue(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value),'AUTHORITY_INVALID_TIME');
  const ms=Date.parse(value);requireValue(Number.isFinite(ms)&&new Date(ms).toISOString()===value,'AUTHORITY_INVALID_TIME');return ms;
}
const sha = value => typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const equal = (a,b) => JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const verifiedAuthorities = new WeakSet();
export function assertEndpointAuthorityStructure(manifest,{nowMs=Date.now()}={}){
  requireValue(Number.isSafeInteger(nowMs)&&nowMs>=0,'AUTHORITY_INVALID_NOW');
  requireValue(BufferlessByteLength(canonicalEndpointAuthorityPayload(manifest))<=65536,'AUTHORITY_TOO_LARGE');
  requireValue(equal(Object.keys(manifest).sort(),['schemaVersion','manifestVersion','status','environment','releaseId','sourceCommit','issuedAt','expiresAt','cosmosChainId','evmChainId','evmChainHex','nativeAsset',...Object.keys(ENDPOINT_AUTHORITY_URLS),'healthUrl','versionUrl','endpointStates','mainnet','legacyCompatibility','sourceEvidence','fallbacks','minimumClientVersion','clientPolicy','acceptanceBoundary','integrity'].sort()),'AUTHORITY_FIELDS');
  requireValue(manifest.schemaVersion==='1.1.0'&&/^1\.1\.0-weekly-v3\.\d{8}\.\d+$/.test(manifest.manifestVersion??''),'AUTHORITY_SCHEMA');
  requireValue(manifest.status==='ACCEPTED_BUNDLED_CONSUMER_CONTRACT'&&manifest.environment==='testnet'&&
    manifest.cosmosChainId==='ynx_6423-1'&&manifest.evmChainId===6423&&manifest.evmChainHex==='0x1917'&&manifest.nativeAsset==='YNXT','AUTHORITY_WRONG_CHAIN');
  requireValue(commit(manifest.sourceCommit)&&/^ynx-endpoints-\d{8}\.\d+$/.test(manifest.releaseId??''),'AUTHORITY_SOURCE');
  const issued=endpointAuthorityTime(manifest.issuedAt),expires=endpointAuthorityTime(manifest.expiresAt);
  requireValue(expires>issued&&expires-issued<=ENDPOINT_AUTHORITY_MAX_AGE_MS,'AUTHORITY_VALIDITY_WINDOW');
  requireValue(nowMs>=issued,'AUTHORITY_NOT_YET_VALID');requireValue(nowMs<expires,'AUTHORITY_EXPIRED');
  requireValue(equal(manifest.mainnet,{enabled:false,chainId:null,rpc:null,reservedRpcUrl:'https://rpc-mainnet.ynxweb4.com'}),'AUTHORITY_MAINNET_DISABLED');
  for(const [key,url] of Object.entries(ENDPOINT_AUTHORITY_URLS)){
    requireValue(manifest[key]===url,'AUTHORITY_ENDPOINT_ALLOWLIST');
    const state=manifest.endpointStates?.[key];requireValue(state&&['VERIFIED','PENDING'].includes(state.status),'AUTHORITY_ENDPOINT_STATE');
    if(['rpc','evmRpc','faucet'].includes(key)){
      requireValue(state.status==='VERIFIED'&&state.chainId===6423&&commit(state.sourceCommit),'AUTHORITY_ENDPOINT_EVIDENCE');
      const observed=endpointAuthorityTime(state.verifiedAt);
      requireValue(observed<=issued&&issued-observed<=24*60*60*1000,'AUTHORITY_STALE_EVIDENCE');
      requireValue(state.health===url+(key==='faucet'?'/health':'/status')&&state.versionIdentity===state.health,'AUTHORITY_EVIDENCE_ROUTE');
    }else requireValue(state.status==='PENDING'&&state.verifiedAt===null&&state.sourceCommit===null,'AUTHORITY_UNVERIFIED_PROMOTION');
  }
  requireValue(equal(manifest.endpointStates.rpc,manifest.endpointStates.evmRpc),'AUTHORITY_RPC_IDENTITY');
  requireValue(equal(Object.keys(manifest.endpointStates).sort(),[...Object.keys(ENDPOINT_AUTHORITY_URLS),'products'].sort()),'AUTHORITY_ENDPOINT_KEYS');
  requireValue(manifest.sourceEvidence?.path===`chain-metadata/endpoint-authority/${manifest.manifestVersion.replace('1.1.0-weekly-v3.','')}.evidence.json`&&sha(manifest.sourceEvidence?.sha256),'AUTHORITY_EVIDENCE_BINDING');
  requireValue(manifest.healthUrl==='https://monitor.ynxweb4.com/health'&&manifest.versionUrl==='https://monitor.ynxweb4.com/version','AUTHORITY_ENDPOINT_ALLOWLIST');
  for(const [key,url] of Object.entries({rpc:'https://rpc.ynxweb4.com',faucet:'https://faucet.ynxweb4.com'})){
    const legacy=manifest.legacyCompatibility?.[key],current=manifest.endpointStates[key];
    requireValue(legacy?.url===url&&legacy.status==='VERIFIED'&&legacy.chainId===6423&&legacy.sourceCommit===current.sourceCommit&&legacy.verifiedAt===current.verifiedAt,'AUTHORITY_LEGACY_IDENTITY');
  }
  requireValue(equal(manifest.legacyCompatibility?.evmRpc,{url:'https://evm.ynxweb4.com',status:'PENDING',reason:'Preserved compatibility location; not renewed by this RPC/Faucet evidence'}),'AUTHORITY_LEGACY_EVM');
  requireValue(equal(Object.keys(manifest.legacyCompatibility).sort(),['evmRpc','faucet','rpc']),'AUTHORITY_LEGACY_KEYS');
  requireValue(equal(manifest.fallbacks,{rpc:[],evmRpc:[],rest:[],walletGateway:[],appGateway:[],faucet:[]}), 'AUTHORITY_NO_AUTOMATIC_FAILOVER');
  requireValue(equal(manifest.endpointStates.products,{finance:{status:'PENDING',reason:'Official provider and current public Finance acceptance are independent gates'}}),'AUTHORITY_PRODUCT_PROMOTION');
  requireValue(manifest.clientPolicy?.remoteReplacement==='FORBIDDEN_UNSIGNED'&&manifest.clientPolicy?.clientRenewal===false&&manifest.clientPolicy?.automaticWriteRetry===false,'AUTHORITY_CLIENT_POLICY');
  requireValue(manifest.minimumClientVersion?.policy==='Only independently accepted product release matrices may declare minimum client versions','AUTHORITY_CLIENT_VERSION');
  requireValue(manifest.integrity?.algorithm==='SHA-256'&&manifest.integrity.canonicalization===ENDPOINT_AUTHORITY_CANONICALIZATION&&sha(manifest.integrity.payloadSha256),'AUTHORITY_INTEGRITY_FORMAT');
  requireValue(equal(manifest.integrity.remoteSignature,{status:'PENDING_PROTECTED_SIGNER',keyId:null,signature:null,failClosed:true}),'AUTHORITY_REMOTE_SIGNER');
  return manifest;
}
const BufferlessByteLength = value => {
  // Native consumers may supply secure digestSHA256 without a TextEncoder polyfill.
  let bytes=0;for(const character of value){const c=character.codePointAt(0);bytes+=c<0x80?1:c<0x800?2:c<0x10000?3:4;}return bytes;
};

export async function validateEndpointAuthority(manifest,{trustedPin,nowMs=Date.now(),source='bundled',digestSHA256}={}){
  requireValue(source==='bundled','AUTHORITY_REMOTE_FORBIDDEN');
  // Pin MUST come from separately reviewed app/release policy, never from manifest.
  requireValue(trustedPin&&sha(trustedPin.payloadSha256)&&trustedPin.manifestVersion===manifest?.manifestVersion,'AUTHORITY_UNTRUSTED_PIN');
  const expectedHash=trustedPin.payloadSha256;
  // Snapshot before awaiting the digest so caller mutation cannot change the result.
  const bytes=JSON.stringify(manifest);requireValue(typeof bytes==='string'&&BufferlessByteLength(bytes)<=65536,'AUTHORITY_TOO_LARGE');
  const snapshot=JSON.parse(bytes);assertEndpointAuthorityStructure(snapshot,{nowMs});
  requireValue(snapshot.integrity.payloadSha256===expectedHash,'AUTHORITY_PIN_MISMATCH');
  let actual;
  if(digestSHA256)actual=await digestSHA256(canonicalEndpointAuthorityPayload(snapshot));
  else {
    requireValue(globalThis.crypto?.subtle&&typeof TextEncoder==='function','AUTHORITY_SHA256_UNAVAILABLE');
    actual=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalEndpointAuthorityPayload(snapshot)))),b=>b.toString(16).padStart(2,'0')).join('');
  }
  requireValue(sha(actual)&&actual===expectedHash,'AUTHORITY_HASH_MISMATCH');
  verifiedAuthorities.add(snapshot);return deepFreeze(snapshot);
}
export function deepFreeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}

export function selectAuthorityEndpoint(verifiedAuthority,key,{nowMs=Date.now()}={}){
  // This selector never activates compatibility metadata or follows fallbacks.
  requireValue(verifiedAuthorities.has(verifiedAuthority),'AUTHORITY_NOT_VALIDATED');
  assertEndpointAuthorityStructure(verifiedAuthority,{nowMs});
  requireValue(['rpc','evmRpc','faucet'].includes(key),'AUTHORITY_ENDPOINT_NOT_VERIFIED');
  return verifiedAuthority[key];
}
