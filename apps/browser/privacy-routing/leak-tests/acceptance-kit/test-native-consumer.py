#!/usr/bin/env python3
"""Compile and probe the actual flag-only Native consumer/page/protection. No product main or WK."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--core-products',type=Path,help='Optional exact SDK/compiler-matched Core module and static library; otherwise compile current Core source in the same module');parser.add_argument('--output',required=True,type=Path);parser.add_argument('--dispatcher-only',action='store_true',help='Only the new real dispatcher preflight; do not repeat the old12 cases');args=parser.parse_args()
    assert args.output.is_absolute() and not args.output.exists();args.output.mkdir(mode=0o700)
    if args.core_products: assert (args.core_products/'libYNXBrowserCore.a').is_file()
    names=['BrowserRouteProtection.swift','RoutedBrowserPage.swift','PrivacyTorPlatform.swift','BundledTorBackend.swift','TorExternalTransport.swift','TorProtectedRouteProvider.swift','NymProtectedRouteProvider.swift','ProtectedAcceptanceConsumer.swift','ProtectedAcceptanceDispatcher.swift','ProtectedSyntheticCanary.swift']
    sources=[ROOT/'native/Sources/YNXBrowserNative'/name for name in names]+[HERE/('native-dispatcher-probe.swift' if args.dispatcher_only else 'native-consumer-probe.swift')]
    if not args.core_products: sources=sorted((ROOT/'native/Sources/YNXBrowserCore').glob('*.swift'))+sources
    before={str(p):sha(p) for p in sources}; sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip();cache=args.output.parent/'C-module-cache';cache.mkdir(exist_ok=True)
    binary=args.output/'P05ProtectedAcceptanceProbe'
    core_arguments=['-I',str(args.core_products),'-L',str(args.core_products),'-lYNXBrowserCore'] if args.core_products else ['-module-name','YNXBrowserCore']
    cmd=['xcrun','swiftc','-parse-as-library','-swift-version','6','-D','YNX_PRIVACY_ACCEPTANCE','-sdk',sdk,'-target','arm64-apple-macosx14.0','-module-cache-path',str(cache)]+core_arguments+['-framework','AppKit','-framework','WebKit','-framework','Security','-o',str(binary)]+list(before)
    result=subprocess.run(cmd,text=True,capture_output=True);(args.output/'compile.stdout').write_text(result.stdout);(args.output/'compile.stderr').write_text(result.stderr)
    receipt={'schema':'P05_PROTECTED_CONSUMER_BUILD_V1','sourceInputs':before,'newDispatcherOnly':args.dispatcher_only,'coreCompileMode':'reuse-explicit-matching-library' if args.core_products else 'actual-Core-source-same-module','coreLibrarySHA256':sha(args.core_products/'libYNXBrowserCore.a') if args.core_products else None,'sdk':sdk,'command':cmd,'compileExit':result.returncode,'actualSignedRouteExecution':'NOT_RUN','productionRouteAdmission':False}
    if result.returncode==0:
        receipt['sourceDriftDuringCompile']=before!={str(p):sha(p) for p in sources}
        if not receipt['sourceDriftDuringCompile']:
            run=subprocess.Popen([str(binary),str(args.output/'input-tests')],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            receipt.update(runtimePID=run.pid,runtimeTimedOut=False)
            try: stdout,stderr=run.communicate(timeout=45)
            except subprocess.TimeoutExpired as error:
                receipt.update(runtimeTimedOut=True,runtimeEffectState='UNKNOWN; standalone owned probe timed out; no automatic retry')
                run.kill() # Only this Popen-owned no-product-main diagnostic process.
                try: stdout,stderr=run.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    stdout=error.stdout or b'';stderr=error.stderr or b''
                    if isinstance(stdout,bytes): stdout=stdout.decode(errors='replace')
                    if isinstance(stderr,bytes): stderr=stderr.decode(errors='replace')
                    receipt['runtimeEffectState']='UNKNOWN; timeout and reaping not confirmed'
            (args.output/'probe-receipt.json').write_text(stdout);(args.output/'runtime.stderr').write_text(stderr)
            receipt.update(binarySHA256=sha(binary),runExit=run.poll(),ownedProbeReaped=run.returncode is not None,probeReceiptSHA256=sha(args.output/'probe-receipt.json'))
    # Failure and timeout evidence must bind exact inputs/SDK/compile result before raising.
    (args.output/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    result.check_returncode()
    if receipt.get('sourceDriftDuringCompile'): raise RuntimeError('Input drift during compile; output preserved, probe not started')
    if receipt.get('runtimeTimedOut') or receipt.get('runExit')!=0: raise RuntimeError('Owned probe failed/timed out; evidence preserved, no automatic retry')
    print(json.dumps({'receipt':str(args.output/'build-receipt.json'),'probe':str(args.output/'probe-receipt.json')}))
if __name__=='__main__':main()
