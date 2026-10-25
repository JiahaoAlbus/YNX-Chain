"""Original granted client-procs pair resource/stream/source/node qualification.
Arguments: frozen packet, original run root, NEW output, node audit bytes, SHA.
Never starts nodes or network requests. A failed/UNKNOWN original run stays failed.
"""
import datetime,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
base,root,out=map(lambda p:Path(p).absolute(),sys.argv[1:4]);capture=root/'capture';logpath=root/'paired-ci-full.raw';runpath=root/'actual-run-completed.json'
audit_bytes=int(sys.argv[4]);audit_sha=sys.argv[5]
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def read(path):return json.loads(path.read_bytes())
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def exact(ref):
 p=Path(ref['path'])
 if p==Path('/Users/huangjiahao/.codex/worktrees/chain-performance-20261017/YNX Chain/scripts/verify/perf-prefix-replay-candidate-check.mjs'):
  p=base/'source-guard-at-source-31fe7b86ca.mjs'
  assert p.read_bytes()==subprocess.check_output(['git','show','31fe7b86ca74c290dfcd410eea27d1b44f379b31:scripts/verify/perf-prefix-replay-candidate-check.mjs'])
 v=pin(p);assert v['bytes']==ref['bytes'] and v['sha256']==ref['sha256'];return p.read_bytes()
def closure(scans,launcher):
 assert len(scans)==2 and all(s.get('owned')==[launcher] and type(s.get('launcherStartTicks')) is int and s['launcherStartTicks']>0 for s in scans),'two original launcher-only scans absent'
 assert scans[0]['launcherStartTicks']==scans[1]['launcherStartTicks'];return scans[0]['launcherStartTicks']
def frames(prefix):return [json.loads(line.split(prefix,1)[1]) for line in logpath.read_text().splitlines() if prefix in line and '\x1b' not in line]
def stamp(v):return datetime.datetime.fromisoformat(v.replace('Z','+00:00'))
grant_path=Path('/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/CHAIN_PREPARED_GROUPED_PROCS2_ONCE_GRANT_20261025T082158Z.json');wrapped=pin(grant_path);assert wrapped['bytes']==11728 and wrapped['sha256']=='0844cd09b1dfa81bf002b7c1a0cfaedf507cc0742f875050de0b6d86a8f63728';grant=read(grant_path)
assert grant['sourceCommit']=='31fe7b86ca74c290dfcd410eea27d1b44f379b31' and grant['onceOnly'] is True and grant['autoRetry'] is False and grant['freshRoot']['pressure']==1
for ref in grant['frozenRefs']:exact(ref)
request=read(base/'root-scheduling-request-with-evidence.json');assert pin(base/'root-scheduling-request-with-evidence.json')['bytes']==17681 and pin(base/'root-scheduling-request-with-evidence.json')['sha256']=='32b51856593331a0d4df96cd8bb63ab46c03ededa6ffe557e1a298fbeadc0f7b'
for k in ('sourceCommit','codeCommit','frozenRef','workflowInputs','runtimeCaps','onlyAxis','normalDispatchTransport'):assert request[k]==grant[k]
source_ref=grant['frozenRef'];plan=read(base/'plan.json');assert request['plan']==plan and pin(base/'plan.json')['sha256']==request['planSHA256'];before,after=plan['cases'];normalized=dict(after);assert normalized.pop('clientProcs2') is True and normalized==before
assert all(c['pacingMode']=='grouped-cadence4' and c['nativePreparedCertificate'] is True and c['nativeExitMMProof'] is True and c['nativeCurrentInputReuse'] is True for c in plan['cases'])
assert request['fixed']==dict(submitters=8,observers=4,offeredRate=1000,senders=2048,rounds=4,preparedCertificate=True,currentInputReuse=True,stateHashEncoding='original-json',pacingMode='grouped-cadence4',exitMMProof=True,environment=dict(GOMAXPROCS='1',GOGC='100',GOMEMLIMIT='off'))
reader_dir=base/'frozen-readers/scripts/loadtest';frozen_pins={}
for name,ref in request['frozenReaders'].items():
 path=base/'frozen-readers'/name;value=pin(path);assert value['bytes']==ref['bytes'] and value['sha256']==ref['sha256'] and path.read_bytes()==subprocess.check_output(['git','show',grant['sourceCommit']+':'+name]);frozen_pins[name]=value
