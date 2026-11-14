#!/usr/bin/env python3
"""New normal qualification intake/continuity delta; no signed positive or NE emulation."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[1]
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute external output required')
    machine = platform.machine()
    if platform.system() != 'Darwin' or machine not in ('arm64', 'x86_64'): parser.error('Native macOS required')
    output = args.output; output.mkdir(mode=0o700)
    alias = Path(tempfile.mkdtemp(prefix='ynx-qualification-', dir='/private/tmp'))
    alias.rmdir(); alias.symlink_to(output, target_is_directory=True)
    core = sorted((NATIVE / 'Sources/YNXBrowserCore').glob('*.swift'))
    native = sorted((NATIVE / 'Sources/YNXBrowserNative').glob('*.swift'))
    owned = [NATIVE / 'Sources/YNXBrowserCore/RoutedProductionQualification.swift', NATIVE / 'Sources/YNXBrowserCore/PrivacyRouteProvider.swift', NATIVE / 'Sources/YNXBrowserNative/BrowserRouteProtection.swift', NATIVE / 'Sources/YNXBrowserNative/PrivacyRouteWindow.swift', HERE / 'Probe.swift']
    inputs = {str(path): sha(path) for path in core + native + [HERE / 'Probe.swift']}
    copied = {}
    for path in core + native + [HERE / 'Probe.swift']:
        directory = output / 'source' / path.parent.name; directory.mkdir(parents=True, exist_ok=True)
        target = directory / path.name; shutil.copy2(path, target); copied[path] = alias / 'source' / path.parent.name / path.name
    sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
    common = ['xcrun', 'swiftc', '-swift-version', '6', '-sdk', sdk, '-target', machine + '-apple-macosx14.0', '-module-name', 'YNXBrowserCore', '-parse-as-library', '-module-cache-path', str(output.parent / 'C-module-cache')]
    receipt = {'schema': 'P05_NORMAL_PRODUCTION_QUALIFICATION_BUILD_V1', 'inputs': inputs, 'commands': [], 'sdk': sdk, 'alias': str(alias), 'actualQualifiedPositive': 'NOT_RUN_ORIGINAL_ISSUER_CONTRACT_NOT_SUPPLIED', 'actualNE': 'NOT_RUN', 'oldTestsRerun': False}
    def save(): (output / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    def run(command, label, expected=0):
        receipt['commands'].append(command); save()
        try: result = subprocess.run(command, text=True, capture_output=True, timeout=90)
        except subprocess.TimeoutExpired as error:
            receipt[label + 'Timeout'] = True
            (output / (label + '.stdout')).write_bytes(error.stdout or b''); (output / (label + '.stderr')).write_bytes(error.stderr or b'')
            save(); raise
        (output / (label + '.stdout')).write_text(result.stdout); (output / (label + '.stderr')).write_text(result.stderr)
        receipt[label + 'Exit'] = result.returncode; save()
        if result.returncode != expected: raise RuntimeError(label + ' unexpected exit ' + str(result.returncode))
        return result
    try:
        cc = [str(copied[path]) for path in core]
        nn = [str(copied[path]) for path in native]
        run(common + cc + [str(copied[HERE / 'Probe.swift']), '-o', str(alias / 'QualificationProbe')], 'normal-core-probe')
        run(common + ['-D', 'YNX_PRIVACY_ACCEPTANCE', '-typecheck'] + cc, 'qa-core')
        for name, flags in [('normal', []), ('qa', ['-D', 'YNX_PRIVACY_ACCEPTANCE'])]:
            modules = output / f'{name}-modules'; modules.mkdir()
            run(common + flags + ['-emit-module', '-emit-module-path', str(modules / 'YNXBrowserCore.swiftmodule')] + cc,
                f'{name}-core-module')
            native_common = ['xcrun', 'swiftc', '-swift-version', '6', '-sdk', sdk, '-target', machine + '-apple-macosx14.0',
                             '-module-cache-path', str(output.parent / 'C-module-cache'), '-I', str(modules)]
            run(native_common + flags + ['-typecheck'] + nn, f'{name}-native-boundary')
        denied = output / 'NoCallerQualification.swift'
        denied.write_text('func cannotMint(_ c: RoutedQualificationContinuity, _ a: RoutedPlatformIsolationAdmission) { _ = RoutedProductionQualification(continuity: c, admission: a) }\n')
        result = run(common + ['-typecheck'] + cc + [str(denied)], 'private-constructor-negative', expected=1)
        if 'private' not in result.stderr or 'inaccessible' not in result.stderr: raise RuntimeError('Expected actual private constructor rejection')
        receipt['ownedSourceDrift'] = {str(path): sha(path) for path in owned} != {str(path): inputs[str(path)] for path in owned}
        receipt['otherOwnerSourceDrift'] = {path: {'snapshot': digest, 'current': sha(Path(path))} for path, digest in inputs.items() if Path(path) not in owned and sha(Path(path)) != digest}
        if receipt['ownedSourceDrift']: raise RuntimeError('C owned source drift')
        probe = subprocess.Popen([str(alias / 'QualificationProbe')], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        receipt['ownedPID'] = probe.pid; save()
        try: stdout, stderr = probe.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            receipt['runtimeTimedOut'] = True; probe.kill(); stdout, stderr = probe.communicate(timeout=5)
        (output / 'probe-result.json').write_text(stdout); (output / 'probe.stderr').write_text(stderr)
        receipt.update(runExit=probe.returncode, ownedReaped=probe.returncode is not None)
        if probe.returncode != 0 or receipt.get('runtimeTimedOut'): raise RuntimeError('Normal intake new probe failed')
        value = json.loads(stdout); receipt['newChecks'] = value['checks']
    except Exception as error: receipt['firstFailure'] = str(error); raise
    finally: save()
    print(json.dumps({'receipt': str(output / 'receipt.json'), 'newChecks': len(receipt['newChecks']), 'actualQualifiedPositive': receipt['actualQualifiedPositive']}))

if __name__ == '__main__': main()
