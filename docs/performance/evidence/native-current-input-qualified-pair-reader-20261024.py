"""Read only the original granted pair, its full CI log and recovered public files.
Arguments: capture root, original full CI log, terminal gh run JSON, NEW output.
Failure/closure are reported separately; never dispatch, retry or infer sustained TPS.
"""
import datetime,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
base=Path(sys.argv[1]).absolute()
capture,logpath,runpath,out=map(Path,sys.argv[2:])
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def read(path):return json.loads(path.read_bytes())
def closure(scans,launcher):
 assert len(scans)==2 and all(s.get('owned')==[launcher] and type(s.get('launcherStartTicks')) is int and s['launcherStartTicks']>0 for s in scans),'actual two empty owned scans absent'
 assert scans[0]['launcherStartTicks']==scans[1]['launcherStartTicks'],'launcher identity changed'
 return scans[0]['launcherStartTicks']
def frames(prefix):
 return [json.loads(line.split(prefix,1)[1]) for line in logpath.read_text().splitlines() if prefix in line and '\x1b' not in line]
contract=read(base/'single-attempt-plan-ci-success.json');wrapped=read(base/'root-authorization.json');grant=wrapped['grant'];grant_raw=(base/'original-root-grant.json').read_bytes()
assert (len(grant_raw),hashlib.sha256(grant_raw).hexdigest())==(6626,'8af972ff27ad568a883e27355183f4495fbea50230f374be456c12cf2abeb905') and json.loads(grant_raw)==grant
assert grant['sourceCommit']==contract['sourceCommit'] and grant['frozenRef']=='refs/tags/'+contract['sourceRef'] and grant['dispatchRule'].startswith('One O_EXCL/fsync')
assert pin(base/'single-attempt-plan-ci-success.json')['sha256']==grant['plan']['sha256'] and pin(base/'pair-recipe.json')['sha256']==grant['recipeSHA256']
assert contract['normalCI']['headSha']==contract['sourceCommit'] and contract['normalCI']['status']=='completed' and contract['normalCI']['conclusion']=='success'
assert pin(base/'normal-ci-full.raw')['sha256']==contract['normalCI']['fullLogSHA256']
assert grant['caseCaps']==contract['caseCaps'] and grant['caps']==contract['caps']
assert subprocess.check_output(['git','rev-parse',contract['sourceCommit']+'^{tree}'],text=True).strip()==contract['sourceTree']
for directory,key in [('cmd/ynx-consensus-perf-client','runtimeClientTree'),('cmd/ynx-abci','diagnosticNodeTree')]:
 assert subprocess.check_output(['git','rev-parse',contract['sourceCommit']+':'+directory],text=True).strip()==contract[key]
frozen_pins=[]
for name in ('supply-linux-window.py','test_supply_linux_window.py','native-stream-evidence.py','test_native_stream_evidence.py','pq-paired-linux-window.py','native-stream-artifact.py','test_native_stream_artifact.py','test_native_stream_pair.py','node-phase-timing.mjs','node-phase-timing.test.mjs','chain-core.yml'):
 path=base/'frozen-readers'/name;repository_path='.github/workflows/chain-core.yml' if name=='chain-core.yml' else 'scripts/loadtest/'+name
 assert not path.is_symlink() and path.read_bytes()==subprocess.check_output(['git','show',contract['sourceCommit']+':'+repository_path])
 frozen_pins.append(dict(repositoryPath=repository_path,**pin(path)))
original_caps=grant['caseCaps'];aggregate=grant['caps']
contract['runtimeCaps']=dict(pairRetainedBytes=aggregate['retainedBytes'],pairProcessLogBytes=aggregate['logBytes'],ownedRSSBytes=original_caps['ownedRSSBytes'],threads=original_caps['threads'],buildDirectoryBytes=original_caps['buildBytes'],perCasePrivateBytes=original_caps['privateBytes'],ownedProcesses=original_caps['ownedProcesses'],perCaseProcessLogBytes=original_caps['logBytes'])
contract['freshAdmission']=dict(nativeMemAvailableFloorBytes=original_caps['availableMemoryFloorBytes'],diskFloorBytes=original_caps['diskFloorBytes'],rootReserveBytes=original_caps['rootReserveBytes'],compileReserveBytes=original_caps['compileReserveBytes'],initialPrivateReserveBytes=aggregate['retainedBytes'])
contract['privateByteAccounting']='Original sampled per-case private256MiB and aggregate retained512MiB including original receipts; output build1GiB. No compile-time hard RSS/timeout claim; normal job20min includes priorCI and build outside pair120s.'
run=read(runpath);trigger=read(base/'reconciled-original-run.json')['original'];dispatch=read(base/'dispatch-command-result.json')
assert run['databaseId']==trigger['databaseId']==40047424926 and run['headSha']==contract['sourceCommit'] and run['headBranch']==contract['sourceRef'] and run['event']=='workflow_dispatch' and run['attempt']==1 and run['status']=='completed'
assert datetime.datetime.fromisoformat(grant['issuedAt'])<=datetime.datetime.fromisoformat(dispatch['startedAt'])<datetime.datetime.fromisoformat(grant['dispatchBy'])
pair_path=capture/'evidence/actual.json';pair=read(pair_path);terms=frames('YNX_NATIVE_STREAM_PAIR_TERMINAL ');assert len(terms)==1;term=terms[0]
assert term.get('pairReceiptSHA256')==pin(pair_path)['sha256']
result=dict(schema=1,kind='original-native-current-input-pair-qualified-readback',runId=run['databaseId'],sourceCommit=contract['sourceCommit'],sourceRef=contract['sourceRef'],originalGrantSHA256=wrapped['sha256'],originalRun=pin(runpath),originalLog=pin(logpath),originalPairReceipt=pin(pair_path),consumerTool=pin(Path(__file__)),frozenReaders=frozen_pins,normalCILog=pin(base/'normal-ci-full.raw'),terminal=term,nativePairQualified=False,slotReturned=False,cases=[],sustainedTPSQualified=False,firstCause=pair.get('firstCause') or term.get('firstCause'))
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
 spec=importlib.util.spec_from_file_location('original_pair_zip',base/'frozen-readers/native-stream-artifact.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
 complete=reader.verify_capture(capture,'network-pair',contract['sourceCommit'])
 native_terms=frames('YNX_NATIVE_STREAM_TERMINAL ');assert len(native_terms)==2
 for index,(label,mode) in enumerate((('native-input-separate','bounded-cadence'),('native-input-shared','bounded-cadence'))):
  case=('before-' if index==0 else 'after-')+label;root=capture/case;path=root/'evidence/actual.json';row=read(path);verdict=native_terms[index]
  assert verdict['receiptSHA256']==pin(path)['sha256'] and verdict.get('qualified') is True and verdict.get('nodesStarted') is True and verdict.get('firstCause') is None
  assert verdict['kind']=='native-stream2048x4-post-fsync-verdict' and 0<verdict['elapsedMs']<=60000
  assert row['cleanupComplete'] is True and row['nodesStarted'] is True and row.get('firstCause') is None
  assert closure(row['closureScans'][-2:],row['launcher'])==closure(verdict['postFsyncClosureScans'],row['launcher'])==closure(term['postFsyncClosureScans'],pair['launcher'])
  assert row['nativeCurrentInputReuse'] is (index==1)
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
  parsed=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',code,str(base/'frozen-readers/node-phase-timing.mjs')]+[str(root/('abci-'+str(i)+'.log')) for i in range(4)],timeout=10))
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
