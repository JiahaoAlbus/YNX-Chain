#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJSON } from "../src/canonical.js";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";

const address=process.env.YNX_WALLET_GATEWAY_HTTP_ADDR??"127.0.0.1";
const port=integer(process.env.YNX_WALLET_GATEWAY_HTTP_PORT??"6439","YNX_WALLET_GATEWAY_HTTP_PORT",1,65535);
const statePath=process.env.YNX_WALLET_GATEWAY_STATE_PATH;
const remoteDeployed=boolean(process.env.YNX_WALLET_GATEWAY_REMOTE_DEPLOYED??"false","YNX_WALLET_GATEWAY_REMOTE_DEPLOYED");
const build=buildIdentity(process.env);
const registryPath=process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH?resolve(process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH):fileURLToPath(new URL("../central-registry.json",import.meta.url));
const productSessionRegistryPath=process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH?resolve(process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH):fileURLToPath(new URL("../product-session-registry.json",import.meta.url));
const productSessionStatePath=process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH?resolve(process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH):`${statePath}.product-session-v2`;
if(address!=="127.0.0.1"&&address!=="::1"&&address!=="localhost"&&!(isIP(address)&&address.startsWith("127.")))throw new Error("YNX_WALLET_GATEWAY_HTTP_ADDR must be loopback");
if(!statePath)throw new Error("YNX_WALLET_GATEWAY_STATE_PATH is required");
if(remoteDeployed&&!build)throw new Error("remote deployment requires YNX_WALLET_GATEWAY_SOURCE_COMMIT, YNX_WALLET_GATEWAY_RELEASE and YNX_WALLET_GATEWAY_BUILD_TIME");
if(remoteDeployed&&(!process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH||!process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH))throw new Error("remote deployment requires explicit YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH and YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH");
const registry=JSON.parse(readFileSync(registryPath,"utf8"));
const productSessionRegistry=JSON.parse(readFileSync(productSessionRegistryPath,"utf8"));
const emitEvent=event=>process.stdout.write(`${canonicalJSON(event)}\n`);
const deployment=build?{build,remoteDeployed}:{remoteDeployed};
const host=new CanonicalWalletGatewayNodeHost(registry,{emitEvent,statePath,now:()=>new Date()},deployment);
const productSessionHost=new ProductSessionGatewayNodeHost(productSessionRegistry,{statePath:productSessionStatePath,now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString("base64url")});
const legacyHandler=host.handler(),productSessionHandler=productSessionHost.handler();
const server=createServer((request,response)=>request.url?.startsWith("/v2/product-sessions/")?productSessionHandler(request,response):legacyHandler(request,response));
server.listen(port,address,()=>emitEvent({at:new Date().toISOString(),build:build??{buildTime:null,release:"local-unbound",sourceCommit:null},event:"listening",level:"info",remoteDeployed,service:"ynx-wallet-gatewayd",url:`http://${address}:${port}`}));
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>server.close(()=>{emitEvent({at:new Date().toISOString(),event:"shutdown",level:"info",service:"ynx-wallet-gatewayd",signal});process.exit(0)}));

function integer(value,label,min,max){if(!/^[0-9]+$/.test(value))throw new Error(`${label} must be an integer`);const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${label} is outside policy`);return parsed}
function boolean(value,label){if(value==="true")return true;if(value==="false")return false;throw new Error(`${label} must be true or false`)}
function buildIdentity(env){const values=[env.YNX_WALLET_GATEWAY_SOURCE_COMMIT,env.YNX_WALLET_GATEWAY_RELEASE,env.YNX_WALLET_GATEWAY_BUILD_TIME];if(values.every(value=>value===undefined))return null;if(values.some(value=>value===undefined))throw new Error("Gateway build identity variables must be supplied together");const[sourceCommit,release,buildTime]=values;if(!/^[0-9a-f]{40}$/.test(sourceCommit))throw new Error("YNX_WALLET_GATEWAY_SOURCE_COMMIT must be a full lowercase Git SHA");if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release))throw new Error("YNX_WALLET_GATEWAY_RELEASE is invalid");const parsed=Date.parse(buildTime);if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==buildTime)throw new Error("YNX_WALLET_GATEWAY_BUILD_TIME must be canonical ISO-8601 UTC");return{buildTime,release,sourceCommit}}
