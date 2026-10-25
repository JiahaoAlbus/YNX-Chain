"""Native cadence pair controller counterexamples; no nodes, compiler or HTTP."""
import contextlib,copy,hashlib,importlib.util,io,json,tempfile,unittest,weakref
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('supply',Path(__file__).with_name('supply-linux-window.py'))
supply=importlib.util.module_from_spec(spec);spec.loader.exec_module(supply)

def measurement(rate=300,upper=2000000000):
    distribution=dict(samples=8192,**{q:dict(valid=True,lowerNs=upper-999999,upperNs=upper) for q in ('p50','p95','p99')})
    return dict(summary=dict(finalSubmittedPerMeasurementSecond=rate),offerLatencyIntervalsNs={n:copy.deepcopy(distribution) for n in ('offerToEffectiveBusinessInclusion','offerToFinal')})

class NativeStreamPairTests(unittest.TestCase):
    def test_prepared_grouped_client_procs2_pair_has_one_axis_and_original_caps(self):
        selected=supply.pair_recipe(supply.STREAM_PROCS_PAIR)
        before,after=copy.deepcopy(selected['cases'])
        self.assertIs(after.pop('clientProcs2'),True);self.assertEqual(before,after)
        self.assertEqual(selected['pairCaps'],supply.pair_recipe(supply.STREAM_MM_PAIR)['pairCaps'])
        self.assertEqual(before['environment']['GOMAXPROCS'],'1')
        commands=[]
        for flag in (False,True):
            command=supply.supply_client_command(Path('build'),Path('manifest'),Path('network'),Path('out'),before['profile'],'grouped-cadence4',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,current_input_reuse=True,prepared=True,client_procs2=flag)
            commands.append(command)
            selection=supply.native_verifier_selection('grouped-cadence4',True,False,False,False,8,True,flag)
            supply.stream_verifier.check_selection(supply,selection)
            self.assertIs(selection.get('expected_client_procs2',False),flag)
        commands[1].remove('-client-procs2');self.assertEqual(*commands)
        for override in (dict(prepared=False),dict(current_input_reuse=False),dict(pacing='bounded-cadence'),dict(submitters=16),dict(canonical_certificate=True),dict(native_suffix_setup=True),dict(block_tip_hint=True),dict(client_procs2=1)):
            values=dict(transport='grpc',profile_name=supply.STREAM_PROFILE,pacing='grouped-cadence4',observer_phases=True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,current_input_reuse=True,prepared=True,client_procs2=True);values.update(override)
            with self.subTest(override=override),self.assertRaises(RuntimeError):supply.recipe(**values)
        workflow=Path('.github/workflows/chain-core.yml').read_text()
        for action in ('prepare','execute'):self.assertIn('--'+action+'-pair --pair-kind native-prepared-grouped-client-procs2 --observer-phases',workflow)

    def test_prepared_grouped_client_procs2_order_and_unknown_stop(self):
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_PROCS_PAIR)
        self.assertEqual(code,0);self.assertEqual(calls,['grouped-cadence4']*2)
        code,calls,terminal=self.run_pair(fault='unknown',comparison=supply.STREAM_PROCS_PAIR)
        self.assertEqual(code,1);self.assertEqual(len(calls),1)

    def test_prepared_grouped_client_procs2_recovery_binds_candidate(self):
        self.check_pair_recovery(supply.STREAM_PROCS_PAIR)

    def test_exit_mm_pair_is_explicit_on_both_cases_without_changing_load_or_caps(self):
        old=supply.pair_recipe(supply.STREAM_GROUPED_PAIR)
        new=supply.pair_recipe(supply.STREAM_MM_PAIR)
        self.assertEqual(new['input']['linux_supply_pacing'],'paired-native-prepared-grouped-mm-proof')
        self.assertEqual(new['pairCaps'],old['pairCaps'])
        self.assertEqual(supply.pair_modes(supply.STREAM_MM_PAIR),('native-mm-bounded','native-mm-grouped'))
        for before,after in zip(old['cases'],new['cases']):
            after=copy.deepcopy(after)
            self.assertIs(after.pop('nativeExitMMProof'),True)
            self.assertEqual(before,after)
        for candidate in (1,'true',None):
            with self.subTest(candidate=candidate),self.assertRaises(RuntimeError):supply.recipe(exit_mm_proof=candidate)
        with self.assertRaises(RuntimeError):supply.recipe(exit_mm_proof=True)
        workflow=Path('.github/workflows/chain-core.yml').read_text()
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-prepared-grouped-mm-proof --observer-phases',workflow)

    def test_exit_mm_pair_recovery_binds_both_original_receipt_selectors(self):
        self.check_pair_recovery(supply.STREAM_MM_PAIR)

    def test_exit_mm_pair_budget_selects_sampler_only_for_new_scope(self):
        for kind in (supply.STREAM_GROUPED_PAIR,supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as d:
                root=Path(d);data=root/'data';evidence=root/'evidence';build=root/'build'
                for path in (data,evidence,build):path.mkdir()
                sample=dict(rssBytes=1,threads=1,privateBytes=1,buildBytes=1,freeDiskBytes=10<<30,availableMemoryBytes=2<<30)
                budget=supply.PairBudget(data,evidence,0,build,kind)
                with patch.object(supply.time,'monotonic',return_value=1),patch.object(supply,'native_sample',return_value=sample) as capture:
                    budget.observe()
                    self.assertIs(capture.call_args.kwargs['allow_exit_mm'],kind in (supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR))

    def test_exit_mm_original_receipt_proof_cannot_be_stripped_or_rewritten(self):
        task=dict(pid=2,parent=1,group=2,startTicks=17,state='R',threads=1)
        memory=dict(flags=4194316,virtualBytes=0,residentPages=0,threads=1,startTicks=17)
        proof=dict(pid=2,before=dict(task,state='S'),after=dict(task),errno=3,failedRead='smaps_rollup',
                   afterStatMemory=memory,retirementConfirmation=dict(task),retirementConfirmationStatMemory=dict(memory),outcome='exited-mm')
        observed=dict(task,rssBytes=0,rssProvenance='kernel-exited-mm-double-stat')
        receipt=dict(nativeExitMMProof=True,samples=[dict(tasks=[observed],retiredOwnedTransitions=[proof])])
        supply.validate_exit_mm_samples(receipt,True)
        for mutate in (lambda r:r.update(nativeExitMMProof=False),lambda r:r['samples'][0].pop('retiredOwnedTransitions'),lambda r:r['samples'][0]['retiredOwnedTransitions'][0]['afterStatMemory'].update(virtualBytes=1),lambda r:r['samples'][0]['tasks'][0].update(state='Z'),lambda r:r['samples'][0]['tasks'][0].pop('rssProvenance')):
            changed=copy.deepcopy(receipt);mutate(changed)
            with self.assertRaises(RuntimeError):supply.validate_exit_mm_samples(changed,True)
        with self.assertRaises(RuntimeError):supply.validate_exit_mm_samples(receipt,False)

    def test_grouped_prepared_pair_changes_only_pacing_with_original_caps(self):
        plan=supply.pair_recipe(supply.STREAM_GROUPED_PAIR);before,after=plan['cases']
        self.assertEqual(plan['kind'],'fixed-same-VM-native-prepared-grouped-cadence-pair');self.assertEqual(plan['input']['linux_supply_pacing'],'paired-native-prepared-grouped-cadence')
        self.assertIs(before['nativePreparedCertificate'],True);self.assertIs(after['nativePreparedCertificate'],True)
        self.assertEqual([r['pacingMode'] for r in plan['cases']],['bounded-cadence','grouped-cadence4'])
        self.assertEqual(after['profile']['name'],before['profile']['name'].replace('-bounded-cadence','-grouped-cadence4'))
        a,b=copy.deepcopy(after),copy.deepcopy(before);a['pacingMode']=b['pacingMode'];a['profile']['name']=b['profile']['name'];self.assertEqual(a,b)
        commands=[]
        for row in plan['cases']:
            self.assertEqual(row['profile']['concurrency'],8);self.assertEqual(row['resourceCaps']['ownedRSSBytes'],1<<30)
            commands.append(supply.supply_client_command(Path('/build'),Path('/network/manifest'),Path('/network'),Path('/network/result'),row['profile'],row['pacingMode'],True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,prepared=True))
            self.assertIn('-native-prepared-certificate',commands[-1]);self.assertNotIn('-native-cached-fee-json',commands[-1])
        a=list(commands[1]);a[a.index('grouped-cadence4')]='bounded-cadence';self.assertEqual(a,commands[0])
        selection=supply.native_verifier_selection('grouped-cadence4',True,False,False,False,8,True);supply.stream_verifier.check_selection(supply._verifier_controller(),selection)
        for delta in (dict(expected_input_reuse=False),dict(expected_prepared_certificate=False),dict(expected_submitters=16),dict(pacing='unknown')):
            with self.subTest(delta=delta),self.assertRaises(RuntimeError):supply.stream_verifier.check_selection(supply._verifier_controller(),dict(selection,**delta))
        args=dict(transport='grpc',profile_name=supply.STREAM_PROFILE,pacing='grouped-cadence4',observer_phases=True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,prepared=True)
        for delta in (dict(current_input_reuse=False),dict(prepared=False),dict(submitters=16),dict(canonical_certificate=True),dict(native_suffix_setup=True),dict(block_tip_hint=True)):
            with self.subTest(delta=delta),self.assertRaises(RuntimeError):supply.recipe(**dict(args,**delta))
        for action in ('prepare','execute'):self.assertIn('--'+action+'-pair --pair-kind native-prepared-grouped-cadence --observer-phases',Path('.github/workflows/chain-core.yml').read_text())

    def test_grouped_prepared_pair_original_recovery_and_first_failure_stop(self):
        self.check_pair_recovery(supply.STREAM_GROUPED_PAIR)
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_GROUPED_PAIR)
        self.assertEqual(code,0);self.assertEqual(calls,['bounded-cadence','grouped-cadence4']);self.assertTrue(terminal['qualified'])
        for fault in ('unknown','closure','binary','host'):
            code,calls,terminal=self.run_pair(fault,supply.STREAM_GROUPED_PAIR)
            self.assertEqual(code,1);self.assertEqual(len(calls),1);self.assertFalse(terminal['qualified'])

    def test_prepared_pair_changes_only_private_publication(self):
        plan=supply.pair_recipe(supply.STREAM_PREPARED_PAIR);before,after=plan['cases']
        self.assertEqual(plan['kind'],'fixed-same-VM-native-prepared-certificate-pair')
        self.assertEqual(plan['input']['linux_supply_pacing'],'paired-native-prepared-certificate')
        self.assertNotIn('nativePreparedCertificate',before);self.assertIs(after['nativePreparedCertificate'],True)
        a=copy.deepcopy(after);b=copy.deepcopy(before);a.pop('nativePreparedCertificate')
        self.assertEqual(a['profile']['name'],b['profile']['name']+'-prepared');a['profile']['name']=b['profile']['name'];self.assertEqual(a,b)
        commands=[]
        for prepared,row in [(False,before),(True,after)]:
            self.assertEqual(row['profile']['concurrency'],8)
            commands.append(supply.supply_client_command(Path('/build'),Path('/network/manifest'),Path('/network'),Path('/network/result'),row['profile'],'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,prepared=prepared))
        self.assertEqual(commands[0],[x for x in commands[1] if x!='-native-prepared-certificate'])
        selected=supply.native_verifier_selection('bounded-cadence',True,False,False,False,8,True)
        self.assertIs(selected['expected_prepared_certificate'],True);supply.stream_verifier.check_selection(supply._verifier_controller(),selected)
        for value in (False,1,'true',None):
            bad=dict(selected,expected_prepared_certificate=value)
            with self.assertRaises(RuntimeError):supply.stream_verifier.check_selection(supply._verifier_controller(),bad)
        for delta in [dict(submitters=16),dict(canonical_certificate=True),dict(native_suffix_setup=True),dict(block_tip_hint=True),dict(native_stream8=False),dict(prepared=1)]:
            args=dict(transport='grpc',profile_name=supply.STREAM_PROFILE,pacing='bounded-cadence',observer_phases=True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,prepared=True);args.update(delta)
            with self.assertRaises(RuntimeError):supply.recipe(**args)
        with self.assertRaises(RuntimeError):supply.supply_client_command(Path('/build'),Path('/m'),Path('/n'),Path('/o'),before['profile'],'bounded-cadence',prepared=True)
        for action in ('prepare','execute'):self.assertIn('--'+action+'-pair --pair-kind native-prepared-certificate --observer-phases',Path('.github/workflows/chain-core.yml').read_text())

    def test_prepared_pair_original_recovery_and_first_failure_stop(self):
        self.check_pair_recovery(supply.STREAM_PREPARED_PAIR)
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_PREPARED_PAIR)
        self.assertEqual(code,0);self.assertEqual(calls,['bounded-cadence','bounded-cadence']);self.assertTrue(terminal['qualified'])
        for fault in ('unknown','closure','binary','host'):
            code,calls,terminal=self.run_pair(fault,supply.STREAM_PREPARED_PAIR)
            self.assertEqual(code,1);self.assertEqual(len(calls),1);self.assertFalse(terminal['qualified'])

    def test_submit16_pair_changes_only_explicit_worker_scope(self):
        plan=supply.pair_recipe(supply.STREAM_SUBMIT16_PAIR)
        before,after=plan['cases']
        self.assertEqual(plan['kind'],'fixed-same-VM-native-stream-submit16-pair')
        self.assertEqual(plan['input']['linux_supply_pacing'],'paired-native-stream-submit16')
        self.assertNotIn('nativeStreamSubmitters',before)
        self.assertEqual(after['nativeStreamSubmitters'],16)
        self.assertEqual(before['profile']['concurrency'],8);self.assertEqual(after['profile']['concurrency'],16)
        for case in (before,after):
            self.assertEqual(case['pacingMode'],'bounded-cadence');self.assertTrue(case['nativeCurrentInputReuse'])
            self.assertNotIn('nativeBlockTipHint',case);self.assertNotIn('nativeCanonicalCertificate',case)
        b=copy.deepcopy(before);a=copy.deepcopy(after)
        a.pop('nativeStreamSubmitters');a['profile']['concurrency']=8;a['profile']['name']=b['profile']['name']
        self.assertEqual(a,b)
        commands=[]
        for n,case in zip((8,16),(before,after)):
            command=supply.supply_client_command(Path('/build'),Path('/network/manifest'),Path('/network'),Path('/network/result'),case['profile'],'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,submitters=n)
            self.assertEqual(command[command.index('-concurrency')+1],str(n));commands.append(command)
        after_command=list(commands[1]);at=after_command.index('-native-stream-submitters');self.assertEqual(after_command[at+1],'16');del after_command[at:at+2]
        after_command[after_command.index('-concurrency')+1]='8';self.assertEqual(commands[0],after_command)
        self.assertEqual(supply.native_verifier_selection('bounded-cadence',True,False,False,False,16)['expected_submitters'],16)
        self.assertNotIn('expected_submitters',supply.native_verifier_selection('bounded-cadence',True,False,False,False))
        for n in (True,0,4,32,'16'):
            with self.assertRaises(RuntimeError):supply.native_stream_profile('bounded-cadence',n)
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-stream-submit16 --observer-phases',Path('.github/workflows/chain-core.yml').read_text())

    def test_submit16_pair_execution_binding_and_failure_stop(self):
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_SUBMIT16_PAIR)
        self.assertEqual(code,0);self.assertEqual(calls,['bounded-cadence','bounded-cadence']);self.assertTrue(terminal['qualified'])
        for fault in ('unknown','closure','binary','host'):
            code,calls,terminal=self.run_pair(fault,supply.STREAM_SUBMIT16_PAIR)
            self.assertEqual(code,1);self.assertEqual(len(calls),1);self.assertFalse(terminal['qualified'])
        self.check_pair_recovery(supply.STREAM_SUBMIT16_PAIR)

    def test_verifier_submit16_selection_is_explicit_and_typed(self):
        selection=supply.native_verifier_selection('bounded-cadence',True,False,False,False,16)
        supply.stream_verifier.check_selection(supply._verifier_controller(),selection)
        for value in (True,8,0,32,'16'):
            bad=dict(selection,expected_submitters=value)
            with self.assertRaises(RuntimeError):supply.stream_verifier.check_selection(supply._verifier_controller(),bad)
        with self.assertRaises(RuntimeError):supply.recipe(submitters=16)
        before,after=supply.pair_recipe(supply.STREAM_SUBMIT16_PAIR)['cases']
        self.assertEqual(before['resourceCaps'],after['resourceCaps'])
        self.assertEqual(before['streamBudget'],after['streamBudget'])

    def test_submit16_requires_explicit_typed_report_and_worker_inventory(self):
        report=dict(nativeStream8=True,nativeSubmit8=False,concurrency=16,observerConcurrency=4,prefixNativeClone=True,pacedWorkers=dict(submitters=16,observers=4,submissionQueueCapacity=2048,observationQueueCapacities=[2048]*4))
        with self.assertRaises(RuntimeError):supply.validate_submitter_selection(report,False,True,native_stream8=True)
        self.assertEqual(supply.validate_submitter_selection(report,False,True,native_stream8=True,stream_submitters=16)['pacedWorkers']['submitters'],16)
        for key,value in [('submitters',8),('observers',8),('submissionQueueCapacity',4096),('observationQueueCapacities',[2048]*8)]:
            bad=copy.deepcopy(report);bad['pacedWorkers'][key]=value
            with self.assertRaises(RuntimeError):supply.validate_submitter_selection(bad,False,True,native_stream8=True,stream_submitters=16)

    def test_canonical_pair_changes_only_certificate_with_cache_and_pace_fixed(self):
        before,after=supply.pair_recipe(supply.STREAM_CERTIFICATE_PAIR)['cases']
        self.assertEqual(before['pacingMode'],after['pacingMode'])
        self.assertEqual(before['pacingMode'],'bounded-cadence')
        self.assertIs(before['nativeCurrentInputReuse'],True);self.assertIs(after['nativeCurrentInputReuse'],True)
        self.assertNotIn('nativeCanonicalCertificate',before)
        self.assertIs(after['nativeCanonicalCertificate'],True)
        self.assertEqual(before,{k:v for k,v in after.items() if k!='nativeCanonicalCertificate'})
        commands=[]
        for flag in (False,True):
            commands.append(supply.supply_client_command(Path('build'),Path('manifest'),Path('network'),Path('out'),before['profile'],'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,canonical_certificate=flag))
        self.assertNotIn('-native-canonical-certificate',commands[0])
        self.assertEqual(commands[0],[x for x in commands[1] if x!='-native-canonical-certificate'])
        self.assertEqual(supply.pair_recipe(supply.STREAM_CERTIFICATE_PAIR)['pairCaps'],supply.pair_recipe(supply.STREAM_CACHE_PAIR)['pairCaps'])
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-canonical-certificate --observer-phases',Path('.github/workflows/chain-core.yml').read_text())
        for bad in (None,1,'yes'):
            with self.assertRaises(RuntimeError):supply.recipe('grpc',supply.STREAM_PROFILE,'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,canonical_certificate=bad)
        with self.assertRaises(RuntimeError):supply.recipe(canonical_certificate=True)

    def test_suffix_pair_changes_only_private_initializer(self):
        plan=supply.pair_recipe(supply.STREAM_SUFFIX_PAIR);before,after=plan['cases']
        self.assertEqual(before,{k:v for k,v in after.items() if k!='nativeSuffixSetup'})
        self.assertIs(after['nativeSuffixSetup'],True)
        self.assertEqual(before['pacingMode'],'bounded-cadence')
        self.assertIs(before['nativeCurrentInputReuse'],True)
        self.assertNotIn('nativeCanonicalCertificate',after)
        self.assertEqual(plan['pairCaps'],supply.pair_recipe(supply.STREAM_CACHE_PAIR)['pairCaps'])
        commands=[supply.supply_client_command(Path('build'),Path('manifest'),Path('network'),Path('out'),before['profile'],'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,native_suffix_setup=flag) for flag in (False,True)]
        self.assertNotIn('-native-suffix-setup',commands[0])
        self.assertEqual(commands[0],[x for x in commands[1] if x!='-native-suffix-setup'])
        for delta in (dict(native_suffix_setup=1),dict(canonical_certificate=True)):
            with self.assertRaises(RuntimeError):supply.recipe('grpc',supply.STREAM_PROFILE,'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,**dict(dict(native_suffix_setup=True),**delta))
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-stream-suffix --observer-phases',Path('.github/workflows/chain-core.yml').read_text())

    def test_suffix_pair_recovery_binds_selection_and_raw_identity(self):
        self.check_pair_recovery(supply.STREAM_SUFFIX_PAIR)

    def test_suffix_pair_preserves_stop_on_first_failure(self):
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_SUFFIX_PAIR)
        self.assertEqual(code,0,terminal);self.assertEqual(len(calls),2)
        for fault in ('unknown','binary','closure','host'):
            code,calls,terminal=self.run_pair(fault,supply.STREAM_SUFFIX_PAIR)
            self.assertEqual(code,1);self.assertEqual(calls,['bounded-cadence']);self.assertFalse(terminal['qualified'])

    def test_tip_pair_changes_only_discovery_hint_and_preserves_stop_rules(self):
        plan=supply.pair_recipe(supply.STREAM_TIP_PAIR);before,after=plan['cases']
        self.assertEqual(before,{k:v for k,v in after.items() if k!='nativeBlockTipHint'})
        self.assertIs(after['nativeBlockTipHint'],True)
        self.assertEqual(before['pacingMode'],'bounded-cadence')
        self.assertIs(before['nativeCurrentInputReuse'],True)
        self.assertEqual(plan['pairCaps'],supply.pair_recipe(supply.STREAM_CACHE_PAIR)['pairCaps'])
        commands=[supply.supply_client_command(Path('build'),Path('manifest'),Path('network'),Path('out'),before['profile'],'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,block_tip_hint=flag) for flag in (False,True)]
        self.assertNotIn('-native-block-tip-hint',commands[0])
        self.assertEqual(commands[0],[x for x in commands[1] if x!='-native-block-tip-hint'])
        for delta in (dict(block_tip_hint=1),dict(canonical_certificate=True),dict(native_suffix_setup=True),dict(native_stream8=False)):
            args=dict(transport='grpc',profile_name=supply.STREAM_PROFILE,pacing='bounded-cadence',observer_phases=True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,block_tip_hint=True)
            args.update(delta)
            with self.assertRaises(RuntimeError):supply.recipe(**args)
        with self.assertRaisesRegex(RuntimeError,'outside finite'):supply.validate_report(dict(nativeBlockTipHint=True))
        with self.assertRaisesRegex(RuntimeError,'tip command'):supply.supply_client_command(Path('build'),Path('manifest'),Path('network'),Path('out'),before['profile'],'relative',block_tip_hint=True)
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-block-tip-hint --observer-phases',Path('.github/workflows/chain-core.yml').read_text())
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_TIP_PAIR)
        self.assertEqual(code,0,terminal);self.assertEqual(len(calls),2)
        for fault in ('unknown','binary','closure','host'):
            code,calls,terminal=self.run_pair(fault,supply.STREAM_TIP_PAIR)
            self.assertEqual(code,1);self.assertEqual(calls,['bounded-cadence']);self.assertFalse(terminal['qualified'])

    def test_tip_pair_recovery_binds_hint_to_original_receipt(self):
        self.check_pair_recovery(supply.STREAM_TIP_PAIR)

    def test_recipe_fixed_order_and_scoped_budget(self):
        plan=supply.pair_recipe(supply.STREAM_PAIR)
        self.assertEqual([r['pacingMode'] for r in plan['cases']],['relative','bounded-cadence'])
        self.assertEqual(plan['pairCaps']['totalMs'],120000)
        self.assertEqual(plan['pairCaps']['retainedBytes'],512<<20)
        self.assertEqual(supply.pair_recipe()['pairCaps']['retainedBytes'],64<<20)
        self.assertTrue(plan['requiresSeparateRootGrant']);self.assertFalse(plan['nodesStarted'])
        for case in plan['cases']:
            self.assertTrue(case['nativeStream8']);self.assertEqual(case['profile']['senders'],2048)
        workflow=Path('.github/workflows/chain-core.yml').read_text()
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-stream-cadence --observer-phases',workflow)

    def test_stream_scoped_caps_reserve_aggregate_and_private_independently(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);data=root/'data';evidence=root/'evidence';build=root/'build'
            for path in (data,evidence,build):path.mkdir()
            sample=dict(rssBytes=1,threads=1,privateBytes=255<<20,buildBytes=1,freeDiskBytes=10<<30,availableMemoryBytes=2<<30)
            budget=supply.PairBudget(data,evidence,0,build,supply.STREAM_PAIR)
            with patch.object(supply.time,'monotonic',return_value=1):
                floor=sum(supply.native.CAPS[k] for k in ('diskFloorBytes','rootReserveBytes','compileReserveBytes'))
                with self.assertRaisesRegex(RuntimeError,'initial disk reserve'):budget.observe(dict(sample,freeDiskBytes=floor+(512<<20)-1))
                observed=budget.observe(sample)
                self.assertIsInstance(observed,dict,"real enforced post-fsync sample was discarded")
                self.assertEqual(observed,budget.samples[-1])
                with self.assertRaisesRegex(RuntimeError,'privateBytes'):budget.observe(dict(sample,privateBytes=(256<<20)+1))
                with patch.object(supply.native,'directory_bytes',return_value=(256<<20)+1):
                    with self.assertRaisesRegex(RuntimeError,'retained512MiB'):budget.observe(sample)

    def test_pair_retirement_proof_and_tasks_survive_without_mutable_aliases(self):
        for direct in (False,True):
            with self.subTest(directNativeCapture=direct),tempfile.TemporaryDirectory() as d:
                root=Path(d);data=root/'data';evidence=root/'evidence';build=root/'build'
                for path in (data,evidence,build):path.mkdir()
                before=dict(pid=2,parent=1,group=2,startTicks=17,state='R',threads=1)
                retired=dict(before,state='Z')
                trace=dict(pid=2,before=before,after=dict(before),errno=3,failedRead='smaps_rollup',capturedAtUnixNs=100,retirementConfirmation=retired,outcome='zombie')
                sample=dict(rssBytes=1024,threads=2,privateBytes=1,buildBytes=1,freeDiskBytes=10<<30,availableMemoryBytes=2<<30,tasks=[dict(pid=1,rssBytes=1024),dict(retired,rssBytes=0)],retiredOwnedTransitions=[trace])
                budget=supply.PairBudget(data,evidence,0,build,supply.STREAM_GROUPED_PAIR)
                with patch.object(supply.time,'monotonic',return_value=1),patch.object(supply,'native_sample',return_value=sample):
                    observed=budget.observe() if direct else budget.observe(sample)
                    self.assertEqual(observed['retiredOwnedTransitions'],sample['retiredOwnedTransitions'])
                    self.assertEqual(observed['tasks'],sample['tasks'])
                    self.assertEqual(observed['rssBytes'],1024)
                    trace['retirementConfirmation']['startTicks']=999
                    sample['tasks'][1]['state']='R'
                    self.assertEqual(observed['retiredOwnedTransitions'][0]['retirementConfirmation']['startTicks'],17)
                    self.assertEqual(observed['tasks'][1]['state'],'Z')
                    count=len(budget.samples)
                    with self.assertRaisesRegex(RuntimeError,'rssBytes'):
                        budget.observe(dict(sample,rssBytes=(1<<30)+1))
                    self.assertEqual(len(budget.samples),count)

    def test_pair_without_retirement_keeps_original_summary_shape(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);data=root/'data';evidence=root/'evidence';build=root/'build'
            for path in (data,evidence,build):path.mkdir()
            sample=dict(rssBytes=1024,threads=1,privateBytes=1,buildBytes=1,freeDiskBytes=10<<30,availableMemoryBytes=2<<30,tasks=[dict(pid=1,rssBytes=1024)])
            budget=supply.PairBudget(data,evidence,0,build,supply.STREAM_GROUPED_PAIR)
            with patch.object(supply.time,'monotonic',return_value=1):observed=budget.observe(sample)
            self.assertNotIn('tasks',observed)
            self.assertNotIn('retiredOwnedTransitions',observed)

    def test_current_input_pair_uses_same_bounded_pace_and_only_cache_changes(self):
        plan=supply.pair_recipe(supply.STREAM_CACHE_PAIR);before,after=plan['cases']
        self.assertEqual([x['pacingMode'] for x in plan['cases']],['bounded-cadence','bounded-cadence'])
        self.assertEqual([x['nativeCurrentInputReuse'] for x in plan['cases']],[False,True])
        omit={'nativeCurrentInputReuse'}
        self.assertEqual({k:v for k,v in before.items() if k not in omit},{k:v for k,v in after.items() if k not in omit})
        self.assertEqual(plan['pairCaps'],supply.pair_recipe(supply.STREAM_PAIR)['pairCaps'])
        for selected in (False,True):
            command=supply.supply_client_command(Path('build'),Path('manifest'),Path('network'),Path('out'),before['profile'],'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True,current_input_reuse=selected)
            self.assertEqual('-native-current-input-reuse' in command,selected)
            self.assertEqual(command[command.index('-pacing-mode')+1],'bounded-cadence')
        for action in ('prepare','execute'):
            self.assertIn('--'+action+'-pair --pair-kind native-current-input --observer-phases',Path('.github/workflows/chain-core.yml').read_text())

    def test_comparison_retains_regression_and_never_claims_sustained(self):
        before=dict(measurement=measurement());after=dict(measurement=measurement(400))
        self.assertTrue(supply.native_stream_pair_observation([before,after])['finiteJointImprovementObserved'])
        after['measurement']=measurement(400,4000000000)
        result=supply.native_stream_pair_observation([before,after])
        self.assertTrue(result['finiteFinalRateIncreased']);self.assertFalse(result['finiteJointImprovementObserved']);self.assertFalse(result['sustainedTPSQualified'])
        after['measurement']['offerLatencyIntervalsNs']['offerToFinal']['samples']=8191
        with self.assertRaises(RuntimeError):supply.native_stream_pair_observation([before,after])

    def test_pair_recovery_binds_both_raw_receipts_and_identity(self):
        self.check_pair_recovery(supply.STREAM_PAIR)

    def test_canonical_pair_recovery_binds_certificate_and_raw_identity(self):
        self.check_pair_recovery(supply.STREAM_CERTIFICATE_PAIR)

    def check_pair_recovery(self,kind):
        spec=importlib.util.spec_from_file_location('pair_archive',Path(__file__).with_name('native-stream-artifact.py'))
        archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();(root/'evidence').mkdir();head='a'*40
            pair=dict(supply.pair_recipe(kind),sourceCommit=head,case='/unit/pair',hostIdentity=dict(bootID='unit-boot'),compiledBinaries=dict(ELF='same'),casesQualified=True,firstCause=None)
            rows=[];cases=[]
            for index,(label,mode,reuse) in enumerate(supply.native_stream_pair_spec(kind)):
                canonical=kind==supply.STREAM_CERTIFICATE_PAIR and index==1
                suffix=kind==supply.STREAM_SUFFIX_PAIR and index==1
                tip=kind==supply.STREAM_TIP_PAIR and index==1
                submitters=16 if kind==supply.STREAM_SUBMIT16_PAIR and index==1 else 8
                client_procs2=kind==supply.STREAM_PROCS_PAIR and index==1
                exit_mm_proof=kind in (supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR)
                prepared=kind in (supply.STREAM_GROUPED_PAIR,supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR) or kind==supply.STREAM_PREPARED_PAIR and index==1
                case=('before-' if index==0 else 'after-')+label
                directory=root/case/'evidence';directory.mkdir(parents=True)
                row=dict(**({"clientProcs2":True} if client_procs2 else {}),**({"nativeExitMMProof":True} if exit_mm_proof else {}),**({"nativePreparedCertificate":True} if prepared else {}),**({"nativeStreamSubmitters":16} if submitters==16 else {}),sourceCommit=head,sourceTree='tree',internalTree='internal',compiler='compiler',environment={},host=dict(uname='unit',cpuCount=4,meminfo=str(index)),case='/unit/pair/'+case,pacingMode=mode,nativeCurrentInputReuse=reuse,**({"nativeCanonicalCertificate":True} if canonical else {}),**({"nativeSuffixSetup":True} if suffix else {}),**({"nativeBlockTipHint":True} if tip else {}),binaries=pair['compiledBinaries'])
                raw=json.dumps(row).encode();(directory/'actual.json').write_bytes(raw);rows.append((directory/'actual.json',raw))
                cases.append(dict(**({"clientProcs2":client_procs2} if kind==supply.STREAM_PROCS_PAIR else {}),**({"exitMMProof":True} if exit_mm_proof else {}),**({"preparedCertificate":prepared} if kind in (supply.STREAM_PREPARED_PAIR,supply.STREAM_GROUPED_PAIR,supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR) else {}),**({"submitters":submitters} if kind==supply.STREAM_SUBMIT16_PAIR else {}),order=index+1,label=label,mode=mode,currentInputReuse=reuse,**({"canonicalCertificate":canonical} if kind==supply.STREAM_CERTIFICATE_PAIR else {}),**({"nativeSuffixSetup":suffix} if kind==supply.STREAM_SUFFIX_PAIR else {}),**({"blockTipHint":tip} if kind==supply.STREAM_TIP_PAIR else {}),code=0,firstCause=None,sha256=hashlib.sha256(raw).hexdigest(),hostIdentity=pair['hostIdentity'],measurement=measurement(300+index),receipt='/unit/evidence/'+label+'-actual.json'))
            pair['cases']=cases;pair['jointObservation']=supply.native_stream_pair_observation(cases)
            def verify(destination,mode,head,**kwargs):
                index=0 if Path(destination).name.startswith('before-') else 1
                self.assertEqual(kwargs['expected_case'],Path(destination).name)
                return dict(measurement=cases[index]['measurement'])
            def check(value):
                (root/'evidence/actual.json').write_text(json.dumps(value))
                with patch.object(archive,'verify_capture',side_effect=verify):return archive.verify_network_pair(root,head,supply.stream_evidence,supply)
            proof=check(pair);self.assertTrue(proof['streamReadbackVerified']);self.assertFalse(proof['networkQualified'])
            for fault in ('order','hostIdentity','sha256','measurement','mode','canonicalCertificate','nativeSuffixSetup','blockTipHint'):
                changed=copy.deepcopy(pair);changed['cases'][1][fault]='changed'
                with self.subTest(fault=fault),self.assertRaises(RuntimeError):check(changed)
            if kind in (supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR):
                changed=copy.deepcopy(pair);changed['cases'][1]['exitMMProof']=False
                with self.assertRaises(RuntimeError):check(changed)
            if kind in (supply.STREAM_PREPARED_PAIR,supply.STREAM_GROUPED_PAIR,supply.STREAM_MM_PAIR,supply.STREAM_PROCS_PAIR):
                changed=copy.deepcopy(pair);changed['cases'][1]['preparedCertificate']=False
                with self.assertRaises(RuntimeError):check(changed)
                bad_receipt=json.loads(rows[1][1]);bad_receipt['nativePreparedCertificate']=False
                bad_raw=json.dumps(bad_receipt).encode();rows[1][0].write_bytes(bad_raw)
                rebound=copy.deepcopy(pair);rebound['cases'][1]['sha256']=hashlib.sha256(bad_raw).hexdigest()
                with self.assertRaisesRegex(RuntimeError,'prepared producer'):check(rebound)
                rows[1][0].write_bytes(rows[1][1])
            if kind==supply.STREAM_SUBMIT16_PAIR:
                changed=copy.deepcopy(pair);changed['cases'][1]['submitters']=8
                with self.assertRaises(RuntimeError):check(changed)
                bad_receipt=json.loads(rows[1][1]);bad_receipt['nativeStreamSubmitters']=8
                bad_raw=json.dumps(bad_receipt).encode();rows[1][0].write_bytes(bad_raw)
                rebound=copy.deepcopy(pair);rebound['cases'][1]['sha256']=hashlib.sha256(bad_raw).hexdigest()
                with self.assertRaisesRegex(RuntimeError,'submitter receipt'):check(rebound)
                rows[1][0].write_bytes(rows[1][1])
            if kind==supply.STREAM_SUFFIX_PAIR:
                bad_receipt=json.loads(rows[1][1]);bad_receipt['nativeSuffixSetup']=False
                bad_raw=json.dumps(bad_receipt).encode();rows[1][0].write_bytes(bad_raw)
                rebound=copy.deepcopy(pair);rebound['cases'][1]['sha256']=hashlib.sha256(bad_raw).hexdigest()
                with self.assertRaisesRegex(RuntimeError,'private suffix selection'):check(rebound)
                rows[1][0].write_bytes(rows[1][1])
            if kind==supply.STREAM_TIP_PAIR:
                bad_receipt=json.loads(rows[1][1]);bad_receipt['nativeBlockTipHint']=False
                bad_raw=json.dumps(bad_receipt).encode();rows[1][0].write_bytes(bad_raw)
                rebound=copy.deepcopy(pair);rebound['cases'][1]['sha256']=hashlib.sha256(bad_raw).hexdigest()
                with self.assertRaisesRegex(RuntimeError,'tip hint selection'):check(rebound)
                rows[1][0].write_bytes(rows[1][1])
            if kind==supply.STREAM_PROCS_PAIR:
                bad_receipt=json.loads(rows[1][1]);bad_receipt['clientProcs2']=False
                bad_raw=json.dumps(bad_receipt).encode();rows[1][0].write_bytes(bad_raw)
                rebound=copy.deepcopy(pair);rebound['cases'][1]['sha256']=hashlib.sha256(bad_raw).hexdigest()
                with self.assertRaisesRegex(RuntimeError,'client scheduler axis'):check(rebound)
                rows[1][0].write_bytes(rows[1][1])
            rows[1][0].write_bytes(rows[1][1]+b' ')
            with self.assertRaises(RuntimeError):check(pair)

    def run_pair(self,fault=None,comparison=None,require_first_row_released=False):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d).resolve();source=parent/'source';source.mkdir();build=parent/'build';build.mkdir();evidence=parent/'evidence';evidence.mkdir()
            for name in supply.BINARIES:(build/name).write_bytes(name.encode())
            pins={name:dict(sha256=hashlib.sha256(name.encode()).hexdigest(),bytes=len(name)) for name in supply.BINARIES}
            calls=[];host=dict(bootID='unit-boot',pidNamespaceInode=1);host_calls=[]
            first_row=[];original_json=supply.stream_evidence.strict_json
            class TrackedReceipt(dict):pass
            def read_receipt(raw):
                value=original_json(raw)
                if require_first_row_released and value.get('sourceCommit')=='a'*40:
                    value=TrackedReceipt(value)
                    if not first_row:first_row.append(weakref.ref(value))
                return value

            def host_identity():
                host_calls.append(1)
                return dict(host,bootID='changed') if fault=='host' and len(host_calls)>=4 else host
            def run(source,build,case,out,transport,profile,pace,**kwargs):
                if require_first_row_released and calls:self.assertIsNone(first_row[0](),'complete first receipt survives into second activation')
                if comparison==supply.STREAM_CERTIFICATE_PAIR:
                    self.assertIs(kwargs['canonical_certificate'],len(calls)==1)
                    self.assertIs(kwargs['current_input_reuse'],True)
                if comparison==supply.STREAM_SUFFIX_PAIR:
                    self.assertIs(kwargs['native_suffix_setup'],len(calls)==1)
                    self.assertIs(kwargs['canonical_certificate'],False)
                    self.assertIs(kwargs['current_input_reuse'],True)
                if comparison==supply.STREAM_TIP_PAIR:
                    self.assertIs(kwargs['block_tip_hint'],len(calls)==1)
                    self.assertIs(kwargs['native_suffix_setup'],False)
                    self.assertIs(kwargs['canonical_certificate'],False)
                    self.assertIs(kwargs['current_input_reuse'],True)
                if comparison==supply.STREAM_SUBMIT16_PAIR:
                    self.assertEqual(kwargs['submitters'],16 if calls else 8)
                    self.assertFalse(kwargs['block_tip_hint']);self.assertFalse(kwargs['canonical_certificate']);self.assertFalse(kwargs['native_suffix_setup']);self.assertTrue(kwargs['current_input_reuse'])
                if comparison==supply.STREAM_PREPARED_PAIR:
                    self.assertIs(kwargs['prepared'],len(calls)==1);self.assertEqual(kwargs['submitters'],8)
                    self.assertFalse(kwargs['block_tip_hint']);self.assertFalse(kwargs['canonical_certificate']);self.assertFalse(kwargs['native_suffix_setup']);self.assertTrue(kwargs['current_input_reuse'])
                if comparison==supply.STREAM_PROCS_PAIR:
                    self.assertIs(kwargs["client_procs2"],len(calls)==1)
                    self.assertIs(kwargs["prepared"],True);self.assertIs(kwargs["exit_mm_proof"],True)
                    self.assertEqual(pace,"grouped-cadence4");self.assertEqual(kwargs["submitters"],8)
                calls.append(pace);case.mkdir()
                row=dict(sourceCommit='a'*40,sourceTree='tree',internalTree='internal',compiler='compiler',binaries=pins,environment={},host=dict(uname='unit',cpuCount=4),nodePhases={},firstCause=None)
                if fault=='unknown':row['firstCause']='submission UNKNOWN'
                out.write_text(json.dumps(row))
                if fault=='binary':(build/supply.BINARIES[0]).write_bytes(b'changed')
                return 1 if fault=='unknown' else 0
            def closure(budget,**kwargs):
                if fault=='closure':raise RuntimeError('owned child remains')
                return [dict(empty=True),dict(empty=True)]
            output=io.StringIO()
            def observe(*args):
                if fault=='post-fsync' and (evidence/'actual.json').exists():raise RuntimeError('post fsync resource violation')
                return dict(elapsedMs=1,retainedBytes=1,logBytes=0,rssBytes=1,threads=1,availableMemoryBytes=2<<30,freeDiskBytes=10<<30,buildBytes=1) if fault!='missing-sample' else None
            with patch.object(supply.sys,'platform','linux'),patch.object(supply.platform,'machine',return_value='x86_64'),patch.object(supply,'native_pair_host_identity',side_effect=host_identity),patch.object(supply.PairBudget,'observe',side_effect=observe),patch.object(supply,'empty_pair_closure',side_effect=closure),patch.object(supply,'run',side_effect=run),patch.object(supply,'native_stream_pair_case',new=lambda row,case,mode,**kwargs:measurement(300 if mode=='relative' else 400)),patch.object(supply.stream_evidence,'strict_json',new=read_receipt),patch.object(supply.signal,'signal'),patch.object(supply.signal,'setitimer'),contextlib.redirect_stdout(output):
                code=supply.run_native_stream_pair(source,build,parent/'pair',evidence/'actual.json',comparison or supply.STREAM_PAIR)
            terminal=json.loads(output.getvalue().split('YNX_NATIVE_STREAM_PAIR_TERMINAL ')[-1])
            return code,calls,terminal

    def test_pair_report_still_requires_original_report_hash(self):
        row=supply.recipe('grpc',supply.STREAM_PROFILE,'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True)
        row.update(cleanupComplete=True,nodesStarted=True,firstCause=None)
        for value in (None,False,'bad'):
            row['resultSHA256']=value
            with patch.object(supply,'read_native_stream_report',side_effect=AssertionError('unbound report decoded')):
                with self.assertRaisesRegex(RuntimeError,'hash differs'):supply.native_stream_pair_case(row,Path('unused'),'bounded-cadence')

    def test_report_reader_releases_raw_before_strict_decode(self):
        class Capture(bytearray):pass
        refs=[];raw=b'{"counter":1}';original=supply.stream_evidence.strict_json
        def capture(path,limit):
            self.assertEqual(limit,16<<20);value=Capture(raw);refs.append(weakref.ref(value));return value
        def decode(text):
            self.assertIsInstance(text,str)
            self.assertIsNone(refs[-1](),'raw bytes survive strict object decoding')
            return original(text)
        with patch.object(supply.stream_evidence,'capture',new=capture),patch.object(supply.stream_evidence,'strict_json',new=decode):
            row,digest=supply.read_native_stream_report(Path('original'),hashlib.sha256(raw).hexdigest())
        self.assertEqual(row,dict(counter=1));self.assertEqual(digest,hashlib.sha256(raw).hexdigest())

    def test_report_reader_preserves_hash_encoding_and_strict_failures(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'report.json';expected=dict(text='original '+chr(0x4e2d),number=1)
            for encoding in ('utf-8','utf-8-sig','utf-16','utf-16-le','utf-16-be','utf-32','utf-32-le','utf-32-be'):
                raw=json.dumps(expected,ensure_ascii=False).encode(encoding);path.write_bytes(raw)
                row,digest=supply.read_native_stream_report(path,hashlib.sha256(raw).hexdigest())
                self.assertEqual(row,supply.stream_evidence.strict_json(raw));self.assertEqual(row,expected)
                self.assertEqual(digest,hashlib.sha256(raw).hexdigest())
            with self.assertRaisesRegex(RuntimeError,'hash differs'):supply.read_native_stream_report(path,'0'*64)
            for raw in (b'{"a":1,"a":2}',b'{"value":NaN}',b'{} trailing',b'"'+bytes([0xff])+b'"'):
                path.write_bytes(raw)
                with self.subTest(raw=raw),self.assertRaises(RuntimeError):supply.read_native_stream_report(path)
            link=Path(d)/'link.json';link.symlink_to(path)
            with self.assertRaises(RuntimeError):supply.read_native_stream_report(link)
            with path.open('wb') as f:f.truncate((16<<20)+1)
            with self.assertRaises(RuntimeError):supply.read_native_stream_report(path)

    def test_compact_identity_preserves_all_original_comparison_fields(self):
        row=dict(sourceCommit='source',sourceTree='tree',internalTree='internal',compiler='compiler',binaries={'ELF':'hash'},environment={'GOMAXPROCS':'1'},host=dict(uname=['Linux'],cpuCount=4,cpuinfo='large diagnostic'),samples=['retained only on disk'])
        identity=supply.native_stream_case_identity(row)
        self.assertEqual(set(identity),{'sourceCommit','sourceTree','internalTree','compiler','binaries','environment','host'})
        self.assertEqual(identity['host'],dict(uname=['Linux'],cpuCount=4))
        for key in ('sourceCommit','sourceTree','internalTree','compiler','binaries','environment'):
            changed=copy.deepcopy(row);changed[key]='different'
            self.assertNotEqual(identity,supply.native_stream_case_identity(changed))
            changed=copy.deepcopy(row);del changed[key]
            with self.assertRaises(KeyError):supply.native_stream_case_identity(changed)
        for key in ('uname','cpuCount'):
            changed=copy.deepcopy(row);changed['host'][key]='different'
            self.assertNotEqual(identity,supply.native_stream_case_identity(changed))

    def test_first_complete_receipt_is_released_before_second_activation(self):
        code,calls,terminal=self.run_pair(require_first_row_released=True)
        self.assertEqual(code,0,terminal);self.assertEqual(len(calls),2)

    def test_serial_pair_success_has_post_fsync_two_scans(self):
        code,calls,terminal=self.run_pair()
        self.assertEqual(code,0,terminal);self.assertEqual(calls,['relative','bounded-cadence']);self.assertTrue(terminal['qualified']);self.assertEqual(len(terminal['postFsyncClosureScans']),2);self.assertIsInstance(terminal['postFsyncSample'],dict)

    def test_unknown_changed_binary_or_unclean_closure_never_starts_second(self):
        for fault in ('unknown','binary','closure','host'):
            with self.subTest(fault=fault):
                code,calls,terminal=self.run_pair(fault)
                self.assertEqual(code,1);self.assertEqual(calls,['relative']);self.assertFalse(terminal['qualified']);self.assertTrue(terminal['firstCause'])

    def test_current_input_pair_keeps_first_failure_stop_rule(self):
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_CACHE_PAIR)
        self.assertEqual(code,0,terminal);self.assertEqual(calls,['bounded-cadence','bounded-cadence'])
        code,calls,terminal=self.run_pair('unknown',supply.STREAM_CACHE_PAIR)
        self.assertEqual(code,1);self.assertEqual(calls,['bounded-cadence']);self.assertFalse(terminal['qualified'])

    def test_canonical_pair_keeps_first_failure_stop_rule(self):
        code,calls,terminal=self.run_pair(comparison=supply.STREAM_CERTIFICATE_PAIR)
        self.assertEqual(code,0,terminal);self.assertEqual(calls,["bounded-cadence","bounded-cadence"])
        for fault in ("unknown","binary","closure","host"):
            code,calls,terminal=self.run_pair(fault,supply.STREAM_CERTIFICATE_PAIR)
            self.assertEqual(code,1);self.assertEqual(calls,["bounded-cadence"]);self.assertFalse(terminal["qualified"])

    def test_post_fsync_failure_cannot_be_qualified(self):
        for fault in ('post-fsync','missing-sample'):
            with self.subTest(fault=fault):
                code,calls,terminal=self.run_pair(fault)
                self.assertEqual(code,1);self.assertEqual(len(calls),2);self.assertFalse(terminal['qualified']);self.assertTrue(terminal['firstCause'])


# Protocol/lifetime counterexamples only. The mocked checker below is never a
# business or network qualification; real8192 original evidence is exercised
# separately by the unchanged full checker in an actual child process.
class NativeVerifierProtocolTests(unittest.TestCase):
    def fixture(self,root):
        from types import SimpleNamespace
        case=Path(root).resolve();network=case/'network';network.mkdir()
        for name in ('network-manifest.json','transactions.json','transactions-result.json','transactions-result.json.streaming-plan.json'):(network/name).write_text('{}')
        for directory,prefix in [('sender-ready-intents','intent'),('transactions-result.json.terminal-stream','terminal')]:
            (network/directory).mkdir();(network/directory/(prefix+'-000000.jsonl')).write_bytes(b'mocked protocol data only\n')
        selection=supply.native_verifier_selection('bounded-cadence',True,False,False,False);calls=[]
        def validate(report,path,**kwargs):calls.append(kwargs);return dict(summary=dict(input=8192,finalSubmitted=8192),sourceOnlyMock=True)
        controller=SimpleNamespace(__file__=supply.__file__,stream_evidence=supply.stream_evidence,recipe=supply.recipe,STREAM_PROFILE=supply.STREAM_PROFILE,read_native_stream_report=supply.read_native_stream_report,validate_native_stream_report=validate,validate_observer_phases=lambda report,tip:dict(sourceOnlyMock=True))
        return case,selection,controller,calls
    def produce(self,case,selection,controller):
        out=io.StringIO()
        with contextlib.redirect_stdout(out):value=supply.stream_verifier.produce(controller,case,selection)
        (case/'verifier.log').write_text(out.getvalue());return value
    def test_two_full_checker_calls_and_transfer_identity(self):
        with tempfile.TemporaryDirectory() as d:
            case,selection,c,calls=self.fixture(d);v=self.produce(case,selection,c)
            self.assertEqual(calls,[selection,selection]);self.assertEqual(v['checkerPasses'],2)
            value,meta=supply.stream_verifier.load_result(c,case,selection,v['pid'],v['parentPID'])
            self.assertEqual(value,v);self.assertEqual(meta['clientSHA256'],v['clientSHA256']);self.assertFalse(value['networkQualified'])
            with self.assertRaises(FileExistsError):self.produce(case,selection,c)
    def test_changed_evidence_or_terminal_never_transfers(self):
        for fault in ('body','new-member','pid','selection','source','missing-terminal','partial-result'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as d:
                case,selection,c,_=self.fixture(d);v=self.produce(case,selection,c)
                pid=v['pid'];chosen=copy.deepcopy(selection)
                if fault=='body':(case/'network/transactions.json').write_text('{"changed":true}')
                if fault=='new-member':(case/'network/sender-ready-intents/intent-000001.jsonl').write_text('new')
                if fault=='pid':pid+=1
                if fault=='selection':chosen['expected_block_tip_hint']=True
                if fault=='source':
                    v['sourceIdentity']['controller']='0'*64;(case/supply.stream_verifier.NAME).write_text(json.dumps(v))
                if fault=='missing-terminal':(case/'verifier.log').write_text('')
                if fault=='partial-result':(case/supply.stream_verifier.NAME).write_text('{')
                with self.assertRaises((RuntimeError,UnicodeError)):supply.stream_verifier.load_result(c,case,chosen,pid,v['parentPID'])
    def test_mutation_during_checker_never_publishes(self):
        with tempfile.TemporaryDirectory() as d:
            case,selection,c,calls=self.fixture(d);original=c.validate_native_stream_report
            def changed(*args,**kwargs):
                result=original(*args,**kwargs);(case/'network/transactions.json').write_text('{"changed":true}');return result
            c.validate_native_stream_report=changed
            with self.assertRaises(RuntimeError):self.produce(case,selection,c)
            self.assertFalse((case/supply.stream_verifier.NAME).exists())
    def test_post_fsync_cannot_qualify_without_selected_full_worker(self):
        with tempfile.TemporaryDirectory() as d:
            row=supply.recipe('grpc',supply.STREAM_PROFILE,'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True)
            row.update(case=str(Path(d).resolve()),launcher=7,firstCause=None,nodesStarted=True,cleanupComplete=True,closureScans=[dict(owned=[7],launcherStartTicks=1)]*2,measurement=dict(summary=dict(finalSubmitted=8192)))
            receipt=Path(d)/'receipt.json';receipt.write_text(json.dumps(row));out=io.StringIO()
            with patch.object(supply.time,'monotonic',return_value=1),patch.object(supply,'post_fsync_owned_closure',return_value=dict(owned=[7],launcherStartTicks=1)),contextlib.redirect_stdout(out):
                self.assertFalse(supply.oneshot_post_fsync(row,receipt,lambda:dict(privateBytes=1),0,native_stream8=True))
            self.assertIn('native verifier',row['firstCause'])

    def test_verifier_is_not_exempt_from_original_aggregate_caps(self):
        row=supply.recipe('grpc',supply.STREAM_PROFILE,'bounded-cadence',True,prefix_replay=True,prefix_native_clone=True,observer_native_facts=True,native_stream8=True)
        caps=row['resourceCaps'];sample=dict(rssBytes=1,threads=1,privateBytes=1,buildBytes=1,freeDiskBytes=10<<30,availableMemoryBytes=2<<30,tasks=[dict(role='launcher')]+[dict(role='node') for _ in range(8)]+[dict(role='verifier')])
        supply.enforce_captured_sample(sample,copy.deepcopy(row))
        for delta in (dict(rssBytes=caps['ownedRSSBytes']+1),dict(threads=caps['threads']+1),dict(privateBytes=caps['privateBytes']+1),dict(tasks=sample['tasks']+[dict(role='unexpected')])):
            result=copy.deepcopy(row)
            with self.subTest(delta=delta),self.assertRaises(RuntimeError):supply.enforce_captured_sample(dict(sample,**delta),result)
            self.assertEqual(len(result['refusedSamples']),1)

    def test_client_exit_is_required_and_worker_failure_is_not_retried(self):
        from types import SimpleNamespace
        for state in (None,False,1,-15):
            started=[]
            with self.assertRaisesRegex(RuntimeError,'client exit'):supply.stream_verifier.after_client_exit(SimpleNamespace(poll=lambda:state),lambda *a:started.append(a),lambda p:None,[],Path('missing'))
            self.assertEqual(started,[])
        with tempfile.TemporaryDirectory() as d:
            log=Path(d)/'verifier.log';log.write_text(supply.stream_verifier.MARKER+json.dumps(dict(complete=False,firstCause='original checker failed'))+'\n')
            started=[];worker=SimpleNamespace(poll=lambda:1,returncode=1)
            def spawn(*args):started.append(args);return worker
            def wait(p):raise RuntimeError('child failed: original worker')
            with self.assertRaisesRegex(RuntimeError,'original checker failed'):supply.stream_verifier.after_client_exit(SimpleNamespace(poll=lambda:0),spawn,wait,[],log)
            self.assertEqual(len(started),1)
            unknown=SimpleNamespace(poll=lambda:None,returncode=None)
            with self.assertRaisesRegex(RuntimeError,'terminal UNKNOWN'):supply.stream_verifier.after_client_exit(SimpleNamespace(poll=lambda:0),lambda *a:unknown,lambda p:None,[],log)
            def budget(p):raise RuntimeError('rssBytes cap exceeded/invalid')
            with self.assertRaisesRegex(RuntimeError,'rssBytes cap'):supply.stream_verifier.after_client_exit(SimpleNamespace(poll=lambda:0),spawn,budget,[],log)

if __name__=='__main__':unittest.main()
