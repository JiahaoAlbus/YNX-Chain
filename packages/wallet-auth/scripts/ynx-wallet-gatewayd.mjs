#!/usr/bin/env node
import {loadCentralBackendConfiguration} from '../src/central-browser-backend-auth.js';
import { readFileSync, lstatSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJSON } from "../src/canonical.js";
import { forwardedClient, GatewayAdmissionController } from "../src/gateway-admission.js";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
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
const productHost=new ProductHost(productRegistry,{statePath:productSessionStatePath,now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url'),...(productSessionStateVersion==='3'?{capacityPolicy}:{})});
// Separate identity-only history; never migrate/reset either existing product
// state format or its clock/nonce/control high-water marks to enable SSO.
const central=centralBrowser?new CentralBrowserSessionNodeRoutes(new CentralBrowserSessionAuthority(createCentralBrowserSessionRegistry(productRegistry),new CentralBrowserSessionStore(`${productSessionStatePath}.browser`),loadCentralBackendConfiguration(process.env.YNX_CENTRAL_BROWSER_BACKEND_CONFIG_FILE))):null;
const admission=new GatewayAdmissionController({maxConcurrent:integer(process.env.YNX_WALLET_GATEWAY_MAX_CONCURRENT??"64","YNX_WALLET_GATEWAY_MAX_CONCURRENT",1,1024),maxPerWindow:integer(process.env.YNX_WALLET_GATEWAY_RATE_LIMIT??"300","YNX_WALLET_GATEWAY_RATE_LIMIT",1,100000)});
const legacyHandler=host.handler(),productHandler=productHost.handler();
const gatewayHandler=async(request,response)=>{
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  if(central?.handles(path)){
    let body='';if(request.method==='POST'){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>16384)throw new Error('Central browser body exceeds policy');chunks.push(chunk)}body=Buffer.concat(chunks).toString('utf8');}
    const result=central.handle({method:request.method,url:request.url,headers:request.headers,body});response.writeHead(result.status,result.headers);response.end(result.body);return;
  }
  return request.url?.startsWith('/v2/product-sessions/')?productHandler(request,response):legacyHandler(request,response);
};
const server=createServer((request,response)=>{const ticket=admission.enter(forwardedClient(request));if(!ticket.ok){response.writeHead(ticket.status,{"cache-control":"no-store","content-type":"application/json; charset=utf-8","retry-after":"60"});response.end(canonicalJSON({error:{code:ticket.code,message:"Wallet Gateway admission policy rejected the request"},ok:false}));return}response.once("finish",ticket.release);response.once("close",ticket.release);Promise.resolve(gatewayHandler(request,response)).catch(error=>{ticket.release();if(!response.headersSent){response.writeHead(500,{"cache-control":"no-store","content-type":"application/json; charset=utf-8"});response.end(canonicalJSON({error:{code:"INTERNAL_ERROR",message:"Wallet Gateway request failed"},ok:false}))}emitEvent({at:new Date().toISOString(),error:error instanceof Error?error.message:"unknown",event:"handler_error",level:"error",service:"ynx-wallet-gatewayd"})})});
server.listen(port,address,()=>emitEvent({at:new Date().toISOString(),build:build??{buildTime:null,release:"local-unbound",sourceCommit:null},event:"listening",level:"info",remoteDeployed,service:"ynx-wallet-gatewayd",url:`http://${address}:${port}`}));
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>server.close(()=>{emitEvent({at:new Date().toISOString(),event:"shutdown",level:"info",service:"ynx-wallet-gatewayd",signal});process.exit(0)}));
server.requestTimeout=15000;server.headersTimeout=10000;

function integer(value,label,min,max){if(!/^[0-9]+$/.test(value))throw new Error(`${label} must be an integer`);const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${label} is outside policy`);return parsed}
function boolean(value,label){if(value==="true")return true;if(value==="false")return false;throw new Error(`${label} must be true or false`)}
function buildIdentity(env){const values=[env.YNX_WALLET_GATEWAY_SOURCE_COMMIT,env.YNX_WALLET_GATEWAY_RELEASE,env.YNX_WALLET_GATEWAY_BUILD_TIME];if(values.every(value=>value===undefined))return null;if(values.some(value=>value===undefined))throw new Error("Gateway build identity variables must be supplied together");const[sourceCommit,release,buildTime]=values;if(!/^[0-9a-f]{40}$/.test(sourceCommit))throw new Error("YNX_WALLET_GATEWAY_SOURCE_COMMIT must be a full lowercase Git SHA");if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release))throw new Error("YNX_WALLET_GATEWAY_RELEASE is invalid");const parsed=Date.parse(buildTime);if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==buildTime)throw new Error("YNX_WALLET_GATEWAY_BUILD_TIME must be canonical ISO-8601 UTC");return{buildTime,release,sourceCommit}}
