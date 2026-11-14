#!/usr/bin/env python3
"""Actual mount/BaseIPC compile + PUBLIC ownership lifecycle fixture; no original Auth factory."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
NATIVE=HERE.parents[1]/'Sources/YNXBrowserNative'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():parser.error('Fresh absolute external output directory required')
    args.output.mkdir(mode=0o700)
    files=[NATIVE/'BrowserPageProtectedIPC.swift',NATIVE/'BrowserOriginalPageSourceMount.swift',HERE/'Probe.swift'];inputs={str(p):sha(p) for p in files}
    machine=platform.machine()
    if machine not in ('arm64','x86_64'):raise SystemExit('Unsupported host architecture')
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip();cache=args.output.parent/'C-module-cache';cache.mkdir(mode=0o700,exist_ok=True)
    binary=args.output/'PublicSourceMountProbe';cmd=['xcrun','swiftc','-parse-as-library','-swift-version','6','-sdk',sdk,'-target',machine+'-apple-macosx14.0','-module-cache-path',str(cache),'-framework','Foundation','-framework','Security']+list(inputs)+['-o',str(binary)]
    result=subprocess.run(cmd,text=True,capture_output=True);(args.output/'compile.stdout').write_text(result.stdout);(args.output/'compile.stderr').write_text(result.stderr)
    receipt={'schema':'P05_PUBLIC_MOUNT_LIFECYCLE_BUILD_V1','inputs':inputs,'sdk':sdk,'command':cmd,'compileExit':result.returncode,'originalAuthFactory':'NOT_RUN','protectedPeerAuthentication':'NOT_RUN'}
    if result.returncode==0:
        receipt['sourceDrift']=inputs!={str(p):sha(p) for p in files}
        if not receipt['sourceDrift']:
            probe=subprocess.Popen([str(binary)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);receipt['ownedPID']=probe.pid
            try:stdout,stderr=probe.communicate(timeout=30);receipt['timedOut']=False
            except subprocess.TimeoutExpired:
                receipt['timedOut']=True;probe.kill();stdout,stderr=probe.communicate(timeout=5)
            (args.output/'probe-result.json').write_text(stdout);(args.output/'probe.stderr').write_text(stderr)
            receipt.update(runExit=probe.returncode,ownedReaped=probe.returncode is not None,binarySHA256=sha(binary))
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    result.check_returncode()
    if receipt.get('sourceDrift') or receipt.get('timedOut') or receipt.get('runExit')!=0:raise SystemExit(1)
    print(json.dumps({'receipt':str(args.output/'receipt.json'),'probe':str(args.output/'probe-result.json')}))
if __name__=='__main__':main()
