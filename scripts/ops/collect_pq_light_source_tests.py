#!/usr/bin/env python3
"""Exact new zero-TX source tests, from the unmodified Go JSONL stream."""
import json
import pathlib
import sys

BASE = 'github.com/JiahaoAlbus/YNX-Chain/'
REQUIRED = {
    BASE + 'internal/consensus': {'TestPQLightSourcePUBLICZeroTransactionExport'},
    BASE + 'cmd/ynx-consensus-proof-verify': {'TestPQLightSourcePUBLICNormalVerifier'},
    BASE + 'cmd/ynx-comet': {'TestExportLightSourceNormalCommandStrictArguments', 'TestExportLightSourceRejectsPlanBeforeOpeningStoresOrOutput'},
}


def collect(raw):
    started, packages, running, passed = set(), set(), set(), set()
    for line in raw.splitlines():
        e = json.loads(line)
        if not isinstance(e, dict):
            raise ValueError('event object required')
        action = e.get('Action')
        if action == 'build-output':
            import_path = e.get('ImportPath', '')
            pkg = import_path.removesuffix('.test')
            if (set(e) != {'Action', 'ImportPath', 'Output'} or import_path != pkg + '.test'
                    or pkg not in REQUIRED or pkg in started or not isinstance(e['Output'], str) or not e['Output']):
                raise ValueError('foreign, late, or malformed build diagnostic')
            continue
        if set(e) - {'Time', 'Action', 'Package', 'Test', 'Elapsed', 'Output'}:
            raise ValueError('foreign event field')
        pkg, test = e.get('Package'), e.get('Test')
        if pkg not in REQUIRED or pkg in packages or action in ('skip', 'fail', 'build-fail'):
            raise ValueError('foreign package or failure/skip')
        if action == 'start' and test is None:
            if pkg in started:
                raise ValueError('duplicate package start')
            started.add(pkg)
        elif action == 'output':
            if pkg not in started or not isinstance(e.get('Output'), str):
                raise ValueError('unowned output')
        elif test is not None:
            if not isinstance(test, str) or test.split('/')[0] not in REQUIRED[pkg] or pkg not in started:
                raise ValueError('foreign test')
            key = (pkg, test)
            if action == 'run' and key not in running and key not in passed:
                running.add(key)
            elif action == 'pass' and key in running and key not in passed:
                passed.add(key)
            else:
                raise ValueError('duplicate/missing test transition')
        elif action == 'pass' and pkg in started and pkg not in packages:
            packages.add(pkg)
        else:
            raise ValueError('unknown or duplicate event')
    if packages != set(REQUIRED) or running != passed:
        raise ValueError('incomplete package/test stream')
    if {(p, t) for p, ts in REQUIRED.items() for t in ts} - passed:
        raise ValueError('required top missing')
    return {'requiredTopCount': 4, 'passedTests': len(passed), 'packages': len(packages),
            'publicDataOnly': True, 'authorityGranted': False, 'nodeStarted': False}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('exact original Go JSONL path required')
    print('YNX_PQ_LIGHT_SOURCE_TESTS ' + json.dumps(collect(pathlib.Path(sys.argv[1]).read_text()), sort_keys=True))
