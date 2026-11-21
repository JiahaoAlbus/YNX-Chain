"""Summarize local first100 originals without executing or requesting a window.

D24 READBACK must reproduce the pinned local ZIP through the existing reader.
The old 1b READBACK is a separately labelled diagnostic, never a pooled sample
or an A/B control. Missing timings remain unknown; nested wall spans cannot be
added into a duration, Go CPU estimate, or chain throughput claim.
The optional verifier receipt mode binds local bytes to an existing held
readback and reports resource coverage; it grants no fresh archive authority.
"""
import argparse
import collections
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import statistics


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


d24 = module('first100_stage_d24_reader', 'pq-first100-d24-readback.py')
original = d24.cohort_module
require, strict = d24.require, d24.strict
commit_detail = module('original_commit_validation_detail', 'pq-commit-observation.py')
COMMIT_STAGES = ('validate', 'json_encode', 'write', 'file_sync', 'directory_sync')
VERIFIER_NAME = re.compile(r'load-(\d{5})-normal-verifier')
RECEIPT_LIMIT = 8 * 1024 * 1024
PROCESS_RECORD_LIMIT = 8192


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
            details=[commit_detail.validate_validation_detail(row) if 'validation' in row else None for row in rows]
            if any(detail is not None for detail in details):
                base['byStorage'][storage]['validationDetail']=dict(
                    denominator=len(rows),observed=sum(detail is not None for detail in details),
                    elapsed=samples([detail['elapsedNs'] if detail is not None else None for detail in details],len(rows)),
                    phases={name:samples([detail['phaseNs'][name] if detail is not None else None for detail in details],len(rows))
                            for name in commit_detail.VALIDATION_PHASES},
                    hashChildren={name:samples([detail[name] if detail is not None else None for detail in details],len(rows))
                                  for name in ('hashDocumentNs','hashEncodeDigestNs')},
                    childrenOverlapParent=True,stagesAdded=False,independentFinality=False)
    return dict(nodes=nodes, pooledAcrossNodes=False, pooledAcrossStorage=False, stagesAdded=False,
                allCommitAttemptsMeasured=False, signerFsyncMeasured=False, independentFinality=False)


def node_startup(readback):
    nodes = {}
    for node in (readback.get('originalNodeStartup') or {}).get('nodes', []):
        name = node['name']
        require(name not in nodes, 'duplicate startup node; no node pooling')
        stages = node.get('originalStages')
        if stages is None:
            nodes[name] = dict(pid=node.get('pid'),processIdentityBound=node.get('processIdentityBound'),
                status=node.get('status','NOT_SUPPLIED'),parentElapsedNs=node.get('elapsedNs'),
                originalMissingObservation=copy.deepcopy(node),originalLogSHA256=None,
                errors=[],records=[],stages={})
            continue
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


