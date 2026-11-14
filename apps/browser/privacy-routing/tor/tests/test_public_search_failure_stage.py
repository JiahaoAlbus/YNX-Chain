#!/usr/bin/env python3
"""Only new PUBLIC first-stage/NSError/typed failure and redaction behavior."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);a=p.parse_args()
    out=a.output.resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False);browser=Path(__file__).resolve().parents[3]
    source=browser/'native/Sources/YNXBrowserNative/TorPublicSearchDiagnostic.swift';platformSource=source.with_name('PrivacyTorPlatform.swift');bundle=source.with_name('BundledTorBackend.swift');probe=Path(__file__).with_name('PublicSearchFailureStageDeltaProbe.swift');inputs={}
    for path in [source,platformSource,bundle,probe]:
        raw=path.read_bytes();inputs[str(path.relative_to(browser))]=hashlib.sha256(raw).hexdigest();(out/path.name).write_bytes(raw)
    text=source.read_text();actual=out/'ActualPublicFailure.swift'
    actual.write_text('import Foundation\n'+segment(platformSource.read_text(),'enum TorPlatformError:')+'\nenum BundledTorBackend {\n'+segment(bundle.read_text(),'enum Failure:')+'\n}\n@MainActor final class ActualPublicFailure {\n'+segment(text,'enum Failure:')+'''
    var firstFailure: Failure?
    var firstErrorSummary: String?
    var firstErrorDomain: String?
    var firstErrorCode: Int?
    var firstTypedFailure: String?
    var originalBackendPID: Int32?
    var backendExitStatus: Int32?
    var startupStage: String
    let adapter = FailureAdapter()
    let status = FailureStatus()
    init(stage: String) { startupStage = stage }
    func observe(_ error: Error) { recordObservedError(error) }
    func cleanupFailure() { record(.cleanupUnknown) }
'''+segment(text,'private func recordObservedError(')+'\n'+segment(text,'private func record(')+'\n}\n')
    (out/'inputs.json').write_text(json.dumps(inputs,indent=2)+'\n');events=[];failure=None
    commands=[('compile',['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library',str(actual),str(out/probe.name),'-o',str(out/'failure-stage')],90),('new-delta',[str(out/'failure-stage')],8)]
    for name,command,budget in commands:
        start=time.monotonic();c=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE);timeout=False
        try:stdout,stderr=c.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout=True;c.terminate()
            try:stdout,stderr=c.communicate(timeout=2)
            except subprocess.TimeoutExpired:c.kill();stdout,stderr=c.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr);events.append(dict(name=name,command=command,pid=c.pid,returncode=c.returncode,timeout=timeout,reaped=c.poll()is not None,seconds=time.monotonic()-start))
        if timeout or c.returncode:failure=name+' failed; first cause retained';break
    drift=[r for r,h in inputs.items() if hashlib.sha256((browser/r).read_bytes()).hexdigest()!=h]
    if drift and failure is None:failure='source drift'
    result=dict(status='FAIL'if failure else'PASS',firstCause=failure,sourceDrift=drift,processes=events,scope='actual first error class/summary methods with PUBLIC errors; no process/WK/network',old44Repeated=False)
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__=='__main__':main()
