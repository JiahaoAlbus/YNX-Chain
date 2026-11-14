#!/usr/bin/env python3
"""Actual executable role rejection; no URLs, vendor, profile or UI are requested.

Both inputs must be immutable complete builds from the same source snapshot.
A missing PUBLIC-role guard is a failure, never an ordinary-mode fallback pass.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import selectors
import shutil
import subprocess
import sys
import time

ROLE = 'com.ynxweb4.browser.qa.nym.public-search'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def check_case(output, label, source, expected_hash, message):
    if source.resolve(strict=True) != source or not source.is_file() or sha(source) != expected_hash:
        raise ValueError('actual-binary-pin')
    app = output / (label + '.app')
    executable = app / 'Contents/MacOS/YNXBrowserNative'
    executable.parent.mkdir(parents=True, mode=0o700)
    shutil.copy2(source, executable)
    executable.chmod(0o700)
    if sha(executable) != expected_hash:
        raise ValueError('copied-binary-pin')
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': ROLE, 'CFBundleExecutable': executable.name,
        'CFBundleName': label, 'CFBundlePackageType': 'APPL',
        'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleVersion': '1',
        'LSMinimumSystemVersion': '14.0',
        # Deliberately no PUBLIC marker: intent must still be rejected before AppKit.
    }))
    # Seal the new local test bundle, so its changed Info.plist cannot turn an
    # AMFI/signature failure into a false launch-role result.
    sealed = subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-',
                             '--timestamp=none', str(app)], capture_output=True, timeout=8)
    if sealed.returncode:
        raise ValueError('test-bundle-seal-failed')
    executed_hash = sha(executable)
    env = {key: os.environ[key] for key in ('HOME', 'USER', 'LOGNAME', 'LANG') if key in os.environ}
    env['PATH'] = '/usr/bin:/bin'
    selector = selectors.DefaultSelector()
    data = [bytearray(), bytearray()]
    eof = [False, False]
    failure = None
    code = None
    try:
        child = subprocess.Popen([str(executable)], env=env, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except BaseException:
        selector.close()
        raise
    begun = time.monotonic()
    try:
        for index, pipe in enumerate((child.stdout, child.stderr)):
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, index)
        while child.poll() is None or selector.get_map():
            if time.monotonic() - begun > 4:
                raise ValueError('early-rejection-deadline')
            for key, _ in selector.select(.05):
                block = os.read(key.fileobj.fileno(), 1024)
                if not block:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    eof[key.data] = True
                else:
                    if len(data[key.data]) + len(block) > 8192:
                        raise ValueError('early-rejection-output-bound')
                    data[key.data].extend(block)
        code = child.wait(timeout=1)
        if code != 78 or bytes(data[1]) != message or data[0] or not all(eof):
            raise ValueError('expected-role-refusal-not-proven')
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)}
    finally:
        selector.close()
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                child.kill()
        code = child.wait(timeout=2)
        for pipe in (child.stdout, child.stderr):
            if not pipe.closed:
                pipe.close()
    receipt = dict(label=label, originalPID=child.pid, originalWait=code, reaped=True,
                   bothEOF=eof, elapsedSeconds=time.monotonic() - begun,
                   expectedBinarySHA256=expected_hash, firstFailure=failure,
                   executedAdhocBinarySHA256=executed_hash,
                   stdoutBytes=len(data[0]), stderrBytes=len(data[1]),
                   purpose='Bare Nym PUBLIC bundle cannot enter ordinary startup')
    (output / (label + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for variant in ('normal', 'qa'):
        p.add_argument('--' + variant + '-executable', type=Path, required=True)
        p.add_argument('--' + variant + '-sha256', required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if sys.platform != 'darwin':
        p.error('Real macOS executable controls only; no simulated platform pass')
    os.umask(0o077)
    a.output.mkdir(parents=True, mode=0o700, exist_ok=False)
    records = []
    try:
        records.append(check_case(a.output, 'normal-bare-nym-role', a.normal_executable,
                                  a.normal_sha256, b'Public-search diagnostics are unavailable in this production build.\n'))
        records.append(check_case(a.output, 'qa-bare-nym-role', a.qa_executable,
                                  a.qa_sha256, b'Public-search diagnostic role rejected before ordinary startup.\n'))
    finally:
        result = dict(schema='P05_BARE_NYM_PUBLIC_ROLE_ACTUAL_EXECUTABLE_V1', records=records,
                      status='PASS' if len(records) == 2 and all(x['firstFailure'] is None for x in records) else 'FAIL',
                      attemptedURLs=[], backendRequested=False, normalPrivacyAdmission=False)
        (a.output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
