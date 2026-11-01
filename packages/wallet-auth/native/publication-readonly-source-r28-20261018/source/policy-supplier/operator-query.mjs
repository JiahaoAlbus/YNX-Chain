// One normal authenticated node adapter for the two DIFFERENT consumers.
// Genesis and old deployed release are actual provider/readback bindings, not
// fixture values. A future deployment needs an explicit source-config update.
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
export const CANONICAL_NETWORK_ID='16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f';
export const NORMAL_OPERATOR=Object.freeze({origin:'https://rpc.ynxweb4.com',spkiSha256:'916248ff98c234e4389f872d26638d35783acd4d9cc27f9eb6ffb6eded56558f',reportedCommit:'65efa82e0615',reportedRelease:'ynx-network-surgical-65efa82e0615',lifetimeMs:30000,readTimeoutMs:5000,maxBytes:8*1024*1024});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const u64=v=>{if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>((1n<<64n)-1n))fail('AUTH_POLICY_QUERY_U64');return BigInt(v);};
const extra=['policyView','recordsView','source','committedHeight','committedBlockHash','committedAlgorithmVersion','checkpointStatus','checkpointIntegrity','recordsComplete'];
export function inspectOperatorProjection(body,owner){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype)fail('AUTH_POLICY_QUERY_SCHEMA');
 // This R1 supplier is not a v2 revocation interpreter. Never discard a
 // tombstone/status/global version and project a revoked owner back to v1.
 if(body.policyVersion==='YNX-ACCOUNT-POLICY/v2'||['revocations','authorizationStatus','pqSigningEnabled','committedAuthorizationStatus','committedPQSigningEnabled','globalPolicyVersion'].some(k=>Object.hasOwn(body,k)))fail('AUTH_POLICY_QUERY_REVOCATION_UNSUPPORTED');
 const extras=[...extra];if(body.committedAlgorithmVersion==='YNX-BATCH/v0.1')extras.push('committedActiveRevision');
 const allowed=['owner','executionHeight','ledgerNonce','algorithmVersion','enabled','records',...extras];
 if(body.enabled===true)allowed.push('policyVersion','networkId','enableAt');if(body.algorithmVersion==='YNX-BATCH/v0.1')allowed.push('activeRevision');
 if(Object.keys(body).sort().join('|')!==allowed.sort().join('|'))fail('AUTH_POLICY_QUERY_INCOMPLETE');
 if(body.policyView!=='next_execution'||body.recordsView!=='includes_pending'||body.recordsComplete!==true||body.source!=='authoritative_producer'||body.checkpointStatus!=='durable'||!hex(body.checkpointIntegrity)||!hex(body.committedBlockHash))fail('AUTH_POLICY_QUERY_UNHEALTHY');
 const height=u64(body.committedHeight),next=u64(body.executionHeight);if(next!==(height===((1n<<64n)-1n)?height:height+1n))fail('AUTH_POLICY_QUERY_HEIGHT');
 const dto=Object.fromEntries(Object.entries(body).filter(([k])=>!extras.includes(k)));
 const authorization=parsePQAccountAuthorization(dto,{chainId:CANONICAL_NETWORK_ID,nativeChainId:'6423',owner});
 let committed=null;for(const r of authorization.records)if(u64(r.registeredAt)<=height&&u64(r.activeFrom)<=height)committed=r;
 if(committed){if(body.committedAlgorithmVersion!=='YNX-BATCH/v0.1'||body.committedActiveRevision!==committed.revision)fail('AUTH_POLICY_QUERY_COMMITTED_MISMATCH');}
 else if(body.committedAlgorithmVersion!=='legacy'||Object.hasOwn(body,'committedActiveRevision'))fail('AUTH_POLICY_QUERY_COMMITTED_MISMATCH');
 return Object.freeze({authorization,committedRecord:committed,committedHeight:body.committedHeight,committedBlockHash:body.committedBlockHash,checkpointIntegrity:body.checkpointIntegrity});
}
function readResponse(path,signal,remaining,allowAbsence=false){
 return new Promise((resolve,reject)=>{
  let settled=false,size=0;const chunks=[];let timer;
  const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const req=request(new URL(path,NORMAL_OPERATOR.origin),{method:'GET',agent:false,signal,rejectUnauthorized:true,headers:{accept:'application/json','cache-control':'no-cache'},checkServerIdentity:(host,cert)=>{
   const error=checkServerIdentity(host,cert);if(error)return error;
   try{const spki=new X509Certificate(cert.raw).publicKey.export({format:'der',type:'spki'});if(createHash('sha256').update(spki).digest('hex')!==NORMAL_OPERATOR.spkiSha256)return Error('AUTH_POLICY_TLS_PIN');}catch{return Error('AUTH_POLICY_TLS_PIN');}
  }},res=>{
   if((res.statusCode!==200&&!(allowAbsence&&res.statusCode===404))||String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json'||((path.startsWith('/accounts/')||path.startsWith('/txs/'))&&!String(res.headers['cache-control']??'').toLowerCase().split(',').some(v=>v.trim()==='no-store'))){res.destroy();done(Error('AUTH_POLICY_SOURCE_NOT_SUPPLIED'));return;}
   res.on('data',b=>{size+=b.length;if(size>NORMAL_OPERATOR.maxBytes){res.destroy();done(Error('AUTH_POLICY_QUERY_SIZE'));}else chunks.push(b);});res.on('error',e=>done(e));
   res.on('end',()=>{try{done(null,Object.freeze({status:res.statusCode,text:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))}));}catch{done(Error('AUTH_POLICY_QUERY_UTF8'));}});
  });
  timer=setTimeout(()=>{done(Error('AUTH_POLICY_QUERY_TIMEOUT'));req.destroy();},Math.max(1,remaining));req.on('error',e=>done(e));req.end();
 });
}
async function readJSON(path,signal,remaining){
 const raw=await readResponse(path,signal,remaining);try{return JSON.parse(raw.text);}catch{fail('AUTH_POLICY_QUERY_JSON');}
}
const healthy=status=>{if(status?.chainId!==6423||status.catchingUp!==false||status.persistence!==true||status.persistenceError!==''||status.build?.commit!==NORMAL_OPERATOR.reportedCommit||status.build?.release!==NORMAL_OPERATOR.reportedRelease)fail('AUTH_POLICY_OPERATOR_VERSION_OR_HEALTH_CHANGED');};
// Private normal source port, no caller-specified endpoint, key, DTO or mode.
export function openNormalOperatorSource(mode,clock=Date.now){
 if(!['transaction','session'].includes(mode))fail('AUTH_POLICY_SOURCE_KIND');
 const controller=new AbortController(),pending=new Set();let retired=false,closed=false,deadline,anchor,lastCheckpoint,joining,closing;
 const read=async request=>{
  if(retired||closed)fail('AUTH_POLICY_SOURCE_RETIRED');if(request?.networkId!==CANONICAL_NETWORK_ID||typeof request.owner!=='string'||!/^0x[0-9a-f]{40}$/.test(request.owner)||(mode==='transaction'&&request.nativeChainId!=='6423'))fail('AUTH_POLICY_SOURCE_NETWORK');const start=clock();if(deadline===undefined)deadline=start+NORMAL_OPERATOR.lifetimeMs;
  const get=path=>{const now=clock();if(now<start||now>=deadline)fail('AUTH_POLICY_SOURCE_EXPIRED');return readJSON(path,controller.signal,Math.min(NORMAL_OPERATOR.readTimeoutMs,deadline-now));};
  const before=await get('/status');healthy(before);const genesis=await get('/blocks/0');if(genesis.height!==0||genesis.hash!==CANONICAL_NETWORK_ID)fail('AUTH_POLICY_SOURCE_NETWORK');
  const raw=await get('/accounts/'+request.owner+'/authorization'),view=inspectOperatorProjection(raw,request.owner);
  healthy(await get('/status'));const now=clock();if(retired||now<start||now>=deadline)fail('AUTH_POLICY_SOURCE_EXPIRED');
  const checkpoint={kind:'trusted-node-committed/v1',height:view.committedHeight,blockHash:view.committedBlockHash};
  if(lastCheckpoint&&(BigInt(checkpoint.height)<BigInt(lastCheckpoint.height)||(checkpoint.height===lastCheckpoint.height&&checkpoint.blockHash!==lastCheckpoint.blockHash)))fail('AUTH_POLICY_QUERY_REORG');
  if(anchor){if(mode==='session'&&(checkpoint.height!==anchor.height||checkpoint.blockHash!==anchor.blockHash))fail('AUTH_POLICY_ORIGINAL_ANCHOR_RECHECK_UNAVAILABLE');}else anchor=Object.freeze(checkpoint);lastCheckpoint=Object.freeze(checkpoint);
  if(mode==='transaction')return JSON.stringify({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:CANONICAL_NETWORK_ID,nativeChainId:'6423',canonicalOwner:request.owner,authorization:view.authorization,observedAt:new Date(now).toISOString(),expiresAt:new Date(deadline).toISOString()});
  const r=view.committedRecord;
  return JSON.stringify({version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:CANONICAL_NETWORK_ID,canonicalOwner:request.owner,checkpoint,policyVersion:view.authorization.enabled?'YNX-ACCOUNT-POLICY/v1':null,algorithmVersion:r?'YNX-BATCH/v0.1':'legacy',activeRecord:r?{revision:r.revision,registeredAt:r.registeredAt,activeFrom:r.activeFrom,pkA:r.pkA,pkB:r.pkB}:null,observedAt:new Date(now).toISOString(),expiresAt:new Date(deadline).toISOString()});
 };
 const enter=request=>{const p=Promise.resolve().then(()=>read(request));pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
 return Object.freeze({readOriginal:enter,recheck:enter,retire(){if(!retired){retired=true;controller.abort();}},join(){if(!joining)joining=Promise.resolve().then(async()=>{await Promise.allSettled([...pending]);});return joining;},close(){if(!closing)closing=Promise.resolve().then(async()=>{if(pending.size)fail('AUTH_POLICY_SOURCE_JOIN_PENDING');retired=true;closed=true;controller.abort();});return closing;}});
}

// Fixed normal Node-side GET reader for the original Wallet checkPQ caller.
// Raw text preserves decimal lexemes; only the existing Wallet DTO parser may
// interpret lookup/durability. No wire, nonce or signing/POST/retry surface.
export async function readOriginalTransaction(hash){
 if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/.test(hash))fail('AUTH_POLICY_TRANSACTION_HASH');
 const controller=new AbortController(),start=Date.now(),deadline=start+NORMAL_OPERATOR.lifetimeMs;
 const remaining=()=>{const now=Date.now();if(now<start||now>=deadline)fail('AUTH_POLICY_SOURCE_EXPIRED');return Math.min(NORMAL_OPERATOR.readTimeoutMs,deadline-now);};
 try{
  healthy(await readJSON('/status',controller.signal,remaining()));
  const genesis=await readJSON('/blocks/0',controller.signal,remaining());
  if(genesis.height!==0||genesis.hash!==CANONICAL_NETWORK_ID)fail('AUTH_POLICY_SOURCE_NETWORK');
  const original=await readResponse('/txs/'+hash,controller.signal,remaining(),true);
  healthy(await readJSON('/status',controller.signal,remaining()));remaining();
  return original;
 }finally{controller.abort();}
}
