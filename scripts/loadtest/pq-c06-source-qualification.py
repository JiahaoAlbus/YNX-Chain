"""Finite c06 source DATA receiver. No build, socket, signing or pressure."""
import hashlib
import io
import json
from pathlib import Path
import stat
import subprocess
import time
import zipfile

SOURCE='c06b4607247a1fdf7e485337ab03206984baa71c'
TREE='4fdb9def5256e30108a0f29396eef1e67618fee1'
BEFORE='01a2fcb6c727f8842327f2f4883d17fdbfaf0b3b'
CONTROLLER='bfa6effac394cf0ade520d8a7ee83317bcf7d6bc'
CONTROLLER_TREE='57041dbcd9afcaf107d30cbd311709f1f06ea03d'
FREEZE_SHA='6329ead63e498324d0ba25021c7fd7c616f84f2717c3273a6f3b5c30ea51dd8f'
COMPARE_SHA='b477f038f6ea2f09db66ca18e2417ff3cbefb3a7230c740c942254b7332533f5'
INPUT_SHA='3e395f7b39ac07abb117e6373f800cc6b256c32154e2dc44786bde40f7b5fcd4'
ARTIFACT_SHA='65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe'
TOP_TESTS={
 'TestOperatorCommitObservationSchemaFixture',
 'TestOperatorCommitObservationDefaultAndClosedFlags',
 'TestOperatorCommitObservationRejectsPublicMigrationAndNetworkBeforeEnable',
 'TestOperatorCommitObservationLoggerModuleOwnershipAndUntrustedPayloads',
 'TestOperatorCommitObservationMissingFailureAndReplayRemainUnknown',
 'TestOperatorCommitObservationOutputPreservesOriginalAndStopFailure',
 'TestOperatorCommitObservationBoundedSamplesAndNormalStopGuard',
 'TestOperatorCommitObservationRealBlockExecutorStateFeesAndJournalEquivalent',
 'TestOperatorWireObservationNormalStopOneOutputAndPublicSchema',
 'TestOperatorWireObservationFailureAndUnknownPreserveOriginal'}

def require(ok,reason):
    if not ok:raise RuntimeError(reason)

def strict(raw):
    def pairs(items):
        out={}
        for key,value in items:
            require(key not in out,'duplicate qualification field');out[key]=value
        return out
    return json.loads(raw,object_pairs_hook=pairs)

def pinned(root,name,pin,size=None):
    root=Path(root);path=root/name
    require(root.is_absolute() and root.resolve(strict=True)==root and path.resolve(strict=True)==path and root in path.parents,'original finite path redirected')
    info=path.lstat();require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and 0<info.st_size<=4<<20,'bounded original metadata file required')
    raw=path.read_bytes();require(len(raw)==info.st_size and (size is None or len(raw)==size) and hashlib.sha256(raw).hexdigest()==pin,'original metadata bytes differ')
    return raw

