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
 assert.equal(p.mode,'client_regression');assert.equal(p.sourceCommit,'463562ad5edacd8678b00472aafdc104cc4ada7a');
 assert.equal(p.sourcePins['cmd/ynx-consensus-perf-client'],'261a70b1e4f532e5b621d11b1660c5d2412b110a');
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

test('normal07 binds the actual instrumented probe while defaults retain the frozen binary',async()=>{
 const {lightProbeInput,clientOwnedRSSCap}=await import('./consensus-light-plan.mjs');
 assert.deepEqual(lightProbeInput('/work','client13-normal-07'),{path:'/work/artifacts/chain-performance-20261017/probe-stages-20261018-01/host-pressure-stages',sha256:'bf8e0bbd982a64b922720218f0e3c581b27c62641f4cdc581d4e0fece31db91d'});
 assert.deepEqual(lightProbeInput('/work'),{path:'/work/artifacts/chain-performance-20261017/ynx-consensus-perf-host-pressure',sha256:'3025b7f5bac1220e18cac1e9e14051553d918348df07873f392f33c700ba3cc6'});
 const p=lightCommand('/work',undefined,false,true);
 for(const c of ['client13-normal-07','client13-normal-08']){
 assert.equal(clientOwnedRSSCap(p,c),512*1024**2);
 assert.deepEqual(lightProbeInput('/work',c),lightProbeInput('/work','client13-normal-07'));
 }
 assert.equal(p.caps.ownedRSSBytes,400*1024**2);
});

test('normal09 alone receives 768MiB without changing prior caps or fixed workload',async()=>{
 const {clientOwnedRSSCap,lightProbeInput}=await import('./consensus-light-plan.mjs');
 const p=lightCommand('/work',undefined,false,true);
 assert.equal(clientOwnedRSSCap(p,'client13-normal-09'),805306368);
 for(const c of ['client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08'])assert.equal(clientOwnedRSSCap(p,c),536870912);
 assert.equal(clientOwnedRSSCap(p),419430400);
 assert.deepEqual(lightProbeInput('/work','client13-normal-09'),lightProbeInput('/work','client13-normal-07'));
 assert.equal(p.requiredPasses.length,13);assert.equal(p.sourceCommit,'463562ad5edacd8678b00472aafdc104cc4ada7a');
 assert.equal(p.caps.scratchBytes,536870912);assert.equal(p.caps.activeMs,30000);assert.equal(p.caps.totalMs,45000);
 assert.equal(p.env.GOMEMLIMIT,'160MiB');assert.equal(p.env.GOPROXY,'off');
});

test('stopped proof requires both real functions and refuses skip/partial output',async()=>{
 const {requireStoppedProofPasses}=await import('./consensus-light-plan.mjs');
 const s='--- PASS: TestStoppedNetworkReplay (0.1s)\n--- PASS: TestStoppedReadySenderAccountReadback (0.1s)\nPASS\n';
 assert.equal(requireStoppedProofPasses(s).length,2);
 for(const bad of [s.replace('--- PASS: TestStoppedNetworkReplay','--- SKIP: TestStoppedNetworkReplay'),s.replace('TestStoppedReadySenderAccountReadback','TestOther'),s+'--- FAIL: TestOther (0.1s)\n'])assert.throws(()=>requireStoppedProofPasses(bad));
});
test('stopped original identity gate rejects replacement, content, mtime and inventory changes',async()=>{
 const {requireSameStoppedOriginals}=await import('./consensus-light-plan.mjs');
 const before={root:'/window',rows:[{path:'db/CURRENT',inode:'1',dev:'2',size:'4',mtimeNs:'5',sha256:'original'}]};
 requireSameStoppedOriginals(before,structuredClone(before));
 for(const [key,value]of [['inode','99'],['sha256','changed'],['mtimeNs','6'],['dev','3'],['size','5']]){const after=structuredClone(before);after.rows[0][key]=value;assert.throws(()=>requireSameStoppedOriginals(before,after));}
 const after=structuredClone(before);after.rows.push({path:'new'});assert.throws(()=>requireSameStoppedOriginals(before,after));
});