repaired=reader_dir/'native-stream-artifact.py';assert pin(repaired)['sha256']=='fa02b527e9d8d6e181ec009094791fd4b5f9e4a8f0e012682ce76aea91c03a0e'
normal_log=Path(request['normalCI']['fullLog']['path']);normal_api=Path(request['normalCI']['api']['path']);exact(request['normalCI']['fullLog']);exact(request['normalCI']['api']);ci=read(normal_api);assert ci['headSha']==grant['sourceCommit'] and ci['status']=='completed' and ci['conclusion']=='success'
api=read(root/'original-complete-run-api.json');observed=read(runpath);assert api['id']==40176399057 and api['head_sha']==grant['sourceCommit'] and api['head_branch']==source_ref and api['event']=='workflow_dispatch' and api['run_attempt']==1 and api['status']=='completed';assert all(observed[k]==v for k,v in dict(headSha=api['head_sha'],status=api['status'],conclusion=api['conclusion']).items());run=dict(databaseId=api['id'],headSha=api['head_sha'],status=api['status'],conclusion=api['conclusion'])
source_wd=Path('/Volumes/西部数据/YNX-large-work/chain-performance-20261017/prepared-grouped-procs2-source-20261025');actual=read(source_wd/'dispatch-intent-01.json');sent=read(source_wd/'dispatch-result-01.json');assert sent['exitCode']==0 and sent['transportUnknown'] is False and sent['dispatchedExactlyOnce'] is True and sent['automaticRetry'] is False;assert actual['grantSHA256']==wrapped['sha256'] and actual['sourceCommit']==grant['sourceCommit'];assert stamp(grant['issuedAt'])<=stamp(actual['startedAt'])<stamp(grant['dispatchStartDeadline']);assert abs((stamp(api['created_at'])-stamp(actual['startedAt'])).total_seconds())<=10
prior=read(source_wd/'pre-dispatch-original-api.json');post=read(source_wd/'post-dispatch-original-api-01.json');assert prior['total_count']==0 and post['total_count']==1 and post['workflow_runs'][0]['id']==api['id']
command=json.loads(exact(grant['normalDispatchTransport']['command']));body_raw=exact(grant['normalDispatchTransport']['stringBody']);assert actual['argv']==command['argv'] and actual['stdinSHA256']==hashlib.sha256(body_raw).hexdigest();body=json.loads(body_raw)
for k,v in grant['workflowInputs'].items():assert type(body[k]) is str and body[k]==(('true' if v else 'false') if type(v) is bool else v)
pressure_path=grant_path;pair_caps=plan['pairCaps'];case_caps=before['resourceCaps'];assert grant['runtimeCaps']==dict(pair=pair_caps,case=case_caps,stream=before['streamBudget'])
assert pair_caps==dict(totalMs=120000,retainedBytes=512<<20,logBytes=2<<20,buildBytes=1<<30,metadataReserveMs=500)
assert case_caps['activeMs']==45000 and case_caps['cleanupMs']==15000 and case_caps['totalMs']==60000 and case_caps['ownedRSSBytes']==1<<30 and case_caps['threads']==320 and case_caps['ownedProcesses']==10 and case_caps['privateBytes']==256<<20 and before['streamBudget']['timeoutMs']==40000
contract=dict(sourceCommit=grant['sourceCommit'],sourceRef=source_ref,sourceTree=git('rev-parse',grant['sourceCommit']+'^{tree}'),internalTree=git('rev-parse',grant['sourceCommit']+':internal'),runtimeCaps=dict(pairRetainedBytes=pair_caps['retainedBytes'],pairProcessLogBytes=pair_caps['logBytes'],ownedRSSBytes=case_caps['ownedRSSBytes'],threads=case_caps['threads'],buildDirectoryBytes=pair_caps['buildBytes'],perCasePrivateBytes=case_caps['privateBytes'],ownedProcesses=case_caps['ownedProcesses'],perCaseProcessLogBytes=case_caps['logBytes']),freshAdmission=dict(nativeMemAvailableFloorBytes=case_caps['availableMemoryFloorBytes'],diskFloorBytes=case_caps['diskFloorBytes'],rootReserveBytes=case_caps['rootReserveBytes'],compileReserveBytes=case_caps['compileReserveBytes'],initialPrivateReserveBytes=pair_caps['retainedBytes']),privateByteAccounting='Original case256MiB/pair512MiB, sampled RSS1GiB/thread320/process10/log2MiB/build1GiB. No budget exemption; finite pair only.')

