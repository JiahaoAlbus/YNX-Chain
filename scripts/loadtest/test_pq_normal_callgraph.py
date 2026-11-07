"""Normal adapter contracts only. No valid proof/signature/business fixtures."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('normal_callgraph',Path(__file__).with_name('pq-independent-load.py'))
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)

class NormalCallgraphControls(unittest.TestCase):
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
            timing=b.rpc_measurements.report();self.assertEqual(len(timing['groups']),8);self.assertEqual(sum(g['attempted'] for g in timing['groups']),24);self.assertTrue(all(g['returned']==3 and g['inFlight']==0 for g in timing['groups']));self.assertFalse(timing['independentFinality'])
    def test_cancelled_or_foreign_chain_readiness_cannot_publish_or_claim_finality(self):
        b=object.__new__(driver.NormalBackend);b.rpc_measurements=driver.rpc_measurements.RPCMeasurements();b.c=SimpleNamespace(proof_timeout=1,plan={'chainId':'original-chain','nodes':[{'index':0,'rpcAddress':'rpc0'}]})
        b.w=SimpleNamespace(rpc=mock.Mock());stop=threading.Event();stop.set()
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError,r'H\+1 not observed'):b.wait_successor(10,Path(temp),stop)
            b.w.rpc.assert_not_called();self.assertEqual(list(Path(temp).iterdir()),[])
            stop.clear();b.w.rpc.side_effect=[{'node_info':{'network':'foreign'},'sync_info':{'latest_block_height':'11'}},{'response':{'last_block_height':'11'}}]
            with self.assertRaisesRegex(RuntimeError,'chain identity differs'):b.wait_successor(10,Path(temp),stop)
            self.assertEqual(list(Path(temp).iterdir()),[])
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
