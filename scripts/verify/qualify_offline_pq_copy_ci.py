#!/usr/bin/env python3
"""Require original same-package execution of the offline copy controls."""
import json
import sys

SPECS = {
    'chain': ('internal/chain', ('TestConsensusSchedulePersistedCopyColdRestartPreservesOriginal', 'TestOfflinePQScheduledCopyFaultsRetainOriginalAttempt')),
    'chaind': ('cmd/ynx-chaind', (
        'TestOfflinePQScheduledCopyNormalAndCold', 'TestOfflinePQScheduledCopyRejectsPinsAndAliasesBeforeTarget',
        'TestOfflinePQScheduledCopyOutputFailureRetainsTarget', 'TestOfflinePQScheduledCopyRejectsSymlinksAndUnsafeParent',
        'TestOfflinePQScheduledCopyPreservesExistingSchedule', 'TestOfflinePQScheduledCopyRejectsAlreadyActiveSchedule',
        'TestOfflinePQScheduledCopyNormalCLI', 'TestOfflinePQScheduledCopyEmptyCLIRefusesStartup')),
}

def qualify(kind, events):
    suffix, names = SPECS[kind]
    package = 'github.com/JiahaoAlbus/YNX-Chain/' + suffix
    state = {name: 0 for name in names}
    active, passed = False, False
    for event in events:
        if event.get('Package') != package:
            continue
        action, name = event.get('Action'), event.get('Test')
        if name is None and action == 'start':
            if active or passed: raise ValueError('package execution repeated')
            active = True
        elif name is None and action in ('pass', 'fail', 'skip'):
            if not active or action != 'pass' or any(v != 2 for v in state.values()): raise ValueError('package failed or required test missing')
            active, passed = False, True
        elif name and name.split('/', 1)[0] in state:
            top = name.split('/', 1)[0]
            if not active or action in ('fail', 'skip'): raise ValueError('required test failed, skipped, or outside package')
            if name != top and state[top] != 1: raise ValueError('child outside parent run')
            if name == top and action == 'run':
                if state[top] != 0: raise ValueError('duplicate test run')
                state[top] = 1
            elif name == top and action == 'pass':
                if state[top] != 1: raise ValueError('test pass without run')
                state[top] = 2
    if not passed or active: raise ValueError('package completion missing')

if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in SPECS: raise SystemExit('expected chain|chaind and Go JSONL')
    with open(sys.argv[2], encoding='utf-8') as stream: qualify(sys.argv[1], (json.loads(line) for line in stream))
