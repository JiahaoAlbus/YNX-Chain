"""Read the exact 7c25 public-owner cohort; never execute, fetch, or retry.

The caller supplies the separately frozen normal controller identity. The
archive and current RuntimeTools are independently pinned; no old1695 source
or runtime evidence is inherited by reusing its pure reducers.
"""
import argparse,base64,copy,hashlib,importlib.util,json,re
from pathlib import Path


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

ADAPTER_SHA256='eaa69c355949e1663a86bf381ce8e9e4be2f23d79f813637053e24b093ed3b3f'
if hashlib.sha256(Path(__file__).with_name('pq-first100-7c25-ci.py').read_bytes()).hexdigest()!=ADAPTER_SHA256:
    raise RuntimeError('exact current7c adapter bytes required for readback')
entry=module('current7c_fixed_adapter','pq-first100-7c25-ci.py')
legacy_path=Path(__file__).with_name('pq-first100-1695-public-readback.py')
entry.pinned_bytes(legacy_path,'b4863ef5835faec8e33afa00410d806098bde42459d678b2fbbd66d71be601b8')
legacy=module('current7c_shared_pure_reducers',legacy_path.name)
original=legacy.original
require,strict=legacy.require,legacy.strict
SOURCE,TREE,TOOLS,TOOLS_TREE=entry.GO_SOURCE,entry.GO_TREE,entry.TOOLS,entry.TOOLS_TREE
cohort,conditions,public_transport=legacy.cohort,legacy.conditions,legacy.public_transport


def original_sign_replies(files,prefix,load):
    result=legacy.original_sign_replies(files,prefix,load)
    result.update(schema='YNX-PERF-7C25-ORIGINAL-SIGN-REPLIES/v1',source=SOURCE)
    return result


def identities(adapter,receipt,controller):
    require(type(controller) is str and re.fullmatch(r'[0-9a-f]{40}',controller),
            'separately frozen original controller required')
    require(adapter['controllerCommit']==controller and adapter['controllerSourceSHA256']==ADAPTER_SHA256
            and adapter['profile']=='first100-7c25-public-owner' and adapter['senderBackend']=='public-owner'
            and (adapter['goSource'],adapter['goTree'],adapter['tools'],adapter['toolsTree'])==(SOURCE,TREE,TOOLS,TOOLS_TREE),
            'exact7c public-owner adapter tuple differs')
    ci=adapter['toolsCI'];metadata=ci['metadata']
    require(type(metadata) is list and len(metadata)==2,'two original tools API objects required')
    expected=entry.validate_tools_ci(*(row['original'] for row in metadata))
    require(set(ci)==set(expected)|{'metadata'} and all(ci[k]==v for k,v in expected.items()),
            'actual current RuntimeTools CI receipt differs')
    require(adapter['sourceAndSemanticHandoff']==entry.source_prerequisites(),
            'actual current production and limited semantic prerequisite differs')
    source=module('current7c_source_readback','pq-7c25-source-qualification.py').qualification()
    require(adapter['sourceFunctionalPrerequisite']==receipt['sameWindowInitializationSourceFunctionalData']==source,
            'actual current source/semantic DATA differs')
    getter=module('current7c_getter_readback','pq-7c25-live-source-data.py').qualification()
    require(getter['sourceCI']==dict(run=42452563828,job=128644748345,artifact=13606770461)
            and getter['pressureAuthorized'] is False,'actual current getter source qualification differs')
    require(receipt['source']['commit']==SOURCE and receipt['source']['tree']==TREE
            and (receipt['toolIdentity']['commit'],receipt['toolIdentity']['tree'])==(TOOLS,TOOLS_TREE),
            'exact current receipt source/tools differs')
    require(receipt['loadConditions']['firstTrialProfile']=='7c25'
            and receipt['loadConditions']['senderBackend']=='public-owner',
            'separate current7c public-owner selection missing')
    public_transport(receipt)


