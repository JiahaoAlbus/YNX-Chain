import test from 'node:test';
import assert from 'node:assert/strict';
import {lightCommand,lightScratchBytes,requireClientRegressionPasses} from './consensus-light-plan.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('default focused compile command and caps environment are retained',()=>{
  const p=lightCommand('/work');assert.equal(p.mode,'focused_go');assert.equal(p.args[2],'/opt/homebrew/bin/go');assert.equal(p.env.GOMEMLIMIT,'160MiB');assert.equal(p.env.GOGC,'50');assert.equal(p.env.GOMAXPROCS,'1');assert.equal(p.env.YNX_CHAIN_STOPPED_WINDOW,undefined);
});
test('stopped replay uses only the retained binary and exact two tests',()=>{
  const p=lightCommand('/work','/work/artifacts/chain-network-performance/window-eEfGE7');assert.equal(p.mode,'stopped_replay');assert.equal(p.args[2],p.binary);assert.equal(p.args[4],'^(TestStoppedNetworkReplay|TestStoppedReadySenderAccountReadback)$');assert.equal(p.env.YNX_CHAIN_STOPPED_WINDOW,p.window);assert.match(p.binarySHA256,/^[a-f0-9]{64}$/);assert.ok(!p.args.includes('go'));
});
test('stopped window rejects external paths, nested paths and empty mode',()=>{
  for(const w of ['/tmp/window-eEfGE7','/work/artifacts/chain-network-performance/window-eEfGE7/network',''])assert.throws(()=>lightCommand('/work',w));
});
test('native compile is fixed clang only and cannot combine replay',()=>{
  const p=lightCommand('/work',undefined,true);assert.equal(p.mode,'native_compile');assert.equal(p.args[2],'/usr/bin/clang');assert.ok(p.args.includes('-Werror'));assert.match(p.args.at(-1),/ynx-consensus-perf-host-owned-v2$/);assert.throws(()=>lightCommand('/work','/work/artifacts/chain-network-performance/window-eEfGE7',true));
});

test('client regression selects only the fixed thirteen functions and frozen Go source',()=>{
 const p=lightCommand('/work',undefined,false,true);
 assert.equal(p.mode,'client_regression');assert.equal(p.sourceCommit,'aa25500bdb13c52e56133ec0876651257cf31a1a');
 assert.equal(p.sourcePins['cmd/ynx-consensus-perf-client'],'1614f4ad2bc419612f3aba5bde492ad24a9920b6');
 assert.equal(p.requiredPasses.length,13);assert.equal(new Set(p.requiredPasses).size,13);
 assert.equal(p.args[p.args.indexOf('-run')+1],'^('+p.requiredPasses.join('|')+')$');
 assert.ok(p.args.includes('-timeout=30s'));assert.ok(p.args.includes('-v'));assert.equal(p.env.GOPROXY,'off');assert.equal(p.env.GOTOOLCHAIN,'local');
 assert.equal(p.caps.scratchBytes,512*1024**2);assert.equal(p.caps.activeMs,30000);assert.equal(p.caps.totalMs,45000);assert.equal(p.caps.ownedRSSBytes,400*1024**2);
 for(const [w,n]of [['/work/artifacts/chain-network-performance/window-eEfGE7',false],[undefined,true]])assert.throws(()=>lightCommand('/work',w,n,true));
});

test('scratch accounting uses actual files and refuses symlinks or oversized inventories',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-light-scratch-'));
 try{
  fs.writeFileSync(path.join(dir,'one'),'abc');assert.ok(lightScratchBytes(dir)>=3);
  assert.throws(()=>lightScratchBytes(dir,1),/inventory bound/);
  fs.symlinkSync(path.join(dir,'one'),path.join(dir,'alias'));
  assert.throws(()=>lightScratchBytes(dir),/symlink/);
 }finally{fs.rmSync(dir,{recursive:true})}
});
test('zero exit without thirteen real PASS records cannot qualify the client check',()=>{
 const plan=lightCommand('/work',undefined,false,true);
 const good=plan.requiredPasses.map(n=>'--- PASS: '+n+' (0.00s)').join('\n')+'\nok  \tgithub.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-perf-client\t0.1s\n';
 assert.deepEqual(requireClientRegressionPasses(plan,good),plan.requiredPasses);
 for(const bad of [good.replace(plan.requiredPasses[0],'TestNotSelected'),good+'--- PASS: '+plan.requiredPasses[0]+' (0.00s)\n',good+'    --- SKIP: TestSubcase (0.00s)\n',good.replace(/^ok.*$/m,''),'PASS\n'])assert.throws(()=>requireClientRegressionPasses(plan,bad));
});

test('cache scans and Go consume one active deadline without restarting it',async()=>{
 const {remainingPhaseBudget,clientRegressionArgs}=await import('./consensus-light-plan.mjs');
 const plan=lightCommand('/work',undefined,false,true), started=1000;
 assert.equal(remainingPhaseBudget(started,plan.caps.activeMs,1300,12000),12000);
 const args=clientRegressionArgs(plan,remainingPhaseBudget(started,30000,14300));
 assert.ok(args.includes('-timeout=16700ms'));
 assert.equal(args.filter(x=>x.startsWith('-timeout=')).length,1);
 assert.equal(remainingPhaseBudget(started,30000,29300,12000),1700);
 assert.throws(()=>remainingPhaseBudget(started,30000,31000,12000),/active deadline/);
 assert.throws(()=>remainingPhaseBudget(started,30000,32000),/active deadline/);
 assert.equal(plan.args.includes('-timeout=30s'),true);
 assert.deepEqual(args.filter(x=>!x.startsWith('-timeout=')),plan.args.filter(x=>!x.startsWith('-timeout=')));
 for(const bad of [0,-1,NaN,Infinity])assert.throws(()=>clientRegressionArgs(plan,bad));
});

test('only explicit fixed normal05 and normal06 raise owned RSS; other resource gates remain intact',async()=>{
 const {clientOwnedRSSCap}=await import('./consensus-light-plan.mjs');
 const p=lightCommand('/work',undefined,false,true);
 assert.equal(clientOwnedRSSCap(p,undefined),400*1024**2);
 for(const c of ['client13-normal-02','client13-normal-03','client13-normal-04'])assert.equal(clientOwnedRSSCap(p,c),400*1024**2);
 for(const c of ['client13-normal-05','client13-normal-06'])assert.equal(clientOwnedRSSCap(p,c),512*1024**2);
 assert.throws(()=>clientOwnedRSSCap(lightCommand('/work'),'client13-normal-05'));
 assert.throws(()=>clientOwnedRSSCap(p,'unknown-case'));
 assert.equal(p.caps.ownedRSSBytes,400*1024**2);
 assert.equal(p.caps.scratchBytes,512*1024**2);
 assert.equal(p.caps.activeMs,30000);assert.equal(p.caps.totalMs,45000);
 assert.equal(p.env.GOMEMLIMIT,'160MiB');assert.equal(p.requiredPasses.length,13);
});
