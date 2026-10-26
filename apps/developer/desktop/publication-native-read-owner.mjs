import {readFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openBundledOriginalPublicationProject} from './original-publication-project.mjs';
import {openPublicationObservation} from './artifact-publication-lifecycle.mjs';
import {serviceReadURLs} from './publication-pinned-read-fetch.mjs';
const fail=code=>Object.assign(Error('The original native deployment observation cannot continue.'),{code});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const ordered=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const principalKeys=['account','deviceId','sessionRef','currentRef','accountGeneration','sessionGeneration'];
const projectKeys=['projectId','ownerAccount','currentReference','projectRevision','catalogRevision','runtimeOrigin','read','publish','runtime'];
const snapshot=s=>({principal:Object.fromEntries(principalKeys.map(k=>[k,s?.principal?.[k]])),project:Object.fromEntries(projectKeys.map(k=>[k,s?.project?.[k]])),serviceRegistration:s?.serviceRegistration});
const AUTH_TIME='https://wallet-auth.ynxweb4.com/v2/product-sessions/time';
// Fixed normal imports. No module, session, signer or registry comes from UI.
export function openBundledPublicationReadOwner({context,control,resources}){
 return capturePublicationReadOwner({context,control,
  openProject:assertLocalCurrent=>openBundledOriginalPublicationProject({context,assertLocalCurrent}),
  async load(){
   const metadataURL=new URL('../../../packages/wallet-auth/package.json',import.meta.url),metadata=JSON.parse(await readFile(metadataURL,'utf8'));
   if(metadata.name!=='@ynx-chain/wallet-auth'||metadata.version!=='1.3.0-pq.3.32-auth.48')throw fail('IDE_SDK48_REQUIRED');
   const sdkRoot=await realpath(dirname(fileURLToPath(metadataURL)));
   const target=await realpath(createRequire(metadataURL).resolve('@ynx-chain/wallet-auth/product-wallet-connection'));
   if(!target.startsWith(sdkRoot+sep))throw fail('IDE_SDK48_REQUIRED');
   const sdk=await import(pathToFileURL(target).href);
   const registry=JSON.parse(await readFile(join(sdkRoot,'product-session-registry.json'),'utf8'));
   const {verifyOriginalCloudSDKDistribution}=await import('../scripts/package-original-cloud-sdk.mjs');
   verifyOriginalCloudSDKDistribution(resources);
   const cloudRoot=join(resources,'code','apps','cloud','sdk');
   const [{YNXCloudClient},{observeIDEDeployment}]=await Promise.all([import(pathToFileURL(join(cloudRoot,'index.js'))),import(pathToFileURL(join(cloudRoot,'observe-ide-deployment.mjs')))]);
   const {createPinnedServiceReadFetch}=await import('./publication-pinned-read-fetch.mjs');
   return{createReadClient:sdk.createProductWalletBusinessReadClient,registry,CloudClient:YNXCloudClient,observeIDEDeployment,openObservation:openPublicationObservation,createFetch:createPinnedServiceReadFetch};
  }});
}
// Returns cleanup custody synchronously, before original project/port acquisition.
// Injected functions are backend dependencies, never renderer grants.
export function capturePublicationReadOwner({context,control,openProject,load,now=Date.now}){
 let closed=false,started=false,project,ports,client,observation,opening,cleanup,baseline,deadline,requestSignal;
 const closures=new Map();
 const closeOnce=owner=>{if(!closures.has(owner))closures.set(owner,Promise.resolve().then(()=>owner.close()));return closures.get(owner);};
 const local=Object.freeze({id:context.id,workspace:context.workspace,profile:context.profile});
 const live=()=>{requestSignal?.throwIfAborted();if(closed||Object.keys(local).some(k=>context[k]!==local[k]))throw fail('IDE_PUBLICATION_RETIRED');};
 async function current(requestId){
  live();const actual=await project.readObservationServiceRegistration();live();
  const native=await ports.context();live();
  if(native?.requestId!==requestId||!Number.isSafeInteger(actual?.expiresMS)||!Number.isSafeInteger(native?.source?.expiresMS)||actual.expiresMS<=now()||native.source.expiresMS<=now()||ordered(snapshot(actual))!==ordered(snapshot(native.source)))throw fail('IDE_NATIVE_SERVICE_SCOPE_MISMATCH');
  const fingerprint=ordered(snapshot(actual)),end=Math.min(actual.expiresMS,native.source.expiresMS);
  if(baseline!==undefined&&(fingerprint!==baseline||end<deadline||now()>=deadline))throw fail('IDE_PUBLICATION_RETIRED');
  if(baseline===undefined){baseline=fingerprint;deadline=end;}
  return{actual,native};
 }
 async function begin(requestId){
  live();if(!control||typeof openProject!=='function'||typeof load!=='function')throw fail('IDE_NATIVE_SERVICE_READ_UNAVAILABLE');
  project=await openProject(live);live();ports=control.open(requestId);
  const first=await current(requestId),deps=await load();live();
  const guarded=async start=>{await current(requestId);const value=await start();await current(requestId);return value;};
  const nativeDevice=first.native.device;
  if(!nativeDevice||nativeDevice.id!==first.actual.principal.deviceId||typeof nativeDevice.key!=='string'||!Array.isArray(nativeDevice.scopes))throw fail('IDE_NATIVE_SERVICE_SCOPE_MISMATCH');
  const storage=Object.freeze({securityLevel:'os-protected',get:key=>guarded(()=>ports.get(key)),set:async()=>{throw fail('IDE_READ_ONLY');},remove:async()=>{throw fail('IDE_READ_ONLY');}});
  const device=Object.freeze({...nativeDevice,sign:input=>guarded(()=>ports.sign(input))});
  client=await deps.createReadClient({registry:deps.registry,productId:'developer',platform:'macos',storage,device,gatewayTimeoutMs:5000});live();
  if(typeof client?.createBusinessProof!=='function'||typeof client?.close!=='function'||client.capabilities?.kind!=='existing-native-business-read'||client.capabilities?.identityGrant!==false||client.capabilities?.nativeAdmission!==false||client.capabilities?.connected!==false||client.capabilities?.newSession!==false)throw fail('IDE_SDK48_REQUIRED');
  const network=async url=>{await current(requestId);await ports.authorizeNetwork(url);await current(requestId);};
  const service=first.actual.serviceRegistration,allowed=serviceReadURLs(service,requestId);
  const fetch=deps.createFetch({service,requestId,assertCurrent:()=>current(requestId),assertNetworkApproved:network});
  observation=await deps.openObservation({context,publicationProject:project,endpoint:service.apiEndpoint,fetch,CloudClient:deps.CloudClient,observeIDEDeployment:deps.observeIDEDeployment,
   getDeploymentRequestHeaders:async request=>{
    if(request?.method!=='GET'||request.operationRequestId!==requestId||!allowed.some(url=>url===request.url&&new URL(url).pathname===request.path))throw fail('IDE_READ_ONLY');
    // Native explicit review must independently allow the fixed Auth time GET.
    // Missing/expired/rejected native permission stops before SDK online work.
    await network(AUTH_TIME);
    const proof=await client.createBusinessProof({method:'GET',path:request.path,body:'',requiredScopes:[...service.scopes]});await current(requestId);
    if(typeof proof?.proofHeader!=='string'||proof.proofHeader.length>32768)throw fail('IDE_NATIVE_PROOF_UNAVAILABLE');
    return{'x-ynx-product-session-proof-v2':proof.proofHeader};
   }});live();return observation;
 }
 // Retire the SDK client before awaiting an observation that may itself be
 // waiting for an entered proof. Cleanup custody is retained until all original
 // acquisitions and independently owned resources have drained, including late ones.
 function close(){
  closed=true;
  return cleanup??=Promise.resolve().then(async()=>{
   const early=client?closeOnce(client):undefined;void early?.catch(()=>{});
   await opening?.catch(()=>{});
   let failed=false,cause;const retain=e=>{if(!failed){failed=true;cause=e;}};
   for(const owner of [client,observation,ports,project])if(owner)try{await closeOnce(owner);}catch(error){retain(error);}
   if(failed)throw cause;
  });
 }
 return Object.freeze({
  async resume(requestId,{signal}={}){
   live();if(started||!uuid(requestId))throw fail('IDE_PUBLICATION_RETIRED');
   if(signal!==undefined)Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal);
   signal?.throwIfAborted();requestSignal=signal;started=true;
   // Install custody before the abort listener can initiate cleanup.
   opening=Promise.resolve().then(()=>begin(requestId));
   const abort=()=>{void close().catch(()=>{});};
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   try{const owner=await opening;live();return await owner.resume(requestId,{signal});}
   finally{signal?.removeEventListener('abort',abort);}
  },
  close,
 });
}
