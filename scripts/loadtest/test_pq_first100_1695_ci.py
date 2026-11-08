"""Actual1695 fixed backend profiles: pure tests, no process window or network."""
import contextlib,copy,hashlib,importlib.util,io,json,os,re,types,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
TOOLS=Path(os.environ.get('YNX_PROFILE_TEST_TOOLS',str(HERE.parents[2]/'tools/scripts/loadtest')))
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
entry=module('own1695_controller',HERE/'pq-first100-1695-ci.py')
space=module('own1695_space',HERE/'pq-hosted-1695-space-ci.py')
def env(profile):
    return dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_JOB=profile,GITHUB_REF=entry.REF,GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=profile,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,GITHUB_SHA='a'*40,GITHUB_WORKFLOW_SHA='a'*40,GITHUB_RUN_ID='123')
def ci():
    run=dict(id=entry.TOOLS_CI_RUN,run_attempt=1,head_sha=entry.TOOLS,head_branch='codex/chain-batch-v01-performance',event='push',workflow_id=entry.TOOLS_CI_WORKFLOW,path='.github/workflows/chain-core.yml',repository=dict(full_name='JiahaoAlbus/YNX-Chain'),status='completed',conclusion='success')
    names=['Execute original Linux worker affinity limits stdin and cleanup case','Verify fixed1695 semantic original transport and process controls','Verify fixed1695 own source originals with explicit opt-in skips','Verify normal public owner stream isolation and lost acknowledgements','Verify full first100 cohort counts and censored latency readback','Verify original bounded sender and post-ready checkpoint ordering']
    job=dict(id=entry.TOOLS_CI_JOB,run_id=entry.TOOLS_CI_RUN,head_sha=entry.TOOLS,head_branch=run['head_branch'],name='Chain Core source and release gate',status='completed',conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in names]);return run,job
