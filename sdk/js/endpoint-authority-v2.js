// Signed endpoint authority v2. No network, custody access, or implicit activation.
// Trust roots, clocks and durable checkpoints are application-owned inputs, never
// fields learned from the downloaded document. WebCrypto verifies Ed25519.
export const AUTHORITY_V2_DOMAIN = 'YNX_ENDPOINT_AUTHORITY_V2\n';
export const AUTHORITY_V2_ID = 'ynx-testnet-endpoints';
export const AUTHORITY_V2_REPOSITORY = 'https://github.com/JiahaoAlbus/YNX-Chain';
export const AUTHORITY_V2_URLS = Object.freeze({
  rpc:'https://rpc-testnet.ynxweb4.com',evmRpc:'https://rpc-testnet.ynxweb4.com',
  faucet:'https://faucet-testnet.ynxweb4.com',rest:'https://rest.ynxweb4.com',
  walletGateway:'https://wallet-auth.ynxweb4.com',appGateway:'https://gateway.ynxweb4.com',
  explorer:'https://explorer.ynxweb4.com',indexer:'https://indexer.ynxweb4.com',monitor:'https://monitor.ynxweb4.com',
});
const brands = new WeakMap();
const MAX_BYTES = 131072, DAY = 86400000, ZERO = '0'.repeat(64);
const hash = x => typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const commit = x => typeof x==='string' && /^[a-f0-9]{40}$/.test(x);
const id = x => typeof x==='string' && /^[a-z][a-z0-9.-]{0,79}$/.test(x);
function check(ok,code){if(!ok)throw new Error(code);}
function fields(x,names,code='AUTHORITY_V2_FIELDS'){
  check(x&&Object.getPrototypeOf(x)===Object.prototype,code);
  check(Reflect.ownKeys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k)),code);
  for(const k of names){const d=Object.getOwnPropertyDescriptor(x,k);check(d.enumerable&&Object.hasOwn(d,'value'),code);}
}
function jsonValue(x,depth=0){
  check(depth<32,'AUTHORITY_V2_TOO_DEEP');
  if(x===null||typeof x==='boolean')return x;
  if(typeof x==='string'){
    // Avoid regexp lookbehind so importing the unchanged v1 API remains safe
    // on native JS engines which do not implement the v2 crypto primitives.
    for(let i=0;i<x.length;i++){const c=x.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const next=x.charCodeAt(++i);check(next>=0xdc00&&next<=0xdfff,'AUTHORITY_V2_INVALID_UNICODE');}else check(c<0xdc00||c>0xdfff,'AUTHORITY_V2_INVALID_UNICODE');}
    return x;
  }
  if(typeof x==='number'){check(Number.isSafeInteger(x)&&!Object.is(x,-0),'AUTHORITY_V2_INTEGER_REQUIRED');return x;}
  if(Array.isArray(x)){check(Object.keys(x).length===x.length&&Reflect.ownKeys(x).length===x.length+1,'AUTHORITY_V2_ARRAY');return Array.from({length:x.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(x,String(i));check(d?.enumerable&&Object.hasOwn(d,'value'),'AUTHORITY_V2_ACCESSOR');return jsonValue(d.value,depth+1);});}
  check(x&&Object.getPrototypeOf(x)===Object.prototype,'AUTHORITY_V2_JSON_REQUIRED');
  check(Reflect.ownKeys(x).length===Object.keys(x).length,'AUTHORITY_V2_FIELDS');
  const result=Object.create(null);
  for(const k of Object.keys(x).sort()){
    const d=Object.getOwnPropertyDescriptor(x,k);check(d.enumerable&&Object.hasOwn(d,'value'),'AUTHORITY_V2_ACCESSOR');
    result[k]=jsonValue(d.value,depth+1);
  }
  return result;
}
export function canonicalAuthorityV2(value){const out=JSON.stringify(jsonValue(value));check(new TextEncoder().encode(out).length<=MAX_BYTES,'AUTHORITY_V2_TOO_LARGE');return out;}
function clone(value){return JSON.parse(canonicalAuthorityV2(value));}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function same(a,b){return canonicalAuthorityV2(a)===canonicalAuthorityV2(b);}
function time(x){check(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x),'AUTHORITY_V2_TIME');const n=Date.parse(x);check(Number.isFinite(n)&&new Date(n).toISOString()===x,'AUTHORITY_V2_TIME');return n;}
function now(x){check(Number.isSafeInteger(x)&&x>=0,'AUTHORITY_V2_CLOCK_REQUIRED');return x;}
function version(x){check(typeof x==='string'&&/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/.test(x),'AUTHORITY_V2_CLIENT_VERSION');return x.split('.').map(Number);}
function atLeast(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return true;}
function strings(a,allowed){check(Array.isArray(a)&&new Set(a).size===a.length&&a.every(x=>allowed.includes(x)),'AUTHORITY_V2_SCOPE');}
function base64url(x,length){
  check(typeof x==='string'&&/^[A-Za-z0-9_-]+$/.test(x),'AUTHORITY_V2_ENCODING');
  let raw;try{raw=atob(x.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-x.length%4)%4));}catch{throw new Error('AUTHORITY_V2_ENCODING');}
  check(raw.length===length&&btoa(raw).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')===x,'AUTHORITY_V2_ENCODING');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function source(x){fields(x,['repository','commit','tree']);check(x.repository===AUTHORITY_V2_REPOSITORY&&commit(x.commit)&&commit(x.tree),'AUTHORITY_V2_SOURCE_IDENTITY');}
function checkpoint(x){fields(x,['rootVersion','sequence','payloadSha256']);check(Number.isSafeInteger(x.rootVersion)&&x.rootVersion>0&&Number.isSafeInteger(x.sequence)&&x.sequence>=0&&hash(x.payloadSha256),'AUTHORITY_V2_CHECKPOINT');check(x.sequence!==0||x.payloadSha256===ZERO,'AUTHORITY_V2_CHECKPOINT');}
export function assertAuthorityV2TrustRoot(input){
  const r=clone(input);fields(r,['schemaVersion','authorityId','rootVersion','chainId','anchor','keys','consumers','maxValiditySeconds']);
  check(r.schemaVersion==='ynx-endpoint-authority-trust/v2'&&r.authorityId===AUTHORITY_V2_ID&&r.chainId===6423,'AUTHORITY_V2_TRUST_ROOT');
  check(Number.isSafeInteger(r.rootVersion)&&r.rootVersion>0&&Number.isSafeInteger(r.maxValiditySeconds)&&r.maxValiditySeconds>0&&r.maxValiditySeconds<=604800,'AUTHORITY_V2_TRUST_ROOT');
  checkpoint(r.anchor);check(r.anchor.rootVersion===r.rootVersion,'AUTHORITY_V2_TRUST_ANCHOR');
  check(Array.isArray(r.keys)&&r.keys.length<=16&&new Set(r.keys.map(k=>k.keyId)).size===r.keys.length,'AUTHORITY_V2_KEY_RING');
  for(const k of r.keys){fields(k,['keyId','algorithm','publicKeyBase64url','notBefore','notAfter','revoked']);check(id(k.keyId)&&k.algorithm==='Ed25519'&&typeof k.revoked==='boolean','AUTHORITY_V2_KEY');base64url(k.publicKeyBase64url,32);check(time(k.notAfter)>time(k.notBefore),'AUTHORITY_V2_KEY_WINDOW');}
  check(Array.isArray(r.consumers)&&r.consumers.length<=64&&new Set(r.consumers.map(c=>c.consumerId)).size===r.consumers.length,'AUTHORITY_V2_CONSUMERS');
  for(const c of r.consumers){fields(c,['consumerId','origin','minimumClientVersion','endpoints','products']);check(id(c.consumerId)&&typeof c.origin==='string'&&new URL(c.origin).origin===c.origin&&c.origin.startsWith('https://'),'AUTHORITY_V2_CONSUMER');version(c.minimumClientVersion);strings(c.endpoints,Object.keys(AUTHORITY_V2_URLS));strings(c.products,['finance']);}
  return freeze(r);
}
function fresh(x,issued){const t=time(x);check(t<=issued&&issued-t<=DAY,'AUTHORITY_V2_STALE_EVIDENCE');}
function observation(x,url,issued){fields(x,['url','httpStatus','bodySha256','observedAt','tlsVerified','directDNS']);check(x.url===url&&x.httpStatus===200&&hash(x.bodySha256)&&x.tlsVerified===true&&x.directDNS===true,'AUTHORITY_V2_PUBLIC_EVIDENCE');fresh(x.observedAt,issued);}
export function canonicalAuthorityV2Payload(manifest){const m=clone(manifest);delete m.integrity;return canonicalAuthorityV2(m);}
export function authorityV2SigningMessage(manifest,keyId){check(id(keyId),'AUTHORITY_V2_KEY');return AUTHORITY_V2_DOMAIN+canonicalAuthorityV2({algorithm:'Ed25519',keyId,payload:canonicalAuthorityV2Payload(manifest)});}
export function assertAuthorityV2Manifest(input,{nowMs}={}){
  const m=clone(input);fields(m,['schemaVersion','authorityId','manifestVersion','sequence','previousPayloadSha256','environment','chainId','cosmosChainId','asset','issuedAt','expiresAt','issuerSource','consumers','endpoints','products','policy','integrity']);
  check(m.schemaVersion==='2.0.0'&&m.authorityId===AUTHORITY_V2_ID,'AUTHORITY_V2_SCHEMA');
  check(Number.isSafeInteger(m.sequence)&&m.sequence>0&&m.manifestVersion===`2.0.0.${m.sequence}`&&hash(m.previousPayloadSha256),'AUTHORITY_V2_VERSION');
  check(m.environment==='testnet'&&m.chainId===6423&&m.cosmosChainId==='ynx_6423-1'&&m.asset==='YNXT','AUTHORITY_V2_WRONG_CHAIN');
  const issued=time(m.issuedAt),expires=time(m.expiresAt);check(expires>issued&&expires-issued<=7*DAY,'AUTHORITY_V2_VALIDITY');
  check(now(nowMs)>=issued&&nowMs<expires,'AUTHORITY_V2_EXPIRED_OR_FUTURE');source(m.issuerSource);
  check(Array.isArray(m.consumers)&&m.consumers.length>0&&m.consumers.length<=64&&new Set(m.consumers.map(c=>c.consumerId)).size===m.consumers.length,'AUTHORITY_V2_CONSUMERS');
  for(const c of m.consumers){fields(c,['consumerId','origin','minimumClientVersion']);check(id(c.consumerId)&&typeof c.origin==='string','AUTHORITY_V2_CONSUMER');version(c.minimumClientVersion);}
  fields(m.endpoints,Object.keys(AUTHORITY_V2_URLS));
  for(const [key,url] of Object.entries(AUTHORITY_V2_URLS)){
    const e=m.endpoints[key];fields(e,['url','status','evidence']);check(e.url===url&&['PENDING','VERIFIED'].includes(e.status),'AUTHORITY_V2_ENDPOINT');
    if(e.status==='PENDING'){check(e.evidence===null,'AUTHORITY_V2_PENDING_EVIDENCE');continue;}
    fields(e.evidence,['health','version','source','chainId','receiptSha256']);const p=e.evidence;source(p.source);
    check(p.chainId===6423&&hash(p.receiptSha256),'AUTHORITY_V2_ENDPOINT_EVIDENCE');
    observation(p.health,url+(['rpc','evmRpc'].includes(key)?'/status':'/health'),issued);
    // A service may expose build identity with status, but Wallet Gateway must
    // have its independent /version response, not a health-only promotion.
    observation(p.version,url+(['rpc','evmRpc'].includes(key)?'/status':'/version'),issued);
  }
  fields(m.products,['finance']);const p=m.products.finance;fields(p,['status','evidence','officialSandboxVerified','providerVerified','productionApproved']);
  check(['PENDING','VERIFIED'].includes(p.status)&&p.officialSandboxVerified===false&&p.providerVerified===false&&p.productionApproved===false,'AUTHORITY_V2_PROVIDER_BOUNDARY');
  if(p.status==='PENDING')check(p.evidence===null,'AUTHORITY_V2_PENDING_EVIDENCE');
  else{
    check(m.endpoints.walletGateway.status==='VERIFIED','AUTHORITY_V2_GATEWAY_REQUIRED');
    fields(p.evidence,['origin','source','observedAt','receiptSha256','registrySha256','callbackContractSha256','currentPublicSourceAccepted','productSessionAccepted']);
    check(p.evidence.origin==='https://finance.ynxweb4.com'&&hash(p.evidence.receiptSha256)&&hash(p.evidence.registrySha256)&&hash(p.evidence.callbackContractSha256)&&p.evidence.currentPublicSourceAccepted===true&&p.evidence.productSessionAccepted===true,'AUTHORITY_V2_FINANCE_ACCEPTANCE');
    source(p.evidence.source);fresh(p.evidence.observedAt,issued);
  }
  check(same(m.policy,{mainnetEnabled:false,automaticWriteRetry:false,automaticFailover:false,clientRenewal:false}),'AUTHORITY_V2_POLICY');
  fields(m.integrity,['payloadSha256','algorithm','keyId','signature']);check(hash(m.integrity.payloadSha256)&&m.integrity.algorithm==='Ed25519'&&id(m.integrity.keyId),'AUTHORITY_V2_INTEGRITY');base64url(m.integrity.signature,64);
  return m;
}
function nextCheckpoint(m,r){return {rootVersion:r.rootVersion,sequence:m.sequence,payloadSha256:m.integrity.payloadSha256};}
function progression(m,r,current){
  checkpoint(current);check(current.rootVersion<=r.rootVersion,'AUTHORITY_V2_ROOT_ROLLBACK');
  const anchor=r.anchor;
  check(current.sequence>=anchor.sequence||current.rootVersion<r.rootVersion,'AUTHORITY_V2_ANCHOR_ROLLBACK');
  const floor=current.sequence>=anchor.sequence?current:anchor;
  if(current.sequence===anchor.sequence)check(current.payloadSha256===anchor.payloadSha256,'AUTHORITY_V2_ANCHOR_CONFLICT');
  check(m.sequence>=floor.sequence,'AUTHORITY_V2_ROLLBACK');
  if(m.sequence===floor.sequence)check(m.integrity.payloadSha256===floor.payloadSha256,'AUTHORITY_V2_EQUIVOCATION');
  else check(m.sequence===floor.sequence+1&&m.previousPayloadSha256===floor.payloadSha256,'AUTHORITY_V2_PREDECESSOR');
}
function contextMatch(m,r,ctx){
  fields(ctx,['consumerId','origin','clientVersion']);version(ctx.clientVersion);
  const local=r.consumers.find(c=>c.consumerId===ctx.consumerId),signed=m.consumers.find(c=>c.consumerId===ctx.consumerId);
  check(local&&signed&&local.origin===ctx.origin&&signed.origin===ctx.origin,'AUTHORITY_V2_WRONG_CONSUMER');
  check(atLeast(ctx.clientVersion,local.minimumClientVersion)&&atLeast(ctx.clientVersion,signed.minimumClientVersion),'AUTHORITY_V2_CLIENT_TOO_OLD');
  return local;
}
export function assertAuthorityV2IssuancePolicy(input,{trustRoot,checkpoint:current,consumer,nowMs}={}){
  // All inputs copied before the first asynchronous crypto operation.
  const r=assertAuthorityV2TrustRoot(trustRoot),m=assertAuthorityV2Manifest(input,{nowMs}),state=clone(current),ctx=clone(consumer);
  const scope=contextMatch(m,r,ctx);progression(m,r,state);
  check(time(m.expiresAt)-time(m.issuedAt)<=r.maxValiditySeconds*1000,'AUTHORITY_V2_VALIDITY');
  const key=r.keys.find(k=>k.keyId===m.integrity.keyId);
  check(key&&!key.revoked,'AUTHORITY_V2_UNKNOWN_OR_REVOKED_KEY');
  check(time(m.issuedAt)>=time(key.notBefore)&&time(m.expiresAt)<=time(key.notAfter)&&nowMs>=time(key.notBefore)&&nowMs<time(key.notAfter),'AUTHORITY_V2_KEY_WINDOW');
  return {manifest:m,root:r,checkpoint:state,consumer:ctx,scope,key};
}
export async function verifySignedEndpointAuthority(input,options={}){
  const {manifest:m,root:r,checkpoint:state,consumer:ctx,scope,key}=assertAuthorityV2IssuancePolicy(input,options);
  check(globalThis.crypto?.subtle,'AUTHORITY_V2_CRYPTO_UNAVAILABLE');
  const payload=new TextEncoder().encode(canonicalAuthorityV2Payload(m));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',payload)),b=>b.toString(16).padStart(2,'0')).join('');
  check(digest===m.integrity.payloadSha256,'AUTHORITY_V2_DIGEST_MISMATCH');
  const publicKey=await crypto.subtle.importKey('raw',base64url(key.publicKeyBase64url,32),{name:'Ed25519'},false,['verify']);
  check(await crypto.subtle.verify('Ed25519',publicKey,base64url(m.integrity.signature,64),new TextEncoder().encode(authorityV2SigningMessage(m,key.keyId))),'AUTHORITY_V2_SIGNATURE_INVALID');
  freeze(m);brands.set(m,{root:r,scope,consumer:freeze(ctx),checkpoint:freeze(state)});return m;
}
function selected(m,current,nowMs){
  const meta=brands.get(m);check(meta,'AUTHORITY_V2_NOT_VERIFIED');
  assertAuthorityV2Manifest(m,{nowMs});checkpoint(current);
  check(same(current,nextCheckpoint(m,meta.root)),'AUTHORITY_V2_NOT_CURRENT');return meta;
}
export function selectSignedAuthorityEndpoint(m,key,{checkpoint:current,nowMs}={}){
  const meta=selected(m,current,nowMs);check(meta.scope.endpoints.includes(key)&&m.endpoints[key]?.status==='VERIFIED','AUTHORITY_V2_ENDPOINT_NOT_AUTHORIZED');return m.endpoints[key].url;
}
export function financeProductSessionAuthority(m,{checkpoint:current,nowMs}={}){
  const meta=selected(m,current,nowMs);
  check(meta.scope.products.includes('finance')&&m.products.finance.status==='VERIFIED','AUTHORITY_V2_FINANCE_NOT_AUTHORIZED');
  return freeze({walletGateway:selectSignedAuthorityEndpoint(m,'walletGateway',{checkpoint:current,nowMs}),financeOrigin:m.products.finance.evidence.origin,manifestVersion:m.manifestVersion,payloadSha256:m.integrity.payloadSha256,officialSandboxVerified:false,providerVerified:false,productionApproved:false});
}
// The storage implementation MUST provide durable atomic CAS, including across
// processes/tabs. Resetting it, blindly writing, or returning true before commit
// voids rollback protection. Missing storage/clock is a hard failure.
export function createEndpointAuthorityClient({trustRoot,consumer,storage,clock}={}){
  const r=assertAuthorityV2TrustRoot(trustRoot),ctx=freeze(clone(consumer));
  check(storage&&typeof storage.read==='function'&&typeof storage.compareAndSwap==='function'&&typeof clock==='function','AUTHORITY_V2_DURABLE_STORAGE_REQUIRED');
  let active=null,generation=0;
  async function currentActive(select){const token=generation,m=active;check(m,'AUTHORITY_V2_NOT_ACTIVE');const current=await storage.read();check(token===generation&&active===m,'AUTHORITY_V2_SUPERSEDED');return select(m,{checkpoint:current,nowMs:now(clock())});}
  return Object.freeze({
    async accept(input,{source}={}){
      check(['bundled','remote'].includes(source),'AUTHORITY_V2_SOURCE');const snapshot=freeze(clone(input)),token=++generation;active=null;
      const previous=freeze(clone(await storage.read()));const m=await verifySignedEndpointAuthority(snapshot,{trustRoot:r,checkpoint:previous,consumer:ctx,nowMs:now(clock())});
      check(token===generation,'AUTHORITY_V2_SUPERSEDED');assertAuthorityV2Manifest(m,{nowMs:now(clock())});
      const next=nextCheckpoint(m,r);
      check(await storage.compareAndSwap(previous,next),'AUTHORITY_V2_CHECKPOINT_CONFLICT');
      check(token===generation,'AUTHORITY_V2_SUPERSEDED');assertAuthorityV2Manifest(m,{nowMs:now(clock())});active=m;return m;
    },
    endpoint(key){return currentActive((m,options)=>selectSignedAuthorityEndpoint(m,key,options));},
    financeProductSession(){return currentActive(financeProductSessionAuthority);},
    invalidate(){generation++;active=null;},
  });
}
export function isSignedEndpointAuthority(value){return brands.has(value);}
