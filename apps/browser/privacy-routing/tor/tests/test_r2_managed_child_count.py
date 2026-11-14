#!/usr/bin/env python3
"""Actual original observer counterexample then fixed observer with owned harmless cats."""
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
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('output', type=Path); args = p.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]; source = browser/'native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift'
    probe = Path(__file__).with_name('R2ManagedChildCountDeltaProbe.swift'); legacyfile = Path(__file__).with_name('R2ManagedChildCountLegacy.fixture')
    legacy = legacyfile.read_text().rstrip('\n')
    assert hashlib.sha256(legacy.encode()).hexdigest() == 'd17b0cf4101d61dba39b374a61ef8d75ae3796f2eba63239991885bb66e1202a'
    text = source.read_text(); current = segment(text, 'func observeManagedTransport()')
    actual = 'import Foundation\nimport CryptoKit\nimport Network\nimport Darwin\nimport CoreFoundation\n'+'\n'.join(segment(text, marker) for marker in ['enum TorPlatformError:', 'struct TorPublicObservablePath:', 'enum TorPublicStderrSanitizer {', '@MainActor final class TorPublicRuntimeTrace'])
    pins = {str(x): hashlib.sha256(x.read_bytes()).hexdigest() for x in [source, probe, legacyfile]}
    events = []; failure = None
    for mode in ['original-counterexample', 'fixed-count-group']:
        case = out/mode; case.mkdir(mode=0o700)
        code = actual.replace(current, legacy) if mode == 'original-counterexample' else actual
        declaration = case/'ActualObserver.swift'; declaration.write_text(code); (case/probe.name).write_bytes(probe.read_bytes())
        bundle = case/'HarmlessCount.app/Contents'; (bundle/'MacOS').mkdir(parents=True, mode=0o700)
        with (bundle/'Info.plist').open('wb') as f:
            plistlib.dump({'CFBundleIdentifier': 'com.ynxweb4.browser.qa.tor.public-search.r2-cli', 'CFBundleExecutable': 'count-control', 'YNXPublicSearchDiagnostic': True, 'CFBundlePackageType': 'APPL'}, f)
        binary = bundle/'MacOS/count-control'; data = case/'synthetic-only'; data.mkdir(mode=0o700)
        commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-j', '1', '-module-cache-path', str(out/'module-cache'), '-parse-as-library', str(declaration), str(case/probe.name), '-o', str(binary)], 90), ('actual-owned-children', [str(binary), str(data)]+(['--expect-legacy-miss'] if mode == 'original-counterexample' else []), 12)]
        for name, argv, budget in commands:
            start = time.monotonic(); child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE); timeout = False
            try: stdout, stderr = child.communicate(timeout=budget)
            except subprocess.TimeoutExpired:
                timeout = True; child.terminate()
                try: stdout, stderr = child.communicate(timeout=3)
                except subprocess.TimeoutExpired: child.kill(); stdout, stderr = child.communicate(timeout=3)
            (case/(name+'.stdout')).write_bytes(stdout); (case/(name+'.stderr')).write_bytes(stderr)
            events.append(dict(mode=mode, name=name, argv=argv, pid=child.pid, returncode=child.returncode, timeout=timeout, reaped=child.poll() is not None, seconds=time.monotonic()-start))
            if timeout or child.returncode: failure = mode+'/'+name+' failed'; break
        if failure: break
    drift = [name for name,h in pins.items() if hashlib.sha256(Path(name).read_bytes()).hexdigest() != h]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else 'PASS', firstCause=failure, inputs=pins, sourceDrift=drift, processes=events, primaryAPI='https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c#L81-L89', scope='new real owned harmless child API/observer/count/absence controls; original36 not repeated; no backend/network/GUI')
    (out/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
