"""Pinned original28-case source-only DATA. Never an ON/runtime grant."""
import hashlib,io,json,stat,zipfile
from pathlib import Path,PurePosixPath
ARCHIVE_SHA='4139c50b32dc9929522da0ba61b18df271e9cee2a7d7ef7760f5860832ea7e81'
METADATA_SHA='97e733ec1a9bd5e7bd16dbe23996850193a2e647985483e3223d7d50351c8aa1'
SOURCE='1a643b744c568a9063617a7f0cc173e1ac149a42'
TREE='7aef6697637c5fae90bde654b3cfb936ae9f277f'
SUPPLIER='ed628e5cdd00c4496de5b2587bf2e9585aaf3d2d'
FORK='f1a8837079178469bc57ede955c55973f8b7d8ba'
REQUIRED={'normalProducer': ['TestOperatorLosslessHexDefaultOffAndClosedFlags', 'TestOperatorLosslessPairOriginalPQTimeIsConsensusState', 'TestOperatorLosslessHexTypedNormalConstructorBeforeStart', 'TestOperatorLosslessHexTypedScopeAndSourceRefusals'], 'originalSupplierBudget': ['TestLosslessHexBudgetNormalize', 'TestLosslessHexBudgetPeerIdentityAndLifetime', 'TestLosslessHexBudgetPeerBytes', 'TestLosslessHexBudgetPeerClock', 'TestLosslessHexBudgetSendAttemptsAndAtomicCharge', 'TestLosslessHexBudgetSendIdentityAndClock', 'TestLosslessHexBudgetSendClockRollback', 'TestLosslessHexBudgetParallelReservations', 'TestLosslessHexBudgetParallelAttemptsAndClose', 'TestLosslessHexBudgetInitialPeerReadinessDeadline', 'TestLosslessHexBudgetReadyTransitionKeepsSelectedCarrier', 'TestLosslessHexBudgetFullQueueStopsWithoutRawReplay', 'TestLosslessHexBudgetReceiveBeforeOriginalCheckTx', 'TestLosslessHexBudgetFullQueueElapsedDeadline', 'TestLosslessHexBudgetInvalidEnableStaysDefaultOff', 'TestLosslessHexBudgetPackReservesBeforeFrameAllocation', 'TestLosslessHexBudgetPackFailureNeverFallsBack', 'TestLosslessHexBudgetTypedNilPeerCannotClaimCapability', 'TestLosslessHexBudgetLocalExhaustionDoesNotDisconnectAndRedial', 'TestLosslessHexTransportDefaultOffAndSingleCarrier', 'TestLosslessHexTransportLegacyEmptyUnknownAndMalformedKeepOriginalEntry', 'TestLosslessHexTransportQueuedRetryKeepsSelectedFormat', 'TestLosslessHexTransportRejectsBeforeCheckTxNoRawFallback', 'TestLosslessHexTransportRestoresBeforeOriginalPrecheckCacheAndTxKey']}

def require(ok,message):
    if not ok:raise RuntimeError(message)
def strict(raw):
    def pairs(items):
        value={}
        for key,item in items:require(key not in value,'duplicate source DATA JSON field');value[key]=item
        return value
    return json.loads(raw,object_pairs_hook=pairs)
def require_named_run_pass(raw,expected):
    events=[strict(line) for line in raw.splitlines()]
    require(not any(e.get('Action') in ('skip','fail') for e in events),'original source test failure/skip retained')
    for name in expected:
        require(sum(e.get('Action')=='run' and e.get('Test')==name for e in events)==1 and sum(e.get('Action')=='pass' and e.get('Test')==name for e in events)==1,'actual unique named source run/pass missing')
    require(any(e.get('Action')=='pass' and 'Test' not in e for e in events),'original source package return missing')

