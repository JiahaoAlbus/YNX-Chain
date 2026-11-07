"""Summarize local first100 originals without executing or requesting a window.

D24 READBACK must reproduce the pinned local ZIP through the existing reader.
The old 1b READBACK is a separately labelled diagnostic, never a pooled sample
or an A/B control. Missing timings remain unknown; nested wall spans cannot be
added into a duration, Go CPU estimate, or chain throughput claim.
"""
import argparse
import collections
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


d24 = module('first100_stage_d24_reader', 'pq-first100-d24-readback.py')
original = d24.cohort_module
require, strict = d24.require, d24.strict
COMMIT_STAGES = ('validate', 'json_encode', 'write', 'file_sync', 'directory_sync')


def integer(value, label):
    require(type(value) is int and value >= 0, label + ' must be an original nonnegative integer')
    return value


def samples(values, denominator):
    """Only observed values; None is censored, never an elapsed zero."""
    integer(denominator, 'denominator')
    values = [integer(v, 'elapsedNs') for v in values if v is not None]
    require(len(values) <= denominator, 'sample count exceeds original denominator')
    ordered = sorted(values)
    return dict(denominator=denominator, observed=len(values), missingOrCensored=denominator-len(values),
                minNs=min(values) if values else None, maxNs=max(values) if values else None,
                observedMedianNs=statistics.median(values) if values else None,
                retainedSampleP95Ns=ordered[(len(values)*95+99)//100-1]
                if len(values) >= 20 and len(values) == denominator else None,
                percentileMeaning='Retained complete group only, >=20 observations; not sustained/business finality.')


def initialization(readback):
    original_stages = readback.get('originalInitializationStages')
    if original_stages is None:
        return dict(status='NOT_SUPPLIED', records=[], stages={}, noZeroFill=True)
    rows = original_stages['records']
    require(len({r['index'] for r in rows}) == len(rows), 'duplicate initialization stage index')
    journal = readback['initializationJournals']
    requested = [e for e in journal['events'] if e['kind'] == 'initialization_stage_requested']
    require(len({r['index'] for r in requested}) == len(requested), 'duplicate initialization request')
    requests = {r['index']: r for r in requested}
    grouped = collections.defaultdict(list)
    for row in rows:
        require(row['index'] in requests, 'initialization return without original request')
        require(all(row.get(k) == requests[row['index']].get(k) for k in ('stage', 'identity', 'requestedMonotonicNs')),
                'initialization original request identity differs')
        elapsed = row.get('elapsedNs')
        if elapsed is not None:
            integer(elapsed, 'initialization elapsed')
            require(elapsed == integer(row['returnedMonotonicNs'], 'return') - integer(row['startedMonotonicNs'], 'start'),
                    'initialization elapsed differs from original boundaries')
        grouped[row['stage']].append(elapsed)
    denominators = collections.Counter(r['stage'] for r in requested)
    return dict(status=journal['status'], attempted=original_stages['attempted'],
                retained=len(rows), requested=len(requested), returned=journal['returned'],
                omitted=original_stages['omitted'], errors=copy.deepcopy(journal['errors']),
                unfinished=copy.deepcopy(journal['unfinished']), records=copy.deepcopy(rows),
                stages={name: samples(grouped[name], n) for name, n in sorted(denominators.items())},
                intervalsOverlap=True, stagesAdded=False, noZeroFill=True,
                meaning='All original requested/returned parent stages retained; RETURNED is not business success.')


def commit_stages(readback):
    copies = readback.get('originalCommitCopies') or {}
    nodes, pids = {}, set()
    for record in copies.get('records', []):
        node = record['node']
        require(type(node) is int and 0 <= node < 4 and str(node) not in nodes, 'duplicate or invalid Commit node; no node pooling')
        snapshot = record['originalSnapshot']
        pid = snapshot.get('processID')
        require(type(pid) is int and pid > 0 and pid not in pids, 'Commit process identity reused across nodes')
        pids.add(pid)
        base = dict(node=node, processID=pid, originalFileSHA256=record['sha256'],
                    producerReportedUsable=record['producerReportedUsable'],
                    successNotifications=snapshot.get('successNotifications'),
                    errorNotifications=snapshot.get('errorNotifications'),
                    droppedSuccessSamples=snapshot.get('droppedSuccessSamples'),
                    originalCoverage=copy.deepcopy(snapshot.get('coverage')),
                    lastFailure=copy.deepcopy(snapshot.get('lastFailure')), byStorage={})
        nodes[str(node)] = base
        if not record['producerReportedUsable']:
            base['status'] = 'UNUSABLE_ORIGINAL_NO_TIMING_PROMOTION'
            continue
        retained = snapshot['samples']
        require(len({r['height'] for r in retained}) == len(retained), 'duplicate Commit height within node')
        by_storage = collections.defaultdict(list)
        for row in retained:
            require(row['persistence']['height'] == row['height'], 'Commit persistence height differs')
            by_storage[row['persistence']['storage']].append(row)
        for storage, rows in sorted(by_storage.items()):
            names = set(COMMIT_STAGES)
            for row in rows:
                names.update(row['persistence'].get('stagesNs', {}))
            base['byStorage'][storage] = dict(
                retainedSuccessCount=len(rows), heights=[r['height'] for r in rows],
                denominatorMeaning='Retained successful samples for this node/storage; all Commit attempts remain unknown.',
                persistenceElapsed=samples([r['persistence'].get('elapsedNs') for r in rows], len(rows)),
                stages={name: samples([r['persistence'].get('stagesNs', {}).get(name) for r in rows], len(rows)) for name in sorted(names)})
    return dict(nodes=nodes, pooledAcrossNodes=False, pooledAcrossStorage=False, stagesAdded=False,
                allCommitAttemptsMeasured=False, signerFsyncMeasured=False, independentFinality=False)


def node_startup(readback):
    nodes = {}
    for node in (readback.get('originalNodeStartup') or {}).get('nodes', []):
        name = node['name']
        require(name not in nodes, 'duplicate startup node; no node pooling')
        stages = node['originalStages']
        groups = collections.defaultdict(list)
        for row in stages['records']:
            # A begin event's elapsed0 is never a completed observation.
            value = row.get('elapsedNs') if row.get('endLine') is not None and not row.get('pairingAmbiguous') else None
            groups[row['stage']].append(value)
        nodes[name] = dict(pid=node.get('pid'), processIdentityBound=node.get('processIdentityBound'),
                           status=stages['status'], originalLogSHA256=stages.get('logSHA256'),
                           errors=copy.deepcopy(stages['errors']),
                           records=copy.deepcopy(stages['records']),
                           stages={name: samples(values, len(values)) for name, values in sorted(groups.items())})
    return dict(nodes=nodes, pooledAcrossNodes=False, intervalsOverlap=True,
                alignedAcrossProcessClocks=False, readinessOrFinalityInferred=False)


def aggregate(value, denominator, observed_key, minimum_key, maximum_key):
    """Preserve original aggregate limits; cannot reconstruct quantiles."""
    integer(denominator, 'aggregate denominator')
    observed = integer(value[observed_key], 'aggregate observations')
    require(observed <= denominator, 'aggregate observations exceed denominator')
    minimum, maximum = value.get(minimum_key), value.get(maximum_key)
    if observed:
        integer(minimum, 'observed minimum'); integer(maximum, 'observed maximum')
        require(minimum <= maximum, 'aggregate minimum exceeds maximum')
    else:
        require(minimum is None and maximum is None, 'missing timings cannot be zero-filled')
    return dict(denominator=denominator, observed=observed, missingOrCensored=denominator-observed,
                minNs=minimum, maxNs=maximum, observedMedianNs=None, retainedSampleP95Ns=None,
                quantileStatus='RAW_INDIVIDUAL_SAMPLES_NOT_SUPPLIED', originalAggregate=copy.deepcopy(value))


def callee_stages(readback):
    measurements = readback.get('originalCalleeMeasurements')
    if measurements is None:
        return dict(status='NOT_SUPPLIED', groups={})
    require(measurements['source'] == readback['source'], 'callee source differs; no cross-source pooling')
    groups = {}
    for name, group in measurements['groups'].items():
        denominator = 4 if name == 'live_setup' else 500
        def reduce(value):
            require(value['denominator'] == denominator, 'original callee denominator changed')
            require(value['censoredOrNotReached'] == denominator-value['observed'], 'callee censor count differs')
            if value['observed'] != denominator:
                require(all(v is None for v in value['fullDemandPercentilesMs'].values()), 'incomplete callee cohort has percentiles')
            return aggregate(value, denominator, 'observed', 'observedMinNs', 'observedMaxNs')
        groups[name] = dict(calleeElapsed=reduce(group['calleeElapsed']),
                            stages={k: reduce(v) for k, v in group['stages'].items()},
                            replyTimingCoverage=copy.deepcopy(group.get('replyTimingCoverage')),
                            outcomes=copy.deepcopy(group.get('outcomes')))
    return dict(source=readback['source'], groups=groups, intervalsOverlap=True,
                stagesAdded=False, startupAddedToCommand=False, cacheSnapshotsAdded=False)


def preparation(readback):
    startup = readback.get('originalPreparationStartupMeasurements') or {}
    records = []
    for category, rows in [('registration_and_activation', startup.get('records', [])),
                           ('preparation_sender', readback.get('originalPreparationSenderMeasurements') or [])]:
        for row in rows:
            require(row['source'] == readback['source'], 'preparation source differs; no cross-source pooling')
            groups = {}
            for key in ('timings', 'startupTimings'):
                groups[key] = {name: dict(samples([v.get('elapsedNs')], 1), originalCalls=v['calls'])
                               for name, v in (row.get(key) or {}).get('stages', {}).items()}
            records.append(dict(category=category, name=row['name'], operation=row['operation'],
                                calleeElapsed=samples([row.get('calleeElapsedNs')], 1),
                                startupElapsed=samples([row.get('startupElapsedNs')], 1), groups=groups,
                                originalRecord=copy.deepcopy(row)))
    return dict(records=records, expectedRegistrationReplies=startup.get('expectedRegistrationReplies'),
                expectedActivationReplies=startup.get('expectedActivationReplies'),
                intervalsOverlap=True, stagesAdded=False, businessCohortMember=False)


def resources(readback):
    data = readback.get('originalResources') or {}
    guard = data.get('resourceGuardStageElapsed') or {}
    return dict(elapsedSeconds=data.get('elapsedSeconds'), peakRSSBytes=data.get('peakRSSBytes'),
                peakNewBytes=data.get('peakNewBytes'), status=guard.get('status', 'NOT_SUPPLIED'),
                stages={name: aggregate(v, v['calls'], 'timedCalls', 'minNs', 'maxNs')
                        for name, v in guard.get('stages', {}).items()},
                intervalsOverlap=True, stagesAdded=False, overheadSubtractedFromCallee=False,
                meaning='sampleIncludingLockWait encloses components; per-stage totals only, no additive pipeline time or Go CPU inference.')


def rpc_stages(readback):
    nodes = {}
    for row in (readback.get('originalObservationRPCTiming') or {}).get('groups', []):
        methods = nodes.setdefault(str(row['node']), {})
        require(row['method'] not in methods, 'duplicate RPC node/method')
        methods[row['method']] = aggregate(row, row['attempted'], 'completed', 'minNs', 'maxNs')
    return dict(nodes=nodes, pooledAcrossNodes=False, intervalsOverlap=True, stagesAdded=False,
                meaning='Returned/raised RPC wall spans include guard, parsing and transport; no Go-only time or business success.')


def tcp_scope(readback):
    data = readback.get('originalNetworkAccounting') or {}
    tcp = data.get('tcp') or {}
    hops = data.get('perHopTCPAccounting') or {}
    return dict(status=tcp.get('status', 'NOT_SUPPLIED'), coverage=tcp.get('coverage'),
                ownershipContinuity=tcp.get('ownershipContinuity'), captureScope=data.get('captureScope'),
                originalCaptureStartNs=data.get('startCaptureNs'), originalCaptureEndNs=data.get('endCaptureNs'),
                sourceSocketEndpointBytesSentSum=hops.get('sourceSocketEndpointBytesSentSum'),
                sourceSocketEndpointRetransmittedBytesSum=hops.get('sourceSocketEndpointRetransmittedBytesSum'),
                originalDenominators=copy.deepcopy(hops.get('denominators')),
                exactOfferedWindowCapture=False, totalTrafficComplete=False,
                physicalBytes=None, actualPerTransactionHopBytes=None, backgroundTrafficSeparable=False,
                counterGroupsAdded=False, receiverAddedToSender=False, gainsQualified=False,
                meaning='Matched owned endpoint sender counters only, all P2P channels and drain/background/consensus overhead; no full traffic, wire-byte or per-transaction attribution.')


def business(load):
    # This is the original full500 reducer, not a second cohort implementation.
    measured = original.cohort(load)
    rows = load['rows']
    submitted = sum(r['submittedNs'] is not None for r in rows)
    require(load['submitted'] == submitted and load['notSubmitted'] == 500-submitted,
            'original submission counts differ')
    terminal = dict(collections.Counter(r['status'] for r in rows))
    require(terminal == load['terminalCounts'], 'original terminal counts differ')
    stage_values = collections.defaultdict(list)
    reached = collections.Counter()
    for row in rows:
        points = row['stageTimes']
        require(len({p[0] for p in points}) == len(points), 'repeated stage identity within original row')
        completed = []
        for i, (name, at) in enumerate(points):
            reached[name] += 1
            integer(at, 'stage start')
            end = points[i+1][1] if i+1 < len(points) else row['finalNs']
            if end is not None:
                duration = integer(end, 'stage end')-at
                integer(duration, 'stage duration')
                completed.append(dict(stage=name, durationNs=duration))
                stage_values[name].append(duration)
        require(row['completedStageDurations'] == completed, 'original completed stage boundaries differ; no missing-to-zero backfill')
    supplied = load['completedStageIntervals']
    require(set(supplied) == set(stage_values), 'original completed stage set differs')
    for name, values in stage_values.items():
        row = supplied[name]
        require(row['denominator'] == 500 and row['completed'] == len(values)
                and row['censoredOrNotReached'] == 500-len(values)
                and row['totalNs'] == sum(values) and row['maxNs'] == max(values), 'original stage summary differs')
        if len(values) != 500:
            require(all(v is None for v in row['fullDemandPercentilesMs'].values()), 'incomplete business stages cannot have cohort percentiles')
    durations = {}
    for name, start, end in [('submitToInclusionObserved', 'submittedNs', 'includedNs'),
                             ('submitToQualifiedReceiptObserved', 'submittedNs', 'finalNs'),
                             ('inclusionToQualifiedReceiptObserved', 'includedNs', 'finalNs'),
                             ('submitToCheckTxAckObserved', 'submittedNs', 'ackNs'),
                             ('releaseToAccountClaim', 'releasedNs', 'claimedNs'),
                             ('endToEndLogicalArrivalToQualified', 'logicalArrivalOffsetNs', 'finalNs')]:
        observed = [dict(index=r['index'], id=r['id'], startNs=r[start], endNs=r[end], elapsedNs=r[end]-r[start])
                    for r in rows if r[start] is not None and r[end] is not None]
        cohort_summary = measured['latencies'].get(name, load[name])
        require(cohort_summary['denominator'] == 500 and cohort_summary['observed'] == len(observed)
                and cohort_summary['censored'] == 500-len(observed), 'original boundary denominator/count differs')
        if len(observed) != 500:
            require(all(cohort_summary['p%dMs' % p] is None for p in (50, 95, 99)),
                    'incomplete boundary cohort has percentiles')
        durations[name] = dict(samples([v['elapsedNs'] for v in observed], 500),
                               observations=observed, fullCohort=copy.deepcopy(cohort_summary))
    return dict(configuredDemand=500, submitted=submitted, notSubmitted=500-submitted,
                terminalCounts=terminal, originalCohort=measured, observedLatencySamples=durations,
                stages={name: dict(samples(stage_values[name], 500), reached=reached[name],
                                    unresolvedReached=reached[name]-len(stage_values[name]),
                                    fullDemandPercentilesMs=copy.deepcopy(supplied[name]['fullDemandPercentilesMs']) if name in supplied else dict(p50=None, p95=None, p99=None))
                        for name in sorted(reached)},
                originalFirstCause=load.get('firstCause'), firstOperationalFailure=copy.deepcopy(load.get('firstOperationalFailure')),
                originalLateEvidence=copy.deepcopy(load.get('pipeline', {}).get('lateEvidence')),
                intervalsOverlap=True, stagesAdded=False, missingTimingsFilled=False,
                actualConsensusCommitLatency=None, stableFinalTPS='UNMEASURED')


def diagnostic(readback):
    return dict(source=readback['source'], tools=readback['tools'], controller=readback['controller'],
                archiveSHA256=readback['archiveSHA256'], originalFirstCause=readback.get('originalFirstCause'),
                initialization=initialization(readback), commit=commit_stages(readback),
                nodeStartup=node_startup(readback), callees=callee_stages(readback), preparation=preparation(readback),
                resources=resources(readback), observationRPC=rpc_stages(readback), tcp=tcp_scope(readback),
                originalReadinessObservations=copy.deepcopy(readback.get('originalReadinessObservations')),
                originalFailedCalleeMeasurements=copy.deepcopy(readback.get('originalFailedCalleeMeasurements')),
                originalCompletionDiagnostics=copy.deepcopy(readback.get('originalCompletionDiagnostics')),
                originalObservedBusiness=copy.deepcopy(readback.get('observedBusiness')),
                normalNodeCleanExit=copy.deepcopy(readback.get('normalNodeCleanExit')),
                cleanupComplete=readback.get('cleanupComplete'), sourceQualificationGranted=False)


def summarize(readback, archive, old_readback=None):
    require((readback.get('runID'), readback.get('jobID'), readback.get('artifactID'), readback.get('archiveSHA256')) ==
            (d24.RUN_ID, d24.JOB_ID, d24.ARTIFACT_ID, d24.ARCHIVE_SHA256), 'selected original D24 artifact identity or digest differs')
    require(len(archive) == d24.ARCHIVE_BYTES, 'selected original D24 artifact size differs')
    files, manifest, total = d24.original.public_archive(archive, readback['archiveSHA256'], entry_limit=8192)
    require(manifest == readback['files'] and len(manifest) == readback['verifiedFiles']
            and total == readback['verifiedUncompressedBytes'], 'READBACK ZIP manifest differs')
    receipts = [n for n in files if n == 'receipt.json' or n.endswith('/public/receipt.json')]
    require(len(receipts) == 1, 'one original D24 public receipt required')
    prefix = receipts[0].removesuffix('receipt.json')
    rebuilt = d24.inspect(files, prefix)
    require(all(readback.get(k) == v for k, v in rebuilt.items()), 'READBACK does not reproduce original D24 ZIP; no cross-source pooling')
    result = dict(schema='YNX-PERF-FIRST100-STAGE-SUMMARY/v1', current=diagnostic(readback),
                  oldDiagnostic=None, comparison=dict(mode='SEPARATE_DIAGNOSTICS_ONLY', pooled=False,
                  abGainCalculated=False, meaning='Different Go sources and tools; no matched A/B control or performance gain.'),
                  pressureAuthorized=False, sourceQualificationGranted=False, oldUnknownReplayed=False,
                  physicalFaultDomains=1, stable1000TPSQualified=False)
    receipt = strict(files[receipts[0]])
    require(receipt.get('loadResult') is not None, 'original full500 raw rows not supplied')
    result['current']['business'] = business(receipt['loadResult'])
    result['current']['rawArchiveReverified'] = True
    if old_readback is not None:
        require((old_readback['source'], old_readback['tools'], old_readback['controller']) ==
                (original.SOURCE, original.TOOLS, original.CONTROLLER), 'old diagnostic source/tools/controller tuple differs')
        result['oldDiagnostic'] = diagnostic(old_readback)
        result['oldDiagnostic']['rawArchiveReverified'] = False
        result['oldDiagnostic']['meaning'] = 'Existing original 1b READBACK only; raw old ZIP not supplied or reverified here.'
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--readback', required=True)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--old-readback')
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    require(all('://' not in value for value in (args.readback, args.archive, args.old_readback or '')),
            'local paths only')
    paths = [Path(args.readback), Path(args.archive)]
    if args.old_readback:
        paths.append(Path(args.old_readback))
    require(not paths[1].is_symlink(), 'original D24 archive may not redirect')
    raw = [p.read_bytes() for p in paths]
    result = summarize(strict(raw[0]), raw[1], strict(raw[2]) if len(raw) == 3 else None)
    result['localInputs'] = [dict(path=str(p.resolve()), sha256=hashlib.sha256(b).hexdigest()) for p, b in zip(paths, raw)]
    with Path(args.output).open('x') as out:
        json.dump(result, out, indent=2, allow_nan=False)
        out.write('\n')
    print(json.dumps(dict(output=str(Path(args.output).resolve()), configuredDemand=500,
                         counts=result['current']['business']['originalCohort']['counts'],
                         stagesRetained=result['current']['initialization']['retained'], abGainCalculated=False)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
