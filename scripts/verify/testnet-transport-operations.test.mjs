import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROUTES} from './testnet-transport-monitor.mjs';
import {loadRun,makeBundle,writeBundle,readRegular,sha256} from './testnet-transport-bundle.mjs';
import {evaluate,parseJobArgs,runJob,storageUsage,status,LIMITS} from './testnet-transport-job.mjs';

const base=Date.parse('2026-09-19T10:00:00Z');
function fixture(n=1,bad=false){
  const at=base+n*120000,runId='ynx-probe-00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
  const start={type:'start',at:new Date(at).toISOString(),runId,vantage:'fixture',rounds:2,pathMode:'environment-dns',sourceSHA256:{'testnet-transport-monitor.mjs':'a'.repeat(64)}};
  const probes=[1,2].flatMap(round=>ROUTES.map((r,i)=>({type:'probe',round,url:r.url,probeId:runId+'-'+round+'-'+i,
    startedAt:new Date(at+(round-1)*30000).toISOString(),finishedAt:new Date(at+(round-1)*30000+1000).toISOString(),ready:!(bad&&i===0),
    bodySHA256:'b'.repeat(64),identity:{chainId:6423,nativeSymbol:'YNXT',height:100,build:{commit:'c'.repeat(40)}},
    client:{time_namelookup:.01,time_connect:bad&&i===0?0:.02,time_appconnect:bad&&i===0?0:.05,time_starttransfer:bad&&i===0?0:.1,time_total:bad&&i===0?5:.2,
      http_code:bad&&i===0?0:200,exitcode:bad&&i===0?28:0,ssl_verify_result:0,proxy_used:0,remote_ip:'43.153.202.237'}})));
  const summary={runId,finishedAt:new Date(at+32000).toISOString(),interrupted:false};
  const events=[start,...probes,{type:'summary',...summary}];const raw=events.map(e=>JSON.stringify(e)).join('\n')+'\n';
  return {events,summary:{...summary,observationsSHA256:sha256(raw)},inputSHA256:sha256(raw),raw};
}
const bundle=(n,bad)=>makeBundle(fixture(n,bad));
const evaluateAt=(b,p=null)=>evaluate(b,p,Date.parse(b.finishedAt));
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-transport-ops-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function persist(dir,f){fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(path.join(dir,'observations.jsonl'),f.raw,{mode:0o600});fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(f.summary),{mode:0o600});}

