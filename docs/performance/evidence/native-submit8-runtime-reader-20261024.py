"""Read the fixed f72 native4/8-submit actual pair and eight original node logs; no workload, fallback or external writes.
Arguments: pair, before receipt, after receipt, before client, after client,
before fixture, after fixture, original CI log, new readout.
"""
import hashlib,importlib.util,json,math,sys,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SOURCE='f72a3d5c71150471429db753f71e0114c759ab2c'
VALIDATION_PINS=[]
for relative in ('scripts/loadtest/supply-linux-window.py','scripts/loadtest/pq-paired-linux-window.py','scripts/loadtest/node-phase-timing.mjs'):
 current=(ROOT/relative).read_bytes()
 committed=subprocess.check_output(['git','show',SOURCE+':'+relative],cwd=ROOT,timeout=5)
 if current!=committed:raise RuntimeError('fixed verifier dependency source differs: '+relative)
 VALIDATION_PINS.append(dict(path=relative,bytes=len(current),sha256=hashlib.sha256(current).hexdigest()))
spec=importlib.util.spec_from_file_location('supply',ROOT/'scripts/loadtest/supply-linux-window.py')
supply=importlib.util.module_from_spec(spec);spec.loader.exec_module(supply)
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def frames(log,prefix):
 return [json.loads(line.split(prefix,1)[1]) for line in log.splitlines() if prefix in line and '\x1b' not in line]
def cpu_identity(host):
 fields={'vendor_id','cpu family','model','model name','stepping','cpu cores','siblings'}
 return sorted(set(line for line in host['cpuinfo'].splitlines() if line.split(':',1)[0].strip() in fields))