pair_path=capture/'evidence/actual.json';pair=read(pair_path);terms=frames('YNX_NATIVE_STREAM_PAIR_TERMINAL ');assert len(terms)==1;term=terms[0]
assert term.get('pairReceiptSHA256')==pin(pair_path)['sha256']
result=dict(schema=1,kind='original-native-prepared-grouped-client-procs2-pair-qualified-readback',runId=run['databaseId'],sourceCommit=contract['sourceCommit'],sourceRef=contract['sourceRef'],originalGrantSHA256=wrapped['sha256'],immutableOriginalSourceGuard=pin(base/'source-guard-at-source-31fe7b86ca.mjs'),originalPreDispatchPressure=pin(pressure_path),originalRun=pin(runpath),originalLog=pin(logpath),originalPairReceipt=pin(pair_path),consumerTool=pin(Path(__file__)),frozenReaders=frozen_pins,normalCILog=pin(normal_log),archiveReader=pin(repaired),archiveReaderScope='exact frozen original, no posthoc repair',terminal=term,nativePairQualified=False,slotReturned=False,cases=[],sustainedTPSQualified=False,firstCause=pair.get('firstCause') or term.get('firstCause'))
try:
 closure(term['postFsyncClosureScans'],pair['launcher']);result['slotReturned']=True
