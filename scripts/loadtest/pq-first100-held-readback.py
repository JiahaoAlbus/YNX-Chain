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
require, strict = prior.require, prior.strict


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
        report['fullCohort'] = stages.business(load)
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
                require(result['transactionHash'].lower() == row['hash']
                        and result['nativeWireHash'].lower() == row['nativeHash']
                        and result['included'] is True and result['finalized'] is True
                        and result['executionSuccessful'] is True and str(result['executionCode']) == '0'
                        and result['nativeGrant'] is False, 'original proof execution or dual identity differs')
    return dict(report, status='OBSERVED' if load is not None else 'LOAD_RESULT_MISSING',
                source=source, tools=tools, runtimePlanSHA256=runtime_pin, firstCause=receipt.get('firstCause'),
                cleanupComplete=receipt.get('cleanupComplete'), hardware=receipt.get('runtimeHardware'),
                peakRSSBytes=receipt.get('peakRSSBytes'), peakRSSSample=receipt.get('peakRSSSample'),
                peakNewBytes=receipt.get('peakNewBytes'), originalFourNodeInclusion=observed,
                originalCommitCopies=commits, commitStages=stages.commit_stages(dict(originalCommitCopies=commits)),
                businessBlockCommitStages=prior.business_commit_stages(dict(originalCommitCopies=commits), observed, stages),
                originalCalleeMeasurements=receipt.get('normalCalleeMeasurements'),
                originalInitializationStages=receipt.get('initializationStages'),
                originalResourceGuardStageElapsed=receipt.get('resourceGuardStageElapsed'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(allow_abbrev=False, description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    for argument in ('archive-sha256', 'controller', 'configuration-sha256'):
        parser.add_argument('--' + argument, required=True)
    args = parser.parse_args()
    with args.archive.open('rb') as archive:
        result = inspect(archive.read((128 << 20) + 1), args.archive_sha256,
                         args.controller, args.configuration_sha256)
    print(json.dumps(result, indent=2, sort_keys=True))
