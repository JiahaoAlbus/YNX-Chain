"""Native cadence pair controller counterexamples; no nodes, compiler or HTTP."""
import contextlib,copy,hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('supply',Path(__file__).with_name('supply-linux-window.py'))
supply=importlib.util.module_from_spec(spec);spec.loader.exec_module(supply)

def measurement(rate=300,upper=2000000000):
    distribution=dict(samples=8192,**{q:dict(valid=True,lowerNs=upper-999999,upperNs=upper) for q in ('p50','p95','p99')})
    return dict(summary=dict(finalSubmittedPerMeasurementSecond=rate),offerLatencyIntervalsNs={n:copy.deepcopy(distribution) for n in ('offerToEffectiveBusinessInclusion','offerToFinal')})

class NativeStreamPairTests(unittest.TestCase):
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

    def test_comparison_retains_regression_and_never_claims_sustained(self):
        before=dict(measurement=measurement());after=dict(measurement=measurement(400))
        self.assertTrue(supply.native_stream_pair_observation([before,after])['finiteJointImprovementObserved'])
        after['measurement']=measurement(400,4000000000)
        result=supply.native_stream_pair_observation([before,after])
        self.assertTrue(result['finiteFinalRateIncreased']);self.assertFalse(result['finiteJointImprovementObserved']);self.assertFalse(result['sustainedTPSQualified'])
        after['measurement']['offerLatencyIntervalsNs']['offerToFinal']['samples']=8191
        with self.assertRaises(RuntimeError):supply.native_stream_pair_observation([before,after])

    def test_pair_recovery_binds_both_raw_receipts_and_identity(self):
        spec=importlib.util.spec_from_file_location('pair_archive',Path(__file__).with_name('native-stream-artifact.py'))
        archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();(root/'evidence').mkdir();head='a'*40
            pair=dict(supply.pair_recipe(supply.STREAM_PAIR),sourceCommit=head,case='/unit/pair',hostIdentity=dict(bootID='unit-boot'),compiledBinaries=dict(ELF='same'),casesQualified=True,firstCause=None)
            rows=[];cases=[]
            for index,mode in enumerate(supply.STREAM_PACING_MODES):
                label=supply.pair_modes(supply.STREAM_PAIR)[index];case=('before-' if index==0 else 'after-')+label
                directory=root/case/'evidence';directory.mkdir(parents=True)
                row=dict(sourceCommit=head,sourceTree='tree',internalTree='internal',compiler='compiler',environment={},host=dict(uname='unit',cpuCount=4,meminfo=str(index)),case='/unit/pair/'+case,pacingMode=mode,binaries=pair['compiledBinaries'])
                raw=json.dumps(row).encode();(directory/'actual.json').write_bytes(raw);rows.append((directory/'actual.json',raw))
                cases.append(dict(order=index+1,label=label,mode=mode,code=0,firstCause=None,sha256=hashlib.sha256(raw).hexdigest(),hostIdentity=pair['hostIdentity'],measurement=measurement(300+index),receipt='/unit/evidence/'+label+'-actual.json'))
            pair['cases']=cases;pair['jointObservation']=supply.native_stream_pair_observation(cases)
            def verify(destination,mode,head,**kwargs):
                index=0 if Path(destination).name.startswith('before-') else 1
                self.assertEqual(kwargs['expected_case'],Path(destination).name)
                return dict(measurement=cases[index]['measurement'])
            def check(value):
                (root/'evidence/actual.json').write_text(json.dumps(value))
                with patch.object(archive,'verify_capture',side_effect=verify):return archive.verify_network_pair(root,head,supply.stream_evidence,supply)
            proof=check(pair);self.assertTrue(proof['streamReadbackVerified']);self.assertFalse(proof['networkQualified'])
            for fault in ('order','hostIdentity','sha256','measurement','mode'):
                changed=copy.deepcopy(pair);changed['cases'][1][fault]='changed'
                with self.subTest(fault=fault),self.assertRaises(RuntimeError):check(changed)
            rows[1][0].write_bytes(rows[1][1]+b' ')
            with self.assertRaises(RuntimeError):check(pair)

    def run_pair(self,fault=None):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d).resolve();source=parent/'source';source.mkdir();build=parent/'build';build.mkdir();evidence=parent/'evidence';evidence.mkdir()
            for name in supply.BINARIES:(build/name).write_bytes(name.encode())
            pins={name:dict(sha256=hashlib.sha256(name.encode()).hexdigest(),bytes=len(name)) for name in supply.BINARIES}
            calls=[];host=dict(bootID='unit-boot',pidNamespaceInode=1);host_calls=[]
            def host_identity():
                host_calls.append(1)
                return dict(host,bootID='changed') if fault=='host' and len(host_calls)>=4 else host
            def run(source,build,case,out,transport,profile,pace,**kwargs):
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
            with patch.object(supply.sys,'platform','linux'),patch.object(supply.platform,'machine',return_value='x86_64'),patch.object(supply,'native_pair_host_identity',side_effect=host_identity),patch.object(supply.PairBudget,'observe',side_effect=observe),patch.object(supply,'empty_pair_closure',side_effect=closure),patch.object(supply,'run',side_effect=run),patch.object(supply,'native_stream_pair_case',side_effect=lambda row,case,mode:measurement(300 if mode=='relative' else 400)),patch.object(supply.signal,'signal'),patch.object(supply.signal,'setitimer'),contextlib.redirect_stdout(output):
                code=supply.run_native_stream_pair(source,build,parent/'pair',evidence/'actual.json')
            terminal=json.loads(output.getvalue().split('YNX_NATIVE_STREAM_PAIR_TERMINAL ')[-1])
            return code,calls,terminal

    def test_serial_pair_success_has_post_fsync_two_scans(self):
        code,calls,terminal=self.run_pair()
        self.assertEqual(code,0,terminal);self.assertEqual(calls,['relative','bounded-cadence']);self.assertTrue(terminal['qualified']);self.assertEqual(len(terminal['postFsyncClosureScans']),2);self.assertIsInstance(terminal['postFsyncSample'],dict)

    def test_unknown_changed_binary_or_unclean_closure_never_starts_second(self):
        for fault in ('unknown','binary','closure','host'):
            with self.subTest(fault=fault):
                code,calls,terminal=self.run_pair(fault)
                self.assertEqual(code,1);self.assertEqual(calls,['relative']);self.assertFalse(terminal['qualified']);self.assertTrue(terminal['firstCause'])

    def test_post_fsync_failure_cannot_be_qualified(self):
        for fault in ('post-fsync','missing-sample'):
            with self.subTest(fault=fault):
                code,calls,terminal=self.run_pair(fault)
                self.assertEqual(code,1);self.assertEqual(len(calls),2);self.assertFalse(terminal['qualified']);self.assertTrue(terminal['firstCause'])

if __name__=='__main__':unittest.main()
