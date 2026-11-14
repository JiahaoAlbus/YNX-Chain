#!/usr/bin/env python3
"""Portable actual scratch/no-follow regression, without installed supply or Core."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);a=p.parse_args();out=a.output.resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
    browser=Path(__file__).resolve().parents[3];native=browser/'native/Sources/YNXBrowserNative';source=native/'TorPublicSearchDiagnostic.swift';bundle=native/'BundledTorBackend.swift';inputs={}
    for path in [source,bundle]:
        raw=path.read_bytes();inputs[str(path.relative_to(browser))]=hashlib.sha256(raw).hexdigest();(out/path.name).write_bytes(raw)
    actual=out/'ActualScratch.swift';s=source.read_text();b=bundle.read_text()
    actual.write_text('import Foundation\nimport Darwin\n@MainActor enum Scratch {\n'+segment(s,'enum Failure:')+'\nstatic func make() throws -> URL { try freshScratch() }\nstatic func validate(_ fd:Int32,_ path:String) throws -> URL { try validatedScratchURL(descriptor:fd,canonicalPath:path) }\n'+segment(s,'private static func freshScratch(')+'\n'+segment(s,'private static func validatedScratchURL(')+'\n}\n@MainActor enum StrictProfile {\n'+segment(b,'enum Failure:')+'\nstatic func prepare(_ url:URL) throws -> URL { try profileDirectory(applicationSupport:url,components:["YNX Browser Route State","Tor"]) }\n'+segment(b,'private static func openDirectory(')+'\n'+segment(b,'private static func profileDirectory(')+'\n}\n')
    probe=out/'Probe.swift';probe.write_text('''import Foundation
import Darwin
@main struct Probe {
 @MainActor static func main() throws {
  var checks=0
  func check(_ ok:Bool) throws { if !ok { throw NSError(domain:"ScratchDelta",code:checks) };checks+=1 }
  let root=try Scratch.make()
  let fd=open(root.path,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);try check(fd>=0);defer{close(fd)}
  let bound=try Scratch.validate(fd,root.path);try check(bound.path==root.path)
  let profile=try StrictProfile.prepare(root);try check(profile.path==root.appendingPathComponent("YNX Browser Route State/Tor").path)
  let kept=root.path+"-original"
  try check(rename(root.path,kept)==0 && mkdir(root.path,0o700)==0)
  var rejected=false;do{_=try Scratch.validate(fd,root.path)}catch Scratch.Failure.scratchRejected{rejected=true};try check(rejected)
  try check(rmdir(root.path)==0 && symlink(kept,root.path)==0)
  rejected=false;do{_=try Scratch.validate(fd,root.path)}catch Scratch.Failure.scratchRejected{rejected=true};try check(rejected)
  rejected=false;do{_=try StrictProfile.prepare(root)}catch StrictProfile.Failure.unsafeProfile{rejected=true};try check(rejected)
  print("PUBLIC_SEARCH_SCRATCH_DELTA \\(checks) checks PASS; actual fd/canonical/no-follow/inode rejection; no supply/vendor/WK/network")
 }
}
''')
    (out/'inputs.json').write_text(json.dumps(inputs,indent=2)+'\n');events=[];failure=None
    commands=[('compile',['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library',str(actual),str(probe),'-o',str(out/'scratch')],90),('new-delta',[str(out/'scratch')],8)]
    for name,cmd,budget in commands:
        start=time.monotonic();c=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE);timeout=False
        try:stdout,stderr=c.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout=True;c.terminate()
            try:stdout,stderr=c.communicate(timeout=2)
            except subprocess.TimeoutExpired:c.kill();stdout,stderr=c.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr);events.append(dict(name=name,command=cmd,pid=c.pid,returncode=c.returncode,timeout=timeout,reaped=c.poll()is not None,seconds=time.monotonic()-start))
        if timeout or c.returncode:failure=name+' failed; original failure retained';break
    drift=[r for r,h in inputs.items() if hashlib.sha256((browser/r).read_bytes()).hexdigest()!=h]
    if drift and failure is None:failure='source drift'
    result=dict(status='FAIL'if failure else'PASS',firstCause=failure,sourceDrift=drift,processes=events,scope='actual private scratch and shared no-follow directory declarations, fresh owned directories only',vendorNetworkGUI='NOT_RUN',old44Repeated=False)
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__=='__main__':main()
