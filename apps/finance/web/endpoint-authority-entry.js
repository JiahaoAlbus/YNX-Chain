import {createEndpointAuthorityClient} from '@ynx-chain/sdk';
import {createBrowserAuthorityCheckpointStore} from './endpoint-authority-store.js';

const CONSUMER=Object.freeze({consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0'});
const CONFIG_KEY='__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__';
const CHANNEL='ynx-finance-endpoint-authority-v2';
let generation=0;
function configured(){const config=globalThis[CONFIG_KEY];if(!config)throw new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.');if(Object.getPrototypeOf(config)!==Object.prototype||Object.keys(config).sort().join(',')!=='manifest,trustRoot,trustedClock'||typeof config.trustedClock!=='function')throw new Error('FINANCE_AUTHORITY_V2_WEB_CONFIGURATION_INVALID');return config;}
function makeChannel(onMessage){if(typeof BroadcastChannel!=='function')return {postMessage(){},close(){}};const channel=new BroadcastChannel(CHANNEL);channel.addEventListener('message',onMessage);return channel;}
const invalidationChannel=makeChannel(()=>{generation++;});
export async function assertFinancePrivateAuthority(){
  const token=++generation,config=configured();let client;
  const storage=createBrowserAuthorityCheckpointStore({anchor:config.trustRoot.anchor,clock:config.trustedClock,onCommit:checkpoint=>invalidationChannel.postMessage({sequence:checkpoint.sequence,payloadSha256:checkpoint.payloadSha256})});
  client=createEndpointAuthorityClient({trustRoot:config.trustRoot,consumer:CONSUMER,storage,clock:config.trustedClock});
  try{await client.accept(config.manifest,{source:'remote'});if(token!==generation)throw new Error('AUTHORITY_V2_SUPERSEDED');const authority=await client.financeProductSession();if(token!==generation)throw new Error('AUTHORITY_V2_SUPERSEDED');if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==CONSUMER.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');return authority;}
  finally{client.invalidate();storage.close();}
}
export function invalidateFinancePrivateAuthority(){generation++;}
export function financePrivateAuthorityRevision(){return generation;}
