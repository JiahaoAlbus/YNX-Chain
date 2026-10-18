#!/usr/bin/env node
import {loadCentralOIDCConfiguration} from '../src/central-oidc-provider.js';
import {loadOriginalAuthSourceCurrentService,handleOriginalAuthSourceCurrent} from '../src/original-auth-identity-source-current.js';
import {loadCentralBackendConfiguration} from '../src/central-browser-backend-auth.js';
import { readFileSync, lstatSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJSON, exactFields } from "../src/canonical.js";
import { forwardedClient, GatewayAdmissionController } from "../src/gateway-admission.js";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {buildOriginalHostPublisherOptions,bindOriginalHostReturnPublisher} from '../native/policy-revocation-source-r35-20261018/source/service-publisher.mjs';
import {createOriginalWalletRuntimeObserverLifetime} from './original-wallet-runtime-observer-launcher.mjs';
import {openOriginalWalletPrivateServiceAfterListen,beginOriginalWalletPrivateServiceAcquisition as beginOriginalWalletServicePrivateDispatchAcquisition,closeOriginalWalletPrivateServiceAcquisition as closeOriginalWalletServicePrivateDispatchAcquisition,originalWalletPrivateServiceAcquisitionStatus as originalWalletServicePrivateDispatchAcquisitionStatus} from './original-wallet-private-service-launcher.mjs';
import {ProductSessionControlNodeHost} from '../src/product-session-control-node-host.js';
import {parseProductSessionControlCapacityPolicy} from '../src/product-session-control-capacity.js';
import {createCentralBrowserSessionRegistry} from '../src/central-browser-session-registry.js';
import {CentralBrowserSessionStore} from '../src/central-browser-session-store.js';
import {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes} from '../src/central-browser-session.js';

const address=process.env.YNX_WALLET_GATEWAY_HTTP_ADDR??"127.0.0.1";
const port=integer(process.env.YNX_WALLET_GATEWAY_HTTP_PORT??"6439","YNX_WALLET_GATEWAY_HTTP_PORT",1,65535);
const statePath=process.env.YNX_WALLET_GATEWAY_STATE_PATH;
const remoteDeployed=boolean(process.env.YNX_WALLET_GATEWAY_REMOTE_DEPLOYED??"false","YNX_WALLET_GATEWAY_REMOTE_DEPLOYED");
const build=buildIdentity(process.env);
const registryPath=process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH?resolve(process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH):fileURLToPath(new URL("../central-registry.json",import.meta.url));
const productSessionRegistryPath=process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH?resolve(process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH):fileURLToPath(new URL('../product-session-registry.json',import.meta.url));
const productSessionStateVersion=process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION??'2';
if(!['2','3'].includes(productSessionStateVersion))throw new Error('YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION must be 2 or 3');
if(productSessionStateVersion==='3'&&!process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH)throw new Error('version-three Product Session startup requires an explicit migrated state path');
const capacityPolicy=productSessionStateVersion==='3'?parseProductSessionControlCapacityPolicy(process.env.YNX_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY===undefined?undefined:JSON.parse(process.env.YNX_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY)):undefined;
const productSessionStatePath=process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH?resolve(process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH):`${statePath}.product-session-v2`;
const centralBrowser=boolean(process.env.YNX_CENTRAL_BROWSER_SSO??'false','YNX_CENTRAL_BROWSER_SSO');
const ecosystemIdentity=boolean(process.env.YNX_CENTRAL_BROWSER_ECOSYSTEM??'false','YNX_CENTRAL_BROWSER_ECOSYSTEM');
const businessRevalidation=boolean(process.env.YNX_PRODUCT_BUSINESS_REVALIDATION??'false','YNX_PRODUCT_BUSINESS_REVALIDATION');
const privateBusinessRevalidation=boolean(process.env.YNX_PRIVATE_BUSINESS_REVALIDATION??'false','YNX_PRIVATE_BUSINESS_REVALIDATION');
const privateRegistrationFile=process.env.YNX_PRIVATE_BUSINESS_REGISTRATION_FILE;
if((ecosystemIdentity||businessRevalidation||privateBusinessRevalidation)&&!centralBrowser)throw new Error('Business and ecosystem adoption require explicit Central routes');
if(Boolean(privateRegistrationFile)!==privateBusinessRevalidation)throw new Error('Private business adoption requires an explicit protected registration file');
if(productSessionStateVersion==='3'&&(businessRevalidation||privateBusinessRevalidation)&&ProductSessionControlNodeHost.businessRevalidationSupported!==true)throw new Error('Version-three business revalidation requires an explicit supported control-host capability; do not ignore adoption flags');

