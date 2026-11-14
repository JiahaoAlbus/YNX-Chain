#!/usr/bin/env python3
"""Test actual subprocess ordering without launching or signing a real QA app."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import prepare_successor_public_qa as producer


RAW = b'compiled fixture'
SEALED = b'sealed fixture'
SEAL = b'resource seal fixture'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def case(output, variant):
    output.mkdir()
    bundle = output / 'SuccessorQA.app'
    executable = bundle / 'Contents/MacOS/SuccessorQA'
    resource_seal = bundle / 'Contents/_CodeSignature/CodeResources'
    executable.parent.mkdir(parents=True)
    trace = output / 'STAGE-TRACE.txt'
    fixture = r"""
from pathlib import Path
import sys
import time
name, variant, exe, seal, trace = sys.argv[1:]
exe, seal, trace = map(Path, (exe, seal, trace))
with trace.open('a') as log:
    print(name, file=log)
if name == 'compile-fixed-cli':
    exe.write_bytes(b'compiled fixture')
elif name == 'seal-cli-bundle':
    assert exe.read_bytes() == b'compiled fixture'
    if variant == 'sign-refused':
        sys.exit(23)
    exe.write_bytes(b'sealed fixture')
    if variant != 'missing-seal':
        seal.parent.mkdir()
        seal.write_bytes(b'resource seal fixture')
elif name == 'verify-cli-bundle':
    assert exe.read_bytes() == b'sealed fixture'
    if variant == 'verify-refused':
        sys.exit(24)
    if variant == 'verify-timeout':
        time.sleep(5)
elif name == 'offline-plan':
    assert exe.read_bytes() == b'sealed fixture'
    assert seal.read_bytes() == b'resource seal fixture'
    if variant == 'late-drift':
        exe.write_bytes(b'modified after verification')
elif name == 'offline-launch-controls':
    assert exe.read_bytes() == b'sealed fixture'
else:
    sys.exit(29)
"""
    actual_run_stage = producer.run_stage
    identity = dict(rawExecutableSHA256=None, sealedExecutableSHA256=None)
    events, pins = [], {}

    def substitute_command(out, recorded, name, argv, budget):
        if name == 'seal-cli-bundle':
            require(argv == ['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', str(bundle)],
                    'standard bundle signing command changed')
        elif name == 'verify-cli-bundle':
            require(argv == ['/usr/bin/codesign', '--verify', '--strict', '--verbose=2', str(bundle)],
                    'strict bundle verification command changed')
        elif name.startswith('offline-'):
            require(argv[0] == str(executable), 'unexpected executable')
            require(pins[str(executable)] == digest(SEALED) and pins[str(resource_seal)] == digest(SEAL),
                    'sealed executable and resource seal must be pinned before execution')
        command = [sys.executable, '-B', '-c', fixture, name, variant, str(executable), str(resource_seal), str(trace)]
        timeout = 0.3 if name == 'verify-cli-bundle' and variant == 'verify-timeout' else 4
        return actual_run_stage(out, recorded, name, command, timeout)

    offline = [('offline-plan', [str(executable), '--prepare-only', str(output)], 12),
               ('offline-launch-controls', [str(executable), '--offline-launch-controls', str(output)], 8)]
    with patch.object(producer, 'run_stage', substitute_command):
        failure = producer.prepare_sealed_cli(output, bundle, executable, ['fixture-compile'], offline, pins, events, identity)

    expected = {
        'pass': (None, 5, 0),
        'sign-refused': ('seal-cli-bundle failed', 2, 23),
        'verify-refused': ('verify-cli-bundle failed', 3, 24),
        'verify-timeout': ('verify-cli-bundle failed', 3, -15),
        'missing-seal': ('verified CLI bundle missing CodeResources', 3, 0),
        'late-drift': ('verified CLI executable or resource seal changed before offline-launch-controls', 4, 0),
    }
    reason, count, status = expected[variant]
    require(failure == reason and len(events) == count and events[-1]['returncode'] == status,
            f'{variant}: unexpected terminal status or stages')
    require(trace.read_text().splitlines() == [event['name'] for event in events]
            and all(event['pid'] > 0 and event['reaped'] for event in events),
            f'{variant}: incorrect execution order or wait custody')
    require(events[-1]['timeout'] is (variant == 'verify-timeout'), f'{variant}: timeout not preserved')
    require(identity['rawExecutableSHA256'] == digest(RAW), f'{variant}: raw executable pin lost')
    if variant in ('pass', 'late-drift'):
        require(identity['sealedExecutableSHA256'] == pins[str(executable)] == digest(SEALED),
                f'{variant}: seal pin lost or overwritten after execution')
    else:
        require(identity['sealedExecutableSHA256'] is None and str(executable) not in pins,
                f'{variant}: executable pinned despite failed seal admission')
    return dict(case=variant, failure=failure, identity=identity,
                processes=[{key: event[key] for key in ('name', 'pid', 'returncode', 'timeout', 'reaped')} for event in events])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    variants = ('pass', 'sign-refused', 'verify-refused', 'verify-timeout', 'missing-seal', 'late-drift')
    records = [case(args.output / variant, variant) for variant in variants]
    result = dict(status='PASS', records=records, actualInertSubprocesses=sum(len(r['processes']) for r in records),
                  realQAExecutable='NOT_RUN', network='NOT_RUN')
    (args.output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'{len(records)} CLI bundle seal controls passed ({result["actualInertSubprocesses"]} subprocesses reaped)')


if __name__ == '__main__':
    main()
