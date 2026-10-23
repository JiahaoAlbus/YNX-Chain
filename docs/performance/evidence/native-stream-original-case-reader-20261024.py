"""Original single-case grant/run/receipt/terminal admission. Never submit or retry.
Arguments: frozen source context, recovered capture root, original full CI log, terminal gh run JSON, new output.
Read-only qualification uses the exact frozen original source readers. No sustained TPS.
"""
import calendar,datetime,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
base=Path(sys.argv[1]).resolve()
capture,logpath,runpath,out=map(Path,sys.argv[2:])
contract=json.loads((base/'ci-qualified-pregrant-contract.json').read_bytes())
wrapped=json.loads((base/'root-authorization.json').read_bytes());grant=wrapped['grant']
actual_grant=Path(wrapped['path']).read_bytes()
assert len(actual_grant)==wrapped['bytes'] and hashlib.sha256(actual_grant).hexdigest()==wrapped['sha256'] and json.loads(actual_grant)==grant
assert grant['sourceCommit']==contract['sourceCommit'] and grant['sourceRef']==contract['sourceRef'] and grant['input']==contract['input'] and grant['effectiveCaps']==contract['runtimeCaps'] and grant['freshAdmission']==contract['freshAdmission']
assert contract['normalCIQualified'] is True
for row in contract['readbackTools'].values():
 raw=Path(row['path']).read_bytes();assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
def pin(path):
 raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def frames(prefix):
 return [json.loads(line.split(prefix,1)[1]) for line in logpath.read_text().splitlines() if prefix in line and '\x1b' not in line]
def instant(value):
 at=datetime.datetime.fromisoformat(value);assert at.tzinfo is not None
 return calendar.timegm(at.utctimetuple())*1000000000+at.microsecond*1000
def closure(scans,launcher):
 assert len(scans)==2 and all(s.get('owned')==[launcher] and type(s.get('launcherStartTicks')) is int and s['launcherStartTicks']>0 for s in scans)
 assert scans[0]['launcherStartTicks']==scans[1]['launcherStartTicks']
 return scans[0]['launcherStartTicks']
run=json.loads(runpath.read_bytes());assert run['status']=='completed' and run['event']=='workflow_dispatch' and run['attempt']==1 and run['headSha']==contract['sourceCommit'] and run['headBranch']==contract['sourceRef']
trigger=json.loads((base/'reconciled-original-run.json').read_bytes());assert trigger['runId']==run['databaseId'] and trigger['sourceCommit']==contract['sourceCommit'] and trigger['sourceRef']==contract['sourceRef']
assert instant(grant['createdAt'])<=instant(trigger['startedAt'])<=instant(grant['dispatchAndFirstNodeDeadline'])
receipt_path=capture/'evidence/actual.json';receipt=json.loads(receipt_path.read_bytes());assert receipt['sourceCommit']==contract['sourceCommit']
term=frames('YNX_NATIVE_STREAM_TERMINAL ');assert len(term)==1;term=term[0]
assert term['receiptSHA256']==pin(receipt_path)['sha256']
summary=receipt.get('measurement',{}).get('summary',receipt.get('partialMeasurement',{}).get('summary'))
result=dict(schema=1,runId=run['databaseId'],sourceCommit=contract['sourceCommit'],sourceRef=contract['sourceRef'],originalGrantSHA256=wrapped['sha256'],originalRun=pin(runpath),originalLog=pin(logpath),originalReceipt=pin(receipt_path),terminal=term,reportedSummary=summary,nativeCaseQualified=False,slotReturned=False,sustained1000Qualified=False,firstCause=receipt.get('firstCause') or term.get('firstCause'))
try:
 pre_ticks=closure(receipt['closureScans'][-2:],receipt['launcher'])
 post_ticks=closure(term['postFsyncClosureScans'],receipt['launcher'])
 result['slotReturned']=receipt.get('cleanupComplete') is True and pre_ticks==post_ticks
except Exception as closure_error:
 result['slotClosureDiagnostic']=str(closure_error) or type(closure_error).__name__