def helper_stages(readback):
    lifecycle = readback.get('originalHelperLifecycle')
    if lifecycle is None:
        return dict(status='NOT_SUPPLIED', records=[], stages={}, calleeElapsedInferred=False)
    report = lifecycle['parentTiming']
    require(report['schema'] == 'YNX-PERF-PARENT-HELPER-BOUNDARIES/v1'
            and report['clock'] == 'parent_monotonic_ns', 'original helper parent clock/schema differs')
    attempted, completed, inflight, retained, omitted, limit = [integer(report[k], k) for k in
        ('attempted', 'completed', 'inFlight', 'retained', 'omittedCompleted', 'recordLimit')]
    rows = report['records']
    require(completed + inflight == attempted and retained + omitted == completed
            and limit == 2048 and retained == len(rows) <= limit,
            'original helper parent coverage differs')
    require(len({row['name'] for row in rows}) == len(rows), 'duplicate original helper identity')
    boundaries = ('requestedMonotonicNs', 'slotAcquiredMonotonicNs', 'launchRequestedMonotonicNs',
                  'launchReturnedMonotonicNs', 'waitReturnedMonotonicNs',
                  'cleanupFinishedMonotonicNs', 'returnedMonotonicNs')
    spans = dict(requestToReturn=(boundaries[0], boundaries[-1]),
                 helperSlotWait=(boundaries[0], boundaries[1]),
                 slotToLaunch=(boundaries[1], boundaries[2]),
                 parentLaunch=(boundaries[2], boundaries[3]),
                 parentWait=(boundaries[3], boundaries[4]),
                 parentCleanup=(boundaries[4], boundaries[5]),
                 launchToCleanup=(boundaries[3], boundaries[5]))
    values = collections.defaultdict(list)
    records = []
    for row in rows:
        require('requestedMonotonicNs' in row and 'returnedMonotonicNs' in row,
                'completed original helper lacks request/return')
        times = [integer(row[key], key) for key in boundaries if key in row]
        require(times == sorted(times), 'original helper parent boundaries reversed')
        durations = {name: row[end]-row[start] if start in row and end in row else None
                     for name, (start, end) in spans.items()}
        for name, elapsed in durations.items():
            values[name].append(elapsed)
        records.append(dict(originalRecord=copy.deepcopy(row), stagesNs=durations,
                            childWaitReturnObserved='waitReturnedMonotonicNs' in row,
                            businessSuccessInferred=False))
    return dict(status='OBSERVED_PARENT_BOUNDARIES', attempted=attempted, completed=completed,
                inFlight=inflight, omittedCompleted=omitted, records=records,
                maxConcurrent=lifecycle['maxConcurrent'], cleanupDebt=copy.deepcopy(lifecycle['cleanupDebt']),
                stages={name: samples(values[name], attempted) for name in spans},
                calleeElapsedInferred=False, stagesAdded=False, intervalsOverlap=True,
                meaning='Parent wait/launch include guard overhead. Cleanup after an interrupted helper is not a successful child return or Go elapsed time; missing boundaries stay unknown.')


