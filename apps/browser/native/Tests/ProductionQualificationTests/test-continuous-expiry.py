#!/usr/bin/env python3
"""Only the new continuous-expiry DATA regression; no normal capability is minted."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[1]
CORE = NATIVE / 'Sources' / 'YNXBrowserCore'

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--previous-source')
    parser.add_argument('--typecheck-core', action='store_true')
    args = parser.parse_args()
    out = Path(args.output)
    if not out.is_absolute(): raise ValueError('Fresh absolute output required')
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    (out / 'tmp').mkdir(mode=0o700)
    source = CORE / 'RoutedProductionQualification.swift'
    mode_source = CORE / 'PrivacyRouteProvider.swift'
    inputs = {str(p): sha(p) for p in [source, mode_source, HERE / 'ContinuousExpiryDeltaProbe.swift']}
    text = source.read_text()
    primitive = text[text.index('public enum RoutedQualificationFailure:'):text.index('/// An opaque normal-production owner')]
    mode = next(line for line in mode_source.read_text().splitlines() if line.startswith('public enum PrivacyRouteMode:'))
    program = 'import Foundation\n' + mode + '\n' + primitive + '\n'
    define = []
    if args.previous_source:
        old = Path(args.previous_source)
        if sha(old) != '8cc2d8a524abfba2aa080fbace86c4f4fa2ad314405da126dd30f0b58169a601':
            raise ValueError('Exact original source required; no fabricated legacy RED')
        inputs[str(old)] = sha(old)
        old_text = old.read_text()
        legacy = old_text[old_text.index('struct RoutedQualificationContinuity {'):old_text.index('/// An opaque normal-production owner')]
        program += legacy.replace('struct RoutedQualificationContinuity {', 'struct LegacyQualificationContinuity {', 1) + '\n'
        define = ['-D', 'P05_LEGACY_SLEEP_CONTROL']
    program += (HERE / 'ContinuousExpiryDeltaProbe.swift').read_text()
    (out / 'ActualContinuousExpiry.swift').write_text(program)
    shutil.copy2(source, out / source.name)
    result = {'schema': 'P05_CONTINUOUS_QUALIFICATION_EXPIRY_BUILD_V1', 'inputs': inputs, 'commands': [],
              'systemSleepPerformed': False, 'qualificationConstructed': False, 'genuineIssuer': 'NOT_SUPPLIED',
              'actualNE': 'NOT_RUN', 'networkOrGUI': False, 'old8GroupsRerun': False,
              'legacySourceAvailable': bool(args.previous_source), 'typecheckCoreRequested': args.typecheck_core}
    def save(): (out / 'receipt.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    # Swift drivers on this host require an ASCII TMPDIR; all storage remains on
    # the caller's external output. This is an owned temporary alias, not HOME.
    alias_parent = Path(tempfile.mkdtemp(prefix='p05-expiry-', dir='/tmp'))
    alias = alias_parent / 'external'
    os.symlink(out, alias)
    env = dict(os.environ, TMPDIR=str(alias / 'tmp'))
    def run(command, label, timeout=45):
        row = {'label': label, 'argv': command}; result['commands'].append(row); save()
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        row['pid'] = child.pid; save()
        try: stdout, stderr = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            row['timeout'] = True; child.kill(); stdout, stderr = child.communicate(timeout=5)
        (out / (label + '.stdout')).write_bytes(stdout)
        (out / (label + '.stderr')).write_bytes(stderr)
        row.update(exit=child.returncode, originalReaped=child.returncode is not None,
                   descendantReap='NOT_OBSERVED_BY_THIS_DRIVER'); save()
        if child.returncode != 0 or row.get('timeout'): raise RuntimeError(label + ' failed')
        return stdout
    try:
        sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
        swift = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        target = platform.machine() + '-apple-macosx14.0'
        common = [swift, '-swift-version', '6', '-sdk', sdk, '-target', target, '-module-cache-path', str(alias / 'cache')]
        run(common + ['-parse-as-library'] + define + [str(alias / 'ActualContinuousExpiry.swift'), '-o', str(alias / 'ExpiryProbe')], 'new-expiry-compile')
        result['newDelta'] = json.loads(run([str(alias / 'ExpiryProbe')], 'new-expiry-runtime', timeout=10))
        if len(result['newDelta']['checks']) != (6 if args.previous_source else 5): raise RuntimeError('New cases incomplete')
        if args.typecheck_core:
            copied = out / 'Core'; copied.mkdir()
            paths = []
            for p in sorted(CORE.glob('*.swift')):
                inputs[str(p)] = sha(p); shutil.copy2(p, copied / p.name); paths.append(str(alias / 'Core' / p.name))
            # Direct frontend only: no application, linker, package or provider build.
            frontend = [swift, '-frontend', '-typecheck', '-parse-as-library', '-swift-version', '6', '-sdk', sdk,
                        '-target', target, '-module-name', 'YNXBrowserCore', '-module-cache-path', str(alias / 'cache')]
            run(frontend + paths, 'affected-normal-Core-typecheck')
            run(frontend + ['-D', 'YNX_PRIVACY_ACCEPTANCE'] + paths, 'affected-QA-Core-typecheck')
        owner = text[text.index('@MainActor public final class RoutedProductionQualification'):text.index('private enum RoutedQualificationIdentity')]
        handler = owner[owner.index('public func installRevocationHandler'):owner.index('public func revoke')]
        result['wiring'] = {
            'normalOwnerHasNoUptimeDomain': 'DispatchTime' not in owner,
            'privateConstructionChecksContinuousDeadline': 'try original.requireUnexpired(now: .now)' in owner,
            'freshCurrentBeforeHandlerAdoption': handler.index('try requireCurrent(') < handler.index('revocations.append(callback)'),
            'expirySameContinuousDeadline': 'ContinuousClock().sleep(until: deadline, tolerance: .zero)' in handler,
            'localTimerCancelledOnDeinit': 'deinit { expiry?.cancel() }' in owner,
            'genuineSupplierStillRequired': 'throw RoutedQualificationFailure.qualificationIssuerNotSupplied' in owner,
        }
        if not all(result['wiring'].values()): raise RuntimeError('Normal owner wiring missing')
        result['sourceDrift'] = {p: sha(Path(p)) for p in inputs if sha(Path(p)) != inputs[p]}
        if result['sourceDrift']: raise RuntimeError('Input source drift')
    except Exception as error:
        result['firstFailure'] = str(error)
        raise
    finally:
        save()
        alias.unlink()
        alias_parent.rmdir()
    print(json.dumps({'receipt': str(out / 'receipt.json'), 'newCases': len(result['newDelta']['checks']), 'genuineIssuer': 'NOT_SUPPLIED'}))

if __name__ == '__main__': main()
