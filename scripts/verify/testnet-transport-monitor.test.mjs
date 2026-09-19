import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {ROUTES, parseArgs, curlArgs, classify, interpret, dnsSnapshot, hostArgs, counterDelta, monitor, runCommand, sourceIdentity} from "./testnet-transport-monitor.mjs";
const marker = "\n__YNX_CURL_METADATA__";
function fixture(route, changes = {}, code = 0) {
  const body = {chainId:6423,height:10,nativeSymbol:"YNXT",build:{commit:"a".repeat(40)},service:"ynx-faucetd",ok:true,upstreamOk:true,fundingReady:true,idempotentRequests:true};
  const meta = {exitcode:code,http_code:200,url_effective:route.url,num_redirects:0,ssl_verify_result:0,
    time_namelookup:.01,time_connect:.02,time_appconnect:.05,time_starttransfer:.08,time_total:.09,remote_ip:"43.153.202.237",...changes};
  return {exitCode:code,stdout:JSON.stringify(body)+marker+JSON.stringify(meta),stderr:"server: Caddy\r\nset-cookie: secret-token\r\n",killed:false};
}
test("dry default and hard bound options",()=>{
  assert.equal(parseArgs([]).live,false);
  for(const args of [["--rounds","0"],["--rounds","121"],["--rounds","1.5"],["--interval-seconds","1"],["--rounds","120","--interval-seconds","300"],["--host","root@other.invalid"],["--live"],["--live","--live"],["--output-dir","relative"],["--identity","/key"],["--vantage","bad\nlabel"],["--force"]])assert.throws(()=>parseArgs(args));
  assert.equal(parseArgs(["--rounds","2","--interval-seconds","15"]).rounds,2);
});
test("probe only exact four GET routes, normal TLS, no follow/retry or credentials",()=>{
  for(const route of ROUTES){const a=curlArgs(route,"ynx-probe-test");assert.equal(a[0],"--disable");assert.equal(a[a.indexOf("--request")+1],"GET");assert(a.includes("--max-time"));assert(a.includes("--max-filesize"));for(const bad of ["--insecure","-k","--location","--retry","--data","--netrc","--user"])assert(!a.includes(bad));}
  assert.throws(()=>curlArgs({url:"https://faucet-testnet.ynxweb4.com/request"},"ynx-probe-test"));
  assert.throws(()=>curlArgs(ROUTES[0],"ynx-probe-a\r\nAuthorization: secret"));
  assert.throws(()=>parseArgs(["--packet-metadata"]));
});
for(const [name,code,changes,expected]of[
  ["dns",6,{},"dns-resolution-failed"],
  ["unresolved phase",28,{time_namelookup:0,time_connect:0,time_appconnect:0},"connection-timeout-dns-or-connect-unresolved"],
  ["tcp timeout",28,{time_connect:0,time_appconnect:0},"tcp-connect-timeout"],
  ["tls timeout",28,{time_appconnect:0},"tls-handshake-timeout"],
  ["TLS timeout with incomplete verify result",28,{time_appconnect:0,ssl_verify_result:1},"tls-handshake-timeout"],
  ["client port collision",45,{},"client-source-port-unavailable"],
  ["first byte timeout",28,{time_starttransfer:0},"http-first-byte-timeout"],
  ["body timeout",28,{},"response-body-timeout"],
  ["refused",7,{},"tcp-connect-failed"],
  ["tls negotiation",35,{},"tls-handshake-failed"],
  ["certificate",60,{},"tls-verification-failed"],
  ["verify failed no curl error",0,{ssl_verify_result:20},"tls-verification-failed"],
  ["server",0,{http_code:503},"http-server-or-upstream-error"],
  ["not found",0,{http_code:404},"http-unexpected-status"],
  ["reset",56,{},"transport-or-client-error"],
])test(`classifies ${name} without inventing root cause`,()=>{
  const r=interpret(ROUTES[0],fixture(ROUTES[0],changes,code),"ynx-probe-test",new Date().toISOString());assert.equal(r.classification,expected);assert.equal(r.ready,false);
});
test("healthy phases and allowlisted header output exclude cookies/raw bodies",()=>{
  const r=interpret(ROUTES[0],fixture(ROUTES[0]),"ynx-probe-test",new Date().toISOString());assert.equal(r.classification,"healthy");assert.equal(r.headers.server,"Caddy");assert.equal(r.rawBodyRetained,false);assert(!JSON.stringify(r).includes("secret-token"));assert.equal(r.phaseSeconds.tcpAfterDNS,.01);assert.equal(r.phaseSeconds.tlsAfterTCP,.030000000000000002);
});
test("missing metadata, wrong source and proxy context cannot be health proof",()=>{
  assert.equal(interpret(ROUTES[0],{exitCode:1,stdout:"",stderr:""},"ynx-probe-test","").classification,"client-metadata-unavailable");
  const r=interpret(ROUTES[0],fixture(ROUTES[0],{url_effective:"https://other.invalid",proxy_used:1}),"ynx-probe-test","");assert.equal(r.ready,false);assert.equal(r.client.proxy_used,1);
  const t=interpret(ROUTES[0],fixture(ROUTES[0],{time_connect:0,time_appconnect:0,time_starttransfer:0},28),"ynx-probe-test","");assert.equal(t.phaseSeconds.bodyAfterFirstByte,null);
});
test("DNS is separately labelled and subprocess-deadline bounded",async()=>{
  const r=await dnsSnapshot("rpc.ynxweb4.com",async(command,args,options)=>{assert.equal(command,process.execPath);assert.equal(args.at(-1),"rpc.ynxweb4.com");assert.equal(options.timeout,2500);return{exitCode:1,killed:true,stdout:""};});assert(r.timedOut);assert.deepEqual(r.answers,[]);assert.match(r.semantics,/not proof/);
  await assert.rejects(dnsSnapshot("evil.invalid"));
});
test("SSH keeps existing identity opaque, strict host verification and no remote writes",()=>{
  const a=hostArgs({host:"ubuntu@43.153.202.237",identity:"/opaque/key",knownHosts:"/known_hosts"},true);assert(a.includes("StrictHostKeyChecking=yes"));assert(a.includes("BatchMode=yes"));assert(a.includes("ConnectionAttempts=1"));assert(a.includes("--details"));assert(a.includes("python3"));assert(!a.join(" ").includes("restart"));assert.throws(()=>hostArgs({host:"evil"}));
});
test("counter reset is unknown not negative loss; missing counters not zero",()=>{
  assert.deepEqual(counterDelta({ListenDrops:5,TCPTimeouts:8,missing:4},{ListenDrops:7,TCPTimeouts:2}),{ListenDrops:2,TCPTimeouts:null});
});
test("source hashes bind the exact collector and shared health interpreter",()=>{
  const values=sourceIdentity();assert.equal(Object.keys(values).length,3);assert(Object.values(values).every(x=>/^[a-f0-9]{64}$/.test(x)));
});
test("planned source ports are bounded, explicitly passed and never silently retried",()=>{
  const a=curlArgs(ROUTES[0],"ynx-probe-port",24001);assert.equal(a[a.indexOf('--local-port')+1],'24001');
  for(const p of [1,65536,24001.5,"24001;bad"])assert.throws(()=>curlArgs(ROUTES[0],"ynx-probe-port",p));
  const h=hostArgs({host:"ubuntu@43.153.202.237",packetMetadata:true,probePorts:[24001,24002,24003,24004]});assert.equal(h[h.indexOf('--probe-ports')+1],'24001,24002,24003,24004');
  assert.throws(()=>hostArgs({host:"ubuntu@43.153.202.237",probePorts:["a;bad"]}));
});
test("subprocess deadline kills an unresponsive diagnostic child",async()=>{
  const r=await runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100});assert(r.killed);assert.notEqual(r.exitCode,0);
});
test("bounded rounds start host observer concurrently, preserve failure without hidden retry",async()=>{
  const events=[];let curl=0,ssh=0,active=0,maxActive=0;const o={...parseArgs([]),rounds:2,host:"ubuntu@43.153.202.237"};
  const summary=await monitor(o,{hostScript:"# read-only fixture",emit:e=>events.push(e),sleep:async()=>{},resolveDNS:async()=>({fixture:true}),exec:async(command,args)=>{
    if(command==='ssh'){ssh++;return{exitCode:0,stdout:JSON.stringify({samples:[{observedAt:'2026-01-01T00:00:00Z',tcpCounters:{ListenDrops:1}},{observedAt:'2026-01-01T00:00:21Z',tcpCounters:{ListenDrops:1}}]})};}
    curl++;active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,2));active--;const route=ROUTES.find(x=>x.url===args.at(-1));return curl===2?fixture(route,{time_connect:0,time_appconnect:0},28):fixture(route);
  }});
  assert.equal(curl,8);assert.equal(ssh,2);assert(maxActive<=2);assert(summary.failures.length>0);assert.equal(summary.allSamplesHealthy,false);assert.equal(summary.rootCauseConfirmed,false);assert.equal(events.filter(x=>x.type==='host-window').length,2);assert.equal(summary.faucetClaims,0);
});
test("SSH denial never converts to empty successful server evidence",async()=>{
  const events=[];const summary=await monitor({...parseArgs([]),rounds:1,host:"ubuntu@43.153.202.237"},{hostScript:"",emit:e=>events.push(e),resolveDNS:async()=>({}),exec:async(command,args)=>command==='ssh'?{exitCode:255,stdout:""}:fixture(ROUTES.find(x=>x.url===args.at(-1)))});
  const e=events.find(x=>x.type==='host-window');assert.equal(e.host.available,false);assert.deepEqual(e.withinWindowDelta,{});assert(e.coverage.every(x=>!x.clientWindowCovered));
  assert.equal(summary.hostWindows[0].available,false);assert.equal(summary.allSamplesHealthy,true);
});
test("host-ready barrier precedes probes when streamed and packet collection is opt-in",async()=>{
  let ready=false;const events=[];await monitor({...parseArgs([]),rounds:1,host:"ubuntu@43.153.202.237",packetMetadata:true},{hostScript:"",emit:e=>events.push(e),resolveDNS:async()=>({}),exec:async(command,args,opts)=>{
    if(command==='ssh'){assert(args.includes('--packet-metadata'));ready=true;opts.onStdout('{"type": "host-ready"}\n');await new Promise(r=>setTimeout(r,5));return{exitCode:0,stdout:'{"type":"host-ready"}\n{"samples":[]}\n'};}
    assert(ready);return fixture(ROUTES.find(x=>x.url===args.at(-1)));
  }});assert(events.find(e=>e.type==='host-ready-status').samplerReady);
});
test("dry CLI makes no output directory; live refuses an existing directory before network",()=>{
  const cwd=process.cwd(),script=path.resolve('scripts/verify/testnet-transport-monitor.mjs');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-transport-offline-'));
  const dry=JSON.parse(execFileSync(process.execPath,[script,'--output-dir',path.join(tmp,'new')],{cwd,encoding:'utf8'}));assert.equal(dry.networkRequests,0);assert(!fs.existsSync(path.join(tmp,'new')));
  assert.throws(()=>execFileSync(process.execPath,[script,'--live','--output-dir',tmp],{cwd,stdio:'pipe'}));
  fs.rmdirSync(tmp);
});
