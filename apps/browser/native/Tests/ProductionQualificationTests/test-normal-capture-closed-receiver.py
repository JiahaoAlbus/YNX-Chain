#!/usr/bin/env python3
"""New closed-receiver delta only; reuses old9+9 receipt rather than running its probe."""
import argparse,ast,hashlib,json,os,platform,shutil,subprocess,tempfile
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
    for name in ['source','canonical','tmp','cache']:(out/name).mkdir(mode=0o700)
    alias=Path(tempfile.mkdtemp(prefix='ynx-normal-closed-',dir='/private/tmp'));alias.rmdir();alias.symlink_to(out,target_is_directory=True)
    env=os.environ.copy();env['TMPDIR']=str(alias/'tmp')+'/'
    core=sorted((NATIVE/'Sources/YNXBrowserCore').glob('*.swift'))
    names=['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift','OwnedBackendAuditReader.swift','RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift','RoutedNormalProofProtocol.swift','NormalCaptureProtocol.swift','RunPolicy.swift','RoutedEnrollment.swift','BootstrapGraphPolicy.swift','EpochProtectionPolicy.swift','RootPreparationModel.swift','Provider.swift','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift','IdentityBridge.h']
    owned=[HERE/'NormalCaptureClosedReceiverProbe.swift',Path(__file__).resolve(),CANONICAL/'build.py']
    before={str(p):sha(p) for p in core+[CANONICAL/n for n in names]+owned}
    if (NATIVE/'Sources/YNXBrowserCore/NormalCaptureProtocol.swift').read_bytes()!=(CANONICAL/'NormalCaptureProtocol.swift').read_bytes():raise RuntimeError('Canonical protocol mismatch')
    for p in core:shutil.copy2(p,out/'source'/p.name)
    for n in names:shutil.copy2(CANONICAL/n,out/'canonical'/n)
    actual=(NATIVE/'Sources/YNXBrowserCore/RoutedProductionQualification.swift').read_text()
    # File-private normal ownership code is compiled verbatim into the probe file.
    # This grants no constructor/peer permission and opens only an anonymous own endpoint.
    lifetime=actual[actual.index('private final class NormalCaptureConnectionLifetime {'):actual.index('@MainActor private final class NormalCaptureTransport {')]
    pending=actual[actual.index('@MainActor private final class NormalCapturePending'):]
    (out/'source/NormalCaptureClosedReceiverProbe.swift').write_text('import Foundation\n'+lifetime+'\n'+pending+'\n'+(HERE/'NormalCaptureClosedReceiverProbe.swift').read_text())
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
    common=['xcrun','swiftc','-swift-version','6','-sdk',sdk,'-target',arch+'-apple-macosx14.0','-parse-as-library','-module-name','YNXBrowserCore','-module-cache-path',str(alias/'cache')]
    receipt={'schema':'P05_NORMAL_CAPTURE_CLOSED_RECEIVER_DELTA_V1','inputs':before,'sdk':sdk,'alias':str(alias),'steps':[],
        'scope':'Real normal Core capture path NoTeam rejection; actual generation/session/pending/lifetime primitives and own anonymous XPC invalidation; no normal authority/signature invented',
        'old9and9Rerun':False,'oldTrial18Rerun':False,'normalQualificationPositive':'NOT_RUN_NOT_SUPPLIED','signedNEPeerPositive':'NOT_RUN',
        'networkRoutesOrBackendStarted':False,'GUI':False,'OSSettingsOrPermissionChanged':False,'productionRouteAdmission':False}
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
        binary=alias/'NormalCaptureClosedReceiverProbe'
        sources=[str(alias/'source'/p.name) for p in core]
        run(common+sources+[str(alias/'source/NormalCaptureClosedReceiverProbe.swift'),'-o',str(binary)],'normal-Core-new-delta-compile')
        receipt['oldCounterexample']=json.loads(run([str(binary),'--legacy-cleared-generation'],'old-cleared-generation-counterexample',expected=1,timeout=10))
        result=json.loads(run([str(binary)],'new-closed-receiver-probe',timeout=10))
        if len(result.get('newGroups',[]))!=5:raise RuntimeError('New delta group count mismatch')
        receipt['newDelta']=result
        run(common+['-D','YNX_PRIVACY_ACCEPTANCE','-typecheck']+sources,'qa-Core-affected-typecheck')
        base=['xcrun','swiftc','-swift-version','5','-sdk',sdk,'-target',arch+'-apple-macosx15.0','-typecheck','-module-cache-path',str(alias/'cache'),'-import-objc-header',str(alias/'canonical/IdentityBridge.h')]
        provider=[n for n in names if n not in ['IdentityBridge.h','SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift']]
        for macro,label in [([], 'normal'),(['-D','YNX_PRIVACY_ACCEPTANCE'],'qa')]:
            extra=['SyntheticCanaryProtocol.swift','SyntheticProofProtocol.swift','SyntheticCanaryPolicy.swift'] if macro else []
            run(base+macro+[str(alias/'canonical'/n) for n in provider+extra],label+'-Provider-closed-receiver-typecheck')
        source=(CANONICAL/'Provider.swift').read_text();method=source[source.index('    func normalCapture('):source.index('    private func dropNormalProof(')]
        committed=method[method.index('            lock.lock()\n            do {'):]
        build=ast.parse((CANONICAL/'build.py').read_text())
        arrays=[n for n in ast.walk(build) if isinstance(n,ast.List) and any(isinstance(v,ast.Constant) and v.value=='NormalCaptureProtocol.swift' for v in n.elts)]
        wiring={
            'factoryPostAcquireExplicitDisposal':'catch {value.rejectPostAcquire(error);throw value.firstFailure ?? error}' in actual,
            'providerGenerationSurvivesObservationClear':'knownProviderGeneration:providerGeneration.value' in actual,
            'typedTimeoutLoss':'self?.close(.replyTimeout);self?.onLost?(.replyTimeout)' in actual,
            'typedCancellationLoss':'self?.close(.cancelled);self?.onLost?(.cancelled)' in actual,
            'normalProviderCaptureSessionRecheck':'try normalCaptureSessions.requireCurrent(caller.sessionID)' in committed,
            'noFileOrSignatureIOUnderCommitFlowLock':not any(x in committed for x in ['NormalCaptureArtifactReader.','PublicIdentity.inspect(']),
            'providerBuildClientIncludesProtocol':bool(arrays),
            'legacySelectorsUntouched':'normalCapture' not in (NATIVE/'Sources/YNXBrowserCore/ControlProtocol.swift').read_text(),
        }
        receipt['sourceWiringChecks']=wiring
        if not all(wiring.values()):raise RuntimeError('New source/build wiring missing')
        receipt['sourceDrift']=before!={name:sha(Path(name)) for name in before}
        if receipt['sourceDrift']:raise RuntimeError('Source drift')
    except Exception as error:receipt['firstFailure']=str(error);raise
    finally:save()
    print(json.dumps({'receipt':str(out/'receipt.json'),'newGroups':5,'old9and9Rerun':False,'signedPeer':'NOT_RUN'}))
if __name__=='__main__':main()
