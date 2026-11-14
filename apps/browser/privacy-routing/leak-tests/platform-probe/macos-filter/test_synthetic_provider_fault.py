#!/usr/bin/env python3
"""New self-fault custody DATA/actual NoTeam and provider compile only; never activate NE."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
CORE = ROOT / 'native/Sources/YNXBrowserCore'

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output
    if not out.is_absolute() or out.exists(): parser.error('Fresh absolute output required')
    out.mkdir(mode=0o700)
    for leaf in ['tmp', 'Core', 'Provider', 'journal']:
        (out / leaf).mkdir(mode=0o700)
    inputs = {}
    def adopt(path, destination):
        inputs[str(path)] = sha(path)
        shutil.copy2(path, destination)
    for path in sorted(CORE.glob('*.swift')): adopt(path, out / 'Core' / path.name)
    provider_names = ['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift',
        'OwnedBackendAuditReader.swift','RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift',
        'RoutedNormalProofProtocol.swift','NormalCaptureProtocol.swift','RunPolicy.swift','RoutedEnrollment.swift',
        'BootstrapGraphPolicy.swift','EpochProtectionPolicy.swift','RootPreparationModel.swift',
        'SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift',
        'SyntheticProviderFaultProtocol.swift','Provider.swift','IdentityBridge.h']
    for name in provider_names: adopt(HERE / name, out / 'Provider' / name)
    adopt(HERE / 'SyntheticProviderFaultSelfTest.swift', out / 'SyntheticProviderFaultSelfTest.swift')
    for name in ['SyntheticProviderFaultProtocol.swift', 'SyntheticProviderFaultAuthority.swift']:
        if sha(CORE / name) != sha(HERE / name): raise RuntimeError('Canonical/Core drift: ' + name)
        inputs[str(HERE / name)] = sha(HERE / name)
    inputs[str(HERE / 'build.py')] = sha(HERE / 'build.py')
    receipt = {'schema': 'P05_SYNTHETIC_PROVIDER_SELF_FAULT_DELTA_V1', 'inputs': inputs, 'commands': [],
        'actualProviderRunning': False, 'signedProviderXPC': 'NOT_RUN', 'NECrashDrop': 'NOT_RUN',
        'normalQualification': False, 'oldGroupsRerun': False, 'networkOrGUI': False}
    def save(): (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    alias_dir = Path(tempfile.mkdtemp(prefix='p05-fault-', dir='/tmp'))
    alias = alias_dir / 'external'; os.symlink(out, alias)
    env = dict(os.environ, TMPDIR=str(alias / 'tmp'))
    def run(label, command, expected=0, timeout=60):
        row = {'label': label, 'argv': command}; receipt['commands'].append(row); save()
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        row['pid'] = child.pid; save()
        try: stdout, stderr = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            row['timedOut'] = True; child.kill()
            stdout, stderr = child.communicate(timeout=5)
        row.update(exit=child.returncode, originalReaped=child.returncode is not None,
                   stdoutEOF=True, stderrEOF=True, localFDsClosed=child.stdout.closed and child.stderr.closed,
                   descendantReap='NOT_OBSERVED_BY_THIS_DRIVER')
        (out / (label + '.stdout')).write_bytes(stdout); (out / (label + '.stderr')).write_bytes(stderr); save()
        if child.returncode != expected or row.get('timedOut'): raise RuntimeError(label + ' failed')
        return stdout
    try:
        sdk = subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'], text=True).strip()
        swift = subprocess.check_output(['xcrun','--find','swiftc'], text=True).strip()
        target = platform.machine() + '-apple-macosx14.0'
        common = [swift,'-swift-version','6','-sdk',sdk,'-target',target,'-module-cache-path',str(alias / 'cache')]
        paths = [str(alias / 'Core' / path.name) for path in sorted((out / 'Core').glob('*.swift'))]
        receipt['sdk'] = sdk; save()
        # One new actual Core binary; no app/SwiftPM/NE target or old tests.
        run('actual-Core-client-compile', common + ['-j1','-num-threads','1','-parse-as-library','-D','YNX_PRIVACY_ACCEPTANCE',
            '-D','P05_FULL_FAULT_CLIENT_PROBE','-module-name','YNXBrowserCore','-emit-module',
            '-emit-module-path',str(alias / 'YNXBrowserCore.swiftmodule'),'-emit-executable'] + paths +
            [str(alias / 'SyntheticProviderFaultSelfTest.swift'),'-o',str(alias / 'ProviderFaultProbe')], timeout=75)
        receipt['newChecks'] = json.loads(run('actual-Core-policy-NoTeam-runtime', [str(alias / 'ProviderFaultProbe'),str((out / 'journal').resolve())], timeout=10))
        if receipt['newChecks']['count'] < 30: raise RuntimeError('New controls missing')
        run('actual-owned-self-exit-primitive', [str(alias / 'ProviderFaultProbe'),'--owned-harmless-self-exit'], expected=86, timeout=5)
        # Compile the real receiver with explicit destructive-test opt-in.
        provider = [str(alias / 'Provider' / name) for name in provider_names if name.endswith('.swift')]
        run('actual-provider-new-selector-typecheck', [swift,'-frontend','-typecheck','-parse-as-library','-swift-version','5',
            '-sdk',sdk,'-target',platform.machine()+'-apple-macosx15.0','-module-cache-path',str(alias/'cache'),
            '-D','YNX_PRIVACY_ACCEPTANCE','-D','YNX_SYNTHETIC_PROVIDER_SELF_FAULT',
            '-import-objc-header',str(alias/'Provider/IdentityBridge.h')] + provider)
        # A rejected builder option has no output mutation, compiler or NE side effect.
        invalid = out / 'invalid-provider-output'
        run('builder-rejects-normal-self-fault', ['/usr/bin/python3',str(HERE/'build.py'),
            '--output',str(invalid),'--synthetic-provider-self-fault'], expected=2, timeout=5)
        if invalid.exists(): raise RuntimeError('Invalid recipe mutated output')
        receipt['builderRejectedBeforeMutation'] = True
        receipt['sourceDrift'] = {p:sha(Path(p)) for p in inputs if sha(Path(p)) != inputs[p]}
        if receipt['sourceDrift']: raise RuntimeError('Inputs changed; original result preserved')
    except Exception as error:
        receipt.setdefault('firstFailure', str(error)); raise
    finally:
        save(); alias.unlink(); alias_dir.rmdir()
    print(json.dumps({'receipt':str(out/'receipt.json'),'checks':receipt['newChecks']['count'], 'actualNE':'NOT_RUN'}))

if __name__ == '__main__': main()
