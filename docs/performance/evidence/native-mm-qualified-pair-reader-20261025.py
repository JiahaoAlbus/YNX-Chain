"""Original explicit-MM prepared8 bounded/grouped4 pair: full immutable grant/source/resource/stream/node-log proof.
Arguments: source packet, capture root, original complete CI log, terminal gh JSON, NEW output, trusted Root grant bytes, trusted Root grant SHA256.
Supply the final two pins from the actual trusted Root reply, never infer them from the artifact.
Run identity comes from the actual original API, unique frozen-head dispatch and once timestamp; no placeholder ID.
Never starts nodes. Requires completed original public recovery, then reaudits CRC/SHA with zero network.
"""
import datetime,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
base=Path(sys.argv[1]).resolve()
capture,logpath,runpath,out=map(Path,sys.argv[2:6])
trusted_grant_bytes=int(sys.argv[6]);trusted_grant_sha=sys.argv[7]
assert 0<trusted_grant_bytes<=65536 and len(trusted_grant_sha)==64 and all(c in "0123456789abcdef" for c in trusted_grant_sha)
assert trusted_grant_bytes==6657 and trusted_grant_sha=='493a8dc2abc39f311db56e823cd42a6c1185a3834519db1a3fb388c6734d6362'
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def read(path):return json.loads(path.read_bytes())
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def closure(scans,launcher):
 assert len(scans)==2 and all(s.get('owned')==[launcher] and type(s.get('launcherStartTicks')) is int and s['launcherStartTicks']>0 for s in scans),'two original launcher-only scans absent'
 assert scans[0]['launcherStartTicks']==scans[1]['launcherStartTicks'];return scans[0]['launcherStartTicks']