except Exception as error:result['slotClosureDiagnostic']=str(error) or type(error).__name__
try:
 assert run['conclusion']=='success','original workflow not successful'
 assert pair.get('firstCause') is None and pair.get('casesQualified') is True and term.get('firstCause') is None and term.get('qualified') is True
 assert term.get('sustainedTPSQualified') is False and type(term.get('elapsedMs')) is int and 0<term['elapsedMs']<=120000
 assert result['slotReturned'] is True
 assert pair['sourceCommit']==contract['sourceCommit'] and len(pair['cases'])==2
 caps=contract['runtimeCaps'];floors=contract['freshAdmission']
 for sample in pair['samples']+[term['postFsyncSample']]:
  assert sample['retainedBytes']<=caps['pairRetainedBytes'] and sample['logBytes']<=caps['pairProcessLogBytes']
  assert sample['rssBytes']<=caps['ownedRSSBytes'] and sample['threads']<=caps['threads'] and sample['buildBytes']<=caps['buildDirectoryBytes']
  assert sample['availableMemoryBytes']>=floors['nativeMemAvailableFloorBytes'] and sample['freeDiskBytes']>=floors['diskFloorBytes']+floors['rootReserveBytes']
 assert pair['samples'][0]['freeDiskBytes']>=sum(floors[k] for k in ('diskFloorBytes','rootReserveBytes','compileReserveBytes','initialPrivateReserveBytes'))
 spec=importlib.util.spec_from_file_location('original_pair_zip',reader_dir/'native-stream-artifact.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
 controller_spec=importlib.util.spec_from_file_location('original_mm_controller',reader_dir/'supply-linux-window.py')
 controller=importlib.util.module_from_spec(controller_spec);controller_spec.loader.exec_module(controller)
 controller.validate_exit_mm_samples(dict(nativeExitMMProof=True,samples=pair['samples']+[term['postFsyncSample']]),True)
 archive_proof_path=capture.parent/'complete-original-public-recovery.json';archive_proof=read(archive_proof_path);artifact=read(root/'original-artifact-api.json')
 assert type(artifact['id']) is int and artifact['id']>0 and artifact['workflow_run']['id']==api['id'] and artifact['workflow_run']['head_sha']==contract['sourceCommit']
 assert archive_proof['artifact']['artifactId']==artifact['id'] and archive_proof['artifact']['bytes']==artifact['size_in_bytes'] and archive_proof['artifact']['head']==contract['sourceCommit']
 assert archive_proof['originalReaderSHA256']==pin(repaired)['sha256']
 class NoNetwork:
  def open(self,*a,**k):raise RuntimeError('zero-network original cache audit missed a retained range')
 ranges=reader.ExactHTTPRanges('https://artifact.blob.core.windows.net/original-no-network',artifact['size_in_bytes'],capture.parent/'range-cache',archive_proof['artifact'],opener=NoNetwork())
 zero=reader.recover(reader.Blocks(artifact['size_in_bytes'],ranges.fetch),capture,'network-pair')
 assert ranges.network_bytes==0
 for k in ('members','bytes','centralDirectoryBytes','centralDirectorySHA256','selectedMemberManifestSHA256'):assert zero[k]==archive_proof[k]
 result['zeroNetworkOriginalArchiveAudit']=zero;result['originalPublicRecovery']=pin(archive_proof_path)
 complete=reader.verify_capture(capture,'network-pair',contract['sourceCommit'])
 native_terms=frames('YNX_NATIVE_STREAM_TERMINAL ');assert len(native_terms)==2
 for index,(label,mode) in enumerate((('native-grouped-procs1','grouped-cadence4'),('native-grouped-procs2','grouped-cadence4'))):
  case=('before-' if index==0 else 'after-')+label;root=capture/case;path=root/'evidence/actual.json';row=read(path);verdict=native_terms[index]
  assert verdict['receiptSHA256']==pin(path)['sha256'] and verdict.get('qualified') is True and verdict.get('nodesStarted') is True and verdict.get('firstCause') is None
  assert verdict['kind']=='native-stream2048x4-post-fsync-verdict' and 0<verdict['elapsedMs']<=60000
  assert row['cleanupComplete'] is True and row['nodesStarted'] is True and row.get('firstCause') is None
  assert closure(row['closureScans'][-2:],row['launcher'])==closure(verdict['postFsyncClosureScans'],row['launcher'])==closure(term['postFsyncClosureScans'],pair['launcher'])
  assert row['nativeCurrentInputReuse'] is True and row.get('nativeCanonicalCertificate',False) is False and row.get('nativeBlockTipHint',False) is False and row.get('nativeSuffixSetup',False) is False
  assert pair['cases'][index]['preparedCertificate'] is True and pair['cases'][index]['currentInputReuse'] is True
  assert row.get('nativePreparedCertificate',False) is True
  assert row.get('nativeStreamSubmitters',0)==0
  assert row['sourceTree']==contract['sourceTree'] and row['internalTree']==contract['internalTree']
  assert row['launcher']==pair['launcher'] and row['sourceCommit']==contract['sourceCommit'] and row['pacingMode']==mode
  assert row['environment']==dict(GOMAXPROCS='1',GOGC='100',GOMEMLIMIT='off') and row['binaries']==pair['compiledBinaries']
  assert set(row['binaries'])=={'ynx-abci','cometbft','ynx-consensus-perf-fixture','ynx-consensus-perf-client'}
  for name,binary in row['binaries'].items():
   assert 0<binary['bytes']<=64<<20 and len(binary['sha256'])==64
   assert all(k in binary['buildInfo'] for k in ('GOOS=linux','GOARCH=amd64','CGO_ENABLED=0'))
   if name!='cometbft':assert 'vcs.revision='+contract['sourceCommit'] in binary['buildInfo'] and 'vcs.modified=false' in binary['buildInfo']
   else:assert 'github.com/cometbft/cometbft\tv0.38.23\th1:jtCe5Do4EcHVf/FCyZMvkBm+AmsRGGyvswImXYAabdM=' in binary['buildInfo']
  roles={'fixture','client','verifier'}|{'abci-'+str(i) for i in range(4)}|{'comet-'+str(i) for i in range(4)}
  assert len(row['children'])==11 and {child['role'] for child in row['children']}==roles
  worker=row['nativeVerifier'];client_exit=row['clientExit'];role_pids={c['role']:c['pid'] for c in row['children']}
  assert type(client_exit['returncode']) is int and client_exit['returncode']==0 and client_exit['pid']==role_pids['client']
  assert worker['pid']==role_pids['verifier'] and worker['parentPID']==row['launcher'] and worker['checkerPasses']==2
  assert worker['sourceIdentity']==dict(controller=request['frozenReaders']['scripts/loadtest/supply-linux-window.py']['sha256'],verifier=request['frozenReaders']['scripts/loadtest/native-stream-verifier.py']['sha256'])
  timeline={p['phase']:p['elapsedNs'] for p in row['timeline']};assert len(timeline)==len(row['timeline'])
  assert timeline['client_start']<timeline['client_exit']<=timeline['verifier_start']<timeline['verifier_complete']<=45_000_000_000
  assert timeline['verifier_complete']<=timeline['cleanup_start']<timeline['cleanup_complete']<=60_000_000_000
  assert worker['phaseTotalsNs']==verdict['nativeVerifierPhasesNs'] and worker['receiptWriteAndFsyncNs']==verdict['nativeVerifierReceiptFsyncNs']
  assert all(type(v) is int and v>0 for v in worker['phaseTotalsNs'].values())
  assert 0<sum(worker['phaseTotalsNs'].values())+worker['receiptWriteAndFsyncNs']<=timeline['verifier_complete']-timeline['verifier_start']
  assert pin(root/'native-stream-verifier.json')['sha256']==worker['sha256']
  samples=row['samples']+[verdict['postFsyncSample']]
  controller.validate_exit_mm_samples(dict(nativeExitMMProof=row.get('nativeExitMMProof'),samples=samples),True)
  for sample in samples:
   assert sample['rssBytes']<=caps['ownedRSSBytes'] and sample['threads']<=caps['threads'] and sample['privateBytes']<=caps['perCasePrivateBytes'] and sample['buildBytes']<=caps['buildDirectoryBytes']
   assert not {worker['pid'],client_exit['pid']}<={p['pid'] for p in sample['tasks']}
   assert len(sample['tasks'])<=caps['ownedProcesses'] and sample.get('processLogBytes',0)<=caps['perCaseProcessLogBytes']
   assert sample['availableMemoryBytes']>=floors['nativeMemAvailableFloorBytes'] and sample['freeDiskBytes']>=floors['diskFloorBytes']+floors['rootReserveBytes']
  # Reuse the already completed original node-parser audit; do not rerun it.
  phase_audit_path=capture.parent/'original-business-checkpoint-phases-01.json'
  assert pin(phase_audit_path)['bytes']==audit_bytes and pin(phase_audit_path)['sha256']==audit_sha
  phase_audit=read(phase_audit_path);audit_case=phase_audit['cases'][index]
  assert phase_audit['runId']==40176399057 and phase_audit['sourceCommit']==contract['sourceCommit']
  assert audit_case['name']==case and audit_case['effectiveTransactions']==8192 and audit_case['replicas']==4 and len(audit_case['nodes'])==4
  parsed=row['nodePhases'];assert len(parsed)==4
  for node_index,audited in enumerate(audit_case['nodes']):
   original_log=root/('abci-'+str(node_index)+'.log')
   assert audited['node']==node_index and audited['completeLogValidated'] is True and audited['source']==pin(original_log)
   assert audited['cumulativeHandlerTimings']==parsed[node_index]['stages']
   business=[b for b in parsed[node_index]['blockExecutionClock']['blocks'] if b['transactions']>0]
   assert len(business)==audited['businessBlocks'] and sum(b['transactions'] for b in business)==audited['businessTransactions']==8192
   checkpoints=audited['actualCheckpointSamples'];assert len(checkpoints)==parsed[node_index].get('checkpointSamples',0)
   totals={}
   for checkpoint in checkpoints:
    for stage,ns in checkpoint['stagesNs'].items():totals[stage]=totals.get(stage,0)+ns
   assert totals==parsed[node_index].get('checkpointTotalsNs',{})
  result['originalNodeParserAuditReused']=pin(phase_audit_path)
  client_raw=(root/'network/transactions-result.json').read_bytes();assert len(client_raw)<=16<<20 and hashlib.sha256(client_raw).hexdigest()==row['resultSHA256']
  client=json.loads(client_raw)
  assert client['streamingWorkload']['evidenceVerified'] is True and not client.get('setupErrors')
  assert client['concurrency']==8 and client['observerConcurrency']==4 and client['pacedWorkers']['submitters']==client['concurrency']
  assert client.get('nativeStreamSubmitters',0)==0 and client.get('nativePreparedCertificate',False) is True
  assert client['streamingWorkload']['name']==('scoped_native_prefix_stream8_prepared_grouped_procs2_v1' if index==1 else 'scoped_native_prefix_stream8_prepared_v1')
  assert client.get('clientProcs2',False) is (index==1) and client['gomaxprocs']==(2 if index==1 else 1)
  assert row.get('clientProcs2',False) is (index==1) and pair['cases'][index]['clientProcs2'] is (index==1)
  assert client.get('nativeCachedFeeJSON',False) is False and 'clientStateHashEncoding' not in client
  assert client['durableReadback']['prefixReplay'].get('preparedCertificate',False) is True
  result['cases'].append(dict(mode=mode,label=label,submitters=8,preparedCertificate=True,observerPhaseTotals=client['groupedObservation']['phases']['totals'],reader=client['durableReadback'],supply=client['readySenders']['supply'],processCPU=client['processCPU'],summary=client['summary'],receipt=pin(path),nativeTerminal=verdict,measurement=row['measurement'],nodePhases=parsed,host=row['host'],sampledPeaks={k:max(s[k] for s in samples) for k in ('rssBytes','threads','privateBytes','buildBytes')},nodesSpawned=[p for p in row['timeline'] if p['phase']=='nodes_spawned']))
 result.update(nativePairQualified=True,completeStreamReadback=complete,jointObservation=pair['jointObservation'],binaries=pair['compiledBinaries'],hostIdentity=pair['hostIdentity'],privateByteAccounting=contract['privateByteAccounting'],interpretation='Finite same-VM/source/4ELF8192x2 pair, original whole-window rates and per-row latency intervals. Wait totals/phase children overlap. Sampled RSS/logical retained bytes are not hard cgroup/allocated-block peaks. Empty scans retain the same original launcher, not full process-group empty. No sustained1000/600s claim.')
except Exception as error:result['firstCause']=result['firstCause'] or str(error) or type(error).__name__
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print(json.dumps(dict(nativePairQualified=result['nativePairQualified'],slotReturned=result['slotReturned'],sustainedTPSQualified=False,firstCause=result['firstCause'],output=pin(out))))
sys.exit(0 if result['nativePairQualified'] else 1)
