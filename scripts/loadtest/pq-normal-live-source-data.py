"""Verify frozen original source-CI data only; not a runtime or pressure grant."""
import hashlib,io,json,stat,zipfile
from pathlib import Path,PurePosixPath

QUALIFICATION = {'commit': '9081f14654a48f4fe14e57696ec33527869da353', 'tree': '8c12ec07479bf6664cf279adb6395c704ead33e1', 'forkTree': '54e88e6aba735eaceeb2d00bb40731248c673bd7', 'optionalForkCommit': '54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076', 'optionalForkTree': 'b1e9a83ab11ed141fda90bc47521faa412176caa', 'buildTag': 'ynx_live_wire_observation', 'compositionScriptSHA256': 'f9c83d7a7d7dc1c2ccbbd15795ba22b1d54e28a81d9084a813a8fb71c4b55839', 'ciEvidenceSHA256': '86e7ad98116af984eeb145c3bcf7b48d7a96da8ad897b3603cdd984527bf7f17', 'sourceCI': {'run': 41323073659, 'job': 124897263752, 'artifact': 13089839088}, 'scope': 'original normal online finite wire/TCP baseline only', 'pressureAuthorized': False}
EXPECTED = {'normalProducer': ('TestOperatorWireLivePrivateControlTwoEndpointsAndNoReplay', 'TestOperatorWireLiveUnknownPreservesOriginalAndRetires', 'TestOperatorWireLiveCloseJoinsOriginalCaptureWithoutNodeQuit', 'TestOperatorWireLivePermissionsIdentityAndResiduals', 'TestOperatorWireLiveRequesterUnknownAndProducerIdentity', 'TestOperatorWireLiveSelfProcParsingAndDefaultOff', 'TestOperatorWireLiveTypedNormalNodeBeforeStartIsUnknown'), 'originalSupplierBudget': ('TestLosslessHexBudgetFullQueueElapsedDeadline', 'TestLosslessHexBudgetFullQueueStopsWithoutRawReplay', 'TestLosslessHexBudgetInvalidEnableStaysDefaultOff', 'TestLosslessHexBudgetLocalExhaustionDoesNotDisconnectAndRedial', 'TestLosslessHexBudgetNormalize', 'TestLosslessHexBudgetPackFailureNeverFallsBack', 'TestLosslessHexBudgetPackReservesBeforeFrameAllocation', 'TestLosslessHexBudgetParallelAttemptsAndClose', 'TestLosslessHexBudgetParallelReservations', 'TestLosslessHexBudgetPeerBytes', 'TestLosslessHexBudgetPeerClock', 'TestLosslessHexBudgetPeerIdentityAndLifetime', 'TestLosslessHexBudgetReceiveBeforeOriginalCheckTx', 'TestLosslessHexBudgetSendAttemptsAndAtomicCharge', 'TestLosslessHexBudgetSendClockRollback', 'TestLosslessHexBudgetSendIdentityAndClock', 'TestLosslessHexBudgetTypedNilPeerCannotClaimCapability', 'TestLosslessHexTransportDefaultOffAndSingleCarrier', 'TestLosslessHexTransportLegacyEmptyUnknownAndMalformedKeepOriginalEntry', 'TestLosslessHexTransportQueuedRetryKeepsSelectedFormat', 'TestLosslessHexTransportRejectsBeforeCheckTxNoRawFallback', 'TestLosslessHexTransportRestoresBeforeOriginalPrecheckCacheAndTxKey')}
ARCHIVE_SHA256 = '5c3db014446402ced74177c7965ec1554fa6aa609b2cca0000fe2667bc2fef08'
FIXTURE = Path(__file__).with_name('fixtures')/'9081-normal-live-source-original.zip'

def require(ok,message):
    if not ok:raise RuntimeError(message)

def strict(raw):
    def pairs(items):
        out={}
        for key,value in items:
            require(key not in out,'duplicate original source field');out[key]=value
        return out
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda value:(_ for _ in ()).throw(RuntimeError('nonfinite original source JSON')))

def qualification(raw=None):
    raw=FIXTURE.read_bytes() if raw is None else raw
    require(type(raw) is bytes and len(raw)==11092 and hashlib.sha256(raw).hexdigest()==ARCHIVE_SHA256,'original source-CI archive pin differs')
    files={}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(archive.infolist())==8,'exact original public source files required')
        for entry in archive.infolist():
            name=PurePosixPath(entry.filename)
            require(not name.is_absolute() and '..' not in name.parts and not entry.is_dir() and not stat.S_ISLNK(entry.external_attr>>16) and entry.file_size<=1<<20 and str(name) not in files,'bounded unique original source file required')
            files[str(name)]=archive.read(entry)  # Original ZIP CRC is checked.
    names=[name for name in files if name.endswith('/SOURCE.json')]
    require(len(names)==1,'one original source record required');name=names[0];prefix=name[:-len('SOURCE.json')]
    record=strict(files[name]);q=QUALIFICATION
    require(hashlib.sha256(files[name]).hexdigest()==q['ciEvidenceSHA256'],'original source record pin differs')
    require(record['sourceCommit']==q['commit'] and record['sourceTree']==q['tree'] and record['productionForkTree']==q['forkTree'] and record['optionalForkCommit']==q['optionalForkCommit'] and record['optionalForkTree']==q['optionalForkTree'] and record['buildTags']==[q['buildTag']],'original source graph differs')
    require(record['sourceOnly'] is True and record['actualKernelAndPrivateControlTests'] is True and record['actualPreStartNodeGetter'] is True and record['nodeProcessesStarted']==0 and all(record[k] is False for k in ('actualRunningWindow','carrierEnabled','productionForkModified','publicActivation','physicalBytesMeasured')),'source tests cannot become runtime or pressure evidence')
    def pinned(name,ref):
        payload=files[prefix+name]
        require(len(payload)==ref['bytes'] and hashlib.sha256(payload).hexdigest()==ref['sha256'] and PurePosixPath(ref['path']).name==PurePosixPath(name).name,'original source file pin differs')
        return payload
    for key,stem in (('normalProducer','normal-live-caller'),('originalSupplierBudget','original-peer-budget')):
        original=record[key];events=pinned(stem+'.jsonl',original);pinned(stem+'.stderr.log',original['stderr'])
        result=strict(pinned(stem+'.result.json',original['result']))
        require(result['version']=='YNX-WIRE-LIVE-GO-RESULT/v1' and result['returnCode']==0 and result['timedOut'] is False and result['validationPassed'] is True and result['firstFailure'] is None,'original source test command did not pass')
        require(original['requiredPassed']==result['requiredPassed']==list(EXPECTED[key]),'original named case set differs')
        require(result['stdout']=={k:original[k] for k in ('path','bytes','sha256')} and result['stderr']==original['stderr'],'original result log binding differs')
        rows=[strict(line) for line in events.splitlines()]
        require(not any(row.get('Action')=='fail' for row in rows),'failed original Go event')
        for case in EXPECTED[key]:
            require([row['Action'] for row in rows if row.get('Test')==case and row.get('Action') in ('pass','fail','skip')]==['pass'],'required original named test missing/skipped/failed')
    selection=record['preparedSourceSelection'];payload=files[prefix+'composition/SOURCE-SELECTION.json']
    require(len(payload)==selection['receiptBytes'] and hashlib.sha256(payload).hexdigest()==selection['receiptSHA256'] and strict(payload)==selection['sourceSelection'],'original Core preparation receipt differs')
    return dict(q)
