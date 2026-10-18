import path from 'node:path';
import fs from 'node:fs';

export function lightCommand(root, stoppedWindow, nativeCompile = false, clientRegression = false) {
  const env={GOMAXPROCS:'1',GOGC:'50',GOMEMLIMIT:'160MiB'};
  if(clientRegression){
    if(nativeCompile||stoppedWindow!==undefined)throw Error('client regression cannot combine native compile or stopped replay');
    const requiredPasses=['TestReadyIntentSegmentsPersistAndStreamExactSignedInputs','TestReadyIntentSegmentsNeverRetryFailedOrUncertainPersistence','TestReadyIntentSegmentsRejectMissingCorruptAndWrongBinding','TestReadySenderSegmentedIntentBarrierAndRecovery','TestReadySenderSegmentedIntentFailureNeverSubmits','TestReadyIntentFormatSelectionRejectsMixedMissingAndEscapedReceipts','TestSegmentedIntentOptionsRequireBoundedEvidenceMode','TestReadySenderFastAccountAdvancesBeforeSlowPeer','TestReadySenderReadbackBindsFixtureAndRecoversOnlyCompleteIdentities','TestReadyIntentPrefixRetainsOnlyWholeValidatedWaves','TestReadyIntentPrefixWithoutReportNeverPromotesUnknownToAcknowledged','TestReadyIntentSharedSegmentDecoderRejectsWrongPrefix','TestReadyIntentPartialSelectionRequiresPlanAndNeverDowngradesAcknowledgedCorruption'];
    return {mode:'client_regression',command:'nice',args:['-n','10','/opt/homebrew/bin/go','test','-p','1','./cmd/ynx-consensus-perf-client','-run','^('+requiredPasses.join('|')+')$','-count=1','-timeout=30s','-v'],
      env:{...env,GOPROXY:'off',GOTOOLCHAIN:'local',GOFLAGS:'-mod=readonly',GOWORK:'off'},requiredPasses,sourceCommit:'7cf9d332ddb6cd32cd7663da6dda5282d12a9b39',
      sourceTree:'124d2521d783c7dc91370a5b031342aa84bad8a2',sourcePins:{'go.mod':'b9d7b1000986dad89c87ca0a1e1758636b5f6cdc','go.sum':'4d4aa4b7ef8b33d85552eb5dc2f862efd268d4b2',internal:'d39b4a8aeff715292e54cd82a49241f80ac55e89','cmd/ynx-consensus-perf-client':'605730a6967b987cf31e57e824de007b9015d7b4'},
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
