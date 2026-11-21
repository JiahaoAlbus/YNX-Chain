"""Normal backend admission/assembly only; no Go, node or signer is executed."""
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


spec=importlib.util.spec_from_file_location('sender_backend_driver',Path(__file__).with_name('pq-independent-load.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)


def args(**changes):
    value=dict(mode='online',rate=100,accounts=500,per_account=1,seconds=5,tail_seconds=30,
               proof_timeout=30,staged_publication=True,execute=True,commit=d.PUBLIC_OWNER_ABI_SOURCE,
               source='/SOURCE-NOT-READ',network_accounting=False,wire_observation=False,sender_backend='public-owner')
    value.update(changes);return SimpleNamespace(**value)


class BackendSelection(unittest.TestCase):
    def test_guarded_owner_shutdown_requires_exact_frozen_source_and_reaches_factory(self):
        option=args(commit=d.HELD_TRIAL_SOURCE,first_trial_profile=d.HELD_TRIAL_PROFILE,
            guarded_owner_shutdown=True,initialize_before_load=True)
        with mock.patch.object(d.lab,'Window') as window,self.assertRaisesRegex(RuntimeError,'guarded owner shutdown source/CI NOT_SUPPLIED'):
            d.run(option)
        window.assert_not_called()
        class Session:
            def __init__(self,ceremony,owners,*,prepare_source,poison_retirement):
                self.owners=owners;self.poison_retirement=poison_retirement
        transport=SimpleNamespace(session_class=lambda *args:Session)
        real_module=d.module
        def get_module(name,path):
            if name=='normal_public_owner_transport':return transport
            return real_module(name,path)
        with tempfile.TemporaryDirectory() as temp:
            ceremony=SimpleNamespace(mode='online',workload=dict(transactions=None),
                live=[dict(node=i) for i in range(4)],w=SimpleNamespace(work=Path(temp)),
                consumer_source=d.HELD_TRIAL_SOURCE)
            with mock.patch.object(d,'GUARDED_SHUTDOWN_SOURCE',d.HELD_TRIAL_SOURCE),mock.patch.object(d,'module',side_effect=get_module):
                backend=d.make_sender_backend(ceremony,[dict(ownerIndex=4)],threading.Event(),'public-owner',
                    prepare_public_source=True,persistent_live=True,guarded_shutdown=True)
                self.assertTrue(backend.guarded_shutdown);self.assertTrue(backend.public_session.poison_retirement)
                ceremony.consumer_source='f'*40
                with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):
                    d.make_sender_backend(ceremony,[dict(ownerIndex=4)],threading.Event(),'public-owner',
                        prepare_public_source=True,persistent_live=True,guarded_shutdown=True)

    def test_clock_original_log_reaches_normal_held_entry_without_window(self):
        helper=d.module('clock_qualification_test_fixture','test_pq_commit_clock_source_qualification.py')
        fixture=helper.ClockSourceQualificationControls();binding,identity,run,focused,jobs=fixture.fixture()
        requirements,original=fixture.original_log(binding);calls=[]
        def metadata(endpoint):
            calls.append(endpoint)
            return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':dict(total_count=4,jobs=jobs)}[endpoint]
        with tempfile.TemporaryDirectory() as temp:
            original_path=Path(temp).resolve()/'retained.log';original_path.write_bytes(original)
            option=args(commit=binding['source'],first_trial_profile=d.HELD_TRIAL_PROFILE,
                initialize_before_load=True,startup_timings=True,wire_observation=True,
                network_accounting=True,commit_observation=True,owned_storage_accounting=True,
                commit_clock_observation=True,commit_clock_ci_original_log=str(original_path),execute=False)
            with mock.patch.object(d,'HELD_TRIAL_SOURCE',binding['source']),mock.patch.object(d,'HELD_TRIAL_TREE',binding['tree']), \
                 mock.patch.object(d,'PUBLIC_OWNER_ABI_SOURCES',frozenset([binding['source']])), \
                 mock.patch.object(d,'STARTUP_TIMING_ABI_SOURCES',frozenset([binding['source']])), \
                 mock.patch.object(d.commit_clock,'COMMIT_CLOCK_SOURCE',binding['source']), \
                 mock.patch.object(d.commit_clock_ci,'BINDING',binding),mock.patch.object(d.commit_clock_ci,'LOG_REQUIREMENTS',requirements), \
                 mock.patch.object(d.lab,'check_source',return_value=identity),mock.patch.object(d.lab,'Window') as window:
                result=d.run(option,source_metadata_reader=metadata)
                self.assertTrue(result['commitClockSourceCI']['focusedOriginalLogVerified'])
                self.assertFalse(result['actualLoadExecuted'])
                self.assertEqual(calls,['runs/101','jobs/102','runs/101/jobs?per_page=100','runs/101'])
                with self.assertRaisesRegex(RuntimeError,'ambiguous log source'):
                    d.run(option,source_metadata_reader=metadata,clock_original_log_reader=lambda *x:original)
                option.commit_clock_ci_original_log=None;log_calls=[]
                def supplied(run_id,job_id,attempt):
                    log_calls.append((run_id,job_id,attempt));return original
                self.assertTrue(d.run(option,source_metadata_reader=metadata,
                                      clock_original_log_reader=supplied)['commitClockSourceCI']['focusedOriginalLogVerified'])
                self.assertEqual(log_calls,[(101,102,1)])
                with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):
                    d.run(option,source_metadata_reader=metadata)
                with self.assertRaisesRegex(RuntimeError,'SHA differs'):
                    d.run(option,source_metadata_reader=metadata,clock_original_log_reader=lambda *x:original+b'changed')
                option.commit_clock_ci_original_log=str(original_path)
                # The same callable is propagated to the original held source
                # validator before any Window when execution is requested.
                option.execute=True
                with mock.patch.object(d.held_first_trial_source,'SOURCE',binding['source']), \
                     mock.patch.dict(os.environ,{'GITHUB_JOB':'first100-held-public-owner','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_RUN_ATTEMPT':'1'}), \
                     mock.patch.object(d.held_first_trial_source,'qualification',side_effect=RuntimeError('original held metadata stopped')) as original_gate:
                    with self.assertRaisesRegex(RuntimeError,'original held metadata stopped'):
                        d.run(option,source_metadata_reader=metadata)
                    original_gate.assert_called_once_with(metadata_reader=metadata)
                window.assert_not_called()

    def test_clock_normal_cli_remains_closed_before_original_file_access(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp).resolve()/'retained.log';path.write_bytes(b'original-not-read')
            command=[sys.executable,'-B',str(Path(__file__).with_name('pq-independent-load.py')),
                '--source','/source-not-read','--commit',d.HELD_TRIAL_SOURCE,'--mode','online',
                '--seconds','5','--accounts','500','--per-account','1','--commit-observation',
                '--commit-clock-observation','--commit-clock-ci-original-log',str(path),
                '--first-trial-profile',d.HELD_TRIAL_PROFILE]
            child=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
            self.assertNotEqual(child.returncode,0)
            self.assertIn(b'exact synthetic held Commit clock source/CI NOT_SUPPLIED',child.stderr)
            self.assertEqual(path.read_bytes(),b'original-not-read')

    def test_successor_delivery_requires_same_push_and_all_original_fixture_steps(self):
        q = d.module('held_delivery_contract', 'pq-held-first100-source.py')
        source, branch = q.DELIVERY_SOURCE, q.DELIVERY_BRANCH
        run = dict(id=q.DELIVERY_RUN, event='push', run_attempt=1, workflow_id=322643672,
                   repository={'full_name': q.REPOSITORY}, path='.github/workflows/resource-market-ci.yml',
                   head_sha=source, head_branch=branch, status='completed', conclusion='success')
        job = dict(id=q.DELIVERY_JOB, run_id=q.DELIVERY_RUN, run_attempt=1, name='protocol-delivery', head_sha=source,
                   head_branch=branch, status='completed', conclusion='success',
                   steps=[dict(name=name, status='completed', conclusion='success') for name in q.DELIVERY_STEPS])
        result = q.validate_delivery(run, [job], source=source, branch=branch)
        self.assertEqual(result['job'], q.DELIVERY_JOB)
        self.assertFalse(result['runtimePermissionGranted'] or result['independentFinality'])
        with self.assertRaises(RuntimeError):
            q.validate_delivery(run, [job], source='b'*40, branch=branch)
        for key, value in (('id',q.DELIVERY_RUN+1),('event', 'workflow_dispatch'), ('run_attempt', 2), ('head_sha', 'b'*40),
                           ('conclusion', 'failure')):
            with self.subTest(run=key), self.assertRaises(RuntimeError):
                q.validate_delivery(dict(run, **{key: value}), [job], source=source, branch=branch)
        for key, value in (('id',q.DELIVERY_JOB+1),('run_id', 999), ('run_attempt', 2), ('head_sha', 'b'*40),
                           ('conclusion', 'skipped')):
            with self.subTest(job=key), self.assertRaises(RuntimeError):
                q.validate_delivery(run, [dict(job, **{key: value})], source=source, branch=branch)
        for steps in (job['steps'][:-1], job['steps'] + [job['steps'][0]],
                      [dict(job['steps'][0], conclusion='skipped'), *job['steps'][1:]]):
            with self.subTest(steps=steps), self.assertRaises(RuntimeError):
                q.validate_delivery(run, [dict(job, steps=steps)], source=source, branch=branch)
        for jobs in ([], [job, job]):
            with self.subTest(jobs=jobs), self.assertRaises(RuntimeError):
                q.validate_delivery(run, jobs, source=source, branch=branch)
        with mock.patch.object(q, 'validate', return_value=dict(sourceOnlyQualified=True, runtimePermissionGranted=False)):
            with mock.patch.object(q, 'SOURCE', source), mock.patch.object(q, 'BRANCH', branch):
                focused = dict(job, id=789, name='focused-go')
                combined = q.validate_successor(run, focused, [focused, job])
                self.assertTrue(combined['sourceOnlyQualified'])
                self.assertFalse(combined['runtimePermissionGranted'])
                with self.assertRaises(RuntimeError):
                    q.validate_successor(run, focused, [focused])
                with self.assertRaises(RuntimeError):
                    q.validate_successor(run, focused, [dict(focused, id=790), job])

    def test_selected_qualification_fetches_only_its_exact_original_endpoint_set(self):
        import json
        q = d.module('held_source_inventory_contract', 'pq-held-first100-source.py')
        run = dict(id=q.RUN, event='push', run_attempt=1, workflow_id=322643672,
                   repository={'full_name': q.REPOSITORY}, path='.github/workflows/resource-market-ci.yml',
                   head_sha=q.SOURCE, head_branch=q.BRANCH, status='completed', conclusion='success')
        focused = dict(run, id=q.JOB, run_id=q.RUN, name='focused-go',
                       steps=[dict(name=n, status='completed', conclusion='success') for n in q.REQUIRED_STEPS])
        delivery = dict(run, id=q.DELIVERY_JOB, run_id=q.RUN, name='protocol-delivery',
                        steps=[dict(name=n, status='completed', conclusion='success') for n in q.DELIVERY_STEPS])
        inventory = dict(total_count=2, jobs=[focused, delivery])
        class Response:
            status=200
            def __init__(self, url, value): self.url=url;self.value=value
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return json.dumps(self.value).encode()
        requested=[]
        class Opener:
            def open(self, request, timeout):
                self_url=request.full_url
                requested.append(self_url)
                self.assert_url=self_url
                value = inventory if self_url.endswith('/jobs?per_page=100') else focused if '/jobs/' in self_url else run
                return Response(self_url,value)
        with mock.patch.object(q.urllib.request,'build_opener',return_value=Opener()):
            result=q.qualification()
            if q.SOURCE==q.FINAL_FENCE_SOURCE:
                self.assertEqual(result,q.validate(run,focused));self.assertNotIn('delivery',result)
                self.assertEqual(len(requested),2)
                self.assertTrue(q.qualification_boundary()['historicalFocusedValidationOnly'])
            else:
                self.assertEqual(result['delivery']['job'],q.DELIVERY_JOB);self.assertEqual(len(requested),3)
                inventory['total_count']=3
                with self.assertRaisesRegex(RuntimeError,'complete bounded'):q.qualification()

    def test_legacy_auto_and_explicit_public_capacity_keep_original_caps(self):
        self.assertEqual(d.sender_backend_kind(args(sender_backend='auto')),'bounded-cold')
        self.assertEqual(d.sender_backend_kind(args(sender_backend='auto',staged_publication=False)),'per-account')
        public=d.process_capacity(args());cold=d.process_capacity(args(sender_backend='bounded-cold'))
        self.assertEqual((public['maximumRuntimePIDs'],public['maximumSignSenderProcesses']),(9,1))
        self.assertEqual((cold['maximumRuntimePIDs'],cold['maximumSignSenderProcesses']),(10,2))
        self.assertEqual(public['originalOwnedPIDLimit'],d.lab.guard.CAPS['ownedProcesses'])
        self.assertFalse(public['normalLargeOwnerInputQualified'])

    def test_held_profile_prepares_exact_cohort_without_opening_window(self):
        option = args(commit=d.HELD_TRIAL_SOURCE, first_trial_profile=d.HELD_TRIAL_PROFILE,
                      initialize_before_load=True, startup_timings=True, wire_observation=True,
                      network_accounting=True, commit_observation=True, owned_storage_accounting=True,
                      execute=False)
        identity = dict(commit=d.HELD_TRIAL_SOURCE, tree=d.HELD_TRIAL_TREE)
        with mock.patch.object(d.lab, 'check_source', return_value=identity), \
             mock.patch.object(d.lab, 'Window') as window:
            result = d.run(option)
            self.assertEqual(result['configuredDemand'], 500)
            self.assertEqual(result['processCapacity']['maximumRuntimePIDs'], 13)
            self.assertTrue(result['loadConditions']['persistentLiveMaterials'])
            self.assertFalse(result['actualLoadExecuted'])
            option.execute = True
            with self.assertRaisesRegex(RuntimeError, 'original scheduled controller job'):
                d.run(option)
            window.assert_not_called()
        qualification = d.module('held_source_contract', 'pq-held-first100-source.py')
        run = dict(id=qualification.RUN, event='push', run_attempt=1, workflow_id=322643672,
                   repository={'full_name': qualification.REPOSITORY}, path='.github/workflows/resource-market-ci.yml',
                   head_sha=qualification.SOURCE, head_branch=qualification.BRANCH,
                   status='completed', conclusion='success')
        job = dict(run, id=qualification.JOB, run_id=qualification.RUN, name='focused-go',
                   steps=[dict(name=name, status='completed', conclusion='success')
                          for name in qualification.REQUIRED_STEPS])
        self.assertTrue(qualification.validate(run, job)['sourceOnlyQualified'])
        job['steps'][-1]['conclusion'] = 'skipped'
        with self.assertRaisesRegex(RuntimeError, 'CI step incomplete'):
            qualification.validate(run, job)
        for key, value in [('commit', d.first_trial_7c25_source.SOURCE), ('rate', 500), ('accounts', 499)]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                d.validate_options(SimpleNamespace(**dict(vars(option), **{key: value})))

    def test_wrong_source_mode_or_backend_fails_before_any_window(self):
        for a in (args(commit=d.first_trial_d24_source.SOURCE),args(mode='pre-signed'),
                  args(staged_publication=False),args(sender_backend='fallback')):
            with self.subTest(args=a),mock.patch.object(d.lab,'Window') as window:
                with self.assertRaises(RuntimeError):d.sender_backend_kind(a)
                window.assert_not_called()

    def test_public_abi_option_cannot_bypass_source_qualification(self):
        with mock.patch.object(d.lab,'check_source') as source,mock.patch.object(d.lab,'Window') as window:
            with self.assertRaisesRegex(RuntimeError,'exact staged normal consumer source required'):d.run(args())
        source.assert_not_called();window.assert_not_called()

    def test_factory_assembles_one_real_transport_with_private_fd_not_secret_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);private=root/'workload/private-senders';private.mkdir(parents=True)
            credential=private/'recovery.raw';credential.write_bytes(b'x'*32);os.chmod(credential,0o600)
            calls=[];process=SimpleNamespace(stdin=io.BytesIO(),poll=lambda:None)
            window=SimpleNamespace(work=root)
            window.launch=lambda *a,**kw:(calls.append((a,kw)) or process)
            ceremony=SimpleNamespace(mode='online',workload=dict(transactions=None),live=[],w=window,
                                     consumer_source=d.PUBLIC_OWNER_ABI_SOURCE,root=root,bins=root/'bin',
                                     pin='a'*64,activation_pin='b'*64,workload_pin='c'*64)
            backend=d.make_sender_backend(ceremony,[dict(ownerIndex=4),dict(ownerIndex=5)],threading.Event(),'public-owner')
            self.assertEqual(len(calls),1);self.assertEqual(len(backend.sessions),1)
            self.assertEqual(backend.public_session.owners,(4,5))
            command=calls[0][0][1]
            self.assertIn('sender-owners',command);self.assertNotIn('x'*32,command)
            self.assertEqual(len(calls[0][1]['pass_fds']),1)

    def test_prepared_backend_records_separate_parent_and_callee_intervals(self):
        backend_module = d.module('prepared_public_owner_backend', 'pq-public-owner-backend.py')
        timings = dict(intervalsOverlap=True, stages={'checkpoint.prepareStaticTotal': dict(calls=1, elapsedNs=400)})
        class Session:
            def __init__(self, ceremony, owners, *, prepare_source):
                self.owners = owners
                self.prepare_source = prepare_source
                self.name = 'load-public-owners'
                self.launched_ns = 100
            def wait_ready(self, stop, deadline, check):
                return dict(bootstrapLoaded=True, startupElapsedNs=450, preparationTimings=timings)
        backend_type = backend_module.backend_class(d.NormalBackend, Session, d.normal, d.lab)
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            (work / 'public').mkdir()
            ready_path = work / 'public' / 'load-public-owners-ready.json'
            ready_path.write_bytes(b'original prepared reply')
            sha256 = d.lab.guard.digest(ready_path)
            ceremony = SimpleNamespace(mode='online', workload=dict(transactions=None), live=[],
                                       w=SimpleNamespace(work=work), proof_timeout=30)
            with mock.patch.object(backend_module.time, 'monotonic_ns', return_value=750):
                backend = backend_type(ceremony, [dict(ownerIndex=4)], threading.Event(), prepare_source=True)
                report = backend.prepare(lambda: None)
        self.assertTrue(backend.public_session.prepare_source)
        self.assertEqual(report['readyMode'], 'ORIGINAL_PUBLIC_STATIC_SOURCE_PREPARED')
        self.assertTrue(report['bootstrapLoaded'])
        self.assertFalse(report['signed'] or report['nonceReserved'] or report['loadClockStarted'])
        self.assertFalse(report['coldValidationIncludedInFirstCommand'])
        self.assertEqual(report['sourcePreparation'], dict(
            sourceReply='load-public-owners-ready.json', sourceReplySHA256=sha256,
            parentLaunchMonotonicNs=100, parentReadyReceivedMonotonicNs=750,
            parentLaunchToReadyNs=650, calleeStartupElapsedNs=450, calleePreparationTimings=timings,
            parentClock='parent_monotonic_ns', intervalsOverlap=True, addedToPerCommand=False,
            checkpointValidated=False))

    def test_incomplete_proof_preparation_retains_completed_lanes(self):
        backend_module = d.module('partial_proof_backend', 'pq-public-owner-backend.py')
        class Session:
            def __init__(self, ceremony, owners):
                self.owners = owners
            def wait_ready(self, stop, deadline, check):
                return dict(bootstrapLoaded=False)
        def prepare_lane(backend, lane, check):
            if lane['node'] == 2:
                raise RuntimeError('original proof READY deadline')
            return dict(node=lane['node'], calleeStartupElapsedNs=100)
        backend_type = backend_module.backend_class(d.NormalBackend, Session, d.normal, d.lab)
        ceremony = SimpleNamespace(mode='online', workload=dict(transactions=None),
                                   live=[dict(node=i) for i in range(4)],
                                   w=SimpleNamespace(), proof_timeout=30)
        backend = backend_type(ceremony, [dict(ownerIndex=4)], threading.Event(),
                               prepare_live_session=prepare_lane)
        with self.assertRaisesRegex(RuntimeError, 'original proof READY deadline'):
            backend.prepare(lambda: None)
        self.assertEqual([r['node'] for r in backend.pool_ready['liveMaterialsPreparation']], [0, 1])
        self.assertFalse(backend.pool_ready['loadClockStarted'])
        self.assertEqual(backend.pool_ready['maximumOwnedRuntimePIDs'], 13)
        ceremony.live = [dict(node=i) for i in (0, 1, 2, 2)]
        with self.assertRaisesRegex(RuntimeError, 'one original proof lane per validator'):
            backend_type(ceremony, [dict(ownerIndex=4)], threading.Event(),
                         prepare_live_session=prepare_lane)

    def test_backend_identity_is_part_of_escalation_conditions(self):
        a=args(sender_backend='bounded-cold');b=args()
        self.assertNotEqual(d.load_conditions(a)['senderBackend'],d.load_conditions(b)['senderBackend'])

    def test_1695_prepare_consumes_own_ci_and_semantic_without_creating_window(self):
        a=args(execute=False,first_trial_profile='1695',initialize_before_load=True,
               startup_timings=True,wire_observation=True,network_accounting=True,
               commit_observation=True,owned_storage_accounting=True,header_hop_capture=False)
        identity=dict(commit=d.first_trial_1695_source.SOURCE,tree=d.first_trial_1695_source.TREE)
        with mock.patch.object(d.lab,'check_source',return_value=identity),mock.patch.object(d.lab,'git'),\
             mock.patch.object(d.subprocess,'check_output',return_value=b'live-materials'),mock.patch.object(d.lab,'Window') as window:
            result=d.run(a)
        window.assert_not_called();self.assertFalse(result['actualLoadExecuted'])
        self.assertTrue(result['sourceFunctionalData']['semanticPairConsumed'])
        self.assertEqual(result['sourceFunctionalData']['source'],d.PUBLIC_OWNER_ABI_SOURCE)


if __name__=='__main__':unittest.main()