try:
 assert run['conclusion']=='success','original workflow not successful'
 assert term['qualified'] is True and term['nodesStarted'] is True and term.get('firstCause') is None
 assert term['kind']=='native-stream2048x4-post-fsync-verdict' and type(term['elapsedMs']) is int and 0<term['elapsedMs']<=60000
 assert receipt['cleanupComplete'] is True and receipt['nodesStarted'] is True and receipt.get('firstCause') is None
 before=closure(receipt['closureScans'][-2:],receipt['launcher']);after=closure(term['postFsyncClosureScans'],receipt['launcher']);assert before==after
 started=[row for row in receipt['timeline'] if row['phase']=='nodes_spawned'];assert len(started)==1 and type(started[0]['unixNs']) is int and 0<started[0]['unixNs']<=instant(grant['dispatchAndFirstNodeDeadline'])
 roles={'fixture','client'}|{'abci-'+str(i) for i in range(4)}|{'comet-'+str(i) for i in range(4)}
 assert len(receipt['children'])==10 and {r['role'] for r in receipt['children']}==roles
 assert receipt['environment']==dict(GOMAXPROCS='1',GOGC='100',GOMEMLIMIT='off')
 assert set(receipt['binaries'])=={'ynx-abci','cometbft','ynx-consensus-perf-fixture','ynx-consensus-perf-client'}
 for name,row in receipt['binaries'].items():
  assert 0<row['bytes']<=64<<20 and len(row['sha256'])==64
  assert all(k in row['buildInfo'] for k in ('GOOS=linux','GOARCH=amd64','CGO_ENABLED=0'))
  if name!='cometbft':assert 'vcs.revision='+contract['sourceCommit'] in row['buildInfo'] and 'vcs.modified=false' in row['buildInfo']
  else:assert 'github.com/cometbft/cometbft\tv0.38.23\th1:jtCe5Do4EcHVf/FCyZMvkBm+AmsRGGyvswImXYAabdM=' in row['buildInfo']
 samples=receipt['samples']+[term['postFsyncSample']];caps=contract['runtimeCaps'];floors=contract['freshAdmission']
 for row in samples:
  assert row['rssBytes']<=caps['ownedRSSBytes'] and row['threads']<=caps['threads'] and row['privateBytes']<=caps['perCasePrivateBytes'] and row['buildBytes']<=caps['buildDirectoryBytes']
  assert len(row['tasks'])<=10 and row.get('processLogBytes',0)<=caps['perCaseProcessLogBytes']
  assert row['availableMemoryBytes']>=floors['nativeMemAvailableFloorBytes'] and row['freeDiskBytes']>=floors['diskFloorBytes']+floors['rootReserveBytes']
 assert samples[0]['freeDiskBytes']>=sum(floors[k] for k in ('diskFloorBytes','rootReserveBytes','compileReserveBytes','initialPrivateReserveBytes'))
 spec=importlib.util.spec_from_file_location('original_zip',base/'frozen-readers/native-stream-artifact.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
 complete=reader.verify_capture(capture,'network',contract['sourceCommit'])
 code="import fs from 'node:fs';import{pathToFileURL}from'node:url';const{readNodePhaseTiming:r}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(process.argv.slice(2).map(p=>r(fs.readFileSync(p,'utf8')))));"
 parsed=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',code,str(base/'frozen-readers/node-phase-timing.mjs')]+[str(capture/('abci-'+str(i)+'.log')) for i in range(4)],timeout=10))
 assert parsed==receipt['nodePhases'],'original node logs/receipt phase counters differ'
 result.update(nativeCaseQualified=True,slotReturned=True,completeStreamReadback=complete,originalNodeLogReadbackMatchesReceipt=True,actualNodesSpawned=started[0],admissionBeforeOriginalGrantDeadline=True,host=receipt['host'],binaries=receipt['binaries'],sampledPeaks={k:max(row[k] for row in samples) for k in ('rssBytes','threads','privateBytes','buildBytes')},privateByteAccounting=contract['privateByteAccounting'],interpretation='Finite8192 original qualified business evidence plus original source/ELFs/resource samples/admission/receipt/fsync/fresh double closure and workflow exit. Sampled RSS/retained logical file sizes are not hard cgroup or allocated-block peaks. Closure retains original launcher; not full process-group empty or direct launcher-exit proc observation. No ten-minute/sustained TPS or matched improvement inferred.')
except Exception as error:
 result['firstCause']=result['firstCause'] or str(error) or type(error).__name__
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as handle:json.dump(result,handle,indent=2);handle.write('\n');handle.flush();os.fsync(handle.fileno())
print(json.dumps(dict(nativeCaseQualified=result['nativeCaseQualified'],slotReturned=result['slotReturned'],sustained1000Qualified=False,firstCause=result['firstCause'],output=pin(out))))
sys.exit(0 if result['nativeCaseQualified'] else 1)
