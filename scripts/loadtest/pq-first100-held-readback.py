"""Read the original held first100 archive after its Root-scheduled run."""
import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path


def module(filename):
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(path.stem, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prior = module('pq-first100-7c25-readback.py')
stages = module('pq-first100-stage-summary.py')
finalize = module('pq-finalize-observation.py')
preload = module('pq-preload-initialization.py')
leg_stages = module('pq-normal-leg-stages.py')
proof_readback = module('pq-public-proof-readback.py')
require, strict = prior.require, prior.strict
CONTEXT_FAILURE_DIGESTS = {
    hashlib.sha256(reason.encode('ascii')).hexdigest(): reason
    for reason in ('context deadline exceeded', 'context canceled')
}


def verify_archive_origin(run, job, artifacts, controller, sha256, size):
    """Bind a downloaded archive to its original first-attempt workflow and upload step."""
    run_id = run['id']
    branch = 'codex/ynx-pq-current75-baseline-20261101'
    require(type(run_id) is int and run_id > 0 and run['event'] == 'workflow_dispatch'
            and run['run_attempt'] == 1 and run['head_sha'] == controller and run['head_branch'] == branch
            and run['repository']['full_name'] == 'JiahaoAlbus/YNX-Chain'
            and run['path'] == '.github/workflows/pq-normal-process.yml' and run['status'] == 'completed',
            'original held workflow identity differs')
    require(job['run_id'] == run_id and job['run_attempt'] == 1 and job['head_sha'] == controller
            and type(job['id']) is int and job['id'] > 0 and job['status'] == 'completed'
            and job['name'].startswith('Held public-owner normal504 '),
            'original held job identity differs')
    uploads = [step for step in job['steps'] if step['name'] == 'Preserve only original public receipts and streams']
    require(len(uploads) == 1 and uploads[0]['conclusion'] == 'success', 'original held artifact upload missing')
    matches = [artifact for artifact in artifacts['artifacts']
               if artifact['name'] == f'pq-first100-held-public-owner-{run_id}-1']
    require(len(matches) == 1, 'one original held artifact required')
    artifact = matches[0]
    require(artifact['workflow_run']['id'] == run_id and artifact['workflow_run']['head_sha'] == controller
            and artifact['workflow_run']['head_branch'] == branch
            and artifact['digest'] == 'sha256:' + sha256 and artifact['size_in_bytes'] == size,
            'original held artifact identity or bytes differ')
    return dict(run=run_id, job=job['id'], artifact=artifact['id'], runConclusion=run['conclusion'],
                jobConclusion=job['conclusion'])


def readiness_resources(receipt):
    peak = receipt.get('peakRSSSample')
    if peak is None:
        return None
    rss = receipt['peakRSSBytes']
    rows = peak['processes']
    identities = {(row['pid'], row['startTicks']) for row in rows}
    observed = [row['rssBytes'] for row in rows if row['rssBytes'] is not None]
    require(len(identities) == len(rows) and all(type(value) is int and value >= 0 for value in observed)
            and sum(observed) == rss == peak['rssBytes'], 'original peak RSS samples do not reconcile')
    cap = receipt['caps']['rssBytes']
    pool = receipt.get('senderPoolPreparation') or {}
    lanes = pool.get('liveMaterialsPreparation', [])
    require([lane['node'] for lane in lanes] == list(range(len(lanes))) and len(lanes) <= 4,
            'original proof READY lane order differs')
    return dict(peakRSSBytes=rss, rssCapBytes=cap, rssHeadroomBytes=cap-rss,
                unmeasuredProcessCount=len(rows)-len(observed), readyProofLaneCount=len(lanes),
                signerLaunchToReadyNs=pool.get('sourcePreparation', {}).get('parentLaunchToReadyNs'),
                proofLaunchToReadyNs={str(lane['node']): lane.get('parentLaunchToReadyNs') for lane in lanes},
                observedProcesses=rows)


def compare_readiness(before, after):
    """Compare the measured preparation envelopes without attributing a TPS gain."""
    require(before.get('fullCohort') is None and after.get('status') == 'READY_ONLY_OBSERVED',
            'original failed preparation and completed READY-only readback required')
    left, right = (report['readinessResources'] for report in (before, after))
    require(left['readyProofLaneCount'] < 4 and right['readyProofLaneCount'] == 4,
            'original preparation outcomes differ')
    require(before['toolchain'] == after['toolchain'] and before['caps'] == after['caps']
            and before['conditions'] == after['conditions'], 'original configured resource conditions differ')
    left_host, right_host = (report['hardware'] for report in (before, after))
    keys = ('system', 'machine', 'cpuModels', 'kernelRelease', 'effectiveAffinity')
    same_reported_host_class = (left_host['status'] == right_host['status'] == 'OBSERVED'
                                and all(left_host[key] == right_host[key] for key in keys)
                                and left_host['filesystem']['type'] == right_host['filesystem']['type'])
    return dict(before=left, after=right, sameReportedHostClass=same_reported_host_class,
                identicalPhysicalHostProven=False,
                observedPeakDifferenceBytes=right['peakRSSBytes']-left['peakRSSBytes'],
                successfulBusinessComparison=False)


def compare_business(before, after):
    """Compare original observed cohorts and expose condition differences."""
    for report in (before, after):
        require(report.get('archiveOriginIndependentlyVerified') is True
                and report.get('status') == 'OBSERVED' and report.get('fullCohort') is not None,
                'independently bound original business runs required')
    require(before['actionsOrigin']['run'] != after['actionsOrigin']['run']
            and before['archiveSHA256'] != after['archiveSHA256'],
            'two distinct original business runs required')
    differences = [key for key in ('toolchain', 'caps', 'conditions')
                   if before.get(key) is None or before[key] != after.get(key)]
    host_fields = ('system', 'machine', 'cpuModels', 'kernelRelease', 'effectiveAffinity', 'hostMemTotalBytes')
    left, right = (report.get('hardware') or {} for report in (before, after))
    hardware_differences = [key for key in host_fields
                            if left.get(key) is None or left.get(key) != right.get(key)]
    for key in ('type', 'fragmentBytes'):
        a, b = ((host.get('filesystem') or {}).get(key) for host in (left, right))
        if a is None or a != b:
            hardware_differences.append('filesystem.' + key)
    if left.get('status') != 'OBSERVED' or right.get('status') != 'OBSERVED':
        hardware_differences.append('status')

    def arm(report):
        cohort = report['fullCohort']
        inclusion = report.get('originalFourNodeInclusion', {}).get('records', [])
        return dict(origin=report['actionsOrigin'], source=report['source'], tools=report['tools'],
                    controller=report['controller'], archiveSHA256=report['archiveSHA256'],
                    firstCause=report['firstCause'], peakRSSBytes=report['peakRSSBytes'],
                    configuredDemand=cohort['configuredDemand'],
                    submittedWithinWindow=cohort['submittedWithinWindow'],
                    submissionAttemptWindowTPS=cohort['submissionAttemptWindowTPS'],
                    counts=cohort['originalCohort']['counts'], latencies=cohort['originalCohort']['latencies'],
                    fourNodeObservationTimings=[dict(index=row['index'],
                        submitToObservationNs=row.get('submitToFourNodeRepliesObservedNs'),
                        observationToLedgerEventNs=row.get('observationToLedgerEventNs')) for row in inclusion],
                    terminalCounts=cohort['terminalCounts'], backlogGrowing=cohort['backlogGrowing'],
                    pipelinePressure=cohort['pipelinePressure'],
                    publicOwnerTiming=report.get('publicOwnerTiming'),
                    signerCalleeTiming=report.get('signerCalleeTiming'),
                    firstSignerFailure=report.get('firstSignerFailure'),
                    observationRPC=report.get('observationRPC'),
                    stoppedLiveProofFailures=report.get('stoppedLiveProofFailures'),
                    proofPublication=report.get('proofPublication'),
                    proofCaptureProgress=report.get('proofCaptureProgress'),
                    businessBlockCommitStages=report['businessBlockCommitStages'],
                    businessStageCostsByNode=report.get('businessStageCostsByNode'))

    return dict(before=arm(before), after=arm(after), configurationDifferences=differences,
                hardwareDifferences=hardware_differences,
                sameReportedConditions=not differences and not hardware_differences,
                identicalPhysicalHostProven=False, canonicalInputEqualityProven=False,
                throughputGainAttributed=False, sustainedTPSQualified=False)


def proof_capture_progress(load):
    captures = []
    for row in load['rows']:
        points = dict(row['stageTimes'])
        begin = points.get('live_capture')
        if begin is None:
            continue
        read = points.get('live_read')
        terminal = row['terminalNs']
        end = read if read is not None else terminal
        require(type(end) is int and end >= begin, 'original proof capture clock differs')
        captures.append(dict(index=row['index'], captureOffsetNs=begin, readOffsetNs=read,
                             spanNs=end-begin, resultReadStarted=read is not None,
                             terminatedWithoutRead=row['error'] if read is None else None))
    return dict(captures=captures, withoutResultRead=sum(not row['resultReadStarted'] for row in captures),
                finalityInferred=False)


def proof_publication(load, files, prefix):
    """Join archived publication replies to the original operation and parent clock."""
    if load is None:
        return None
    records = []
    for row in load['rows']:
        stem = f"load-{row['index']:05d}-live-session-request"
        projection_path = prefix + stem + '-reply.json'
        original = files.get(projection_path)
        if original is None:
            continue
        frame = strict(original)
        attempt_path = prefix + f"load-operations/{row['index']:05d}/live-proof-attempt.json"
        attempt = strict(files[attempt_path])
        session = frame['session']
        require(frame['schema'] == 'YNX-PERF-LIVE-REPLY-PUBLIC-PROJECTION/v1'
                and frame['sourceReplyVersion'] == 'YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1'
                and frame['operation'] == 'request' and frame['sequence'] == attempt['sequence']
                and session['nodeIndex'] == attempt['node'] and session['policySHA256'] == attempt['policySHA256']
                and all(attempt[key] == row[field] for key, field in
                        (('operationId', 'operationId'), ('transactionSHA256', 'hash'), ('nativeWireHash', 'nativeHash')))
                and type(frame['originalReplyBytes']) is int and 0 < frame['originalReplyBytes'] <= 2 << 20
                and re.fullmatch('[0-9a-f]{64}', frame['originalReplySHA256'])
                and frame['syntheticOnly'] is True and all(frame[key] is False for key in
                    ('authorityGranted', 'independentFinality', 'rawReplyIncluded', 'pathsAndPayloadsIncluded', 'timingsIncluded')),
                'original proof publication projection identity differs')
        outcome = frame['outcome']
        require(outcome in ('request_published', 'REFUSED_OR_UNKNOWN_NO_RETRY'), 'original proof publication outcome differs')
        callee = frame['calleeElapsedNs']
        stages.integer(callee, 'proof publication callee time')
        parent = overhead = None
        points = dict(row['stageTimes'])
        timing_bytes = files.get(prefix + stem + '.json')
        require('live_publish' in points and (outcome == 'request_published' or timing_bytes is None),
                'original proof publication boundary differs')
        if timing_bytes is not None:
            timing = strict(timing_bytes)
            parent, overhead = (timing[key] for key in ('parentElapsedNs', 'replyProjectionWriteNs'))
            end = points.get('live_capture', row['terminalNs'])
            require(all(timing[key] == attempt[key] for key in ('node', 'sequence', 'policySHA256'))
                    and timing['calleeElapsedNs'] == callee and type(parent) is int and type(overhead) is int
                    and 0 <= overhead <= parent and 0 <= callee <= parent
                    and type(end) is int and parent <= end - points['live_publish'],
                    'original proof publication clock or timing identity differs')
        records.append(dict(index=row['index'], node=attempt['node'], sequence=attempt['sequence'], outcome=outcome,
                            originalReplySHA256=frame['originalReplySHA256'], projectionPath=projection_path,
                            calleeElapsedNs=callee, parentElapsedNs=parent, replyProjectionWriteNs=overhead))
    return dict(records=records, published=sum(row['outcome'] == 'request_published' for row in records),
                rawReplyReverified=False, independentFinality=False)


def stopped_proof_failures(receipt, load, files, prefix):
    evidence = receipt.get('stoppedLiveProofFailures')
    if evidence is None:
        return None
    require(load is not None and receipt['cleanupComplete'] is True
            and evidence['altersLoadResult'] is False, 'original stopped proof boundary differs')
    requests = {}
    attempts = {}
    for path, raw in files.items():
        if not path.startswith(prefix):
            continue
        relative = path.removeprefix(prefix)
        match = re.fullmatch(r'load-([0-9]{5})-live-session-request\.json', relative)
        if match:
            requests[int(match[1])] = strict(raw)
        match = re.fullmatch(r'load-operations/([0-9]{5})/live-proof-attempt\.json', relative)
        if match:
            attempts[int(match[1])] = strict(raw)
    cohort = {row['index']: row for row in load['rows']}
    rows = evidence['records']
    expected = requests.keys() | attempts.keys()
    require(type(rows) is list and len(rows) == len(expected)
            and all(type(row['index']) is int for row in rows)
            and {row['index'] for row in rows} == expected <= cohort.keys(),
            'original stopped proof request coverage differs')
    output = []
    for record in rows:
        index, status = record['index'], record['status']
        request = attempts[index] if index in attempts else requests[index]
        if index in attempts:
            require(all(request[key] == cohort[index][field] for key,field in
                        (('operationId', 'operationId'), ('transactionSHA256', 'hash'), ('nativeWireHash', 'nativeHash')))
                    and (index not in requests or all(request[key] == requests[index][key]
                         for key in ('node', 'sequence', 'policySHA256'))),
                    'original stopped proof attempt differs')
        require(type(request['node']) is int and 0 <= request['node'] < 4
                and type(request['sequence']) is int and 1 <= request['sequence'] <= load['configuredDemand']
                and re.fullmatch(r'[0-9a-f]{64}', request['policySHA256']),
                'original stopped proof request scope differs')
        data = None
        progress = record.get('stoppedOutputEntries')
        if progress is not None:
            allowed = {'intent.json', 'derived-source-plan.json', 'source-context', 'verifier',
                       'materials.json', 'proof.json', 'committed-state.json', 'result.json', 'failure.json'}
            require(type(progress) is dict and progress.keys() <= allowed
                    and all(kind in ('directory', 'file', 'unexpected') for kind in progress.values())
                    and record['node'] == request['node'] and record['sequence'] == request['sequence'],
                    'original stopped proof output inventory differs')
        if index in attempts and status in ('RETAINED_AFTER_STOP', 'ALREADY_RETAINED', 'FAILURE_NOT_SUPPLIED'):
            require(re.fullmatch(r'[0-9a-f]{64}', record.get('originalRequestSHA256', '')),
                    'original persisted proof request digest missing')
        if status in ('ALREADY_RETAINED', 'RETAINED_AFTER_STOP'):
            path = f'load-operations/{index:05d}/original-live-proof-failure.json'
            require(record['path'] == path and record['node'] == request['node']
                    and record['sequence'] == request['sequence'], 'original stopped proof request binding differs')
            raw = files.get(prefix + path)
            require(raw is not None and len(raw) <= 4096 and hashlib.sha256(raw).hexdigest() == record['sha256'],
                    'original stopped proof failure digest differs')
            data = strict(raw)
            require(set(data) == {'Version', 'PolicySHA256', 'Outcome', 'FirstCauseSHA256', 'Sequence'}
                    and data['Version'] == 'YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1'
                    and data['PolicySHA256'] == request['policySHA256'] and data['Outcome'] == 'unknown'
                    and type(data['Sequence']) is int and data['Sequence'] == request['sequence']
                    and re.fullmatch(r'[0-9a-f]{64}', data['FirstCauseSHA256']),
                    'original stopped proof failure payload differs')
        else:
            require(status in ('FAILURE_NOT_SUPPLIED', 'ORIGINAL_FAILURE_UNAVAILABLE')
                    or (status == 'REQUEST_NOT_SUPPLIED' and index in attempts and index not in requests),
                    'original stopped proof status differs')
        pre_output = record.get('preOutputFailure')
        pre_output_data = None
        if pre_output is not None:
            path = f'load-operations/{index:05d}/original-live-proof-pre-output-failure.json'
            raw = files.get(prefix + path)
            require(pre_output['path'] == path and raw is not None and len(raw) <= 4096
                    and hashlib.sha256(raw).hexdigest() == pre_output['sha256'],
                    'original pre-output proof failure digest differs')
            pre_output_data = proof_readback.pre_output_failure(raw, request['policySHA256'], request['sequence'])
        output.append(dict(record, originalFailure=data, originalPreOutputFailure=pre_output_data,
                           matchedContextError=CONTEXT_FAILURE_DIGESTS.get(data['FirstCauseSHA256']) if data else None,
                           originalCohortStatus=cohort[index]['status']))
    return dict(records=output, altersLoadResult=False)


def observation_rpc(receipt):
    original = receipt.get('normalObservationRPCTiming')
    if original is None:
        return None
    groups = original['groups']
    require(original['schema'] == 'YNX-PERF-PARENT-RPC-ELAPSED/v1'
            and original['clock'] == 'parent_monotonic_ns' and original['groupLimit'] == 12
            and original['intervalsOverlap'] is True and original['independentFinality'] is False
            and original['businessSuccessInferred'] is False and type(groups) is list and len(groups) <= 12,
            'original observation RPC schema differs')
    by_method = {}
    fields = ('attempted', 'returned', 'raised', 'completed', 'inFlight')
    for group in groups:
        node, method = group['node'], group['method']
        require(type(node) is int and 0 <= node < 4 and method in ('tx', 'status', 'abci_info')
                and all(type(group[key]) is int and group[key] >= 0 for key in fields)
                and group['completed'] == group['returned'] + group['raised']
                and group['attempted'] == group['completed'] + group['inFlight'],
                'original observation RPC counters differ')
        nodes = by_method.setdefault(method, {})
        require(node not in nodes, 'duplicate original observation RPC group')
        nodes[node] = group
    return dict(original=original, countsByMethod={
        method: {key: sum(group[key] for group in nodes.values()) for key in fields}
        for method, nodes in by_method.items()
    }, elapsedIntervalsAdded=False)


def first_signer_failure(owner_timing, files, prefix):
    if owner_timing is None or owner_timing['firstOperationalFailure'] is None:
        return None
    first = owner_timing['firstOperationalFailure']
    attempts = [value['originalRecord'] for value in first['returnedAttempts']
                if value['originalRecord']['operation'] == 'sign'
                and value['originalRecord'].get('code') in ('UNKNOWN', 'REJECTED')]
    if not attempts:
        return None
    require(len(attempts) == 1, 'duplicate original failed signing attempt')
    path = f"load-operations/{first['index']:05d}/original-sign-reply.json"
    raw = files.get(prefix + path)
    require(raw is not None and len(raw) <= 2 << 20, 'bounded original failed signing reply required')
    reply = strict(raw)
    require(reply['version'] == 'YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1'
            and all(reply[key] == attempts[0][key] for key in ('ownerIndex', 'operationId', 'code')),
            'original failed signing reply identity differs')
    measured = (reply.get('timings') or {}).get('stages', {})
    return dict(index=first['index'], path=path, sha256=hashlib.sha256(raw).hexdigest(),
                code=reply['code'], failure=reply.get('failure'),
                checkpointStages={key: value for key, value in measured.items() if key.startswith('checkpoint.')},
                senderPersistenceStages={key: value for key, value in measured.items()
                                         if key.startswith('sender.persistence.')},
                missingStagesFilled=False)


def public_owner_timing(receipt, load):
    """Join observed signer and confirmation spans to the original business failure."""
    if receipt.get('normalPublicOwnerTransport') is None:
        return None
    transport = prior.public_transport(receipt)
    first = load.get('firstOperationalFailure')
    matched = None
    if first is not None:
        row = next((row for row in load['rows'] if (row['index'], row['id']) ==
                    (first['index'], first['id'])), None)
        require(row is not None, 'original operational failure is outside the cohort')
        origin = int(load['originMonotonicNs'])
        matched = [record for record in transport['records']
                   if record['originalRecord']['operation'] in ('sign', 'confirm')
                   and record['originalRecord']['ownerIndex'] == row['ownerIndex']
                   and record['originalRecord']['operationId'] == row['operationId']
                   and record['originalRecord']['returnedMonotonicNs'] <= origin + first['atNs']]
        matched = dict(index=row['index'], originalFailure=first, returnedAttempts=matched,
                       submittedObserved=row['submittedNs'] is not None,
                       includedObserved=row['includedNs'] is not None,
                       qualifiedObserved=row['finalNs'] is not None)
    return dict(attempted=transport['attempted'], omitted=transport['omitted'],
                groups=transport['groups'], receiptProjectionSHA256=transport['receiptProjectionSHA256'],
                firstOperationalFailure=matched, stagesAdded=False)


def signer_callee_timing(receipt, load, files, prefix):
    """Bind each retained signer reply to its cohort row and parent attempt."""
    transport = (receipt.get('normalPublicOwnerTransport') or {}).get('records')
    if load is None or transport is None:
        return None
    rows = {(row['ownerIndex'], row['operationId']): row for row in load['rows']}
    attempts = {}
    for record in transport:
        if record['operation'] == 'sign':
            key = (record['ownerIndex'], record['operationId'])
            require(key in rows and key not in attempts, 'original signing attempt outside cohort or repeated')
            attempts[key] = record.get('code')
    groups = {}
    for key, row in rows.items():
        path = f"load-operations/{row['index']:05d}/original-sign-reply.json"
        raw = files.get(prefix + path)
        if raw is None:
            continue
        require(len(raw) <= 2 << 20, 'bounded original signing reply required')
        reply = strict(raw)
        code = reply['code']
        require(reply['version'] == 'YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1'
                and (reply['ownerIndex'], reply['operationId']) == key
                and code in ('ORIGINAL_SAVED', 'REJECTED', 'UNKNOWN') and attempts.get(key) == code,
                'original signer reply does not match parent and cohort')
        elapsed = reply.get('calleeElapsedNs')
        require(elapsed is None or type(elapsed) is int and elapsed >= 0, 'invalid original signing elapsed time')
        measured = (reply.get('timings') or {}).get('stages', {})
        for value in measured.values():
            require(all(type(value[field]) is int and value[field] >= 0 for field in ('calls', 'elapsedNs')),
                    'invalid original signing stage counters')
        groups.setdefault(code, []).append(dict(index=row['index'], replySHA256=hashlib.sha256(raw).hexdigest(),
                                                calleeElapsedNs=elapsed, originalStages=measured))
    return dict(retainedSigningAttempts=len(attempts), observedReplies=sum(map(len, groups.values())),
                groups={code: dict(records=records,
                    calleeElapsed=stages.samples([row['calleeElapsedNs'] for row in records], len(records)),
                    stages={name: stages.samples(
                        [row['originalStages'].get(name, {}).get('elapsedNs') for row in records], len(records))
                        for name in sorted({name for row in records for name in row['originalStages']})})
                    for code, records in groups.items()}, stageIntervalsAdded=False)


def verify_ready_boundary(receipt, configuration, read, manifest, prefix):
    pool = receipt['senderPoolPreparation']
    transport = receipt['normalPublicOwnerTransport']
    accounting = receipt['preparationOnlyDemandAccounting']
    require(configuration['options']['held_ready_only'] is True and receipt['loadExecuted'] is False
            and 'loadResult' not in receipt and all(accounting[k] == 500 for k in
                ('configuredDemand', 'notReleased', 'notSubmitted', 'notQualified'))
            and all(pool[k] is False for k in ('signed', 'nonceReserved', 'loadClockStarted'))
            and pool['bootstrapLoaded'] is True and transport['attempted'] == 0
            and [lane['node'] for lane in pool['liveMaterialsPreparation']] == list(range(4)),
            'original READY-only boundary differs')
    census = read('initialized-account-readback.json')
    boundary = read('preload-initialization.json')
    require(census == receipt['initializedAccountReadback']
            and boundary == receipt['preloadInitialization']
            and boundary == preload.validate(census, boundary['originalProcesses'],
                receipt['preparationUnconfirmedOwners'], boundary['remainingOriginalActiveSeconds'], 5, 30),
            'original READY-only census or preload receipt differs')
    exited = receipt['normalNodeCleanExit']
    keys = ('name', 'pid', 'startTicks')
    before = {tuple(row[key] for key in keys) for row in boundary['originalProcesses']}
    after = exited['records']
    require(receipt['cleanupComplete'] is True and exited['allEightExitZero'] is True
            and len(after) == len(before) == 8 and before == {tuple(row[key] for key in keys) for row in after}
            and all(row['exited'] is True and type(row['rawReturnCode']) is int
                    and row['rawReturnCode'] == 0 and row['exitCode'] == 0 and row['signal'] is None for row in after),
            'original READY-only node identities or exits differ')
    signer = pool['sourcePreparation']
    signer_path = 'load-public-owners-ready.json'
    require(signer['sourceReply'] == signer_path
            and signer['sourceReplySHA256'] == manifest[prefix+signer_path]['sha256']
            and read(signer_path) == pool['publicScopeReady'],
            'original READY-only signer receipt differs')


def pipeline_pressure(load):
    pipeline = load.get('pipeline')
    if pipeline is None:
        return None
    samples = pipeline['queueSamples']
    stages = ('publish', 'observe', 'finalize')
    require(all(set(pipeline[key]) == set(stages) for key in
                ('stageWorkers', 'queueCapacity', 'queuePeak', 'queueAtCutoff', 'completedByStage')),
            'original staged worker inventory differs')
    previous = -1
    for sample in samples:
        at = sample['atNs']
        require(type(at) is int and at > previous and all(
                0 <= sample['queued'][stage] <= pipeline['queueCapacity'][stage]
                and 0 <= sample['activeWorkers'][stage] <= pipeline['stageWorkers'][stage] for stage in stages),
                'original queue sample order or bounds differ')
        previous = at
    by_stage = {}
    for stage in stages:
        capacity = pipeline['queueCapacity'][stage]
        workers = pipeline['stageWorkers'][stage]
        full = [sample['atNs'] for sample in samples if sample['queued'][stage] == capacity]
        occupied = [sample['atNs'] for sample in samples if sample['activeWorkers'][stage] == workers]
        by_stage[stage] = dict(queueCapacity=capacity, workers=workers, peakQueued=pipeline['queuePeak'][stage],
                               queuedAtCutoff=pipeline['queueAtCutoff'][stage],
                               returnedOrRaised=pipeline['completedByStage'][stage],
                               fullQueueSamplesInWindow=sum(at < load['windowNs'] for at in full),
                               fullQueueSamplesTotal=len(full),
                               firstFullQueueSampleNs=full[0] if full else None,
                               allWorkersActiveSamples=len(occupied))
    return dict(stages=by_stage, sampleCount=len(samples), queueSamplingAtomic=False,
                chainSaturationProven=False)


def inspect(raw, sha256, controller, configuration_sha256):
    files, manifest, _ = prior.original.public_archive(raw, sha256, entry_limit=8192)
    plans = [path for path in files if path.rsplit('/', 1)[-1] == 'pq-first100-held-plan.json']
    require(len(plans) == 1, 'one original held configuration required')
    plan = strict(files[plans[0]])
    configuration = plan['configuration']
    encoded = json.dumps(configuration, sort_keys=True, separators=(',', ':')).encode()
    require(hashlib.sha256(encoded).hexdigest() == configuration_sha256 == plan['configurationSHA256']
            and plan['runtimePlanSHA256'] is None, 'fixed controller configuration digest differs')
    require(configuration['profile'] == 'first100-held-public-owner'
            and configuration['nodeCount'] == 4 and configuration['pressureLevel'] == 1
            and re.fullmatch('[0-9a-f]{40}', controller),
            'fixed held first100 profile required')
    receipts = [name for name in files if name in ('receipt.json', 'public/receipt.json') or name.endswith('/public/receipt.json')]
    require(len(receipts) <= 1, 'duplicate original runtime receipt')
    report = dict(archiveSHA256=sha256, configurationSHA256=configuration_sha256, controller=controller,
                  configuredDemand=500, files=manifest, archiveOriginIndependentlyVerified=False,
                  stable1000TPSQualified=False, fullCohort=None)
    if not receipts:
        return dict(report, status='NO_RUNTIME_RECEIPT')
    name = receipts[0]
    prefix = name.removesuffix('receipt.json')
    def read(path):
        return strict(files[prefix + path])
    receipt = read('receipt.json')
    adapter = read('FIRST100-HELD-CI.json')
    require(adapter['controllerCommit'] == controller
            and all(adapter[key] == plan[key] for key in plan), 'original controller receipt differs')
    source, tools = receipt['source'], receipt['toolIdentity']
    require((source['commit'], source['tree'], tools['commit'], tools['tree']) ==
            (configuration['source'], configuration['sourceTree'], configuration['tools'],
             configuration['toolsTree']), 'original source or tools differ')
    request = read('requested-load.json')
    require(request['source'] == source and (request['mode'], request['rate'], request['seconds'],
            request['accounts'], request['tailSeconds'], request['perAccountCapacity'],
            request['configuredDemand']) == ('online', 100, 5, 500, 30, 1, 500), 'original demand differs')
    runtime_pin = receipt.get('planSHA256')
    if runtime_pin is not None:
        require(manifest[prefix+'load-plan.json']['sha256'] == runtime_pin, 'original runtime plan differs')
    load = receipt.get('loadResult')
    observed = prior.inclusion_replies(files, prefix, load)
    successor = prior.successor_availability(files, prefix, receipt)
    commits = prior.original.commit_original_copies(files, prefix, receipt)
    if load is not None:
        require(receipt['loadExecuted'] is True and runtime_pin is not None, 'original load boundary missing')
        for segment in receipt['journalSegments']:
            path = segment['path']
            require(re.fullmatch(r'load-events-\d{5}\.jsonl', path)
                    and all(manifest[prefix + path][key] == segment[key] for key in ('bytes', 'sha256')),
                    'original load journal differs')
        business = stages.business(load)
        submitted = sum(row['submittedNs'] is not None and row['submittedNs'] < load['windowNs']
                        for row in load['rows'])
        require(submitted == load['submittedWithinWindow']
                and submitted / 5 == load['actualSubmissionAttemptTPS'], 'original submission window differs')
        terminal = business['terminalCounts']
        report['fullCohort'] = dict(business, submittedWithinWindow=submitted,
                                    submissionAttemptWindowTPS=submitted / 5,
                                    knownFailureRate=terminal.get('failed', 0) / 500,
                                    unresolvedRate=(500 - load['qualified'] - terminal.get('failed', 0)) / 500,
                                    backlogGrowing=load['backlogGrowing'], queueSamples=load['queueSamples'],
                                    pipelinePressure=pipeline_pressure(load))
        for row in load['rows']:
            if row['finalNs'] is None:
                continue
            base = 'load-operations/%05d/' % row['index']
            require(row['proofReference'] == base + 'qualified-receipt.json', 'original proof reference differs')
            final = read(row['proofReference'])
            frame = read('load-%05d-live-result.log' % row['index'])
            require((final['id'], final['operationId'], final['mode']) == (row['id'], row['operationId'], 'online')
                    and frame['version'] == 'YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1'
                    and frame['outcome'] == 'original_result_read' and frame['result'] == final['normalLiveResult']
                    and final['normalConfirm']['code'] == 'PROOF_CONFIRMED_DATA'
                    and final['normalVerifier']['code'] == 'VERIFIED_TRANSACTION_DATA'
                    and final['normalConfirm'] == read(base + 'original-confirm-reply.json')
                    and final['normalVerifier'] == read('load-%05d-normal-verifier.log' % row['index']),
                    'original held proof, confirmation or operation identity differs')
            for verification in (final['normalVerifier'], final['normalConfirm']['result']):
                result = verification['result']
                require(result['transactionHash'].removeprefix('0x').lower() == row['hash']
                        and result['nativeWireHash'].removeprefix('0x').lower() == row['nativeHash']
                        and result['included'] is True and result['finalized'] is True
                        and result['executionSuccessful'] is True and str(result['executionCode']) == '0'
                        and result['nativeGrant'] is False, 'original proof execution or dual identity differs')
    ready = receipt.get('heldReadyOnlyComplete') is True
    if ready:
        verify_ready_boundary(receipt, configuration, read, manifest, prefix)
    finalize_by_node = {}
    business_heights = {int(row['height']) for row in observed['records']}
    usable_commits = {}
    finalize_records = {ref['node']: ref for ref in receipt.get('normalFinalizeObservation', {}).get('records', [])}
    for record in commits['records']:
        if not record['producerReportedUsable']:
            continue
        node = record['node']
        commit = record['originalSnapshot']
        usable_commits[node] = commit
        path = f'finalize-observation-node-{node}-original.json'
        if prefix + path not in files:
            continue
        if finalize_records:
            ref = finalize_records[node]
            require(ref['path'] == path and ref['pid'] == commit['processID']
                    and all(ref[key] == manifest[prefix+path][key] for key in ('bytes', 'sha256')),
                    'Finalize observation receipt pin differs')
        original = finalize.validate(read(path), pid=commit['processID'], chain_id=commit['chainID'],
                                     genesis_hash=commit['originalGenesisHash'])
        business_finalize = finalize.business_heights(original, business_heights, commit['samples'])
        completed = [sample for sample in original['samples'] if sample['success']]
        committed = finalize.business_heights(original, {row['height'] for row in commit['samples']}, commit['samples'])
        finalize_by_node[str(node)] = dict(
            path=path, sha256=manifest[prefix+path]['sha256'], original=original, business=business_finalize,
            committed=committed,
            retainedSuccessParentStages={stage: stages.samples(
                [sample['phaseNs'].get(stage) for sample in completed], len(completed))
                for stage in finalize.PHASES},
            retainedSuccessStages={stage: stages.samples(
                [sample['childrenNs'].get(stage) for sample in completed], len(completed))
                for stage in sorted(finalize.CHILDREN)},
            retainedSuccessElapsed=stages.samples([sample['elapsedNs'] for sample in completed], len(completed)))
    checkpoints = finalize.four_node_checkpoints(finalize_by_node)
    business_stage_costs = None
    if load is not None:
        business_stage_costs = {
            str(node): leg_stages.business_stage_costs(
                usable_commits.get(node), finalize_by_node.get(str(node), {}).get('original'), business_heights)
            for node in range(4)
        }
    census_join = None
    if ready:
        checkpoint = receipt['preloadInitialization']['checkpoint']
        observed_nodes = []
        for node, data in sorted(finalize_by_node.items()):
            sample = data['committed']['samples'].get(checkpoint['height'])
            if sample is not None:
                require(sample['appHash'] == checkpoint['appHash'],
                        'original READY-only census AppHash differs from Finalize and Commit')
                observed_nodes.append(node)
        missing_nodes = sorted(set(map(str, range(4))) - set(observed_nodes))
        census_join = dict(status='NOT_OBSERVED' if missing_nodes else 'OBSERVED', checkpoint=checkpoint,
                           observedNodes=observed_nodes, missingNodes=missing_nodes,
                           fourNodeJoinObserved=not missing_nodes, independentFinality=False)
    status = 'READY_ONLY_OBSERVED' if ready else 'OBSERVED' if load is not None else 'LOAD_RESULT_MISSING'
    owner_timing = public_owner_timing(receipt, load) if load is not None else None
    return dict(report, status=status,
                preparationOnlyDemandAccounting=receipt.get('preparationOnlyDemandAccounting'),
                senderPoolPreparation=receipt.get('senderPoolPreparation'),
                source=source, tools=tools, runtimePlanSHA256=runtime_pin, firstCause=receipt.get('firstCause'),
                cleanupComplete=receipt.get('cleanupComplete'), hardware=receipt.get('runtimeHardware'),
                toolchain=configuration.get('go'), conditions=receipt.get('loadConditions'),
                caps=receipt.get('caps'), freshResourceAdmission=receipt.get('freshResourceAdmission'),
                normalNodeCleanExit=receipt.get('normalNodeCleanExit'),
                readinessResources=readiness_resources(receipt),
                peakRSSBytes=receipt.get('peakRSSBytes'), peakRSSSample=receipt.get('peakRSSSample'),
                peakNewBytes=receipt.get('peakNewBytes'), originalFourNodeInclusion=observed,
                publicOwnerTiming=owner_timing, firstSignerFailure=first_signer_failure(owner_timing, files, prefix),
                signerCalleeTiming=signer_callee_timing(receipt, load, files, prefix),
                observationRPC=observation_rpc(receipt),
                stoppedLiveProofFailures=stopped_proof_failures(receipt, load, files, prefix),
                proofPublication=proof_publication(load, files, prefix),
                proofCaptureProgress=proof_capture_progress(load) if load is not None else None,
                originalSuccessorAvailability=successor,
                finalizeByNode=finalize_by_node, originalCommitCopies=commits, commitStages=stages.commit_stages(dict(originalCommitCopies=commits)),
                finalizeCommitCheckpoints=checkpoints,
                businessStageCostsByNode=business_stage_costs,
                readinessCensusCheckpointJoin=census_join,
                businessBlockCommitStages=prior.business_commit_stages(dict(originalCommitCopies=commits), observed, stages),
                originalCalleeMeasurements=receipt.get('normalCalleeMeasurements'),
                originalInitializationStages=receipt.get('initializationStages'),
                originalResourceGuardStageElapsed=receipt.get('resourceGuardStageElapsed'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(allow_abbrev=False, description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    for argument in ('archive-sha256', 'controller', 'configuration-sha256'):
        parser.add_argument('--' + argument, required=True)
    parser.add_argument('--before-readback', type=Path)
    parser.add_argument('--actions-metadata', type=Path,
                        help='directory with original RUN.json, JOB.json and ARTIFACTS.json API responses')
    args = parser.parse_args()
    with args.archive.open('rb') as archive:
        raw = archive.read((128 << 20) + 1)
    result = inspect(raw, args.archive_sha256, args.controller, args.configuration_sha256)
    if args.actions_metadata is not None:
        records = [strict((args.actions_metadata / name).read_bytes())
                   for name in ('RUN.json', 'JOB.json', 'ARTIFACTS.json')]
        result['actionsOrigin'] = verify_archive_origin(*records, args.controller, args.archive_sha256, len(raw))
        result['archiveOriginIndependentlyVerified'] = True
    if args.before_readback is not None:
        with args.before_readback.open('rb') as baseline:
            original = baseline.read((32 << 20) + 1)
        require(len(original) <= 32 << 20, 'original before readback exceeds bound')
        before = strict(original)
        if result['fullCohort'] is None:
            result['readinessComparison'] = compare_readiness(before, result)
        else:
            result['businessComparison'] = compare_business(before, result)
    print(json.dumps(result, indent=2, sort_keys=True))
