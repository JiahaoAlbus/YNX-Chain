#!/usr/bin/env python3
"""One prepared R2 CLI network leg. Invoke only after original owner schedules adjacency."""
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

from record_r2_offline_preparation import OUTPUT_NAME, make_receipt, parse, read


WORK_SECONDS = 720
CLEANUP_SECONDS = 35


def owned_session_members(session):
    # Foundation Process can create a distinct process group inside this session.
    # Observe it without signalling or claiming waitpid on managed PT descendants.
    rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,uid='], text=True, timeout=2)
    members = []
    for row in rows.splitlines():
        pid, uid = map(int, row.split())
        if uid != os.getuid():
            continue
        try:
            if os.getsid(pid) == session:
                members.append(pid)
        except ProcessLookupError:
            continue
    return members


def supervise(out, argv):
    target = out/'NETWORK-SUPERVISOR.json'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    os.close(fd)
    start = time.monotonic()
    record = dict(schema='P05_R2_TOR_NETWORK_SUPERVISOR_V2', argv=argv, startUnix=time.time(),
                  startMonotonic=start, budgetSeconds=WORK_SECONDS, cleanupBudgetSeconds=CLEANUP_SECONDS,
                  firstCause=None, status='STARTING',
                  experimentDifference='raw Process A has observational NWPath only; Browser B keeps original stop fence')

    def save():
        temporary = target.with_suffix('.json.tmp')
        opened = False
        try:
            with temporary.open('x', encoding='utf8') as log:
                opened = True
                os.fchmod(log.fileno(), 0o600)
                log.write(json.dumps(record)+'\n')
            temporary.replace(target)
            return True
        except OSError as error:
            record['firstCause'] = record['firstCause'] or 'journal-error'
            record['journalErrno'] = error.errno
            return False
        finally:
            if opened:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass  # The receipt is secondary to retaining and waiting for the child.

    child = None
    cancelled = False
    members = None
    stopped = False

    def request_stop(_number, _frame):
        nonlocal stopped
        stopped = True

    def poll():
        nonlocal members
        exited = child.poll() is not None
        try:
            members = owned_session_members(child.pid)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            members = None
            record['firstCause'] = record['firstCause'] or 'process-observation-error'
            record['observationErrorType'] = type(error).__name__
        return exited and members == []

    def cancel():
        nonlocal cancelled
        if child is not None and child.poll() is None and not cancelled:
            cancelled = True
            try:
                child.send_signal(signal.SIGINT)
            except OSError as error:
                record['cancelErrno'] = error.errno

    old_handlers = {sig: signal.signal(sig, request_stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        complete = False
        try:
            with (out/'network-cli.stdout').open('xb') as stdout, (out/'network-cli.stderr').open('xb') as stderr:
                if not stopped:
                    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
                    # start_new_session establishes both identifiers before exec.
                    record.update(status='RUNNING', pid=child.pid, pgid=child.pid, session=child.pid)
                    save()
                    while not record['firstCause']:
                        if stopped or time.monotonic() >= start+WORK_SECONDS:
                            record['firstCause'] = 'caller-cancelled' if stopped else 'work-deadline'
                            break
                        if poll():
                            complete = True
                            break
                        time.sleep(.1)
                else:
                    record['firstCause'] = 'caller-cancelled'
        except Exception as error:
            record['firstCause'] = record['firstCause'] or 'supervisor-error'
            record['errorType'] = type(error).__name__
        finally:
            if child is not None and not complete:
                cancel()
                deadline = min(start+WORK_SECONDS+CLEANUP_SECONDS, time.monotonic()+CLEANUP_SECONDS)
                while True:
                    complete = poll()
                    if complete or time.monotonic() >= deadline:
                        break
                    time.sleep(.1)
            if child is not None and child.poll() is not None:
                child.wait()
            record.update(status=('NOT_STARTED' if child is None else 'EXIT_OBSERVED' if complete
                                  else 'OWNER_CLEANUP_UNKNOWN_RETAINED'),
                          returncode=child.returncode if child is not None else None,
                          reaped=child is not None and child.returncode is not None,
                          remainingSessionPIDs=members if members is not None else 'UNKNOWN',
                          timeout=record['firstCause'] == 'work-deadline',
                          seconds=time.monotonic()-start)
            save()
        if child is not None and not complete:
            # Only cleanup observations continue after an UNKNOWN outcome. Keep the
            # original receipt intact and the exact CLI under its original owner.
            while not poll():
                time.sleep(.25)
            child.wait()
            try:
                with (out/'LATE-CLEANUP.json').open('x', encoding='utf8') as log:
                    json.dump(dict(originalOutcomeRemainsUNKNOWN=True, originalWait=child.returncode,
                                   ownSessionAbsenceObserved=True, managedPTReap='NOT_A_DIRECT_CHILD'), log)
            except OSError:
                pass
            return 2
        print(json.dumps(record))
        return 1 if child is None or record['firstCause'] is not None else child.returncode
    finally:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


def verified_argv(out, preparation):
    if preparation.get('status') != 'PREPARED_NO_NETWORK':
        raise ValueError('not a successful offline plan')
    executable = out/'R2TorCLI.app/Contents/MacOS/R2TorCLI'
    argv = [str(executable), '--run-prepared', str(out)]
    if preparation.get('runCommand') != argv:
        raise ValueError('fixed CLI command mismatch')
    pins = preparation.get('sourceAndSupplyPins')
    sealed = preparation.get('sealedExecutableSHA256')
    if (not isinstance(pins, dict) or not isinstance(sealed, str)
            or not re.fullmatch('[0-9a-f]{64}', sealed) or pins.get(str(executable)) != sealed):
        raise ValueError('missing exact sealed executable pin')
    attributes = executable.lstat()
    if (not stat.S_ISREG(attributes.st_mode) or attributes.st_nlink != 1 or attributes.st_uid != os.getuid()
            or attributes.st_mode & 0o022 or not attributes.st_mode & stat.S_IXUSR
            or executable.resolve(strict=True) != executable):
        raise ValueError('unsafe cached CLI executable')
    for name, expected in pins.items():
        if hashlib.sha256(Path(name).read_bytes()).hexdigest() != expected:
            raise ValueError('source/supply drift; do not run stale plan')
    if os.path.lexists(out/'RUN-ONCE'):
        raise ValueError('one-attempt receipt already exists; no retry')
    return argv


def preparation_for_launch(out):
    original_path = out/'PREPARATION.json'
    original = parse(read(original_path, 65536))
    if original.get('status') != 'SEALED_OFFLINE_PREPARE_NOT_RUN':
        return original
    recorded = parse(read(out/OUTPUT_NAME, 65536))
    expected = make_receipt(out, Path(recorded['assessmentReceipt']), Path(recorded['offlineProcessReceipt']))
    if recorded != expected:
        raise ValueError('post-admission preparation receipt changed')
    return recorded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prepared', type=Path)
    args = parser.parse_args()
    try:
        out = args.prepared.resolve(strict=True)
        preparation = preparation_for_launch(out)
        argv = verified_argv(out, preparation)
    except (OSError, TypeError, ValueError, AttributeError, KeyError) as error:
        print(json.dumps(dict(status='REJECTED_BEFORE_SPAWN', reason=str(error), network='NOT_RUN')))
        return 2
    return supervise(out, argv)


if __name__ == '__main__': raise SystemExit(main())
