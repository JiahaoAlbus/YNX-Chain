import path from 'node:path';
import fs from 'node:fs';

export function lightCommand(root, stoppedWindow, nativeCompile = false, clientRegression = false) {
  const env={GOMAXPROCS:'1',GOGC:'50',GOMEMLIMIT:'160MiB'};
  if(clientRegression){
    if(nativeCompile||stoppedWindow!==undefined)throw Error('client regression cannot combine native compile or stopped replay');
    const requiredPasses=['TestReadyIntentSegmentsPersistAndStreamExactSignedInputs','TestReadyIntentSegmentsNeverRetryFailedOrUncertainPersistence','TestReadyIntentSegmentsRejectMissingCorruptAndWrongBinding','TestReadySenderSegmentedIntentBarrierAndRecovery','TestReadySenderSegmentedIntentFailureNeverSubmits','TestReadyIntentFormatSelectionRejectsMixedMissingAndEscapedReceipts','TestSegmentedIntentOptionsRequireBoundedEvidenceMode','TestReadySenderFastAccountAdvancesBeforeSlowPeer','TestReadySenderReadbackBindsFixtureAndRecoversOnlyCompleteIdentities','TestReadyIntentPrefixRetainsOnlyWholeValidatedWaves','TestReadyIntentPrefixWithoutReportNeverPromotesUnknownToAcknowledged','TestReadyIntentSharedSegmentDecoderRejectsWrongPrefix','TestReadyIntentPartialSelectionRequiresPlanAndNeverDowngradesAcknowledgedCorruption'];
    return {mode:'client_regression',command:'nice',args:['-n','10','/opt/homebrew/bin/go','test','-p','1','./cmd/ynx-consensus-perf-client','-run','^('+requiredPasses.join('|')+')$','-count=1','-timeout=30s','-v'],
      env:{...env,GOPROXY:'off',GOTOOLCHAIN:'local',GOFLAGS:'-mod=readonly',GOWORK:'off'},requiredPasses,sourceCommit:'463562ad5edacd8678b00472aafdc104cc4ada7a',
      sourceTree:'6af5591869a964561d89a717a1fa13b9d029eb2b',sourcePins:{'go.mod':'b9d7b1000986dad89c87ca0a1e1758636b5f6cdc','go.sum':'4d4aa4b7ef8b33d85552eb5dc2f862efd268d4b2',internal:'d39b4a8aeff715292e54cd82a49241f80ac55e89','cmd/ynx-consensus-perf-client':'261a70b1e4f532e5b621d11b1660c5d2412b110a'},
      caps:{activeMs:30000,totalMs:45000,cleanupMs:15000,ownedRSSBytes:400*1024**2,scratchBytes:512*1024**2,threads:320,diskFloorBytes:1024**3,rootReserveBytes:425*1024**2},
      interpretation:'Only original performance-client correctness, no Protocol overlay/CI replacement, nodes or benchmark. Fixed Go source/dependencies; driver may be a clean later script-only descendant. Fresh Root scheduling and unchanged native normal pressure gate required.'};
  }
  if(nativeCompile){
    if(stoppedWindow!==undefined)throw Error('native compile and stopped replay are exclusive');
    return {mode:'native_compile',command:'nice',args:['-n','10','/usr/bin/clang','-std=c11','-Wall','-Wextra','-Werror','-O2','scripts/loadtest/darwin-process-snapshot.c','-o',path.join(root,'artifacts/chain-performance-20261017/ynx-consensus-perf-host-owned-v2')],env};
  }
  if(stoppedWindow===undefined)return {mode:'focused_go',command:'nice',args:['-n','10','/opt/homebrew/bin/go','test','-p','1','./cmd/ynx-consensus-perf-client','-run','TestTerminalStream|TestReadySender','-count=1','-timeout=45s'],env};
  const window=path.resolve(stoppedWindow);
  const relative=path.relative(path.join(root,'artifacts/chain-network-performance'),window);
  if(!/^window-[A-Za-z0-9]{6}$/.test(relative))throw Error('stopped window must be one original isolated artifact directory');
  const binary=path.join(root,'artifacts/chain-performance-20261017/partial-reconciliation-client.test');
  return {mode:'stopped_replay',command:'nice',args:['-n','10',binary,'-test.run','^(TestStoppedNetworkReplay|TestStoppedReadySenderAccountReadback)$','-test.count=1','-test.v','-test.timeout=45s'],env:{...env,YNX_CHAIN_STOPPED_WINDOW:window},window,binary,binarySHA256:'a77ce29169a4277df163a4cb4b156e32f7a7d3cf2b99bb75d1a6ae66853a19cc'};
}

