"""Normal same-instance reader lifecycle controls; no node, getter or load execution."""
import importlib.util,json,hashlib,tempfile,zipfile,io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock
s=importlib.util.spec_from_file_location('live_wiring_driver',Path(__file__).with_name('pq-independent-load.py'))
d=importlib.util.module_from_spec(s);s.loader.exec_module(d)

def options(profile='7c25'):
    return SimpleNamespace(first_trial_profile=profile,commit='fixed-source',seconds=5,tail_seconds=30,header_hop_capture=False)

class LiveReaderWiring(unittest.TestCase):
    def test_reader_attaches_once_before_any_original_node_start(self):
        c=SimpleNamespace(nodes=[]);reader=object();factory=mock.Mock(return_value=reader)
        module=SimpleNamespace(NormalLiveReader=factory)
        self.assertIs(d.attach_live_reader(c,module),reader);self.assertIs(c.live_reader,reader)
        factory.assert_called_once_with(c,d.lab)
        with self.assertRaises(RuntimeError):d.attach_live_reader(c,module)
        started=SimpleNamespace(nodes=[object()]);factory.reset_mock()
        with self.assertRaises(RuntimeError):d.attach_live_reader(started,module)
        factory.assert_not_called()
    def test_network_receives_exact_same_reader_and_original_binding(self):
        reader=object();c=SimpleNamespace(live_reader=reader)
        constructor=mock.Mock(side_effect=lambda *a,**kw:SimpleNamespace(live_reader=kw['live_reader']))
        result=d.create_network_window(SimpleNamespace(NetworkWindow=constructor),c,options(),'fixed-tools','original-input-pin',500)
        self.assertIs(result.live_reader,reader)
        self.assertEqual(constructor.call_args.args,(c,d.lab,'fixed-source','fixed-tools','original-input-pin',500))
        self.assertIs(constructor.call_args.kwargs['live_reader'],reader)
        self.assertFalse(constructor.call_args.kwargs['header_capture'])
    def test_missing_or_substituted_reader_cannot_claim_current_normal_wire(self):
        constructor=mock.Mock()
        with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):
            d.create_network_window(SimpleNamespace(NetworkWindow=constructor),SimpleNamespace(),options(),'tools','pin',500)
        constructor.assert_not_called()
        constructor=mock.Mock(return_value=SimpleNamespace(live_reader=object()))
        with self.assertRaisesRegex(RuntimeError,'same sole'):
            d.create_network_window(SimpleNamespace(NetworkWindow=constructor),SimpleNamespace(live_reader=object()),options(),'tools','pin',500)
    def test_legacy_missing_publisher_stays_absent_instead_of_invented_reader(self):
        constructor=mock.Mock(side_effect=lambda *a,**kw:SimpleNamespace(live_reader=kw['live_reader']))
        result=d.create_network_window(SimpleNamespace(NetworkWindow=constructor),SimpleNamespace(),options('1695'),'tools','pin',500)
        self.assertIsNone(result.live_reader)

