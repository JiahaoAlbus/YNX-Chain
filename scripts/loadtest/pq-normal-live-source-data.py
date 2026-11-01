"""Verify frozen original source-CI data only; not a runtime or pressure grant."""
import hashlib,io,json,stat,zipfile
from pathlib import Path,PurePosixPath

QUALIFICATION = {'commit': 'd9038b9292f9c28d38decb9717282e50febffdb1', 'tree': '66d6f8f2ddce1a08202d5b32e0e216debfabbdeb', 'forkTree': '54e88e6aba735eaceeb2d00bb40731248c673bd7', 'optionalForkCommit': '54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076', 'optionalForkTree': 'b1e9a83ab11ed141fda90bc47521faa412176caa', 'buildTag': 'ynx_live_wire_observation', 'compositionScriptSHA256': 'f9c83d7a7d7dc1c2ccbbd15795ba22b1d54e28a81d9084a813a8fb71c4b55839', 'ciEvidenceSHA256': '3feeb37aa87da683ec30d80f14a6239a9721e346bc0c42bbfdfc89e8a7119dc4', 'sourceCI': {'run': 41317363794, 'job': 124880188598, 'artifact': 13088047288}, 'scope': 'original normal online finite wire/TCP baseline only', 'pressureAuthorized': False}
EXPECTED = {'normalProducer': ('TestOperatorWireLivePrivateControlTwoEndpointsAndNoReplay', 'TestOperatorWireLiveUnknownPreservesOriginalAndRetires', 'TestOperatorWireLiveCloseJoinsOriginalCaptureWithoutNodeQuit', 'TestOperatorWireLivePermissionsIdentityAndResiduals', 'TestOperatorWireLiveRequesterUnknownAndProducerIdentity', 'TestOperatorWireLiveSelfProcParsingAndDefaultOff', 'TestOperatorWireLiveTypedNormalNodeBeforeStartIsUnknown'), 'originalSupplierBudget': ('TestLosslessHexBudgetFullQueueElapsedDeadline', 'TestLosslessHexBudgetFullQueueStopsWithoutRawReplay', 'TestLosslessHexBudgetInvalidEnableStaysDefaultOff', 'TestLosslessHexBudgetLocalExhaustionDoesNotDisconnectAndRedial', 'TestLosslessHexBudgetNormalize', 'TestLosslessHexBudgetPackFailureNeverFallsBack', 'TestLosslessHexBudgetPackReservesBeforeFrameAllocation', 'TestLosslessHexBudgetParallelAttemptsAndClose', 'TestLosslessHexBudgetParallelReservations', 'TestLosslessHexBudgetPeerBytes', 'TestLosslessHexBudgetPeerClock', 'TestLosslessHexBudgetPeerIdentityAndLifetime', 'TestLosslessHexBudgetReceiveBeforeOriginalCheckTx', 'TestLosslessHexBudgetSendAttemptsAndAtomicCharge', 'TestLosslessHexBudgetSendClockRollback', 'TestLosslessHexBudgetSendIdentityAndClock', 'TestLosslessHexBudgetTypedNilPeerCannotClaimCapability', 'TestLosslessHexTransportDefaultOffAndSingleCarrier', 'TestLosslessHexTransportLegacyEmptyUnknownAndMalformedKeepOriginalEntry', 'TestLosslessHexTransportQueuedRetryKeepsSelectedFormat', 'TestLosslessHexTransportRejectsBeforeCheckTxNoRawFallback', 'TestLosslessHexTransportRestoresBeforeOriginalPrecheckCacheAndTxKey')}
ARCHIVE_SHA256 = 'e0a2d27680b55968675d735b5fb1a02ca3b3bc6bd1e2d8c711e897ebcc52ddef'
FIXTURE = Path(__file__).with_name('fixtures')/'d903-normal-live-source-original.zip'

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
    require(type(raw) is bytes and len(raw)==11081 and hashlib.sha256(raw).hexdigest()==ARCHIVE_SHA256,'original source-CI archive pin differs')
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
