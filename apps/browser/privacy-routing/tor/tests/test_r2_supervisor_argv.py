#!/usr/bin/env python3
"""Reject mutable launch metadata before the R2 supervisor can spawn a process."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--legacy', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    runner = Path(__file__).with_name('run_r2_adjacent_cli.py')
    source = runner.read_bytes()
    (output/runner.name).write_bytes(source)
    events = []
    cases = ['alternate-command'] if args.legacy else [
        'alternate-command', 'missing-executable-pin', 'different-seal-pin', 'symlinked-executable', 'exact-command',
    ]
    for name in cases:
        case = output/name
        binary = case/'R2TorCLI.app/Contents/MacOS/R2TorCLI'
        binary.parent.mkdir(mode=0o700, parents=True)
        marker = case/'unexpected-launch'
        raw = b'#!/bin/sh\n[ "$1" = --run-prepared ] || exit 19\n: > "$2/unexpected-launch"\n'
        if name == 'symlinked-executable':
            other = case/'other'
            other.write_bytes(raw)
            other.chmod(0o700)
            binary.symlink_to(other)
        else:
            binary.write_bytes(raw)
            binary.chmod(0o700)
        digest = hashlib.sha256(raw).hexdigest()
        prep = dict(status='PREPARED_NO_NETWORK', sourceAndSupplyPins={str(binary): digest},
                    sealedExecutableSHA256=digest, runCommand=[str(binary), '--run-prepared', str(case)])
        if name == 'alternate-command':
            prep['runCommand'] = ['/usr/bin/touch', str(marker)]
        if name == 'missing-executable-pin':
            prep['sourceAndSupplyPins'] = {}
        if name == 'different-seal-pin':
            prep['sealedExecutableSHA256'] = '0'*64
        (case/'PREPARATION.json').write_text(json.dumps(prep))
        command = [sys.executable, '-B', str(runner), str(case)]
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            stdout, stderr = child.communicate(timeout=5)
            timed_out = False
        except subprocess.TimeoutExpired:
            child.kill()
            stdout, stderr = child.communicate(timeout=2)
            timed_out = True
        (case/'stdout').write_bytes(stdout)
        (case/'stderr').write_bytes(stderr)
        events.append(dict(case=name, command=command, pid=child.pid, originalWait=child.returncode,
                           reaped=child.poll() is not None, timedOut=timed_out, alternateExecutableRan=marker.exists(),
                           supervisorReceiptCreated=(case/'NETWORK-SUPERVISOR.json').exists()))
    passed = (all(e['originalWait'] == (0 if e['case'] == 'exact-command' else 2) and not e['timedOut']
                  and e['alternateExecutableRan'] == (e['case'] == 'exact-command')
                  and e['supervisorReceiptCreated'] == (e['case'] == 'exact-command') for e in events)
              and runner.read_bytes() == source)
    (output/'RESULT.json').write_text(json.dumps(dict(status='PASS' if passed else 'FAIL', events=events,
        sourceSHA256=hashlib.sha256(source).hexdigest(), platformAdmission='NOT_RUN', torBackend='NOT_RUN',
        network='NOT_RUN'), indent=2)+'\n')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
