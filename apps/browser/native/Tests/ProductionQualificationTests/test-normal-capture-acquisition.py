#!/usr/bin/env python3
"""New normal acquisition custody delta only; no old5/9+9/18 rerun or genuine approval fixture."""
import argparse,hashlib,json,os,platform,shutil,subprocess,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
NATIVE=HERE.parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--pre-adopt-only',action='store_true',help='Only the new post-freeze pre-adopt case, not the earlier seven');a=parser.parse_args()
    if not a.output.is_absolute() or a.output.exists():parser.error('Fresh absolute external output required')
    arch=platform.machine()
    if platform.system()!='Darwin' or arch not in ('arm64','x86_64'):parser.error('Native macOS required')
    out=a.output;out.mkdir(mode=0o700)
    for name in ['source','tmp','cache']:(out/name).mkdir(mode=0o700)
    alias=Path(tempfile.mkdtemp(prefix='ynx-normal-custody-',dir='/private/tmp'));alias.rmdir();alias.symlink_to(out,target_is_directory=True)
    env=os.environ.copy();env['TMPDIR']=str(alias/'tmp')+'/'
    core=sorted((NATIVE/'Sources/YNXBrowserCore').glob('*.swift'))
    probe=HERE/'NormalCaptureAcquisitionCustodyProbe.swift'
    inputs={str(p):sha(p) for p in core+[probe,Path(__file__).resolve()]}
    for p in core+[probe]:shutil.copy2(p,out/'source'/p.name)
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
    common=['xcrun','swiftc','-swift-version','6','-sdk',sdk,'-target',arch+'-apple-macosx14.0','-parse-as-library','-module-name','YNXBrowserCore','-module-cache-path',str(alias/'cache')]
    r={'schema':'P05_NORMAL_CAPTURE_ACQUISITION_DELTA_V1','inputs':inputs,'sdk':sdk,'steps':[],
       'scope':('Verbatim actual custody primitive; only new pre-adopt PUBLIC lifecycle fixture, no normal factory executed.' if a.pre_adopt_only else 'Actual Core normal capture factory and acquisition custody; PUBLIC observation owner fixtures do not authenticate a peer or approval.'),
       'old5and9and9and18Rerun':False,'preAdoptOnly':a.pre_adopt_only,'genuineApproval':'NOT_SUPPLIED','signedPeerAndNE':'NOT_RUN','networkRouteOrGUI':False,'productionAdmission':False}
    def save():(out/'receipt.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
    def run(cmd,label,timeout=90):
        row={'step':label,'argv':cmd};r['steps'].append(row);save()
        p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env);row['PID']=p.pid;save()
        try:stdout,stderr=p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            row['timeout']=True;row['effectState']='UNKNOWN-owned-probe-no-retry';p.kill();stdout,stderr=p.communicate(timeout=5)
        (out/(label+'.stdout')).write_bytes(stdout);(out/(label+'.stderr')).write_bytes(stderr)
        row.update(exit=p.returncode,ownedReaped=p.returncode is not None);save()
        if p.returncode!=0 or row.get('timeout'):raise RuntimeError(label+' failed; first evidence preserved')
        return stdout
    try:
        paths=[str(alias/'source'/p.name) for p in core]
        if a.pre_adopt_only:
            actual=(out/'source/RoutedProductionQualification.swift').read_text()
            primitive=actual[actual.index('enum NormalCaptureCustodyFailure:'):actual.index('public enum RoutedNormalCaptureRetirement:')]
            (out/'source/ActualCustodyPrimitive.swift').write_text('import Foundation\n'+primitive)
            paths=[str(alias/'source/ActualCustodyPrimitive.swift')]
        binary=alias/'NormalCaptureAcquisitionProbe'
        define=['-D','YNX_CUSTODY_PRE_ADOPT_ONLY'] if a.pre_adopt_only else []
        run(common+define+paths+[str(alias/'source'/probe.name),'-o',str(binary)],('actual-custody-primitive-pre-adopt-compile' if a.pre_adopt_only else 'actual-normal-Core-acquisition-compile'))
        result=json.loads(run([str(binary)],'new-acquisition-custody-probe',timeout=15))
        if len(result.get('newGroups',[]))!=(1 if a.pre_adopt_only else 8):raise RuntimeError('New custody groups incomplete')
        r['newDelta']=result
        if not a.pre_adopt_only:run(common+['-D','YNX_PRIVACY_ACCEPTANCE','-typecheck']+paths,'affected-QA-Core-typecheck')
        source=(NATIVE/'Sources/YNXBrowserCore/RoutedProductionQualification.swift').read_text()
        wiring={
            'actualFactoryUsesPrivateCustody':'return try await captureCustody.acquire(' in source,
            'partialAdoptBeforeTransportOpen':'try adopt(owner) // Custody precedes open' in source,
            'trueRetirementAndDisposedRequired':'if case .observedRetired? = value.retirementResult {return value.localChannelDisposed}' in source,
            'retirementResultFromOriginalWorker':'let result=await work.value;retirementResult=result;return result' in source,
            'weakOverwriteRemoved':'WeakNormalArtifactCapture' not in source,
            'originalApprovalStillRequired':'throw RoutedQualificationFailure.qualificationIssuerNotSupplied' in source,
        }
        r['sourceWiringChecks']=wiring
        if not all(wiring.values()):raise RuntimeError('Actual factory custody wiring missing')
        r['sourceDrift']=inputs!={name:sha(Path(name)) for name in inputs}
        if r['sourceDrift']:raise RuntimeError('Input drift')
    except Exception as e:r['firstFailure']=str(e);raise
    finally:save()
    print(json.dumps({'receipt':str(out/'receipt.json'),'newGroups':len(r['newDelta']['newGroups']),'oldGroupsRerun':False,'genuineApproval':'NOT_SUPPLIED'}))
if __name__=='__main__':main()
