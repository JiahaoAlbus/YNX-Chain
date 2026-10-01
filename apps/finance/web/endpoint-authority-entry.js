import {createEndpointAuthorityClient,recoverEndpointAuthorityHistory} from '@ynx-chain/sdk';
import {createBrowserAuthorityCheckpointStore} from './endpoint-authority-store.js';

const CONSUMER=Object.freeze({consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0'});
const CONFIG_KEY='__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__';
const CONFIG_URL='/api/endpoint-authority/v2/config';
const CHANNEL='ynx-finance-endpoint-authority-v2';
let generation=0,hardGeneration=0,currentCheckpointIdentity=null;
let authorityOperation=null;
const normalizedConfigurations=new WeakMap();
function checkpoint(value){return value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')==='payloadSha256,rootVersion,sequence'&&Number.isSafeInteger(value.rootVersion)&&value.rootVersion>0&&Number.isSafeInteger(value.sequence)&&value.sequence>=0&&typeof value.payloadSha256==='string'&&/^[a-f0-9]{64}$/.test(value.payloadSha256);}
function checkpointIdentity(value){return `${value.rootVersion}:${value.sequence}:${value.payloadSha256}`;}
function observeCheckpoint(value){if(!checkpoint(value)){invalidateFinancePrivateAuthority();return}const next=checkpointIdentity(value);if(next!==currentCheckpointIdentity){currentCheckpointIdentity=next;generation++;}}
function normalize(config){
  if(!config||Object.getPrototypeOf(config)!==Object.prototype)throw new Error('FINANCE_AUTHORITY_V2_WEB_CONFIGURATION_INVALID');
  if(typeof config.trustedClock==='function'&&Object.keys(config).sort().join(',')==='manifest,serverCheckpoint,trustRoot,trustedClock'&&checkpoint(config.serverCheckpoint))return config;
  if(Object.keys(config).sort().join(',')!=='manifest,schemaVersion,serverCheckpoint,trustRoot,trustedTimeMs'||config.schemaVersion!=='ynx-finance-endpoint-authority-browser-config/v1'||!checkpoint(config.serverCheckpoint)||!Number.isSafeInteger(config.trustedTimeMs)||config.trustedTimeMs<0)throw new Error('FINANCE_AUTHORITY_V2_WEB_CONFIGURATION_INVALID');
  const wire=JSON.stringify(config),remembered=normalizedConfigurations.get(config);
  if(remembered?.wire===wire)return remembered.normalized;
  const monotonicStart=performance.now(),anchor=config.trustedTimeMs;
  const normalized=Object.freeze({...config,trustedClock:()=>Math.floor(anchor+Math.max(0,performance.now()-monotonicStart))});
  normalizedConfigurations.set(config,{wire,normalized});return normalized;
}
async function configured(){
  if(globalThis[CONFIG_KEY])return normalize(globalThis[CONFIG_KEY]);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(CONFIG_URL,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
    if([502,503,504].includes(response.status))throw new Error('NETWORK_UNAVAILABLE');
    if(!response.ok||response.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.');
    return normalize(await response.json());
  }catch(error){if(controller.signal.aborted||error?.name==='TypeError')throw new Error('NETWORK_UNAVAILABLE');throw error;}
  finally{clearTimeout(timer);}
}
async function recoverHistory(config,storage,isLive){
  const previous=await storage.read();
  if(previous.sequence+1>=config.manifest.sequence)return;
  if(previous.rootVersion!==config.trustRoot.rootVersion)throw new Error('AUTHORITY_V2_HISTORY_ROOT_MISMATCH');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  const history=[];let position=previous;
  try{
    while(position.sequence+1<config.manifest.sequence){
      if(!isLive())throw new Error('AUTHORITY_V2_SUPERSEDED');
      if(history.length>=64)throw new Error('AUTHORITY_V2_HISTORY_BOUND');
      const query=new URLSearchParams(Object.entries(position).map(([key,value])=>[key,String(value)]));
      const response=await fetch('/api/endpoint-authority/v2/history?'+query,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok||response.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new Error('AUTHORITY_V2_HISTORY_UNAVAILABLE');
      const reader=response.body?.getReader();if(!reader)throw new Error('AUTHORITY_V2_HISTORY_RESPONSE_INVALID');
      let bytes=0;const chunks=[];
      try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384)throw new Error('AUTHORITY_V2_HISTORY_BOUND');chunks.push(value);}}finally{await reader.cancel();}
      const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
      const page=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));
      if(!page||Object.keys(page).sort().join(',')!=='after,manifests,schemaVersion'||page.schemaVersion!=='ynx-finance-endpoint-authority-history/v1'||!checkpoint(page.after)||checkpointIdentity(page.after)!==checkpointIdentity(position)||!Array.isArray(page.manifests)||page.manifests.length<1||page.manifests.length>2)throw new Error('AUTHORITY_V2_HISTORY_RESPONSE_INVALID');
      for(const manifest of page.manifests){
        if(manifest.sequence!==position.sequence+1||manifest.sequence>=config.manifest.sequence||manifest.previousPayloadSha256!==position.payloadSha256||!manifest.integrity||!/^[a-f0-9]{64}$/.test(manifest.integrity.payloadSha256))throw new Error('AUTHORITY_V2_PREDECESSOR');
        history.push(manifest);position={rootVersion:previous.rootVersion,sequence:manifest.sequence,payloadSha256:manifest.integrity.payloadSha256};
      }
    }
    if(!isLive())throw new Error('AUTHORITY_V2_SUPERSEDED');
    await recoverEndpointAuthorityHistory({trustRoot:config.trustRoot,consumer:CONSUMER,storage,clock:()=>{if(!isLive())throw new Error('AUTHORITY_V2_SUPERSEDED');return config.trustedClock();},history,current:config.manifest});
  }finally{clearTimeout(timer);}
}
function makeChannel(onMessage){if(typeof BroadcastChannel!=='function')return {postMessage(){},close(){}};const channel=new BroadcastChannel(CHANNEL);channel.addEventListener('message',onMessage);return channel;}
const invalidationChannel=makeChannel(event=>observeCheckpoint(event.data));
export function assertFinancePrivateAuthority(){
  // One validation owns the fresh trusted-time anchor and durable CAS. Parallel
  // callers must not race independent HTTP anchors against the clock high-water.
  // No result is cached after completion, and the actual rollback fence remains.
  if(authorityOperation)return authorityOperation;
  const hardToken=hardGeneration;
  const validate=()=>{if(hardToken!==hardGeneration)throw new Error('AUTHORITY_V2_SUPERSEDED');return validateFinancePrivateAuthority()};
  const operation=globalThis.navigator?.locks?.request
    ?navigator.locks.request('ynx-finance-endpoint-authority-validation-v2',{mode:'exclusive',signal:AbortSignal.timeout(10000)},validate)
    :Promise.resolve().then(validate);
  authorityOperation=operation;
  operation.then(()=>{if(authorityOperation===operation)authorityOperation=null},()=>{if(authorityOperation===operation)authorityOperation=null});
  return operation;
}
async function validateFinancePrivateAuthority(){
  // Concurrent reads of the same signed authority must not invalidate each
  // other. Only a real cross-tab checkpoint change or explicit invalidation
  // advances this epoch.
  const token=generation,hardToken=hardGeneration,config=await configured();let client;
  const acceptedIdentity=checkpointIdentity({rootVersion:config.trustRoot.rootVersion,sequence:config.manifest.sequence,payloadSha256:config.manifest.integrity.payloadSha256});
  const stillCurrent=()=>hardToken===hardGeneration&&(token===generation||currentCheckpointIdentity===acceptedIdentity);
  const storage=createBrowserAuthorityCheckpointStore({anchor:config.serverCheckpoint,clock:config.trustedClock,onCommit:value=>{observeCheckpoint(value);invalidationChannel.postMessage(value);}});
  client=createEndpointAuthorityClient({trustRoot:config.trustRoot,consumer:CONSUMER,storage,clock:config.trustedClock});
  try{await recoverHistory(config,storage,()=>hardToken===hardGeneration);await client.accept(config.manifest,{source:'remote'});if(!stillCurrent())throw new Error('AUTHORITY_V2_SUPERSEDED');const authority=await client.financeProductSession();if(!stillCurrent())throw new Error('AUTHORITY_V2_SUPERSEDED');if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==CONSUMER.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');return authority;}
  finally{client.invalidate();storage.close();}
}
export function invalidateFinancePrivateAuthority(){hardGeneration++;generation++;currentCheckpointIdentity=null;}
export function financePrivateAuthorityRevision(){return generation;}
