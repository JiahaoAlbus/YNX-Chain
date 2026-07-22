import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import {
  CanonicalWalletGatewayAdapter, createGatewayChallenge, createProductSessionProof, httpBodyDigest,
  parseAuthorizationRequest, signAuthorization, signGatewayChallenge,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, REGISTRY, request } from "../test/fixtures.mjs";

const samples=Number.parseInt(process.env.YNX_GATEWAY_BENCHMARK_SAMPLES??"1000",10);
if(!Number.isSafeInteger(samples)||samples<100||samples>10000)throw new Error("YNX_GATEWAY_BENCHMARK_SAMPLES must be an integer from 100 through 10000");
const registry=JSON.parse(readFileSync(new URL("../central-registry.json",import.meta.url),"utf8"));
const social=registry.products.find(product=>product.productId==="social");social.reviewState="approved";social.enabled=true;
const gateway=new CanonicalWalletGatewayAdapter(registry);
const authorizationRequest=parseAuthorizationRequest(request(),{now:NOW,registry:REGISTRY});
const walletApproval=signAuthorization(authorizationRequest,{accountSecret:ACCOUNT_SECRET,issuedAt:NOW.toISOString()});
const challenge=createGatewayChallenge(walletApproval,{challenge:"gateway_challenge_abcdefghijklmnop",expiresAt:"2026-07-15T12:03:00.000Z"},NOW);
const session=gateway.complete({authorizationRequest,walletApproval,gatewayCompletion:signGatewayChallenge(challenge,PRODUCT_DEVICE_SECRET)},NOW);
const bodyDigest=httpBodyDigest("{}");const latencies=[];let failures=0;const started=performance.now();
for(let index=0;index<samples;index+=1){const itemStarted=performance.now();try{const proof=createProductSessionProof(session,{method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest,nonce:`bench_${index.toString().padStart(8,"0")}_abcdefghijklmnopqr`,issuedAt:"2026-07-15T12:00:00.000Z",expiresAt:"2026-07-15T12:00:30.000Z"},PRODUCT_DEVICE_SECRET);gateway.introspect({proof,requiredScopes:["account:read"]},{method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest},NOW)}catch{failures+=1}latencies.push(performance.now()-itemStarted)}
const elapsed=performance.now()-started;latencies.sort((a,b)=>a-b);
const percentile=value=>latencies[Math.min(latencies.length-1,Math.ceil((value/100)*latencies.length)-1)];
console.log(JSON.stringify({schemaVersion:1,benchmark:"canonical-wallet-gateway-local-protocol",sourceClass:"local-measurement",runtime:{node:process.version,platform:process.platform,arch:process.arch},samples,failures,errorRate:failures/samples,elapsedMs:Number(elapsed.toFixed(3)),throughputPerSecond:Number((samples/(elapsed/1000)).toFixed(3)),latencyMs:{p50:Number(percentile(50).toFixed(3)),p95:Number(percentile(95).toFixed(3)),p99:Number(percentile(99).toFixed(3)),max:Number(latencies.at(-1).toFixed(3))},coverage:"In-process P-256 proof creation, strict verification, Product Session introspection and sorted replay-state update; excludes HTTP, disk, database, provider and public network latency.",version:"wallet-auth-v1"},null,2));
