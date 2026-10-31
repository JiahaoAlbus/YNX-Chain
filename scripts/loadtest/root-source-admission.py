#!/usr/bin/env python3
"""Run the byte-pinned original source controller with bounded admission evidence.

This does not replace, filter or retry the original heavy-process admission.
Only kernel PID identity/comm is recorded; argv, environment and tokens are not.
The observer ends three seconds after the original source entry is launched,
so it does not run throughout the measured source matrix.
"""
import hashlib
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import signal
import threading
import time

BASE_NAME = 'pq-source-artifact-intake.py'
BASE_SHA256 = '0c59129b9951de6b0b0b30f098fd732c2652ffbf0a66ecddd99fe525da0b260b'
LIMIT = 4 << 20


def load_original(path):
    path = Path(path)
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != BASE_SHA256:
        raise RuntimeError('the unchanged f27 source controller is required')
    spec = importlib.util.spec_from_file_location('unchanged_original_source_intake', path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


def snapshot(lab):
    rows, vanished = lab.guard.proc_inventory()
    heavy = lab.heavy_processes(rows)  # EXACT original selection; no exclusion.
    owned = lab.guard.owned_set(rows, os.getpid())
    result = []
    for item in heavy:
        pid = item['pid']
        before = rows.get(pid)
        record = dict(item, originalInventory=before, ownedByObserver=pid in owned,
                      identity='UNKNOWN')
        try:
            after = lab.guard.parse_stat(lab.guard.bounded(Path('/proc') / str(pid) / 'stat'), pid)
            record['secondStat'] = after
            record['identity'] = ('SAME' if before and before['startTicks'] == after['startTicks']
                                  else 'PID_REUSED_OR_UNKNOWN')
        except FileNotFoundError:
            record['identity'] = 'DISAPPEARED_AFTER_ORIGINAL_SELECTION'
        result.append(record)
    own = rows.get(os.getpid())
    return dict(monotonicNs=time.monotonic_ns(), observer=own,
                originalHeavySelection=result, inventoryVanished=vanished)


def observe(lab, operation, path, stopped):
    written = 0
    previous = None
    entry_deadline = None
    with path.open('xb', buffering=0) as out:
        os.chmod(path, 0o600)
        while not stopped.is_set():
            value = snapshot(lab)
            signature = json.dumps(value['originalHeavySelection'], sort_keys=True)
            entry = operation / 'public/original-source-entry.log'
            if entry.exists() and entry_deadline is None:
                entry_deadline = time.monotonic() + 3
                value['originalEntryObserved'] = True
            # Keep the initial empty inventory and all actual transitions.
            if signature != previous or value.get('originalEntryObserved'):
                raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
                if written + len(raw) > LIMIT - 512:
                    out.write(b'{"observerStopped":"bounded evidence full; subsequent state UNKNOWN"}\n')
                    return
                out.write(raw)
                written += len(raw)
                previous = signature
            if entry_deadline is not None and time.monotonic() >= entry_deadline:
                out.write(b'{"observerStopped":"three seconds after original entry; measured source matrix unobserved"}\n')
                return
            stopped.wait(.2)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    base = load_original(Path(__file__).with_name(BASE_NAME))
    if '--execute' not in argv:
        return base.main(argv)
    # Original parser/runner still validates every option and exact source pin.
    scope = argv[argv.index('--scope') + 1]
    tools = Path(argv[argv.index('--tools') + 1])
    operation = Path(argv[argv.index('--operation') + 1])
    if scope not in base.SCOPES or sys.platform != 'linux':
        raise RuntimeError('only a fixed actual hosted Linux source scope can execute')
    lab = base.original_lab(tools, base.SCOPES[scope][0])
    # Pin before creating the observer thread: it inherits the same two CPUs
    # as the original Window and every actual source child.
    cpus = sorted(os.sched_getaffinity(0))[:2]
    if len(cpus) != 2:
        raise RuntimeError('two actual source CPU slots required')
    os.sched_setaffinity(0, cpus)
    own_path = Path(__file__).with_name('root-source-scope.py')
    own_spec = importlib.util.spec_from_file_location('root_owned_source_scope', own_path)
    own_scope = importlib.util.module_from_spec(own_spec)
    own_spec.loader.exec_module(own_scope)
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--scope', choices=tuple(base.SCOPES), required=True)
    for name in ('tools', 'owner', 'controller', 'operation'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    directory = Path(os.environ['RUNNER_TEMP']).resolve(strict=True) / ('root-admission-' + scope)
    directory.mkdir(mode=0o700)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
        out.write('root_diagnostics=' + str(directory) + '\n')
    stopped = threading.Event()
    errors = []

    def watched():
        try:
            observe(lab, operation, directory / 'ORIGINAL-HEAVY-IDENTITIES.jsonl', stopped)
        except BaseException as error:
            errors.append(type(error).__name__ + ': ' + str(error))

    observer = threading.Thread(target=watched, name='source-evidence', daemon=False)
    observer.start()
    def interrupted(signum, frame):
        raise base.Refused('source comparison received signal ' + str(signum))
    prior = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        own_scope.run_scope(base, args)
        return 0
    finally:
        for sig, handler in prior.items():
            signal.signal(sig, handler)
        stopped.set()
        observer.join(timeout=5)
        record = dict(originalControllerSHA256=BASE_SHA256,
                      originalControllerUnchanged=True, originalAdmissionUnchanged=True,
                      rootPhaseLifecycle='explicit waitpid for identity-checked adopted zombies before original entry',
                      noProcessKilledOrExcluded=True, diagnosticOnly=True,
                      observerJoined=not observer.is_alive(), observerErrors=errors,
                      measurements='source-only; observer active before/first3s of original entry; not chain TPS')
        with (directory / 'OBSERVER-COMPLETION.json').open('x') as out:
            json.dump(record, out, sort_keys=True); out.write('\n')
        if observer.is_alive():
            raise RuntimeError('bounded diagnostic observer did not join')


if __name__ == '__main__':
    raise SystemExit(main())
