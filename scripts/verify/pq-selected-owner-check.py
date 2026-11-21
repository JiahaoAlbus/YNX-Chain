#!/usr/bin/env python3
"""Exact source-only selected custody controls. No node or workload execution."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('state_capture_check', ROOT / 'scripts/verify/pq-state-capture-check.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)

GROUPS = {
    'internal/ynxbatch': [
        'TestDecodeSelectedFieldsMatchesOriginalAndDetaches',
        'TestDecodeSelectedFieldsPreservesAllFramingErrors',
        'TestDecodeSelectedFieldsRejectsInvalidSelectionWithoutCopies',
        'TestDecodeSelectedFieldsKeepsFullOwnerLimitAndCopyCost',
    ],
    'internal/consensus': [
        'TestPQLabSenderSelectedCustodyConcurrentRestartUnknown',
        'TestPQLabSenderSelectedCustodyCompleteFrameAndFirstCause',
        'TestPQLabPublicOwnerPrepareOwnerOpensOnlySelectedCustody',
        'TestPQLabOnlineSenderOriginalRecoveryAndFullProof',
    ],
}


def main():
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if source != os.environ['GITHUB_SHA'] or subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise RuntimeError('selected custody controls require the exact workflow source')
    output = Path(os.environ['RUNNER_TEMP']) / 'pq-selected-owner-controls'
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
            raise RuntimeError('original selected custody command failed')
        reports.append(original.validate(raw, package, names))
    result = {'sourceCommit': source, 'groups': reports, 'testsRun': sum(x['testsRun'] for x in reports),
              'skipped': 0, 'successful': True, 'normalNodeStarted': False, 'runtimeQualification': False,
              'syntheticControlsOnly': True, 'independentFinality': False}
    if result['testsRun'] != 8:
        raise RuntimeError('exact selected custody control count changed')
    with (output / 'RESULT.json').open('x') as stream:
        json.dump(result, stream, sort_keys=True); stream.write('\n')
    print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
