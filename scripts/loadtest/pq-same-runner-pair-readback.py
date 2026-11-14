"""Bind two sequential held originals from ONE Actions job, without execution.

Producer contract (not an implemented controller or runtime grant): upload three
separate artifacts named pq-first100-same-runner-{run}-1-{manifest,before,after}.
The manifest artifact contains only same-runner-pair.json. Each arm keeps its
unaltered held plan, receipt, PUBLIC originals and SAME-RUNNER-ARM.json. The
marker is written after cleanup and pins the receipt and load plan. Each arm's
archive retains its unique pq-independent-load-*/public/ directory name. Manifest
arms pin the final archive bytes and marker. All writes belong to the producer;
this module only reads local bytes. Existing single-arm validation is unchanged.

The CLI requires externally frozen controller/source/tools/configuration pins
and original RUN.json, JOB.json, ARTIFACTS.json metadata. Metadata provenance is
the collector's responsibility; hashes and identifiers are cross-checked here.
Same job/runner and controller-reported monotonic boundaries are not a physical
CPU, cache, I/O, cryptographic equivalence or sustained-throughput attestation.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

import importlib.util


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


held = module('pq-first100-held-readback')
costs = module('pq-normal-leg-stages')
require, strict = held.require, held.strict
SCHEMA = 'YNX-PERF-SAME-RUNNER-PAIR/v1'
MARKER = 'YNX-PERF-SAME-RUNNER-ARM/v1'
JOB = 'Held public-owner normal504 sequential pair'
BRANCH = 'codex/ynx-pq-current75-baseline-20261101'
ARMS = ('before', 'after')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def pin(value, size=64):
    require(type(value) is str and re.fullmatch('[0-9a-f]{%d}' % size, value), 'exact hexadecimal pin required')
    return value


def positive(value):
    require(type(value) is int and 0 < value < 1 << 64, 'positive bounded integer required')
    return value


def fields(value, names, label):
    require(type(value) is dict and set(value) == set(names.split()), label + ' fields differ')


def origin(run, job, artifacts, controller, raws):
    """Bind three distinct original artifacts to one first-attempt hosted job."""
    pin(controller, 40)
    run_id, job_id = positive(run['id']), positive(job['id'])
    require(run['event'] == 'workflow_dispatch' and type(run['run_attempt']) is int
            and run['run_attempt'] == 1 and run['head_sha'] == controller
            and run['head_branch'] == BRANCH and run['repository']['full_name'] == 'JiahaoAlbus/YNX-Chain'
            and run['path'] == '.github/workflows/pq-normal-process.yml' and run['status'] == 'completed',
            'original pair workflow identity differs')
    require(job['run_id'] == run_id and type(job['run_attempt']) is int and job['run_attempt'] == 1
            and job['head_sha'] == controller and job['name'] == JOB and job['status'] == 'completed'
            and type(job['runner_name']) is str and 0 < len(job['runner_name']) <= 256,
            'original pair job identity differs')
    positive(job['runner_id'])
    require(type(artifacts.get('artifacts')) is list and len(artifacts['artifacts']) <= 100,
            'bounded original artifact metadata required')
    result = {}
    for arm in ('manifest', *ARMS):
        raw = raws[arm]
        require(type(raw) is bytes and 0 < len(raw) <= (1 << 20 if arm == 'manifest' else 128 << 20),
                'bounded original pair artifact required')
        name = f'pq-first100-same-runner-{run_id}-1-{arm}'
        matches = [a for a in artifacts['artifacts'] if a['name'] == name]
        uploads = [s for s in job['steps'] if s['name'] == 'Preserve same-runner ' + arm + ' originals']
        require(len(matches) == len(uploads) == 1 and uploads[0]['conclusion'] == 'success',
                'unique original pair artifact and successful upload required')
        item = matches[0]
        positive(item['id'])
        require(item['workflow_run']['id'] == run_id and item['workflow_run']['head_sha'] == controller
                and item['workflow_run']['head_branch'] == BRANCH and item['expired'] is False
                and type(item['size_in_bytes']) is int and item['size_in_bytes'] == len(raw)
                and item['digest'] == 'sha256:' + digest(raw), 'original pair artifact bytes or identity differ')
        result[arm] = dict(artifactID=item['id'], name=name, bytes=len(raw), sha256=digest(raw))
    require(len({a['artifactID'] for a in result.values()}) == 3
            and len({a['sha256'] for a in result.values()}) == 3, 'distinct original pair artifacts required')
    return dict(runID=run_id, jobID=job_id, runAttempt=1, controllerCommit=controller,
                runnerID=job['runner_id'], runnerName=job['runner_name'], artifacts=result,
                runConclusion=run['conclusion'], jobConclusion=job['conclusion'])


def referenced(files, inventories, ref, path):
    fields(ref, 'path sha256 bytes', 'original reference')
    require(ref['path'] == path and path in files and positive(ref['bytes']) == len(files[path])
            and pin(ref['sha256']) == inventories[path]['sha256'], 'original arm reference differs')
    return strict(files[path])


def clean_processes(receipt):
    require(receipt.get('cleanupComplete') is True and not receipt.get('cleanupError'),
            'original arm cleanup incomplete')
    processes = receipt['processes']
    require(type(processes) is list and 8 <= len(processes) <= 4096, 'bounded original process inventory required')
    identities = set()
    for proc in processes:
        identity = positive(proc['pid']), positive(proc['startTicks'])
        require(identity not in identities and proc['exited'] is True, 'original process still live or duplicated')
        identities.add(identity)
    nodes = [p for p in processes if re.fullmatch(r'(bootstrap|pq)-node-[0-3]', p['name'])]
    expected = {f'{phase}-node-{i}' for phase in ('bootstrap', 'pq') for i in range(4)}
    require(len(nodes) == 8 and {p['name'] for p in nodes} == expected
            and all(type(p['rawReturnCode']) is int and p['rawReturnCode'] == 0
                    and type(p['exitCode']) is int and p['exitCode'] == 0 and p['signal'] is None for p in nodes),
            'original eight clean node exits required')
    exit_record = receipt['normalNodeCleanExit']
    require(exit_record['allEightExitZero'] is True and len(exit_record['records']) == 8,
            'original clean exit receipt differs')
    keys = ('name', 'pid', 'startTicks', 'exited', 'rawReturnCode', 'exitCode', 'signal')
    require({tuple(p[k] for k in keys) for p in nodes}
            == {tuple(p[k] for k in keys) for p in exit_record['records']}, 'original clean exit identities differ')
    require(receipt['loadResult'].get('pipeline', {}).get('workerThreadsRetired') is True,
            'original staged workers did not retire')
    for key in ('normalHelperLifecycle', 'boundedColdSenderLifecycle', 'normalPublicOwnerTransport'):
        value = receipt.get(key) or {}
        require(not value.get('cleanupDebt'), 'original helper cleanup debt remains')
    return identities


def arm_read(raw, label, declaration, pair, expected):
    fields(declaration, 'arm source tools configurationSHA256 archive marker', 'arm declaration')
    fields(expected, 'source tools configurationSHA256', 'expected arm pins')
    require(declaration['arm'] == label, 'original arm order differs')
    for name in ('source', 'tools'):
        identity = declaration[name]
        optional = {'forkTree': 40} if name == 'source' else {'driverSHA256': 64, 'resourceGuardSHA256': 64}
        require(type(identity) is dict and {'commit', 'tree'} <= set(identity)
                and set(identity) <= {'commit', 'tree'} | set(optional), 'original ' + name + ' identity fields differ')
        pin(identity['tree'], 40)
        for key in set(identity) & set(optional):
            pin(identity[key], optional[key])
        require(pin(identity['commit'], 40) == pin(expected[name], 40), 'frozen arm source/tools differ')
    require(pin(declaration['configurationSHA256']) == pin(expected['configurationSHA256']),
            'frozen arm configuration differs')
    fields(declaration['archive'], 'sha256 bytes', 'arm archive')
    require(declaration['archive'] == dict(sha256=digest(raw), bytes=len(raw)), 'manifest arm archive differs')
    files, inventory, _ = held.prior.original.public_archive(raw, digest(raw), entry_limit=8192)
    names = [n for n in files if n == 'receipt.json' or n == 'public/receipt.json' or n.endswith('/public/receipt.json')]
    require(len(names) == 1, 'one original arm receipt required')
    prefix = names[0].removesuffix('receipt.json')
    plans = [n for n in files if n.rsplit('/', 1)[-1] == 'pq-first100-held-plan.json']
    require(len(plans) == 1 and prefix and all((n.startswith(prefix) or n == plans[0])
            and not any(part.startswith('.') for part in n.split('/')) for n in files),
            'arm artifact must contain only its original public subtree and plan')
    marker = referenced(files, inventory, declaration['marker'], prefix + 'SAME-RUNNER-ARM.json')
    fields(marker, 'schema pairID arm runID jobID runAttempt controllerCommit clock workDirectoryName startedMonotonicNs '
                   'cleanupCompletedMonotonicNs receipt loadPlan', 'arm marker')
    require(marker['schema'] == MARKER and marker['arm'] == label
            and all(marker[k] == pair[k] for k in ('pairID', 'runID', 'jobID', 'runAttempt', 'controllerCommit', 'clock')),
            'original arm clock or identity differs')
    require(type(marker['workDirectoryName']) is str
            and re.fullmatch(r'pq-independent-load-[A-Za-z0-9_-]{6,64}', marker['workDirectoryName'])
            and prefix == marker['workDirectoryName'] + '/public/',
            'original owned directory and archive subtree differ')
    start, end = (positive(marker[k]) for k in ('startedMonotonicNs', 'cleanupCompletedMonotonicNs'))
    require(start < end, 'ordered original arm boundaries required')
    receipt = referenced(files, inventory, marker['receipt'], names[0])
    plan = referenced(files, inventory, marker['loadPlan'], prefix + 'load-plan.json')
    require(marker['loadPlan']['sha256'] == receipt['planSHA256'], 'original runtime plan binding differs')
    report = held.inspect(raw, digest(raw), pair['controllerCommit'], expected['configurationSHA256'])
    require(report['source'] == declaration['source'] and report['tools'] == declaration['tools']
            and report['status'] == 'OBSERVED' and report['fullCohort'] is not None,
            'original business arm receipt required; readiness is not a business arm')
    owners = plan['accounts']
    require(plan['configuredDemand'] == 500 and len(owners) == 500 and len(plan['rows']) == 500
            and {a['ownerIndex'] for a in owners} == set(range(4, 504))
            and all(type(a['address']) is str and 0 < len(a['address']) <= 256
                    and type(a['nextNonce']) is int and 0 < a['nextNonce'] < 1 << 64
                    and type(a['capacity']) is int and a['capacity'] == 1 for a in owners),
            'original full500 independent account plan required')
    addresses = {a['address'] for a in owners}
    require(len(addresses) == 500, 'duplicate original account address')
    load = receipt['loadResult']
    require(len(load['rows']) == 500 and load['configuredDemand'] == 500
            and [(r['index'], r['id'], r['logicalArrivalOffsetNs']) for r in load['rows']]
            == [(r['index'], r['id'], r['logicalArrivalOffsetNs']) for r in plan['rows']],
            'original full500 rows differ from pinned plan')
    operations = [pin(r['operationId']) for r in load['rows'] if r['operationId'] is not None]
    require(len(set(operations)) == len(operations), 'original operation reused within arm')
    admission = strict(files[prefix + 'fresh-resource-admission.json'])
    hardware = strict(files[prefix + 'runtime-hardware.json'])
    require(admission == receipt['freshResourceAdmission'] and hardware == receipt['runtimeHardware']
            and admission['caps'] == receipt['caps'] and not admission['conflictingHeavyProcesses'],
            'original resource or hardware copies differ')
    require(type(load['originMonotonicNs']) is str and re.fullmatch('[1-9][0-9]{0,19}', load['originMonotonicNs']),
            'original monotonic load origin required')
    origin_ns = int(load['originMonotonicNs'])
    require(type(load['observationCutoffNs']) is int and load['observationCutoffNs'] >= 0
            and start <= positive(admission['observedMonotonicNs']) <= origin_ns
            and origin_ns + load['observationCutoffNs'] <= end,
            'original load/admission outside arm boundaries')
    processes = clean_processes(receipt)
    heights = {int(r['height']) for r in report['originalFourNodeInclusion']['records']}
    commits = {str(r['node']): r['originalSnapshot'] for r in report['originalCommitCopies']['records']
               if r['producerReportedUsable']}
    report['businessStageCostsByNode'] = {str(i): costs.business_stage_costs(commits.get(str(i)),
        report['finalizeByNode'].get(str(i), {}).get('original'), heights) for i in range(4)}
    report.update(pairArm=label, originalMarker=marker, originalLoadResult=load,
                  receiptSHA256=marker['receipt']['sha256'], sameRunnerArtifactOriginBound=True)
    config = strict(files[plans[0]])['configuration']
    comparable_config = {k: v for k, v in config.items() if k not in ('source', 'sourceTree', 'tools', 'toolsTree')}
    return dict(report=report, start=start, end=end, addresses=addresses, processes=processes,
                workDirectoryName=marker['workDirectoryName'],
                operationIDs=set(operations),
                plan=plan, config=comparable_config,
                accountShape=sorted((a['ownerIndex'], a['nextNonce'], a['capacity']) for a in owners))


def inspect(manifest_raw, before_raw, after_raw, *, metadata, controller, manifest_sha256, expected):
    """Read original ZIP bytes only. No altered run IDs or fabricated legacy legs."""
    require(digest(manifest_raw) == pin(manifest_sha256), 'externally pinned manifest archive differs')
    fields(expected, 'before after', 'expected pair')
    bound = origin(*metadata, controller, dict(manifest=manifest_raw, before=before_raw, after=after_raw))
    files, _, _ = held.prior.original.public_archive(manifest_raw, manifest_sha256, entry_limit=1)
    require(set(files) == {'same-runner-pair.json'}, 'one original pair manifest required')
    pair = strict(files['same-runner-pair.json'])
    fields(pair, 'schema pairID controllerCommit runID jobID runAttempt runnerID runnerName clock arms', 'pair manifest')
    require(pair['schema'] == SCHEMA and all(pair[k] == bound[k] for k in
            ('controllerCommit', 'runID', 'jobID', 'runAttempt', 'runnerID', 'runnerName')),
            'original pair manifest origin differs')
    for key in ('runID', 'jobID', 'runAttempt', 'runnerID'):
        positive(pair[key])
    pin(pair['pairID'])
    fields(pair['clock'], 'kind bootIDSHA256 coordinatorPID coordinatorStartTicks', 'pair clock')
    require(pair['clock']['kind'] == 'CLOCK_MONOTONIC', 'one original monotonic clock required')
    pin(pair['clock']['bootIDSHA256'])
    positive(pair['clock']['coordinatorPID']); positive(pair['clock']['coordinatorStartTicks'])
    require(type(pair['arms']) is list and len(pair['arms']) == 2, 'two complete original arms required')
    arms = [arm_read(raw, label, declaration, pair, expected[label])
            for label, raw, declaration in zip(ARMS, (before_raw, after_raw), pair['arms'])]
    left, right = arms
    require(left['end'] < right['start'], 'second arm began before first cleanup completed')
    require(left['workDirectoryName'] != right['workDirectoryName'], 'original owned directory reused across arms')
    require(not left['addresses'] & right['addresses'], 'original accounts reused across arms')
    require(not left['operationIDs'] & right['operationIDs'], 'original operation reused across arms; retain UNKNOWN')
    require(not left['processes'] & right['processes'], 'original process lifetime reused across arms')
    for key in ('networkPlanSHA256', 'workloadSHA256'):
        require(pin(left['plan'][key]) != pin(right['plan'][key]), 'independent original ' + key + ' required')
    differences = []
    for key in ('config', 'accountShape'):
        if left[key] != right[key]: differences.append(key)
    for key in ('toolchain', 'conditions', 'caps'):
        if left['report'].get(key) is None or left['report'].get(key) != right['report'].get(key):
            differences.append(key)
    a, b = (v['report']['hardware'] for v in arms)
    hardware_differences = [k for k in ('system', 'machine', 'cpuModels', 'kernelRelease',
                                       'effectiveAffinity', 'hostMemTotalBytes')
                            if a.get(k) is None or a.get(k) != b.get(k)]
    for key in ('type', 'fragmentBytes'):
        x, y = ((v.get('filesystem') or {}).get(key) for v in (a, b))
        if x is None or x != y: hardware_differences.append('filesystem.' + key)
    if a.get('status') != 'OBSERVED' or b.get('status') != 'OBSERVED': hardware_differences.append('status')
    return copy.deepcopy(dict(schema=SCHEMA, status='PAIRED_ORIGINALS_BOUND', actionsOrigin=bound,
        manifestArchiveSHA256=manifest_sha256, pairID=pair['pairID'], clock=pair['clock'],
        before=left['report'], after=right['report'], configuredDemandPerArm=500,
        sequentialCleanupGapNs=right['start']-left['end'], distinctOriginalAccountsPerArm=500,
        sameActionsJobAndRunnerBound=True, controllerReportedSameBoot=True,
        configurationDifferences=differences, hardwareDifferences=hardware_differences,
        sameReportedConditions=not differences and not hardware_differences,
        originalMetadataCallerSupplied=True, originalsModified=False, unknownReplayed=False,
        independentFinality=False, identicalPhysicalHostProven=False, canonicalInputEqualityProven=False,
        throughputGainAttributed=False, sustainedTPSQualified=False, pressureAuthorized=False,
        meaning='Bound original artifact DATA, not a runtime grant. Each arm keeps its original500 cohort, '
                'first cause, UNKNOWN rows and node/storage samples. Arm clocks establish reported order only; '
                'no stage pooling, missing-time zero fill, cache/I/O equality or business success inference.'))


def bounded(path, limit):
    with Path(path).open('rb') as stream:
        raw = stream.read(limit + 1)
    require(0 < len(raw) <= limit, 'local original exceeds input bound')
    return raw


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for key in ('manifest', 'manifest-sha256', 'controller', 'actions-metadata'):
        parser.add_argument('--' + key, required=True)
    for arm in ARMS:
        for key in ('archive', 'source', 'tools', 'configuration-sha256'):
            parser.add_argument('--' + arm + '-' + key, required=True)
    args = parser.parse_args(argv)
    expected = {arm: dict(source=getattr(args, arm + '_source'), tools=getattr(args, arm + '_tools'),
        configurationSHA256=getattr(args, arm + '_configuration_sha256')) for arm in ARMS}
    metadata = [strict(bounded(Path(args.actions_metadata) / name, 1 << 20))
                for name in ('RUN.json', 'JOB.json', 'ARTIFACTS.json')]
    return inspect(bounded(args.manifest, 1 << 20), bounded(args.before_archive, 128 << 20),
        bounded(args.after_archive, 128 << 20), metadata=metadata, controller=args.controller,
        manifest_sha256=args.manifest_sha256, expected=expected)


if __name__ == '__main__':
    print(json.dumps(main(), indent=2, sort_keys=True))