def verifier_resources(receipt):
    """Join retained parent boundaries to the original single RSS peak snapshot.

    Numeric PID alone cannot identify a process. The total-RSS time series has
    no per-process samples, so neither it nor this one snapshot establishes an
    individual verifier peak, CPU cost, or a completed verification.
    """
    require(type(receipt.get('configuredDemand')) is int and receipt['configuredDemand'] == 500,
            'verifier configured demand must remain 500')
    cohort = business(receipt['loadResult'])
    helpers = helper_stages(dict(originalHelperLifecycle=receipt.get('normalHelperLifecycle')))
    processes = receipt.get('processes', [])
    require(type(processes) is list and len(processes) <= PROCESS_RECORD_LIMIT,
            'original process history exceeds bounded records')

    def identity(row):
        pid, ticks = row.get('pid'), row.get('startTicks')
        if pid is not None:
            require(integer(pid, 'pid') > 0, 'pid must be positive')
        if ticks is not None:
            integer(ticks, 'startTicks')
        return (pid, ticks) if pid is not None and ticks is not None else None

    def verifier_index(name):
        require(type(name) is str, 'process name must be a string')
        match = VERIFIER_NAME.fullmatch(name)
        if match is None:
            return None
        index = int(match[1])
        require(index < 500, 'verifier index exceeds full500 cohort')
        return index

    registered, identities = {}, {}
    for row in processes:
        key = identity(row)
        name = row['name']
        index = verifier_index(name)
        if key is not None:
            require(key not in identities, 'duplicate original process identity')
            identities[key] = name
        if index is not None:
            require(name not in registered, 'duplicate verifier process name')
            registered[name] = row

    peak = receipt.get('peakRSSSample')
    peak_rows, peak_time, peak_total = [], None, None
    if peak is not None:
        require(type(peak) is dict, 'original peak snapshot must be an object')
        peak_rows = peak.get('processes', [])
        require(type(peak_rows) is list and len(peak_rows) <= PROCESS_RECORD_LIMIT,
                'original peak exceeds bounded records')
        peak_time = peak.get('sampleMonotonicSeconds')
        if peak_time is not None:
            require(type(peak_time) in (float, int) and math.isfinite(peak_time) and peak_time >= 0,
                    'invalid original peak clock')
        peak_total = peak.get('rssBytes')
        if peak_total is not None:
            integer(peak_total, 'peak rssBytes')
            require(peak_total == receipt.get('peakRSSBytes'), 'original peak total differs')
    peak_by_id, grouped = {}, collections.defaultdict(list)
    for row in peak_rows:
        key, name = identity(row), row['name']
        verifier_index(name)
        if key is not None:
            require(key not in peak_by_id, 'duplicate identity in original peak snapshot')
            require(key not in identities or name in (identities[key], 'owned-descendant'),
                    'original peak process name conflicts with registered identity')
            peak_by_id[key] = row
        rss = row.get('rssBytes')
        if rss is not None:
            integer(rss, 'process rssBytes')
        bound_name = identities.get(key)
        group = ('unboundIdentity' if bound_name is None else
                 'verifier' if VERIFIER_NAME.fullmatch(bound_name) else
                 'node' if re.fullmatch(r'pq-node-[0-3]', bound_name) else
                 'liveSession' if re.fullmatch(r'load-live-session-\d+', bound_name) else
                 'supervisor' if bound_name == 'supervisor' else
                 'publicOwners' if bound_name == 'load-public-owners' else 'other')
        grouped[group].append(rss)
    observed_rss = [r['rssBytes'] for r in peak_rows if r.get('rssBytes') is not None]
    require(not peak_rows or len(observed_rss) != len(peak_rows) or peak_total is None
            or sum(observed_rss) == peak_total, 'original peak process sum differs')

    timings = {r['originalRecord']['name']: r for r in helpers['records']
               if verifier_index(r['originalRecord']['name']) is not None}
    records = []
    for name in sorted(set(timings) | set(registered)):
        timing, proc = timings.get(name), registered.get(name)
        raw = timing['originalRecord'] if timing else {}
        key = identity(proc) if proc else None
        peak_row = peak_by_id.get(key) if key is not None else None
        rss = peak_row.get('rssBytes') if peak_row else None
        launch = raw.get('launchReturnedMonotonicNs')
        slot = raw.get('slotAcquiredMonotonicNs')
        registered_status = ('UNKNOWN_NOT_IN_RETAINED_PROCESS_HISTORY' if proc is None else
                             'REGISTERED_PROCESS_LAUNCH_RETURN_NOT_OBSERVED' if launch is None else
                             'REGISTERED_PROCESS_WITH_LAUNCH_RETURN')
        if proc is not None:
            if proc.get('observedLaunchToExitNs') is not None:
                integer(proc['observedLaunchToExitNs'], 'observed launch to exit')
            require(proc.get('rawReturnCode') is None or type(proc['rawReturnCode']) is int,
                    'original child return code must be an integer or unknown')
        records.append(dict(index=verifier_index(name), name=name,
            pid=proc.get('pid') if proc else None, startTicks=proc.get('startTicks') if proc else None,
            identityStatus='OBSERVED_PID_AND_START_TICKS' if key else 'UNKNOWN',
            registrationStatus=registered_status, parent=copy.deepcopy(timing),
            slotWaitStatus='OBSERVED_ACQUISITION' if slot is not None else 'UNKNOWN_ACQUISITION_NOT_OBSERVED',
            censoredNoSlotRequestToReturnNs=(raw['returnedMonotonicNs']-raw['requestedMonotonicNs']
                                           if raw and slot is None else None),
            rawReturnCode=proc.get('rawReturnCode') if proc else None,
            observedLaunchToExitNs=proc.get('observedLaunchToExitNs') if proc else None,
            rssAtGlobalPeakBytes=rss,
            rssAtGlobalPeakStatus='OBSERVED_EXACT_IDENTITY' if rss is not None else 'UNKNOWN',
            globalPeakOffsetFromLaunchReturnSeconds=peak_time-launch/1e9
                if peak_row is not None and peak_time is not None and launch is not None else None,
            individualPeakRSSBytes=None, individualPeakStatus='UNKNOWN_NO_PER_PROCESS_TIME_SERIES',
            childSuccessInferred=False))
    return dict(schema='YNX-PERF-VERIFIER-RESOURCE-COVERAGE/v1', configuredDemand=500,
        source=copy.deepcopy(receipt.get('source')), tools=copy.deepcopy(receipt.get('toolIdentity')),
        originalFirstCause=receipt.get('firstCause'), originalResourceFirstFailure=copy.deepcopy(receipt.get('resourceFirstFailure')),
        originalCaps=copy.deepcopy(receipt.get('caps')), originalProcessCapacity=copy.deepcopy(receipt.get('processCapacity')),
        originalCleanupComplete=receipt.get('cleanupComplete'), originalHelperCoverage=helpers,
        business=cohort, records=records,
        coverage=dict(retainedVerifierRequests=len(timings), registeredVerifierProcesses=len(registered),
                      notRepresentedByRetainedVerifierRecords=500-len(records),
                      rssAtGlobalPeakObserved=sum(r['rssAtGlobalPeakBytes'] is not None for r in records),
                      rssAtGlobalPeakMissingOrUnbound=500-sum(r['rssAtGlobalPeakBytes'] is not None for r in records),
                      individualPeakObserved=0, individualPeakUnknown=500),
        globalPeak=dict(sampleMonotonicSeconds=peak_time, rssBytes=peak_total,
            processSamples=len(peak_rows), missingRSS=len(peak_rows)-len(observed_rss),
            groups={name: dict(processSamples=len(values), observed=sum(v is not None for v in values),
                               missing=sum(v is None for v in values),
                               observedRSSSumBytes=sum(v for v in values if v is not None)
                                   if any(v is not None for v in values) else None)
                    for name, values in sorted(grouped.items())},
            originalSnapshot=copy.deepcopy(peak), allGroupsFromSameSnapshot=True),
        clockMeaning='Peak timestamp retains original floating-point parent seconds; offsets are approximate, not reconstructed exact nanoseconds.',
        memoryOwnershipAttribution='UNKNOWN_RSS_IS_NOT_HEAP_OWNERSHIP',
        additionalSamplingPerformed=False, individualPeaksAdded=False, pooledAcrossSources=False,
        calleeElapsedInferred=False, sourceQualificationGranted=False,
        meaning='One original global RSS peak only. Parent boundaries include guard time; no-slot return is censored, not acquisition. PID without startTicks never joins. Missing evidence remains UNKNOWN; full demand stays 500.')


