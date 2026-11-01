"""Reproduce the actual cold phase cutoff with finite original readiness mocks."""
import importlib.util,json,tempfile,threading,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
sp=importlib.util.spec_from_file_location('cold_original_driver',Path(__file__).with_name('pq-independent-load.py'));d=importlib.util.module_from_spec(sp);sp.loader.exec_module(d);normal=d.normal

class Clock:
    def __init__(self):self.now=0.
    def monotonic(self):return self.now
    def monotonic_ns(self):return int(self.now*1e9)
    def sleep(self,seconds):self.now+=seconds

class Proc:
    def __init__(self,pid):self.pid=pid;self.code=None
    def poll(self):return self.code

class ColdReadinessControls(unittest.TestCase):
    def setup_case(self,root,clock,rpc_at=61,height_at=61,mutate=None):
        c=object.__new__(normal.Ceremony);c.nodes=[Proc(100+i) for i in range(4)];nodes=[]
        for i in range(4):
            p=root/('state%d.json'%i);state=dict(height=4,appHash='ab'*32,initialized=True,accounts=['PRIVATE_SENTINEL'])
            if mutate:mutate(i,state)
            p.write_text(json.dumps(state));nodes.append(dict(index=i,statePath=str(p),rpcAddress=str(i)))
        c.plan=dict(nodes=nodes,chainId='original',initialHeight='4')
        def rpc(address,method):
            if clock.now<rpc_at:raise OSError('original RPC not yet listening')
            height=4 if clock.now>=height_at else 0
            return dict(node_info=dict(network='original'),sync_info=dict(latest_block_height=str(height))) if method=='status' else dict(response=dict(last_block_height=str(height),last_block_app_hash='ab'*32))
        c.w=SimpleNamespace(started=0.,lock=threading.RLock(),children=[dict(name='bootstrap-node-%d'%i,process=proc,startTicks=200+i) for i,proc in enumerate(c.nodes)],sample=mock.Mock(),rpc=rpc)
        return c
    def test_actual60s_cutoff_reproduced_but_cold_allocation_waits_for_real_stable_ready(self):
        clock=Clock()
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock)
            with self.assertRaisesRegex(RuntimeError,'quiet common checkpoint'):c.quiet(4)
            self.assertEqual(c.readiness_report()['records'][-1]['requestedTimeoutSeconds'],60)
            clock.now=0;budget=d.initialization.cold_readiness_budget(c.w,now=0)
            c.initial_quiet_timeout=budget['grantedColdPhaseSeconds'];result=c.quiet(4,timeout=c.initial_quiet_timeout)
            self.assertEqual(result,dict(height=4,appHash='ab'*32));self.assertGreaterEqual(clock.now,61.4);self.assertLess(clock.now,180);record=c.readiness_report()['records'][-1];self.assertEqual(record['stableObservations'],3);self.assertFalse(record['authorityGranted']);self.assertEqual(len(record['firstSuccessfulRPCObservationByNode']),4)
    def test_phase_allocation_never_extends_original885_active_or900_total(self):
        b=d.initialization.cold_readiness_budget(SimpleNamespace(started=0),now=850)
        self.assertEqual((b['grantedColdPhaseSeconds'],b['originalGlobalTotalSeconds'],b['originalCleanupSeconds']),(35,900,15));self.assertFalse(b['globalBudgetIncreased'])
        with self.assertRaisesRegex(RuntimeError,'budget exhausted'):d.initialization.cold_readiness_budget(SimpleNamespace(started=0),now=885)
    def test_original_resource_error_not_swallowed_as_not_ready(self):
        clock=Clock();error=RuntimeError('original RSS cap')
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock,rpc_at=0,height_at=0);c.w.sample=mock.Mock(side_effect=[None,error])
            with self.assertRaises(RuntimeError) as caught:c.quiet(4)
            self.assertIs(caught.exception,error);self.assertEqual(c.readiness_report()['records'][0]['terminalError']['reason'],'original RSS cap')
    def test_original_registered_child_exit_is_observed_before_cleanup(self):
        clock=Clock();error=RuntimeError('normal node exited early: bootstrap-node-2')
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock);c.nodes[2].code=1;c.w.sample=mock.Mock(side_effect=error)
            with self.assertRaises(RuntimeError) as caught:c.quiet(4)
            self.assertIs(caught.exception,error);row=c.readiness_report()['records'][0]['originalProcessObservations'][2];self.assertEqual((row['pid'],row['startTicks'],row['rawReturnCode']),(102,202,1))
    def test_first_rpc_observation_not_first_height_or_quiet_confirmation(self):
        clock=Clock()
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock,rpc_at=1,height_at=3);c.quiet(4,timeout=10);r=c.readiness_report()['records'][0]
            first=r['firstSuccessfulRPCObservationByNode'][0]['statusObservedMonotonicNs'];height=r['firstInitialHeightOrLaterObservedByNode'][0]['observedMonotonicNs'];confirmed=r['quietConfirmedMonotonicNs'];self.assertLess(first,height);self.assertLess(height,confirmed);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(r))
    def test_rpc_success_cannot_replace_four_initialized_matching_disks(self):
        for bad in ('height','hash','initialized'):
            clock=Clock()
            def mutate(i,state):
                if i==3:state.update({'height':5} if bad=='height' else {'appHash':'cd'*32} if bad=='hash' else {'initialized':False})
            with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
                c=self.setup_case(Path(tmp),clock,rpc_at=0,height_at=0,mutate=mutate)
                with self.subTest(bad=bad),self.assertRaises(RuntimeError):c.quiet(4,timeout=1)
                self.assertIsNone(c.readiness_report()['records'][0]['quietConfirmedMonotonicNs'])
    def test_wrong_chain_or_abci_hash_still_refuses_ready(self):
        for bad in ('chain','abci'):
            clock=Clock()
            with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
                c=self.setup_case(Path(tmp),clock,rpc_at=0,height_at=0);original=c.w.rpc
                def rpc(address,method):
                    value=original(address,method)
                    if address=='2' and bad=='chain' and method=='status':value['node_info']['network']='foreign'
                    if address=='2' and bad=='abci' and method=='abci_info':value['response']['last_block_app_hash']='cd'*32
                    return value
                c.w.rpc=rpc
                with self.subTest(bad=bad),self.assertRaises(RuntimeError):c.quiet(4,timeout=1)
                self.assertIsNone(c.readiness_report()['records'][0]['quietConfirmedMonotonicNs'])
    def test_malformed_rpc_is_diagnosed_without_observer_crash_or_ready(self):
        clock=Clock()
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock,rpc_at=0,height_at=0);original=c.w.rpc
            c.w.rpc=lambda address,method: {} if address=='2' and method=='status' else original(address,method)
            with self.assertRaisesRegex(RuntimeError,'quiet common checkpoint'):c.quiet(4,timeout=1)
            row=c.readiness_report()['records'][0];self.assertEqual(row['lastRPCErrors'][0]['node'],2);self.assertEqual(row['lastRPCErrors'][0]['errorType'],'KeyError');self.assertIsNone(row['quietConfirmedMonotonicNs'])
    def test_failed_rpc_duration_included_without_fake_success(self):
        clock=Clock()
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock)
            def fail(address,method):clock.now+=1;raise OSError('original RPC timeout')
            c.w.rpc=fail
            with self.assertRaises(RuntimeError):c.quiet(4,timeout=1)
            r=c.readiness_report()['records'][0];self.assertGreaterEqual(r['spansNs']['rpcStatusNs'],4_000_000_000);self.assertEqual(r['firstSuccessfulRPCObservationByNode'],{});self.assertIsNone(r['quietConfirmedMonotonicNs'])
    def test_only_explicit_cold_caller_changes_initial_phase_default(self):
        class StopBeforeOtherPreparation(Exception):pass
        for configured,expected in [(None,60),(180,180)]:
            c=SimpleNamespace(plan={'initialHeight':'4'},start=mock.Mock())
            if configured:c.initial_quiet_timeout=configured
            def quiet(minimum,timeout=60):self.assertEqual((minimum,timeout),(4,expected));raise StopBeforeOtherPreparation()
            c.quiet=quiet
            with self.assertRaises(StopBeforeOtherPreparation):normal.Ceremony.prepare_network(c)

    def test_second_cold_start_allocation_does_not_change_registration_or_steady_waits(self):
        import base64
        for configured,expected in [(None,60),(180,180)]:
            calls=[];phase={'starts':0}
            c=SimpleNamespace(plan={'initialHeight':'4'},root=Path('/not-read'),pin='original',nodes=[],next_workload=0)
            c.w=SimpleNamespace(stopping=False,children=[],wait=mock.Mock())
            def start(*args):phase['starts']+=1
            def quiet(minimum=0,timeout=60):
                calls.append((phase['starts'],minimum,timeout));return dict(height=10 if phase['starts']==2 else 4,appHash='original')
            def call(name,args):return dict(registryHeight=6,activationHeight=10) if name=='activate-original' else dict(transaction=base64.b64encode(b'original').decode(),transactionHash='original')
            c.start=start;c.quiet=quiet;c.call=call;c.post_once=mock.Mock();c.halt_post=mock.Mock();c.activation_startup=lambda a:a;c.transfer=lambda *a:({'transaction':{'abciHash':'original'}},b'original')
            if configured:c.activation_quiet_timeout=configured
            with mock.patch.object(normal.lab.guard,'digest',return_value='original'):normal.Ceremony.prepare_network(c)
            self.assertEqual(calls[-1],(2,6,expected));self.assertTrue(all(timeout==60 for phase,minimum,timeout in calls[:-1]))
    def test_second_cold_wait_still_stops_at_remaining_active_budget(self):
        clock=Clock();clock.now=850
        with tempfile.TemporaryDirectory() as tmp,mock.patch.object(normal,'time',clock):
            c=self.setup_case(Path(tmp),clock,rpc_at=900,height_at=900)
            with self.assertRaises(RuntimeError):c.quiet(6,timeout=180)
            row=c.readiness_report()['records'][-1];self.assertEqual(row['requestedTimeoutSeconds'],180);self.assertEqual(row['allocatedTimeoutSeconds'],35);self.assertLess(clock.now,886);self.assertIsNone(row['quietConfirmedMonotonicNs'])

if __name__=='__main__':unittest.main()
