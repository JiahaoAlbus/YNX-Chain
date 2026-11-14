#!/usr/bin/env python3
"""Build a headless fixed PUBLIC CLI and prepare its fresh plan WITHOUT networking."""
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
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--qa-core-products', required=True, type=Path)
    p.add_argument('--resources', required=True, type=Path)
    args = p.parse_args(); out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]; native = browser/'native/Sources/YNXBrowserNative'
    paths = [native/'PrivacyTorPlatform.swift', native/'BundledTorBackend.swift', native/'TorPublicSearchDiagnostic.swift', Path(__file__).with_name('SnowflakeReviewedQA.swift'), Path(__file__).with_name('SnowflakeSafePhaseRecorder.swift')]
    pins = {}
    for path in paths:
        raw = path.read_bytes(); pins[str(path)] = hashlib.sha256(raw).hexdigest(); (out/path.name).write_bytes(raw)
    core = args.qa_core_products.resolve()
    for path in [core/'libYNXBrowserCore.a'] + sorted((core/'YNXBrowserCore.swiftmodule').glob('*')):
        if path.is_file(): pins[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    text = paths[2].read_text()
    scratch = out/'ActualPublicScratch.swift'
    scratch.write_text('import Foundation\nimport Darwin\n@MainActor enum ActualPublicScratch {\n'+segment(text, 'enum Failure:')+'\nstatic func make() throws -> URL { try freshScratch() }\n'+segment(text, 'private static func freshScratch(')+'\n'+segment(text, 'private static func validatedScratchURL(')+'\n}\n')
    resources = args.resources.resolve()
    for name in ['arti', 'lyrebird', 'public-bridges.json', 'manifest.json']:
        path = resources/name; pins[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    (out/'REVIEWED-RESOURCE-PATH.txt').write_text(str(resources)+'\n')
    app = out/'SnowflakeQA.app/Contents'; (app/'MacOS').mkdir(parents=True, mode=0o700)
    with (app/'Info.plist').open('wb') as f:
        plistlib.dump({'CFBundleIdentifier': 'com.ynxweb4.browser.qa.tor.public-search.r2-cli', 'CFBundleExecutable': 'SnowflakeQA', 'CFBundlePackageType': 'APPL', 'YNXPublicSearchDiagnostic': True, 'LSUIElement': True}, f)
    executable = app/'MacOS/SnowflakeQA'
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True).strip()
    compile_cmd = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-sdk', sdk, '-j', '1', '-module-cache-path', str(out/'module-cache'), '-parse-as-library', '-DYNX_PRIVACY_ACCEPTANCE', '-I', str(core), '-L', str(core), '-lYNXBrowserCore', str(out/paths[0].name), str(out/paths[1].name), str(scratch), str(out/paths[3].name), str(out/paths[4].name), '-o', str(executable)]
    events = []; failure = None
    for name, argv, budget in [('compile-fixed-cli', compile_cmd, 90), ('offline-plan', [str(executable), '--prepare-only', str(out)], 12)]:
        start = time.monotonic(); child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE); timeout = False
        try: stdout, stderr = child.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout = True; child.terminate()
            try: stdout, stderr = child.communicate(timeout=2)
            except subprocess.TimeoutExpired: child.kill(); stdout, stderr = child.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout); (out/(name+'.stderr')).write_bytes(stderr)
        events.append(dict(name=name, argv=argv, pid=child.pid, returncode=child.returncode, timeout=timeout, reaped=child.poll() is not None, seconds=time.monotonic()-start))
        if timeout or child.returncode: failure = name+' failed'; break
    drift = [name for name, h in pins.items() if hashlib.sha256(Path(name).read_bytes()).hexdigest() != h]
    if drift and failure is None: failure = 'source or supply drift'
    result = dict(status='FAIL' if failure else 'PREPARED_NO_NETWORK', firstCause=failure, sourceAndSupplyPins=pins, sourceDrift=drift, processes=events, runCommand=[str(executable), '--run-prepared', str(out)], networkLeg='NOT_RUN', GUI='NOT_RUN', privacyAdmission='UNCHANGED_BLOCKED')
    (out/'PREPARATION.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
