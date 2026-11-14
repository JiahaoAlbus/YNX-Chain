#!/usr/bin/env python3
"""R2 new trace/redaction/role/budget controls only. No network or backend."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import subprocess
import time
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--sealed-target-only', action='store_true', help='one new pinned PT nested-module control; do not repeat31')
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    source = browser/'native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift'
    probe = Path(__file__).with_name('R2RuntimeTraceDeltaProbe.swift')
    text = source.read_text()
    actual = out/'ActualR2Trace.swift'
    actual.write_text('import Foundation\nimport CryptoKit\nimport Network\nimport Darwin\nimport CoreFoundation\n' + '\n'.join(segment(text, marker) for marker in ['enum TorPlatformError:', 'struct TorPublicObservablePath:', 'enum TorPublicStderrSanitizer {', '@MainActor final class TorPublicRuntimeTrace']))
    (out/probe.name).write_bytes(probe.read_bytes())
    pins = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [source, probe]}
    app = out/'TraceFixture.app/Contents'; (app/'MacOS').mkdir(parents=True, mode=0o700)
    with (app/'Info.plist').open('wb') as f:
        plistlib.dump({'CFBundleIdentifier': 'com.ynxweb4.browser.qa.tor.public-search.r2-cli', 'CFBundleExecutable': 'trace-probe', 'CFBundlePackageType': 'APPL', 'YNXPublicSearchDiagnostic': True}, f)
    data = out/'synthetic-only'; data.mkdir(mode=0o700)
    wrong = out/'wrong-role-no-file'; wrong.mkdir(mode=0o700)
    binary = app/'MacOS/trace-probe'
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-j', '1', '-module-cache-path', str(out/'module-cache'), '-parse-as-library', str(actual), str(out/probe.name), '-o', str(binary)], 90)]
    events = []; failure = None
    def run(name, argv, timeout):
        start = time.monotonic(); p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE); timedout = False
        try: stdout, stderr = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timedout = True; p.terminate()
            try: stdout, stderr = p.communicate(timeout=2)
            except subprocess.TimeoutExpired: p.kill(); stdout, stderr = p.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout); (out/(name+'.stderr')).write_bytes(stderr)
        events.append(dict(name=name, argv=argv, pid=p.pid, returncode=p.returncode, timeout=timedout, reaped=p.poll() is not None, seconds=time.monotonic()-start))
        return p.returncode == 0 and not timedout
    for name, argv, timeout in commands:
        if not run(name, argv, timeout): failure = name+' failed'; break
    if failure is None:
        plain = out/'plain-probe'; plain.write_bytes(binary.read_bytes()); plain.chmod(0o700)
        if args.sealed_target_only:
            if not run('sealed-target-only', [str(binary), str(data), '--sealed-target-only'], 8): failure = 'sealed target control failed'
        elif not run('wrong-role', [str(plain), str(wrong), '--wrong-role'], 8): failure = 'wrong role control failed'
        elif list(wrong.iterdir()): failure = 'wrong role had filesystem side effect'
        elif not run('new-delta', [str(binary), str(data)], 8): failure = 'new delta failed'
    assertions = {'originalPathFenceKept': 'if !available || self.hasInitialPath { self.stop(reason: available ? "network-path-changed" : "network-unavailable") }' in text, 'signalStillSIGINT': 'process.interrupt()' in text, 'terminationReasonObserved': 'process.terminationReason == .exit' in text}
    if not all(assertions.values()) and failure is None: failure = 'source invariant failed'
    drift = [p for p, h in pins.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest() != h]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else 'PASS', firstCause=failure, inputs=pins, processes=events, invariants=assertions, sourceDrift=drift, scope='new synthetic trace controls only; old44 not repeated; no backend/GUI/network')
    (out/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