def frames(prefix):return [json.loads(line.split(prefix,1)[1]) for line in logpath.read_text().splitlines() if prefix in line and '\x1b' not in line]
def stamp(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
grant_path=base/'corrected-root-once-grant-original.json';grant=read(grant_path)
assert pin(grant_path)['bytes']==trusted_grant_bytes and pin(grant_path)['sha256']==trusted_grant_sha
assert grant['sourceCommit']=='d24e97b8d3373e294a9d7992e07b4ef532bd6dcf' and grant['singleUse'] is True and type(grant['freshRoot']['pressure']) is int and grant['freshRoot']['pressure']==1
assert grant['frozenRef']=='codex/chain-native-prepared-grouped-mm-pair-d24e97b8d3'
source_ref=grant['frozenRef'].removeprefix('refs/tags/')
request=read(base/'root-scheduling-request-with-evidence-successor-01.json');plan=read(base/'plan.json')
assert pin(base/'root-scheduling-request-with-evidence-successor-01.json')['bytes']==18154 and pin(base/'root-scheduling-request-with-evidence-successor-01.json')['sha256']=='6448bdd28dc33e55839b9ab5caaef4f50144835eba5d940912d8ba88fec5c05e'
assert pin(base/'plan.json')['bytes']==6073 and pin(base/'plan.json')['sha256']=='9085be7f9280d1c785bb16453db0ec45af1111cab3cee13c42a1b2769b1a1e18'
assert pin(base/'root-scheduling-request-with-evidence-successor-01.json')['bytes']==grant['request']['bytes'] and pin(base/'root-scheduling-request-with-evidence-successor-01.json')['sha256']==grant['request']['sha256']
assert request['planSHA256']==pin(base/'plan.json')['sha256'] and request['plan']==plan
assert set(grant['frozenReaders'])==set(request['frozenReaders'])
assert all(grant['frozenReaders'][name]['bytes']==expected['bytes'] and grant['frozenReaders'][name]['sha256']==expected['sha256'] for name,expected in request['frozenReaders'].items())
assert request['sourceCommit']==grant['sourceCommit'] and request['frozenRef']==source_ref and request['workflowInputs']==grant['workflowInputs'] and plan['input']==grant['workflowInputs']
assert request['plan']==plan and request['planSHA256']==pin(base/'plan.json')['sha256']
assert plan['kind']=='fixed-same-VM-native-prepared-grouped-mm-proof-pair'
assert [case['nativeCurrentInputReuse'] for case in plan['cases']]==[True,True]
assert [case.get('nativeCanonicalCertificate',False) for case in plan['cases']]==[False,False]
assert [case.get('nativeBlockTipHint',False) for case in plan['cases']]==[False,False]
assert [case['profile']['concurrency'] for case in plan['cases']]==[8,8]
assert all('nativeStreamSubmitters' not in case for case in plan['cases'])
assert [case.get('nativePreparedCertificate',False) for case in plan['cases']]==[True,True]
assert [case['pacingMode'] for case in plan['cases']]==['bounded-cadence','grouped-cadence4']
normalized=json.loads(json.dumps(plan['cases'][1]));normalized['pacingMode']=plan['cases'][0]['pacingMode']
assert normalized['profile']['name']==plan['cases'][0]['profile']['name'].replace('-bounded-cadence','-grouped-cadence4');normalized['profile']['name']=plan['cases'][0]['profile']['name']
assert normalized==plan['cases'][0]
assert request['fixed']['submitters']==8 and [case['nativeExitMMProof'] for case in plan['cases']]==[True,True]
normal_log=Path(request['normalCI']['fullLog']['path']);normal_api=Path(request['normalCI']['api']['path'])
for path,key in [(normal_log,'fullLog'),(normal_api,'api')]:assert pin(path)['bytes']==request['normalCI'][key]['bytes'] and pin(path)['sha256']==request['normalCI'][key]['sha256']
ci=read(normal_api);api=read(logpath.parent/'native-complete-run-api.json');observed=read(runpath)
assert ci['id']==40111618531 and ci['head_sha']==grant['sourceCommit'] and ci['status']=='completed' and ci['conclusion']=='success'
assert type(api['id']) is int and api['id']>0 and api['head_sha']==grant['sourceCommit'] and api['head_branch']==source_ref and api['event']=='workflow_dispatch' and api['run_attempt']==1 and api['status']=='completed'
assert observed['headSha']==api['head_sha'] and observed['status']==api['status'] and observed['conclusion']==api['conclusion']
run=dict(databaseId=api['id'],headSha=api['head_sha'],status=api['status'],conclusion=api['conclusion'])
actual=read(base/'corrected-once-dispatch-intent.json');sent=read(base/'corrected-once-dispatch-result.json')
def exact(meta):
 path=Path(meta['path']);assert pin(path)['bytes']==meta['bytes'] and pin(path)['sha256']==meta['sha256'];return path.read_bytes()
transport=json.loads(exact(grant['transportSuccessor']));command=json.loads(exact(grant['command']));body=json.loads(exact(grant['stdinBody']))
assert command==['/opt/homebrew/bin/gh','workflow','run','chain-core.yml','--ref',source_ref,'--json']
assert transport['commandArguments']==command and transport['workflowInputs']==grant['workflowInputs']
assert actual['sourceCommit']==grant['sourceCommit'] and actual['grantSHA256']==pin(grant_path)['sha256']
assert actual['commandSHA256']==grant['command']['sha256'] and actual['stdinBodySHA256']==grant['stdinBody']['sha256'] and actual['transportSuccessorSHA256']==grant['transportSuccessor']['sha256']
assert actual['once'] is True and actual['unknownMustReconcileNoRetry'] is True and sent['returncode']==0 and not sent['stderr'] and sent['unknown'] is False
assert stamp(grant['issuedAt'])<=stamp(actual['createdAt'])<stamp(grant['dispatchDeadline']) and abs((stamp(api['created_at'])-stamp(actual['createdAt'])).total_seconds())<=10
for key,value in grant['workflowInputs'].items():assert type(body[key]) is str and body[key]==(('true' if value else 'false') if type(value) is bool else value)
original_failure=json.loads(exact(transport['originalLocalFailure']));original_zero=json.loads(exact(transport['originalRemoteZeroRuns']))
assert original_failure['returncode']==1 and 'cannot unmarshal bool' in original_failure['stderr'] and original_failure['unknown'] is False
assert original_zero['total_count']==0 and original_zero['workflow_runs']==[]
pressure_path=base/'corrected-pre-dispatch-local-pressure-01.json';pressure=read(pressure_path)
assert pressure['pressureRaw'].strip()=='1' and pressure['grantSHA256']==trusted_grant_sha and pressure['at']==actual['createdAt']
assert len(pressure_path.read_bytes())<=65536
listed=read(base/'corrected-original-dispatch-run-list-api-01.json')['workflow_runs'];matched=[r for r in listed if r['head_sha']==grant['sourceCommit'] and r['event']=='workflow_dispatch' and r['head_branch']==source_ref]
assert len(matched)==1 and matched[0]['id']==api['id'] and matched[0]['run_attempt']==1
wrapped=dict(sha256=pin(grant_path)['sha256'])
contract=dict(sourceCommit=grant['sourceCommit'],sourceRef=source_ref,sourceTree=git('rev-parse',grant['sourceCommit']+'^{tree}'),internalTree=git('rev-parse',grant['sourceCommit']+':internal'))
assert git('rev-parse',grant['frozenRef'])==grant['sourceCommit']
frozen_pins=[]
for name,expected in request['frozenReaders'].items():
 path=base/'frozen-readers'/name;raw=subprocess.check_output(['git','show',grant['sourceCommit']+':'+name]);assert path.read_bytes()==raw and len(raw)==expected['bytes'] and hashlib.sha256(raw).hexdigest()==expected['sha256'];frozen_pins.append(dict(repositoryPath=name,**pin(path)))
assert len(frozen_pins)==13
reader_dir=base/'frozen-readers/scripts/loadtest'
repaired=reader_dir/'native-stream-artifact.py'
proofs=[json.loads(line[line.index('{"candidate":'):])['candidate'] for line in normal_log.read_text().splitlines() if '{"candidate":' in line]
assert len(proofs)==1 and proofs[0]['sourceCommit']==request['codeCommit'] and proofs[0]['internalTree']==contract['internalTree']
assert proofs[0]['runtimeClientTree']==git('rev-parse',grant['sourceCommit']+':cmd/ynx-consensus-perf-client') and proofs[0]['diagnosticNodeTree']==git('rev-parse',grant['sourceCommit']+':cmd/ynx-abci')
case_caps=plan['cases'][0]['resourceCaps'];pair_caps=plan['pairCaps']
assert request['runtimeCaps']==grant['runtimeCaps']
assert request['verifierLifecycle']['sameSourceCompleteCheckerPasses']==2 and request['verifierLifecycle']['allVerifierWorkWithinOriginalCaseActiveMs']==45000
assert request['fixed']==dict(submitters=8,observers=4,offeredRate=1000,preparedCertificate=True,currentInputReuse=True,stateHashEncoding='original-json',exitMMProof=True,environment=dict(GOMAXPROCS='1',GOGC='100',GOMEMLIMIT='off'),nativeStreamVerifier=True,completeVerifierPasses=2)
assert grant['runtimeCaps']['pair']==pair_caps and grant['runtimeCaps']['case']==case_caps and grant['runtimeCaps']['stream']==plan['cases'][0]['streamBudget']
assert pair_caps['totalMs']==120000 and case_caps['activeMs']==45000 and case_caps['cleanupMs']==15000 and case_caps['totalMs']==60000
assert plan['cases'][0]['streamBudget']['timeoutMs']==40000
assert case_caps['ownedRSSBytes']==1<<30 and case_caps['threads']==320 and case_caps['ownedProcesses']==10 and case_caps['privateBytes']==256<<20
assert pair_caps['retainedBytes']==512<<20 and pair_caps['logBytes']==2<<20 and pair_caps['buildBytes']==1<<30
contract['runtimeCaps']=dict(pairRetainedBytes=pair_caps['retainedBytes'],pairProcessLogBytes=pair_caps['logBytes'],ownedRSSBytes=case_caps['ownedRSSBytes'],threads=case_caps['threads'],buildDirectoryBytes=pair_caps['buildBytes'],perCasePrivateBytes=case_caps['privateBytes'],ownedProcesses=case_caps['ownedProcesses'],perCaseProcessLogBytes=case_caps['logBytes'])
contract['freshAdmission']=dict(nativeMemAvailableFloorBytes=case_caps['availableMemoryFloorBytes'],diskFloorBytes=case_caps['diskFloorBytes'],rootReserveBytes=case_caps['rootReserveBytes'],compileReserveBytes=case_caps['compileReserveBytes'],initialPrivateReserveBytes=pair_caps['retainedBytes'])
contract['privateByteAccounting']='Original per-case private256MiB, sampledRSS1GiB, aggregate512MiB incl receipts, logs2MiB/build1GiB. Build before pair120s is only within original whole20minute job; no invented compile hard RSS/timeout.'
pair_path=capture/'evidence/actual.json';pair=read(pair_path);terms=frames('YNX_NATIVE_STREAM_PAIR_TERMINAL ');assert len(terms)==1;term=terms[0]
assert term.get('pairReceiptSHA256')==pin(pair_path)['sha256']
result=dict(schema=1,kind='original-native-prepared-grouped-mm-pair-qualified-readback',runId=run['databaseId'],sourceCommit=contract['sourceCommit'],sourceRef=contract['sourceRef'],originalGrantSHA256=wrapped['sha256'],originalPreDispatchPressure=pin(pressure_path),originalRun=pin(runpath),originalLog=pin(logpath),originalPairReceipt=pin(pair_path),consumerTool=pin(Path(__file__)),frozenReaders=frozen_pins,normalCILog=pin(normal_log),archiveReader=pin(repaired),archiveReaderScope='exact frozen original, no posthoc repair',terminal=term,nativePairQualified=False,slotReturned=False,cases=[],sustainedTPSQualified=False,firstCause=pair.get('firstCause') or term.get('firstCause'))
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
 controller=reader.load('supply-linux-window');controller.validate_exit_mm_samples(dict(nativeExitMMProof=True,samples=pair['samples']+[term['postFsyncSample']]),True)
 archive_proof_path=capture.parent/'complete-original-public-recovery.json';archive_proof=read(archive_proof_path);artifact=read(logpath.parent/'original-artifact-api.json')
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
 for index,(label,mode) in enumerate((('native-mm-bounded','bounded-cadence'),('native-mm-grouped','grouped-cadence4'))):
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
  code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
  parsed=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',code,str(reader_dir/'node-phase-timing.mjs')]+[str(root/('abci-'+str(i)+'.log')) for i in range(4)],timeout=10))
  assert parsed==row['nodePhases'],'original node logs/phase receipt differ'
  client_raw=(root/'network/transactions-result.json').read_bytes();assert len(client_raw)<=16<<20 and hashlib.sha256(client_raw).hexdigest()==row['resultSHA256']
  client=json.loads(client_raw)
  assert client['streamingWorkload']['evidenceVerified'] is True and not client.get('setupErrors')
  assert client['concurrency']==8 and client['observerConcurrency']==4 and client['pacedWorkers']['submitters']==client['concurrency']
  assert client.get('nativeStreamSubmitters',0)==0 and client.get('nativePreparedCertificate',False) is True
  assert client['streamingWorkload']['name']=='scoped_native_prefix_stream8_prepared_v1'
  assert client.get('nativeCachedFeeJSON',False) is False and 'clientStateHashEncoding' not in client
  assert client['durableReadback']['prefixReplay'].get('preparedCertificate',False) is True
  result['cases'].append(dict(mode=mode,label=label,submitters=8,preparedCertificate=True,observerPhaseTotals=client['groupedObservation']['phases']['totals'],reader=client['durableReadback'],supply=client['readySenders']['supply'],processCPU=client['processCPU'],summary=client['summary'],receipt=pin(path),nativeTerminal=verdict,measurement=row['measurement'],nodePhases=parsed,host=row['host'],sampledPeaks={k:max(s[k] for s in samples) for k in ('rssBytes','threads','privateBytes','buildBytes')},nodesSpawned=[p for p in row['timeline'] if p['phase']=='nodes_spawned']))
 result.update(nativePairQualified=True,completeStreamReadback=complete,jointObservation=pair['jointObservation'],binaries=pair['compiledBinaries'],hostIdentity=pair['hostIdentity'],privateByteAccounting=contract['privateByteAccounting'],interpretation='Finite same-VM/source/4ELF8192x2 pair, original whole-window rates and per-row latency intervals. Wait totals/phase children overlap. Sampled RSS/logical retained bytes are not hard cgroup/allocated-block peaks. Empty scans retain the same original launcher, not full process-group empty. No sustained1000/600s claim.')
except Exception as error:result['firstCause']=result['firstCause'] or str(error) or type(error).__name__
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print(json.dumps(dict(nativePairQualified=result['nativePairQualified'],slotReturned=result['slotReturned'],sustainedTPSQualified=False,firstCause=result['firstCause'],output=pin(out))))
sys.exit(0 if result['nativePairQualified'] else 1)
