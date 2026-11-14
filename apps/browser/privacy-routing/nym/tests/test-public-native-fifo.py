#!/usr/bin/env python3
"""Compile and exercise the actual before/after Native readers using owned FIFOs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

BEFORE = ('4fdae6f312e99a6512c8f239d4d7c57ebfcc15e9d8bae471ca3b18c997fb10a7',
          'c793cab608499613769a72c92b77d17ec4bec429e0c2f47cca8f6dd657d1a527')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def components(runtime, directory):
    # These functions use Foundation, CryptoKit and Darwin. Extract their real
    # definitions without introducing a mock Core module or backend process.
    failure = runtime.split('enum NymPublicRuntimeFailure:', 1)[1].split('/// Local PUBLIC diagnostic', 1)[0]
    scratch = runtime.split('final class NymPublicScratch {', 1)[1].split('/// Fixed 331 final-config', 1)[0]
    supply = directory.split('struct NymPublicExecutableSupply {', 1)[1].split('/// Public directory DATA', 1)[0]
    return ('import Foundation\nimport CryptoKit\nimport Darwin\n'
            + 'enum NymPublicRuntimeFailure:' + failure + 'final class NymPublicScratch {'
            + scratch + 'struct NymPublicExecutableSupply {' + supply)

def command_output(*args):
    return subprocess.check_output(args, text=True, timeout=5).strip()

def owned_group_members(pgid):
    rows = command_output('/bin/ps', '-axo', 'pid=,pgid=').splitlines()
    return [int(pid) for pid, group in (row.split() for row in rows) if int(group) == pgid]

def finish(process):
    if process.poll() is None:
        try:
            if os.getpgid(process.pid) == process.pid:
                os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
    try:
        return process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        if os.getpgid(process.pid) == process.pid:
            os.killpg(process.pid, signal.SIGKILL)
        return process.wait(timeout=3)

def run_step(output, label, argv, environment, timeout, steps, expected_block=False):
    start = time.monotonic()
    stdout = output/(label+'.stdout')
    timed_out = False
    with stdout.open('xb') as out, (output/(label+'.stderr')).open('xb') as err:
        process = subprocess.Popen(argv, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=out, stderr=err, start_new_session=True)
        outcome = {'label': label, 'pid': process.pid, 'pgid': process.pid, 'argv': argv}
        steps.append(outcome)
        try:
            try:
                status = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                status = finish(process)
        finally:
            if process.poll() is None:
                finish(process)
            outcome.update(exit=process.returncode, reaped=process.returncode is not None,
                           elapsedSeconds=round(time.monotonic()-start, 4), timedOut=timed_out)
    outcome['remainingGroup'] = owned_group_members(process.pid)
    marker = stdout.read_bytes()
    if outcome['remainingGroup']:
        raise RuntimeError(label+'-owned-group-still-live')
    if expected_block:
        if not timed_out or not marker.startswith(b'ENTER_NO_WRITER_FIFO ') or status not in (-2, -9):
            raise RuntimeError(label+'-before-source-did-not-demonstrate-blocking')
    elif timed_out or status != 0:
        raise RuntimeError(label+'-failed')
    elif label.startswith('after-') and b'PASS native no-writer FIFO rejected' not in marker:
        raise RuntimeError(label+'-missing-real-rejection')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before-runtime', type=Path)
    parser.add_argument('--before-data', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if bool(args.before_runtime) != bool(args.before_data):
        parser.error('supply both before-source files or neither')
    test = Path(__file__).resolve().with_name('NymPublicFIFOControls.swift')
    native = test.parents[3]/'native/Sources/YNXBrowserNative'
    paths = [native/'NymPublicSearchRuntime.swift', native/'NymPublicDirectoryData.swift', test]
    sources = [path.read_bytes() for path in paths]
    test_data = sources[2]
    after_reader = components(*[x.decode() for x in sources[:2]])
    cohorts = [('after', after_reader)]
    if args.before_runtime:
        before_paths = [args.before_runtime, args.before_data]
        before_sources = [path.read_bytes() for path in before_paths]
        if tuple(map(sha, before_sources)) != BEFORE:
            raise RuntimeError('before-native-source-pin')
        before_reader = components(*[x.decode() for x in before_sources])
        if before_reader.count('O_RDONLY | O_NOFOLLOW | O_CLOEXEC') != 2 or (
                before_reader.replace('O_RDONLY | O_NOFOLLOW | O_CLOEXEC',
                                      'O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC') != after_reader):
            raise RuntimeError('unexpected-reader-change')
        cohorts.insert(0, ('before', before_reader))
        paths.extend(before_paths)
        sources.extend(before_sources)
    output = args.output.absolute()
    output.mkdir(mode=0o700)
    (output/'tmp').mkdir(mode=0o700)
    test_snapshot = output/test.name
    test_snapshot.write_bytes(test_data)
    compiler = command_output('/usr/bin/xcrun', '--find', 'swiftc')
    sdk = command_output('/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path')
    architecture = command_output('/usr/bin/uname', '-m')
    steps = []
    receipt = {'sourcePins': {str(p): sha(data) for p, data in zip(paths,sources)},
               'steps': steps, 'sdk': sdk, 'compiler': compiler, 'firstFailure': None}
    try:
        with tempfile.TemporaryDirectory(prefix='ynx-nym-fifo-', dir='/tmp') as alias:
            os.symlink(output/'tmp', Path(alias)/'tmp')
            environment = dict(os.environ, TMPDIR=str(Path(alias)/'tmp')+'/')
            for stage, contents in cohorts:
                source = output/(stage+'.swift')
                source.write_text(contents)
                executable = output/(stage+'-fixture')
                run_step(output, 'compile-'+stage,
                         [compiler,'-swift-version','6','-sdk',sdk,'-target',architecture+'-apple-macosx14.0',
                          '-module-cache-path',str(output/'module-cache'),str(source),str(test_snapshot),'-o',str(executable)],
                         environment, 15, steps)
                for kind in ('scratch','manifest'):
                    fixture = output/(stage+'-'+kind)
                    fixture.mkdir(mode=0o700)
                    run_step(output, stage+'-'+kind, [str(executable),str(fixture),kind],
                             environment, 1.0 if stage=='before' else 3, steps, expected_block=stage=='before')
        if any(path.read_bytes() != data for path,data in zip(paths,sources)):
            raise RuntimeError('native-source-drift')
    except BaseException as error:
        receipt['firstFailure'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        (output/'RESULT.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if args.before_runtime:
        print('PASS both prior readers blocked on actual no-writer FIFOs.')
    print('PASS both current readers rejected no-writer FIFOs.')

if __name__ == '__main__':
    main()
