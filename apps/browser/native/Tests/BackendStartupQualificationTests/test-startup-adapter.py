#!/usr/bin/env python3
"""New opaque-owner startup/WK adapter boundary; no old intake tests or signed positive."""
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


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def method(source, marker):
    start = source.index(marker)
    opening = source.index('{', start)
    depth = 1
    cursor = opening + 1
    while depth:
        depth += (source[cursor] == '{') - (source[cursor] == '}')
        cursor += 1
    return source[start:cursor]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--normal-core-products', type=Path)
    parser.add_argument('--qa-core-products', type=Path)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        parser.error('Fresh absolute external output required')
    machine = platform.machine()
    if platform.system() != 'Darwin' or machine not in ('arm64', 'x86_64'):
        parser.error('Native macOS required')
    output = args.output
    output.mkdir(mode=0o700)
    alias = Path(tempfile.mkdtemp(prefix='ynx-startup-qualification-', dir='/private/tmp'))
    alias.rmdir()
    alias.symlink_to(output, target_is_directory=True)
    core = sorted((NATIVE / 'Sources/YNXBrowserCore').glob('*.swift'))
    names = ['BrowserRouteProtection.swift', 'RoutedBrowserPage.swift', 'PrivacyTorPlatform.swift',
             'BundledTorBackend.swift', 'TorExternalTransport.swift', 'TorProtectedRouteProvider.swift',
             'TorSnowflakePublicBrowserBackend.swift', 'SnowflakeSafePhaseRecorder.swift', 'TorPublicSearchDiagnostic.swift',
             'NymPublicSearchRuntime.swift', 'NymPublicDirectoryData.swift',
             'NymProtectedRouteProvider.swift', 'ProtectedAcceptanceConsumer.swift',
             'ProtectedAcceptanceDispatcher.swift', 'ProtectedSyntheticCanary.swift', 'ProtectedSyntheticWindow.swift']
    native = [NATIVE / 'Sources/YNXBrowserNative' / name for name in names]
    inputs = {str(path): sha(path) for path in core + native + [HERE / 'Probe.swift', Path(__file__)]}
    copied = {}
    for path in core + native + [HERE / 'Probe.swift']:
        target = output / 'source' / path.parent.name / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied[path] = alias / target.relative_to(output)
    receipt = {'schema': 'P05_BACKEND_STARTUP_QUALIFICATION_BUILD_V1', 'inputs': inputs,
               'alias': str(alias), 'commands': [], 'staticChecks': [], 'oldGroupsRerun': False,
               'actualNE': 'NOT_RUN', 'positiveQualification': 'NOT_RUN_ORIGINAL_SUPPLIER_NOT_PROVIDED',
               'applicationBuildOrInstall': False, 'GUIOrNetworkUsed': False}

    def save():
        (output / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')

    def check(value, label):
        if not value:
            raise RuntimeError(label)
        receipt['staticChecks'].append(label)

    def run(command, label, timeout):
        item = {'label': label, 'command': command}
        receipt['commands'].append(item)
        env = os.environ.copy()
        env['TMPDIR'] = str(alias) + '/'
        work = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        item['PID'] = work.pid
        save()
        try:
            stdout, stderr = work.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            item['timedOut'] = True
            work.terminate()  # Exact owned process only; no retry or discovered PID.
            try:
                stdout, stderr = work.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                item['cleanup'] = 'UNKNOWN-own-process-still-running'
                save()
                raise
        (output / (label + '.stdout')).write_bytes(stdout)
        (output / (label + '.stderr')).write_bytes(stderr)
        item.update(exit=work.returncode, reaped=work.returncode is not None)
        save()
        if item.get('timedOut') or work.returncode != 0:
            raise RuntimeError(label + ' failed exit=' + str(work.returncode))
        return stdout

    try:
        bridge = copied[native[0]].read_text()
        wrapper = method(bridge, 'func requireBackendStartupQualification(mode: PrivacyRouteMode) throws')
        check('try requireProductionQualification()' in wrapper and '.current' not in wrapper and
              'syntheticAuthority' not in wrapper, 'startup-dispatches-only-owned-production-check')
        check('configuration.mode == (mode == .tor ? .tor : .nym)' in wrapper,
              'mode-uses-typed-map-not-display-rawValue')
        check(wrapper.index('qualificationFailure') < wrapper.index('!content.invalidated') <
              wrapper.index('configuration.mode') < wrapper.index('try requireProductionQualification()'),
              'first-failure-closed-mode-precede-current-check')
        private = method(bridge, 'private func requireProductionQualification() throws')
        check(private.index('qualificationFailure') < private.index('!content.invalidated') <
              private.index('qualification.requireCurrent('), 'all-production-operations-preserve-first-failure-and-close')
        web = method(bridge, 'func makeWebView(endpoint: PrivacyRouteEndpoint) throws -> WKWebView')
        creation = web.index('TorRoutedWebViewFactory.makeWebView(')
        check('admission: qualification.admission, protection: client' in web and '.current' not in web,
              'web-factory-uses-same-owner-admission-not-global-diagnostic')
        check(web.index('try authorizeNewRequest()') < creation < web.rindex('try authorizeNewRequest()') <
              web.index('content.views.add(view)') < web.index('return view'), 'web-owner-current-before-creation-and-return')
        check(web.index('endpoint == reviewedEntry?.endpoint') < creation,
              'WebKit-proxy-target-is-last-reviewed-entry')
        route = method(bridge, 'func connectReadyBackend(provider: any PrivacyRouteProvider, explicitUserAction: UUID) async throws')
        check(route.count('entry.matches(') == 3 and route.count('entry == reviewedEntry') == 2,
              'route-connect-fences-both-await-boundaries')
        check('catch { view.stopLoading(); throw error }' in web,
              'post-creation-check-failure-does-not-publish-loadable-view')
        generated = output / 'PublicNegativeStartupDispatch.swift'
        generated.write_text('''import Foundation
import YNXBrowserCore
// PUBLIC negative dispatch fixture; deliberately cannot return any permission.
@MainActor final class PublicNegativeStartupDispatch {
    struct Configuration { let mode: RoutedIsolationMode }
    final class Content { var invalidated = false }
    let configuration: Configuration
    let content = Content()
    var qualificationFailure: RoutedQualificationFailure?
    private(set) var checks = 0
    init(mode: RoutedIsolationMode) { configuration = Configuration(mode: mode) }
    private func requireProductionQualification() throws {
        checks += 1
        throw RoutedQualificationFailure.qualificationIssuerNotSupplied
    }
''' + wrapper + '\n}\n')
        receipt['extractedWrapperSHA256'] = hashlib.sha256(wrapper.encode()).hexdigest()
        sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
        receipt['sdk'] = sdk
        for name, flag, products in [('normal', [], args.normal_core_products),
                                     ('qa', ['-D', 'YNX_PRIVACY_ACCEPTANCE'], args.qa_core_products)]:
            command = ['xcrun', 'swiftc', '-swift-version', '6', '-sdk', sdk, '-target',
                       machine + '-apple-macosx14.0', '-parse-as-library', '-module-cache-path', str(alias / 'module-cache')]
            command += flag
            if products:
                if not products.is_absolute() or not (products / 'libYNXBrowserCore.a').is_file():
                    raise RuntimeError('Supplied Core products require actual module and archive')
                module = products / 'YNXBrowserCore.swiftmodule'
                if not module.exists():
                    raise RuntimeError('Supplied Core module absent')
                module_files = sorted(module.rglob('*')) if module.is_dir() else [module]
                receipt[name + 'ReusedCoreInputs'] = {str(path): sha(path) for path in [products / 'libYNXBrowserCore.a'] +
                                                      [path for path in module_files if path.is_file()]}
                command += ['-I', str(products), '-L', str(products), '-lYNXBrowserCore']
            else:
                command += ['-D', 'YNX_ROUTE_BINDING_REDUCER_FIXTURE', '-module-name', 'YNXBrowserCore'] + [str(copied[path]) for path in core]
            command += [str(copied[path]) for path in native]
            command += [str(alias / generated.name), str(copied[HERE / 'Probe.swift']), '-o', str(alias / (name + '-probe'))]
            run(command, name + '-compile', 90)
            value = json.loads(run([str(alias / (name + '-probe'))], name + '-probe', 20))
            receipt[name + 'NewChecks'] = value['checks']
            receipt[name + 'Runtime'] = value
        receipt['sourceDrift'] = {path: {'snapshot': digest, 'current': sha(Path(path))}
                                  for path, digest in inputs.items() if sha(Path(path)) != digest}
        if receipt['sourceDrift']:
            raise RuntimeError('Source drift: preserve frozen snapshot; do not relabel')
    except Exception as error:
        receipt.setdefault('firstFailure', str(error))
        raise
    finally:
        save()
    print(json.dumps({'receipt': str(output / 'receipt.json'), 'newChecksPerMode': len(receipt['normalNewChecks']),
                      'staticChecks': len(receipt['staticChecks']), 'positiveQualification': receipt['positiveQualification']}))


if __name__ == '__main__':
    main()
