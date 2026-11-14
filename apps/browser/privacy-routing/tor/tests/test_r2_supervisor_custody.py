#!/usr/bin/env python3
"""Exercise the R2 Python owner with harmless subprocesses and synthetic timings."""

import argparse
from contextlib import nullcontext, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from unittest.mock import patch

import run_r2_adjacent_cli as supervisor


HELPER = '''
import os,signal,subprocess,sys,time
from pathlib import Path
out=Path(sys.argv[1])
def cancel(number,frame):
    (out/'cancel-observed').touch()
signal.signal(signal.SIGINT,cancel)
if sys.argv[2]=='separate-group':
    child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(1.1)'],process_group=0)
    (out/'child.pid').write_text(str(child.pid))
(out/'ready').touch()
time.sleep(0.9)
(out/'natural-exit').touch()
'''


def run_case(out, kind):
    out.mkdir(mode=0o700)
    helper = out/'local_helper.py'
    helper.write_text(HELPER)
    executable = Path(sys.executable).resolve()
    fixture_argv = [str(executable), str(helper), str(out), kind]
    target = out/'NETWORK-SUPERVISOR.json'
    real_spawn = subprocess.Popen
    real_open = Path.open
    owned = []

    def spawn(argv, *args, **kwargs):
        process = real_spawn(argv, *args, **kwargs)
        if argv == fixture_argv:
            owned.append(process)
            start = time.monotonic()
            while not (out/'ready').exists() and time.monotonic()-start < 2 and process.poll() is None:
                time.sleep(.01)
            if not (out/'ready').exists():
                raise RuntimeError('local fixture did not start')
        return process

    def write_failure(path, mode='r', *args, **kwargs):
        if (path == target and mode == 'w') or (path == target.with_suffix('.json.tmp') and mode == 'x'):
            raise OSError('injected supervisor journal failure')
        return real_open(path, mode, *args, **kwargs)

    observed_error = None
    captured = io.StringIO()
    try:
        with patch.object(supervisor.subprocess, 'Popen', spawn), redirect_stdout(captured):
            context = patch.object(Path, 'open', write_failure) if kind == 'journal-failure' else nullcontext()
            with context:
                code = supervisor.supervise(out, fixture_argv)
    except Exception as error:
        code, observed_error = None, type(error).__name__
    alive_after_return = bool(owned and owned[0].poll() is None)
    reaper = 'supervisor' if owned and not alive_after_return else 'fixture safety net'
    for process in owned:
        try:
            process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.communicate(timeout=2)
    (out/'supervisor.stdout').write_text(captured.getvalue())
    records = [json.loads(line) for line in target.read_text().splitlines() if line] if target.is_file() else []
    late = out/'LATE-CLEANUP.json'
    child_pid = out/'child.pid'
    return {'result': code, 'error': observed_error, 'pid': owned[0].pid if owned else None,
            'originalWait': owned[0].returncode if owned else None, 'childAliveAfterReturn': alive_after_return,
            'reaper': reaper, 'cancelObserved': (out/'cancel-observed').exists(),
            'records': records, 'late': json.loads(late.read_text()) if late.is_file() else None,
            'descendantPID': int(child_pid.read_text()) if child_pid.is_file() else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    original = Path(supervisor.__file__).read_bytes()
    (args.output/'run_r2_adjacent_cli.py').write_bytes(original)
    error = run_case(args.output/'journal-failure', 'journal-failure')
    passed = (error['result'] == 1 and error['error'] is None and error['originalWait'] == 0
              and not error['childAliveAfterReturn'] and error['reaper'] == 'supervisor' and error['cancelObserved'])
    with patch.object(supervisor, 'WORK_SECONDS', .1), patch.object(supervisor, 'CLEANUP_SECONDS', .1):
        timeout = run_case(args.output/'separate-group', 'separate-group')
    cases = {'journalFailure': error, 'timeoutWithSeparateProcessGroup': timeout}
    passed = (passed and timeout['result'] == 2 and timeout['cancelObserved'] and timeout['originalWait'] == 0
              and timeout['descendantPID'] is not None and timeout['reaper'] == 'supervisor'
              and not timeout['childAliveAfterReturn'] and timeout['records'][-1]['status'] == 'OWNER_CLEANUP_UNKNOWN_RETAINED'
              and timeout['late']['originalOutcomeRemainsUNKNOWN'] is True
              and timeout['late']['ownSessionAbsenceObserved'] is True)
    passed = passed and Path(supervisor.__file__).read_bytes() == original
    result = {'status': 'PASS' if passed else 'FAIL', 'cases': cases,
              'sourceSHA256': hashlib.sha256(original).hexdigest(), 'vendor': 'NOT_RUN', 'network': 'NOT_RUN'}
    (args.output/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
