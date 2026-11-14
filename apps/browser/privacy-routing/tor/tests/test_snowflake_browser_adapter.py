#!/usr/bin/python3
"""New QA descriptor + original shared adapter callee, no real backend or GUI.

Run only under the parent's fresh resource guard. Links the supplied whole Core;
never rebuilds Core, launches Arti/Lyrebird, resolves DNS or creates WK content.
"""
import argparse, hashlib, json, platform, subprocess, time
from pathlib import Path
from test_worker_ownership import NYM_DECLARATION_SOURCE, NYM_PUBLIC_SOURCES, nym_public_declarations, segment


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qa-core-products', required=True, type=Path)
    parser.add_argument('--module-cache', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(mode=0o700, parents=True, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    native = browser/'native/Sources/YNXBrowserNative'
    names = ['PrivacyTorPlatform.swift', 'BundledTorBackend.swift', 'TorPublicSearchDiagnostic.swift', 'TorSnowflakePublicBrowserBackend.swift', 'TorProtectedRouteProvider.swift', 'TorExternalTransport.swift', 'SnowflakeSafePhaseRecorder.swift']
    nym_sources = list(NYM_PUBLIC_SOURCES)
    inputs = {}
    external_phase = Path(__file__).with_name('SnowflakeSafePhaseRecorder.swift')
    if (native/'SnowflakeSafePhaseRecorder.swift').read_bytes() != external_phase.read_bytes():
        raise ValueError('Native/test phase source drift before compiler')
    inputs[str(external_phase)] = digest(external_phase)
    for name in names + nym_sources + [NYM_DECLARATION_SOURCE]:
        source = native/name; inputs[str(source)] = digest(source)
        (out/name).write_bytes(source.read_bytes())
    for name in ['SnowflakeBrowserAdapterDeltaProbe.swift', 'SnowflakeBrowserHarmlessChild.swift', 'test_worker_ownership.py', Path(__file__).name]:
        source = Path(__file__).with_name(name); inputs[str(source)] = digest(source)
        (out/name).write_bytes(source.read_bytes())
    declarations = out/'ActualOwnedDeclarations.swift'
    declarations.write_text('import Foundation\nimport YNXBrowserCore\n' + segment((out/names[4]).read_text(), 'enum TorCoordinatorFailure:') + '\n' + segment((out/names[4]).read_text(), '@MainActor final class TorStartupOwnership<Value: Sendable>') + '\n' + segment((out/names[5]).read_text(), 'enum TorTransportFailure:') + '\n')
    inputs[str(declarations)] = digest(declarations)
    declarations.write_text(declarations.read_text() + nym_public_declarations((out/NYM_DECLARATION_SOURCE).read_text()))
    core = args.qa_core_products.resolve()
    module = core/'YNXBrowserCore.swiftmodule'; import_path = core
    if not module.exists():
        module = core/'Modules/YNXBrowserCore.swiftmodule'; import_path = core/'Modules'
    library = core/'libYNXBrowserCore.a'
    if not library.is_file(): library = core/'YNXBrowserCore.o'
    if not module.exists() or not library.is_file(): raise ValueError('whole actual Core product required; no Core rebuilding')
    for path in ([library] + (list(module.rglob('*')) if module.is_dir() else [module])):
        if path.is_file(): inputs[str(path)] = digest(path)
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True, timeout=5).strip()
    flags = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-sdk', sdk, '-j', '1', '-module-cache-path', str(args.module_cache.resolve()), '-parse-as-library']
    sources = [str(out/name) for name in names[:4] + [names[6]] + nym_sources] + [str(declarations)]
    steps = [
        ('compile-harmless-owned-fixture', flags+[str(out/'SnowflakeBrowserHarmlessChild.swift'), '-o', str(out/'HarmlessOwnedChild')], 25),
        ('normal-macro-off-object', flags+['-emit-object', '-module-name', 'PublicSnowflakeMacroOff', str(out/'TorSnowflakePublicBrowserBackend.swift'), '-o', str(out/'normal-qa-leaf.o')], 15),
        ('normal-symbol-absence', ['/usr/bin/nm', '-j', str(out/'normal-qa-leaf.o')], 5),
        ('normal-adapter-typecheck', flags+['-typecheck', '-I', str(import_path)]+sources, 30),
        ('compile-qa-actual-adapter-probe', flags+['-DYNX_PRIVACY_ACCEPTANCE', '-I', str(import_path), str(library)]+sources+[str(out/'SnowflakeBrowserAdapterDeltaProbe.swift'), '-o', str(out/'SnowflakeBrowserAdapterProbe')], 35),
        ('actual-descriptor-and-shared-process-callee', [str(out/'SnowflakeBrowserAdapterProbe'), str(out), str(out/'HarmlessOwnedChild')], 40),
    ]
    events = []; failure = None
    for label, argv, budget in steps:
        start = time.monotonic(); child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timed = False
        try: stdout, stderr = child.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timed = True; child.terminate()
            try: stdout, stderr = child.communicate(timeout=2)
            except subprocess.TimeoutExpired: child.kill(); stdout, stderr = child.communicate(timeout=2)
        (out/(label+'.stdout')).write_bytes(stdout); (out/(label+'.stderr')).write_bytes(stderr)
        events.append(dict(stage=label, argv=argv, pid=child.pid, exit=child.returncode, timeout=timed, reaped=child.poll() is not None, seconds=time.monotonic()-start))
        if timed or child.returncode:
            failure = label+' failed; preserve original logs'; break
        if label == 'normal-symbol-absence' and b'TorSnowflake' in stdout:
            failure = 'QA leaf symbol in normal compile'; break
    drift = [name for name, expected in inputs.items() if digest(Path(name)) != expected]
    result = dict(schema='P05_SNOWFLAKE_PUBLIC_BROWSER_NEW_ADAPTER_DELTA_V1', status='PASS' if failure is None and not drift else 'FAIL', firstCause=failure, sourceAndCorePins=inputs, sourceDrift=drift, SDK=sdk, stages=events, actualArti='NOT_RUN', network='NOT_RUN', GUI='NOT_RUN', qualification='NONE', normalPrivacyAdmission='UNCHANGED_BLOCKED')
    (out/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status=result['status'], firstCause=failure, stages=len(events), network='NOT_RUN')))
    return 0 if result['status']=='PASS' else 1


if __name__ == '__main__': raise SystemExit(main())
