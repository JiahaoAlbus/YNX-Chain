import fs from 'node:fs/promises';
import path from 'node:path';
import {createEndpointAuthorityClient,verifySignedEndpointAuthority,canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';
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

export async function resolveFinanceBrowserAuthorityHistory({after,env=process.env,clockSource=sampleFinanceTrustedClock}={}){
  if(!after||Object.keys(after).sort().join(',')!=='payloadSha256,rootVersion,sequence'||!Number.isSafeInteger(after.rootVersion)||after.rootVersion<1||!Number.isSafeInteger(after.sequence)||after.sequence<0||!/^[a-f0-9]{64}$/.test(after.payloadSha256))throw new Error('FINANCE_AUTHORITY_V2_HISTORY_QUERY_INVALID');
  const config=loadFinanceAuthorityConfig(env),current=await resolveFinanceBrowserAuthorityConfig({env,clockSource});
  if(after.rootVersion!==current.trustRoot.rootVersion||after.sequence>=current.manifest.sequence)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_QUERY_INVALID');
  // The manifest archive must share the original protected checkpoint directory.
  // inspect() above has validated every ancestor, owner, mode and journal.
  const directory=path.dirname(config.manifestFile);
  if(directory!==path.dirname(config.checkpointFile))throw new Error('FINANCE_AUTHORITY_V2_HISTORY_DIRECTORY_INVALID');
  const selected=new Map();let candidates=0,entries=0;const started=performance.now();
  // Bound directory work separately from the two-document response. Unrelated
  // old archives are never opened or charged to the response byte limit.
  for await(const entry of await fs.opendir(directory)){
    if(++entries>16384||performance.now()-started>500)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_SCAN_BOUND');
    const name=entry.name,manual=/^signed-manifest-seq([1-9][0-9]*)[a-zA-Z0-9.-]*\.json$/.exec(name),maintenance=/^signed-maintenance-seq-([1-9][0-9]*)-[a-f0-9]{64}\.json$/.exec(name);
    const fileSequence=name==='signed-manifest.json'?1:Number((manual??maintenance)?.[1]);
    if(!Number.isSafeInteger(fileSequence)||fileSequence<=after.sequence||fileSequence>=current.manifest.sequence||fileSequence>after.sequence+2)continue;
    if(++candidates>8)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_BOUND');
    const document=await readAuthorityJSON(path.join(directory,name));
    if(document.sequence!==fileSequence)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_FILE_VERSION');
    const old=selected.get(document.sequence);
    if(old&&canonicalAuthorityV2(old)!==canonicalAuthorityV2(document))throw new Error('FINANCE_AUTHORITY_V2_HISTORY_CONFLICT');
    selected.set(document.sequence,document);
  }
  const manifests=[];let position=after;
  const end=Math.min(after.sequence+2,current.manifest.sequence-1);
  for(let sequence=after.sequence+1;sequence<=end;sequence++){
    const document=selected.get(sequence);if(!document)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_MISSING');
    const issued=Date.parse(document.issuedAt);if(!Number.isSafeInteger(issued)||issued>current.trustedTimeMs)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_FUTURE');
    await verifySignedEndpointAuthority(document,{trustRoot:current.trustRoot,consumer:endpointAuthorityConsumer('web'),checkpoint:position,nowMs:issued});
    manifests.push(document);position={rootVersion:current.trustRoot.rootVersion,sequence,payloadSha256:document.integrity.payloadSha256};
  }
  const result={schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests};
  if(Buffer.byteLength(JSON.stringify(result))>16384)throw new Error('FINANCE_AUTHORITY_V2_HISTORY_BOUND');
  return result;
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
