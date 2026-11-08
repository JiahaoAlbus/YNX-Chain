"""Pure controls for the actual original streams; these are not Go receipts."""
import copy
import re
import unittest
from pathlib import Path

import test_validate_pq_remote_normal_ci as normal

CORE = ['TestPQLabLiveObservationClosedStagesAndBounds', 'TestPQLabLiveObservationDisabledAndOutputFailure']
CLI = ['TestPQLabPublicOwnerFailureDiagnosticActualRejection', 'TestPQLabPublicOwnerFailureDiagnosticClosedVocabulary', 'TestPQLabLiveObservationCommandOptInAndLegacy', 'TestPQLabLiveObservationCommandScopeAndSink', 'TestPQLabLiveObservationSignalForwarding']
SELECTOR = '^TestPQLab(SenderPUBLIC|CalleeElapsedPUBLIC|CheckpointCacheFallback|PublicOwnerFailureDiagnostic|LiveObservation)'


def assert_observation_contract(raw, cli, core):
    normal.assert_public_owner_cli_workflow_contract(cli)
    normal.assert_state_math_required_workflow_contract(core)
    if raw.count("      - 'scripts/ops/test_validate_pq_live_observation_ci.py'\n") != 2 or raw.count("          python3 -B -m unittest discover -s scripts/ops -p 'test_validate_pq_live_observation_ci.py' -v\n") != 1:
        raise AssertionError('pure contract must trigger and execute normally')
    for step, line in ((cli, '          live_observation_cli_required = '+repr(CLI)+'\n'), (cli, '          required += live_observation_cli_required\n'), (core, '          live_observation_core_required = '+repr(CORE)+'\n'), (core, '          required += '+repr(CORE)+'\n'), (core, '          live_observation_core_passed = qualify_live_observation_core(events)\n')):
        if step.count(line) != 1:
            raise AssertionError('closed observation names or actual qualifier changed')
    for step, marker, required in ((cli, 'CLI', 'live_observation_cli_required'), (core, 'CORE', 'live_observation_core_passed')):
        line = "          print('YNX_LIVE_OBSERVATION_"+marker+"_TESTS ' + json.dumps(dict(sourceCommit=os.environ['GITHUB_SHA'], requiredPassed="+required+", suitePassed=True, performanceMeasured=False, cancellationCompleted=False, nativeGrant=False), sort_keys=True))\n"
        if step.count(line) != 1:
            raise AssertionError('observation evidence cannot claim performance, cancellation or authority')


