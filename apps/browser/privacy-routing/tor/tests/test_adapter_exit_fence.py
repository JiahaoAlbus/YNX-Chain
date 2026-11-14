#!/usr/bin/env python3
"""Only new actual adapter exit/callback controls; parent resource guard required."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import time
from test_worker_ownership import segment

NATIVE = ['PrivacyTorPlatform.swift', 'BundledTorBackend.swift', 'TorPublicSearchDiagnostic.swift',
          'TorSnowflakePublicBrowserBackend.swift', 'SnowflakeSafePhaseRecorder.swift']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--frozen-source', type=Path, required=True)
    p.add_argument('--legacy-native', type=Path)
    p.add_argument('--qa-core-products', type=Path, required=True)
    p.add_argument('--module-cache', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    source = a.frozen_source.resolve(); out = a.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    pins = json.loads((source / 'SOURCE-INPUTS.json').read_text())['files']
    def drift():
        return [n for n, h in pins.items() if not (source / n).is_file() or sha(source / n) != h]
    if drift(): raise ValueError('immutable source drift')
    core = a.qa_core_products.resolve(); include = core
    module = core / 'YNXBrowserCore.swiftmodule'
    if not module.exists(): include = core / 'Modules'; module = include / module.name
    library = core / 'libYNXBrowserCore.a'
    if not library.is_file(): library = core / 'YNXBrowserCore.o'
    if not module.exists() or not library.is_file(): raise ValueError('actual full QA Core required')
    external = {str(library): sha(library), str(Path(__file__).resolve()): sha(Path(__file__).resolve()),
                str(Path(__file__).with_name('test_worker_ownership.py')): sha(Path(__file__).with_name('test_worker_ownership.py'))}
    for item in (module.rglob('*') if module.is_dir() else [module]):
        if item.is_file(): external[str(item)] = sha(item)
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True, timeout=5).strip()
    base = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine() + '-apple-macosx14.0',
            '-sdk', sdk, '-j', '1', '-module-cache-path', str(a.module_cache.resolve()), '-parse-as-library',
            '-I', str(include), str(library)]
    result = dict(schema='P05_ACTUAL_ADAPTER_EXIT_FENCE_DELTA_V1', status='FAIL', stages=[],
                  sourceInputsSHA256=sha(source / 'SOURCE-INPUTS.json'), network='NOT_RUN', GUI='NOT_RUN',
                  legacy='NOT_SUPPLIED_NOT_RUN', notRealNetworkPathEvents=True)
    def run(label, argv, limit, expected=0):
        began = time.monotonic(); child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try: stdout, stderr = child.communicate(timeout=limit); timed = False
        except subprocess.TimeoutExpired:
            timed = True; child.terminate()
            try: stdout, stderr = child.communicate(timeout=2)
            except subprocess.TimeoutExpired: child.kill(); stdout, stderr = child.communicate(timeout=2)
        (out / (label + '.stdout')).write_bytes(stdout); (out / (label + '.stderr')).write_bytes(stderr)
        result['stages'].append(dict(stage=label, argv=argv, pid=child.pid, exit=child.returncode,
                                     reaped=child.poll() is not None, timeout=timed, seconds=time.monotonic()-began))
        if child.returncode != expected or timed: raise ValueError(label + ' failed; preserve actual stderr')
        return stdout
    try:
        cohorts = [('RED', a.legacy_native.resolve())] if a.legacy_native else []
        if cohorts:
            old = json.loads((cohorts[0][1].parent / 'SOURCE-INPUTS.json').read_text())['files']
            for n in NATIVE:
                if old.get('native/' + n) != sha(cohorts[0][1] / n): raise ValueError('legacy published snapshot drift')
                external[str(cohorts[0][1] / n)] = sha(cohorts[0][1] / n)
        cohorts += [('FIX', source / 'native'), ('NORMAL_NATIVE', source / 'native')]
        for name, native in cohorts:
            target = out / name; target.mkdir(mode=0o700)
            for leaf in NATIVE: shutil.copy2(native / leaf, target / leaf)
            adapter = target / 'PrivacyTorPlatform.swift'
            original = adapter.read_text()
            addition = (source / 'controls/AdapterExitFenceFixture.swift').read_text()
            if name == 'RED':
                monitor = segment(original, 'private func monitorRouteInterruptions(')
                task = monitor.split('Task { @MainActor [weak self] in', 1)[1]
                prefix = task.split('#if YNX_PRIVACY_ACCEPTANCE', 1)[0]
                if 'guard let self, self.generation == expected else { return }' not in prefix: raise ValueError('legacy real callback guard changed')
                policy = monitor[monitor.index('if !available || self.hasInitialPath'):]
                policy = '\n'.join(policy.splitlines()[:2])
                addition += '\nextension ArtiProcessAdapter { func fixtureOriginalQueuedPath(available: Bool, expected: UUID) {\nlet callback = { [weak self] in\n' + prefix + policy + '\n}\ncallback()\n} }\n'
            adapter.write_text(original + addition)
            declarations = target / 'ActualOwnedDeclarations.swift'
            provider = (source / 'dependencies/TorProtectedRouteProvider.swift').read_text()
            transport = (source / 'dependencies/TorExternalTransport.swift').read_text()
            declarations.write_text('import Foundation\nimport YNXBrowserCore\n' + segment(provider, 'enum TorCoordinatorFailure:') + '\n' + segment(provider, '@MainActor final class TorStartupOwnership<Value: Sendable>') + '\n' + segment(transport, 'enum TorTransportFailure:') + '\n')
            binary = target / 'ExitFenceProbe'
            flags = base + ([] if name == 'NORMAL_NATIVE' else ['-DYNX_PRIVACY_ACCEPTANCE']) + (['-DP05_LEGACY_EXIT_FENCE_RED'] if name == 'RED' else [])
            run('compile-' + name, flags + [str(target / n) for n in NATIVE] + [str(declarations), str(source / 'controls/AdapterExitFenceProbe.swift'), '-o', str(binary)], 45)
            observed = json.loads(run('actual-' + name, [str(binary)], 20, 1 if name == 'RED' else 0))
            if name == 'RED':
                if observed.get('status') != 'EXPECTED_RED' or len(observed.get('children', [])) != 1: raise ValueError('actual original Process counterexample required')
                result['legacy'] = observed
            else:
                if observed.get('status') != 'PASS' or observed.get('newActualLifecycleCases') != 3 or len(observed.get('children', [])) != 3: raise ValueError('actual fixed lifecycle cases required')
                result['normalNative' if name == 'NORMAL_NATIVE' else 'fixed'] = observed
                if name == 'NORMAL_NATIVE': result['normalScope'] = 'Native QA macro OFF against same full QA Core; not a whole normal application build'
        target = out / 'FIX'
        descriptor = out / 'DerivedDescriptorProbe'
        run('compile-derived-descriptor', base + ['-DYNX_PRIVACY_ACCEPTANCE'] + [str(target / n) for n in NATIVE] + [str(target / 'ActualOwnedDeclarations.swift'), str(source / 'controls/ArtiChannelTimeoutDescriptorProbe.swift'), '-o', str(descriptor)], 40)
        decoded = json.loads(run('actual-derived-descriptor', [str(descriptor)], 5))
        if decoded.get('V1Accepted') is not True or decoded.get('incompatibleOrUnsuppliedV2Rejected') != 3:
            raise ValueError('strict derived decoder controls missing')
        result['derivedDescriptorDATA'] = decoded
        result['status'] = 'PASS'
    except Exception as error: result['firstCause'] = str(error)
    result['sourceDrift'] = drift()
    result['externalInputs'] = external
    result['externalDrift'] = [name for name, value in external.items() if not Path(name).is_file() or sha(Path(name)) != value]
    if result['sourceDrift'] or result['externalDrift']: result['status'] = 'FAIL'
    (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status=result['status'], network='NOT_RUN')))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__': raise SystemExit(main())