if(address!=="127.0.0.1"&&address!=="::1"&&address!=="localhost"&&!(isIP(address)&&address.startsWith("127.")))throw new Error("YNX_WALLET_GATEWAY_HTTP_ADDR must be loopback");
if(!statePath)throw new Error("YNX_WALLET_GATEWAY_STATE_PATH is required");
if(remoteDeployed&&!build)throw new Error("remote deployment requires YNX_WALLET_GATEWAY_SOURCE_COMMIT, YNX_WALLET_GATEWAY_RELEASE and YNX_WALLET_GATEWAY_BUILD_TIME");
if(remoteDeployed&&(!process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH||!process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH))throw new Error('remote deployment requires explicit YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH and YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH');
if(remoteDeployed){
  // Adoption is not initialization: the deployed product's history must exist
  // before either host can write. The original host validates its full schema.
  const existing=lstatSync(productSessionStatePath);
  if(!existing.isFile()||existing.isSymbolicLink()||existing.size===0)throw new Error('remote deployment requires existing valid Product Session state');
  JSON.parse(readFileSync(productSessionStatePath,'utf8'));
}
if(resolve(statePath)===productSessionStatePath)throw new Error('Legacy and Product Session state paths must be separate');
const registry=JSON.parse(readFileSync(registryPath,"utf8"));
const emitEvent=event=>process.stdout.write(`${canonicalJSON(event)}\n`);
const deployment=build?{build,remoteDeployed}:{remoteDeployed};
const host=new CanonicalWalletGatewayNodeHost(registry,{emitEvent,statePath,now:()=>new Date()},deployment);
const productRegistry=JSON.parse(readFileSync(productSessionRegistryPath,'utf8'));
const ProductHost=productSessionStateVersion==='3'?ProductSessionControlNodeHost:ProductSessionGatewayNodeHost;
const originalAuthSourceStartup=loadOriginalAuthSourceCurrentService();
if(originalAuthSourceStartup?.partial){
 let cleanupCause,cleanupCausePresent=false;
 try{originalAuthSourceStartup.partial.retire();originalAuthSourceStartup.partial.join();originalAuthSourceStartup.partial.close();}catch(cause){cleanupCause=cause;cleanupCausePresent=true;}
 // Preserve original partial custody and even falsy close failure; never
 // compress it into a disposable startup error or retry the acquisition.
 const failure=new Error('AUTH_SOURCE_CURRENT_STARTUP_FAILED',{cause:originalAuthSourceStartup.error});
 Object.assign(failure,{partial:originalAuthSourceStartup.partial,cleanupCausePresent,cleanupCause});throw failure;
}
const originalAuthSourceCurrent=originalAuthSourceStartup;
const originalProductHostOptions={statePath:productSessionStatePath,now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url'),...(productSessionStateVersion==='3'?{capacityPolicy}:{authIdentitySourceCurrent:originalAuthSourceCurrent})};
const productHostOptions=productSessionStateVersion==='2'?{
 ...originalProductHostOptions,
 ...buildOriginalHostPublisherOptions(productRegistry,{statePath:originalProductHostOptions.statePath,now:originalProductHostOptions.now,tokenFactory:originalProductHostOptions.tokenFactory})
}:originalProductHostOptions;
const productHost=new ProductHost(productRegistry,productHostOptions);
// Separate identity-only history; never migrate/reset either existing product
// state format or its clock/nonce/control high-water marks to enable SSO.
if(!centralBrowser&&process.env.YNX_CENTRAL_OIDC_CONFIG_FILE)throw new Error('OIDC requires explicit Central browser adoption');
const central=centralBrowser?new CentralBrowserSessionNodeRoutes(new CentralBrowserSessionAuthority(createCentralBrowserSessionRegistry(productRegistry,{ecosystem:ecosystemIdentity}),new CentralBrowserSessionStore(`${productSessionStatePath}.browser`),{...loadCentralBackendConfiguration(process.env.YNX_CENTRAL_BROWSER_BACKEND_CONFIG_FILE),oidc:loadCentralOIDCConfiguration(process.env.YNX_CENTRAL_OIDC_CONFIG_FILE),businessRevalidation,privateBusinessRevalidation,privateProductRegistry:productRegistry,privateBackendRegistrations:privateBusinessRevalidation?loadPrivateRegistrations(privateRegistrationFile):[],productRevalidator:(session,scopes,productId,at)=>productHost.revalidate(session,scopes,productId,at,businessRevalidation||privateBusinessRevalidation)})):null;
const admission=new GatewayAdmissionController({maxConcurrent:integer(process.env.YNX_WALLET_GATEWAY_MAX_CONCURRENT??"64","YNX_WALLET_GATEWAY_MAX_CONCURRENT",1,1024),maxPerWindow:integer(process.env.YNX_WALLET_GATEWAY_RATE_LIMIT??"300","YNX_WALLET_GATEWAY_RATE_LIMIT",1,100000)});
const legacyHandler=host.handler(),productHandler=productHost.handler();
const gatewayHandler=async(request,response)=>{
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  if(path==='/v1/auth-identity/source-current'){
    if(!originalAuthSourceCurrent){response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});response.end('{"error":"AUTH_SOURCE_CURRENT_SERVICE_NOT_CONFIGURED"}');return;}
    const result=handleOriginalAuthSourceCurrent(originalAuthSourceCurrent,request.method,request.url);response.writeHead(result.status,result.headers);response.end(result.body);return;
  }
  if(central?.handles(path)){
    let body='';if(request.method==='POST'){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>16384)throw new Error('Central browser body exceeds policy');chunks.push(chunk)}body=Buffer.concat(chunks).toString('utf8');}
    const result=central.handle({method:request.method,url:request.url,headers:request.headers,body});response.writeHead(result.status,result.headers);response.end(result.body);return;
  }
  return request.url?.startsWith('/v2/product-sessions/')?productHandler(request,response):legacyHandler(request,response);
};
const server=productSessionStateVersion==='2'
 ?productHost.createOriginalWalletServiceRuntimeDaemonServer({legacyHost:host,central,admission,emitEvent})
 :createServer((request,response)=>{const ticket=admission.enter(forwardedClient(request));if(!ticket.ok){response.writeHead(ticket.status,{"cache-control":"no-store","content-type":"application/json; charset=utf-8","retry-after":"60"});response.end(canonicalJSON({error:{code:ticket.code,message:"Wallet Gateway admission policy rejected the request"},ok:false}));return}response.once("finish",ticket.release);response.once("close",ticket.release);Promise.resolve(gatewayHandler(request,response)).catch(error=>{ticket.release();if(!response.headersSent){response.writeHead(500,{"cache-control":"no-store","content-type":"application/json; charset=utf-8"});response.end(canonicalJSON({error:{code:"INTERNAL_ERROR",message:"Wallet Gateway request failed"},ok:false}))}emitEvent({at:new Date().toISOString(),error:error instanceof Error?error.message:"unknown",event:"handler_error",level:"error",service:"ynx-wallet-gatewayd"})})});