test('bundle removes arbitrary secrets, client address hashes, local paths and raw errors',()=>{
  const f=fixture();f.events[1].clientError='SECRET';f.events[1].headers={authorization:'SECRET'};f.events[1].identity.build.secret='SECRET';
  f.events[1].client.local_ip='1.2.3.4';f.events[0].identity='/SECRET/key';
  f.events.splice(-1,0,{type:'host-window',round:1,host:{samples:[{observedAt:f.events[0].at,tcpCounters:{ListenDrops:0,SECRET:9},listeners:[{local:'SECRET:443',recvQ:0,backlog:4096}]},{observedAt:f.summary.finishedAt}],
    details:{services:{output:'SECRET'},caddyfileSHA256:{output:'f'.repeat(64)+' /SECRET/file'},firewall:{available:true,ruleCount:2,terminalRules:[{verdict:'drop',comment:'SECRET',counter:{packets:1,bytes:40}}]}},
    packetMetadata:{available:true,events:[{clientAddressSHA256:'SECRET',timestamp:'1789812120.123',direction:'from-client',clientPort:24001,sequence:'1:20',ack:'1',length:19,flags:'P.'}]}}});
  const b=makeBundle(f),s=JSON.stringify(b);assert(!s.includes('SECRET'));assert(!s.includes('1.2.3.4'));assert(!s.includes('clientAddressSHA256'));assert.equal(b.healthySamples,8);assert.equal(b.rootCauseConfirmed,false);
});
test('incomplete, duplicated, unknown-route and unverified-TLS evidence cannot become a healthy batch',()=>{
  const f=fixture();f.events.splice(1,1);assert.equal(makeBundle(f).complete,false);
  const duplicate=fixture();duplicate.events.splice(1,0,duplicate.events[1]);assert.throws(()=>makeBundle(duplicate),/duplicate/);
  const other=fixture();other.events[1].url='https://evil.invalid/SECRET';assert.throws(()=>makeBundle(other),/target/);
  const tls=fixture();tls.events[1].client.time_appconnect=0;assert.equal(makeBundle(tls).allSamplesHealthy,false);
  const wrong=fixture();wrong.events[1].identity.chainId=1;assert.equal(makeBundle(wrong).allSamplesHealthy,false);
  const cut=fixture();cut.events.pop();assert.throws(()=>makeBundle(cut),/incomplete/);
});
test('artifact hash mismatch, symlinks, hardlinks and oversized files are rejected',t=>{
  const tmp=temporary(t),dir=path.join(tmp,'run');persist(dir,fixture());assert.equal(makeBundle(loadRun(dir)).healthySamples,8);
  fs.appendFileSync(path.join(dir,'observations.jsonl'),' ');assert.throws(()=>loadRun(dir),/hash/);
  const target=path.join(tmp,'target');fs.writeFileSync(target,'secret');const link=path.join(tmp,'link');fs.symlinkSync(target,link);assert.throws(()=>readRegular(link,100));
  fs.linkSync(target,path.join(tmp,'hard'));assert.throws(()=>readRegular(target,100),/unsafe/);
  const big=path.join(tmp,'big');fs.writeFileSync(big,'1234');assert.throws(()=>readRegular(big,2),/oversized/);
});
test('bundle output is private, exclusive, offline and does not alter input',t=>{
  const tmp=temporary(t),dir=path.join(tmp,'run'),out=path.join(tmp,'bundle.json');persist(dir,fixture());const before=fs.readFileSync(path.join(dir,'observations.jsonl'));
  writeBundle(dir,out);assert.equal(fs.statSync(out).mode&0o777,0o600);assert.throws(()=>writeBundle(dir,out));assert.deepEqual(fs.readFileSync(path.join(dir,'observations.jsonl')),before);
});
test('first failure warns, repeat batch escalates, unchanged failures remain quiet',()=>{
  const a=evaluateAt(bundle(1,true));assert.equal(a.level,'warning');assert(a.alert.notify);
  const b=evaluateAt(bundle(2,true),a);assert.equal(b.level,'critical');assert(b.alert.notify);
  const c=evaluateAt(bundle(3,true),b);assert.equal(c.level,'critical');assert.equal(c.alert.notify,false);
});
test('identity and certificate failures are immediately critical; incomplete TLS timeout is not certificate failure',()=>{
  for(const kind of ['identity','certificate']){const f=fixture();f.events[1].ready=false;if(kind==='identity')f.events[1].identity.chainId=1;else{f.events[1].client.exitcode=60;f.events[1].client.ssl_verify_result=20;}assert.equal(evaluateAt(makeBundle(f)).level,'critical');}
  const f=fixture();f.events[1].ready=false;f.events[1].client.exitcode=28;f.events[1].client.time_appconnect=0;f.events[1].client.ssl_verify_result=1;assert.equal(evaluateAt(makeBundle(f)).level,'warning');
});
test('old or reversed probe timestamps make a fresh wrapper incomplete',()=>{
  const old=fixture();old.events[1].startedAt='2025-01-01T00:00:00Z';assert.equal(makeBundle(old).complete,false);
  const reverse=fixture();reverse.events[1].finishedAt='2025-01-01T00:00:00Z';assert.equal(makeBundle(reverse).complete,false);
});
test('one or two healthy batches cannot clear incident; third sampled recovery not global acceptance',()=>{
  let state=evaluateAt(bundle(1,true));for(const n of[2,3]){state=evaluateAt(bundle(n,false),state);assert.equal(state.level,'warning');assert.equal(state.alert.notify,false);}
  state=evaluateAt(bundle(4,false),state);assert.equal(state.level,'ok');assert.equal(state.alert.transition,'recovered-samples');assert(state.alert.notify);assert.equal(state.continuousAvailabilityVerified,false);
  const next=evaluateAt(bundle(5,false),state);assert.equal(next.alert.notify,false);
});
test('gap interrupts recovery and requested-but-missing host evidence is not success',()=>{
  let state=evaluateAt(bundle(1,true));state=evaluateAt(bundle(2,false),state);const incomplete=bundle(3,false);incomplete.complete=false;state=evaluateAt(incomplete,state);assert.equal(state.level,'diagnostic-gap');
  state=evaluateAt(bundle(4,false),state);assert(state.endpoints[ROUTES[0].url].incidentOpen);assert.equal(state.endpoints[ROUTES[0].url].healthyBatches,1);
  const missing=bundle(5,false);missing.hostObservationExpected=true;assert.equal(evaluateAt(missing).level,'diagnostic-gap');
});
test('duplicate, older, different-vantage, too-close, stale and future samples do not mutate prior state',()=>{
  const b=bundle(1,true),state=evaluateAt(b),before=JSON.stringify(state);assert.throws(()=>evaluateAt(b,state),/DUPLICATE/);
  const other=bundle(2);other.vantage='other';assert.throws(()=>evaluateAt(other,state),/IDENTITY/);
  assert.throws(()=>evaluate(b,null,Date.parse(b.finishedAt)+LIMITS.staleMs+1),/STALE/);
  assert.throws(()=>evaluate(b,null,Date.parse(b.startedAt)-60001),/FUTURE/);
  const close=bundle(2);close.startedAt=new Date(Date.parse(state.checkedAt)+1000).toISOString();assert.throws(()=>evaluateAt(close,state),/COOLDOWN/);
  assert.equal(JSON.stringify(state),before);
});
test('long gap or source change resets healthy streak, retaining unresolved incident',()=>{
  let s=evaluateAt(bundle(1,true));s=evaluateAt(bundle(2,false),s);const later=bundle(20,false);s=evaluateAt(later,s);assert.equal(s.endpoints[ROUTES[0].url].healthyBatches,1);assert.equal(s.level,'warning');
  const change=bundle(21,false);change.sourceSHA256={'testnet-transport-monitor.mjs':'d'.repeat(64)};s=evaluateAt(change,s);assert.equal(s.endpoints[ROUTES[0].url].healthyBatches,1);
});
test('dry defaults and CLI limits reject broad paths, arbitrary endpoints and packet capture',async t=>{
  const tmp=temporary(t),dir=path.join(tmp,'unused');const o=parseJobArgs(['--state-dir',dir]);assert.deepEqual(await runJob(o),{dryRun:true,networkRequests:0,filesWritten:0,requestsPerRun:8,automaticScheduleEnabled:false});assert(!fs.existsSync(dir));
  for(const args of[['--live'],['--state-dir','/'],['--state-dir',os.homedir()],['--state-dir','relative'],['--url','https://evil.invalid'],['--packet-metadata'],['--rounds','100'],['--live','--live'],['--status','--live','--state-dir',dir]])assert.throws(()=>parseJobArgs(args));
});
test('scheduled fixture writes exact run, redacted bundle and atomic state; releases only owned lock',async t=>{
  const dir=temporary(t),f=fixture(),options=parseJobArgs(['--live','--state-dir',dir,'--vantage','fixture']);let calls=0;
  const r=await runJob(options,{now:()=>Date.parse(f.summary.finishedAt),exec:async(command,args,limits)=>{calls++;assert.equal(limits.timeout,240000);const output=args[args.indexOf('--output-dir')+1];persist(output,f);return{exitCode:0};}});
  assert.equal(calls,1);assert.equal(r.healthy,8);assert.equal(r.alert.notificationDeliveryConfigured,false);assert(!fs.existsSync(path.join(dir,'.run.lock')));assert.equal(fs.statSync(path.join(dir,'state.json')).mode&0o777,0o600);
  await assert.rejects(runJob(options,{now:()=>Date.parse(f.summary.finishedAt)+1,exec:async()=>{throw Error('unexpected network');}}),/COOLDOWN/);
  assert(status(dir,Date.parse(f.summary.finishedAt)+LIMITS.staleMs+1).stale);assert.equal(status(dir,Date.parse(f.summary.finishedAt)+1).stale,false);
});
test('existing lock, unsafe permissions, mismatched identity and disk cap fail before network',async t=>{
  const tmp=temporary(t),dir=path.join(tmp,'state');fs.mkdirSync(dir,{mode:0o700});const o=parseJobArgs(['--live','--state-dir',dir,'--vantage','fixture']);let calls=0;const deps={exec:async()=>{calls++;throw Error('unexpected network');}};
  fs.mkdirSync(path.join(dir,'.run.lock'));await assert.rejects(runJob(o,deps),/LOCKED/);assert(fs.existsSync(path.join(dir,'.run.lock')));fs.rmdirSync(path.join(dir,'.run.lock'));
  fs.chmodSync(dir,0o755);await assert.rejects(runJob(o,deps),/UNSAFE/);fs.chmodSync(dir,0o700);
  const old=evaluateAt(bundle());old.identity='elsewhere/environment-dns';fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(old));await assert.rejects(runJob(o,{...deps,now:()=>base+500000}),/IDENTITY/);fs.unlinkSync(path.join(dir,'state.json'));
  const fd=fs.openSync(path.join(dir,'bounded-sparse-test'),'wx');fs.ftruncateSync(fd,LIMITS.maxStorageBytes);fs.closeSync(fd);await assert.rejects(runJob(o,deps),/STORAGE_LIMIT/);assert.equal(calls,0);
});
test('collector failure keeps previous state and artifacts, reports unavailable not recovery',async t=>{
  const dir=temporary(t),prior=evaluateAt(bundle(1,true));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(prior));const before=fs.readFileSync(path.join(dir,'state.json'));
  await assert.rejects(runJob(parseJobArgs(['--live','--state-dir',dir,'--vantage','fixture']),{now:()=>base+500000,exec:async()=>({exitCode:1})}),/COLLECTOR/);
  assert.deepEqual(fs.readFileSync(path.join(dir,'state.json')),before);assert(!fs.existsSync(path.join(dir,'.run.lock')));
});
test('storage traversal rejects symlink without deleting target',t=>{
  const dir=temporary(t),file=path.join(dir,'target');fs.writeFileSync(file,'retain');fs.symlinkSync(file,path.join(dir,'link'));assert.throws(()=>storageUsage(dir),/SYMLINK/);assert.equal(fs.readFileSync(file,'utf8'),'retain');
});
test('fresh timestamp in malformed state cannot report a healthy heartbeat',t=>{
  const dir=temporary(t);fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({checkedAt:new Date(base).toISOString(),level:'ok'}));assert(status(dir,base+1).stale);
});
test('offline job CLI is runnable outside repository cwd',()=>{
  const script=new URL('./testnet-transport-job.mjs',import.meta.url);const r=JSON.parse(execFileSync(process.execPath,[fileURLToPath(script)],{cwd:os.tmpdir(),encoding:'utf8'}));assert.equal(r.networkRequests,0);
});
