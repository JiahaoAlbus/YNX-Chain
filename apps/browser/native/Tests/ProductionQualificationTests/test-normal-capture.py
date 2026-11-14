#!/usr/bin/env python3
"""New non-authority normal capture/receiver delta only; no vendor, GUI, route or NE activation."""
import argparse,hashlib,json,os,platform,shutil,subprocess,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
NATIVE=HERE.parents[1]
CANONICAL=NATIVE.parent/'privacy-routing/leak-tests/platform-probe/macos-filter'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():parser.error('Fresh absolute external output required')
    arch=platform.machine()
    if platform.system()!='Darwin' or arch not in ('arm64','x86_64'):parser.error('macOS required')
    out=args.output;out.mkdir(mode=0o700)
    for name in ['source','canonical','tmp','cache','normal-files','qa-files']:(out/name).mkdir(mode=0o700)
    alias=Path(tempfile.mkdtemp(prefix='ynx-normal-capture-',dir='/private/tmp'));alias.rmdir();alias.symlink_to(out,target_is_directory=True)
    env=os.environ.copy();env['TMPDIR']=str(alias/'tmp')+'/'
    core=sorted((NATIVE/'Sources/YNXBrowserCore').glob('*.swift'))
    names=['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift','OwnedBackendAuditReader.swift','RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift','RoutedNormalProofProtocol.swift','NormalCaptureProtocol.swift','RunPolicy.swift','RoutedEnrollment.swift','BootstrapGraphPolicy.swift','EpochProtectionPolicy.swift','RootPreparationModel.swift','Provider.swift','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift','IdentityBridge.h']
    inputs=core+[CANONICAL/n for n in names]+[HERE/'NormalCaptureProbe.swift',Path(__file__).resolve()]
    before={str(p):sha(p) for p in inputs}
    if (NATIVE/'Sources/YNXBrowserCore/NormalCaptureProtocol.swift').read_bytes()!=(CANONICAL/'NormalCaptureProtocol.swift').read_bytes():raise RuntimeError('Canonical protocol mismatch')
    for p in core:shutil.copy2(p,out/'source'/p.name)
    for n in names:shutil.copy2(CANONICAL/n,out/'canonical'/n)
    original=(NATIVE/'Sources/YNXBrowserCore/RoutedProductionQualification.swift').read_text()
    pending=original[original.index('@MainActor private final class NormalCapturePending'):]
    (out/'source/NormalCaptureProbe.swift').write_text('import Foundation\n'+pending+'\n'+(HERE/'NormalCaptureProbe.swift').read_text())
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
    common=['xcrun','swiftc','-swift-version','6','-sdk',sdk,'-target',arch+'-apple-macosx14.0','-parse-as-library','-module-name','YNXBrowserCore','-module-cache-path',str(alias/'cache')]
    receipt={'schema':'P05_NORMAL_ARTIFACT_CAPTURE_DELTA_V1','inputs':before,'sdk':sdk,'alias':str(alias),'steps':[],
        'sourceScope':'Actual Core normal factory/capture, private pending primitive body, actual normal protocol/receiver/ledger. Ledger/tokens are PUBLIC DATA fixtures, not signed peers.',
        'normalQualificationPositive':'NOT_RUN_NOT_SUPPLIED','signedNEPeerPositive':'NOT_RUN','RootOrBackendStarted':False,'GUI':False,'OSSettingsOrPermissionChanged':False,'productionRouteAdmission':False,'oldQualification8AndTrial8Rerun':False}
    def save():(out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    def run(argv,label,expected=0,timeout=90):
        row={'step':label,'argv':argv};receipt['steps'].append(row);save()
        p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env);row['PID']=p.pid;save()
        try:stdout,stderr=p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            row['timeout']=True;row['effectState']='UNKNOWN-owned-process-no-retry';p.kill();stdout,stderr=p.communicate(timeout=5)
        (out/(label+'.stdout')).write_bytes(stdout);(out/(label+'.stderr')).write_bytes(stderr)
        row.update(exit=p.returncode,ownedReaped=p.returncode is not None);save()
        if p.returncode!=expected or row.get('timeout'):raise RuntimeError(label+' unexpected exit; evidence preserved')
        return stdout
    try:
        src=[str(alias/'source'/p.name) for p in core]+[str(alias/'source/NormalCaptureProbe.swift')]
        for macro,label in [([], 'normal'),(['-D','YNX_PRIVACY_ACCEPTANCE'],'qa')]:
            binary=alias/(label+'-NormalCaptureProbe')
            run(common+macro+src+['-o',str(binary)],label+'-actual-Core-new-probe-compile')
            result=json.loads(run([str(binary),str(alias/(label+'-files'))],label+'-new-normal-capture-probe',timeout=15))
            if len(result.get('groups',[]))!=9:raise RuntimeError('New group count mismatch')
            receipt[label+'NewGroups']=result
        providerNames=[n for n in names if n not in ['IdentityBridge.h','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift']]
        providerBase=['xcrun','swiftc','-swift-version','5','-sdk',sdk,'-target',arch+'-apple-macosx15.0','-typecheck','-module-cache-path',str(alias/'cache'),'-import-objc-header',str(alias/'canonical/IdentityBridge.h')]
        for macro,label in [([], 'normal'),(['-D','YNX_PRIVACY_ACCEPTANCE'],'qa')]:
            extra=['SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift'] if macro else []
            run(providerBase+macro+[str(alias/'canonical'/n) for n in providerNames+extra],label+'-actual-Provider-IPC-typecheck')
        negative=out/'source/CannotMintNormalCapture.swift';negative.write_text('let forged = RoutedNormalArtifactCapture()\n')
        run(common+['-typecheck']+[str(alias/'source'/p.name) for p in core]+[str(alias/'source/CannotMintNormalCapture.swift')],'normal-capture-private-constructor',expected=1)
        if 'private' not in (out/'normal-capture-private-constructor.stderr').read_text():raise RuntimeError('Expected private constructor diagnostic missing')
        receipt['sourceDrift']=before!={name:sha(Path(name)) for name in before}
        if receipt['sourceDrift']:raise RuntimeError('Source drift')
    except Exception as error:receipt['firstFailure']=str(error);raise
    finally:save()
    print(json.dumps({'receipt':str(out/'receipt.json'),'normalNewGroups':9,'qaNewGroups':9,'ProviderNormalQATypecheck':0,'signedPeerPositive':'NOT_RUN'}))
if __name__=='__main__':main()