let originalReturnPublisher=null; // Main-only original Host binding, never a public metadata route.
const originalRuntimeLifetime=createOriginalWalletRuntimeObserverLifetime(productHost,server);
// The fixed original Native acquisition owns its actual service-role Source.
// No borrowed joint, fd4 discovery, ENV/provider selector or caller DTO is used.
let originalPrivateDispatch=null;
const originalPrivateAcquisition=beginOriginalWalletServicePrivateDispatchAcquisition();
let originalOwnerDrain=null,originalServerClosed=false;
let originalPrivateTerminalUnknown=false;
let originalListenSucceeded=false,originalStartupCause,originalStartupFailure=false;
let originalShutdown=null,originalObserverFailure=false,originalObserverCause,originalHTTPFailure=false,originalHTTPCause;
const originalRequestListener=server.listeners('request')[0];
let originalHTTPRetired=false;
function retireOriginalHTTP(){
 if(originalHTTPRetired)return;originalHTTPRetired=true;
 // Remove only our own original dispatch, not a foreign replacement.
 server.removeListener('request',originalRequestListener);
 server.on('request',(_request,response)=>{response.writeHead(503,{'cache-control':'no-store','content-type':'application/json; charset=utf-8'});response.end(canonicalJSON({ok:false,error:{code:'SERVICE_RETIRED',message:'Wallet Gateway is retiring'}}));});
}
function drainOriginalOwners(){
 if(originalOwnerDrain)return originalOwnerDrain;
 originalOwnerDrain=Promise.resolve().then(async()=>{
  let privateFailure=false,privateCause;
  const cleanup=async action=>{try{await action();}catch(cause){if(!privateFailure){privateFailure=true;privateCause=cause;}}};
  await cleanup(()=>{if(originalReturnPublisher)originalReturnPublisher.retire();});
  await cleanup(()=>{if(originalPrivateDispatch)originalPrivateDispatch.retire();});
  await cleanup(async()=>{if(originalReturnPublisher)await originalReturnPublisher.join();});
  await cleanup(async()=>{if(originalReturnPublisher)await originalReturnPublisher.close();});
  await cleanup(()=>{if(originalAuthSourceCurrent)originalAuthSourceCurrent.retire();});
  await cleanup(async()=>{if(originalPrivateDispatch)await originalPrivateDispatch.join();});
  await cleanup(()=>closeOriginalWalletServicePrivateDispatchAcquisition(originalPrivateAcquisition));
  originalPrivateTerminalUnknown=true;
  await cleanup(()=>{const status=originalWalletServicePrivateDispatchAcquisitionStatus(originalPrivateAcquisition);originalPrivateTerminalUnknown=status.unknown;if(status.businessFailurePresent&&!originalStartupFailure)originalStartupFailure=true;});
  await cleanup(()=>originalRuntimeLifetime.join());
  await cleanup(()=>originalRuntimeLifetime.close());
  await cleanup(()=>{if(originalAuthSourceCurrent)originalAuthSourceCurrent.join();});
  await cleanup(()=>{if(originalAuthSourceCurrent)originalAuthSourceCurrent.close();});
  if(privateFailure)throw privateCause;
 });return originalOwnerDrain;
}
function stopOriginalDaemon(reason){
 if(originalShutdown)return originalShutdown;
 if(originalReturnPublisher)originalReturnPublisher.retire();
 try{if(originalPrivateDispatch)originalPrivateDispatch.retire();}catch(cause){if(!originalStartupFailure){originalStartupCause=cause;originalStartupFailure=true;}process.exitCode=1;}
 originalRuntimeLifetime.retire();retireOriginalHTTP();
 // Reserve both independent completions before any foreign callback.
 originalShutdown=Promise.resolve().then(async()=>{
  const http=Promise.resolve().then(()=>originalServerClosed?undefined:new Promise((resolve,reject)=>server.close(error=>{
   if(error&&!(error.code==='ERR_SERVER_NOT_RUNNING'&&!server.listening))reject(error);else resolve();
  }))).catch(cause=>{originalHTTPFailure=true;originalHTTPCause=cause;});
  const observer=drainOriginalOwners().catch(cause=>{originalObserverFailure=true;originalObserverCause=cause;});
  await Promise.all([http,observer]);
  const failed=originalStartupFailure||originalObserverFailure||originalHTTPFailure||originalPrivateTerminalUnknown;
  if(failed)process.exitCode=1;
  emitEvent({event:failed?'shutdown_incomplete':'shutdown',level:failed?'error':'info',service:'ynx-wallet-gatewayd',reason,startupFailurePresent:originalStartupFailure,observerCleanupFailurePresent:originalObserverFailure,httpStopFailurePresent:originalHTTPFailure,privateTerminalUnknown:originalPrivateTerminalUnknown});
  // Never discard the process holding unresolved resource custody.
  if(!originalObserverFailure&&!originalHTTPFailure&&!originalPrivateTerminalUnknown)process.exit(originalStartupFailure?1:0);
 });return originalShutdown;
}
// Select only the real original v2 instance after its runtime server exists.
// v3 retains its original control/capacity contract, with no silent publisher.
try{if(productSessionStateVersion==='2')originalReturnPublisher=bindOriginalHostReturnPublisher(productHost);}
catch(cause){if(!originalStartupFailure){originalStartupCause=cause;originalStartupFailure=true;}process.exitCode=1;emitEvent({event:'original_return_publisher_startup_failed',level:'error',service:'ynx-wallet-gatewayd',code:cause?.code??'AUTH_PUBLISHER_ORIGINAL_HOST_REQUIRED'});}
if(originalStartupFailure)void stopOriginalDaemon('return_publisher_startup_failed');
else server.listen(port,address,()=>{
 originalListenSucceeded=true;
 try{originalRuntimeLifetime.afterListen();}catch(error){originalRuntimeLifetime.retire(error);void originalRuntimeLifetime.close().catch(()=>{});emitEvent({event:'original_runtime_observer_unavailable',level:'warn',service:'ynx-wallet-gatewayd',code:error?.code??'ORIGINAL_RUNTIME_NOT_CONFIGURED'});}
 if(productSessionStateVersion==='2'){
  try{
   originalPrivateDispatch=openOriginalWalletPrivateServiceAfterListen(productHost,originalRuntimeLifetime,originalPrivateAcquisition);
   void originalPrivateDispatch.whenFailed().catch(cause=>{
    if(!originalStartupFailure){originalStartupCause=cause;originalStartupFailure=true;}process.exitCode=1;
    emitEvent({event:'original_private_runtime_failed',level:'error',service:'ynx-wallet-gatewayd',code:cause?.code??'ORIGINAL_PRIVATE_RUNTIME_FAILED'});
    void stopOriginalDaemon('original_private_runtime_failed');
   });
  }
  catch(error){if(!originalStartupFailure){originalStartupCause=error;originalStartupFailure=true;}process.exitCode=1;emitEvent({event:'original_private_service_unavailable',level:'warn',service:'ynx-wallet-gatewayd',code:error?.code??'ORIGINAL_PRIVATE_NOT_SUPPLIED'});}
 }
 emitEvent({at:new Date().toISOString(),build:build??{buildTime:null,release:"local-unbound",sourceCommit:null},event:"listening",level:"info",remoteDeployed,service:"ynx-wallet-gatewayd",url:`http://${address}:${port}`});
});
server.on('close',()=>{originalServerClosed=true;void stopOriginalDaemon('listener_closed');});
server.on('error',error=>{
 if(!originalStartupFailure){originalStartupCause=error;originalStartupFailure=true;}
 process.exitCode=1;originalRuntimeLifetime.retire(error);
 emitEvent({event:originalListenSucceeded?'listener_failed':'startup_failed',level:'error',service:'ynx-wallet-gatewayd',failureClass:'LISTENER_FAILURE',originalCausePresent:true});
 void stopOriginalDaemon('listener_error');
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void stopOriginalDaemon(signal);});
server.requestTimeout=15000;server.headersTimeout=10000;

