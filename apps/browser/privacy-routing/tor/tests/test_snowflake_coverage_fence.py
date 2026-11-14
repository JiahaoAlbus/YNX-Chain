#!/usr/bin/python3
"""Actual SDK coverage-fence delta, no GUI/backend/network.

CI requires only its same-cohort QA Core products. It may compile the same owned
harmless fixture from source. A pinned legacy artifact is optional: absent legacy
is explicitly NOT_SUPPLIED, never fabricated as an observed counterexample.
Parent/local invocations must use the existing whole-process-group resource guard.
"""
import argparse, hashlib, json, platform, shutil, subprocess, time
from pathlib import Path
from test_worker_ownership import NYM_DECLARATION_SOURCE, NYM_PUBLIC_SOURCES, nym_public_declarations, segment

NATIVE = ['PrivacyTorPlatform.swift','BundledTorBackend.swift','TorPublicSearchDiagnostic.swift','TorSnowflakePublicBrowserBackend.swift','SnowflakeSafePhaseRecorder.swift']
CONTROLS = ['SnowflakeCoverageAdapterFixture.swift','SnowflakeCoverageDeltaProbe.swift','SnowflakeBrowserHarmlessChild.swift','SnowflakeSafePhaseRecorder.swift']

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def repository_snapshot(out, native):
    target = out/'same-cohort-source'
    for name in ['native','dependencies','controls']:
        (target/name).mkdir(mode=0o700,parents=True)
    for name in NATIVE:
        shutil.copy2(native/name,target/'native'/name)
    for name in ['TorProtectedRouteProvider.swift','TorExternalTransport.swift']:
        shutil.copy2(native/name,target/'dependencies'/name)
    if 'NymPublicSearchRuntime' in (native/'TorPublicSearchDiagnostic.swift').read_text():
        for name in [*NYM_PUBLIC_SOURCES, NYM_DECLARATION_SOURCE]:
            shutil.copy2(native/name,target/'dependencies'/name)
    for name in CONTROLS:
        shutil.copy2(Path(__file__).with_name(name),target/'controls'/name)
    files = {str(p.relative_to(target)):sha(p) for p in target.rglob('*') if p.is_file()}
    manifest = dict(schema='P05_CI_SAME_SOURCE_COVERAGE_FIXTURE_V1',files=files,
                    legacySourceInputsSHA256='49ad6fbd2ea1d007fcecae4c0364bb99f6780d95baa6a59999fe41f936076995',
                    network='NOT_RUN',notAnAuthority=True)
    (target/'SOURCE-INPUTS.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return target

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['frozen-source','legacy-native','module-cache','harmless-fixture','native-source']:
        parser.add_argument('--'+name,type=Path)
    parser.add_argument('--qa-core-products',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    out=args.output.resolve(); out.mkdir(parents=True,mode=0o700,exist_ok=False)
    native=args.native_source.resolve() if args.native_source else Path(__file__).resolve().parents[3]/'native/Sources/YNXBrowserNative'
    source=args.frozen_source.resolve() if args.frozen_source else repository_snapshot(out,native)
    manifest=json.loads((source/'SOURCE-INPUTS.json').read_text()); pins=manifest['files']
    def drift():
        return [name for name,h in pins.items() if not (source/name).is_file() or sha(source/name)!=h]
    if drift(): raise ValueError('source manifest drift before compiler')
    if (source/'native/SnowflakeSafePhaseRecorder.swift').read_bytes()!=(source/'controls/SnowflakeSafePhaseRecorder.swift').read_bytes():
        raise ValueError('actual Native/test phase source drift')
    legacy=None
    if args.legacy_native:
        legacy=args.legacy_native.resolve()
        if sha(legacy.parent/'SOURCE-INPUTS.json')!=manifest['legacySourceInputsSHA256']:
            raise ValueError('legacy immutable artifact mismatch')
        old=json.loads((legacy.parent/'SOURCE-INPUTS.json').read_text())['files']
        for name,h in old.items():
            if name.startswith('native/') and sha(legacy.parent/name)!=h:
                raise ValueError('legacy Native source drift')
    core=args.qa_core_products.resolve(); module=core/'YNXBrowserCore.swiftmodule'; include=core
    if not module.exists(): module=core/'Modules/YNXBrowserCore.swiftmodule'; include=core/'Modules'
    library=core/'libYNXBrowserCore.a'
    if not library.is_file(): library=core/'YNXBrowserCore.o'
    if not module.exists() or not library.is_file(): raise ValueError('actual same-cohort full QA Core required')
    sdk=subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'],text=True,timeout=5).strip()
    cache=args.module_cache.resolve() if args.module_cache else out/'module-cache'
    base=['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-sdk',sdk,'-j','1','-module-cache-path',str(cache),'-parse-as-library','-DYNX_PRIVACY_ACCEPTANCE','-I',str(include),str(library)]
    result=dict(schema='P05_SNOWFLAKE_COVERAGE_FENCE_ACTUAL_RED_FIX_V1',status='FAIL',stages=[],
                newSourceInputsSHA256=sha(source/'SOURCE-INPUTS.json'),SDK=sdk,network='NOT_RUN',GUI='NOT_RUN',
                legacyCounterexample='PENDING' if legacy else 'NOT_SUPPLIED_NOT_RUN',
                managedPTWaitpid=False,normalPrivacyAdmission='UNCHANGED_BLOCKED')
    inputs={str(library):sha(library),str(Path(__file__).resolve()):sha(Path(__file__).resolve()),
            str(Path(__file__).with_name('test_worker_ownership.py')):sha(Path(__file__).with_name('test_worker_ownership.py'))}
    for item in (list(module.rglob('*')) if module.is_dir() else [module]):
        if item.is_file(): inputs[str(item)]=sha(item)
    def run(label,argv,budget,expected=0):
        start=time.monotonic(); child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try: stdout,stderr=child.communicate(timeout=budget); timed=False
        except subprocess.TimeoutExpired:
            timed=True; child.terminate()
            try: stdout,stderr=child.communicate(timeout=2)
            except subprocess.TimeoutExpired: child.kill(); stdout,stderr=child.communicate(timeout=2)
        (out/(label+'.stdout')).write_bytes(stdout); (out/(label+'.stderr')).write_bytes(stderr)
        result['stages'].append(dict(stage=label,argv=argv,pid=child.pid,exit=child.returncode,
                                    timeout=timed,reaped=child.poll() is not None,seconds=time.monotonic()-start))
        if timed or child.returncode!=expected:
            raise ValueError(label+' actual stage failed; preserve first stderr')
        return stdout
    try:
        if args.harmless_fixture:
            fixture=args.harmless_fixture.resolve()
            if sha(fixture)!=manifest.get('harmlessFixtureSHA256'):
                raise ValueError('expected previously compiled harmless fixture only')
            result['fixture']='REUSED_ACTUAL_HARMLESS_BYTES'
        else:
            fixture=out/'HarmlessOwnedChild'
            run('compile-owned-harmless-fixture',base+[str(source/'controls/SnowflakeBrowserHarmlessChild.swift'),'-o',str(fixture)],25)
            result['fixture']='COMPILED_SAME_SOURCE_HARMLESS_FIXTURE'
        inputs[str(fixture)]=sha(fixture)
        for cohort,native in ([('RED',legacy)] if legacy else [])+[('FIX',source/'native')]:
            target=out/cohort; target.mkdir(mode=0o700)
            for name in NATIVE:
                original=native/name; inputs[str(original)]=sha(original)
                (target/name).write_bytes(original.read_bytes())
            adapter=target/'PrivacyTorPlatform.swift'
            adapter.write_text(adapter.read_text()+(source/'controls/SnowflakeCoverageAdapterFixture.swift').read_text())
            declarations=target/'ActualOwnedDeclarations.swift'
            provider=(source/'dependencies/TorProtectedRouteProvider.swift').read_text()
            external=(source/'dependencies/TorExternalTransport.swift').read_text()
            declarations.write_text('import Foundation\nimport YNXBrowserCore\n'+segment(provider,'enum TorCoordinatorFailure:')+'\n'+segment(provider,'@MainActor final class TorStartupOwnership<Value: Sendable>')+'\n'+segment(external,'enum TorTransportFailure:')+'\n')
            nym_sources = []
            if 'NymPublicSearchRuntime' in (target/'TorPublicSearchDiagnostic.swift').read_text():
                for name in [*NYM_PUBLIC_SOURCES, NYM_DECLARATION_SOURCE]:
                    if 'dependencies/'+name not in pins:
                        raise ValueError('Nym PUBLIC dependency is not pinned: '+name)
                declarations.write_text(declarations.read_text()+nym_public_declarations(
                    (source/'dependencies'/NYM_DECLARATION_SOURCE).read_text()))
                nym_sources = [str(source/'dependencies'/name) for name in NYM_PUBLIC_SOURCES]
            binary=target/'CoverageProbe'; flags=base+(['-DP05_LEGACY_COVERAGE_RED'] if cohort=='RED' else [])
            run('compile-'+cohort,flags+[str(target/name) for name in NATIVE]+nym_sources+[str(declarations),str(source/'controls/SnowflakeCoverageDeltaProbe.swift'),'-o',str(binary)],40)
            stdout=run('actual-'+cohort,[str(binary),str(target),str(fixture)],40,1 if cohort=='RED' else 0)
            observed=json.loads(stdout)
            if cohort=='RED':
                if observed.get('status')!='EXPECTED_RED' or observed.get('actualCounterexample')!='phase_cap_suppressed_late_fatal' or observed.get('originalChildExitObserved') is not True:
                    raise ValueError('RED must be actual safety counterexample, not compiler/crash')
                result['originalRED']=observed; result['legacyCounterexample']='EXPECTED_ACTUAL_EXIT1_PRESERVED'
            else:
                if observed.get('status')!='PASS' or observed.get('newActualSDKCases')!=2 or observed.get('allOriginalChildExitsObserved') is not True:
                    raise ValueError('new FIX actual SDK cases required')
                result['newFIX']=observed
        result['status']='PASS'
    except Exception as error:
        result['firstCause']=str(error)
    result['sourceDrift']=drift(); result['externalInputs']=inputs
    result['externalDrift']=[name for name,h in inputs.items() if sha(Path(name))!=h]
    if result['sourceDrift'] or result['externalDrift']: result['status']='FAIL'
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status=result['status'],stages=len(result['stages']),network='NOT_RUN',legacy=result['legacyCounterexample'])))
    return 0 if result['status']=='PASS' else 1

if __name__=='__main__': raise SystemExit(main())
