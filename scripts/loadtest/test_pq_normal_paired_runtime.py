"""Paired runtime wiring controls; no builds, keys, live nodes or dispatch."""
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock
spec=importlib.util.spec_from_file_location('normal_paired_runtime_controls',Path(__file__).with_name('pq-normal-paired-runtime.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
class PairedRuntimeControls(unittest.TestCase):
    def test_actual_build_commands_select_both_tags_only_for_comet(self):
        rows=m.build_commands('/private/bin');self.assertEqual(len(rows),3);self.assertIn('ynx_live_wire_observation,ynx_lossless_hex',rows['ynx-comet']);self.assertTrue(all('-buildvcs=false' in a for a in rows.values()));self.assertNotIn('-tags',rows['ynx-consensus-pq-lab'])
    def test_bad_arm_refused_before_any_context_or_runtime(self):
        with mock.patch.object(m,'checked_context',side_effect=AssertionError('context')),self.assertRaisesRegex(RuntimeError,'exact normal paired'):m.attach(None,None,None,'auto',None)
    def test_only_pq_on_adds_single_optin_and_original_args_duplicates_refused(self):
        class Reader:
            def __init__(self,*a):pass
            def startup_arguments(self,phase,index):return [] if phase=='bootstrap' else ['--wire-observation-live-control','original']
        for arm in ('off','on'):
            c=NS(live_reader=None,nodes=[],w=NS(work=Path('/not-read')));lab=NS(git=lambda *a:'tools')
            with mock.patch.object(m,'checked_context',return_value={'source':'source'}),mock.patch.object(m,'module',return_value=NS(NormalLiveReader=Reader)):m.attach(c,{}, {},arm,lab)
            self.assertEqual(c.live_reader.startup_arguments('bootstrap',0),[]);args=c.live_reader.startup_arguments('pq',0);self.assertEqual(args[:2],['--wire-observation-live-control','original']);self.assertEqual(args[2:],['--experimental-mempool-lossless-hex','on'] if arm=='on' else [])
            with self.assertRaises(RuntimeError):c.live_reader.validate_original_startup_arguments(['--experimental-mempool-lossless-hex=on'])
    def fixture(self,root):
        (root/'public').mkdir();net=root/'.private/network';net.mkdir(parents=True);(net/'activation').mkdir();(net/'network-plan.json').write_bytes(b'plan');(net/'activation/activation.json').write_bytes(b'activation')
        nodes=[]
        for i in range(4):
            p=net/str(i);p.write_text(json.dumps(dict(height=2,appHash='a'*64,initialized=True)));nodes.append({'statePath':str(p)})
        procs=[dict(name=phase+'-node-'+str(i),pid=i+100,startTicks=1,exited=True,rawReturnCode=0,exitCode=0,signal=None) for phase in ('bootstrap','pq') for i in range(4)]
        def write_new(p,value):
            with Path(p).open('x') as f:json.dump(value,f)
        lab=NS(guard=NS(digest=sha,bounded=lambda p,limit:Path(p).read_bytes()),write_new=write_new)
        c=NS(w=NS(work=root,source=root,children=[],sample=lambda:None,process_receipt=lambda:procs),root=net,plan={'nodes':nodes},pin=sha(net/'network-plan.json'),activation_pin=sha(net/'activation/activation.json'),bins=root/'bin',nodes=[NS(poll=lambda:0) for _ in range(4)])
        e=m.StoppedTraceExporter({}, {'ynx-consensus-pq-lab':{'binarySHA256':'b'*64}},lab);return c,e,procs
    def test_forced_exit_refuses_before_trace_callee_or_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();c,e,procs=self.fixture(root);procs[-1].update(rawReturnCode=-9,exitCode=None,signal=9);c.call=mock.Mock()
            with mock.patch.object(m,'checked_context',return_value={'source':'source'}),self.assertRaisesRegex(RuntimeError,'all eight'):e.export(c)
            c.call.assert_not_called();self.assertFalse((root/'public/finalize-trace-export-intent.json').exists())
    def test_lost_return_keeps_original_intent_failure_and_never_redispatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();c,e,_=self.fixture(root);error=RuntimeError('original caller return unknown');c.call=mock.Mock(side_effect=error)
            with mock.patch.object(m,'checked_context',return_value={'source':'source'}):
                with self.assertRaises(RuntimeError) as caught:e.export(c)
                self.assertIs(caught.exception,error)
                with self.assertRaisesRegex(RuntimeError,'already attempted'):e.export(c)
            self.assertEqual(c.call.call_count,1);r=json.loads((root/'public/finalize-trace-export-return.json').read_bytes());self.assertEqual(r['status'],'FAILED_OR_UNKNOWN');self.assertTrue(r['noRetry']);self.assertTrue((root/'public/finalize-trace-export-intent.json').exists())
    def test_actual_export_argv_and_durable_bytes_through_supervised_original_call(self):
        original=Path(__file__).with_name('test_pq_finalize_trace_readback.py');sp=importlib.util.spec_from_file_location('runtime_trace_fixture',original);f=importlib.util.module_from_spec(sp);sp.loader.exec_module(f)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();c,e,_=self.fixture(root)
            def call(name,args):
                self.assertEqual(args[:3],['finalize-trace','export','--synthetic']);self.assertEqual(args[args.index('--plan-sha256')+1],c.pin);output=Path(args[-1]);f.fixture(output);reply=json.loads((output/'result.json').read_bytes());c.w.children.append(dict(name=name,command=[str(c.bins/'ynx-consensus-pq-lab'),*args],process=NS(poll=lambda:0)));return reply
            c.call=call
            with mock.patch.object(m,'checked_context',return_value={'source':'source'}):r=e.export(c)
            self.assertEqual(r['originalTrace']['retainedHeights'],2);self.assertFalse(r['normalLiveChainCoverageQualified'] or r['pressureAuthorized']);self.assertEqual(json.loads((root/'public/finalize-trace-export-return.json').read_bytes())['status'],'RETURNED_ORIGINAL_DATA')
    def test_return_journal_error_never_masks_original_callee_first_cause(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();c,e,_=self.fixture(root);original=RuntimeError('original exported result unknown');c.call=mock.Mock(side_effect=original);write=e.lab.write_new
            def broken(path,value):
                if Path(path).name=='finalize-trace-export-return.json':raise OSError('return journal unavailable')
                return write(path,value)
            e.lab.write_new=broken
            with mock.patch.object(m,'checked_context',return_value={'source':'source'}),self.assertRaises(RuntimeError) as caught:e.export(c)
            self.assertIs(caught.exception,original);self.assertEqual(e.return_journal_error['errorType'],'OSError');self.assertEqual(c.call.call_count,1)
if __name__=='__main__':unittest.main()