def inclusion_replies(files,prefix,load):
    if load is None:return dict(status='NOT_SUPPLIED',records=[],independentFinality=False)
    records=[]
    for row in load['rows']:
        if row['includedNs'] is None:continue
        base=prefix+'load-operations/%05d/'%row['index']
        payload=files[base+'four-node-inclusion.json'];record=strict(payload)
        intent=strict(files[base+'submission-intent.json'])
        require(record['qualifiedFinal'] is False and len(record['rows'])==4,
                'four original inclusion replies required; never finality')
        require(all(intent[k]==value for k,value in dict(id=row['id'],operationId=row['operationId'],
            owner=row['ownerIndex'],nonce=str(row['nonce']),transactionHash=row['hash'],
            submissionAttempts=1,qualifiedFinal=False).items()),'inclusion intent differs from original cohort')
        transaction=files[base+'transaction.abci']
        require(hashlib.sha256(transaction).hexdigest()==row['hash'],'original included transaction bytes differ')
        heights=set()
        for reply in record['rows']:
            require(type(reply['height']) is str and re.fullmatch(r'[1-9][0-9]*',reply['height'])
                and reply['hash'].lower()==row['hash'] and type(reply['tx_result']['code']) is int
                and reply['tx_result']['code']==0 and base64.b64decode(reply['tx'],validate=True)==transaction,
                'original included hash/height/bytes/execution differs')
            heights.add(reply['height'])
        require(len(heights)==1,'original node inclusion heights differ')
        records.append(dict(index=row['index'],transactionHash=row['hash'],height=next(iter(heights)),
            sourceFile=base+'four-node-inclusion.json',sourceSHA256=hashlib.sha256(payload).hexdigest(),
            includedOffsetNs=row['includedNs'],fourOrderedNodeRPCReplies=True,independentFinality=False))
    return dict(status='ORIGINALS_READ',configuredDemand=load['configuredDemand'],observed=len(records),
                records=records,independentFinality=False,missingOrCensored=load['configuredDemand']-len(records))


def successor_availability(files,prefix,receipt):
    available=module('current7c_successor_availability','pq-successor-availability-readback.py')
    load=receipt.get('loadResult')
    if load is None:return available.inspect(files,prefix,receipt)
    rows={row['index']:row for row in load['rows']};selected=dict(files);late=[]
    for path,raw in files.items():
        if not path.startswith(prefix):continue
        match=re.fullmatch(r'load-operations/([0-9]{5})/successor-availability.json',path[len(prefix):])
        if match is None:continue
        index=int(match[1]);require(index in rows,'late availability outside original demand')
        row=rows[index];record=strict(raw);at=record.get('observedMonotonicNs')
        outside=row['includedNs'] is None or (type(at) is int and type(row['terminalNs']) is int
            and at-int(load['originMonotonicNs'])>row['terminalNs'])
        if outside:
            selected.pop(path)
            late.append(dict(index=index,sourceFile=path,sourceSHA256=hashlib.sha256(raw).hexdigest(),
                originalAvailability=record,originalCohortRow=row,
                status='RAW_OUTSIDE_CANONICAL_COHORT_BOUNDARIES',latencyQualified=False,
                independentFinality=False,countsPromoted=False))
    result=available.inspect(selected,prefix,receipt)
    result.update(lateRawRecords=late,lateRawCount=len(late),lateRawPromoted=False)
    return result


