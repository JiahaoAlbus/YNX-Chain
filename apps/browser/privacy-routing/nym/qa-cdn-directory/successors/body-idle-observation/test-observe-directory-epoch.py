"""Validate the checked-in observer against an owned subprocess and exact epoch schema."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--historical-epoch-fixture', type=Path, required=True)
    args = p.parse_args()
    runner = load('frozen_observer_runner', HERE / 'run-directory-once.py')
    observing = load('owned_epoch_observer', HERE / 'observe-directory-epoch.py')
    old = runner.module(runner.GLUE / 'qa_directory_body_failure.py')
    observer = observing.TerminalDiagnostics(old, observing.pinned_parser(runner))
    record = json.loads(args.historical_epoch_fixture.read_text())
    record.update(runID='not-a-permit', reason='epoch_id_mismatch_or_missing',
                  legacyError='qa-directory-stale-epoch')
    frame = observing.PREFIX + json.dumps(record).encode() + b'\n'
    case = Path.cwd() / 'fixture-epoch-observer'
    case.mkdir(mode=0o700)
    dest = case / 'once-fresh-directory'
    dest.mkdir(mode=0o700)
    program = 'import sys;sys.stderr.buffer.write(' + repr(frame + b'DISCARD_FIXTURE_SECRET\n') + ');sys.exit(1)'
    with subprocess.Popen([sys.executable, '-IB', '-c', program], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, start_new_session=True) as child:
        stdout, stderr = child.communicate(timeout=3)
        assert child.returncode == 1 and not stdout
        assert child.stdout.closed and child.stderr.closed
        terminal = {'capturedEOF':['stderr','stdout'],'FDClosed':True,'remainingOwned':[],
                    'cleanupFailure':None,'childOutcomeRecordingFailure':None,
                    'scopeSHA256':'fixture','binarySHA256':'fixture',
                    'processes':[{'pid':child.pid,'exit':child.returncode,'reaped':True}]}
        receipt = dest / 'receipt.json'
        runner.save(receipt, terminal)
        original_sha = runner.sha(receipt)
        errors = ['qa-directory-stale-epoch']
        for raw, err, complete in ((frame, errors, False), (frame+frame, errors, True),
                                   (frame[:-1], errors, True), (frame, [], True),
                                   (frame.replace(b'"reason":', b'"extra":'), errors, True)):
            observer.public_body_failure(raw, 'fixture', err, terminal_capture_complete=complete)
            assert observer.epoch is None and observer.persist(case, runner.sha, runner.save) is None
        observer.public_body_failure(stderr, 'fixture', errors, terminal_capture_complete=True)
        assert observer.epoch['reason'] == 'epoch_id_mismatch_or_missing'
        output = observer.persist(case, runner.sha, runner.save)
        readback = json.loads(output.read_text())
        assert readback['originalWait'] == 1 and readback['originalPID'] == child.pid
        assert readback['originalReceiptSHA256'] == original_sha == runner.sha(receipt)
        assert b'DISCARD_FIXTURE_SECRET' not in output.read_bytes() and b'not-a-permit' not in output.read_bytes()
        assert set(readback['publicEpoch']) == {'reason','basicAbsoluteEpochID','totalElapsedEpochs',
            'currentEpochStartUTC','epochEndUTC','nowUTC','remainingMilliseconds','refreshedAtUTC'}
        print(json.dumps({'scope':'local-only','fixturePid':child.pid,'originalWait':1,
                          'readback':str(output),'SHA256':runner.sha(output),
                          'invalidCaptureCasesRejected':5,'onlyWhitelistedFields':True}))


if __name__ == '__main__':
    main()
