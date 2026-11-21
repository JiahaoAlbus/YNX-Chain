#!/usr/bin/env python3
"""Run exact original state-reader controls; no node, workload or authority."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
GROUPS = {
    'internal/consensus': [
        'TestPQStateCapturePreservesOriginalBytesAndIOErrors',
        'TestPQStateCaptureKnownSizeDoesNotReadPastGrowthSentinel',
        'TestPQStateCaptureLargeRejectedReadKeepsOriginalAllocationBound',
        'TestPQStateCaptureOriginalAtomicFileAndAuthority',
        'TestPQStateCaptureRemovesRepeatedBufferGrowth',
        'TestPQEngineStateReadActualLayoutsRegistryRotationRevocation',
        'TestPQEngineStateReadKeepsPinnedHistoricalRuntimeDomains',
        'TestPQEngineStateReadRejectsCorruptionAndIncompleteTailWithoutRepair',
        'TestPQEngineStateReadRejectsSourceChangeAfterCapture',
        'TestPQEngineFileSourceBindsActualHeightHashAndIndependentPin',
        'TestPQEngineCheckpointValidationOwnedReadAndColdAuthority',
        'TestPQEngineCheckpointValidationResealedLedgerAndCoordinates',
        'TestPQEngineCheckpointValidationOriginalReadbackAndClose',
        'TestPQEngineCheckpointValidationKeepsIndependentSchedulePin',
    ],
    'cmd/ynx-consensus-proof-verify': [
        'TestProofVerifierPreparedTrustPUBLICSameInvocationAndFirstCause',
        'TestProofVerifierMigrationStreamsCompleteOriginal',
    ],
}


def validate(raw, package, required):
    if len(raw) > 8 * 1024 * 1024:
        raise RuntimeError('original state reader test stream exceeds bound')
    rows = [json.loads(line) for line in raw.splitlines()]
    identity = 'github.com/JiahaoAlbus/YNX-Chain/' + package
    if any(row.get('Action') in ('skip', 'fail', 'build-fail') for row in rows):
        raise RuntimeError('state-reader test failed or skipped')
    if any(row.get('Package', identity) != identity for row in rows):
        raise RuntimeError('foreign package in original state-reader stream')
    package_actions = [row['Action'] for row in rows if not row.get('Test') and row.get('Action') in ('start', 'pass')]
    if package_actions != ['start', 'pass']:
        raise RuntimeError('original state-reader package did not execute exactly once')
    top = {row['Test'] for row in rows if row.get('Test') and '/' not in row['Test']}
    if top != set(required):
        raise RuntimeError('original named state-reader test set differs')
    for name in required:
        actions = [row['Action'] for row in rows if row.get('Test') == name and row.get('Action') in ('run', 'pass')]
        if actions != ['run', 'pass']:
            raise RuntimeError('original state-reader case missing or repeated: ' + name)
    return {'package': identity, 'passed': required, 'testsRun': len(required), 'skipped': 0,
            'originalJSONBytes': len(raw), 'originalJSONSHA256': hashlib.sha256(raw).hexdigest()}


def main():
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if source != os.environ['GITHUB_SHA'] or subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise RuntimeError('state-reader controls require the exact workflow source')
    output = Path(os.environ['RUNNER_TEMP']) / 'pq-state-capture-controls'
    output.mkdir()
    reports = []
    for package, names in GROUPS.items():
        log = output / (package.replace('/', '-') + '.jsonl')
        with log.open('xb') as stream:
            result = subprocess.run(['go', 'test', '-mod=readonly', '-json', '-p', '1', '-count=1',
                                     '-timeout=120s', '-run', '^(' + '|'.join(names) + ')$', './' + package],
                                    cwd=ROOT, stdout=stream)
        with log.open('rb') as stream:
            raw = stream.read(8 * 1024 * 1024 + 1)
        print(raw.decode(), end='', flush=True)
        if result.returncode:
            raise RuntimeError('original state-reader test command failed')
        reports.append(validate(raw, package, names))
    result = {'sourceCommit': source, 'groups': reports, 'testsRun': sum(x['testsRun'] for x in reports),
              'skipped': 0, 'successful': True, 'normalNodeStarted': False, 'runtimeQualification': False,
              'syntheticControlsOnly': True, 'independentFinality': False}
    with (output / 'RESULT.json').open('x') as stream:
        json.dump(result, stream, sort_keys=True); stream.write('\n')
    print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
