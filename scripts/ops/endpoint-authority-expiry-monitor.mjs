// Read-only expiry/source/checkpoint handoff. Never issues or activates authority.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySignedEndpointAuthority,canonicalAuthorityV2} from '../../sdk/js/endpoint-authority-v2.js';
const CONFIG_URL='https://finance.ynxweb4.com/api/endpoint-authority/v2/config';
export function authorityExpiryHandoff(config,{nowMs=Date.now(),verified=false,httpStatus=null}={}){
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new Error('MONITOR_CLOCK_REQUIRED');
  const m=config?.manifest,root=config?.trustRoot;
  const expiresAt=m?.expiresAt,expiry=Date.parse(expiresAt);
  if(!Number.isFinite(expiry)||!Number.isSafeInteger(m?.sequence)||m.sequence<1||!/^[a-f0-9]{64}$/.test(m.integrity?.payloadSha256??''))throw new Error('MONITOR_PUBLIC_METADATA_REQUIRED');
  const key=root?.keys?.find(k=>k.keyId===m.integrity.keyId),keyExpiry=Date.parse(key?.notAfter);
  if(!Number.isFinite(keyExpiry))throw new Error('MONITOR_PUBLIC_KEY_METADATA_REQUIRED');
  if(!Number.isSafeInteger(root?.rootVersion)||root.rootVersion<1)throw new Error('MONITOR_ROOT_METADATA_REQUIRED');
  const source=s=>s?{commit:/^[a-f0-9]{40}$/.test(s.commit??'')?s.commit:null,tree:/^[a-f0-9]{40}$/.test(s.tree??'')?s.tree:null,repository:s.repository==='https://github.com/JiahaoAlbus/YNX-Chain'?s.repository:null}:null;
  const remainingSeconds=Math.floor((expiry-nowMs)/1000),keyRemainingSeconds=Math.floor((keyExpiry-nowMs)/1000),remaining=Math.min(remainingSeconds,keyRemainingSeconds);
  const alert=remaining<=0?'EXPIRED':remaining<=300?'DUE_WITHIN_300_SECONDS':remaining<=900?'DUE_WITHIN_900_SECONDS':'CURRENT_WINDOW';
  return {status:verified?alert:'CONFIG_UNAVAILABLE',expiryAlert:alert,publicSignatureCurrentlyVerified:verified,httpStatus,observedAt:new Date(nowMs).toISOString(),expiresAt:new Date(expiry).toISOString(),remainingSeconds,keyNotAfter:new Date(keyExpiry).toISOString(),keyRemainingSeconds,rootVersion:root.rootVersion,sequence:m.sequence,payloadSha256:m.integrity.payloadSha256,gatewaySource:source(m.endpoints?.walletGateway?.evidence?.source),financeFrontendSource:source(m.products?.finance?.evidence?.source),metadataClass:verified?'CURRENT_VERIFIED_PUBLIC_CONFIG':'LAST_KNOWN_PUBLIC_METADATA_ONLY',handoffRequired:!verified||remaining<=900,requiredReviewInputs:['fresh actual runtime/web bytes and separate Go source','actual host registry and product definition','callback contract digest','contract-only acceptance receipt with unverified QA cells','accepted checkpoint and exact unsigned canonical payload'],canSign:false,canActivate:false,automaticRenewal:false,stableMaintenanceCompleted:false};
}
export async function observePublicReleaseSources({fetchImpl=fetch}={}){
  const observations=[];
  for(const [origin,route,kind] of [['https://wallet-auth.ynxweb4.com','/version','gateway'],['https://finance.ynxweb4.com','/health','finance-go'],...['/','/app.js','/wallet-auth.js'].map(route=>['https://finance.ynxweb4.com',route,'web-bytes'])]){
    const row={origin,path:route,status:null};
    try{const r=await fetchImpl(origin+route,{signal:AbortSignal.timeout(5000),redirect:'error'});row.status=r.status;if(r.status!==200)throw Error('UNAVAILABLE');const b=Buffer.from(await r.arrayBuffer());if(b.length>1048576)throw Error('OVERSIZE');row.bytes=b.length;row.sha256=createHash('sha256').update(b).digest('hex');if(kind!=='web-bytes'){const j=JSON.parse(b);const commit=kind==='gateway'?j.build?.sourceCommit:j.build?.commit;row.actualBuildCommit=/^[a-f0-9]{40}$/.test(commit??'')?commit:null;}row.observed=true;}catch{row.observed=false;}observations.push(row);
  }
  return observations;
}
export async function readAuthorityExpiry({trustRoot,checkpoint,lastKnownConfig,fetchImpl=fetch,nowMs=Date.now()}={}){
  let status=null;
  try{
    const r=await fetchImpl(CONFIG_URL,{signal:AbortSignal.timeout(5000),redirect:'error'});status=r.status;
    if(status!==200)throw new Error('MONITOR_CONFIG_UNAVAILABLE');
    const config=await r.json();
    if(canonicalAuthorityV2(config.trustRoot)!==canonicalAuthorityV2(trustRoot))throw new Error('MONITOR_TRUST_ROOT_DRIFT');
    const manifest=await verifySignedEndpointAuthority(config.manifest,{trustRoot,checkpoint,consumer:{consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0'},nowMs});
    const accepted={rootVersion:trustRoot.rootVersion,sequence:manifest.sequence,payloadSha256:manifest.integrity.payloadSha256};
    if(canonicalAuthorityV2(config.serverCheckpoint)!==canonicalAuthorityV2(accepted))throw new Error('MONITOR_CHECKPOINT_MISMATCH');
    const result=authorityExpiryHandoff(config,{nowMs,verified:true,httpStatus:status});
    result.publicReleaseObservations=await observePublicReleaseSources({fetchImpl});
    const gateway=result.publicReleaseObservations.find(x=>x.path==='/version');const go=result.publicReleaseObservations.find(x=>x.path==='/health');
    result.gatewayActualCommitMatchesSignedEvidence=gateway?.observed===true&&gateway.actualBuildCommit===result.gatewaySource?.commit;
    result.financeGoActualCommitMatchesIssuer=go?.observed===true&&go.actualBuildCommit===manifest.issuerSource?.commit;
    result.freshWebBytesRequireIndependentSourceComparison=true;result.handoffRequired||=!result.gatewayActualCommitMatchesSignedEvidence||!result.financeGoActualCommitMatchesIssuer||result.publicReleaseObservations.some(x=>!x.observed);
    return result;
  }catch{
    // Historical metadata can alert on expiry; it never bypasses current verification.
    if(lastKnownConfig)return authorityExpiryHandoff(lastKnownConfig,{nowMs,verified:false,httpStatus:status});
    return {status:'CONFIG_UNAVAILABLE',httpStatus:status,publicSignatureCurrentlyVerified:false,handoffRequired:true,canSign:false,canActivate:false,automaticRenewal:false,stableMaintenanceCompleted:false};
  }
}
export async function runExpiryMonitor(argv){
  const opts={};
  for(let i=0;i<argv.length;i+=2){if(!['--trust-root','--checkpoint','--last-known-config'].includes(argv[i])||!argv[i+1]||opts[argv[i]])throw new Error('MONITOR_ARGUMENTS');opts[argv[i]]=argv[i+1];}
  if(!opts['--trust-root']||!opts['--checkpoint'])throw new Error('MONITOR_TRUST_CONTEXT_REQUIRED');
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  return readAuthorityExpiry({trustRoot:read(opts['--trust-root']),checkpoint:read(opts['--checkpoint']),lastKnownConfig:opts['--last-known-config']?read(opts['--last-known-config']):undefined});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runExpiryMonitor(process.argv.slice(2))));}
  catch{console.error(JSON.stringify({status:'MONITOR_INPUT_ERROR',canSign:false,canActivate:false}));process.exitCode=1;}
}