class CurrentSourceSelection(unittest.TestCase):
    def test_current_selection_uses_returned_supplier_not_legacy_constants(self):
        spec=importlib.util.spec_from_file_location('current_reader_control',Path(__file__).with_name('pq-normal-live-reader.py'))
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();source=base/'original';source.mkdir();destination=base/'composition'
            path=source/'scripts/verify/wire-live-matching-source-ci.py';path.parent.mkdir(parents=True);path.write_bytes(b'# controlled public source\n')
            for name in ('go.mod','go.sum'):(source/name).write_bytes(b'original descriptor\n')
            q=dict(commit='7c25cbcc7d31b10743e26ae1ddca745085ee1b0b',tree='8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a',forkTree='5a128880d14bfc73de4334cba23218859ad3473c',optionalForkCommit='5a49f5c91452604dffb910df736702b3b9df2562',optionalForkTree='08747364c24c065bf2b13527c210625d7ec95fba',compositionScriptSHA256=hashlib.sha256(path.read_bytes()).hexdigest(),ciEvidenceSHA256='a'*64)
            selection=dict(originalSourceCommit=q['commit'],originalSourceTree=q['tree'],originalProductionForkTree=q['forkTree'],selectedOptionalForkCommit=q['optionalForkCommit'],selectedOptionalForkTree=q['optionalForkTree'],buildTags=[m.BUILD_TAG])
            for name in ('fakeVCSIdentity','originalCheckoutWritten','originalModuleDescriptorsChanged','nodeStarted','carrierEnabled','publicActivation'):selection[name]=False
            def prepare(*args):
                self.assertEqual(args,(source,destination,q['commit'],q['tree']))
                build=destination/'source';build.mkdir(parents=True)
                for name in ('go.mod','go.sum'):(build/name).write_bytes((source/name).read_bytes())
                receipt=destination/'SOURCE-SELECTION.json';raw=json.dumps(selection).encode();receipt.write_bytes(raw)
                return dict(sourceDirectory=str(build),receiptPath=str(receipt),receiptBytes=len(raw),receiptSHA256=hashlib.sha256(raw).hexdigest(),sourceSelection=selection)
            core=SimpleNamespace(PRODUCTION_TREE='legacy-production',FORK_COMMIT='legacy-supplier',FORK_TREE='legacy-tree',prepare_wire_live_source=prepare)
            def git(argv,**kwargs):
                args=argv[3:]
                if args[0]=='status':return b''
                refs={'HEAD':q['commit'],'HEAD^{tree}':q['tree'],'HEAD:third_party/cometbft':q['forkTree'],q['optionalForkCommit']+':third_party/cometbft':q['optionalForkTree']}
                self.assertEqual(args[0],'rev-parse');return refs[args[1]].encode()
            fake=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:None))
            with mock.patch.object(m,'qualify',return_value=q),mock.patch.object(m.subprocess,'check_output',side_effect=git),mock.patch.object(m.importlib.util,'spec_from_file_location',return_value=fake),mock.patch.object(m.importlib.util,'module_from_spec',return_value=core):
                result=m.prepare_matching_source(source,destination)
            self.assertEqual((result['optionalForkCommit'],result['optionalForkTree']),(q['optionalForkCommit'],q['optionalForkTree']))
            self.assertTrue(result['originalSourceUnchanged']);self.assertFalse(result['actualNetworkWindow'])

