#!/usr/bin/env python3
"""Build a headless fixed PUBLIC CLI and prepare its fresh plan WITHOUT networking."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import subprocess
from prepare_successor_public_qa import prepare_sealed_cli
from test_worker_ownership import segment


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--qa-core-products', required=True, type=Path)
    p.add_argument('--native-source', type=Path, required=True, help='Pinned standalone Native source closure')
    p.add_argument('--module-cache', type=Path)
    p.add_argument('--seal-only', action='store_true', help='Compile and strictly verify the bundle without executing it')
    p.add_argument('--resources', required=True, type=Path)
    args = p.parse_args(); out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    native = args.native_source.resolve()
    paths = [native/'PrivacyTorPlatform.swift', native/'BundledTorBackend.swift', native/'TorPublicSearchDiagnostic.swift', Path(__file__).with_name('R2AdjacentCLI.swift')]
    pins = {str(source): hashlib.sha256(source.read_bytes()).hexdigest() for source in [
        Path(__file__).resolve(), Path(__file__).with_name('prepare_successor_public_qa.py').resolve(),
        Path(__file__).with_name('test_worker_ownership.py').resolve()
    ]}
    for path in paths:
        raw = path.read_bytes(); pins[str(path)] = hashlib.sha256(raw).hexdigest(); (out/path.name).write_bytes(raw)
    core = args.qa_core_products.resolve()
    for path in [core/'libYNXBrowserCore.a'] + sorted((core/'YNXBrowserCore.swiftmodule').glob('*')):
        if path.is_file(): pins[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    text = paths[2].read_text()
    scratch = out/'ActualPublicScratch.swift'
    scratch.write_text('import Foundation\nimport Darwin\n@MainActor enum ActualPublicScratch {\n'+segment(text, 'enum Failure:')+'\nstatic func make() throws -> URL { try freshScratch() }\n'+segment(text, 'private static func freshScratch(')+'\n'+segment(text, 'private static func validatedScratchURL(')+'\n}\n')
    resources = args.resources.resolve()
    expected_supply = {
        'arti': 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a',
        'lyrebird': '7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d',
        'public-bridges.json': '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407',
    }
    for name in ['arti', 'lyrebird', 'public-bridges.json', 'manifest.json']:
        path = resources/name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if name in expected_supply and digest != expected_supply[name]:
            raise ValueError('original pinned Tor supply mismatch: '+name)
        pins[str(path)] = digest
    (out/'REVIEWED-RESOURCE-PATH.txt').write_text(str(resources)+'\n')
    app = out/'R2TorCLI.app/Contents'; (app/'MacOS').mkdir(parents=True, mode=0o700)
    with (app/'Info.plist').open('wb') as f:
        plistlib.dump({'CFBundleIdentifier': 'com.ynxweb4.browser.qa.tor.public-search.r2-cli', 'CFBundleExecutable': 'R2TorCLI', 'CFBundlePackageType': 'APPL', 'YNXPublicSearchDiagnostic': True, 'LSUIElement': True}, f)
    executable = app/'MacOS/R2TorCLI'
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True).strip()
    compile_cmd = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-sdk', sdk, '-j', '1', '-module-cache-path', str(args.module_cache.resolve() if args.module_cache else out/'module-cache'), '-parse-as-library', '-DYNX_PRIVACY_ACCEPTANCE', '-I', str(core), '-L', str(core), '-lYNXBrowserCore', str(out/paths[0].name), str(out/paths[1].name), str(scratch), str(out/paths[3].name), '-o', str(executable)]
    events = []
    identity = dict(rawExecutableSHA256=None, sealedExecutableSHA256=None)
    steps = [] if args.seal_only else [('offline-plan', [str(executable), '--prepare-only', str(out)], 12)]
    try:
        failure = prepare_sealed_cli(out, app.parent, executable, compile_cmd, steps, pins, events, identity)
    except (OSError, subprocess.SubprocessError) as error:
        failure = f"{events[-1]['name']} failed: {type(error).__name__}"
    for artifact in [app/'Info.plist', scratch, out/'CLI-PLAN.json']:
        if artifact.is_file():
            pins[str(artifact)] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    drift = [name for name, h in pins.items() if not Path(name).is_file() or hashlib.sha256(Path(name).read_bytes()).hexdigest() != h]
    if drift and failure is None:
        failure = 'source or supply drift'
    expected = [b'ENTERED', b'SUPPLY_VERIFIED', b'PROFILE_PREPARED', b'CONFIG_VALIDATED', b'PLAN_WRITTEN']
    log = out/'offline-plan.stderr'
    observed = [line.removeprefix(b'P05_R2_TOR_PREPARE_') for line in log.read_bytes().split(b'\n')
                if line.startswith(b'P05_R2_TOR_PREPARE_')] if log.is_file() else []
    if failure is None and not args.seal_only and observed != expected:
        failure = 'offline-plan stage evidence missing or out of order'
    result = dict(status='FAIL' if failure else ('SEALED_OFFLINE_PREPARE_NOT_RUN' if args.seal_only else 'PREPARED_NO_NETWORK'),
                  firstCause=failure, sourceAndSupplyPins=pins, sourceDrift=drift, processes=events,
                  offlinePrepareStages=[name.decode('ascii', errors='replace') for name in observed],
                  runCommand=None if args.seal_only else [str(executable), '--run-prepared', str(out)],
                  networkLeg='NOT_RUN', GUI='NOT_RUN', privacyAdmission='UNCHANGED_BLOCKED', **identity)
    (out/'PREPARATION.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
