#!/usr/bin/env python3
"""New proof child selector compile + pure post-identity lease negatives; never sign/activate NE."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
CLIENT = ['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift','OwnedBackendAuditReader.swift','RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift']
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute output required; preserve prior results')
    args.output.mkdir(mode=0o700)
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
    cache=args.output.parent/'C-module-cache';cache.mkdir(mode=0o700,exist_ok=True)
    providerFiles=CLIENT+['RunPolicy.swift','RoutedEnrollment.swift','BootstrapGraphPolicy.swift','EpochProtectionPolicy.swift','RootPreparationModel.swift','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift','Provider.swift']
    policyFiles=CLIENT+['SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticProofSelfTest.swift']
    inputs={name:sha(HERE/name) for name in set(providerFiles+policyFiles+['SyntheticProofAuthority.swift'])}
    base=['xcrun','swiftc','-D','YNX_PRIVACY_ACCEPTANCE','-sdk',sdk,'-module-cache-path',str(cache)]
    commands=[('provider-typecheck',base+['-typecheck','-swift-version','5','-target','arm64-apple-macosx15.0','-import-objc-header',str(HERE/'IdentityBridge.h')]+[str(HERE/name) for name in providerFiles]),
      ('proof-policy-compile',base+['-parse-as-library','-swift-version','6','-target','arm64-apple-macosx14.0']+[str(HERE/name) for name in policyFiles]+['-o',str(args.output/'SyntheticProofPolicyTests')])]
    receipt={'schema':'P05_SYNTHETIC_PROOF_SOURCE_DELTA_V1','inputs':inputs,'sdk':sdk,'steps':[], 'actualSignedXPC':'NOT_RUN','actualNE':'NOT_RUN','productionRouteAdmission':False}
    failed=False
    for name,cmd in commands:
        run=subprocess.run(cmd,text=True,capture_output=True)
        (args.output/(name+'.stdout')).write_text(run.stdout);(args.output/(name+'.stderr')).write_text(run.stderr)
        receipt['steps'].append({'step':name,'command':cmd,'exit':run.returncode})
        if run.returncode: failed=True;break
    if not failed:
        run=subprocess.run([str(args.output/'SyntheticProofPolicyTests')],text=True,capture_output=True,timeout=10)
        (args.output/'proof-policy-result.json').write_text(run.stdout);(args.output/'proof-policy-runtime.stderr').write_text(run.stderr)
        receipt['steps'].append({'step':'pure-lease-policy-not-peer-authority','exit':run.returncode});failed=bool(run.returncode)
    receipt['sourceDrift']=inputs!={name:sha(HERE/name) for name in inputs}
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if failed or receipt['sourceDrift']: raise SystemExit(1)
    print(json.dumps({'receipt':str(args.output/'receipt.json'),'actualSignedXPC':'NOT_RUN'}))
if __name__=='__main__':main()