class CurrentOriginalStream(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('current7c_data_control',Path(__file__).with_name('pq-7c25-live-source-data.py'))
        self.data=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.data)
        self.package='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'
    def stream(self,events):
        return b'\n'.join(json.dumps(dict(Package=self.package,Action=action,**({'Test':name} if name else {}))).encode() for action,name in events)
    def test_complete_original_package_and_child_are_required(self):
        rows=[('start',None),('run','TestOriginal'),('run','TestOriginal/child'),('pass','TestOriginal/child'),('pass','TestOriginal'),('pass',None)]
        self.assertEqual(self.data.original_stream(self.stream(rows),'normalProducer',['TestOriginal'])['childCases'],1)
        for changed in (rows[1:],rows[:-1],rows[:3]+rows[4:],[(('skip' if name=='TestOriginal/child' and action=='pass' else action),name) for action,name in rows]):
            with self.subTest(events=changed),self.assertRaises(RuntimeError):self.data.original_stream(self.stream(changed),'normalProducer',['TestOriginal'])
    def test_detached_pass_and_extra_top_cannot_qualify(self):
        for rows in ([('start',None),('pass','TestOriginal'),('pass',None)], [('start',None),('run','TestOriginal'),('pass','TestOriginal'),('run','TestExtra'),('pass','TestExtra'),('pass',None)]):
            with self.subTest(events=rows),self.assertRaises(RuntimeError):self.data.original_stream(self.stream(rows),'normalProducer',['TestOriginal'])
    def test_actual_cancelled_ci_keeps_passing_streams_but_refuses_qualification(self):
        base=Path(__file__).with_name('fixtures')/'7c25-cancelled-live-source'
        raw=(base/'ORIGINAL.zip').read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            name=next(n for n in archive.namelist() if n.endswith('/SOURCE.json'))
            original=archive.read(name);record=json.loads(original)
        q=dict(commit=self.data.SOURCE,tree=self.data.TREE,forkTree=self.data.PRODUCTION_FORK,
            optionalForkCommit=self.data.SUPPLIER,optionalForkTree=self.data.SUPPLIER_FORK,
            buildTag='ynx_live_wire_observation',compositionScriptSHA256='e35ff39c10090e9200bdabf7b265c1fd211fd2ae4d227ffaae52054c6dbc2fac',
            ciEvidenceSHA256=hashlib.sha256(original).hexdigest(),ciHead='c5786c9250858951b7d91103434cd2e467b4ce13',
            ciTree='5e9d1c0c1894ab2cf58d611f0e5cb387cba20b77',ciBranch='codex/ynx-pq-wire-live-7c25-qualification-20261108',
            sourceCI=dict(run=42450897483,job=128639736221,artifact=13606205995),pressureAuthorized=False)
        expected={key:tuple(record[key]['requiredPassed']) for key in ('normalProducer','originalSupplierBudget')}
        self.assertEqual(tuple(map(len,expected.values())),(7,24))
        result=self.data.read_source_archive(raw,q,expected,'84d68c8cfa4817fd5673696431217e15553e771c7c961e35e41879cb24287ad2',15199)
        self.assertEqual(result,q);self.assertFalse(result['pressureAuthorized'])
        run_raw=(base/'RUN.json').read_bytes();job_raw=(base/'JOB.json').read_bytes()
        self.assertEqual((len(run_raw),hashlib.sha256(run_raw).hexdigest()),(12416,'fdd20eb544a14b8075f47d81ce7bccd82a8a0a2ee0dcbdaa01775e6731dd769d'))
        self.assertEqual((len(job_raw),hashlib.sha256(job_raw).hexdigest()),(4726,'d0bf12c898f90e5d13884747b2944ca8e55eef6afaa1d7fa836b17e20c45af88'))
        run=json.loads(run_raw);job=json.loads(job_raw)
        self.assertEqual((run['conclusion'],job['conclusion']),('cancelled','cancelled'))
        annotations=(base/'ANNOTATIONS.json').read_bytes()
        self.assertEqual(hashlib.sha256(annotations).hexdigest(),'33b2301f9f3fffdac7498b4adf87fa741542590f98af4551336e5cd2f0e67b93')
        self.assertTrue(any('exceeded the maximum execution time of 8m0s' in row['message'] for row in json.loads(annotations)))
        with self.assertRaisesRegex(RuntimeError,'CI run must complete successfully'):self.data.qualify_ci(run,job,q)
    def test_cancelled_job_or_run_never_becomes_successful_qualification(self):
        q=dict(sourceCI=dict(run=1,job=2),ciHead='current-ci-only-head',ciBranch='exact-branch')
        run=dict(id=1,run_attempt=1,head_sha=q['ciHead'],head_branch=q['ciBranch'],event='push',path='.github/workflows/chain-core.yml',repository=dict(full_name='JiahaoAlbus/YNX-Chain'),status='completed',conclusion='success')
        names=('Verify exact 7c25 CI-only source and route','Execute the current client and qualify actual terminal results','Verify the default-off normal node wire observation adapter','Verify exact optional live getter composition without enabling a carrier','Bind actual tagged evidence to the unchanged 7c25 Go roots','Preserve exact 7c25 qualification with original tagged streams')
        job=dict(id=2,run_id=1,run_attempt=1,head_sha=q['ciHead'],name='Original client observations and cohort readback',status='completed',conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in names])
        self.assertTrue(self.data.qualify_ci(run,job,q))  # Explicit synthetic control only.
        for changed_run,changed_job in ((dict(run,conclusion='cancelled'),job),(run,dict(job,conclusion='cancelled')),(run,dict(job,steps=job['steps'][:-1])),(dict(run,head_sha=self.data.SOURCE),job)):
            with self.subTest(run=changed_run,job=changed_job),self.assertRaises(RuntimeError):self.data.qualify_ci(changed_run,changed_job,q)
    def test_actual_successful_current_component_and_cancelled_archive_separation(self):
        q=self.data.qualification()
        self.assertEqual(q['sourceCI'],dict(run=42452563828,job=128644748345,artifact=13606770461))
        self.assertEqual((len(self.data.EXPECTED['normalProducer']),len(self.data.EXPECTED['originalSupplierBudget'])),(7,24))
        self.assertNotEqual(q['commit'],q['ciHead'])
        self.assertFalse(q['pressureAuthorized'] or q['actualFrozenProductionCommitRun'])
        old=(Path(__file__).with_name('fixtures')/'7c25-cancelled-live-source/ORIGINAL.zip').read_bytes()
        current=self.data.FIXTURE.read_bytes()
        for wrong in (old,current[:-1],b'x'+current[1:]):
            with self.subTest(size=len(wrong)),self.assertRaisesRegex(RuntimeError,'archive pin'):self.data.qualification(wrong)
    def test_absent_current_ci_cannot_borrow_legacy_source(self):
        with mock.patch.object(self.data,'QUALIFICATION',None),self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):
            self.data.qualification(b'old CI is not current CI')

if __name__=='__main__':unittest.main(verbosity=2)
