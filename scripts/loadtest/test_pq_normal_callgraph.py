"""Normal adapter contracts only. No valid proof/signature/business fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('normal_callgraph',Path(__file__).with_name('pq-independent-load.py'))
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)

class NormalCallgraphControls(unittest.TestCase):
    def test_ack_requires_explicit_uint32_checktx_code_and_never_reposts(self):
        for code in (None, False, "0", 0, 3):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temp:
                case=Path(temp)
                backend=object.__new__(driver.NormalBackend)
                backend.attempted=set()
                backend.submit_lock=threading.Lock()
                backend.c=SimpleNamespace(plan={'nodes':[dict(rpcAddress='http://127.0.0.1:1')]})
                row=dict(index=0,id='logical',operationId='original',ownerIndex=4,nonce=1)
                tx=dict(abciHash='a'*64,nativeHash='b'*64)
                reply=dict(hash='a'*64)
                if code is not None:
                    reply['code']=code
                events=[]
                opener=mock.MagicMock()
                opener.open.return_value.__enter__.return_value.read.return_value=json.dumps(dict(result=reply)).encode()
                def post():
                    backend.broadcast_once(row,tx,b'original',case,events.append,threading.Event())
                with mock.patch.object(driver.urllib.request,'build_opener',return_value=opener):
                    if code==3:
                        with self.assertRaises(driver.scheduler.KnownFailure):
                            post()
                    else:
                        post()
                    with self.assertRaisesRegex(RuntimeError,'already attempted'):
                        post()
                opener.open.assert_called_once()
                self.assertEqual(any(e['kind']=='ack' for e in events),type(code) is int and code==0)
                self.assertEqual(json.loads((case/'ack.json').read_text())['ack']['result'],reply)

    def test_inclusion_requires_explicit_success_and_all_replies_before_cutoff(self):
        backend=object.__new__(driver.NormalBackend)
        backend.c=SimpleNamespace(proof_timeout=1,plan={'nodes':[dict(index=i) for i in range(4)]})
        for mode in ('valid','missing_code','late_reply'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                case=Path(temp)
                clock=[0]
                events=[]
                def rpc(node,method,query):
                    self.assertEqual((method,query),('tx','?hash=0x'+'a'*64+'&prove=true'))
                    if mode=='late_reply' and node['index']==3:
                        clock[0]=1_000_000_000
                    result={} if mode=='missing_code' and node['index']==3 else dict(code=0)
                    return dict(hash='a'*64,height='19',tx_result=result)
                backend.observed_rpc=rpc
                def observe():
                    return backend.observe_inclusion({},dict(abciHash='a'*64),case,events.append,threading.Event())
                with mock.patch.object(driver.time,'monotonic_ns',side_effect=lambda:clock[0]):
                    if mode=='valid':
                        self.assertEqual(observe(),19)
                    else:
                        with self.assertRaisesRegex(RuntimeError,'execution/height differs|bounded inclusion cutoff'):
                            observe()
                self.assertEqual(any(e['kind']=='included' for e in events),mode=='valid')
                self.assertEqual((case/'four-node-inclusion.json').exists(),mode=='valid')

    def test_canceled_submission_preserves_intent_without_post(self):
        backend = object.__new__(driver.NormalBackend)
        backend.attempted = set()
        backend.submit_lock = threading.Lock()
        row = dict(index=0, id='logical', operationId='original', ownerIndex=4, nonce=1)
        tx = dict(abciHash='a'*64, nativeHash='b'*64)
        stop = threading.Event()
        with tempfile.TemporaryDirectory() as temp:
            case = Path(temp)
            write = driver.lab.write_new

            def cancel_after_write(path, value):
                write(path, value)
                stop.set()

            events = []
            with mock.patch.object(driver.lab, 'write_new', side_effect=cancel_after_write):
                with mock.patch.object(driver.urllib.request, 'build_opener') as opener:
                    with self.assertRaisesRegex(RuntimeError, 'canceled after intent'):
                        backend.broadcast_once(row, tx, b'original', case, events.append, stop)
                opener.assert_not_called()
            self.assertTrue((case/'submission-intent.json').is_file())
            self.assertFalse((case/'ack.json').exists())
            self.assertEqual(events, [])

    def test_inclusion_event_requires_evidence_persisted_before_cutoff(self):
        backend = object.__new__(driver.NormalBackend)
        backend.c = SimpleNamespace(proof_timeout=1, plan={'nodes': [dict(index=i) for i in range(4)]})
        backend.observed_rpc = mock.Mock(return_value=dict(hash='a'*64, height='19', tx_result=dict(code=0)))
        with tempfile.TemporaryDirectory() as temp:
            case = Path(temp)
            stop = threading.Event()
            write = driver.lab.write_new
            events = []

            def slow_write(path, value):
                write(path, value)
                stop.set()

            with mock.patch.object(driver.lab, 'write_new', side_effect=slow_write):
                with self.assertRaisesRegex(RuntimeError, 'persisted after bounded inclusion cutoff'):
                    backend.observe_inclusion({}, dict(abciHash='a'*64), case, events.append, stop)
            self.assertTrue((case/'four-node-inclusion.json').is_file())
            self.assertFalse(any(event['kind'] == 'included' for event in events))

    def test_live_proof_retains_only_matching_original_failure_bytes(self):
        backend=object.__new__(driver.NormalBackend)
        with tempfile.TemporaryDirectory() as temp:
            case=Path(temp).resolve()
            source=case/'failure.json'
            value=dict(Version='YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1', PolicySHA256='a'*64,
                       Outcome='unknown', FirstCauseSHA256='b'*64, Sequence=1)
            stop=threading.Event()
            def retain():
                backend.retain_live_proof_failure(case,case,dict(pin='a'*64),1,stop,time.monotonic()+1)
            for invalid in (dict(value,Sequence=True),dict(value,Sequence=2),dict(value,PrivatePath='/private')):
                source.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(RuntimeError,'original proof failure record differs'):
                    retain()
            raw=(json.dumps(value)+'\n').encode()
            source.write_bytes(b'')
            def complete_write(_):
                source.write_bytes(raw)
                return False
            with mock.patch.object(stop,'wait',side_effect=complete_write) as wait:
                retain()
            wait.assert_called_once()
            self.assertEqual((case/'original-live-proof-failure.json').read_bytes(),raw)
            with self.assertRaises(FileExistsError):
                retain()

    def test_live_capture_prioritizes_original_failure_over_result(self):
        backend = object.__new__(driver.NormalBackend)
        with tempfile.TemporaryDirectory() as temp:
            case = Path(temp).resolve()
            lane = dict(pin='a'*64)
            stop = threading.Event()
            (case/'result.json').write_text('{}')
            backend.wait_live_capture(case, case, lane, 1, stop, time.monotonic()+1)
            raw = json.dumps(dict(Version='YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1', PolicySHA256=lane['pin'],
                                  Outcome='unknown', FirstCauseSHA256='b'*64, Sequence=1)).encode()
            (case/'failure.json').write_bytes(raw)
            with self.assertRaisesRegex(RuntimeError, 'operation is UNKNOWN'):
                backend.wait_live_capture(case, case, lane, 1, stop, time.monotonic()+1)
            self.assertEqual((case/'original-live-proof-failure.json').read_bytes(), raw)

    def test_live_capture_refuses_result_crossing_cutoff_and_canceled_command(self):
        backend = object.__new__(driver.NormalBackend)
        stop = threading.Event()
        output = mock.MagicMock()
        result, failure = mock.Mock(), mock.Mock()
        output.__truediv__.side_effect = {'result.json': result, 'failure.json': failure}.__getitem__
        result.exists.return_value = True
        failure.exists.return_value = False
        with mock.patch.object(driver.time, 'monotonic', side_effect=[1, 2]):
            with self.assertRaisesRegex(RuntimeError, 'bounded cutoff'):
                backend.wait_live_capture(output, None, {}, 1, stop, 2)
        stop.set()
        for lane in ({}, {'session': mock.Mock()}):
            with self.assertRaisesRegex(RuntimeError, 'canceled before command'):
                backend.live_materials_command(lane, 'result', 'original', 1, stop)

    def test_checkpoint_cache_cannot_reuse_replaced_same_size_and_mtime_state(self):
        b = object.__new__(driver.NormalBackend)
        b.checkpoint_lock = threading.Lock()
        b.checkpoint_points = {}
        with tempfile.TemporaryDirectory() as temp:
            paths = [Path(temp) / f'node-{i}.json' for i in range(4)]
            for path in paths:
                path.write_text(json.dumps(dict(height=1, appHash='a'*64, initialized=True)))
            b.c = SimpleNamespace(plan=dict(nodes=[dict(statePath=str(path)) for path in paths]))
            stop = threading.Event()
            self.assertEqual(b.checkpoint(stop)['height'], 1)
            for path in paths:
                before = path.stat()
                replacement = path.with_suffix('.new')
                replacement.write_text(json.dumps(dict(height=2, appHash='b'*64, initialized=True)))
                os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
                replacement.replace(path)
                self.assertEqual(path.stat().st_size, before.st_size)
            self.assertEqual(b.checkpoint(stop), dict(height=2, appHash='b'*64))

    def test_checkpoint_reuses_only_unchanged_nodes_while_heights_converge(self):
        b=object.__new__(driver.NormalBackend)
        b.checkpoint_lock=threading.Lock()
        b.checkpoint_points={}
        with tempfile.TemporaryDirectory() as temp:
            paths=[Path(temp)/f'node-{i}.json' for i in range(4)]
            b.c=SimpleNamespace(plan=dict(nodes=[dict(statePath=str(p)) for p in paths]))
            def write(path,height):
                replacement=path.with_suffix('.new')
                replacement.write_text(json.dumps(dict(height=height, appHash=str(height)*64, initialized=True)))
                replacement.replace(path)
            for path in paths:
                write(path,1)
            stop=mock.Mock()
            stop.is_set.return_value=False
            with mock.patch.object(driver.lab.guard,'bounded',wraps=driver.lab.guard.bounded) as read:
                self.assertEqual(b.checkpoint(stop)['height'],1)
                write(paths[0],2)
                pending=iter(paths[1:])
                stop.wait.side_effect=lambda _: write(next(pending),2)
                self.assertEqual(b.checkpoint(stop),dict(height=2,appHash='2'*64))
                self.assertEqual([call.args[0] for call in read.call_args_list],paths+paths)

    def test_all_four_original_engine_and_app_successors_required_before_publication(self):
        b=object.__new__(driver.NormalBackend);b.rpc_measurements=driver.rpc_measurements.RPCMeasurements();rounds=[]
        def rpc(address,method):
            if address=='rpc0' and method=='status':rounds.append(1)
            iteration=len(rounds)
            height=10 if iteration==1 else 11
            if address=='rpc3' and method=='abci_info' and iteration==2:height=10
            if method=='status':return {'node_info':{'network':'original-chain'},'sync_info':{'latest_block_height':str(height)}}
            return {'response':{'last_block_height':str(height)}}
        b.c=SimpleNamespace(proof_timeout=2,plan={'chainId':'original-chain','nodes':[{'index':i,'rpcAddress':'rpc'+str(i)} for i in range(4)]})
        b.w=SimpleNamespace(rpc=rpc)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp);b.wait_successor(10,path,threading.Event())
            result=json.loads((path/'successor-availability.json').read_text())
            self.assertEqual(len(rounds),3);self.assertFalse(result['qualifiedFinal'])
            self.assertEqual(result['minimumSuccessorHeight'],11);self.assertEqual(len(result['observations']),4)
            timing=b.rpc_measurements.report()
            self.assertEqual(len(timing['groups']),8)
            self.assertEqual(sum(g['attempted'] for g in timing['groups']),17)
            self.assertTrue(all(g['returned']==g['attempted'] and g['inFlight']==0 for g in timing['groups']))
            self.assertFalse(timing['independentFinality'])
    def test_cancelled_or_foreign_chain_readiness_cannot_publish_or_claim_finality(self):
        b=object.__new__(driver.NormalBackend);b.rpc_measurements=driver.rpc_measurements.RPCMeasurements();b.c=SimpleNamespace(proof_timeout=1,plan={'chainId':'original-chain','nodes':[{'index':0,'rpcAddress':'rpc0'}]})
        b.w=SimpleNamespace(rpc=mock.Mock());stop=threading.Event();stop.set()
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError,r'H\+1 not observed'):b.wait_successor(10,Path(temp),stop)
            b.w.rpc.assert_not_called();self.assertEqual(list(Path(temp).iterdir()),[])
            stop.clear();b.w.rpc.side_effect=[{'node_info':{'network':'foreign'},'sync_info':{'latest_block_height':'11'}},{'response':{'last_block_height':'11'}}]
            with self.assertRaisesRegex(RuntimeError,'chain identity differs'):b.wait_successor(10,Path(temp),stop)
            self.assertEqual(list(Path(temp).iterdir()),[])

    def test_successor_reply_after_cutoff_cannot_open_proof(self):
        backend=object.__new__(driver.NormalBackend)
        backend.c=SimpleNamespace(proof_timeout=1,plan={
            'chainId':'original-chain','nodes':[dict(index=i) for i in range(4)],
        })
        clock=[0]
        def rpc(node,method):
            if method=='status':
                return dict(node_info=dict(network='original-chain'),sync_info=dict(latest_block_height='11'))
            if node['index']==3:
                clock[0]=1_000_000_001
            return dict(response=dict(last_block_height='11'))
        backend.observed_rpc=rpc
        with tempfile.TemporaryDirectory() as temp:
            case=Path(temp)
            stop=mock.Mock()
            stop.is_set.return_value=False
            with mock.patch.object(driver.time,'monotonic_ns',side_effect=lambda:clock[0]):
                with self.assertRaisesRegex(RuntimeError,r'H\+1 not observed'):
                    backend.wait_successor(10,case,stop)
            self.assertFalse((case/'successor-availability.json').exists())
    def perform_control(self,reply_code):
        # All proof checks are intercepted explicitly; CONTROL_ONLY values are
        # deliberately ineligible for the real ledger's qualified contract.
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name);(root/'public/load-operations').mkdir(parents=True)
        b=object.__new__(driver.NormalBackend);b.w=SimpleNamespace(work=root);b.c=SimpleNamespace(mode='online');order=[];notifications=[]
        row={'index':0,'id':'logical-control','operationId':'operation-control','nonce':2,'ownerIndex':4};account={'ownerIndex':4}
        tx={'abciHash':'a'*64,'nativeHash':'b'*64,'members':'1'}
        request={'version':'YNX-PQ-LAB-SENDER-REQUEST/v1','operationId':row['operationId'],'ownerIndex':4,'firstNonce':'2','members':1}
        def original(*args):order.append('original');return tx,root/'original.abci',b'CONTROL_ONLY',request
        def broadcast(*args):order.append('one-post')
        def include(*args):order.append('included-H');return 10
        def successor(height,*args):self.assertEqual(height,10);order.append('observed-H+1')
        proof={'materials':{'path':str(root/'materials.json'),'sha256':'c'*64},'proof':{'path':str(root/'proof.json')}}
        verified={'code':'CONTROL_ONLY','result':{'executionSuccessful':False,'executionCode':'99','transactionType':'CONTROL_ONLY','nativeGrant':False}}
        public_closure={'CONTROL_ONLY':'not-a-public-proof'}
        def live(*args):order.append('live-callee');return proof,verified,public_closure
        def confirm(command,path,stop):
            order.append('confirm');self.assertEqual(command,driver.normal.sender_command_data('confirm',request,materials=proof['materials']['path'],materials_sha='c'*64,proof=proof['proof']['path']))
            return {'code':reply_code,'result':{'result':verified['result']}}
        b.original=original;b.broadcast_once=broadcast;b.observe_inclusion=include;b.wait_successor=successor;b.live_proof=live;b.sessions={4:SimpleNamespace(exchange=confirm)}
        with mock.patch.object(driver.normal,'require_verified') as intercepted,mock.patch.object(driver.proof_readback,'finalize_portable_catalog') as portable:
            if reply_code=='PROOF_CONFIRMED_DATA':
                b.perform(row,account,notifications.append,threading.Event());self.assertEqual(intercepted.call_count,1)
                # An adapter fixture cannot qualify as business evidence.
                final=notifications[-1];self.assertEqual(final['normalVerifierCode'],'CONTROL_ONLY');self.assertFalse(final['executionSuccessful'])
                portable.assert_called_once_with(root/'public',root/'public/load-operations/00000',public_closure,row)
            else:
                with self.assertRaisesRegex(RuntimeError,'not confirmed'):b.perform(row,account,notifications.append,threading.Event())
                self.assertFalse((root/'public/load-operations/00000/qualified-receipt.json').exists())
                self.assertNotIn('qualified',[n['kind'] for n in notifications])
                portable.assert_not_called()
        self.assertEqual(order,['original','one-post','included-H','observed-H+1','live-callee','confirm'])
        self.assertIn('successor_availability',[n.get('stage') for n in notifications])
    def test_complete_adapter_order_and_original_confirm_arguments(self):self.perform_control('PROOF_CONFIRMED_DATA')
    def test_rejected_original_confirm_never_emits_qualified(self):self.perform_control('REJECTED')

if __name__=='__main__':unittest.main()
