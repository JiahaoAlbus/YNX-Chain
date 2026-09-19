import test from "node:test";
import assert from "node:assert/strict";
import {curlArguments,interpretProbe,parseArgs,preflight,routesFor,validateOrigin} from "./testnet-alias-preflight.mjs";
const config={testnet:{legacyCompatibility:{rpc:"https://rpc.ynxweb4.com",faucet:"https://faucet.ynxweb4.com"},canonicalTargets:{rpc:"https://rpc-testnet.ynxweb4.com",faucet:"https://faucet-testnet.ynxweb4.com"}}};
const marker="\n__YNX_CURL_METADATA__";
const route=routesFor(config)[2];
function fixture(r=route,body={},meta={}) {
  const value={chainId:6423,height:123,nativeSymbol:"YNXT",build:{commit:"a".repeat(40)},service:"ynx-faucetd",ok:true,upstreamOk:true,fundingReady:true,idempotentRequests:true,...body};
  return {exitCode:0,stderr:"",stdout:JSON.stringify(value)+marker+JSON.stringify({exitcode:0,http_code:200,url_effective:r.url,num_redirects:0,ssl_verify_result:0,time_appconnect:.15,remote_ip:r.origin??"43.153.202.237",proxy_used:0,...meta})};
}
test("offline defaults and exact public origin constraints",()=>{
  assert.deepEqual(parseArgs([]),{live:false,origin:null});
  assert.throws(()=>parseArgs(["--origin","43.153.202.237"]));
  assert.throws(()=>parseArgs(["--live","--live"]));
  for(const ip of ["127.0.0.1","10.0.0.1","192.168.1.1","198.18.0.1","169.254.169.254","100.64.0.1","203.0.113.5","192.0.2.1","::1","https://43.153.202.237","1.1.1.1;echo injected"]) assert.throws(()=>validateOrigin(ip),ip);
});
test("curl runs GET only, explicit deadlines/size, TLS validation and no curlrc",()=>{
  const args=curlArguments({...route,origin:"43.153.202.237"});
  assert.equal(args[0],"--disable");
  for(const required of ["--max-time","--connect-timeout","--max-filesize","--resolve"]) assert.ok(args.includes(required));
  for(const forbidden of ["-k","--insecure","-L","--location","--retry","--data","--header"]) assert.ok(!args.includes(forbidden));
  assert.equal(args[args.indexOf("--request")+1],"GET");
  assert.throws(()=>curlArguments({...route,url:"https://attacker.invalid/status"}));
});
for(const [name,body,meta] of [
  ["wrong chain",{chainId:1},{}], ["wrong symbol",{nativeSymbol:"YNX"},{}],
  ["missing build",{build:{}},{}], ["zero height",{height:0},{}],
  ["redirect",{},{num_redirects:1}], ["wrong URL",{},{url_effective:"https://attacker.invalid"}],
  ["invalid TLS",{},{ssl_verify_result:1}], ["no completed TLS",{},{time_appconnect:0}],
  ["HTTP failure",{},{http_code:404}], ["curl failure",{},{exitcode:35}],
]) test(`preflight rejects ${name}`,()=>assert.equal(interpretProbe(route,fixture(route,body,meta)).ready,false));
test("origin proofs reject proxy and unexpected remote address",()=>{
  const r={...route,origin:"43.153.202.237"};
  for(const meta of [{proxy_used:1},{remote_ip:"1.1.1.1"}]) assert.equal(interpretProbe(r,fixture(r,{},meta)).ready,false);
});
test("Faucet must expose actual healthy durable service",()=>{
  const r=routesFor(config).find(x=>x.kind==="faucet");
  for(const body of [{ok:false},{fundingReady:false},{idempotentRequests:false},{service:"unrelated"}]) assert.equal(interpretProbe(r,fixture(r,body)).ready,false);
});
test("invalid/truncated/oversized body never becomes readiness",()=>{
  assert.equal(interpretProbe(route,{exitCode:0,stdout:"no metadata"}).ready,false);
  for(const body of ["not-json","null","[]","x".repeat(2097153)]) {
    const raw=fixture(); raw.stdout=body+raw.stdout.slice(raw.stdout.lastIndexOf(marker));
    assert.equal(interpretProbe(route,raw).ready,false);
  }
});
test("only bounded reachability can pass; deployment, DNS and activation never promoted",async()=>{
  let calls=0;
  const report=await preflight(config,{origin:"43.153.202.237",exec:async args=>{calls++;const url=args.at(-1);return fixture({url,origin:args.includes("--resolve")?"43.153.202.237":null});}});
  assert.equal(calls,6); assert.equal(report.candidateReachabilityVerified,true); assert.equal(report.originReachabilityVerified,true);
  for(const key of ["publicVerified","consumerActivationAllowed","dnsChangeAuthorized"]) assert.equal(report[key],false);
});
test("candidate or origin build mismatch blocks even reachability parity",async()=>{
  const report=await preflight(config,{origin:"43.153.202.237",exec:async args=>fixture({url:args.at(-1),origin:args.includes("--resolve")?"43.153.202.237":null},{build:{commit:args.at(-1).includes("testnet")?"b".repeat(40):"a".repeat(40)}})});
  assert.equal(report.candidateReachabilityVerified,false); assert.equal(report.originReachabilityVerified,false);
});