def inspect_functional(root):
    """Read original metadata/height frames; never reread 4.97GB CAS payloads."""
    f=strict(pinned(root,'FRESH-N1-FUNCTIONAL-EVIDENCE-FREEZE.json',FREEZE_SHA,71492))
    comparison=strict(pinned(root,'ACTUAL-CROSS-VERSION-COMPARISON.json',COMPARE_SHA,1552))
    require(f['comparison']==comparison and f['sourceCommits']==dict(before=BEFORE,after=SOURCE) and f['inputSHA256']==INPUT_SHA,'diagnostic source pair/input differs')
    require(comparison['N']==1 and comparison['targetMembers']==500 and comparison['owners']==8 and comparison['nodeStarted'] is False and comparison['onlinePerformanceOrTPSClaim'] is False and comparison['oldUnknownReplayed'] is False,'functional scope changed')
    layouts=[];metadata_files=2;metadata_bytes=73044
    def original(name,pin):
        nonlocal metadata_files,metadata_bytes
        raw=pinned(root,name,pin['sha256'],pin['bytes']);metadata_files+=1;metadata_bytes+=len(raw);return raw
    for layout,members,last in [('block-journal',500,66),('atomic-json',500,66),('snapshot-journal',280,38)]:
        maps=[f['actualOriginalTracePins'][side+'-'+layout] for side in ('before','after')]
        footers=[]
        for source,pins in zip((BEFORE,SOURCE),maps):
            name=source+'/'+layout+'/RESULT.json';value=strict(original(name,pins[name]));require(value['sourceCommit']==source and value['inputSHA256']==INPUT_SHA and value['layout']==layout and value['consumerOn']==(source==SOURCE),'original footer identity changed');footers.append(value)
        require({k:v for k,v in footers[0].items() if k not in ('sourceCommit','consumerOn')}=={k:v for k,v in footers[1].items() if k not in ('sourceCommit','consumerOn')},'actual complete cold state/accounts/fees differ')
        require(footers[0]['durableMembers']==members and footers[0]['lastDurableHeight']==last and footers[0]['complete500']==(members==500),'partial layout promoted to500')
        prefixes=[s+'/'+layout+'/' for s in (BEFORE,SOURCE)]
        names=[sorted(n.removeprefix(prefix) for n in pins if n.startswith(prefix+'height-')) for pins,prefix in zip(maps,prefixes)]
        require(names[0]==names[1] and len(names[0])==(63 if members==500 else 36),'original height coverage differs')
        total=0;points={};failed=0
        for name in names[0]:
            raws=[original(prefix+name,pins[prefix+name]) for prefix,pins in zip(prefixes,maps)]
            require(raws[0]==raws[1],'actual execution/accounts/nonce/fee/AppHash/persistence references differ')
            frame=strict(raws[0]);ref=frame['originalPersistence'];require(ref['path']=='raw/'+ref['sha256'] and type(ref['bytes']) is int and ref['bytes']>0,'original CAS reference invalid')
            if frame['durable']:
                require(frame['attemptHeight']==frame['height']==4+len(points) and frame['error']=='' and frame['appHash']==frame['engineAppHash'],'durable height/hash differs')
                total+=len(frame['inputHashes']);require(frame['executedMembers']==total,'member continuity differs');points[frame['height']]=frame['appHash']
            else:
                failed+=1;require(layout=='snapshot-journal' and frame['attemptHeight']==39 and 'snapshot exceeds journal payload ceiling' in frame['error'] and frame['executedMembers']==280,'original snapshot refusal lost')
        require(total==members and failed==(members<500),'actual durable prefix differs')
        for name in ('invalid-0.json','invalid-1.json'):
            raw=[original(prefix+name,pins[prefix+name]) for prefix,pins in zip(prefixes,maps)];require(raw[0]==raw[1] and strict(raw[0])['code']!=0,'original AND signature refusal lost')
        name=SOURCE+'/'+layout+'/CONSUMER-FUNCTIONAL-DATA.json';consumer=strict(original(name,maps[1][name]))
        require(consumer['nodeStarted'] is False and consumer['normalNodeOutputWritten'] is False,'functional consumer became normal window')
        observed=consumer['unfinalizedOriginalConsumer'];samples=observed['samples'];require(len(samples)==len(points),'functional Commit sample coverage differs')
        sums={};elapsed=0
        for sample in samples:
            require(points.get(sample['height'])==sample['appHash'],'functional Commit AppHash differs');timing=sample['persistence'];stages=timing['stagesNs']
            require(timing['durable'] is True and all(type(v) is int and v>=0 for v in stages.values()) and sum(stages.values())<=timing['elapsedNs'],'actual stage spans invalid')
            elapsed+=timing['elapsedNs']
            for stage,ns in stages.items():sums[stage]=sums.get(stage,0)+ns
        layouts.append(dict(layout=layout,durableMembers=members,durableHeights=len(points),lastDurableHeight=last,complete500=members==500,snapshotCeilingBytes=33554432,failedBoundaryAttempts=failed,actualLocalPersistenceElapsedNs=elapsed,actualLocalStageTotalsNs=sums,coldStateSHA256=footers[0]['coldStateSHA256']))
    return dict(version='YNX-PERF-C06-DIAGNOSTIC-FUNCTIONAL-READBACK/v1',before=BEFORE,after=SOURCE,inputSHA256=INPUT_SHA,freezeSHA256=FREEZE_SHA,comparisonSHA256=COMPARE_SHA,layouts=layouts,metadataFilesRead=metadata_files,metadataBytesRead=metadata_bytes,originalCASPayloadsRehashedByPERF=False,originalCASPayloadsRehashedByCORE=161,onlinePerformanceClaim=False,actualFourNodeWindow=False,performanceBeforeAfterSourcePairQualified=False,authorityGranted=False)

