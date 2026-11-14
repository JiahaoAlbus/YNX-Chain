#!/usr/bin/env python3
"""Verify the actual CLI stage writer on a pipe without starting a backend or QA bundle."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import selectors
import subprocess
from test_worker_ownership import segment


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).with_name('SuccessorPublicQA.swift')
    raw = source.read_bytes()
    text = raw.decode()
    entry = segment(text, '@MainActor static func main() async')
    prepare = segment(text, '@MainActor static func prepare(')
    entry_order = ['recordPrepareStage(.entered)', 'verifiedHelper(output)',
                   'recordPrepareStage(.helperVerified)', 'try prepare(output)']
    prepare_order = ['BundledTorBackend.load(', 'recordPrepareStage(.supplyVerified)',
                     'PublicArtiChannelTimeoutCLIArtifact.executable(', 'recordPrepareStage(.derivedArtifactVerified)',
                     'ActualPublicScratch.make()', 'recordPrepareStage(.profilePrepared)',
                     'try write(plan', 'recordPrepareStage(.planWritten)']
    for body, ordered in [(entry, entry_order), (prepare, prepare_order)]:
        positions = [body.index(label) for label in ordered]
        require(positions == sorted(positions), 'prepare stage source order changed')
    require('if try PublicArtiChannelTimeoutCLIArtifact.marked()' in prepare, 'variant gate missing')

    fixture = out / 'ActualPrepareStageWriter.swift'
    fixture.write_text('import Foundation\n@main struct Probe {\n'
                       + segment(text, 'private enum PrepareStage:')
                       + '\n' + segment(text, 'private static func recordPrepareStage(')
                       + '''
    static func main() throws {
        try recordPrepareStage(.entered)
        _ = readLine()
    }
}
''')
    binary = out / 'probe'
    command = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target',
               platform.machine() + '-apple-macosx14.0', '-j', '1', '-parse-as-library',
               '-module-cache-path', str(out / 'module-cache'), str(fixture), '-o', str(binary)]
    result = dict(status='FAIL', sourceSHA256=hashlib.sha256(raw).hexdigest(),
                  network='NOT_RUN', QAApp='NOT_RUN', actualArtifactLoad='NOT_RUN', stages=[])
    try:
        with (out / 'compile.stderr').open('xb') as log:
            compiler = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=log)
            try:
                compile_exit = compiler.wait(timeout=20)
            except subprocess.TimeoutExpired:
                compiler.kill()
                compile_exit = compiler.wait(timeout=2)
            result['stages'].append(dict(name='compile', pid=compiler.pid, exit=compile_exit, reaped=True))
        require(compile_exit == 0, 'stage writer fixture failed to compile')
        with subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE) as probe:
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(probe.stderr, selectors.EVENT_READ)
                    require(selector.select(timeout=5), 'no progress before the child completed')
                    marker = probe.stderr.readline(128)
                    require(marker == b'P05_PUBLIC_PREPARE_ENTERED\n', 'fixed stage marker changed')
                    require(probe.poll() is None, 'marker must arrive while child is still blocked')
                probe.stdin.close()
                require(probe.wait(timeout=2) == 0, 'inert stage writer failed')
            finally:
                if probe.poll() is None:
                    probe.kill()
                    probe.wait(timeout=2)
                result['stages'].append(dict(name='read-while-child-live', pid=probe.pid,
                                             exit=probe.returncode, reaped=True))
        require(source.read_bytes() == raw, 'source drift')
        result.update(status='PASS', stageMarkerObservedBeforeExit=True, sourceStageOrder='PASS')
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        result['firstCause'] = str(error)
    (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    raise SystemExit(0 if result['status'] == 'PASS' else 1)


if __name__ == '__main__':
    main()
