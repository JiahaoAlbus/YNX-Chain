#!/usr/bin/env python3
"""Qualify only the original account-proof PUBLIC test stream; never grant authority."""
import json
import os
from pathlib import Path
import sys

PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
REQUIRED = (
    'TestPQCommittedAccountPUBLICContinuousEngineLayouts',
    'TestPQCommittedAccountPUBLICLifecycleAndDebt',
    'TestPQCommittedAccountPUBLICAppBeforeStoreRefused',
    'TestPQCommittedAccountPUBLICSignedEvidenceRefusals',
)

def qualify(events):
    if not events:
        raise ValueError('account-proof stream missing')
    allowed = {'start', 'run', 'pause', 'cont', 'output', 'pass'}
    for event in events:
        if not isinstance(event, dict) or event.get('Package') != PACKAGE or event.get('Action') not in allowed:
            raise ValueError('account-proof stream failed, skipped, malformed or used another package')
        if 'Test' in event and (not isinstance(event['Test'], str) or event['Test'].split('/')[0] not in REQUIRED):
            raise ValueError('account-proof stream includes foreign test')
    for name in REQUIRED:
        if sum(e.get('Test') == name and e['Action'] == 'run' for e in events) != 1:
            raise ValueError('account-proof test did not run uniquely: ' + name)
        if [e['Action'] for e in events if e.get('Test') == name and e['Action'] in ('pass', 'fail', 'skip')] != ['pass']:
            raise ValueError('account-proof test did not pass uniquely: ' + name)
    if [e['Action'] for e in events if 'Test' not in e and e['Action'] in ('pass', 'fail', 'skip')] != ['pass']:
        raise ValueError('account-proof package did not pass uniquely')
    return dict(requiredPassed=list(REQUIRED), package=PACKAGE, suitePassed=True,
                syntheticOnly=True, nodeStarted=False, keysGenerated=False,
                newSignaturesCreated=False, rootSelected=False, nativeReceipt=False,
                walletAccountAuthorized=False, publicNetwork=False)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('original JSONL and new result path required')
    result = qualify([json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()])
    result['sourceCommit'] = os.environ.get('GITHUB_SHA', 'external-source-candidate')
    with Path(sys.argv[2]).open('x') as out:
        json.dump(result, out, sort_keys=True, indent=2)
        out.write('\n')
    print('YNX_COMMITTED_ACCOUNT_PROOF_TESTS ' + json.dumps(result, sort_keys=True))
