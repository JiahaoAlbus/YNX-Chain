#!/usr/bin/env python3
"""Actual installed supply -> actual scratch/profile/config preparation; never starts a vendor."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);p.add_argument('--qa-core-products',type=Path,required=True)
    a=p.parse_args();out=a.output.resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
    browser=Path(__file__).resolve().parents[3]
    source=browser/'native/Sources/YNXBrowserNative/TorPublicSearchDiagnostic.swift'
    dependencies=[browser/'native/Sources/YNXBrowserNative'/n for n in ['PrivacyTorPlatform.swift','BundledTorBackend.swift']]
    probe=Path(__file__).with_name('PublicSearchPreparationDeltaProbe.swift');inputs={}
    for path in [source]+dependencies+[probe]:
        raw=path.read_bytes();inputs[str(path.relative_to(browser))]=hashlib.sha256(raw).hexdigest();(out/path.name).write_bytes(raw)
    actual=out/'ActualPublicScratch.swift'
    scratch_methods=segment(source.read_text(),'private static func freshScratch(')
    if 'private static func validatedScratchURL(' in source.read_text():
        scratch_methods+='\n'+segment(source.read_text(),'private static func validatedScratchURL(')
    actual.write_text('import Foundation\nimport Darwin\n@MainActor enum ActualPublicScratch {\n'+segment(source.read_text(),'enum Failure:')+'\nstatic func make() throws -> URL { try freshScratch() }\nstatic func validate(_ fd: Int32, _ path: String) throws -> URL { try validatedScratchURL(descriptor: fd, canonicalPath: path) }\n'+scratch_methods+'\n}\n')
    core=a.qa_core_products.resolve();pins={str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in [core/'libYNXBrowserCore.a']+list((core/'YNXBrowserCore.swiftmodule').rglob('*')) if path.is_file()}
    (out/'inputs.json').write_text(json.dumps(dict(source=inputs,reusedCore=pins),indent=2)+'\n')
    sdk=subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'],text=True).strip()
    command=['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-sdk',sdk,'-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library','-DYNX_PRIVACY_ACCEPTANCE','-I',str(core),'-L',str(core),'-lYNXBrowserCore']+[str(out/x.name) for x in dependencies]+[str(actual),str(out/probe.name),'-o',str(out/'preparation-probe')]
    events=[];failure=None
    for name,cmd,budget in [('compile',command,90),('offline-preparation',[str(out/'preparation-probe'),str(out)],10)]:
        start=time.monotonic();child=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE);timeout=False
        try:stdout,stderr=child.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout=True;child.terminate()
            try:stdout,stderr=child.communicate(timeout=2)
            except subprocess.TimeoutExpired:child.kill();stdout,stderr=child.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
        events.append(dict(name=name,command=cmd,pid=child.pid,returncode=child.returncode,timeout=timeout,reaped=child.poll()is not None,seconds=time.monotonic()-start))
        if timeout or child.returncode:failure=name+' failed; original receipt/stdout/stderr retained';break
    drift=[r for r,h in inputs.items() if hashlib.sha256((browser/r).read_bytes()).hexdigest()!=h]
    drift += [r for r,h in pins.items() if hashlib.sha256(Path(r).read_bytes()).hexdigest()!=h]
    if drift and failure is None:failure='source/Core drift'
    result=dict(status='FAIL'if failure else'PASS',firstCause=failure,sourceDrift=drift,processes=events,scope='actual installed verified supply and fresh synthetic temporary scratch/profile/config, CLI context only',actualGUIArtiWKNetwork='NOT_RUN')
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__=='__main__':main()
