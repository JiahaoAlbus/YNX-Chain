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
