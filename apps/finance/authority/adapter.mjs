import {createEndpointAuthorityClient} from '../../../sdk/js/endpoint-authority-v2.js';
import {endpointAuthorityConsumer,loadFinanceAuthorityConfig} from './config.mjs';
import {createNodeCheckpointStore,readAuthorityJSON,readTrustedTimeFile} from './checkpoint-node.mjs';
import {sampleFinanceTrustedClock} from './trusted-time.mjs';

async function prepareClock(config,trustRoot,clockSource){
  let previous=0;
  try{previous=await readTrustedTimeFile(config.trustedTimeFile)}catch(error){if(error?.code!=='ENOENT')throw error}
  // Inspect the existing append-only checkpoint before a fresh sample can
  // replace a rolled-back local time file. The first live sample bootstraps it.
  await createNodeCheckpointStore({file:config.checkpointFile,anchor:trustRoot.anchor,trustedClockMs:previous}).inspect();
  return clockSource(config.trustedTimeFile);
}

export async function resolveFinancePrivateAuthority({env=process.env,clockSource=sampleFinanceTrustedClock}={}){
  const config=loadFinanceAuthorityConfig(env);
  if(!config.enabled)throw Object.assign(new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.'),{code:config.reason});
  const [trustRoot,manifest]=await Promise.all([
    readAuthorityJSON(config.trustRootFile),readAuthorityJSON(config.manifestFile),
  ]);
  const trusted=await prepareClock(config,trustRoot,clockSource);
  const storage=createNodeCheckpointStore({file:config.checkpointFile,anchor:trustRoot.anchor,trustedClockMs:trusted.lowerAtReceive});
  const consumer=endpointAuthorityConsumer('server');
  const client=createEndpointAuthorityClient({trustRoot,consumer,storage,clock:trusted.clock});
  await client.accept(manifest,{source:'remote'});
  const authority=await client.financeProductSession();
  if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==consumer.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');
  return authority;
}

export async function resolveFinanceBrowserAuthorityConfig({env=process.env,clockSource=sampleFinanceTrustedClock}={}){
  const config=loadFinanceAuthorityConfig(env);
  if(!config.enabled)throw Object.assign(new Error('PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured. Standard Wallet and public Finance remain available.'),{code:config.reason});
  const [trustRoot,manifest]=await Promise.all([
    readAuthorityJSON(config.trustRootFile),readAuthorityJSON(config.manifestFile),
  ]);
  const trusted=await prepareClock(config,trustRoot,clockSource);
  const storage=createNodeCheckpointStore({file:config.checkpointFile,anchor:trustRoot.anchor,trustedClockMs:trusted.lowerAtReceive});
  const consumer=endpointAuthorityConsumer('web');
  const client=createEndpointAuthorityClient({trustRoot,consumer,storage,clock:trusted.clock});
  try{
    await client.accept(manifest,{source:'remote'});
    const authority=await client.financeProductSession();
    if(authority.walletGateway!=='https://wallet-auth.ynxweb4.com'||authority.financeOrigin!==consumer.origin||authority.officialSandboxVerified!==false||authority.providerVerified!==false||authority.productionApproved!==false)throw new Error('FINANCE_AUTHORITY_V2_SCOPE_INVALID');
    const persisted=await storage.inspect();
    return Object.freeze({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',trustRoot,manifest,serverCheckpoint:persisted.checkpoint,trustedTimeMs:trusted.clock()});
  }finally{client.invalidate();}
}
