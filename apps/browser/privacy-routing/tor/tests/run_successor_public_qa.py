#!/usr/bin/env python3
"""One explicitly dispatched PUBLIC backend QA. Local scope DATA is not authority.

Preparation and this supervisor cannot supply production/Root/NE qualification.
No backend is started by importing this module or by its offline tests.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time
from prepare_successor_public_qa import HELPER_SHA256, FIXED_TARGETS, check_helper, validate_metadata

CLI_SHA256 = '09ac697ffa1beec68f5b2323fe92e2e7adb95f2e030a0fc1aa4c36fab399bfde'
SOURCE_SHA = '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407'
FROZEN_SOURCE_SHA = '5f3954996d0b8ca00a3e1c456618cac8f775eb333915ea25cc831e4ae3c1f06b'
SCOPE_FIELDS = {'schema', 'runID', 'attempts', 'normalPrivacyAdmission', 'ReleaseApproved',
                'helperSHA256', 'sourceInputsSHA256', 'planSHA256', 'goScopeSHA256',
                'profile', 'fixedTargets', 'fixedMethod', 'deadlineUnixNano',
                'maxTotalSeconds', 'maxBootstrapSeconds', 'maxHTTPSSeconds',
                'maxRSSBytes', 'maxPhysicalBytes'}

class Rejected(ValueError):
    pass

def require(condition, label):
    if not condition:
        raise Rejected(label)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'duplicate-json-key')
        value[key] = item
    return value

def owned_bytes(path, limit=1048576):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o022 == 0,
            'unsafe-input-file')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        require((info.st_dev, info.st_ino) == (before.st_dev, before.st_ino), 'input-identity-changed')
        raw = os.read(fd, limit + 1)
        after = os.fstat(fd)
        require(len(raw) <= limit and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'input-mutated-or-oversize')
        return raw
    finally:
        os.close(fd)

def load(path, limit=1048576):
    raw = owned_bytes(path, limit)
    value = json.loads(raw, object_pairs_hook=unique,
                       parse_constant=lambda _: (_ for _ in ()).throw(Rejected('nonfinite-json')))
    require(type(value) is dict, 'json-object-required')
    return value, raw

def validate_scope(scope, plan, seal, go_scope, plan_hash, go_hash, now_ns):
    require(set(scope) == SCOPE_FIELDS, 'runtime-scope-fields')
    require(scope['schema'] == 'P05_SUCCESSOR_RUNTIME_EXECUTION_SCOPE_V1', 'runtime-scope-schema')
    require(type(scope['attempts']) is int and scope['attempts'] == 1, 'exact-one-attempt')
    require(scope['normalPrivacyAdmission'] is False and scope['ReleaseApproved'] is False,
            'not-a-production-scope')
    require(scope['helperSHA256'] == HELPER_SHA256 and scope['sourceInputsSHA256'] == FROZEN_SOURCE_SHA,
            'scope-helper-source-binding')
    require(scope['planSHA256'] == plan_hash == seal.get('planSHA256') and
            scope['goScopeSHA256'] == go_hash == seal.get('scopeSHA256'), 'scope-plan-binding')
    run_id = scope['runID']
    require(type(run_id) is str and re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', run_id)
            and run_id == plan.get('runID') == go_scope.get('runID') == seal.get('runID'), 'scope-run-binding')
    require(scope['profile'] == plan.get('profile') == seal.get('profile'), 'scope-profile-binding')
    require(scope['fixedTargets'] == FIXED_TARGETS == plan.get('fixedTargets') == seal.get('fixedTargets')
            and scope['fixedMethod'] == 'GET' == plan.get('fixedMethod') == seal.get('fixedMethod'), 'scope-target-binding')
    require(seal.get('helperSHA256') == HELPER_SHA256 and seal.get('notAnAuthority') is True, 'scope-seal-binding')
    caps = {'maxTotalSeconds': 650, 'maxBootstrapSeconds': 600, 'maxHTTPSSeconds': 20,
            'maxRSSBytes': 1024**3, 'maxPhysicalBytes': 256*1024**2}
    for key, value in caps.items():
        require(type(scope[key]) is int and scope[key] == value, 'scope-budget-binding')
    deadlines = [scope['deadlineUnixNano'], go_scope.get('planDeadlineUnixNano'), go_scope.get('mappingExpiresUnixNano')]
    require(all(type(n) is int and n > now_ns + 49_000_000_000 for n in deadlines), 'expired-scope')
    require(scope['deadlineUnixNano'] <= min(deadlines[1:]) and
            scope['deadlineUnixNano'] <= now_ns + 650_000_000_000, 'scope-deadline-binding')

def validated_argv(out, prep):
    executable = out/'SuccessorQA.app/Contents/MacOS/SuccessorQA'
    argv = [str(executable), '--run-prepared', str(out)]
    require(prep.get('runCommand') == argv, 'fixed-argv-mismatch')
    pins = prep.get('sourceAndSupplyPins')
    require(type(pins) is dict and 1 <= len(pins) <= 512 and str(executable) in pins,
            'missing-compiled-executable-pin')
    require(pins[str(executable)] == CLI_SHA256, 'exact-compiled-cli-pin')
    for name, expected in pins.items():
        require(type(name) is str and type(expected) is str and re.fullmatch('[0-9a-f]{64}', expected), 'malformed-pin')
        require(digest(owned_bytes(name, 128*1024**2)) == expected, 'source-or-artifact-pin-drift')
    return argv

def observation_root(profile, plan):
    scratch = Path(profile).parent.parent
    require(plan.get('scratch') == str(scratch) and scratch.resolve(strict=True) == scratch, 'scratch-path-binding')
    info = scratch.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            'unsafe-scratch-root')
    require(type(plan.get('scratchDevice')) is int and type(plan.get('scratchInode')) is int and
            plan['scratchDevice'] == info.st_dev and plan['scratchInode'] == info.st_ino, 'scratch-identity-binding')
    return scratch  # Includes the trace at scratch/public-runtime.jsonl, not only Tor/cache/state.

def preflight(out):
    out = Path(out).resolve(strict=True)
    prep, _ = load(out/'PREPARATION.json')
    plan, plan_raw = load(out/'CLI-PLAN.json')
    seal, _ = load(out/'SCOPE-SEALED.json')
    scope, scope_raw = load(out/'scope.json', 65536)
    require(prep.get('status') == 'PROFILE_PREPARED_SCOPE_REQUIRED', 'not-prepared')
    validate_metadata(plan, time.time())
    argv = validated_argv(out, prep)
    pins = prep["sourceAndSupplyPins"]
    profile = Path(plan['profile'])
    require(profile.resolve(strict=True) == profile, 'profile-alias')
    profile_info = profile.lstat()
    require(stat.S_ISDIR(profile_info.st_mode) and profile_info.st_uid == os.getuid() and
            stat.S_IMODE(profile_info.st_mode) == 0o700, 'unsafe-profile')
    profile_text = owned_bytes(out/'CLI-PROFILE-PATH.txt', 8192).decode().strip()
    require(profile_text == str(profile), 'profile-text-binding')
    helper = Path(owned_bytes(out/'SUCCESSOR-HELPER-PATH.txt', 8192).decode().strip())
    check_helper(helper)
    require(str(helper) in pins and pins[str(helper)] == HELPER_SHA256, 'helper-pin-binding')
    go_scope, go_raw = load(profile/'.ynx-public-entry-qa-scope.json', 65536)
    require(go_scope.get('reviewedSourceSHA256') == SOURCE_SHA and
            go_scope.get('profileDevice') == profile_info.st_dev and
            go_scope.get('profileInode') == profile_info.st_ino, 'actual-go-scope-profile-binding')
    validate_scope(scope, plan, seal, go_scope, digest(plan_raw), digest(go_raw), time.time_ns())
    require(not (out/'RUN-ONCE').exists(), 'attempt-already-used')
    return out, argv, observation_root(profile, plan), scope, digest(scope_raw)

def group_members(pgid):
    # Metadata only. No argv, IP/socket, user profile, packet or credential read.
    result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,sess=,rss='],
                            capture_output=True, text=True, timeout=2)
    require(result.returncode == 0, 'process-observation-failed')
    values = []
    for line in result.stdout.splitlines():
        words = line.split()
        if len(words) == 5 and words[0].isdigit() and words[2].isdigit() and int(words[2]) == pgid:
            # macOS sess is an opaque kernel session pointer, not a numeric SID.
            values.append({'pid': int(words[0]), 'ppid': int(words[1]), 'rssBytes': int(words[4])*1024})
    return values

def physical(roots):
    return sum(p.stat().st_blocks*512 for root in roots for p in root.rglob('*') if p.is_file())

def persist_record(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')

def supervise(out, argv, profile, scope, scope_hash):
    # Exclusive receipt is established BEFORE spawn; never trusts a mutable argv.
    receipt_path = out/'NETWORK-SUPERVISOR.json'
    fd = os.open(receipt_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC, 0o600)
    os.close(fd)
    record = {'schema': 'P05_SUCCESSOR_SUPERVISOR_V2', 'status': 'STARTING',
              'scopeSHA256': scope_hash, 'firstCause': None, 'PTReaped': 'NOT_A_DIRECT_CHILD',
              'normalPrivacyAdmission': 'UNCHANGED_BLOCKED', 'groupCleanupConfirmed': False}
    def save():
        try:
            persist_record(receipt_path, record)
            return True
        except Exception as error:
            record['firstCause'] = record['firstCause'] or 'journal-error'
            record['journalErrorType'] = type(error).__name__
            return False  # Never skip exact cancellation/wait/custody because the journal failed.

    child = None
    members = []
    observation_known = False
    start = time.monotonic()
    deadline = start + min(650, (scope['deadlineUnixNano']-time.time_ns())/1e9)
    cancel_requested = False
    external_stop = False
    def request_signal(_number, _frame):
        nonlocal external_stop
        external_stop = True
    old_handlers = {n: signal.signal(n, request_signal) for n in [signal.SIGINT, signal.SIGTERM]}
    try:
        baseline = physical([out, profile])
        with (out/'network-cli.stdout').open('xb') as stdout, (out/'network-cli.stderr').open('xb') as stderr:
            child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            record.update(status='RUNNING', originalPID=child.pid, PGID=os.getpgid(child.pid), session=os.getsid(child.pid))
            require(record['PGID'] == child.pid and record['session'] == child.pid, 'owned-session-not-created')
            save()
            while True:
                try:
                    members = group_members(child.pid)
                    observation_known = True
                    rss = sum(p['rssBytes'] for p in members)
                    record['peakOwnedGroupRSSBytes'] = max(record.get('peakOwnedGroupRSSBytes', 0), rss)
                    if rss > scope['maxRSSBytes']:
                        record['firstCause'] = record['firstCause'] or 'resource-budget'
                except Exception as error:
                    observation_known = False
                    record['firstCause'] = record['firstCause'] or 'observation-error'
                    record['observationErrorType'] = type(error).__name__
                try:
                    growth = max(0, physical([out, profile])-baseline)
                    record['peakNewPhysicalBytes'] = max(record.get('peakNewPhysicalBytes', 0), growth)
                    if growth > scope['maxPhysicalBytes']:
                        record['firstCause'] = record['firstCause'] or 'resource-budget'
                except Exception as error:
                    record['firstCause'] = record['firstCause'] or 'physical-observation-error'
                    record['physicalObservationErrorType'] = type(error).__name__
                exited = child.poll() is not None
                if exited and observation_known and not members:
                    break
                if external_stop or time.monotonic() >= deadline-25:
                    record['firstCause'] = record['firstCause'] or ('caller-cancelled' if external_stop else 'cleanup-reserve-deadline')
                if record['firstCause'] and not cancel_requested:
                    cancel_requested = True
                    record['cancelRequestedSeconds'] = time.monotonic()-start
                    if not exited:
                        child.send_signal(signal.SIGINT)  # exact original owned CLI, not unknown PT/root
                if time.monotonic() >= deadline:
                    record['status'] = 'CLEANUP_UNKNOWN_OWNER_HELD'
                    record['effectState'] = 'UNKNOWN; experiment ended, original supervisor retains custody'
                    break
                record['elapsedSeconds'] = time.monotonic()-start
                save()
                time.sleep(.2)
    except Exception as error:
        record['firstCause'] = record['firstCause'] or 'supervisor-error'
        record['errorType'] = type(error).__name__
    finally:
        # Exceptions cannot silently abandon the original child. Only the exact CLI
        # receives cancellation; its existing lifecycle owns Arti/curl shutdown.
        if child is not None:
            if child.poll() is None:
                try: child.send_signal(signal.SIGINT)
                except ProcessLookupError: pass
            cleanup_end = min(deadline, time.monotonic()+25)
            while time.monotonic() < cleanup_end:
                try: members = group_members(child.pid); observation_known = True
                except Exception: observation_known = False
                if child.poll() is not None and observation_known and not members: break
                time.sleep(.1)
            if child.poll() is not None:
                child.wait()
                record.update(originalWait=child.returncode, originalCLIReaped=True)
            record['groupCleanupConfirmed'] = child.poll() is not None and observation_known and not members
            record['ownedRemainingPIDs'] = [p['pid'] for p in members] if observation_known else 'UNKNOWN'
        else:
            record.update(originalCLIReaped=False, groupCleanupConfirmed=True, backendSpawned=False)
        record['elapsedSeconds'] = time.monotonic()-start
        record['status'] = 'EXIT_OBSERVED' if record['groupCleanupConfirmed'] else 'CLEANUP_UNKNOWN_OWNER_HELD'
        save()
    def restore_handlers():
        for number, handler in old_handlers.items():
            try: signal.signal(number, handler)
            except Exception as error: record['signalRestoreErrorType'] = type(error).__name__

    # A bounded experiment can end UNKNOWN; this process must not claim retention
    # and then exit. Continue only cleanup observations, never retry or start work.
    if child is not None and not record['groupCleanupConfirmed']:
        while True:
            try:
                members = group_members(child.pid)
                if child.poll() is not None and not members: break
            except Exception: pass
            time.sleep(.5)
        child.wait()
        try:
            persist_record(out/'LATE-CLEANUP.json', {'originalOutcome': 'UNKNOWN', 'originalWait': child.returncode,
                           'groupAbsenceObserved': True, 'PTWaitpid': 'NOT_A_DIRECT_CHILD'})
        except Exception: pass  # Custody is already complete; original UNKNOWN is never rewritten.
        restore_handlers()
        return 2
    restore_handlers()
    return 0 if child is not None and child.returncode == 0 and record['firstCause'] is None else 1

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prepared', type=Path)
    args = parser.parse_args()
    try:
        values = preflight(args.prepared)
    except Exception as error:
        print(json.dumps({'status': 'REJECTED_BEFORE_SPAWN', 'errorType': type(error).__name__, 'network': 'NOT_RUN'}))
        return 2
    return supervise(*values)

if __name__ == '__main__':
    raise SystemExit(main())
