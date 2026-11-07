#!/usr/bin/env python3
"""Strict original Auth/Go joint PUBLIC evidence, never an authority receipt."""
import json,os,sys
from pathlib import Path
PACKAGE='github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
TOP='TestPQCommittedAccountPUBLICAuthFinalR1Joint'
REQUIRED=[TOP]+[TOP+'/'+s for s in ('OriginalClientNotReadyReadyAndReceiptMismatch','OriginalPairedZeroPartialPhysicalDrain','UnmodifiedProductionRoot0RefusesBeforeHost')]
def qualify(events):
    if not events:raise ValueError('joint stream missing')
    for e in events:
        if not isinstance(e,dict) or e.get('Package')!=PACKAGE or e.get('Action') not in ('start','run','output','pass'):raise ValueError('joint failed/skipped/foreign event')
        if 'Test' in e and e['Test'] not in REQUIRED:raise ValueError('joint foreign test')
    for name in REQUIRED:
        if sum(e.get('Test')==name and e['Action']=='run' for e in events)!=1 or sum(e.get('Test')==name and e['Action']=='pass' for e in events)!=1:raise ValueError('joint required test not unique: '+name)
    if sum('Test' not in e and e['Action']=='pass' for e in events)!=1:raise ValueError('joint package did not pass uniquely')
    return {'requiredPassed':REQUIRED,'package':PACKAGE,'jointPUBLICPassed':True,'actualAuthProductionCPP':True,'actualGoProducer':True,'sameCaptureH10ThroughH12':True,'mismatchedSourceReceiptRefused':True,'productionRoot0Refused':True,'normalProtectedHost':False,'RootAdmission':False,'SourceAdmission':False,'NativeReceipt':False,'walletAccountAuthorized':False,'newKeysOrSignatures':False,'nodeStarted':False,'mobileLibraryQualified':False,'newArchiveBuilt':False}
if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('original JSONL and new result path required')
    result=qualify([json.loads(x) for x in Path(sys.argv[1]).read_text().splitlines()]);result['sourceCommit']=os.environ.get('GITHUB_SHA','external-source-candidate')
    with Path(sys.argv[2]).open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print('YNX_ACCOUNT_AUTH_INTEROP_TESTS '+json.dumps(result,sort_keys=True))
