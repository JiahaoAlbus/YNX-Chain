import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./consensus-local-window.mjs', import.meta.url));
test('expanded plans remain prepare-only and do not expand resource budgets', { skip: process.platform !== 'darwin' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-window-plan-'));
  try {
    for (const name of ['ynx-consensus-perf-fixture', 'ynx-abci', 'ynx-consensus-perf-client', 'ynx-consensus-perf-host', 'cometbft']) {
      // Empty executables deliberately cannot produce a valid fixture/node.
      // Preparation must only inspect them, never run them or create data.
      fs.writeFileSync(path.join(root, name), '', { mode: 0o700 });
    }
    const work = path.join(root, 'must-not-exist');
    for (const [count, rate] of [[512, 256], [1024, 1000], [2048, 1000]]) {
      const r = spawnSync(process.execPath, [runner, '--count', String(count), '--offered-rate', String(rate), '--bin-dir', root, '--comet-bin', path.join(root, 'cometbft'), '--work-parent', work], { encoding: 'utf8', timeout: 5000 });
      assert.equal(r.status, 0, r.stderr);
      const plan = JSON.parse(r.stdout);
      assert.equal(plan.status, 'prepared_only_no_processes_started');
      assert.equal(plan.count, count);
	  assert.equal(plan.stateLayout,'atomic-json');
      assert.equal(plan.caps.rssBytes, 1024 ** 3);
      assert.equal(plan.caps.dataBytes, 32 * 1024 ** 2);
      assert.equal(plan.caps.activeMs, 45000);
      assert.equal(plan.caps.cleanupMs, 15000);
      assert.equal(plan.caps.rootDiskReserveBytes, 425 * 1024 ** 2);
      assert.equal(plan.caps.gogc, '100');
      assert.equal(plan.caps.gomemlimit, 'off');
      assert.equal(fs.existsSync(work), false);
    }
	for (const layout of ['snapshot-journal','block-journal','unsafe-layout']) {
		const r=spawnSync(process.execPath,[runner,'--count','32','--rounds','2','--offered-rate','128','--state-layout',layout,'--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work],{encoding:'utf8',timeout:5000});
		assert.equal(r.status===0,['snapshot-journal','block-journal'].includes(layout),r.stderr);
		if(r.status===0){const plan=JSON.parse(r.stdout);assert.equal(plan.stateLayout,layout);assert.equal(plan.totalTransactions,64);assert.equal(plan.caps.dataBytes,32*1024**2);assert.equal(plan.caps.rssBytes,1024**3);}
		assert.equal(fs.existsSync(work),false);
	}
    for (const [count, rate] of [[0, 1], [2049, 1000], [1.5, 1], [32, 'NaN'], [32, 2049], [2048, 1]]) {
      const r = spawnSync(process.execPath, [runner, '--count', String(count), '--offered-rate', String(rate), '--bin-dir', root, '--comet-bin', path.join(root, 'cometbft'), '--work-parent', work], { encoding: 'utf8', timeout: 5000 });
      assert.notEqual(r.status, 0);
      assert.equal(fs.existsSync(work), false);
    }
	for (const [count,rounds,rate,ok] of [[32,2,128,true],[64,4,128,true],[64,32,1000,true],[65,32,1000,false],[32,33,128,false],[32,0,128,false],[256,8,128,false]]) {
		const r=spawnSync(process.execPath,[runner,'--count',String(count),'--rounds',String(rounds),'--offered-rate',String(rate),'--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work],{encoding:'utf8',timeout:5000});
		assert.equal(r.status===0,ok,r.stderr);
		if(ok){const plan=JSON.parse(r.stdout);assert.equal(plan.rounds,rounds);assert.equal(plan.totalTransactions,count*rounds);assert.equal(plan.caps.clientTimeout,'10s');assert.equal(plan.caps.rssBytes,1024**3);assert.equal(plan.caps.dataBytes,32*1024**2);}
		assert.equal(fs.existsSync(work),false);
	}
	for(const [mode,rounds,rate,ok] of [['ready-pool',4,128,true],['ready-pool',1,128,false],['ready-pool',4,0,false],['other',4,128,false]]){
		const r=spawnSync(process.execPath,[runner,'--count','32','--rounds',String(rounds),'--offered-rate',String(rate),'--sender-mode',mode,'--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work],{encoding:'utf8',timeout:5000});
		assert.equal(r.status===0,ok,r.stderr);
		if(ok){const p=JSON.parse(r.stdout);assert.equal(p.senderMode,mode);assert.equal(p.totalTransactions,128);assert.equal(p.caps.clientTimeout,'10s');assert.equal(p.caps.rssBytes,1024**3);assert.equal(p.caps.dataBytes,32*1024**2);}
		assert.equal(fs.existsSync(work),false);
	}
	for(const [mode,rate,ok] of [['block-scan',256,true],['block-scan',0,false],['other',256,false]]){
		const r=spawnSync(process.execPath,[runner,'--count','128','--rounds','4','--sender-mode','ready-pool','--inclusion-mode',mode,'--offered-rate',String(rate),'--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work],{encoding:'utf8',timeout:5000});
		assert.equal(r.status===0,ok,r.stderr);
		if(ok){const p=JSON.parse(r.stdout);assert.equal(p.inclusionMode,'block-scan');assert.equal(p.senderMode,'ready-pool');assert.equal(p.totalTransactions,512);assert.equal(p.caps.clientObservers,4);assert.equal(p.caps.clientTimeout,'10s');assert.equal(p.caps.dataBytes,32*1024**2);}
		assert.equal(fs.existsSync(work),false);
	}
    for (const [terminal,slots,mode,ok] of [[false,false,'ready-pool',true],[true,false,'ready-pool',true],[true,true,'ready-pool',true],[false,true,'ready-pool',false],[true,false,'rounds',false]]) {
      const result=spawnSync(process.execPath,[runner,'--count','32','--rounds','2','--offered-rate','128','--sender-mode',mode,...(terminal?['--terminal-stream']:[]),...(slots?['--reuse-result-slots']:[]),'--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work],{encoding:'utf8',timeout:5000});
      assert.equal(result.status===0,ok,result.stderr);
      if(ok){const plan=JSON.parse(result.stdout);assert.equal(plan.terminalStream,terminal);assert.equal(plan.reuseResultSlots,slots);assert.equal(plan.totalTransactions,64);assert.equal(plan.caps.activeMs,45000);assert.equal(plan.caps.cleanupMs,15000);assert.equal(plan.caps.rssBytes,1024**3);assert.equal(plan.caps.dataBytes,32*1024**2);assert.equal(plan.caps.clientTimeout,'10s');}
      assert.equal(fs.existsSync(work),false);
    }
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('segmented intent plans preserve the exact client arguments and finite budgets', {skip:process.platform!=='darwin'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-segment-plan-'));
 try{
  for(const name of ['ynx-consensus-perf-fixture','ynx-abci','ynx-consensus-perf-client','ynx-consensus-perf-host','cometbft'])fs.writeFileSync(path.join(root,name),'',{mode:0o700});
  const work=path.join(root,'must-not-exist');
  const common=[runner,'--count','32','--rounds','2','--offered-rate','128','--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work];
  for(const [terminal,slots,mode,ok] of [[true,true,'ready-pool',true],[false,true,'ready-pool',false],[true,false,'ready-pool',false],[true,true,'rounds',false]]){
   const r=spawnSync(process.execPath,[...common,'--sender-mode',mode,'--segmented-intents',...(terminal?['--terminal-stream']:[]),...(slots?['--reuse-result-slots']:[])],{encoding:'utf8',timeout:5000});
   assert.equal(r.status===0,ok,r.stderr);
   if(ok){const p=JSON.parse(r.stdout);assert.equal(p.status,'prepared_only_no_processes_started');assert.equal(p.segmentedIntents,true);assert.deepEqual(p.clientModeArguments,['-sender-mode','ready-pool','-terminal-stream','-reuse-result-slots','-segmented-intents']);assert.equal(p.totalTransactions,64);assert.equal(p.caps.rssBytes,1024**3);assert.equal(p.caps.dataBytes,32*1024**2);assert.equal(p.caps.activeMs,45000);assert.equal(p.caps.clientTimeout,'10s');}
   assert.equal(fs.existsSync(work),false);
  }
  const ordinary=spawnSync(process.execPath,[...common],{encoding:'utf8',timeout:5000});
  assert.equal(ordinary.status,0,ordinary.stderr);
  const p=JSON.parse(ordinary.stdout);assert.equal(p.segmentedIntents,false);assert.deepEqual(p.clientModeArguments,[]);assert.equal(fs.existsSync(work),false);
 }finally{fs.rmSync(root,{recursive:true})}
});

test('persistent sampling is explicit and preparation launches no process', {skip:process.platform!=='darwin'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-persistent-plan-'));
 try{
  for(const name of ['ynx-consensus-perf-fixture','ynx-abci','ynx-consensus-perf-client','ynx-consensus-perf-host','cometbft'])fs.writeFileSync(path.join(root,name),'',{mode:0o700});
  const work=path.join(root,'must-not-exist');
  const args=[runner,'--bin-dir',root,'--comet-bin',path.join(root,'cometbft'),'--work-parent',work];
  for(const persistent of [false,true]){
   const r=spawnSync(process.execPath,[...args,...(persistent?['--persistent-native-probe']:[])],{encoding:'utf8',timeout:5000});
   assert.equal(r.status,0,r.stderr);const plan=JSON.parse(r.stdout);
   assert.equal(plan.status,'prepared_only_no_processes_started');assert.equal(plan.nativeProbeMode,persistent?'persistent':'per-sample');assert.equal(fs.existsSync(work),false);
   assert.equal(plan.caps.activeMs,45000);assert.equal(plan.caps.rssBytes,1024**3);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