def run_identity(run,identity,head,path,conclusion):
    require(run.get('id')==identity and run.get('head_sha')==head and run.get('head_branch')=='codex/ynx-pq-perf-integration' and run.get('path')==path and type(run.get('run_attempt')) is int and run['run_attempt']==1 and run.get('event')=='push' and run.get('status')=='completed' and run.get('conclusion')==conclusion,'fixed original CI identity/conclusion differs')

def functional_readback(layout='atomic-json'):
    raw=pinned(Path(__file__).resolve().parent/'fixtures','c06-functional-readback.json','23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146',2775)
    data=strict(raw)
    require(layout in ('atomic-json','block-journal'),'snapshot280 cannot qualify a complete500 window')
    require(data['before']==BEFORE and data['after']==SOURCE and data['freezeSHA256']==FREEZE_SHA and data['comparisonSHA256']==COMPARE_SHA and data['performanceBeforeAfterSourcePairQualified'] is False,'unrelated performance source pair cannot inherit diagnostic equality')
    require(next(x for x in data['layouts'] if x['layout']==layout)['durableMembers']==500,'full500 diagnostic prefix missing')
    return data

def require_performance_pair(before,after,data):
    require(data.get('before')==before and data.get('after')==after and data.get('performanceBeforeAfterSourcePairQualified') is True,'complete selected before/after performance source pair qualification NOT_SUPPLIED; diagnostic01a-c06 cannot substitute')

def api_reader():
    allowed={'actions/runs/41285983813','actions/runs/41285983876','actions/runs/41288482948','actions/jobs/124794579487','actions/artifacts/13076665019','git/commits/'+SOURCE,'git/commits/'+CONTROLLER}
    deadline=time.monotonic()+60
    def fetch(path,binary=False):
        require(path in allowed and not binary or binary and path=='actions/artifacts/13076665019/zip','fixed read-only c06 API path required')
        remaining=deadline-time.monotonic();require(remaining>0,'finite qualification API deadline exceeded')
        value=subprocess.run(['gh','api','--hostname','github.com','--method','GET','repos/JiahaoAlbus/YNX-Chain/'+path],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(20,remaining))
        require(value.returncode==0 and len(value.stdout)<=(4985 if binary else 2<<20),'fixed qualification read unavailable or oversized')
        return value.stdout if binary else strict(value.stdout)
    return fetch

