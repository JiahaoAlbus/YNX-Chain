"""Read fixed first100 original public files; no network, execution or retry.

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
SOURCE = '1b0ea548aca6b5260a9824d0edd3012d52e53521'
TREE = '7c8f6cd8af01b366ea31ffc9f58659e6ca0099e6'
TOOLS = '67870e2be35295fb903e4d6f1723092e2facef7f'
CONTROLLER = 'f76efa2b383dc013c31c5f2f1a5e8adbbd108434'


def cohort(load):
    require(load['configuredDemand'] == 500 and load['requestedOfferedTPS'] == 100
            and load['windowNs'] == 5000000000, 'fixed original first100 denominator required')
    rows = load['rows']
    require(type(rows) is list and len(rows) == 500 and [r['index'] for r in rows] == list(range(500)), 'all original500 rows required')
    require(len({r['id'] for r in rows}) == 500, 'duplicate demand identity')
    for row in rows:
        for field in ('submittedNs', 'ackNs', 'includedNs', 'finalNs'):
            value = row[field]
            require(value is None or type(value) is int and value >= 0, 'original nonnegative observation boundary required')
        for field in ('ackNs', 'includedNs', 'finalNs'):
            if row[field] is not None:
                require(row['submittedNs'] is not None and row[field] >= row['submittedNs'], 'observation before original submission')
        if row['finalNs'] is not None:
            require(row['status'] == 'qualified' and row['includedNs'] is not None and row['finalNs'] >= row['includedNs'], 'qualified boundary requires same original inclusion')
    boundary = 5000000000
    names = [('ackNs', 'checkTxAccepted'), ('includedNs', 'successfulInclusion'), ('finalNs', 'qualifiedReceipt')]
    counts = {}
    for field, name in names:
        values = [r[field] for r in rows if r[field] is not None]
        inside = sum(v < boundary for v in values)
        counts[name] = dict(total=len(values), withinWindow=inside, inTail=len(values)-inside, windowTPS=inside/5)
    reported = load['observedThroughput']
    for name in ('checkTxAccepted', 'successfulInclusion'):
        for suffix, key in [('', 'total'), ('WithinWindow', 'withinWindow'), ('InTail', 'inTail'), ('TPS', 'windowTPS')]:
            require(reported[name+suffix] == counts[name][key], 'original row/throughput summary differs')
    require(load['qualified'] == counts['qualifiedReceipt']['total']
            and reported['qualifiedReceiptTPS'] == counts['qualifiedReceipt']['windowTPS'], 'original qualified cohort differs')
    latencies = {}
    for key, start, end in [('submitToInclusionObserved', 'submittedNs', 'includedNs'),
                             ('submitToQualifiedReceiptObserved', 'submittedNs', 'finalNs'),
                             ('inclusionToQualifiedReceiptObserved', 'includedNs', 'finalNs')]:
        values = sorted(r[end]-r[start] for r in rows if r[start] is not None and r[end] is not None)
        result = dict(denominator=500, observed=len(values), censored=500-len(values))
        result.update({f'p{p}Ms': values[(500*p+99)//100-1]/1e6 if len(values) == 500 else None for p in (50,95,99)})
        require(result == load[key], 'original full-cohort latency summary differs')
        latencies[key] = result
    return dict(counts=counts, latencies=latencies, sustainedTPSQualified=False,
                consensusCommitTimestampMeasured=False, independentCryptographyReverified=False,
                meaning='All500 parent-observed original rows. Five-second window excludes tail. Missing cohort members censor percentiles; proof/confirm completion includes consumer overhead.')


def inspect(files, prefix=''):
    def data(name): return strict(files[prefix+name])
    receipt = data('receipt.json')
    adapter = data('CURRENT703-BASELINE-CI.json')
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
        require(receipt['loadExecuted'] is False, 'missing original business result after release')
        measured = None
    return dict(schema='YNX-PERF-FIRST100-ORIGINAL-READBACK/v1', controller=CONTROLLER, source=SOURCE, tools=TOOLS,
                originalFirstCause=receipt.get('firstCause'), loadExecuted=receipt['loadExecuted'],
                observedBusiness=measured, normalNodeCleanExit=receipt.get('normalNodeCleanExit'), cleanupComplete=receipt.get('cleanupComplete'),
                initializationJournals=original.journals(files,prefix,receipt),
                originalCommitCopies=original.commit_original_copies(files,prefix,receipt),
                originalNodeStartup=original.original_node_startup(files,prefix,receipt),
                originalInitializationStages=receipt.get('initializationStages'), originalCensus=census,
                originalPreload=receipt.get('preloadInitialization'), originalCalleeMeasurements=receipt.get('normalCalleeMeasurements'),
                originalObservationRPCTiming=receipt.get('normalObservationRPCTiming'), originalNetworkAccounting=receipt.get('networkAccounting'),
                originalOwnedStorageAccounting=receipt.get('ownedStorageAccounting'), originalResources={k:receipt.get(k) for k in ('elapsedSeconds','peakRSSBytes','peakNewBytes','resourceGuardStageElapsed')},
                pressureAuthorized=False, physicalFaultDomains=1, stable1000TPSQualified=False,
                runtimeBinaryBytesIndependentlyRehashed=False)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--archive',required=True);p.add_argument('--sha256',required=True)
    p.add_argument('--output',required=True)
    a=p.parse_args(argv)
    files,manifest,total=original.public_archive(Path(a.archive).read_bytes(),a.sha256,entry_limit=8192)
    matches=[name for name in files if name=='receipt.json' or name=='public/receipt.json' or name.endswith('/public/receipt.json')]
    require(len(matches)==1,'one original first100 receipt required; incomplete archive remains unqualified')
    result=inspect(files,matches[0].removesuffix('receipt.json'))
    result.update(archiveSHA256=a.sha256,verifiedFiles=len(manifest),verifiedUncompressedBytes=total,files=manifest)
    with Path(a.output).open('x') as out:json.dump(result,out,indent=2);out.write('\n')
    print(json.dumps(dict(originalFirstCause=result['originalFirstCause'],loadExecuted=result['loadExecuted'],observedBusiness=result['observedBusiness'])))
    return 0


if __name__=='__main__':raise SystemExit(main())
