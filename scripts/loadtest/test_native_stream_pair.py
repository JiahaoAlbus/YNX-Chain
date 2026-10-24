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
                case=('before-' if index==0 else 'after-')+label
                directory=root/case/'evidence';directory.mkdir(parents=True)
                row=dict(sourceCommit=head,sourceTree='tree',internalTree='internal',compiler='compiler',environment={},host=dict(uname='unit',cpuCount=4,meminfo=str(index)),case='/unit/pair/'+case,pacingMode=mode,nativeCurrentInputReuse=reuse,**({"nativeCanonicalCertificate":True} if canonical else {}),**({"nativeSuffixSetup":True} if suffix else {}),**({"nativeBlockTipHint":True} if tip else {}),binaries=pair['compiledBinaries'])
                raw=json.dumps(row).encode();(directory/'actual.json').write_bytes(raw);rows.append((directory/'actual.json',raw))
                cases.append(dict(order=index+1,label=label,mode=mode,currentInputReuse=reuse,**({"canonicalCertificate":canonical} if kind==supply.STREAM_CERTIFICATE_PAIR else {}),**({"nativeSuffixSetup":suffix} if kind==supply.STREAM_SUFFIX_PAIR else {}),**({"blockTipHint":tip} if kind==supply.STREAM_TIP_PAIR else {}),code=0,firstCause=None,sha256=hashlib.sha256(raw).hexdigest(),hostIdentity=pair['hostIdentity'],measurement=measurement(300+index),receipt='/unit/evidence/'+label+'-actual.json'))
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

if __name__=='__main__':unittest.main()