def validate_named_archive(raw):
    require(type(raw) is bytes and len(raw)==4985 and hashlib.sha256(raw).hexdigest()==ARTIFACT_SHA,'whole named archive differs')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        require(len(z.infolist())==3 and set(z.namelist())=={'commit-consumer-source.json','commit-consumer-tests.jsonl','commit-consumer-result.json'} and all(x.file_size<=128<<10 for x in z.infolist()) and z.testzip() is None,'closed named archive/CRC differs')
        source=strict(z.read('commit-consumer-source.json'));result=strict(z.read('commit-consumer-result.json'));test_raw=z.read('commit-consumer-tests.jsonl')
    for d in (source,result):
        require(d['actualCalleeSHA']==SOURCE and d['actualCalleeTree']==TREE and d['controllerSHA']==CONTROLLER and d['workflowOnlyContinuation'] is True and d['authorityGranted'] is False and d['publicActivation'] is False,'named actual callee binding differs')
    require(result['runId']=='41288482948' and result['runAttempt']=='1' and result['skipped']==0 and set(result['requiredPassed'])==TOP_TESTS and result['testJSONSHA256']==hashlib.sha256(test_raw).hexdigest() and result['testJSONBytes']==len(test_raw),'named result scope differs')
    rows=[strict(line) for line in test_raw.splitlines()];tests=[r for r in rows if r.get('Test')];runs=[r['Test'] for r in tests if r['Action']=='run'];passes=[r['Test'] for r in tests if r['Action']=='pass']
    require(len(runs)==len(passes)==len(set(passes))==47 and set(runs)==set(passes) and {n for n in passes if '/' not in n}==TOP_TESTS and not any(r['Action'] in ('skip','fail') for r in rows),'every original named case must actually pass without skips')
    require(sum(r['Action']=='pass' and 'Test' not in r for r in rows)==1,'original package pass missing')
    return dict(topPassed=10,includingSubcasesPassed=47,skipped=0,artifactSHA256=ARTIFACT_SHA,originalSupplementWholeConclusion='failure',namedJobConclusion='success')

def qualify(fetch):
    specs=[(41285983813,SOURCE,'.github/workflows/resource-market-ci.yml','success'),(41285983876,SOURCE,'.github/workflows/chain-core.yml','success'),(41288482948,CONTROLLER,'.github/workflows/chain-core.yml','failure')]
    for args in specs:run_identity(fetch('actions/runs/'+str(args[0])),*args)
    for sha,tree,parent in [(SOURCE,TREE,BEFORE),(CONTROLLER,CONTROLLER_TREE,SOURCE)]:
        graph=fetch('git/commits/'+sha);require(graph.get('sha')==sha and graph.get('tree',{}).get('sha')==tree and [p['sha'] for p in graph.get('parents',[])]==[parent],'exact source/controller graph differs')
    job=fetch('actions/jobs/124794579487');require(job.get('id')==124794579487 and job.get('run_id')==41288482948 and job.get('head_sha')==CONTROLLER and job.get('name')=='Original Commit consumer named cases' and job.get('status')=='completed' and job.get('conclusion')=='success','actual original named job differs')
    require(len(job.get('steps',[]))==9 and all(s['status']=='completed' and s['conclusion']=='success' for s in job['steps']) and sum(s['name']=='Execute every new Commit case and affected original stop cases' for s in job['steps'])==1,'named steps missing/skipped')
    a=fetch('actions/artifacts/13076665019');link=a.get('workflow_run',{})
    require(a.get('id')==13076665019 and a.get('name')=='ynx-commit-consumer-cases-'+SOURCE+'-41288482948' and a.get('size_in_bytes')==4985 and a.get('expired') is False and a.get('digest')=='sha256:'+ARTIFACT_SHA and link.get('id')==41288482948 and link.get('head_sha')==CONTROLLER and link.get('head_branch')=='codex/ynx-pq-perf-integration' and link.get('repository_id')==link.get('head_repository_id')==1285041796,'official artifact/run binding differs')
    named=validate_named_archive(fetch('actions/artifacts/13076665019/zip',binary=True))
    # Reconcile the same original CI operations again; never rerun or alias them.
    for args in specs:run_identity(fetch('actions/runs/'+str(args[0])),*args)
    return dict(version='YNX-PERF-C06-FINITE-SOURCE-DATA/v1',classification='data',sourceCommit=SOURCE,sourceTree=TREE,resourceWholeSuccess=True,chainWholeSuccess=True,actualNamedCases=named,functionalDiagnostic=functional_readback(),actual500Window=False,authorityGranted=False,nodeStartAuthorized=False,performanceBeforeAfterSourcePairQualified=False)