def read_local_bounded(path):
    """Open each local component without following links; bound the same file fd."""
    require('://' not in os.fspath(path), 'local paths only')
    path = Path(path).absolute()
    require('..' not in path.parts and len(path.parts) <= 128, 'local input path depth or traversal differs')
    handles, directories = [], []
    try:
        parent = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        handles.append(parent)
        for name in path.parts[1:-1]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            handles.append(child)
            value = os.fstat(child)
            directories.append((parent, name, child, (value.st_dev, value.st_ino, value.st_mode)))
            parent = child
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        handles.append(fd)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and before.st_size <= RECEIPT_LIMIT, 'local input is not a bounded single-link regular file')
        def signature(s):
            return (s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        def check_directories():
            for directory, name, child, expected in directories:
                actual = os.stat(name, dir_fd=directory, follow_symlinks=False)
                held = os.fstat(child)
                require((actual.st_dev, actual.st_ino, actual.st_mode) == expected ==
                        (held.st_dev, held.st_ino, held.st_mode), 'local input parent directory replaced')
        check_directories()
        require(signature(before) == signature(os.stat(path.name, dir_fd=parent, follow_symlinks=False)),
                'local input replaced before read')
        chunks, remaining = [], before.st_size + 1
        while remaining:
            chunk = os.read(fd, min(remaining, 1024 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b''.join(chunks)
        require(len(raw) == before.st_size and signature(before) == signature(os.fstat(fd))
                == signature(os.stat(path.name, dir_fd=parent, follow_symlinks=False)), 'local input changed during read')
        check_directories()
        return raw
    finally:
        for fd in reversed(handles):
            os.close(fd)


def verifier_summary(receipt_raw, readback):
    """Bind a local original receipt to its existing reader manifest, not new CI authority."""
    require(type(receipt_raw) is bytes and len(receipt_raw) <= RECEIPT_LIMIT, 'receipt exceeds local byte bound')
    files = readback.get('files')
    require(type(files) is dict and len(files) <= PROCESS_RECORD_LIMIT, 'bounded original file manifest required')
    refs = [(name, row) for name, row in files.items()
            if name == 'receipt.json' or name.endswith('/public/receipt.json')]
    digest = hashlib.sha256(receipt_raw).hexdigest()
    require(len(refs) == 1 and type(refs[0][1].get('bytes')) is int
            and refs[0][1]['bytes'] == len(receipt_raw) and refs[0][1].get('sha256') == digest,
            'receipt bytes or digest differ from original readback')
    receipt = strict(receipt_raw)
    for key in ('source', 'toolIdentity'):
        value = receipt.get(key)
        require(type(value) is dict and all(type(value.get(k)) is str
                and re.fullmatch(r'[0-9a-f]{40}', value[k]) for k in ('commit', 'tree')),
                'original source/tools commit and tree identity required')
    require(receipt.get('source') == readback.get('source') and receipt.get('toolIdentity') == readback.get('tools')
            and receipt.get('configuredDemand') == readback.get('configuredDemand') == 500
            and receipt.get('caps') == readback.get('caps')
            and receipt.get('peakRSSSample') == readback.get('peakRSSSample')
            and receipt.get('firstCause') == readback.get('firstCause'),
            'receipt identity, denominator, resource snapshot or first cause differs from readback')
    result = verifier_resources(receipt)
    result['binding'] = dict(originalReceiptPath=refs[0][0], receiptBytes=len(receipt_raw), receiptSHA256=digest,
        archiveSHA256=readback.get('archiveSHA256'), controller=readback.get('controller'),
        receiptDigestMatchesReadback=True, archiveReverified=False,
        originalArchiveOriginIndependentlyVerified=readback.get('archiveOriginIndependentlyVerified'),
        meaning='Local receipt digest matches the supplied readback. Official archive authenticity and CI qualification are not granted by this reduction.')
    return result


def diagnostic(readback):
    return dict(source=readback['source'], tools=readback['tools'], controller=readback['controller'],
                archiveSHA256=readback['archiveSHA256'], originalFirstCause=readback.get('originalFirstCause'),
                initialization=initialization(readback), commit=commit_stages(readback),
                nodeStartup=node_startup(readback), callees=callee_stages(readback), preparation=preparation(readback),
                resources=resources(readback), observationRPC=rpc_stages(readback), tcp=tcp_scope(readback),
                helpers=helper_stages(readback),
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
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--archive')
    inputs.add_argument('--verifier-receipt', help='Reduce an original receipt bound to an existing held readback; no archive qualification.')
    parser.add_argument('--old-readback')
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    if args.verifier_receipt:
        require(args.old_readback is None, 'verifier receipts cannot pool an old readback')
        raw_receipt, raw_readback = read_local_bounded(args.verifier_receipt), read_local_bounded(args.readback)
        result = verifier_summary(raw_receipt, strict(raw_readback))
        result['binding']['readbackSHA256'] = hashlib.sha256(raw_readback).hexdigest()
        with Path(args.output).open('x') as out:
            json.dump(result, out, indent=2, allow_nan=False)
            out.write('\n')
        print(json.dumps(dict(output=str(Path(args.output).resolve()), coverage=result['coverage'], archiveReverified=False)))
        return 0
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