def read_original(archive,metadata):
    require(len(archive)<=32<<10 and hashlib.sha256(archive).hexdigest()==ARCHIVE_SHA and len(metadata)<=32<<10 and hashlib.sha256(metadata).hexdigest()==METADATA_SHA,'exact original source artifact/official metadata pin differs')
    meta=strict(metadata);job=meta['job'];require(job['id']==124936327016 and job['run_id']==41336145123 and job['head_sha']==SOURCE and job['status']=='completed' and job['conclusion']=='success' and job['run_attempt']==1,'actual successful original source job required')
    manifest={r['name']:r for r in meta['artifact']['files']};files={}
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        require(len(z.infolist())==8,'exact original8 source files required')
        for entry in z.infolist():
            name=PurePosixPath(entry.filename);require(str(name)==entry.filename and not name.is_absolute() and '..' not in name.parts and '\\' not in entry.filename and not stat.S_ISLNK(entry.external_attr>>16) and entry.filename not in files and entry.file_size<=128<<10,'unsafe original source archive entry')
            raw=z.read(entry);pin=manifest.get(entry.filename);require(pin and len(raw)==entry.file_size==pin['bytes'] and hashlib.sha256(raw).hexdigest()==pin['sha256'],'original source file pin differs');files[entry.filename]=raw
    require(set(files)==set(manifest),'complete original source inventory required')
    prefix='wire-lossless-source-9lonvyo1/';source=strict(files[prefix+'SOURCE.json'])
    require(source['sourceCommit']==SOURCE and source['sourceTree']==TREE and source['optionalForkCommit']==SUPPLIER and source['optionalForkTree']==FORK and source['productionForkTree']=='54e88e6aba735eaceeb2d00bb40731248c673bd7','exact new source/supplier required')
    require(source['sourceOnly'] is True and source['nodeProcessesStarted']==0 and all(source[k] is False for k in ['actualOnRunningWindow','actualRunningWindow','carrierEnabled','productionForkModified','publicActivation','physicalBytesMeasured']),'source-only scope differs')
    def original(ref):
        name=Path(ref['path']).name;raw=files[prefix+name];require(len(raw)==ref['bytes'] and hashlib.sha256(raw).hexdigest()==ref['sha256'],'original declared source log pin differs');return raw
    selection=source['preparedSourceSelection'];raw=files[prefix+'composition/SOURCE-SELECTION.json'];require(len(raw)==selection['receiptBytes'] and hashlib.sha256(raw).hexdigest()==selection['receiptSHA256'] and strict(raw)==selection['sourceSelection'],'original source selection copy differs')
    actual=[]
    for group,expected in REQUIRED.items():
        ref=source[group];raw=original(ref);result=strict(original(ref['result']));original(ref['stderr'])
        require(ref['requiredPassed']==expected and result['requiredPassed']==expected and result['validationPassed'] is True and result['returnCode']==0 and result['timedOut'] is False and result['firstFailure'] is None,'original named source test result differs')
        require_named_run_pass(raw,expected);actual+=expected
    return dict(schema='YNX-PERF-NEW-LOSSLESS-SOURCE-DATA/v1',source=SOURCE,sourceTree=TREE,supplierCommit=SUPPLIER,supplierTree=FORK,run=41336145123,job=124936327016,artifact=13095262629,archiveSHA256=ARCHIVE_SHA,originalFilesVerified=8,actualNamedCases=len(actual),sourceOnlyQualified=True,normalONRuntimeQualified=False,runtimeAuthorized=False,pressureAuthorized=False,physicalBytesMeasured=False)

def qualification():
    base=Path(__file__).with_name('fixtures')
    return read_original((base/'1a-lossless-source-original.zip').read_bytes(),(base/'1a-lossless-source-job.json').read_bytes())


COMPONENT_SOURCE='6cc85996524896c68aa9877b209c777fbcc25ae0'
COMPONENT_TREE='78a9795da7c709abb023d4e26ff3637771cd52a2'
COMPONENT_JOBS_SHA='abcef528a4e4c4c4b99706366a66adcce6451cfb3e884833f4655203a001053e'

