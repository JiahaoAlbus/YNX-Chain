import {createEndpointAuthorityClient} from '@ynx-chain/sdk';
import {createBrowserAuthorityCheckpointStore} from './endpoint-authority-store.js';

const CONSUMER=Object.freeze({consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0'});
const CONFIG_KEY='__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__';
const CONFIG_URL='/api/endpoint-authority/v2/config';
const CHANNEL='ynx-finance-endpoint-authority-v2';
let generation=0;
function checkpoint(value){return value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')==='payloadSha256,rootVersion,sequence'&&Number.isSafeInteger(value.rootVersion)&&value.rootVersion>0&&Number.isSafeInteger(value.sequence)&&value.sequence>=0&&typeof value.payloadSha256==='string'&&/^[a-f0-9]{64}$/.test(value.payloadSha256);}
function normalize(config){
  if(!config||Object.getPrototypeOf(config)!==Object.prototype)throw new Error('FINANCE_AUTHORITY_V2_WEB_CONFIGURATION_INVALID');
  if(typeof config.trustedClock==='function'&&Object.keys(config).sort().join(',')==='manifest,serverCheckpoint,trustRoot,trustedClock'&&checkpoint(config.serverCheckpoint))return config;
  if(Object.keys(config).sort().join(',')!=='manifest,schemaVersion,serverCheckpoint,trustRoot,trustedTimeMs'||config.schemaVersion!=='ynx-finance-endpoint-authority-browser-config/v1'||!checkpoint(config.serverCheckpoint)||!Number.isSafeInteger(config.trustedTimeMs)||config.trustedTimeMs<0)throw new Error('FINANCE_AUTHORITY_V2_WEB_CONFIGURATION_INVALID');
  const monotonicStart=performance.now(),anchor=config.trustedTimeMs;
  return Object.freeze({...config,trustedClock:()=>Math.floor(anchor+Math.max(0,performance.now()-monotonicStart))});
}
async function configured(){
  if(globalThis[CONFIG_KEY])return normalize(globalThis[CONFIG_KEY]);
  let response;
  try{response=await fetch(CONFIG_URL,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});}catch{throw new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.');}
  if(!response.ok||response.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.');
  return normalize(await response.json());
}
function makeChannel(onMessage){if(typeof BroadcastChannel!=='function')return {postMessage(){},close(){}};const channel=new BroadcastChannel(CHANNEL);channel.addEventListener('message',onMessage);return channel;}
const invalidationChannel=makeChannel(()=>{generation++;});
export async function assertFinancePrivateAuthority(){
  // Concurrent reads of the same signed authority must not invalidate each
  // other. Only a real cross-tab checkpoint change or explicit invalidation
  // advances this epoch.
  const token=generation,config=await configured();let client;
  const storage=createBrowserAuthorityCheckpointStore({anchor:config.serverCheckpoint,clock:config.trustedClock,onCommit:checkpoint=>invalidationChannel.postMessage({sequence:checkpoint.sequence,payloadSha256:checkpoint.payloadSha256})});
  client=createEndpointAuthorityClient({trustRoot:config.trustRoot,consumer:CONSUMER,storage,clock:config.trustedClock});
  try{await client.accept(config.manifest,{source:'remote'});if(token!==generation)throw new Error('AUTHORITY_V2_SUPERSEDED');const authority=await client.financeProductSession();if(token!==generation)throw new Error('AUTHORITY_V2_SUPERSEDED');if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==CONSUMER.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');return authority;}
  finally{client.invalidate();storage.close();}
}
export function invalidateFinancePrivateAuthority(){generation++;}
export function financePrivateAuthorityRevision(){return generation;}
