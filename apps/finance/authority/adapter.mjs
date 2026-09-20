import {createEndpointAuthorityClient} from '../../../sdk/js/endpoint-authority-v2.js';
import {endpointAuthorityConsumer,loadFinanceAuthorityConfig} from './config.mjs';
import {createNodeCheckpointStore,readAuthorityJSON,readTrustedTimeFile} from './checkpoint-node.mjs';

export async function resolveFinancePrivateAuthority({env=process.env}={}){
  const config=loadFinanceAuthorityConfig(env);
  if(!config.enabled)throw Object.assign(new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.'),{code:config.reason});
  const [trustRoot,manifest,trustedClockMs]=await Promise.all([
    readAuthorityJSON(config.trustRootFile),readAuthorityJSON(config.manifestFile),readTrustedTimeFile(config.trustedTimeFile),
  ]);
  const storage=createNodeCheckpointStore({file:config.checkpointFile,anchor:trustRoot.anchor,trustedClockMs});
  const consumer=endpointAuthorityConsumer('server');
  const client=createEndpointAuthorityClient({trustRoot,consumer,storage,clock:()=>trustedClockMs});
  await client.accept(manifest,{source:'remote'});
  const authority=await client.financeProductSession();
  if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==consumer.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');
  return authority;
}

export async function resolveFinanceBrowserAuthorityConfig({env=process.env}={}){
  const config=loadFinanceAuthorityConfig(env);
  if(!config.enabled)throw Object.assign(new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.'),{code:config.reason});
  const [trustRoot,manifest,trustedClockMs]=await Promise.all([
    readAuthorityJSON(config.trustRootFile),readAuthorityJSON(config.manifestFile),readTrustedTimeFile(config.trustedTimeFile),
  ]);
  const storage=createNodeCheckpointStore({file:config.checkpointFile,anchor:trustRoot.anchor,trustedClockMs});
  const consumer=endpointAuthorityConsumer('web');
  const client=createEndpointAuthorityClient({trustRoot,consumer,storage,clock:()=>trustedClockMs});
  try{
    await client.accept(manifest,{source:'remote'});
    const authority=await client.financeProductSession();
    if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==consumer.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');
    const persisted=await storage.inspect();
    return Object.freeze({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',trustRoot,manifest,serverCheckpoint:persisted.checkpoint,trustedTimeMs:trustedClockMs});
  }finally{client.invalidate();}
}
