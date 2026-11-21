#!/usr/bin/env python3
"""Require original synthetic safety tests without retaining private material."""
import json
import sys
from pathlib import Path

PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
REQUIRED = ('TestSyntheticEnrollmentCLIBinaryFDControls',
            'TestSyntheticEnrollmentReservationFrameRefusals',
            'TestPrivateEnrollmentFixturePathRefusals',
            'TestPrivateEnrollmentBuildIdentityMissingAndConflicting')


def qualify(events, one_package=False):
    if one_package:
        boundaries = [(i, e.get('Action')) for i, e in enumerate(events) if e.get('Package') == PACKAGE and not e.get('Test') and e.get('Action') in ('start', 'pass', 'skip', 'fail')]
        if [a for _, a in boundaries] != ['start', 'pass'] or any(e.get('Action') in ('skip', 'fail', 'build-fail') for e in events):
            raise RuntimeError('private synthetic original package incomplete or skipped')
    for name in REQUIRED:
        tests = {e.get('Test') for e in events if e.get('Test') == name or e.get('Test', '').startswith(name + '/')}
        if name not in tests:
            raise RuntimeError('private synthetic original test missing: ' + name)
        top_events = [(i, e.get('Package'), e.get('Action')) for i, e in enumerate(events) if e.get('Test') == name and e.get('Action') in ('run', 'pass', 'skip', 'fail')]
        if [(p, a) for _, p, a in top_events] != [(PACKAGE, 'run'), (PACKAGE, 'pass')]:
            raise RuntimeError('private synthetic original top test did not uniquely pass: ' + name)
        for test in tests:
            actions = [(i, e.get('Package'), e.get('Action')) for i, e in enumerate(events) if e.get('Test') == test and e.get('Action') in ('run', 'pass', 'skip', 'fail')]
            if [(p, a) for _, p, a in actions] != [(PACKAGE, 'run'), (PACKAGE, 'pass')]:
                raise RuntimeError('private synthetic original test or child did not uniquely pass: ' + test)
            if one_package and not boundaries[0][0] < actions[0][0] < actions[1][0] < boundaries[1][0]:
                raise RuntimeError('private synthetic event outside its original package')
            if test != name and not top_events[0][0] < actions[0][0] < actions[1][0] < top_events[1][0]:
                raise RuntimeError('private synthetic child outside its original test')
            if test != name:
                parent = test.rsplit('/', 1)[0]
                parent_events = [(i, e.get('Package'), e.get('Action')) for i, e in enumerate(events) if e.get('Test') == parent and e.get('Action') in ('run', 'pass', 'skip', 'fail')]
                if [(p, a) for _, p, a in parent_events] != [(PACKAGE, 'run'), (PACKAGE, 'pass')] or not parent_events[0][0] < actions[0][0] < actions[1][0] < parent_events[1][0]:
                    raise RuntimeError('private synthetic child outside its original parent')
    return list(REQUIRED)


if __name__ == '__main__':
    with Path(sys.argv[1]).open('rb') as stream:
        raw = stream.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise RuntimeError('private synthetic original event stream exceeds bound')
    qualify([json.loads(line) for line in raw.splitlines()], one_package=True)
    print('SYNTHETIC_PRIVATE_SAFETY_TESTS_PASSED dataOnly=true authorityGranted=false')
