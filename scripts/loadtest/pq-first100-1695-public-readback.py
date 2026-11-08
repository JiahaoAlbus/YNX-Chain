"""Read fixed1695 public-owner original public files; no network, execution or retry.

Recompute parent-observed finite-cohort counts/latencies from all500 rows.
Normal source proof/confirmation remains authoritative; this is no new crypto
verification and does not equate proof-consumer completion with consensus time.
"""
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('first100_originals', Path(__file__).with_name('pq-initialization-readback.py'))
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
require, strict = original.require, original.strict
SOURCE = '1695aafd351b3cac7860d3452c555a02498e8350'
TREE = '9a172a0a4b07aecc6365bbd05b58726f1214806c'
TOOLS = '8b2a6db0e2b1e8ea25e73486acfa4eae9ba736cc'
CONTROLLER = 'f460d8f506ab9de70e5ca842f6920891c6484119'
TOOLS_TREE = '90760b360421b688c05ebc0778bb3157c1575713'
failure_spec = importlib.util.spec_from_file_location('original_owner_failure', Path(__file__).with_name('pq-public-owner-failure-readback.py'))
failure_module = importlib.util.module_from_spec(failure_spec)
failure_spec.loader.exec_module(failure_module)


def source_qualification():
    spec=importlib.util.spec_from_file_location('cold1695_source',Path(__file__).with_name('pq-1695-source-qualification.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.trial_qualification()


def identities(adapter, receipt):
    require(adapter['controllerCommit']==CONTROLLER and adapter['controllerSourceSHA256']=='717b88d20d76941150dbf6ea8c942bd608f4eade41e9e3dc7792d4478085dfac'
            and adapter['profile']=='first100-1695-public-owner' and adapter['senderBackend']=='public-owner'
            and (adapter['goSource'],adapter['goTree'],adapter['tools'],adapter['toolsTree'])==(SOURCE,TREE,TOOLS,TOOLS_TREE),'exact1695 public-owner adapter tuple differs')
    ci=adapter['toolsCI']
    expected=dict(runID=42388018370,jobID=128449445231,attempt=1,head=TOOLS,workflowID=322083952,conclusion='success',runtimePermissionGranted=False)
    require(set(ci)==set(expected)|{'metadata'} and all(ci[k]==v for k,v in expected.items()),'original fixed1695 tools CI receipt differs')
    metadata=ci['metadata'];require(type(metadata) is list and len(metadata)==2,'two original tools API objects required')
    run,job=[r['original'] for r in metadata]
    require(run['id']==42388018370 and run['workflow_id']==322083952 and run['run_attempt']==1 and job['id']==128449445231 and job['run_id']==42388018370,'original1695 tools API identities differ')
    require(all(r['head_sha']==TOOLS and r['status']=='completed' and r['conclusion']=='success' for r in (run,job)),'original tools API outcomes differ')
    for name in ('Execute original Linux worker affinity limits stdin and cleanup case','Verify fixed1695 semantic original transport and process controls','Verify fixed1695 own source originals with explicit opt-in skips','Verify normal public owner stream isolation and lost acknowledgements','Verify full first100 cohort counts and censored latency readback','Verify original bounded sender and post-ready checkpoint ordering'):
        steps=[s for s in job['steps'] if s['name']==name]
        require(len(steps)==1 and steps[0]['status']=='completed' and steps[0]['conclusion']=='success','original required tools step differs')
    h=adapter['sourceAndSemanticHandoff']
    require(h==dict(semanticReadbackSHA256='1c1b52cef5ae2ea7a7b71b0670d35c5bdae7cc0a909ee2ab14028511f1aeffb3',semanticArtifactID=13579202583,retainedHeights=9,semanticReplayReexecuted=False,actual500InitializationQualified=False,runtimePermissionGranted=False,pressureAuthorized=False),'original1695 limited semantic receipt differs')
    data=source_qualification()
    require(adapter['sourceFunctionalPrerequisite']==receipt['sameWindowInitializationSourceFunctionalData']==data,'actual1695 own source/semantic original DATA differs')
    require(receipt['source']['commit']==SOURCE and receipt['source']['tree']==TREE
            and (receipt['toolIdentity']['commit'],receipt['toolIdentity']['tree'])==(TOOLS,TOOLS_TREE),'exact1695 receipt tuple differs')
    require(receipt['loadConditions']['firstTrialProfile']=='1695' and receipt['loadConditions']['senderBackend']=='public-owner','separate1695 public-owner selection missing')
    public_transport(receipt)


def public_transport(receipt):
    report=receipt.get('normalPublicOwnerTransport')
    if report is None:
        require(receipt.get('loadExecuted') is False,'released public-owner window requires original parent transport report')
        return None
    spec=importlib.util.spec_from_file_location('public1695_parent_timings',Path(__file__).with_name('pq-public-owner-parent-readback.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    # The report is an original receipt SUBOBJECT, not a separately uploaded
    # raw file. Label the serialization digest as a projection digest.
    raw=json.dumps(report,separators=(',',':'),allow_nan=False).encode()
    value=module.readback(raw,hashlib.sha256(raw).hexdigest())
    value['receiptProjectionSHA256']=value.pop('originalSHA256')
    value['receiptProjectionBytes']=value.pop('originalBytes')
    value['inputRepresentation']='RESERIALIZED_ORIGINAL_RECEIPT_SUBOBJECT'
    value['rawParentReportFileSupplied']=False
    return value


def original_sign_replies(files, prefix, load):
    """Keep raw reply/cache evidence separate from parent terminal outcomes.

    The frozen CLI discards Go errors. A null result is not a reason, and a
    retained held-input witness is not admission to the bounded static cache.
    """
    rows = {} if load is None else {row['index']: row for row in load['rows']}
    records, counts = [], {}
    for name in sorted(files):
        if not name.startswith(prefix):
            continue
        match = original.re.fullmatch(r'load-operations/(\d{5})/original-sign-reply\.json', name[len(prefix):])
        if match is None:
            continue
        index = int(match[1]); reply = strict(files[name]); row = rows.get(index)
        require(row is not None and reply['version'] == 'YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1'
                and (reply['ownerIndex'], reply['operationId']) == (row['ownerIndex'], row['operationId']),
                'original sign reply does not bind to full-cohort row')
        code = reply['code']
        require(code in ('ORIGINAL_SAVED', 'REJECTED', 'UNKNOWN'), 'unexpected original sign reply code')
        counts[code] = counts.get(code, 0) + 1
        failure = failure_module.readback(reply, 'sign')
        cache, inputs = reply.get('staticCache'), reply.get('sourceInputs')
        records.append(dict(index=index, ownerIndex=reply['ownerIndex'], operationId=reply['operationId'],
                            code=code, originalPath=name, originalBytes=len(files[name]),
                            originalSHA256=hashlib.sha256(files[name]).hexdigest(),
                            calleeElapsedNs=reply.get('calleeElapsedNs'), resultSupplied=reply.get('result') is not None,
                            errorReasonStatus=failure['status'], failureDiagnostic=failure,
                            staticCache=cache, sourceInputs=inputs))
    return dict(schema='YNX-PERF-1695-ORIGINAL-SIGN-REPLIES/v1', records=records, replyCounts=counts,
                configuredDemand=None if load is None else load['configuredDemand'],
                observed=len(records), missingReplyRows=len(rows)-len(records),
                missingReplyIsRejection=False, goErrorReasonInferred=False,
                cacheBenefitQualified=False, businessQualificationGranted=False,
                meaning='Raw replies bound to original rows; missing replies and CLI-suppressed error reasons remain unknown.')


def conditions(adapter,receipt):
    caps=dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2)
    require(adapter['caps']==receipt['caps']==caps,'fixed original resource caps differ')
    c=receipt['loadConditions']
    require((c['mode'],c['accounts'],c['perAccountCapacity'],c['seconds'],c['tailSeconds'],c['proofTimeout'])==('online',500,1,5,30,30),'fixed full500 load conditions differ')
    require(all(c[k] is True for k in ('staged_publication','wire_observation','network_accounting','commit_observation','owned_storage_accounting','startup_timings','initialize_before_load')) and c['header_hop_capture'] is False,'fixed original observer set differs')


# Same complete500 reduction as the original first100 reader. Identities remain
# separately pinned here; no mutation of the old reader or source qualification.
cohort_spec=importlib.util.spec_from_file_location('d24_first100_cohort',Path(__file__).with_name('pq-first100-readback.py'))
cohort_module=importlib.util.module_from_spec(cohort_spec);cohort_spec.loader.exec_module(cohort_module)
cohort=cohort_module.cohort


def inspect(files, prefix=''):
    def data(name): return strict(files[prefix+name])
    receipt = data('receipt.json')
    adapter = data('FIRST100-1695-CI.json')
    identities(adapter,receipt)
    conditions(adapter,receipt)
    require(adapter['controllerCommit'] == CONTROLLER and adapter['goSource'] == SOURCE
            and adapter['tools'] == TOOLS and adapter['measurementScope'] == 'same-window-normal504-initialization-then-first100x5', 'original fixed controller/source/tools scope differs')
    require(receipt['source']['commit'] == SOURCE and receipt['source']['tree'] == TREE
            and receipt['toolIdentity']['commit'] == TOOLS, 'original receipt source/tools differs')
    request = data('requested-load.json')
    require(request['source'] == receipt['source'] and request['rate'] == 100 and request['seconds'] == 5
            and request['accounts'] == 500 and request['perAccountCapacity'] == 1 and request['configuredDemand'] == 500, 'original first100 demand differs')
    fresh = data('fresh-resource-admission.json')
    require(fresh == receipt['freshResourceAdmission'], 'original resource admission copies differ')
    census = receipt.get('initializedAccountReadback')
    if census is not None:
        require(census == data('initialized-account-readback.json'), 'original census copies differ')
    parent_transport=public_transport(receipt)
    if parent_transport is not None:
        parent_transport['originalReceiptSHA256']=hashlib.sha256(files[prefix+'receipt.json']).hexdigest()
    load = receipt.get('loadResult')
    if load is not None:
        require(receipt['loadExecuted'] is True, 'load result without original released load')
        measured = cohort(load)
        segments = receipt['journalSegments']
        require(type(segments) is list and 0 < len(segments) <= 32, 'original business journal segments required')
        names = set()
        for ref in segments:
            name = ref['path']
            require(original.re.fullmatch(r'load-events-\d{5}\.jsonl', name) and name not in names, 'closed unique original business journal required')
            names.add(name); raw = files[prefix+name]
            require(len(raw) == ref['bytes'] and hashlib.sha256(raw).hexdigest() == ref['sha256'], 'original business journal pin differs')
            for line in raw.splitlines(): strict(line)
    else:
        require(type(receipt['loadExecuted']) is bool, 'original load release observation required')
        measured = None
    return dict(schema='YNX-PERF-FIRST100-1695-PUBLIC-ORIGINAL-READBACK/v1', controller=CONTROLLER, source=SOURCE, tools=TOOLS,
                originalFirstCause=receipt.get('firstCause'), loadExecuted=receipt['loadExecuted'],
                originalLoadSummary={k:v for k,v in load.items() if k!='rows'} if load is not None else None,
                businessObservationStatus=('ORIGINAL_FULL_COHORT_READ' if measured is not None else
                    'RELEASE_OBSERVED_RESULT_NOT_SUPPLIED' if receipt['loadExecuted'] else 'BUSINESS_WINDOW_NOT_RELEASED'),
                observedBusiness=measured, normalNodeCleanExit=receipt.get('normalNodeCleanExit'), cleanupComplete=receipt.get('cleanupComplete'),
                initializationJournals=original.journals(files,prefix,receipt),
                originalCommitCopies=original.commit_original_copies(files,prefix,receipt),
                originalNodeStartup=original.original_node_startup(files,prefix,receipt),
                originalInitializationStages=receipt.get('initializationStages'), originalCensus=census,
                originalPreload=receipt.get('preloadInitialization'), originalCalleeMeasurements=receipt.get('normalCalleeMeasurements'),
                originalFailedCalleeMeasurements=receipt.get('failedCalleeMeasurements'),
                originalPreparationSenderMeasurements=receipt.get('preparationSenderMeasurements'),
                originalPreparationStartupMeasurements=receipt.get('preparationStartupMeasurements'),
                originalReadinessObservations=receipt.get('originalReadinessObservations'),
                originalColdReadinessBudget=receipt.get('coldBootstrapReadinessBudget'),
                originalCompletionDiagnostics=receipt.get('loadCompletionDiagnostics'),
                originalObservationRPCTiming=receipt.get('normalObservationRPCTiming'), originalNetworkAccounting=receipt.get('networkAccounting'),
                originalOwnedStorageAccounting=receipt.get('ownedStorageAccounting'),
                originalRuntimeHardware=receipt.get('runtimeHardware'),
                originalPublicOwnerParentTimings=parent_transport, originalResources={k:receipt.get(k) for k in ('elapsedSeconds','peakRSSBytes','peakNewBytes','resourceGuardStageElapsed')},
                originalSignReplies=original_sign_replies(files,prefix,load),
                originalHelperLifecycle=receipt.get('normalHelperLifecycle'),
                pressureAuthorized=False, physicalFaultDomains=1, stable1000TPSQualified=False,
                runtimeBinaryBytesIndependentlyRehashed=False)







def read_archive(raw, expected_sha256, expected_bytes):
    """Expected pin comes from Core's sole original GET; never find/download it.

    This checks contained source/conditions and raw500 rows. Run/job/artifact
    linkage remains a separate Core original-metadata read until supplied.
    """
    require(type(raw) is bytes and type(expected_bytes) is int and 0<expected_bytes<=128<<20
            and len(raw)==expected_bytes,'selected original public-owner archive size differs')
    files,manifest,total=original.public_archive(raw,expected_sha256,entry_limit=8192)
    matches=[name for name in files if name=='receipt.json' or name=='public/receipt.json' or name.endswith('/public/receipt.json')]
    require(len(matches)==1,'one original public-owner receipt required; incomplete archive remains unqualified')
    prefix=matches[0].removesuffix('receipt.json')
    result=inspect(files,prefix)
    if result['originalRuntimeHardware'] is not None:
        require(strict(files[prefix+'runtime-hardware.json'])==result['originalRuntimeHardware'],'original runtime hardware copies differ')
    result.update(archiveSHA256=expected_sha256,verifiedFiles=len(manifest),verifiedUncompressedBytes=total,
                  files=manifest,runJobArtifactBindingStatus='REQUIRES_SEPARATE_ORIGINAL_CORE_METADATA',
                  physicalHardwarePairEqualityQualified=False,canonicalInputPairEqualityQualified=False)
    return result
