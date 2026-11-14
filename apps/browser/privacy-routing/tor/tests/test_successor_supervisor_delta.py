#!/usr/bin/env python3
"""New supervisor boundary tests. Actual children are harmless local Python only.

Scope dictionaries below are explicit synthetic DATA and never passed to a vendor,
Root, NE or production factory. No DNS, listener, private destination or backend.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--identity-delta-only', action='store_true')
    args = parser.parse_args()
    out = args.output.absolute()
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    here = Path(__file__).parent
    spec = importlib.util.spec_from_file_location('actual_successor_supervisor', here/'run_successor_public_qa.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    if args.identity_delta_only:
        fixed = out/'SuccessorQA.app/Contents/MacOS/SuccessorQA'
        fixed.parent.mkdir(parents=True);fixed.write_bytes(b'PUBLIC SYNTHETIC fixed CLI');fixed.chmod(0o700)
        argv=[str(fixed),'--run-prepared',str(out)]
        fixture_hash=hashlib.sha256(fixed.read_bytes()).hexdigest()
        prep={'runCommand':argv,'sourceAndSupplyPins':{str(fixed):fixture_hash}}
        rejected=False
        try:m.validated_argv(out,prep)
        except m.Rejected:rejected=True
        if not rejected:raise AssertionError('unreviewed CLI metadata could self-authorize')
        with patch.object(m,'CLI_SHA256',fixture_hash):
            if m.validated_argv(out,prep)!=argv:raise AssertionError('fixed artifact rejected')
            fixed.write_bytes(b'PUBLIC MUTATED fixed CLI')
            rejected=False
            try:m.validated_argv(out,prep)
            except m.Rejected:rejected=True
            if not rejected:raise AssertionError('post-pin artifact changed')
        (out/'RESULT.json').write_text(json.dumps({'status':'PASS','newControls':['unreviewed-CLI-rejected-even-with-matching-metadata','exact-pinned-synthetic-bytes-only','postcompile-substitution-rejected'],'syntheticOnly':True,'processes':0,'network':'NOT_RUN','productionCLI_SHA256':m.CLI_SHA256},indent=2)+'\n')
        print(json.dumps({'status':'PASS','newIdentityControls':3,'network':'NOT_RUN'}));return
    records = []
    now = time.time_ns()
    run_id = '12345678-abcd-abcd-abcd-123456789abc'
    plan = {'runID': run_id, 'profile': '/SYNTHETIC-PUBLIC', 'fixedTargets': m.FIXED_TARGETS, 'fixedMethod': 'GET'}
    go_scope = {'runID': run_id, 'planDeadlineUnixNano': now+640_000_000_000,
                'mappingExpiresUnixNano': now+640_000_000_000}
    seal = dict(plan, planSHA256='synthetic-plan', scopeSHA256='synthetic-go-scope', helperSHA256=m.HELPER_SHA256, notAnAuthority=True)
    scope = {'schema': 'P05_SUCCESSOR_RUNTIME_EXECUTION_SCOPE_V1', 'runID': run_id, 'attempts': 1,
             'normalPrivacyAdmission': False, 'ReleaseApproved': False, 'helperSHA256': m.HELPER_SHA256,
             'sourceInputsSHA256': m.FROZEN_SOURCE_SHA, 'planSHA256': 'synthetic-plan', 'goScopeSHA256': 'synthetic-go-scope',
             'profile': plan['profile'], 'fixedTargets': m.FIXED_TARGETS, 'fixedMethod': 'GET',
             'deadlineUnixNano': now+630_000_000_000, 'maxTotalSeconds': 650, 'maxBootstrapSeconds': 600,
             'maxHTTPSSeconds': 20, 'maxRSSBytes': 1024**3, 'maxPhysicalBytes': 256*1024**2}
    def control(name, function, accepted):
        try:
            function()
            actual = True
        except (m.Rejected, ValueError):
            actual = False
        if actual != accepted:
            raise AssertionError(name)
        records.append({'case': name, 'PASS': True, 'syntheticOnly': True})
    control('strict-envelope-valid', lambda: m.validate_scope(scope, plan, seal, go_scope, 'synthetic-plan', 'synthetic-go-scope', now), True)
    for name, updates in [('bool-not-attempt', {'attempts': True}), ('bool-not-budget', {'maxTotalSeconds': True}),
                          ('unknown-field', {'unknown': 1}), ('wrong-nonce', {'runID': 'wrong'}),
                          ('expired', {'deadlineUnixNano': now}), ('wrong-plan', {'planSHA256': 'other'}),
                          ('wrong-helper', {'helperSHA256': '0'*64}), ('extra-target', {'fixedTargets': m.FIXED_TARGETS+['https://invalid.example/']})]:
        changed = dict(scope, **updates)
        control(name, lambda changed=changed: m.validate_scope(changed, plan, seal, go_scope, 'synthetic-plan', 'synthetic-go-scope', now), False)
    control('duplicate-json', lambda: json.loads('{"attempts":1,"attempts":true}', object_pairs_hook=m.unique), False)
    artifact_dir = out/'artifact-unit'
    exe = artifact_dir/'SuccessorQA.app/Contents/MacOS/SuccessorQA'
    exe.parent.mkdir(parents=True, mode=0o700)
    exe.write_bytes(b'PUBLIC SYNTHETIC ARTIFACT, NEVER EXECUTED')
    exe.chmod(0o700)
    prep = {'runCommand': [str(exe), '--run-prepared', str(artifact_dir)],
            'sourceAndSupplyPins': {str(exe): hashlib.sha256(exe.read_bytes()).hexdigest()}}
    with patch.object(m, "CLI_SHA256", hashlib.sha256(exe.read_bytes()).hexdigest()):
        control('actual-artifact-bytes-fixed-argv', lambda: m.validated_argv(artifact_dir, prep), True)
        changed = dict(prep, runCommand=[str(exe), '--other'])
        control('arbitrary-argv-rejected', lambda: m.validated_argv(artifact_dir, changed), False)
        exe.write_bytes(b'PUBLIC MUTATED ARTIFACT')
        control('postcompile-artifact-substitution', lambda: m.validated_argv(artifact_dir, prep), False)
    # Run only the supervisor against original Popen-owned harmless children.
    # No preflight is bypassed in the product CLI: this directly tests the private
    # lifecycle component, not a scope accepted by a backend.
    real_group = m.group_members
    real_physical = m.physical
    real_journal = m.persist_record
    child_records = []
    for case in ['normal-child', 'observer-timeout', 'stat-error', 'journal-error']:
        directory = out/case
        directory.mkdir(mode=0o700)
        profile = directory/'owned-synthetic-profile'
        profile.mkdir(mode=0o700)
        seen = []
        counters = {'group': 0, 'physical': 0}
        def groups(pgid):
            counters['group'] += 1
            if case == 'observer-timeout' and counters['group'] == 1:
                raise subprocess.TimeoutExpired('synthetic ps', 2)
            return real_group(pgid)
        def physical(roots):
            counters['physical'] += 1
            if case == 'stat-error' and counters['physical'] > 1:
                raise OSError('synthetic stat refusal')
            return real_physical(roots)
        def journal(path, value):
            seen.append(copy.deepcopy(value))
            if case == 'journal-error':
                raise OSError('synthetic journal refusal')
            return real_journal(path, value)
        command = [sys.executable, '-c', 'print("PUBLIC harmless child")' if case == 'normal-child' else 'import time;time.sleep(30)']
        actual_scope = dict(scope, deadlineUnixNano=time.time_ns()+100_000_000_000)
        started = time.monotonic()
        with patch.object(m, 'group_members', side_effect=groups), patch.object(m, 'physical', side_effect=physical), patch.object(m, 'persist_record', side_effect=journal):
            code = m.supervise(directory, command, profile, actual_scope, 'SYNTHETIC-NOT-AUTHORITY')
        final = seen[-1]
        if not final.get('originalCLIReaped') or final.get('groupCleanupConfirmed') is not True or final.get('ownedRemainingPIDs') != []:
            raise AssertionError('actual child not joined: '+case)
        if m.group_members(final['PGID']):
            raise AssertionError('actual group not empty: '+case)
        expected = {'normal-child': None, 'observer-timeout': 'observation-error', 'stat-error': 'physical-observation-error', 'journal-error': 'journal-error'}[case]
        # The final failed write's attempted record includes the earlier first cause.
        if final['firstCause'] != expected or code != (0 if case == 'normal-child' else 1):
            raise AssertionError('first cause lost: '+case)
        child_records.append({'case': case, 'originalPID': final['originalPID'], 'return': final['originalWait'],
                              'reaped': True, 'actualGroupRemaining': [], 'firstCause': expected,
                              'seconds': time.monotonic()-started, 'supervisorReturn': code,
                              'receiptWriteFailedDeliberately': case == 'journal-error'})
    result = {'schema': 'P05_SUCCESSOR_SUPERVISOR_DELTA_V1', 'status': 'PASS', 'newDATAControls': records,
              'actualHarmlessChildren': child_records, 'Arti': 'NOT_RUN', 'DNS': 'NOT_RUN',
              'network': 'NOT_RUN', 'privacyAdmission': 'UNCHANGED_BLOCKED',
              'sourcePins': {str(here/n): hashlib.sha256((here/n).read_bytes()).hexdigest()
                             for n in ['run_successor_public_qa.py', 'prepare_successor_public_qa.py', Path(__file__).name]}}
    (out/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'status': 'PASS', 'DATAControls': len(records), 'harmlessChildCount': len(child_records), 'network': 'NOT_RUN'}))

if __name__ == '__main__':
    main()