class Fixed1695(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for name,pin in entry.TOOL_PINS.items():entry.pinned_bytes(TOOLS/name,pin)
        cls.driver=entry.pinned_module('own1695_driver',TOOLS/'pq-independent-load.py',entry.TOOL_PINS['pq-independent-load.py'])
    def test_actual_source_and_semantic_raw_qualification(self):
        data=entry.validate_driver(self.driver)
        self.assertTrue(data['semanticPairConsumed']);self.assertEqual(data['requiredNamedCases'],130)
        self.assertEqual(len(data['originalOptInSkips']),10)
        self.assertFalse(data['pressureAuthorized'] or data['runtimePermissionGranted'] or data['actual500InitializedOwnersQualified'])
        self.assertEqual(entry.source_prerequisites()['retainedHeights'],9)
        with mock.patch.object(entry,'SEMANTIC_READBACK_BYTES',b'{}'),self.assertRaises(RuntimeError):entry.source_prerequisites()
    def test_both_backends_same_load_and_caps_with_distinct_conditions(self):
        conditions=[]
        for profile,backend in entry.PROFILES.items():
            with mock.patch.object(entry,'PROFILE',profile):
                options=entry.fixed_options(Path('/source'));self.assertEqual(self.driver.validate_options(options),500)
                self.assertEqual(options.sender_backend,backend);self.assertEqual(options.first_trial_profile,'1695')
                self.assertEqual((options.rate,options.seconds,options.accounts,options.per_account,options.tail_seconds,options.proof_timeout),(100,5,500,1,30,30))
                self.assertEqual(self.driver.lab.CAPS,entry.CAPS);self.assertEqual(self.driver.lab.guard.CAPS['ownedProcesses'],16)
                conditions.append(self.driver.load_conditions(options))
                self.assertFalse(entry.prepared_data()['higher500Or1000Permission'])
        before,after=conditions;self.assertNotEqual(before,after)
        before.pop('senderBackend');after.pop('senderBackend');self.assertEqual(before,after)
    def test_every_observer_remains_required(self):
        for name in ('wire_observation','network_accounting','owned_storage_accounting','commit_observation','startup_timings'):
            options=entry.fixed_options(Path('/source'));setattr(options,name,False)
            with self.subTest(name=name),self.assertRaises(Exception):self.driver.validate_options(options)
    def test_attempt_profile_host_and_version_fail_before_window(self):
        for profile in entry.PROFILES:
            with mock.patch.object(entry,'PROFILE',profile),mock.patch.object(entry.sys,'platform','linux'):
                entry.validate_host(env(profile));self.assertEqual(space.fixed_profile(env(profile))[2:],(entry.GO_SOURCE,entry.TOOLS))
                for key,value in [('GITHUB_JOB','first100-d24-initialize-before-load'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_EVENT_NAME','push'),('GITHUB_REF','refs/heads/main'),('GITHUB_WORKFLOW_SHA','b'*40),('RUNNER_ENVIRONMENT','self-hosted')]:
                    with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_host(dict(env(profile),**{key:value}))
        with mock.patch.object(entry,'PROFILE','unknown'),self.assertRaises(RuntimeError):entry.validate_host(env('unknown'))
    def test_tools_ci_same_head_and_required_steps(self):
        run,job=ci();entry.validate_tools_ci(run,job)
        for key,value in [('head_sha',entry.GO_SOURCE),('status','in_progress'),('conclusion','failure'),('run_attempt',2)]:
            with self.assertRaises(RuntimeError):entry.validate_tools_ci(dict(run,**{key:value}),job)
        for i in range(len(job['steps'])):
            with self.assertRaises(RuntimeError):entry.validate_tools_ci(run,dict(job,steps=job['steps'][:i]+job['steps'][i+1:]))
        with mock.patch.object(entry,'validate_host'),mock.patch.object(entry,'read_tools_ci',side_effect=RuntimeError('CI incomplete')),mock.patch.object(entry,'checked_source') as checked,mock.patch.object(entry,'install_counted_window') as window,self.assertRaisesRegex(RuntimeError,'CI incomplete'):entry.execute(Path('/source'),Path('/tools'))
        checked.assert_not_called();window.assert_not_called()
    def test_default_preparation_has_no_window_or_network(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('window')),mock.patch.object(entry,'read_tools_ci',side_effect=AssertionError('network')),contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(entry.main([]),0)
        data=json.loads(out.getvalue());self.assertFalse(data['executed'] or data['pressureAuthorized'])
        for argv in (['--rate','1000'],['--backend','public-owner'],['--execute','--execute'],['--source','/source']):
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):entry.main(argv)
    def test_old_workflow_bytes_preserved_and_new_jobs_dispatch_only(self):
        workflow=(HERE.parents[1]/'.github/workflows/pq-normal-process.yml').read_text()
        # Project only the exact additive 7c25 choice and its new-only fallback guard.
        legacy=workflow.replace(', first100-7c25-public-owner]',']',1)
        legacy=legacy.replace("    if: github.ref != 'refs/heads/codex/ynx-pq-current75-baseline-20261101' && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-own1b-initialize-before-load') && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-7c25-public-owner')\n","    if: github.ref != 'refs/heads/codex/ynx-pq-current75-baseline-20261101' && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-own1b-initialize-before-load')\n",1)
        base=legacy.split('\n  first100-1695-controller-controls:',1)[0].replace(', first100-1695-bounded-cold, first100-1695-public-owner]',']')
        self.assertEqual(hashlib.sha256(base.encode()).hexdigest(),'e9127104929017ae5c16e36fc2a267cbfe5d88a413837104126eae9381fbe446')
        for profile in entry.PROFILES:
            job=workflow.split('\n  '+profile+':',1)[1].split('\n  first100-1695-',1)[0].split('\n  first100-7c25-controller-controls:',1)[0]
            for literal in ("github.event_name == 'workflow_dispatch'","github.run_attempt == 1","inputs.load_profile == '"+profile+"'","inputs.signing_mode == 'online'",'needs: first100-1695-controller-controls',entry.GO_SOURCE,entry.TOOLS,'--check-tools-ci','remove-unused-android-for-'+profile+'-v1') :self.assertIn(literal,job)
            self.assertLess(job.index('--check-tools-ci'),job.index('Prepare only explicitly'));self.assertLess(job.index('Prepare only explicitly'),job.index('Execute sole'))
            self.assertEqual(job.count(' --execute'),2)
    def test_success_cannot_be_claimed_with_missing_or_partial_cohort(self):
        with self.assertRaises(RuntimeError):entry.validate_result(self.driver,{},entry.validate_driver(self.driver))
    def test_space_target_delete_command_and_capacity_guards_unchanged(self):
        self.assertEqual(str(space.TARGET),'/usr/local/lib/android')
        self.assertEqual(space.REMOVE_ARGV,('/usr/bin/sudo','-n','/usr/bin/timeout','--signal=TERM','--kill-after=5s','90s','/usr/bin/rm','--recursive','--force','--one-file-system','--preserve-root=all','--','/usr/local/lib/android'))
        self.assertEqual((space.DISK_FLOOR,space.MEMORY_FLOOR),(16<<30,6<<30))
        for invalid in ('first100-d24-initialize-before-load','first100-own1b-initialize-before-load','',None):
            with self.assertRaises(RuntimeError):space.fixed_profile(dict(PQ_BASELINE_PROFILE=invalid))
        for profile in entry.PROFILES:
            self.assertEqual(space.fixed_profile(env(profile)),(profile,'remove-unused-android-for-'+profile+'-v1',entry.GO_SOURCE,entry.TOOLS))
    def test_unapproved_space_host_fails_before_layout_or_deletion(self):
        with mock.patch.object(space,'checked_layout') as layout,mock.patch.object(space.subprocess,'run') as run,self.assertRaises(RuntimeError):space.validate_host(env(entry.PROFILE))
        layout.assert_not_called();run.assert_not_called()

class AdequateDiskCaptureControls(unittest.TestCase):
    def capture(self, disk, memory_kib, guard_error=None, du_timeout=False):
        import subprocess
        context=types.SimpleNamespace(parent=Path('/temp'),workspace=Path('/workspace'),protected=[])
        identity=dict(device=1,inode=2,ctimeNS=3,mode=493,uid=0)
        def command(argv, **kwargs):
            if argv[0]=='/usr/bin/df':return 'actual-df-fixture'
            self.assertEqual(argv,['/usr/bin/du','-s','-x','-B1','--','/usr/local/lib/android'])
            self.assertEqual(kwargs.get('timeout'),60)
            if du_timeout:raise subprocess.TimeoutExpired(argv,60)
            return '1048576 /usr/local/lib/android'
        def text(path,*args,**kwargs):
            if str(path)=='/proc/meminfo':return 'MemAvailable: '+str(memory_kib)+' kB\n'
            self.assertEqual(str(path),'/proc/self/mountinfo')
            return '1 0 8:1 / / rw,relatime - ext4 /dev/root rw\n'
        target=mock.Mock(return_value=identity,side_effect=guard_error)
        into={}
        with mock.patch.object(space,'command',side_effect=command) as commands, \
             mock.patch.object(space.Path,'read_text',text), \
             mock.patch.object(space.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=disk,f_frsize=1)), \
             mock.patch.object(space,'tools_snapshot',return_value=({'go':{'version':'pinned'}},{'GOROOT':'/go'},[])), \
             mock.patch.object(space,'target_guard',target), \
             mock.patch.object(space,'remove_fixed_target',side_effect=AssertionError('capture must not delete')):
            space.capture(context,into)
        target.assert_called_once()
        return into,commands.call_args_list

    def test_actual_public_capacity_does_not_need_android_du(self):
        # Actual refused run42395339962: disk91.94GB/RAM15.74GB, optional du60s.
        into,calls=self.capture(91940134912,15375824,du_timeout=True)
        self.assertTrue(into['complete'])
        self.assertIsNone(into['targetAllocatedBytes'])
        self.assertEqual(into['targetSizeStatus'],'NOT_MEASURED_DISK_FLOOR_ALREADY_AVAILABLE')
        self.assertEqual(into['diskAvailableBytes'],91940134912)
        self.assertEqual(into['memoryAvailableBytes'],15744843776)
        self.assertEqual([c.args[0][0] for c in calls],['/usr/bin/df'])

    def test_exact_disk_floor_also_needs_no_directory_scan(self):
        into,calls=self.capture(space.DISK_FLOOR,8<<20,du_timeout=True)
        self.assertTrue(into['complete']);self.assertIsNone(into['targetAllocatedBytes'])
        self.assertEqual(len(calls),1)

    def test_disk_shortage_keeps_original_bounded_du_and_measured_size(self):
        into,calls=self.capture(space.DISK_FLOOR-1,8<<20)
        self.assertEqual(into['targetAllocatedBytes'],1048576)
        self.assertEqual(len(calls),2);self.assertIn('du',into)

    def test_needed_du_timeout_still_fails_closed(self):
        import subprocess
        with self.assertRaises(subprocess.TimeoutExpired):self.capture(space.DISK_FLOOR-1,8<<20,du_timeout=True)

    def test_adequate_disk_does_not_skip_protected_target_or_memory_observation(self):
        with self.assertRaisesRegex(RuntimeError,'protected target'):
            self.capture(91940134912,15375824,guard_error=RuntimeError('protected target'))
        into,calls=self.capture(91940134912,1024,du_timeout=True)
        self.assertLess(into['memoryAvailableBytes'],space.MEMORY_FLOOR)
        self.assertFalse(space.prepared()['admissionGranted'])
        self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main(verbosity=2)
