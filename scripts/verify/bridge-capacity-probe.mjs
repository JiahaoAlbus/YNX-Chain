#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const [binary, sourceCommit, output = ""] = process.argv.slice(2);
if (!binary || !/^[0-9a-f]{40}$/.test(sourceCommit || "")) { console.error("usage: bridge-capacity-probe.mjs <binary> <source-commit> [output]"); process.exit(2); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-bridge-capacity-"));
const state = path.join(temp, "state.json");
const url = "http://127.0.0.1:16434";
const apiKey = "bridge-capacity-local-key";
const env = {...process.env,
  YNX_BRIDGE_HTTP_ADDR:"127.0.0.1:16434", YNX_BRIDGE_STATE_PATH:state, YNX_BRIDGE_API_KEY:apiKey, YNX_BRIDGE_RELAYER_THRESHOLD:"2",
  YNX_BRIDGE_RELAYERS_JSON:'{"relayer-a":"11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=","relayer-b":"PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw="}',
  YNX_BRIDGE_ROUTE_POLICIES_JSON:'[{"provider":"local-capacity-probe","classification":"external-bridge-adapter","sourceChain":"ethereum-sepolia","destinationChain":"ynx_6423-1","sourceAsset":"sepolia-usdc","destinationAsset":"ynx-usdc","minConfirmations":12,"maxAmount":"1000","maxOutstanding":"1000000","dailyLimit":"1000000","userOutstandingLimit":"1000000","largeTransferThreshold":"1000","largeTransferDelaySeconds":0,"assetBoundary":"canonical-to-represented","externalSubmission":false}]'
};
const child = spawn(binary, [], {env, stdio:["ignore","ignore","pipe"]});
let stderr=""; child.stderr.on("data", chunk => { stderr += chunk; });
let exitInfo=null; child.on("exit",(code,signal)=>{exitInfo={code,signal};});
process.on("exit",()=>{ if(child.exitCode===null) child.kill("SIGTERM"); });
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function waitHealthy() { for(let i=0;i<500;i++){ try { const r=await fetch(`${url}/health`); if(r.ok) return; } catch {} if(exitInfo)break; await sleep(10); } if(!exitInfo)child.kill("SIGTERM"); throw new Error(`bridge did not start exit=${JSON.stringify(exitInfo)} stderr=${stderr.slice(0,500)}`); }
const startedAt=performance.now(); await waitHealthy(); const coldStartMs=performance.now()-startedAt;
const stateInitialBytes=fs.statSync(state).size;

function percentile(values, p){ const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]; }
async function load(name,total,concurrency,request){
  const latencies=[]; let next=0, successes=0, failures=0; const begin=performance.now();
  async function worker(){ while(true){ const index=next++; if(index>=total)return; const start=performance.now(); try { const response=await request(index); if(!response.ok) throw new Error(`status ${response.status}`); await response.arrayBuffer(); successes++; } catch { failures++; } latencies.push(performance.now()-start); } }
  await Promise.all(Array.from({length:concurrency},worker)); const durationMs=performance.now()-begin;
  return {name,total,concurrency,successes,failures,errorRate:failures/total,durationMs,throughputPerSecond:successes/(durationMs/1000),latencyMs:{p50:percentile(latencies,.50),p95:percentile(latencies,.95),p99:percentile(latencies,.99),max:Math.max(...latencies)}};
}
const publicReads=await load("public-transparency-read",500,20,()=>fetch(`${url}/bridge/transparency`));
const mutations=await load("persistent-transfer-create",100,4,index=>{
  const suffix=String(index).padStart(4,"0"); const tx=crypto.createHash("sha256").update(`capacity-${suffix}`).digest("hex");
  return fetch(`${url}/bridge/transfers`,{method:"POST",headers:{"content-type":"application/json","X-YNX-Bridge-Key":apiKey},body:JSON.stringify({idempotencyKey:`capacity-create-${suffix}`,sourceChain:"ethereum-sepolia",sourceTxHash:`0x${tx}`,sourceEventIndex:index,sourceAsset:"sepolia-usdc",destinationChain:"ynx_6423-1",destinationAsset:"ynx-usdc",amount:"1",sender:"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",recipient:"ynx1recipient000000000000000000000000000001"})});
});
const loadedReads=await load("loaded-public-transparency-read",500,20,()=>fetch(`${url}/bridge/transparency`));
const health=await (await fetch(`${url}/health`)).json(); const stateFinalBytes=fs.statSync(state).size;
child.kill("SIGTERM"); await new Promise(resolve=>child.once("exit",resolve)); fs.rmSync(temp,{recursive:true,force:true});
if(publicReads.failures||mutations.failures||loadedReads.failures||health.transferCount!==100) throw new Error("capacity probe had failed requests or incorrect transfer count");
const report={schemaVersion:1,sourceCommit,generatedAt:new Date().toISOString(),classification:"bounded-local-measurement-not-production-capacity",environment:{os:`${os.platform()}/${os.arch()}`,cpuModel:os.cpus()[0]?.model||"unreported",logicalCpuCount:os.cpus().length,memoryBytes:os.totalmem(),nodeVersion:process.version},coldStartMs,state:{initialBytes:stateInitialBytes,finalBytes:stateFinalBytes,growthBytes:stateFinalBytes-stateInitialBytes,transferCount:health.transferCount},samples:[publicReads,mutations,loadedReads],providerLatencyMeasured:false,destinationLatencyMeasured:false,remoteMeasured:false};
if(output) fs.writeFileSync(output,`${JSON.stringify(report,null,2)}\n`); else console.log(JSON.stringify(report));
console.log(`bridge capacity probe passed: coldStartMs=${coldStartMs.toFixed(2)} readP95=${loadedReads.latencyMs.p95.toFixed(2)} mutationP95=${mutations.latencyMs.p95.toFixed(2)} stateGrowthBytes=${report.state.growthBytes}`);