def inspect(files, prefix='', *, controller):
    def data(name): return strict(files[prefix+name])
    receipt = data('receipt.json')
    adapter = data('FIRST100-7C25-CI.json')
    identities(adapter,receipt,controller)
    conditions(adapter,receipt)
    require(adapter['controllerCommit'] == controller and adapter['goSource'] == SOURCE
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
    return dict(schema='YNX-PERF-FIRST100-7C25-PUBLIC-ORIGINAL-READBACK/v1', controller=controller, source=SOURCE, tools=TOOLS,
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
                originalNormalLiveBuildSource=receipt.get('normalLiveBuildSource'),
                originalNormalLiveBuildProvenance=receipt.get('normalLiveBuildProvenance'),
                originalNormalLiveNetworkBaseline=receipt.get('networkBaseline'),
                originalNormalLiveNetworkReads=receipt.get('liveNetworkReads'),
                originalOwnedStorageAccounting=receipt.get('ownedStorageAccounting'),
                originalRuntimeHardware=receipt.get('runtimeHardware'),
                originalPublicOwnerParentTimings=parent_transport, originalResources={k:receipt.get(k) for k in ('elapsedSeconds','peakRSSBytes','peakNewBytes','resourceGuardStageElapsed')},
                originalSignReplies=original_sign_replies(files,prefix,load),
                originalHelperLifecycle=receipt.get('normalHelperLifecycle'),
                pressureAuthorized=False, physicalFaultDomains=1, stable1000TPSQualified=False,
                runtimeBinaryBytesIndependentlyRehashed=False)







def business_commit_stages(readback,included,stages):
    """Select block heights, never divide a block span by transaction count."""
    heights={int(row['height']) for row in included['records']}
    projection=copy.deepcopy(readback);coverage={}
    copies=projection.get('originalCommitCopies') or {}
    for record in copies.get('records',[]):
        snapshot=record['originalSnapshot']
        snapshot['samples']=[row for row in snapshot['samples'] if row['height'] in heights]
        retained={row['height'] for row in snapshot['samples']}
        observed=retained if record['producerReportedUsable'] else set()
        coverage[str(record['node'])]=dict(producerReportedUsable=record['producerReportedUsable'],
            retainedRawHeights=sorted(retained),timingUsableHeights=sorted(observed),
            missingOrUnusableIncludedHeights=sorted(heights-observed))
    result=stages.commit_stages(projection)
    result.update(scope='BLOCKS_CONTAINING_HASH_BOUND_CODE0_COHORT_TRANSACTIONS',
        selectedHeights=sorted(heights),coverageByNode=coverage,
        nodesWithoutCommitCopies=sorted(set(range(4))-{int(node) for node in coverage}),
        originalAllBlockSamplesPreservedElsewhere=True,snapshotsProjectedWithoutChangingOriginalFiles=True,
        perTransactionCostInferred=False,emptyOrPreparationBlocksExcluded=True)
    return result


def read_archive(raw,expected_sha256,expected_bytes,*,controller):
    require(type(raw) is bytes and type(expected_bytes) is int and 0<expected_bytes<=128<<20
            and len(raw)==expected_bytes,'selected original current7c archive size differs')
    files,manifest,total=original.public_archive(raw,expected_sha256,entry_limit=8192)
    matches=[name for name in files if name=='receipt.json' or name=='public/receipt.json' or name.endswith('/public/receipt.json')]
    require(len(matches)==1,'one original current7c receipt required; incomplete archive remains unqualified')
    prefix=matches[0].removesuffix('receipt.json')
    result=inspect(files,prefix,controller=controller)
    if result['originalRuntimeHardware'] is not None:
        require(strict(files[prefix+'runtime-hardware.json'])==result['originalRuntimeHardware'],
                'original runtime hardware copies differ')
    result.update(archiveSHA256=expected_sha256,verifiedFiles=len(manifest),verifiedUncompressedBytes=total,
        files=manifest,runJobArtifactBindingStatus='REQUIRES_SEPARATE_ORIGINAL_ROOT_METADATA',
        physicalHardwarePairEqualityQualified=False,canonicalInputPairEqualityQualified=False)
    receipt=strict(files[matches[0]])
    result['originalFourNodeInclusion']=inclusion_replies(files,prefix,receipt.get('loadResult'))
    result['originalSuccessorAvailability']=successor_availability(files,prefix,receipt)
    stages=module('current7c_stage_summaries','pq-first100-stage-summary.py')
    result['measuredStages']=stages.diagnostic(result)
    result['businessBlockCommitStages']=business_commit_stages(result,result['originalFourNodeInclusion'],stages)
    if receipt.get('loadResult') is not None:
        result['measuredBusinessBoundaries']=stages.business(receipt['loadResult'])
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',required=True,type=Path)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--bytes',required=True,type=int)
    parser.add_argument('--controller',required=True)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    value=read_archive(args.archive.read_bytes(),args.sha256,args.bytes,controller=args.controller)
    with args.output.open('x') as output:json.dump(value,output,ensure_ascii=False,sort_keys=True,indent=2);output.write('\n')

if __name__=='__main__':main()
