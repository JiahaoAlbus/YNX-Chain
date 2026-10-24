"""Original canonical certificate pair: full grant/source/resource/stream/node-log proof.
Arguments: original source packet, capture root, original complete CI log, original terminal gh JSON, NEW output.
Uses a separately identified two-line archive-selection repair; never reruns nodes.
"""
import datetime,hashlib,importlib.util,json,os,subprocess,sys,shutil
from pathlib import Path
base=Path(sys.argv[1]).absolute()
capture,logpath,runpath,out=map(Path,sys.argv[2:])
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def read(path):return json.loads(path.read_bytes())
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def closure(scans,launcher):
 assert len(scans)==2 and all(s.get('owned')==[launcher] and type(s.get('launcherStartTicks')) is int and s['launcherStartTicks']>0 for s in scans),'two original launcher-only scans absent'
 assert scans[0]['launcherStartTicks']==scans[1]['launcherStartTicks'];return scans[0]['launcherStartTicks']
def frames(prefix):return [json.loads(line.split(prefix,1)[1]) for line in logpath.read_text().splitlines() if prefix in line and '\x1b' not in line]
def stamp(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
grant_path=base/'original-root-grant.json';grant=read(grant_path)
assert pin(grant_path)['bytes']==2922 and pin(grant_path)['sha256']=='9289d4f3a2da194e3eb6f3e675919cc13fc2a525a940dc8d92d99d55ee14d40e'
assert grant['sourceCommit']=='4e4d26a71205866765b57b000c5adf1b6361342a' and grant['operation']=='native-canonical-pair-4e4d26a71-once01'
request=read(base/'root-scheduling-request.json');plan=read(base/'plan.json')
for path,expected in [(base/'root-scheduling-request.json',grant['request']),(base/'plan.json',grant['plan'])]:
 actual=pin(path);assert actual['bytes']==expected['bytes'] and actual['sha256']==expected['sha256']
assert request['sourceCommit']==grant['sourceCommit'] and request['frozenRef']==grant['frozenRef'] and request['plan']==plan and plan['input']==grant['inputs']
assert plan['kind']=='fixed-same-VM-native-canonical-certificate-pair'
assert [case['nativeCurrentInputReuse'] for case in plan['cases']]==[True,True]
assert [case.get('nativeCanonicalCertificate',False) for case in plan['cases']]==[False,True]
assert {k:v for k,v in plan['cases'][1].items() if k!='nativeCanonicalCertificate'}==plan['cases'][0]
ci=read(base/'normal-complete-run-api.json');api=read(base/'original-complete-run-api.json');observed=read(runpath)
assert ci['id']==40054594269 and ci['head_sha']==grant['sourceCommit'] and ci['status']=='completed' and ci['conclusion']=='success'
assert api['id']==40055278746 and api['head_sha']==grant['sourceCommit'] and api['head_branch']==grant['frozenRef'] and api['event']=='workflow_dispatch' and api['run_attempt']==1 and api['status']=='completed'
assert observed['headSha']==api['head_sha'] and observed['status']==api['status'] and observed['conclusion']==api['conclusion']
run=dict(databaseId=api['id'],headSha=api['head_sha'],status=api['status'],conclusion=api['conclusion'])
actual=read(base/'actual-dispatch-once.json');sent=read(base/'actual-dispatch-result.json')
assert actual['inputs']==grant['inputs'] and sent['returncode']==0 and not sent['stderr'] and stamp(grant['createdAt'])<=stamp(actual['attemptAtUTC'])<stamp(grant['dispatchDeadline'])
assert not any(row['headSha']==grant['sourceCommit'] for row in actual['noExistingRun'])
assert actual['localPriorParseRejectionProvedNoDispatch'] is True
local=read(base/'dispatch-result.json');assert local['returncode']==1 and 'cannot unmarshal bool' in local['stderr']
wrapped=dict(sha256=pin(grant_path)['sha256'])
contract=dict(sourceCommit=grant['sourceCommit'],sourceRef=grant['frozenRef'],sourceTree=git('rev-parse',grant['sourceCommit']+'^{tree}'),internalTree=git('rev-parse',grant['sourceCommit']+':internal'))
assert git('rev-parse',grant['frozenRef'])==grant['sourceCommit']
frozen_pins=[]
for name,expected in request['frozenReaders'].items():
 path=base/'frozen-readers'/name;raw=subprocess.check_output(['git','show',grant['sourceCommit']+':'+name]);assert path.read_bytes()==raw and len(raw)==expected['bytes'] and hashlib.sha256(raw).hexdigest()==expected['sha256'];frozen_pins.append(dict(repositoryPath=name,**pin(path)))
assert len(frozen_pins)==11
original=base/'frozen-readers/scripts/loadtest/native-stream-artifact.py';reader_dir=capture.parent/'posthoc-reader-v2/scripts/loadtest'
repaired=reader_dir/'native-stream-artifact.py';scope=read(capture.parent/'posthoc-reader-v2/POSTHOC_READER_SCOPE.json')
expected=original.read_bytes().replace(b'range(4)] if mode=="network-pair"',b'range(6)] if mode=="network-pair"').replace(b"'native-input-separate','native-input-shared')",b"'native-input-separate','native-input-shared','native-certificate-json','native-certificate-canonical')")
assert repaired.read_bytes()==expected and pin(repaired)['sha256']==scope['fixedReaderSHA256'] and pin(original)['sha256']==scope['originalReaderSHA256']
for name in request['frozenReaders']:
 if name.startswith('scripts/loadtest/') and name!='scripts/loadtest/native-stream-artifact.py':assert (capture.parent/'posthoc-reader-v2'/name).read_bytes()==(base/'frozen-readers'/name).read_bytes()
proofs=[json.loads(line[line.index('{"candidate":'):])['candidate'] for line in (base/'normal-ci-full.raw').read_text().splitlines() if '{"candidate":' in line]
assert len(proofs)==1 and proofs[0]['sourceCommit']==request['codeCommit'] and proofs[0]['internalTree']==contract['internalTree']
assert proofs[0]['runtimeClientTree']==git('rev-parse',grant['sourceCommit']+':cmd/ynx-consensus-perf-client') and proofs[0]['diagnosticNodeTree']==git('rev-parse',grant['sourceCommit']+':cmd/ynx-abci')
case_caps=plan['cases'][0]['resourceCaps'];pair_caps=plan['pairCaps'];caps=grant['caps']
assert pair_caps['totalMs']==caps['pairTotalSeconds']*1000==120000 and case_caps['activeMs']==caps['caseActiveSeconds']*1000==45000 and case_caps['totalMs']==caps['caseTotalSeconds']*1000==60000
assert plan['cases'][0]['streamBudget']['timeoutMs']==caps['clientTimeoutSeconds']*1000==40000
contract['runtimeCaps']=dict(pairRetainedBytes=caps['pairRetainedBytes'],pairProcessLogBytes=caps['pairLogBytes'],ownedRSSBytes=caps['caseRSSBytes'],threads=caps['caseThreads'],buildDirectoryBytes=caps['buildBytes'],perCasePrivateBytes=caps['casePrivateBytes'],ownedProcesses=caps['caseOwnedProcesses'],perCaseProcessLogBytes=case_caps['logBytes'])
assert caps['caseRSSBytes']==case_caps['ownedRSSBytes'] and caps['caseThreads']==case_caps['threads'] and caps['caseOwnedProcesses']==case_caps['ownedProcesses'] and caps['casePrivateBytes']==case_caps['privateBytes'] and caps['pairRetainedBytes']==pair_caps['retainedBytes'] and caps['pairLogBytes']==pair_caps['logBytes'] and caps['buildBytes']==pair_caps['buildBytes']
contract['freshAdmission']=dict(nativeMemAvailableFloorBytes=case_caps['availableMemoryFloorBytes'],diskFloorBytes=case_caps['diskFloorBytes'],rootReserveBytes=case_caps['rootReserveBytes'],compileReserveBytes=case_caps['compileReserveBytes'],initialPrivateReserveBytes=pair_caps['retainedBytes'])
contract['privateByteAccounting']='Original per-case private256MiB, sampledRSS1GiB, aggregate512MiB incl receipts, logs2MiB/build1GiB. Build before pair120s is only within original whole20minute job; no invented compile hard RSS/timeout.'
pair_path=capture/'evidence/actual.json';pair=read(pair_path);terms=frames('YNX_NATIVE_STREAM_PAIR_TERMINAL ');assert len(terms)==1;term=terms[0]
assert term.get('pairReceiptSHA256')==pin(pair_path)['sha256']
result=dict(schema=1,kind='original-native-canonical-certificate-pair-qualified-readback',runId=run['databaseId'],sourceCommit=contract['sourceCommit'],sourceRef=contract['sourceRef'],originalGrantSHA256=wrapped['sha256'],originalRun=pin(runpath),originalLog=pin(logpath),originalPairReceipt=pin(pair_path),consumerTool=pin(Path(__file__)),frozenReaders=frozen_pins,normalCILog=pin(base/'normal-ci-full.raw'),archiveReader=pin(repaired),archiveReaderScope=pin(capture.parent/'posthoc-reader-v2/POSTHOC_READER_SCOPE.json'),terminal=term,nativePairQualified=False,slotReturned=False,cases=[],sustainedTPSQualified=False,firstCause=pair.get('firstCause') or term.get('firstCause'))
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
 complete=reader.verify_capture(capture,'network-pair',contract['sourceCommit'])
 native_terms=frames('YNX_NATIVE_STREAM_TERMINAL ');assert len(native_terms)==2
 for index,(label,mode) in enumerate((('native-certificate-json','bounded-cadence'),('native-certificate-canonical','bounded-cadence'))):
  case=('before-' if index==0 else 'after-')+label;root=capture/case;path=root/'evidence/actual.json';row=read(path);verdict=native_terms[index]
  assert verdict['receiptSHA256']==pin(path)['sha256'] and verdict.get('qualified') is True and verdict.get('nodesStarted') is True and verdict.get('firstCause') is None
  assert verdict['kind']=='native-stream2048x4-post-fsync-verdict' and 0<verdict['elapsedMs']<=60000
  assert row['cleanupComplete'] is True and row['nodesStarted'] is True and row.get('firstCause') is None
  assert closure(row['closureScans'][-2:],row['launcher'])==closure(verdict['postFsyncClosureScans'],row['launcher'])==closure(term['postFsyncClosureScans'],pair['launcher'])
  assert row['nativeCurrentInputReuse'] is True and row.get('nativeCanonicalCertificate',False) is (index==1)
  assert pair['cases'][index]['canonicalCertificate'] is (index==1)
  assert row['sourceTree']==contract['sourceTree'] and row['internalTree']==contract['internalTree']
  assert row['launcher']==pair['launcher'] and row['sourceCommit']==contract['sourceCommit'] and row['pacingMode']==mode
  assert row['environment']==dict(GOMAXPROCS='1',GOGC='100',GOMEMLIMIT='off') and row['binaries']==pair['compiledBinaries']
  assert set(row['binaries'])=={'ynx-abci','cometbft','ynx-consensus-perf-fixture','ynx-consensus-perf-client'}
  for name,binary in row['binaries'].items():
   assert 0<binary['bytes']<=64<<20 and len(binary['sha256'])==64
   assert all(k in binary['buildInfo'] for k in ('GOOS=linux','GOARCH=amd64','CGO_ENABLED=0'))
   if name!='cometbft':assert 'vcs.revision='+contract['sourceCommit'] in binary['buildInfo'] and 'vcs.modified=false' in binary['buildInfo']
   else:assert 'github.com/cometbft/cometbft\tv0.38.23\th1:jtCe5Do4EcHVf/FCyZMvkBm+AmsRGGyvswImXYAabdM=' in binary['buildInfo']
  roles={'fixture','client'}|{'abci-'+str(i) for i in range(4)}|{'comet-'+str(i) for i in range(4)}
  assert len(row['children'])==10 and {child['role'] for child in row['children']}==roles
  samples=row['samples']+[verdict['postFsyncSample']]
  for sample in samples:
   assert sample['rssBytes']<=caps['ownedRSSBytes'] and sample['threads']<=caps['threads'] and sample['privateBytes']<=caps['perCasePrivateBytes'] and sample['buildBytes']<=caps['buildDirectoryBytes']
   assert len(sample['tasks'])<=caps['ownedProcesses'] and sample.get('processLogBytes',0)<=caps['perCaseProcessLogBytes']
   assert sample['availableMemoryBytes']>=floors['nativeMemAvailableFloorBytes'] and sample['freeDiskBytes']>=floors['diskFloorBytes']+floors['rootReserveBytes']
  code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
  parsed=json.loads(subprocess.check_output([shutil.which('node') or 'node','--input-type=module','-e',code,str(reader_dir/'node-phase-timing.mjs')]+[str(root/('abci-'+str(i)+'.log')) for i in range(4)],timeout=10))
  assert parsed==row['nodePhases'],'original node logs/phase receipt differ'
  client_raw=(root/'network/transactions-result.json').read_bytes();assert len(client_raw)<=16<<20 and hashlib.sha256(client_raw).hexdigest()==row['resultSHA256']
  client=json.loads(client_raw)
  result['cases'].append(dict(mode=mode,observerPhaseTotals=client['groupedObservation']['phases']['totals'],reader=client['durableReadback'],supply=client['readySenders']['supply'],processCPU=client['processCPU'],summary=client['summary'],receipt=pin(path),nativeTerminal=verdict,measurement=row['measurement'],nodePhases=parsed,host=row['host'],sampledPeaks={k:max(s[k] for s in samples) for k in ('rssBytes','threads','privateBytes','buildBytes')},nodesSpawned=[p for p in row['timeline'] if p['phase']=='nodes_spawned']))
 result.update(nativePairQualified=True,completeStreamReadback=complete,jointObservation=pair['jointObservation'],binaries=pair['compiledBinaries'],hostIdentity=pair['hostIdentity'],privateByteAccounting=contract['privateByteAccounting'],interpretation='Finite same-VM/source/4ELF8192x2 pair, original whole-window rates and per-row latency intervals. Wait totals/phase children overlap. Sampled RSS/logical retained bytes are not hard cgroup/allocated-block peaks. Empty scans retain the same original launcher, not full process-group empty. No sustained1000/600s claim.')
except Exception as error:result['firstCause']=result['firstCause'] or str(error) or type(error).__name__
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print(json.dumps(dict(nativePairQualified=result['nativePairQualified'],slotReturned=result['slotReturned'],sustainedTPSQualified=False,firstCause=result['firstCause'],output=pin(out))))
sys.exit(0 if result['nativePairQualified'] else 1)
