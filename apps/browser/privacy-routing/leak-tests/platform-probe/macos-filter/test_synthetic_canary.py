#!/usr/bin/env python3
"""Only the new canary provider compile / pure callback reducer delta. Never install or activate NE."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
CLIENT = ['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift','OwnedBackendAuditReader.swift','RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift']
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute output required; preserve earlier failures')
    args.output.mkdir(mode=0o700)
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
    cache=args.output.parent/'C-module-cache';cache.mkdir(mode=0o700,exist_ok=True)
    sources=CLIENT+['RunPolicy.swift','RoutedEnrollment.swift','BootstrapGraphPolicy.swift','EpochProtectionPolicy.swift','RootPreparationModel.swift','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift','Provider.swift','SyntheticCanarySelfTest.swift']
    before={name:sha(HERE/name) for name in sources}
    base=['xcrun','swiftc','-D','YNX_PRIVACY_ACCEPTANCE','-sdk',sdk,'-module-cache-path',str(cache)]
    provider=base+['-typecheck','-swift-version','5','-target','arm64-apple-macosx15.0','-import-objc-header',str(HERE/'IdentityBridge.h')]+[str(HERE/name) for name in sources if name!='SyntheticCanarySelfTest.swift']
    policy=base+['-parse-as-library','-swift-version','6','-target','arm64-apple-macosx14.0']+[str(HERE/name) for name in CLIENT+['SyntheticCanaryProtocol.swift','SyntheticCanaryPolicy.swift','SyntheticCanarySelfTest.swift']]+['-o',str(args.output/'SyntheticCanaryPolicyTests')]
    receipt={'schema':'P05_SYNTHETIC_CANARY_SOURCE_DELTA_V1','inputs':before,'sdk':sdk,'steps':[], 'actualNECanary':'NOT_RUN','signedXPC':'NOT_RUN','productionRouteAdmission':False}
    failed=False
    for name,cmd in [('provider-typecheck',provider),('policy-compile',policy)]:
        run=subprocess.run(cmd,text=True,capture_output=True)
        (args.output/(name+'.stdout')).write_text(run.stdout);(args.output/(name+'.stderr')).write_text(run.stderr)
        receipt['steps'].append({'step':name,'command':cmd,'exit':run.returncode})
        if run.returncode: failed=True;break
    if not failed:
        run=subprocess.run([str(args.output/'SyntheticCanaryPolicyTests')],text=True,capture_output=True,timeout=10)
        (args.output/'policy-result.json').write_text(run.stdout);(args.output/'policy-runtime.stderr').write_text(run.stderr)
        receipt['steps'].append({'step':'pure-policy-not-OS','exit':run.returncode});failed=bool(run.returncode)
    receipt['sourceDrift']=before!={name:sha(HERE/name) for name in sources}
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if failed or receipt['sourceDrift']: raise SystemExit(1)
    print(json.dumps({'receipt':str(args.output/'receipt.json'),'actualNECanary':'NOT_RUN'}))
if __name__=='__main__':main()
