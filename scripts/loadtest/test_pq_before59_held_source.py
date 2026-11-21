"""Original CI/log/driver source binding controls; no runtime permission."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

gate=module('pq-before59-held-source')
driver=module('pq-independent-load')
fixture=module('test_pq_commit_clock_source_qualification')
semantics=module('test_pq_before59_equivalence_readback')

def original():
    harness=fixture.ClockSourceQualificationControls()
    binding,identity,run,focused,jobs=harness.fixture()
    binding.update(source=gate.SOURCE,tree=gate.TREE,forkTree=gate.FORK,branch=gate.clock.BEFORE59_BRANCH)
    identity.update(commit=gate.SOURCE,tree=gate.TREE,forkTree=gate.FORK)
    run.update(head_sha=gate.SOURCE,head_branch=binding['branch'])
    for item in [focused,*jobs]:
        item.update(head_sha=gate.SOURCE,head_branch=binding['branch'])
    _,semantic_job,semantic_raw=semantics.fixture()
    semantic_raw=semantic_raw.replace(semantics.SOURCE.encode(),gate.SOURCE.encode())
    step=semantic_job['steps'][0]
    for item in [focused,*jobs]:
        if item['name']=='focused-go':
            item['steps'].extend(copy.deepcopy(step) if name==step['name'] else dict(name=name,status='completed',conclusion='success') for name in gate.clock.BEFORE59_STEPS)
    requirements,raw=harness.original_log(binding)
    raw+=semantic_raw;requirements['sha256']=hashlib.sha256(raw).hexdigest()
    return binding,run,focused,jobs,requirements,raw

class Before59HeldSourceControls(unittest.TestCase):
    def test_default_closed_before_metadata_or_process(self):
        self.assertIsNone(gate.BINDING);calls=[]
        with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):
            gate.qualification(metadata_reader=calls.append,focused_log_reader=calls.append)
        self.assertEqual(calls,[])
        with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):driver.select_held_source(gate.SOURCE)
        self.assertIs(driver.select_held_source(driver.HELD_TRIAL_SOURCE),driver.held_first_trial_source)

    def test_real_same_run_log_and_four_jobs_produce_source_data_only(self):
        binding,run,focused,jobs,requirements,raw=original();reads=[]
        def metadata(endpoint):return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':dict(total_count=4,jobs=jobs)}[endpoint]
        def log(*args):reads.append(args);return raw
        with mock.patch.object(gate,'BINDING',binding),mock.patch.object(gate.clock,'BINDING',binding),mock.patch.object(gate.clock,'LOG_REQUIREMENTS',requirements):
            result=gate.qualification(metadata_reader=metadata,focused_log_reader=log)
        self.assertEqual(reads,[(101,102,1)])
        self.assertTrue(result['sourceOnlyQualified'] and result['originalClockAndEquivalenceLog'])
        self.assertFalse(result['runtimePermissionGranted'] or result['independentFinality'])

    def test_cross_binding_run_attempt_source_or_log_refused(self):
        binding,run,focused,jobs,requirements,raw=original()
        def metadata(endpoint):return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':dict(total_count=4,jobs=jobs)}[endpoint]
        for mode in ('binding','source','run','attempt','log','missing_log'):
            with self.subTest(mode=mode),mock.patch.object(gate,'BINDING',copy.deepcopy(binding)),mock.patch.object(gate.clock,'BINDING',copy.deepcopy(binding)),mock.patch.object(gate.clock,'LOG_REQUIREMENTS',requirements):
                if mode=='binding':gate.BINDING['run']=999
                if mode=='source':gate.clock.BINDING['source']='f'*40;gate.BINDING['source']='f'*40
                if mode=='run':run['id']=999
                if mode=='attempt':focused['run_attempt']=2
                reader=None if mode=='missing_log' else lambda *args:raw+(b'x' if mode=='log' else b'')
                with self.assertRaises((RuntimeError,ValueError)):gate.qualification(metadata_reader=metadata,focused_log_reader=reader)
                run['id']=101;focused['run_attempt']=1

    def test_driver_refuses_before_gate_or_clock_prior_to_window(self):
        from types import SimpleNamespace
        args=SimpleNamespace(first_trial_profile=driver.HELD_TRIAL_PROFILE,commit_clock_observation=True,
            commit_observation=True,commit=gate.SOURCE,source='/synthetic/source',execute=False,rate=100)
        with mock.patch.object(driver,'validate_options',return_value=500),mock.patch.object(driver,'sender_backend_kind',return_value='public-owner'),mock.patch.object(driver.lab,'Window') as window:
            with self.assertRaisesRegex(RuntimeError,'held source'):driver.run(args)
            window.assert_not_called()
        args.commit_clock_observation=False;args.sender_backend='public-owner';args.initialize_before_load=True
        with mock.patch.object(driver.before59_held_source,'BINDING',{'CONTROL':True}), \
             mock.patch.object(driver.lab,'Window') as window:
            with self.assertRaisesRegex(RuntimeError,'requires original clock'):driver.validate_options(args)
            window.assert_not_called()

    def test_driver_rechecks_same_run_before_prepared_and_reads_original_once(self):
        from types import SimpleNamespace
        args=SimpleNamespace(first_trial_profile=driver.HELD_TRIAL_PROFILE,commit_clock_observation=True,
            commit_observation=True,commit=gate.SOURCE,source='/synthetic/source',execute=False,rate=100)
        identity=dict(commit=gate.SOURCE,tree=gate.TREE,forkTree=gate.FORK);reads=[];order=[]
        def original(*keys):reads.append(keys);return b'CONTROL original'
        def clock(identity,*,metadata_reader,focused_log_reader):
            order.append('clock');self.assertEqual(focused_log_reader(101,102,1),b'CONTROL original')
            return dict(source=gate.SOURCE,run=101,focusedJob=102,focusedOriginalLogVerified=True,
                        runtimePermissionGranted=False,pressureAuthorized=False)
        def source(*,metadata_reader,focused_log_reader):
            order.append('held');self.assertEqual(focused_log_reader(101,102,1),b'CONTROL original')
            return dict(source=gate.SOURCE,run=101,job=102)
        binding={'CONTROL':True};requirements={'CONTROL':True}
        with mock.patch.object(driver,'validate_options',return_value=500),mock.patch.object(driver,'sender_backend_kind',return_value='public-owner'), \
             mock.patch.object(driver.before59_held_source,'BINDING',binding),mock.patch.object(driver.before59_held_source.clock,'BINDING',binding), \
             mock.patch.object(driver.before59_held_source.clock,'LOG_REQUIREMENTS',requirements),mock.patch.object(driver.commit_clock_ci,'BINDING',binding), \
             mock.patch.object(driver.commit_clock_ci,'LOG_REQUIREMENTS',requirements),mock.patch.object(driver.before59_held_source,'qualification',side_effect=source), \
             mock.patch.object(driver.lab,'check_source',return_value=identity),mock.patch.object(driver.lab,'Window') as window, \
             mock.patch.object(driver.commit_clock,'COMMIT_CLOCK_SOURCE',gate.SOURCE),mock.patch.object(driver.commit_clock_ci,'qualification',side_effect=clock), \
             mock.patch.object(driver,'load_conditions',return_value={}),mock.patch.object(driver,'process_capacity',return_value={}):
            result=driver.run(args,clock_original_log_reader=original)
            self.assertEqual(result['status'],'prepared-only');self.assertEqual(order,['clock','held']);self.assertEqual(reads,[(101,102,1)])
            window.assert_not_called()
            with mock.patch.object(driver.before59_held_source,'qualification',return_value=dict(source=gate.SOURCE,run=999,job=102)):
                with self.assertRaisesRegex(RuntimeError,'source/run/job differ'):driver.run(args,clock_original_log_reader=original)
            window.assert_not_called()
            with mock.patch.object(driver.before59_held_source.clock,'LOG_REQUIREMENTS',{'other':True}):
                with self.assertRaisesRegex(RuntimeError,'run/log binding differs'):driver.run(args,clock_original_log_reader=original)
            window.assert_not_called()

if __name__=='__main__':unittest.main()