function integer(value,label,min,max){if(!/^[0-9]+$/.test(value))throw new Error(`${label} must be an integer`);const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${label} is outside policy`);return parsed}
function boolean(value,label){if(value==="true")return true;if(value==="false")return false;throw new Error(`${label} must be true or false`)}
function buildIdentity(env){const values=[env.YNX_WALLET_GATEWAY_SOURCE_COMMIT,env.YNX_WALLET_GATEWAY_RELEASE,env.YNX_WALLET_GATEWAY_BUILD_TIME];if(values.every(value=>value===undefined))return null;if(values.some(value=>value===undefined))throw new Error("Gateway build identity variables must be supplied together");const[sourceCommit,release,buildTime]=values;if(!/^[0-9a-f]{40}$/.test(sourceCommit))throw new Error("YNX_WALLET_GATEWAY_SOURCE_COMMIT must be a full lowercase Git SHA");if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release))throw new Error("YNX_WALLET_GATEWAY_RELEASE is invalid");const parsed=Date.parse(buildTime);if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==buildTime)throw new Error("YNX_WALLET_GATEWAY_BUILD_TIME must be canonical ISO-8601 UTC");return{buildTime,release,sourceCommit}}

// Operator-only source admission; no Host or key provisioning is performed.
function loadPrivateRegistrations(file){
 if(typeof file!=='string'||!file.startsWith('/')||resolve(file)!==file)throw new Error('Private business registration path must be absolute');
 const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 let bytes;
 try{const st=fstatSync(fd),fresh=lstatSync(file);if(!st.isFile()||st.nlink!==1||(st.mode&0o077)||typeof process.getuid==='function'&&st.uid!==process.getuid()||st.size>32768||fresh.dev!==st.dev||fresh.ino!==st.ino)throw new Error('Private business registration must be bounded and operator-protected');bytes=readFileSync(fd)}finally{closeSync(fd)}
 const config=JSON.parse(bytes.toString('utf8'));exactFields(config,['schemaVersion','registrations'],'Private business registration file');
 if(config.schemaVersion!=='ynx-private-business-registrations/v1'||!Array.isArray(config.registrations)||!config.registrations.length)throw new Error('Private business registration schema is invalid');
 return config.registrations;
}
