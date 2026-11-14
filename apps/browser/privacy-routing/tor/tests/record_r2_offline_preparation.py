#!/usr/bin/env python3
"""Bind an existing admitted R2 bundle to its completed offline plan without launching it."""

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import time


OUTPUT_NAME = 'ADMITTED-OFFLINE-PREPARATION.json'
STAGES = ('ENTERED', 'SUPPLY_VERIFIED', 'PROFILE_PREPARED', 'CONFIG_VALIDATED', 'PLAN_WRITTEN')


def require(condition, label):
    if not condition:
        raise ValueError(label)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path, limit):
    require(path.resolve(strict=True) == path, 'aliased receipt path')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC), 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and not before.st_mode & 0o022 and 0 < before.st_size <= limit, 'unsafe receipt file')
        raw = stream.read(limit+1)
        after = os.fstat(stream.fileno())
        require(len(raw) == before.st_size and (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'receipt changed while reading')
    return raw


def unique(pairs):
    data = {}
    for key, value in pairs:
        require(key not in data, 'duplicate receipt key')
        data[key] = value
    return data


def parse(raw):
    data = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(data, dict), 'receipt must be an object')
    return data


def make_receipt(out, assessment_path, offline_path):
    app = out/'R2TorCLI.app'
    executable = app/'Contents/MacOS/R2TorCLI'
    original = out/'PREPARATION.json'
    limits = 65536
    prep_raw, assessment_raw, offline_raw = [read(path, limits) for path in (original, assessment_path, offline_path)]
    prep, assessment, offline = map(parse, (prep_raw, assessment_raw, offline_raw))
    require(prep.get('status') == 'SEALED_OFFLINE_PREPARE_NOT_RUN' and prep.get('runCommand') is None
            and prep.get('offlinePrepareStages') == [] and prep.get('sourceDrift') == [], 'exact seal-only receipt required')
    pins = prep['sourceAndSupplyPins']
    sealed = prep['sealedExecutableSHA256']
    require(assessment.get('schema') == 'P05_ORIGINAL_PAIR_MACOS_EXECUTION_ASSESSMENT_V1'
            and assessment.get('argv') == ['/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=4', str(app)]
            and assessment.get('status') == 'ADMITTED' and type(assessment.get('originalWait')) is int
            and assessment['originalWait'] == 0 and assessment.get('reaped') is True
            and assessment.get('timeout') is False and assessment.get('qaExecutableStarted') is False
            and assessment.get('artifactSHA256') == sealed, 'exact positive macOS execute assessment required')
    artifacts = {str(path): sha(read(path, max_bytes)) for path, max_bytes in (
        (executable, 64*1024**2), (app/'Contents/Info.plist', limits), (app/'Contents/_CodeSignature/CodeResources', limits))}
    require(artifacts == assessment.get('artifactBefore') == assessment.get('artifactAfter')
            and all(pins.get(name) == digest for name, digest in artifacts.items())
            and artifacts[str(executable)] == sealed, 'assessment or bundle leaf pin mismatch')
    complete = datetime.fromisoformat(assessment['terminalUTC'])
    dispatch = datetime.fromisoformat(offline['dispatchUTC'])
    terminal = datetime.fromisoformat(offline['terminalObservedUTC'])
    require(complete.utcoffset() is not None and dispatch.utcoffset() is not None and terminal.utcoffset() is not None
            and complete <= dispatch <= terminal and 0 <= time.time()-terminal.timestamp() <= 1800,
            'offline preparation must follow admission and still be fresh')
    require(offline.get('name') == 'offline-plan' and offline.get('argv') == [str(executable), '--prepare-only', str(out)]
            and type(offline.get('returncode')) is int and offline['returncode'] == 0
            and type(offline.get('pid')) is int and offline['pid'] > 0
            and offline.get('reaped') is True and offline.get('timeout') is False, 'offline preparation did not finish')
    stdout_path, stderr_path = [offline_path.parent/f'offline-plan.{suffix}' for suffix in ('stdout', 'stderr')]
    stdout, stderr = [read(path, limits) for path in (stdout_path, stderr_path)]
    require(sha(stdout) == offline.get('stdoutSHA256') and sha(stderr) == offline.get('stderrSHA256'),
            'offline process log pin mismatch')
    expected_stages = [f'P05_R2_TOR_PREPARE_{stage}' for stage in STAGES]
    observed = [line for line in stderr.decode().splitlines() if line.startswith('P05_R2_TOR_PREPARE_')]
    require(observed == expected_stages, 'offline preparation stages incomplete or out of order')
    plan_path = out/'CLI-PLAN.json'
    plan_raw = read(plan_path, limits)
    plan = parse(plan_raw)
    require(plan == parse(stdout) and plan.get('schema') == 'P05_R2_TOR_ADJACENT_CLI_PLAN_V1'
            and type(plan.get('createdAt')) in (int, float) and dispatch.timestamp() <= plan['createdAt'] <= terminal.timestamp(),
            'prepared CLI plan differs from its offline process output')
    require(not os.path.lexists(out/'RUN-ONCE') and not os.path.lexists(out/'NETWORK-SUPERVISOR.json'), 'attempt already used')
    traces = {str(path): sha(raw) for path, raw in (
        (original, prep_raw), (assessment_path, assessment_raw), (offline_path, offline_raw),
        (stdout_path, stdout), (stderr_path, stderr), (plan_path, plan_raw))}
    return dict(prep, status='PREPARED_NO_NETWORK', sourceAndSupplyPins={**pins, **traces},
                offlinePrepareStages=list(STAGES), runCommand=[str(executable), '--run-prepared', str(out)],
                assessmentReceipt=str(assessment_path), offlineProcessReceipt=str(offline_path), networkLeg='NOT_RUN')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prepared', type=Path)
    parser.add_argument('--assessment', required=True, type=Path)
    parser.add_argument('--offline-process-receipt', required=True, type=Path)
    args = parser.parse_args()
    try:
        out = args.prepared.resolve(strict=True)
        result = make_receipt(out, args.assessment.absolute(), args.offline_process_receipt.absolute())
        destination = out/OUTPUT_NAME
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
        with os.fdopen(os.open(destination, flags, 0o600), 'w', encoding='utf8') as stream:
            json.dump(result, stream, indent=2)
            stream.write('\n')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(json.dumps(dict(status='REJECTED', reason=str(error), network='NOT_RUN')))
        return 2
    print(json.dumps(dict(status='PREPARED_NO_NETWORK', receipt=str(destination), network='NOT_RUN')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
