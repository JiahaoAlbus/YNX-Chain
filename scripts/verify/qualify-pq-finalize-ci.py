#!/usr/bin/env python3
"""Qualify original Finalize observations from the same focused-job Go stream."""
import json
import os
from pathlib import Path

REQUIRED = {
 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet': ('TestOperatorFinalizeObservationDefaultAndClosedFlags', 'TestOperatorFinalizeObservationActualCallerAndFailureProjection', 'TestOperatorFinalizeObservationRetainsFailureAndDropDebt'),
 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus': ('TestFinalizeTimingDefaultAndCanonicalEquivalence', 'TestFinalizeTimingFailuresAndBoundedKnownClock', 'TestFinalizeTimingMaterializationOriginalOwnership'),
}

def qualify(events):
    if any(not isinstance(e, dict) or e.get('Action') in ('fail', 'skip', 'build-fail') for e in events):
        raise ValueError('failed, skipped or malformed original event')
    for package, names in REQUIRED.items():
        package_events = [(i,e.get('Action')) for i,e in enumerate(events) if e.get('Package') == package and not e.get('Test') and e.get('Action') in ('start','pass','fail','skip')]
        if len(package_events) != 2 or [e[1] for e in package_events] != ['start','pass']:
            raise ValueError('package did not complete once')
        start,end=package_events[0][0],package_events[1][0]
        for name in names:
            matches=[(i,e) for i,e in enumerate(events) if e.get('Test') == name and e.get('Action') in ('run','pass','fail','skip')]
            if len(matches)!=2 or [e.get('Action') for _,e in matches]!=['run','pass'] or any(e.get('Package')!=package for _,e in matches) or not start < matches[0][0] < matches[1][0] < end:
                raise ValueError('Finalize test not executed once in its package: '+name)
    return sorted(name for names in REQUIRED.values() for name in names)

if __name__ == '__main__':
    path=Path(os.environ['RUNNER_TEMP'])/'ynx-commit-finalize-clock-tests.jsonl'
    if path.stat().st_size > 8*1024*1024:
        raise SystemExit('original stream too large')
    events=[json.loads(line) for line in path.read_text().splitlines()]
    print('YNX_FINALIZE_OBSERVATION_TESTS '+json.dumps({'sourceCommit':os.environ['GITHUB_SHA'],'requiredPassed':qualify(events),'performanceMeasured':False},sort_keys=True))
