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
 assert.equal(p.mode,'client_regression');assert.equal(p.sourceCommit,'7cf9d332ddb6cd32cd7663da6dda5282d12a9b39');
 assert.equal(p.sourcePins['cmd/ynx-consensus-perf-client'],'605730a6967b987cf31e57e824de007b9015d7b4');
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
