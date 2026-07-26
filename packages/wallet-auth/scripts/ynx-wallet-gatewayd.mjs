#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";

const address=process.env.YNX_WALLET_GATEWAY_HTTP_ADDR??"127.0.0.1";
const port=integer(process.env.YNX_WALLET_GATEWAY_HTTP_PORT??"6438","YNX_WALLET_GATEWAY_HTTP_PORT",1,65535);
const statePath=process.env.YNX_WALLET_GATEWAY_STATE_PATH;
const registryPath=process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH?resolve(process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH):fileURLToPath(new URL("../central-registry.json",import.meta.url));
if(address!=="127.0.0.1"&&address!=="::1"&&address!=="localhost"&&!(isIP(address)&&address.startsWith("127.")))throw new Error("YNX_WALLET_GATEWAY_HTTP_ADDR must be loopback");
if(!statePath)throw new Error("YNX_WALLET_GATEWAY_STATE_PATH is required");
const registry=JSON.parse(readFileSync(registryPath,"utf8"));
const host=new CanonicalWalletGatewayNodeHost(registry,{statePath,now:()=>new Date()});
const server=createServer(host.handler());
server.listen(port,address,()=>console.log(`ynx-wallet-gatewayd listening on http://${address}:${port}; canonical proof-bound runtime; public deployment not implied`));
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>server.close(()=>process.exit(0)));

function integer(value,label,min,max){if(!/^[0-9]+$/.test(value))throw new Error(`${label} must be an integer`);const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${label} is outside policy`);return parsed}