def read_pair(paths):
 pp,bp,ap,bc,ac,bf,af,lp=map(Path,paths)
 pair=json.loads(pp.read_bytes());log=lp.read_text()
 terminal=frames(log,'YNX_SUPPLY_PAIR_TERMINAL ')
 if len(terminal)!=1:raise RuntimeError('one original postfsync pair terminal required')
 terminal=terminal[0];plan=supply.pair_recipe('native-submit8-data64')
 if (not terminal.get('qualified') or terminal.get('firstCause') is not None or terminal.get('casesQualified') is not True
     or terminal.get('pairReceiptSHA256')!=pin(pp)['sha256'] or not 0<=terminal.get('elapsedMs',-1)<=120000
     or not 0<=terminal.get('retainedBytesAfterFsync',-1)<=128<<20):raise RuntimeError('unqualified actual pair terminal/hash/caps')
 if (pair.get('firstCause') is not None or pair.get('casesQualified') is not True or pair.get('sourceCommit')!=SOURCE
     or pair.get('kind')!=plan['kind'] or pair.get('pairCaps')!=plan['pairCaps'] or len(pair.get('cases',[]))!=2
     or pair.get('preparedCases')!=plan['cases'] or len(pair.get('closureScans',[]))!=2):raise RuntimeError('fixed actual pair identity differs')
 for scans in pair['closureScans']:
  if len(scans)!=2 or any(s.get('owned')!=[pair['launcher']] for s in scans) or scans[0].get('launcherStartTicks')!=scans[1].get('launcherStartTicks'):raise RuntimeError('pair two scans must contain only original launcher')
 case_terms=frames(log,'YNX_ONESHOT_1000_TERMINAL ')
 if len(case_terms)!=2:raise RuntimeError('two original case postfsync terminals required')
 result=dict(schema=1,kind='actual-finite-same-VM-native-submit8-data64-pair',sourceCommit=SOURCE,terminal=terminal,host=pair['host'],compiler=pair['compiler'],binaries=pair['compiledBinaries'],cases=[],raw=[pin(Path(p)) for p in paths],sustainedTPSQualified=False)
 before=None
 for index,(rp,cp,fp,mode) in enumerate(zip((bp,ap),(bc,ac),(bf,af),('native-submit4','native-submit8'))):
  case=json.loads(rp.read_bytes());client=json.loads(cp.read_bytes());fixture_raw=fp.read_bytes();fixture=json.loads(fixture_raw)['transactions'];manifest=pair['cases'][index];ct=case_terms[index]
  if (manifest.get('order')!=index+1 or manifest.get('mode')!=mode or manifest.get('code')!=0
      or not 0<=manifest.get('invocationElapsedMs',-1)<=60000 or manifest.get('sha256')!=pin(rp)['sha256']
      or case.get('resultSHA256')!=pin(cp)['sha256'] or case.get('binaries')!=pair['compiledBinaries']
      or case.get('sourceCommit')!=SOURCE or case.get('internalTree')!='af2931e0c9109da5ef37d947894bfbe92aa1418b'):raise RuntimeError('actual case original order/identity/hash/cap differs')
  if (ct.get('qualified') is not True or ct.get('firstCause') is not None or ct.get('nodesStarted') is not True
      or ct.get('receiptSHA256')!=pin(rp)['sha256'] or not 0<=ct.get('elapsedMs',-1)<=60000 or ct.get('refusedSamples')):raise RuntimeError('actual case postfsync terminal unqualified')
  supply.pair_case_qualified(case,'relative','supply-2048x1-data64',2048,native_submit8=index==1)
  for sample in case['samples']+[ct['postFsyncSample']]:
   supply.enforce_captured_sample(sample,{'profile':case['profile']})
   if len(sample.get('tasks',[]))>10:raise RuntimeError('strict actual owned10 cap exceeded')
  timeline=case.get('timeline',[])
  starts=[x for x in timeline if x['phase']=='cleanup_start']
  ends=[x for x in timeline if x['phase']=='cleanup_complete']
  if len(starts)!=1 or len(ends)!=1 or starts[0]['elapsedNs']>45_000_000_000 or not 0<=ends[0]['elapsedNs']-starts[0]['elapsedNs']<=15_000_000_000:raise RuntimeError('strict actual active45/cleanup15 scope unqualified')
  scans=case.get('closureScans',[])
  if len(scans)<2 or any(s.get('owned')!=[pair['launcher']] for s in scans[-2:]) or scans[-1].get('launcherStartTicks')!=scans[-2].get('launcherStartTicks'):raise RuntimeError('case two scans must contain only original launcher')
  fr=case.get('fixtureResources',{})
  pins=[p for p in fr.get('files',[]) if p.get('path')=='transactions.json']
  if (fr.get('independentSenders')!=2048 or fr.get('transactions')!=2048 or fr.get('nonce')!=1 or fr.get('recipients')!=1 or fr.get('nodesStarted') is not False
      or len(pins)!=1 or pins[0]['sha256']!=pin(fp)['sha256'] or pins[0]['bytes']!=len(fixture_raw)):raise RuntimeError('original fixture scope/file hash differs')
  measured=supply.validate_report(client,'supply-2048x1-data64','relative',fixture_transactions=fixture,prefix_replay=True,prefix_native_clone=True,native_submit8=index==1,require_inventory=True)
  phases=supply.validate_observer_phases(client);shared=supply.validate_shared_replay(client,False);prefix=supply.validate_prefix_replay(client,True,require_work_phases=True,expected_native_clone=True)
  runtime=supply.validate_runtime_measurements(client,2048,require=True,native_submit8=index==1)
  worker_selection=supply.validate_submitter_selection(client,index==1,require_inventory=True)
  if (case.get("nativeSubmit8",False) is not (index==1) or case.get("prefixDurableReplay",False) is not True
      or case.get("prefixNativeClone",False) is not True or case.get("sharedDurableReplay") is not False):raise RuntimeError("original case submit8/native backend mode differs")
  inclusive=supply.offer_latency_readout(client,2048);submission=supply.validate_submission_phases(client,2048)
  if (measured!=case['measurement'] or inclusive!=manifest.get('offerLatency') or phases!=case.get('observerPhases') or phases!=manifest.get('observerPhases')
      or shared!=case.get('sharedReplayVerification') or shared!=manifest.get('sharedReplayVerification') or prefix!=manifest.get('prefixReplayVerification')
      or runtime!=case.get('runtimeMeasurements') or runtime!=manifest.get('runtimeMeasurements') or client['durableReadback']!=manifest.get('durableReadback') or submission!=manifest.get('submissionPhaseVerification')):raise RuntimeError('actual raw business/backend/phase/latency facts differ')
  if any(n.get('validationCommitSamples')!=n.get('commitAttempts') or set(n.get('validationTotalsNs',{}))!={'semantics','app_hash'} for n in case['nodePhases']):raise RuntimeError('actual four node validation child phases missing')
  # Original strict node parser checks every frame and valid zero-inflight
  # shutdown. Only after equality is established derive all-sample quantiles.
  node_paths=[rp.parent/(('before' if index==0 else 'after')+'-abci-'+str(n)+'.log') for n in range(4)]
  code="import{readNodePhaseTiming as r}from './scripts/loadtest/node-phase-timing.mjs';import fs from'node:fs';console.log(JSON.stringify(process.argv.slice(1).map(p=>r(fs.readFileSync(p,'utf8')))));"
  parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',code]+[str(p.resolve()) for p in node_paths],cwd=ROOT,timeout=10))
  if parsed!=case['nodePhases']:raise RuntimeError('actual original four node logs differ from receipt')
  groups={};node_raw=[]
  for node_path in node_paths:
   node_raw.append(pin(node_path))
   for line in node_path.read_text().splitlines():
    if not line.startswith('YNX_ABCI_PHASE_TIMING '):continue
    frame=json.loads(line.split('YNX_ABCI_PHASE_TIMING ',1)[1])
    if frame['reason']!='commit':continue
    commit=frame['commit'];groups.setdefault('commit',[]).append(commit['elapsedNs'])
    for key,value in commit['stagesNs'].items():groups.setdefault(key,[]).append(value)
    for key,value in commit['validationStagesNs'].items():groups.setdefault('validate.'+key,[]).append(value)
  def distribution(values):
   ordered=sorted(values)
   def q(p):return ordered[max(0,math.ceil(p*len(ordered))-1)]/1e6
   return dict(samples=len(values),totalNs=sum(values),meanMs=sum(values)/len(values)/1e6,minMs=q(0),p50Ms=q(.5),p95Ms=q(.95),p99Ms=q(.99),maxMs=q(1))
  node_distribution=dict(raw=node_raw,phases={key:distribution(values) for key,values in groups.items()},limits='All original Commit samples including empty blocks; nearest rank. Nested children already included in validate; parallel node totals are not client finality.')
  if before is not None:
   for k in ('sourceCommit','sourceTree','internalTree','compiler','binaries','environment'):
    if case[k]!=before[k]:raise RuntimeError('pair identity differs: '+k)
   if cpu_identity(case['host'])!=cpu_identity(before['host']):raise RuntimeError('actual CPU identity changed')
   for k in ('uname','cpuCount'):
    if case['host'][k]!=before['host'][k]:raise RuntimeError('pair actual VM CPU identity differs: '+k)
  before=case
  result['cases'].append(dict(mode=mode,submitterVerification=worker_selection,summary=client['summary'],measurement=measured,offerLatency=inclusive,observerPhases=phases,durableReadback=client['durableReadback'],sharedReplayVerification=shared,prefixReplayVerification=prefix,submissionPhaseVerification=submission,runtimeMeasurements=runtime,nodePhases=case['nodePhases'],nodeDistributions=node_distribution,host=case['host'],environment=case['environment'],terminal=ct,closureScans=scans,peaks={k:max(s[k] for s in case['samples']+[ct['postFsyncSample']]) for k in ('rssBytes','threads','privateBytes','buildBytes')}))
 result['closureInterpretation']=dict(nodeAndWorkerDescendantsAbsent=True, scansRetainOriginalLauncher=True, launcherPID=pair['launcher'], launcherExitObservedByProcScan=False, limits='Two scans retain exactly the original launcher with stable startTicks. These are not a wholly empty process group or a direct launcher-exit observation. Original normal workflow-step completion and terminal job success are separate evidence.')
 terminal_path=lp.with_name('run39982425900-terminal.json')
 terminal_run=json.loads(terminal_path.read_bytes())
 if terminal_run.get('status')!='completed' or terminal_run.get('conclusion')!='success' or terminal_run.get('headSha')!=SOURCE or terminal_run.get('attempt')!=1:raise RuntimeError('original workflow terminal identity differs')
 result['originalWorkflowTerminal']={**pin(terminal_path),'record':terminal_run}
 result['fullOriginalBusinessRawReadoutPending']=False
 result['validationSourcePins']=VALIDATION_PINS
 result['verifier']=pin(Path(__file__).resolve())
 result['jointObservation']=supply.joint_observation(*result['cases'])
 if result['jointObservation']!=pair.get('jointObservation'):raise RuntimeError('actual joint finite verdict differs')
 old,new=result['cases']
 result['finiteObservedChanges']=dict(finalRatePercent=(new['summary']['finalSubmittedPerMeasurementSecond']/old['summary']['finalSubmittedPerMeasurementSecond']-1)*100,offerToFinalP95Percent=(new['offerLatency']['offerToQualifiedFinalLatencyMs']['p95']/old['offerLatency']['offerToQualifiedFinalLatencyMs']['p95']-1)*100)
 result['limits']='One fixed-order finite2048/case pair, fresh identities/startup/block scheduling differ. No ten-minute sustained1000TPS or default promotion. Queue-inclusive client observed final completion is distinct from internal two-thirds vote instant. Sampled RSS is not a hard instantaneous bound; nested/parallel times are not additive.'
 return result
if __name__=='__main__':
 if len(sys.argv)!=10:raise SystemExit(__doc__)
 out=Path(sys.argv[-1]);result=read_pair(sys.argv[1:-1])
 with out.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