export function lightScratchBytes(root,maxEntries=8192){
 let total=0,entries=0;
 function walk(p){
  if(++entries>maxEntries)throw Error('scratch inventory bound');
  const st=fs.lstatSync(p);if(st.isSymbolicLink())throw Error('scratch symlink refused');
  if(st.isDirectory()){for(const name of fs.readdirSync(p))walk(path.join(p,name));}
  else if(st.isFile()){total+=Math.max(st.size,st.blocks*512);if(!Number.isSafeInteger(total))throw Error('scratch byte accounting invalid');}
  else throw Error('scratch nonregular file refused');
 }
 walk(root);return total;
}

export function requireClientRegressionPasses(plan,stdout){
 if(typeof stdout!=='string'||/^\s*--- (?:SKIP|FAIL):/m.test(stdout))throw Error('required Go regression skipped or failed');
 const passed=[...stdout.matchAll(/^--- PASS: (Test[^ /]+) \(/gm)].map(m=>m[1]);
 if(passed.length!==plan.requiredPasses.length||new Set(passed).size!==passed.length||plan.requiredPasses.some(n=>!passed.includes(n))||!/^ok\s+github\.com\/JiahaoAlbus\/YNX-Chain\/cmd\/ynx-consensus-perf-client\s/m.test(stdout))throw Error('all thirteen actual Go passes and package terminal required');
 return passed;
}

export function remainingPhaseBudget(started,activeMs,now,phaseCapMs=activeMs){
 if(![started,activeMs,now,phaseCapMs].every(Number.isSafeInteger)||activeMs<=0||phaseCapMs<=0||now<started)throw Error('invalid active deadline budget');
 const remaining=activeMs-(now-started);
 if(remaining<=0)throw Error('client active deadline exhausted before phase');
 return Math.min(remaining,phaseCapMs);
}
export function clientRegressionArgs(plan,remainingMs){
 if(plan.mode!=='client_regression'||!Number.isSafeInteger(remainingMs)||remainingMs<=0||remainingMs>plan.caps.activeMs)throw Error('invalid remaining client Go budget');
 return plan.args.map(arg=>arg.startsWith('-timeout=')?`-timeout=${remainingMs}ms`:arg);
}

export function clientOwnedRSSCap(plan,rootCase){
 if(rootCase!==undefined&&!['client13-normal-02','client13-normal-03','client13-normal-04','client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08','client13-normal-09'].includes(rootCase))throw Error('unsupported explicit client resource case');
 if(rootCase!==undefined&&plan.mode!=='client_regression')throw Error('explicit RSS case requires fixed client regression');
 if(rootCase==='client13-normal-09')return 768*1024**2;
 return ['client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08','client13-normal-09'].includes(rootCase)?512*1024**2:400*1024**2;
}

export function lightProbeInput(root,rootCase){
 return ['client13-normal-07','client13-normal-08','client13-normal-09'].includes(rootCase)?{path:path.join(root,'artifacts/chain-performance-20261017/probe-stages-20261018-01/host-pressure-stages'),sha256:'bf8e0bbd982a64b922720218f0e3c581b27c62641f4cdc581d4e0fece31db91d'}:{path:path.join(root,'artifacts/chain-performance-20261017/ynx-consensus-perf-host-pressure'),sha256:'3025b7f5bac1220e18cac1e9e14051553d918348df07873f392f33c700ba3cc6'};
}

// Inventory original stopped data; the proof outputs live outside this set.
export async function stoppedOriginalInventory(window,deadlineAt=Infinity){
 const {createHash}=await import('node:crypto');
 const base=path.resolve(window);
 if(fs.realpathSync(base)!==base)throw Error('stopped root symlink refused');
 const manifestPath=path.join(base,'network/network-manifest.json');
 if(fs.statSync(manifestPath).size>1024*1024)throw Error('stopped manifest byte bound');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(manifest.nodes?.length!==4)throw Error('four original node identities required');
 const selected=new Set([path.join(base,'window-receipt.json'),path.join(base,'transactions-result.json'),manifestPath,path.join(base,'network/transactions.json'),path.join(base,'network/sender-ready.signed.jsonl'),manifest.migrationPath]);
 const roots=[];
 for(const node of manifest.nodes){
  selected.add(path.join(node.home,'config/genesis.json'));selected.add(path.join(node.home,'config/config.toml'));
  selected.add(node.abciStatePath);roots.push(path.join(node.home,'data'));
 }
 if(new Set(roots).size!==4)throw Error('duplicate stopped node identity');
 const check=p=>{if(Date.now()>=deadlineAt)throw Error('stopped inventory active deadline');if(typeof p!=='string'||!p.startsWith(base+path.sep)||fs.realpathSync(p)!==p)throw Error('stopped input escaped or symlinked');};
 function list(){
  const paths=new Set(selected);
  function walk(p){check(p);paths.add(p);if(paths.size>1024)throw Error('stopped file inventory bound');const st=fs.lstatSync(p);if(st.isDirectory())for(const name of fs.readdirSync(p).sort())walk(path.join(p,name));else if(!st.isFile())throw Error('stopped nonregular input');}
  for(const p of roots)walk(p);
  return [...paths].sort();
 }
 const metadata=p=>{const s=fs.lstatSync(p,{bigint:true});if(!s.isFile()&&!s.isDirectory())throw Error('stopped nonregular input');return {path:path.relative(base,p),type:s.isFile()?'file':'directory',dev:String(s.dev),inode:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs)};};
 const paths=list(),rows=[];let totalBytes=0;
 for(const p of paths){
  check(p);const before=metadata(p);
  if(before.type==='file'){
   totalBytes+=Number(before.size);if(!Number.isSafeInteger(totalBytes)||totalBytes>64*1024**2)throw Error('stopped input bytes bound');
   const h=createHash('sha256');for await(const chunk of fs.createReadStream(p,{highWaterMark:64*1024,...(Number.isFinite(deadlineAt)?{signal:AbortSignal.timeout(Math.max(1,deadlineAt-Date.now()))}:{})}))h.update(chunk);before.sha256=h.digest('hex');
  }
  if(JSON.stringify({...before,sha256:undefined})!==JSON.stringify(metadata(p)))throw Error('stopped file changed during hash');rows.push(before);
 }
 if(JSON.stringify(paths)!==JSON.stringify(list()))throw Error('stopped inventory changed during hash');
 return {root:base,totalBytes,rows};
}
export function requireSameStoppedOriginals(before,after){
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('original stopped file identity/content/inventory changed');
}
export function requireStoppedProofPasses(stdout){
 const names=['TestStoppedNetworkReplay','TestStoppedReadySenderAccountReadback'];
 const passed=[...stdout.matchAll(/^--- PASS: (Test[^ /]+) \(/gm)].map(m=>m[1]);
 if(/^\s*--- (?:FAIL|SKIP):/m.test(stdout)||passed.length!==2||names.some(n=>!passed.includes(n))||!/^PASS$/m.test(stdout))throw Error('both actual stopped proof functions must pass without skips');
 return passed;
}
