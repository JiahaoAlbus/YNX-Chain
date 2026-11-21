"""Read fixed d24 first100 original public files; no network, execution or retry.

Recompute parent-observed finite-cohort counts/latencies from all500 rows.
Normal source proof/confirmation remains authoritative; this is no new crypto
verification and does not equate proof-consumer completion with consensus time.
"""
import hashlib
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('first100_originals', Path(__file__).with_name('pq-initialization-readback.py'))
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
require, strict = original.require, original.strict
SOURCE = 'd24ad7e422583906d9823789b049ef2251a09e2c'
TREE = 'a28f61f83be9a6e11d0121ea0f40f9bdd3de3b59'
TOOLS = '08a14143434c2c01e2a59ece0f04ad71f9d6c60c'
CONTROLLER = '8aeb97cdb3c45db197ccc250aeb548469956a6fc'
TOOLS_TREE = '30801ae9fb72b92751ae8684f6d8b3f6556d72af'
RUN_ID = 42367835455
JOB_ID = 128389591616
ARTIFACT_ID = 13572128418
ARCHIVE_BYTES = 6503529
ARCHIVE_SHA256 = 'ec864226f549570476a1efa295fd4a25c306529fbaee0865eddbd5cc343d19fa'


def identities(adapter, receipt):
    require(adapter['controllerCommit']==CONTROLLER and adapter['controllerSourceSHA256']=='c1c423d2b1aa18ce1421f3aa983cf6bb2a64ca0d6a1288bc56fafcc738887752'
            and adapter['profile']=='first100-d24-initialize-before-load'
            and (adapter['goSource'],adapter['goTree'],adapter['tools'],adapter['toolsTree'])==(SOURCE,TREE,TOOLS,TOOLS_TREE),'exact d24 adapter tuple differs')
    ci=adapter['toolsCI']
    expected=dict(runID=42365120777,jobID=128382053748,attempt=1,head=TOOLS,workflowID=322083952,conclusion='success',runtimePermissionGranted=False)
    require(set(ci)==set(expected)|{'metadata'} and all(ci[k]==v for k,v in expected.items()),'original fixed tools CI receipt differs')
    metadata=ci['metadata']
    require(type(metadata) is list and len(metadata)==2,'two original tools API objects required')
    run,job=[r['original'] for r in metadata]
    require(run['id']==42365120777 and run['workflow_id']==322083952 and run['run_attempt']==1 and job['id']==128382053748 and job['run_id']==42365120777,'original tools API identities differ')
    require(all(r['head_sha']==TOOLS and r['status']=='completed' and r['conclusion']=='success' for r in (run,job)),'original tools API outcomes differ')
    for name in ('Execute original Linux worker affinity limits stdin and cleanup case','Verify fixed d24 original semantic and source readback controls','Verify full first100 cohort counts and censored latency readback','Verify original bounded sender and post-ready checkpoint ordering'):
        steps=[s for s in job['steps'] if s['name']==name]
        require(len(steps)==1 and steps[0]['status']=='completed' and steps[0]['conclusion']=='success','original required tools step differs')
    h=adapter['sourceAndSemanticHandoff']
    require(h['sourceHandoffSHA256']=='662a608c5706bc144c429e7a360ce61f29bdb3c4a933fc596c1ada7fdabfea1d'
            and h['semanticReadbackSHA256']=='d849f0cf11f0a7c763ef8a7f861e9ec3026c8801929c3658267ee4c615db241c'
            and h['semanticArtifactID']==13570369292 and h['semanticArtifactSHA256']=='58cd27e15fc6e36c83ce19405b38acbaa965e15a3433e0277873ce8d976ab2c5'
            and h['retainedHeights']==9 and h['sourceOnlyQualified'] is True
            and all(h[k] is False for k in ('semanticReplayReexecuted','actual500InitializationQualified','runtimePermissionGranted','pressureAuthorized')),'original source/semantic prerequisite differs')
    require(receipt['source']['commit']==SOURCE and receipt['source']['tree']==TREE
            and (receipt['toolIdentity']['commit'],receipt['toolIdentity']['tree'])==(TOOLS,TOOLS_TREE),'exact d24 receipt tuple differs')
    require(receipt['loadConditions']['firstTrialProfile']=='d24','separate d24 source selection missing')


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
    adapter = data('FIRST100-D24-CI.json')
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
    return dict(schema='YNX-PERF-FIRST100-D24-ORIGINAL-READBACK/v1', controller=CONTROLLER, source=SOURCE, tools=TOOLS,
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
                originalOwnedStorageAccounting=receipt.get('ownedStorageAccounting'), originalResources={k:receipt.get(k) for k in ('elapsedSeconds','peakRSSBytes','peakNewBytes','resourceGuardStageElapsed')},
                pressureAuthorized=False, physicalFaultDomains=1, stable1000TPSQualified=False,
                runtimeBinaryBytesIndependentlyRehashed=False)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--archive',required=True);p.add_argument('--sha256',required=True)
    p.add_argument('--output',required=True)
    a=p.parse_args(argv)
    require(a.sha256==ARCHIVE_SHA256,'selected original d24 artifact digest differs')
    path=Path(a.archive)
    require(not path.is_symlink(),'original d24 archive may not redirect')
    with path.open('rb') as stream:raw=stream.read(ARCHIVE_BYTES+1)
    require(len(raw)==ARCHIVE_BYTES,'selected original d24 artifact size differs')
    files,manifest,total=original.public_archive(raw,a.sha256,entry_limit=8192)
    matches=[name for name in files if name=='receipt.json' or name=='public/receipt.json' or name.endswith('/public/receipt.json')]
    require(len(matches)==1,'one original first100 receipt required; incomplete archive remains unqualified')
    result=inspect(files,matches[0].removesuffix('receipt.json'))
    result.update(runID=RUN_ID,jobID=JOB_ID,artifactID=ARTIFACT_ID,archiveSHA256=a.sha256,verifiedFiles=len(manifest),verifiedUncompressedBytes=total,files=manifest)
    with Path(a.output).open('x') as out:json.dump(result,out,indent=2);out.write('\n')
    print(json.dumps(dict(originalFirstCause=result['originalFirstCause'],loadExecuted=result['loadExecuted'],observedBusiness=result['observedBusiness'])))
    return 0


if __name__=='__main__':raise SystemExit(main())
