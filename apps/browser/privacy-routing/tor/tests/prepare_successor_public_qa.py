#!/usr/bin/env python3
"""Build a headless fixed PUBLIC CLI and prepare its fresh plan WITHOUT networking."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import subprocess
import time
from test_worker_ownership import segment


FIXED_TARGETS = ['https://www.iana.org/domains/reserved', 'https://html.duckduckgo.com/html/?q=YNX%20browser']
HELPER_SHA256 = '8d072f55417245ac63abad63d04a4c89590dc99d62f53b7e1373418539645922'
# This is a byte pin for a NEW QA helper, not signing/Root/network authorization.
def check_helper(path):
    import os, stat
    path = Path(path).absolute()
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or not os.access(path, os.X_OK) or hashlib.sha256(path.read_bytes()).hexdigest() != HELPER_SHA256:
        raise ValueError('successor helper pin rejected; no compilation or networking')
    return path

def validate_metadata(plan, now):
    if plan.get('schema') != 'P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1' or plan.get('port') != 63782 or plan.get('lyrebirdSHA256') != HELPER_SHA256:
        raise ValueError('successor metadata rejected')
    if plan.get('artiSHA256') != 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a':
        raise ValueError('baseline CLI cannot run a derived Browser Arti plan')
    if plan.get('fixedTargets') != FIXED_TARGETS or plan.get('fixedMethod') != 'GET':
        raise ValueError('unreviewed target metadata')
    age=now-plan.get('createdAt',float('-inf'))
    if not 0 <= age <= 1800 or plan.get('chosenLineSHA256') != '9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f':
        raise ValueError('expired or wrong reviewed profile metadata')
    name=Path(plan.get('profile',''))
    if not name.is_absolute() or name.name != 'Tor' or name.parent.name != 'YNX Browser Route State' or __import__('re').fullmatch(r'ynx-public-search-[A-Za-z0-9]{8}',name.parent.parent.name) is None or str(name) != __import__('os').path.abspath(name):
        raise ValueError('wrong task profile metadata')

def utc_now():
    return datetime.now(timezone.utc).isoformat()


def run_stage(output, events, name, argv, budget):
    start = time.monotonic()
    event = dict(name=name, argv=argv, pid=None, returncode=None, timeout=False, reaped=False,
                 dispatchUTC=utc_now(), childObservedUTC=None)
    events.append(event)
    stdout, stderr = b'', b''
    try:
        child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as error:
        event['launchError'] = dict(type=type(error).__name__, errno=error.errno)
    else:
        event.update(pid=child.pid, childObservedUTC=utc_now())
        try:
            stdout, stderr = child.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            event['timeout'] = True
            child.terminate()
            try:
                stdout, stderr = child.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                stdout, stderr = child.communicate(timeout=2)
        event.update(returncode=child.returncode, reaped=child.poll() is not None)
    event.update(terminalObservedUTC=utc_now(), seconds=time.monotonic() - start,
                 stdoutSHA256=hashlib.sha256(stdout).hexdigest(), stderrSHA256=hashlib.sha256(stderr).hexdigest(),
                 stdoutBytes=len(stdout), stderrBytes=len(stderr))
    (output / (name + '.stdout')).write_bytes(stdout)
    (output / (name + '.stderr')).write_bytes(stderr)
    return event['returncode'] == 0 and not event['timeout'] and event['reaped']


def prepare_sealed_cli(output, bundle, executable, compile_cmd, offline_steps, pins, events, identity):
    if not run_stage(output, events, 'compile-fixed-cli', compile_cmd, 90):
        return 'compile-fixed-cli failed'
    if not executable.is_file():
        return 'compiled CLI executable missing'
    identity['rawExecutableSHA256'] = hashlib.sha256(executable.read_bytes()).hexdigest()
    executable.chmod(0o700)

    sign = ['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', str(bundle)]
    if not run_stage(output, events, 'seal-cli-bundle', sign, 15):
        return 'seal-cli-bundle failed'

    verify = ['/usr/bin/codesign', '--verify', '--strict', '--verbose=2', str(bundle)]
    if not run_stage(output, events, 'verify-cli-bundle', verify, 12):
        return 'verify-cli-bundle failed'
    resources = bundle / 'Contents/_CodeSignature/CodeResources'
    if not resources.is_file():
        return 'verified CLI bundle missing CodeResources'
    identity['sealedExecutableSHA256'] = hashlib.sha256(executable.read_bytes()).hexdigest()
    pins[str(executable)] = identity['sealedExecutableSHA256']
    pins[str(resources)] = hashlib.sha256(resources.read_bytes()).hexdigest()

    for name, argv, budget in offline_steps:
        if any(not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != pins[str(path)]
               for path in (executable, resources)):
            return 'verified CLI executable or resource seal changed before ' + name
        if not run_stage(output, events, name, argv, budget):
            return name + ' failed'
    return None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--qa-core-products', required=True, type=Path)
    p.add_argument('--native-source', required=True, type=Path, help='explicit immutable verified CLI Native3; not current Browser target')
    p.add_argument('--resources', required=True, type=Path)
    p.add_argument('--successor-helper', required=True, type=Path)
    p.add_argument('--arti-channel-timeout-artifact', type=Path, help='Optional exact derived QA artifact; only explicit V2 plan/runtime can use it')
    p.add_argument('--module-cache', type=Path)
    p.add_argument('--seal-only', action='store_true', help='Compile, seal, and strictly verify without executing the bundle')
    p.add_argument('--skip-launch-controls', action='store_true')
    p.add_argument('--skip-sampler-controls', action='store_true')
    args = p.parse_args(); helper = check_helper(args.successor_helper); out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    derived = None
    if args.arti_channel_timeout_artifact is not None:
        import derive_arti_channel_timeout_plan as artifact_contract
        artifact_dir = args.arti_channel_timeout_artifact.absolute()
        derived = artifact_contract.verified_artifact(artifact_dir)
    native = args.native_source.resolve()
    paths = [native/'PrivacyTorPlatform.swift', native/'BundledTorBackend.swift', native/'TorPublicSearchDiagnostic.swift', Path(__file__).with_name('SuccessorPublicQA.swift'), Path(__file__).with_name('SnowflakeSafePhaseRecorder.swift')]
    pins = {str(helper): HELPER_SHA256}
    for utility in [Path(__file__).resolve(), Path(__file__).with_name("test_worker_ownership.py").resolve()]:
        pins[str(utility)] = hashlib.sha256(utility.read_bytes()).hexdigest()
    if derived is not None:
        utility = Path(__file__).with_name('derive_arti_channel_timeout_plan.py').resolve()
        pins[str(utility)] = hashlib.sha256(utility.read_bytes()).hexdigest()
    (out/'SUCCESSOR-HELPER-PATH.txt').write_text(str(helper)+'\n')
    for path in paths:
        raw = path.read_bytes(); pins[str(path)] = hashlib.sha256(raw).hexdigest(); (out/path.name).write_bytes(raw)
    core = args.qa_core_products.resolve()
    module_dir = core/'YNXBrowserCore.swiftmodule'
    import_dir = core
    if not module_dir.exists():
        module_dir = core/'Modules/YNXBrowserCore.swiftmodule'; import_dir = core/'Modules'
    link_core = core/'libYNXBrowserCore.a'
    if not link_core.is_file(): link_core = core/'YNXBrowserCore.o'
    if not module_dir.exists() or not link_core.is_file():
        raise ValueError('actual QA Core module/full link product missing; do not recompile or extract Core')
    module_inputs = sorted(module_dir.glob('*')) if module_dir.is_dir() else [module_dir]
    for path in [link_core] + module_inputs:
        if path.is_file(): pins[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    text = paths[2].read_text()
    scratch = out/'ActualPublicScratch.swift'
    scratch.write_text('import Foundation\nimport Darwin\n@MainActor enum ActualPublicScratch {\n'+segment(text, 'enum Failure:')+'\nstatic func make() throws -> URL { try freshScratch() }\n'+segment(text, 'private static func freshScratch(')+'\n'+segment(text, 'private static func validatedScratchURL(')+'\n}\n')
    resources = args.resources.resolve()
    for name in ['arti', 'lyrebird', 'public-bridges.json', 'manifest.json']:
        path = resources/name; pins[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    (out/'REVIEWED-RESOURCE-PATH.txt').write_text(str(resources)+'\n')
    app = out/'SuccessorQA.app/Contents'; (app/'MacOS').mkdir(parents=True, mode=0o700)
    info = {'CFBundleIdentifier': 'com.ynxweb4.browser.qa.tor.public-search.r2-cli', 'CFBundleExecutable': 'SuccessorQA', 'CFBundlePackageType': 'APPL', 'YNXPublicSearchDiagnostic': True, 'LSUIElement': True}
    if derived is not None:
        info['YNXPublicArtiChannelTimeoutExperiment'] = True
        destination = app/'Resources/ChannelTimeoutQA'; destination.mkdir(mode=0o700, parents=True)
        for name, raw in zip(['ArtiPublicChannelTimeout30','manifest.json'], derived):
            copied = destination/name; copied.write_bytes(raw); copied.chmod(0o700 if name=='ArtiPublicChannelTimeout30' else 0o600)
            pins[str(artifact_dir/name)] = hashlib.sha256(raw).hexdigest()
            pins[str(copied)] = hashlib.sha256(raw).hexdigest()
    with (app/'Info.plist').open('wb') as f: plistlib.dump(info, f)
    executable = app/'MacOS/SuccessorQA'
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True).strip()
    compile_cmd = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-sdk', sdk, '-j', '1', '-module-cache-path', str(args.module_cache.resolve() if args.module_cache else out/'module-cache'), '-parse-as-library', '-DYNX_PRIVACY_ACCEPTANCE', '-I', str(import_dir), str(link_core), str(out/paths[0].name), str(out/paths[1].name), str(scratch), str(out/paths[3].name), str(out/paths[4].name), '-o', str(executable)]
    events = []
    identity = dict(rawExecutableSHA256=None, sealedExecutableSHA256=None)
    steps = [('offline-plan', [str(executable), '--prepare-only', str(out)], 12)]
    if not args.skip_launch_controls: steps.append(('offline-launch-controls', [str(executable), '--offline-launch-controls', str(out)], 8))
    if not args.skip_sampler_controls: steps.append(('offline-sampler-controls', [str(executable), '--offline-sampler-controls', str(out)], 8))
    if args.seal_only:
        steps = []
    try:
        failure = prepare_sealed_cli(out, app.parent, executable, compile_cmd, steps, pins, events, identity)
    except (OSError, subprocess.SubprocessError) as error:
        stage = events[-1]['name'] if events else 'compile-fixed-cli'
        failure = f'{stage} failed: {type(error).__name__}'
    for artifact in [scratch, app/'Info.plist', out/'CLI-PLAN.json', out/'CLI-PROFILE-PATH.txt']:
        if artifact.is_file():
            artifact.chmod(0o600)
            pins[str(artifact)] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    drift = [name for name, h in pins.items() if not Path(name).is_file() or hashlib.sha256(Path(name).read_bytes()).hexdigest() != h]
    if drift and failure is None: failure = 'source or supply drift'
    expected_prepare_stages = ['ENTERED', 'HELPER_VERIFIED', 'SUPPLY_VERIFIED']
    if derived is not None:
        expected_prepare_stages.append('DERIVED_ARTIFACT_VERIFIED')
    expected_prepare_stages += ['PROFILE_PREPARED', 'PLAN_WRITTEN']
    stage_lines = {b'P05_PUBLIC_PREPARE_' + stage.encode('ascii'): stage for stage in expected_prepare_stages}
    offline_log = out / 'offline-plan.stderr'
    observed_prepare_stages = [stage_lines[line] for line in offline_log.read_bytes().split(b'\n') if line in stage_lines] if offline_log.is_file() else []
    if failure is None and not args.seal_only and observed_prepare_stages != expected_prepare_stages:
        failure = 'offline-plan stage evidence missing or out of order'
    run_flag = '--run-channel-timeout-prepared' if derived is not None else '--run-prepared'
    status = 'FAIL' if failure else ('SEALED_OFFLINE_PREPARE_NOT_RUN' if args.seal_only else 'PROFILE_PREPARED_SCOPE_REQUIRED')
    run_command = None if args.seal_only else [str(executable), run_flag, str(out)]
    result = dict(status=status, firstCause=failure, sourceAndSupplyPins=pins, sourceDrift=drift, processes=events, runCommand=run_command, networkLeg='NOT_RUN', GUI='NOT_RUN', privacyAdmission='UNCHANGED_BLOCKED', derivedPlanTransitionRequired=derived is not None, offlinePrepareStages=observed_prepare_stages, **identity)
    (out/'PREPARATION.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