def component_qualification():
    """Consume6cc's own44 actual named cases, never transfer1a qualification."""
    base=Path(__file__).with_name('fixtures');raw=(base/'6cc-component-source-H.json').read_bytes()
    require(hashlib.sha256(raw).hexdigest()=='8ca54724aabb5f69928748baf72f49090a9f089b8dfce842995570952a30bdf2','exact new6cc Core source qualification pin differs');h=strict(raw)
    raw=(base/'6cc-component-source-jobs.json').read_bytes();require(hashlib.sha256(raw).hexdigest()==COMPONENT_JOBS_SHA,'exact new6cc official job metadata pin differs');jobs=strict(raw)
    require(h['sourceCommit']==COMPONENT_SOURCE and h['sourceTree']==COMPONENT_TREE and h['optionalForkCommit']==SUPPLIER and h['optionalForkTree']==FORK and h['productionForkTree']=='54e88e6aba735eaceeb2d00bb40731248c673bd7','new6cc source/module tuple differs')
    for job_id in (124941232693,124941232665):
        job=jobs[str(job_id)];require(job['id']==job_id and job['run_id']==41337784596 and job['head_sha']==COMPONENT_SOURCE and job['status']=='completed' and job['conclusion']=='success' and job['run_attempt']==1,'new6cc successful original source jobs required')
    files={}
    for index,(role,name,count,pin) in enumerate([('lossless','6cc-lossless-source-original.zip',8,'6f1ad2c3ec3de639d7ef78f04e182a7804703ff6c5011dc1fdd8f418420eaedf'),('trace','6cc-trace-source-original.zip',5,'3145708e392121ac43bad0c287079598e7930b01750eb8be6f4a6de8ee677475')]):
        archive=(base/name).read_bytes();require(len(archive)<=32<<10 and hashlib.sha256(archive).hexdigest()==pin,'exact new6cc original artifact pin differs');manifest={r['name']:r for r in h['files'] if r['role']==role};seen=set()
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            require(len(z.infolist())==count==len(manifest),'exact new6cc source file count differs')
            for entry in z.infolist():
                path=PurePosixPath(entry.filename);require(str(path)==entry.filename and not path.is_absolute() and '..' not in path.parts and '\\' not in entry.filename and not stat.S_ISLNK(entry.external_attr>>16) and entry.filename not in seen and entry.file_size<=128<<10,'unsafe new6cc source archive entry');seen.add(entry.filename)
                body=z.read(entry);ref=manifest.get(entry.filename);require(ref and len(body)==entry.file_size==ref['bytes'] and hashlib.sha256(body).hexdigest()==ref['sha256'],'original new6cc source file size/SHA differs');files[(role,entry.filename)]=body
        require(seen==set(manifest),'complete new6cc original source inventory required')
    prefix=next(name.removesuffix('SOURCE.json') for role,name in files if role=='lossless' and name.endswith('/SOURCE.json'));source=strict(files[('lossless',prefix+'SOURCE.json')])
    require(source['sourceCommit']==COMPONENT_SOURCE and source['sourceTree']==COMPONENT_TREE and source['optionalForkCommit']==SUPPLIER and source['optionalForkTree']==FORK and source['sourceOnly'] is True and source['nodeProcessesStarted']==0 and source['actualOnRunningWindow'] is False,'actual new6cc source-only receipt differs')
    selection=source['preparedSourceSelection'];body=files[('lossless',prefix+'composition/SOURCE-SELECTION.json')];require(len(body)==selection['receiptBytes'] and hashlib.sha256(body).hexdigest()==selection['receiptSHA256'] and strict(body)==selection['sourceSelection'],'actual new6cc source selection differs')
    expected28=[]
    for group,expected in REQUIRED.items():
        ref=source[group];log=files[('lossless',prefix+Path(ref['path']).name)];result=strict(files[('lossless',prefix+Path(ref['result']['path']).name)])
        require(len(log)==ref['bytes'] and hashlib.sha256(log).hexdigest()==ref['sha256'] and ref['requiredPassed']==expected and result['requiredPassed']==expected and result['returnCode']==0 and result['timedOut'] is False and result['validationPassed'] is True and result['firstFailure'] is None,'actual new6cc named test result differs');require_named_run_pass(log,expected);expected28+=expected
    require(expected28==h['actualLossless28'],'actual new6cc required28 names differ')
    trace=strict(files[('trace','distributed-pq-source-result.json')]);require(trace['commit']==COMPONENT_SOURCE and trace['syntheticOnly'] is True and trace['authorityGranted'] is False and trace['nodeProcessesStarted']==0 and trace['publicActivation'] is False and set(trace['requiredPassed'])==set(h['actualDistributedAndTrace16']) and len(trace['requiredPassed'])==16,'actual new6cc trace source scope differs')
    actual=[]
    for name in ('distributed-pq-core.jsonl','distributed-pq-command.jsonl'):
        log=files[('trace',name)];events=[strict(line) for line in log.splitlines()];names=[n for n in h['actualDistributedAndTrace16'] if any(e.get('Action')=='run' and e.get('Test')==n for e in events)];require_named_run_pass(log,names);actual+=names
    require(len(actual)==len(set(actual))==16 and set(actual)==set(trace['requiredPassed']),'actual unique new6cc distributed/trace16 denominator differs')
    return dict(schema='YNX-PERF-NEW-LOSSLESS-SOURCE-DATA/v1',source=COMPONENT_SOURCE,sourceTree=COMPONENT_TREE,supplierCommit=SUPPLIER,supplierTree=FORK,run=41337784596,jobs=[124941232693,124941232665],artifacts=[13095244933,13095898273],originalFilesVerified=13,actualNamedCases=44,sourceOnlyQualified=True,completeTraceCallerSourceTestsQualified=True,normalONRuntimeQualified=False,runtimeAuthorized=False,pressureAuthorized=False,wholeResourceCIQualified=False,physicalBytesMeasured=False,prior1aGrantTransferred=False)
