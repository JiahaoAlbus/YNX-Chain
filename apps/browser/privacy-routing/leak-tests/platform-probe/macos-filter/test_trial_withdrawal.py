#!/usr/bin/env python3
"""Only new synthetic authority withdrawal/closure delta; no signed authority, socket, WK or backend."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[3] / 'native'
CORE = NATIVE / 'Sources/YNXBrowserCore'
DISPATCHER = NATIVE / 'Sources/YNXBrowserNative/ProtectedAcceptanceDispatcher.swift'
CLIENT = ['ControlProtocol.swift','ProtectionLease.swift','RoutedIsolationClient.swift','OwnedBackendAuditReader.swift',
          'RootPreparationClient.swift','OwnedBackendStartGate.swift','RootClosureObserver.swift',
          'SyntheticCanaryProtocol.swift','SyntheticTrialAuthority.swift']
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute external output required')
    architecture=platform.machine()
    if platform.system()!='Darwin' or architecture not in ('arm64','x86_64'): parser.error('macOS arm64/x86_64 required')
    args.output.mkdir(mode=0o700)
    output=args.output
    alias=Path(tempfile.mkdtemp(prefix='ynx-trial-withdrawal-',dir='/private/tmp'))
    alias.rmdir();alias.symlink_to(output,target_is_directory=True)
    (output/'tmp').mkdir();(output/'cache').mkdir()
    env=os.environ.copy();env['TMPDIR']=str(alias/'tmp')+'/'
    authority=CORE/'SyntheticTrialAuthority.swift'
    canonical=HERE/'SyntheticTrialAuthority.swift'
    if authority.read_bytes()!=canonical.read_bytes(): raise RuntimeError('Canonical/Core authority mismatch')
    selected=[CORE/name for name in CLIENT]+[CORE/'PrivacyRouteProvider.swift',DISPATCHER,canonical,
        HERE/'TrialWithdrawalSelfTest.swift',Path(__file__).resolve()]
    before={str(path):sha(path) for path in selected}
    text=authority.read_text();dispatcher=DISPATCHER.read_text()
    # Compile the *actual* withdrawal primitive and cleanup predicate, not a fake authority.
    primitive=text[text.index('enum SyntheticTrialLifetimeFailure:'):text.index('@MainActor public final class SyntheticCanaryQualification')]
    cleanup=dispatcher[dispatcher.index('enum ProtectedAcceptanceCleanupEvidence {'):dispatcher.index('/// Host partial ownership')]
    source=output/'source';source.mkdir()
    (source/'ActualWithdrawalPrimitive.swift').write_text('import Foundation\n'+primitive+'\n'+cleanup)
    shutil.copy2(HERE/'TrialWithdrawalSelfTest.swift',source/'TrialWithdrawalSelfTest.swift')
    for name in CLIENT: shutil.copy2(CORE/name,source/name)
    endpoint=(CORE/'PrivacyRouteProvider.swift').read_text().split('/// A local adapter')[0]
    (source/'ActualEndpointDATA.swift').write_text(endpoint)
    (source/'ProtectedAcceptanceDispatcher.swift').write_bytes(DISPATCHER.read_bytes())
    sdk=subprocess.check_output(['xcodebuild','-version','-sdk','macosx','Path'],text=True).strip()
    common=['xcrun','swiftc','-swift-version','6','-sdk',sdk,'-target',architecture+'-apple-macosx14.0',
            '-module-cache-path',str(alias/'cache'),'-parse-as-library']
    receipt={'schema':'P05_TRIAL_WITHDRAWAL_DELTA_V1','inputs':before,'sdk':sdk,'alias':str(alias),
        'scope':'Actual expiry primitive + exact cleanup DATA predicate + real authority/client subset typecheck. No authority/Grant/Root/NE capability fabricated.',
        'commands':[],'runtimeSteps':[],'signedXPCOrNE':'NOT_RUN','OSSocketDenial':'NOT_RUN','productionRouteAdmission':False,
        'oldGroupsRerun':False}
    def save(): (output/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    def command(argv,label,expected=0,timeout=60):
        receipt['commands'].append({'step':label,'argv':argv});save()
        process=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
        state={'step':label,'PID':process.pid,'timedOut':False}
        receipt['runtimeSteps'].append(state);save()
        try:stdout,stderr=process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            state.update(timedOut=True,effectState='UNKNOWN-owned-probe-timeout-no-retry')
            process.kill();stdout,stderr=process.communicate(timeout=5)
        (output/(label+'.stdout')).write_bytes(stdout);(output/(label+'.stderr')).write_bytes(stderr)
        state.update(exit=process.returncode,ownedProcessReaped=process.returncode is not None);save()
        if process.returncode!=expected or state['timedOut']:raise RuntimeError(label+' unexpected exit/timeout')
        return stdout
    try:
        binary=alias/'TrialWithdrawalProbe'
        command(common+[str(alias/'source/ActualWithdrawalPrimitive.swift'),str(alias/'source/TrialWithdrawalSelfTest.swift'),'-o',str(binary)],'primitive-compile')
        legacy=json.loads(command([str(binary),'--legacy-child-only'],'old-child-only-counterexample',expected=1,timeout=10))
        if legacy.get('oldActualClosureAcceptsChildReceiptWithoutHelperClosure') is not True:raise RuntimeError('Legacy counterexample not reproduced')
        receipt['oldCounterexample']=legacy
        result=json.loads(command([str(binary)],'new-withdrawal-and-cleanup',timeout=10))
        if len(result.get('cases',[]))!=8 or result.get('cleanupDATACombinations')!=10:raise RuntimeError('New delta cases incomplete')
        receipt['newDelta']=result
        snapshot=[str(alias/'source'/name) for name in CLIENT]+[str(alias/'source/ActualEndpointDATA.swift')]
        command(common+['-D','YNX_PRIVACY_ACCEPTANCE','-typecheck']+snapshot,'actual-authority-client-typecheck')
        # These are source wiring checks, not claims that signed callbacks/NE have run.
        wiring={
            'twoActualDispatcherCleanupSites':dispatcher.count('gates.allSatisfy(Self.cleanupComplete)')==2,
            'sameOwnerPreparationAndClientClose':'preparation.close(); controlClient.close()' in text,
            'routeAndQualificationCleared':'routePort = nil; routeSequence = nil; currentRequest = nil' in text and 'qualification = nil' in text,
            'asyncArmRechecks':'try verify(binding: binding); try validate(reply, request: request); currentRequest = request' in text,
            'asyncCanaryRechecks':'let reply = try await transport.status(request); try Task.checkCancellation(); try verify(binding: binding); try validate(reply, request: request)' in text,
            'asyncRouteRechecks':'before.routeSequence == after.routeSequence' in text,
            'noDispatchTimeAuthorityDeadline':'private let created = DispatchTime' not in text,
        }
        receipt['sourceWiringChecks']=wiring
        if not all(wiring.values()):raise RuntimeError('Actual source wiring missing')
        receipt['sourceDrift']=before!={name:sha(Path(name)) for name in before}
        if receipt['sourceDrift']:raise RuntimeError('Input drift')
    except Exception as error:
        receipt['firstFailure']=str(error);raise
    finally:save()
    print(json.dumps({'receipt':str(output/'receipt.json'),'newGroups':len(receipt['newDelta']['cases']),
        'cleanupDATACombinations':10,'actualAuthoritySubsetTypecheck':True,'signedXPCOrNE':'NOT_RUN'}))
if __name__=='__main__':main()
