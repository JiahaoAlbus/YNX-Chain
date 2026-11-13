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
require, strict = prior.require, prior.strict


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
                                    backlogGrowing=load['backlogGrowing'], queueSamples=load['queueSamples'])
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
        pool = receipt['senderPoolPreparation']
        require(configuration['options']['held_ready_only'] is True and receipt['loadExecuted'] is False
                and load is None and receipt['preparationOnlyDemandAccounting']['notReleased'] == 500
                and [lane['node'] for lane in pool['liveMaterialsPreparation']] == list(range(4)),
                'original READY-only boundary differs')
    finalize_by_node = {}
    finalize_records = {ref['node']: ref for ref in receipt.get('normalFinalizeObservation', {}).get('records', [])}
    for record in commits['records']:
        if not record['producerReportedUsable']:
            continue
        node = record['node']
        path = f'finalize-observation-node-{node}-original.json'
        if prefix + path not in files:
            continue
        if finalize_records:
            ref = finalize_records[node]
            require(ref['path'] == path and ref['pid'] == record['pid']
                    and all(ref[key] == manifest[prefix+path][key] for key in ('bytes', 'sha256')),
                    'Finalize observation receipt pin differs')
        commit = record['originalSnapshot']
        original = finalize.validate(read(path), pid=commit['processID'], chain_id=commit['chainID'],
                                     genesis_hash=commit['originalGenesisHash'])
        heights = {int(row['height']) for row in observed['records']}
        business_finalize = finalize.business_heights(original, heights, commit['samples'])
        completed = [sample for sample in original['samples'] if sample['success']]
        finalize_by_node[str(node)] = dict(
            path=path, sha256=manifest[prefix+path]['sha256'], original=original, business=business_finalize,
            retainedSuccessStages={stage: stages.samples(
                [sample['childrenNs'].get(stage) for sample in completed], len(completed))
                for stage in sorted(finalize.CHILDREN)},
            retainedSuccessElapsed=stages.samples([sample['elapsedNs'] for sample in completed], len(completed)))
    status = 'READY_ONLY_OBSERVED' if ready else 'OBSERVED' if load is not None else 'LOAD_RESULT_MISSING'
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
                finalizeByNode=finalize_by_node, originalCommitCopies=commits, commitStages=stages.commit_stages(dict(originalCommitCopies=commits)),
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
    args = parser.parse_args()
    with args.archive.open('rb') as archive:
        result = inspect(archive.read((128 << 20) + 1), args.archive_sha256,
                         args.controller, args.configuration_sha256)
    if args.before_readback is not None:
        with args.before_readback.open('rb') as baseline:
            original = baseline.read((32 << 20) + 1)
        require(len(original) <= 32 << 20, 'original before readback exceeds bound')
        result['readinessComparison'] = compare_readiness(strict(original), result)
    print(json.dumps(result, indent=2, sort_keys=True))
