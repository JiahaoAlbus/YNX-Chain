#!/usr/bin/env python3
"""Only new normal proof scope/Provider/consumer delta. No backend, network, GUI or signing."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
NATIVE = ROOT / 'apps/browser/native'


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute external output required')
    machine = platform.machine()
    if platform.system() != 'Darwin' or machine not in ('arm64','x86_64'): parser.error('Native macOS required')
    output = args.output; output.mkdir(mode=0o700)
    alias = Path(tempfile.mkdtemp(prefix='ynx-normal-proof-tests-',dir='/private/tmp'))
    alias.rmdir(); alias.symlink_to(output,target_is_directory=True)
    core = sorted((NATIVE/'Sources/YNXBrowserCore').glob('*.swift'))
    native = [NATIVE/'Sources/YNXBrowserNative'/name for name in ['BrowserRouteProtection.swift','RoutedBrowserPage.swift',
        'PrivacyTorPlatform.swift','BundledTorBackend.swift','TorExternalTransport.swift','TorProtectedRouteProvider.swift',
        'NymProtectedRouteProvider.swift','ProtectedAcceptanceConsumer.swift','ProtectedAcceptanceDispatcher.swift',
        'ProtectedSyntheticCanary.swift','ProtectedSyntheticWindow.swift']]
    provider_names = ['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift','OwnedBackendAuditReader.swift',
        'RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift','RoutedNormalProofProtocol.swift',
        'RunPolicy.swift','RoutedEnrollment.swift','BootstrapGraphPolicy.swift','EpochProtectionPolicy.swift','RootPreparationModel.swift',
        'Provider.swift','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift','IdentityBridge.h']
    providers = [HERE/name for name in provider_names]
    tests = [HERE/'RoutedNormalProofSelfTest.swift',HERE/'RoutedNormalProofNativeProbe.swift',Path(__file__)]
    inputs = {str(p):sha(p) for p in core+native+providers+tests}
    copied = {}
    for path in core+native+providers+tests:
        folder = 'Core' if path in core else ('Native' if path in native else 'Filter')
        target = output/'source'/folder/path.name; target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(path,target); copied[path]=alias/target.relative_to(output)
    receipt={'schema':'P05_NORMAL_PROOF_SCOPE_BUILD_V1','inputs':inputs,'commands':[],'alias':str(alias),
             'actualSignedXPC':'NOT_RUN_NO_TEAM','actualNE':'NOT_RUN','oldSuitesRepeated':False,'GUIOrNetworkUsed':False}
    def save(): (output/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    def run(command,label,expected=0):
        env=os.environ.copy();env['TMPDIR']=str(alias)+'/'
        item={'label':label,'command':command};receipt['commands'].append(item)
        p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env);item['PID']=p.pid;save()
        try: stdout,stderr=p.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            item['timedOut']=True;p.terminate()
            try: stdout,stderr=p.communicate(timeout=5)
            except subprocess.TimeoutExpired: item['cleanup']='UNKNOWN-original-PID-retained';save();raise
        (output/(label+'.stdout')).write_bytes(stdout);(output/(label+'.stderr')).write_bytes(stderr)
        item.update(exit=p.returncode,reaped=p.returncode is not None);save()
        if item.get('timedOut') or p.returncode!=expected: raise RuntimeError(label+' unexpected exit='+str(p.returncode))
        return stdout,stderr
    try:
        for name in ['RoutedNormalProofProtocol.swift','RoutedNormalProofAuthority.swift']:
            if (HERE/name).read_bytes()!=(NATIVE/'Sources/YNXBrowserCore'/name).read_bytes(): raise RuntimeError('Canonical source mismatch: '+name)
        sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip();receipt['sdk']=sdk
        common=['xcrun','swiftc','-swift-version','6','-sdk',sdk,'-target',machine+'-apple-macosx14.0',
                '-module-name','YNXBrowserCore','-parse-as-library','-module-cache-path',str(alias/'module-cache')]
        cc=[str(copied[p]) for p in core];nn=[str(copied[p]) for p in native]
        run(common+cc+[str(copied[HERE/'RoutedNormalProofSelfTest.swift']),'-o',str(alias/'scope-probe')],'scope-compile')
        value=json.loads(run([str(alias/'scope-probe')],'scope-probe')[0]);receipt['newScopeChecks']=value['checks']
        denial=output/'CannotMintNormalProof.swift'
        denial.write_text('func cannotMint() { _ = RoutedNormalProofChildAuthority(); _ = RoutedNormalProofParentRegistration() }\n')
        _,stderr=run(common+['-typecheck']+cc+[str(alias/denial.name)],'private-construction-negative',expected=1)
        if b'inaccessible' not in stderr or b'private' not in stderr: raise RuntimeError('Expected actual private initializer rejection')
        provider=['xcrun','swiftc','-swift-version','5','-sdk',sdk,'-target',machine+'-apple-macosx15.0',
                  '-module-name','YNXPrivacyFilter','-parse-as-library','-module-cache-path',str(alias/'module-cache'),
                  '-import-objc-header',str(copied[HERE/'IdentityBridge.h']),'-typecheck']
        pp=[str(copied[p]) for p in providers if p.suffix=='.swift']
        run(provider+pp,'normal-provider-typecheck')
        run(provider+['-D','YNX_PRIVACY_ACCEPTANCE']+pp,'qa-provider-typecheck')
        for label,flags in [('normal',[]),('qa',['-D','YNX_PRIVACY_ACCEPTANCE'])]:
            run(common+flags+cc+nn+[str(copied[HERE/'RoutedNormalProofNativeProbe.swift']),'-o',str(alias/(label+'-consumer-probe'))],label+'-native-compile')
            value=json.loads(run([str(alias/(label+'-consumer-probe'))],label+'-native-probe')[0]);receipt[label+'NativeChecks']=value['checks']
        receipt['sourceDrift']={str(p):{'snapshot':v,'current':sha(Path(p))} for p,v in inputs.items() if sha(Path(p))!=v}
        if receipt['sourceDrift']: raise RuntimeError('Source drift; frozen results are not current source proof')
    except Exception as error: receipt.setdefault('firstFailure',str(error));raise
    finally: save()
    print(json.dumps({'receipt':str(output/'receipt.json'),'newScopeChecks':len(receipt['newScopeChecks']),
                      'newNativeChecksPerBuild':3,'actualSignedXPC':'NOT_RUN_NO_TEAM'}))


if __name__=='__main__':main()
