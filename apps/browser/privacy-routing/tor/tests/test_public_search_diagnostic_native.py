#!/usr/bin/env python3
"""Narrow SDK check: new full diagnostic + actual offline supply/adapter dependencies."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time
from test_worker_ownership import NYM_DECLARATION_SOURCE, NYM_PUBLIC_SOURCES, nym_public_declarations, segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    core_input=parser.add_mutually_exclusive_group(required=True)
    core_input.add_argument('--qa-core-products', type=Path, help='existing same-SDK/source QA Core module')
    core_input.add_argument('--current-core-sources', type=Path, help='current Core source directory; emits a module only, never a linked app')
    args = parser.parse_args(); out=args.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
    browser=Path(__file__).resolve().parents[3]
    sources=[browser/'native/Sources/YNXBrowserNative'/n for n in ['TorPublicSearchDiagnostic.swift','PrivacyTorPlatform.swift','BundledTorBackend.swift','TorProtectedRouteProvider.swift','TorExternalTransport.swift']]
    supplemental=[sources[0].with_name(n) for n in ['TorSnowflakePublicBrowserBackend.swift','SnowflakeSafePhaseRecorder.swift',*NYM_PUBLIC_SOURCES]]
    inputs={}
    extractor=Path(__file__).with_name('test_worker_ownership.py')
    for p in sources + supplemental + [sources[0].with_name(NYM_DECLARATION_SOURCE),extractor]:
        raw=p.read_bytes();inputs[str(p.relative_to(browser))]=hashlib.sha256(raw).hexdigest();(out/p.name).write_bytes(raw)
    corepins={};core_sources=[]
    if args.qa_core_products:
        core=args.qa_core_products.resolve();module=core/'YNXBrowserCore.swiftmodule'
        if module.is_dir():module_files=[p for p in module.rglob('*') if p.is_file()]
        elif module.is_file():module_files=[p for p in core.glob('YNXBrowserCore.*') if p.is_file()]
        else:raise RuntimeError('existing QA Core module not supplied')
        corepins={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in module_files}
    else:
        core=out/'current-core-module';core.mkdir(mode=0o700)
        copies=out/'current-core-source';copies.mkdir(mode=0o700)
        for p in sorted(args.current_core_sources.resolve().rglob('*.swift')):
            raw=p.read_bytes();corepins[str(p)]=hashlib.sha256(raw).hexdigest()
            copied=copies/p.name
            if copied.exists():raise RuntimeError('ambiguous Core source basename')
            copied.write_bytes(raw);core_sources.append(str(copied))
        if not core_sources:raise RuntimeError('no current Core source supplied')
    slices=out/'ActualOwnedStartupDeclarations.swift'
    slices.write_text('import Foundation\nimport YNXBrowserCore\n'+segment(sources[3].read_text(),'enum TorCoordinatorFailure:')+'\n'+segment(sources[3].read_text(),'@MainActor final class TorStartupOwnership<Value: Sendable>')+'\n'+segment(sources[4].read_text(),'enum TorTransportFailure:')+'\n')
    slices.write_text(slices.read_text()+nym_public_declarations((out/NYM_DECLARATION_SOURCE).read_text()))
    (out/'inputs.json').write_text(json.dumps(dict(source=inputs,reusedCore=corepins),indent=2)+'\n')
    sdk=subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'],text=True).strip()
    target=platform.machine()+'-apple-macosx14.0'
    commands=[]
    if core_sources:
        commands.append(('current-core-module',['/usr/bin/xcrun','swiftc','-swift-version','6','-target',target,'-sdk',sdk,'-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library','-DYNX_PRIVACY_ACCEPTANCE','-emit-module','-module-name','YNXBrowserCore','-emit-module-path',str(core/'YNXBrowserCore.swiftmodule')]+core_sources,90))
    commands += [('normal-object',['/usr/bin/xcrun','swiftc','-swift-version','6','-target',target,'-sdk',sdk,'-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library','-emit-object','-module-name','FixedDiagnosticNormalCheck',str(out/sources[0].name),'-o',str(out/'normal.o')],90),('normal-symbols',['/usr/bin/nm','-j',str(out/'normal.o')],8),('qa-sdk-typecheck',['/usr/bin/xcrun','swiftc','-swift-version','6','-target',target,'-sdk',sdk,'-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library','-typecheck','-DYNX_PRIVACY_ACCEPTANCE','-I',str(core)]+[str(out/p.name) for p in sources[:3]+supplemental]+[str(slices)],90)]
    events=[];failure=None
    for name,command,budget in commands:
        start=time.monotonic();p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE);timeout=False
        try:stdout,stderr=p.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout=True;p.terminate()
            try:stdout,stderr=p.communicate(timeout=2)
            except subprocess.TimeoutExpired:p.kill();stdout,stderr=p.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
        events.append(dict(name=name,command=command,pid=p.pid,returncode=p.returncode,timeout=timeout,reaped=p.poll()is not None,seconds=time.monotonic()-start))
        if timeout or p.returncode:failure=name+' failed; first cause preserved';break
        if name=='normal-symbols' and (b'TorPublicSearch' in stdout):failure='QA public diagnostic symbols leaked into normal build';break
    drift=[rel for rel,h in inputs.items() if hashlib.sha256((browser/rel).read_bytes()).hexdigest()!=h]
    drift += [p for p,h in corepins.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
    if drift and failure is None:failure='source/Core module drift'
    result=dict(status='FAIL'if failure else'PASS',firstCause=failure,sourceDrift=drift,processes=events,SDK=sdk,scope='normal macro-off object/symbol absence; whole new Native diagnostic SDK typecheck with actual adapter/supply and exact worker',UIArtiNetwork='NOT_RUN',fullAppBuild='NOT_RUN',CoreBuild='MODULE_EMIT_ONLY' if core_sources else 'NOT_RUN')
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__=='__main__':main()