class LiveObservationCIControls(unittest.TestCase):
    def data(self):
        controls = normal.CompleteStatePartitionControls()
        root, raw, core_step, core = controls.workflow_parts()
        _, cli_step, cli, cli_events = normal.PublicOwnerSessionCIControls().cli()
        events = controls.fixture(core)
        package = 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
        at = [i for i, e in enumerate(events) if e['Action'] == 'start'][3]+1
        added = []
        for name in CORE:
            added += [dict(Package=package, Test=n, Action=a) for n,a in ((name,'run'),(name+'/public','run'),(name+'/public','pass'),(name,'pass'))]
        return root, raw, core_step, core, events[:at]+added+events[at:], cli_step, cli, cli_events

    def test_exact_source_and_original_single_calls(self):
        root, raw, core_step, core, events, cli_step, cli, cli_events = self.data()
        assert_observation_contract(raw, cli_step, core_step)
        self.assertEqual(core['live_observation_core_required'], CORE)
        self.assertEqual(cli['live_observation_cli_required'], CLI)
        self.assertEqual(core['qualify_live_observation_core'](events), CORE)
        self.assertEqual(cli['qualify_public_owner_cli'](cli_events), cli['public_owner_cli_required'])
        for names, paths in ((CORE, ['internal/consensus/pq_lab_live_observation_test.go']), (CLI, ['cmd/ynx-consensus-pq-lab/public_owner_diagnostics_test.go','cmd/ynx-consensus-pq-lab/live_materials_observation_test.go'])):
            source = '\n'.join((root / p).read_text() for p in paths)
            for name in names:
                self.assertEqual(len(re.findall(r'^func '+name+r'\(t \*testing.T\)', source, re.M)), 1)
        for name in CORE:
            groups = [g[0] for g in core['state_partitions'] if (not g[1] or re.search(g[1],name)) and (not g[2] or not re.search(g[2],name))]
            self.assertEqual(groups,['lab'])
        self.assertEqual(len(cli['required']),14)

    def test_source_mutations_preserve_old_budget_scope_and_no_grant(self):
        _, raw, core_step, _, _, cli_step, _, _ = self.data()
        variants = [(raw, cli_step.replace(SELECTOR, SELECTOR.replace('|LiveObservation',''),1), core_step), (raw,cli_step.replace('-timeout=90s','-timeout=91s',1),core_step), (raw, cli_step.replace('timeout-minutes: 3','timeout-minutes: 4',1),core_step), (raw,cli_step+'\n          go test ./cmd/ynx-consensus-pq-lab\n',core_step), (raw,cli_step,core_step.replace('-timeout=180s','-timeout=181s',1)), (raw.replace("      - 'scripts/ops/test_validate_pq_live_observation_ci.py'\n",'',1),cli_step,core_step), (raw.replace("          python3 -B -m unittest discover -s scripts/ops -p 'test_validate_pq_live_observation_ci.py' -v\n",'',1),cli_step,core_step)]
        for step_index, field in ((1,'performanceMeasured=False'),(1,'cancellationCompleted=False'),(1,'nativeGrant=False'),(2,'performanceMeasured=False'),(2,'cancellationCompleted=False'),(2,'nativeGrant=False')):
            changed = [raw,cli_step,core_step]
            marker = '          print(\'YNX_LIVE_OBSERVATION_'+('CLI' if step_index==1 else 'CORE')+'_TESTS '
            start = changed[step_index].index(marker); end = changed[step_index].index('\n',start)
            changed[step_index] = changed[step_index][:start]+changed[step_index][start:end].replace(field,field.replace('False','True'))+changed[step_index][end:]
            variants.append(tuple(changed))
        for i,v in enumerate(variants):
            with self.subTest(index=i), self.assertRaises(AssertionError): assert_observation_contract(*v)

    def reject_events(self, qualify, events, names, child):
        bad = [[], events[1:], events[:-1], events+events]
        for name in names:
            bad.append([e for e in events if e.get('Test','').split('/')[0] != name])
            for test in (name,name+'/'+child):
                for action in ('run','pass'):
                    at=next(i for i,e in enumerate(events) if e.get('Test')==test and e['Action']==action)
                    bad += [events[:at]+events[at+1:],events[:at]+[events[at]]+events[at:]]
                at=next(i for i,e in enumerate(events) if e.get('Test')==test and e['Action']=='pass')
                for action in ('fail','skip','build-fail'):
                    changed=copy.deepcopy(events);changed[at]['Action']=action;bad.append(changed)
                changed=copy.deepcopy(events);changed[at]['Package']='foreign';bad.append(changed)
        for i,changed in enumerate(bad):
            with self.subTest(index=i),self.assertRaises(RuntimeError):qualify(changed)

    def test_core_missing_run_duplicate_child_failure_wrong_package_rejected(self):
        _,_,_,scope,events,_,_,_=self.data()
        self.reject_events(scope['qualify_live_observation_core'],events,CORE,'public')

    def test_cli_missing_run_duplicate_child_failure_wrong_package_rejected(self):
        _,_,_,_,_,_,scope,events=self.data()
        self.reject_events(scope['qualify_public_owner_cli'],events,CLI,'original')

    def test_original_build_diagnostic_is_never_a_test_receipt(self):
        _,_,_,_,_,_,scope,events=self.data()
        qualify=scope['qualify_public_owner_cli'];package=events[0]['Package']
        notice=dict(Action='build-output',ImportPath=package+'.test',Output='PUBLIC compiler diagnostic\n')
        self.assertEqual(qualify([notice]+events),scope['public_owner_cli_required'])
        bad=[events[:2]+[notice]+events[2:], [dict(notice,Package=package)]+events,[dict(notice,ImportPath='foreign.test')]+events,[dict(notice,Output='')]+events,[dict(notice,Output=1)]+events,[dict(notice,Action='build-fail')]+events]
        missing=[e for e in events if e.get('Test','').split('/')[0] != CLI[0]]
        bad.append([notice]+missing)
        for i,changed in enumerate(bad):
            with self.subTest(index=i),self.assertRaises(RuntimeError):qualify(changed)

if __name__ == '__main__':
    unittest.main()