test('real filesystem inventory detects same-name replacement and refuses missing or symlinked originals',async()=>{
 const {stoppedOriginalInventory,requireSameStoppedOriginals}=await import('./consensus-light-plan.mjs');
 const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-stopped-identity-')));
 try{
  const network=path.join(base,'network');fs.mkdirSync(network);
  for(const file of ['window-receipt.json','transactions-result.json'])fs.writeFileSync(path.join(base,file),'{}');
  for(const file of ['transactions.json','sender-ready.signed.jsonl','migration.json'])fs.writeFileSync(path.join(network,file),'{}');
  const nodes=[];
  for(let i=0;i<4;i++){const home=path.join(network,'n'+i);fs.mkdirSync(path.join(home,'config'),{recursive:true});fs.mkdirSync(path.join(home,'data/blockstore.db'),{recursive:true});for(const file of ['genesis.json','config.toml'])fs.writeFileSync(path.join(home,'config',file),'{}');const state=path.join(home,'data/state');fs.writeFileSync(state,'state');fs.writeFileSync(path.join(home,'data/blockstore.db/CURRENT'),'db');nodes.push({home,abciStatePath:state});}
  fs.writeFileSync(path.join(network,'network-manifest.json'),JSON.stringify({migrationPath:path.join(network,'migration.json'),nodes}));
  const before=await stoppedOriginalInventory(base);requireSameStoppedOriginals(before,await stoppedOriginalInventory(base));
  const original=nodes[0].abciStatePath;fs.renameSync(original,original+'.retired');fs.writeFileSync(original,'state');
  assert.throws(()=>requireSameStoppedOriginals(before,{...before,rows:[]}));
  assert.notDeepEqual(before,await stoppedOriginalInventory(base));
  fs.unlinkSync(original);fs.symlinkSync(original+'.retired',original);
  await assert.rejects(stoppedOriginalInventory(base),/symlinked/);
  fs.unlinkSync(original);await assert.rejects(stoppedOriginalInventory(base));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('offline exception is prepare-only and limited to exact original window and receipt',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const runner=fileURLToPath(new URL('./consensus-light-window.mjs',import.meta.url));
 const base=['--offline-baseline-stopped-01','--stopped-window',path.join(process.cwd(),'artifacts/chain-network-performance/window-eEfGE7'),'--output','artifacts/chain-performance-20261017/offline-baseline-stopped-20261018-01.json'];
 const run=args=>spawnSync(process.execPath,[runner,...args],{encoding:'utf8',timeout:3000});
 const good=run(base);assert.equal(good.status,0,good.stderr);const result=JSON.parse(good.stdout);assert.equal(result.status,'prepared_only_no_processes_started');assert.equal(result.ownedRSSCapBytes,419430400);assert.equal(result.offlineCaps.totalMs,60000);
 const wrong=[...base];wrong[2]=path.join(process.cwd(),'artifacts/chain-network-performance/window-AAAAAA');
 assert.notEqual(run(wrong).status,0);assert.notEqual(run([...base,'--client-regression']).status,0);
 const other=[...base];other[4]='artifacts/chain-performance-20261017/other.json';assert.notEqual(run(other).status,0);
});

test('normal10 keeps the new phase source and fixed13 while only its explicit cap is768MiB',async()=>{
 const {clientOwnedRSSCap,lightProbeInput}=await import('./consensus-light-plan.mjs'),p=lightCommand('/work',undefined,false,true);
 assert.equal(p.sourceCommit,'463562ad5edacd8678b00472aafdc104cc4ada7a');assert.equal(p.sourcePins['cmd/ynx-consensus-perf-client'],'261a70b1e4f532e5b621d11b1660c5d2412b110a');
 assert.equal(p.requiredPasses.length,13);assert.equal(p.caps.activeMs,30000);assert.equal(p.caps.totalMs,45000);assert.equal(p.caps.scratchBytes,536870912);assert.equal(p.env.GOMEMLIMIT,'160MiB');
 assert.equal(clientOwnedRSSCap(p,'client13-normal-10'),805306368);assert.equal(clientOwnedRSSCap(p),419430400);
 assert.deepEqual(lightProbeInput('/work','client13-normal-10'),lightProbeInput('/work','client13-normal-09'));
});
