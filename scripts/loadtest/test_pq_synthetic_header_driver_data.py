import importlib.util
import copy
import hashlib
import subprocess
import sys
import threading
import time
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

m=module('header_driver_data_control','pq-synthetic-header-driver-data.py')
fixtures=module('header_reader_original_fixture_control','test_pq_synthetic_header_stream_data.py')
driver=module('header_driver_original_entry_control','pq-independent-load.py')

class StoppedHeaderDriverDataControls(unittest.TestCase):
    def setup_window(self,tmp):
        work=Path(tmp).resolve();root=work/'.private/commit-observations';root.mkdir(mode=0o700,parents=True)
        s,r=fixtures.fixture();descriptors=[];children=[]
        for node in range(4):
            path=root/('header-node-%d.jsonl'%node);receipt=path.with_name(path.name+'.receipt.json')
            path.write_bytes(s);receipt.write_bytes(r);path.chmod(0o600);receipt.chmod(0o600)
            descriptors.append(dict(node=node,processName='pq-node-%d'%node,path=str(path)))
            children.append(dict(name='pq-node-%d'%node,process=SimpleNamespace(pid=101+node,returncode=0,_ynx_lifecycle_lock=threading.RLock())))
        return SimpleNamespace(work=work,children=children),descriptors
    def test_actual_stopped_window_path_only_data_no_qualification(self):
        with tempfile.TemporaryDirectory() as t:
            w,ds=self.setup_window(t);out=m.retain_after_stop(w,ds,True)
            self.assertEqual(out['status'],'OBSERVED_DATA');self.assertEqual(len(out['nodes']),4)
            for key in ('sourceVerified','nodeBindingVerified','timeDomainVerified','independentPinsVerified','runtimeAuthorized','independentFinality','readbackRSSMeasured','receiptPublicationVerified'):
                self.assertIs(out[key],False)
            self.assertEqual(out['pinBasis'],'computed-from-held-stopped-bytes');self.assertNotIn('firstCauseBase64',str(out))
    def test_stop_unknown_and_malformed_inventory_do_not_read(self):
        with tempfile.TemporaryDirectory() as t:
            w,ds=self.setup_window(t)
            with mock.patch.object(m.reader,'_read_private_pair',side_effect=AssertionError('must not read')):
                self.assertEqual(m.retain_after_stop(w,ds,False)['status'],'NOT_SUPPLIED')
                self.assertEqual(m.retain_after_stop(w,ds[:-1],True)['status'],'NOT_SUPPLIED')
                self.assertEqual(m.retain_after_stop(w,[ds[0]]*4,True)['status'],'NOT_SUPPLIED')
                bad=copy.deepcopy(ds);bad[0]['node']=False
                self.assertEqual(m.retain_after_stop(w,bad,True)['status'],'NOT_SUPPLIED')
                w.children[1]['process']=w.children[0]['process']
                self.assertEqual(m.retain_after_stop(w,ds,True)['status'],'NOT_SUPPLIED')
                w.children[1]['process']=SimpleNamespace(pid=w.children[0]['process'].pid,returncode=0,_ynx_lifecycle_lock=threading.RLock())
                self.assertEqual(m.retain_after_stop(w,ds,True)['status'],'NOT_SUPPLIED')
    def test_live_child_wrong_path_and_missing_receipt_are_unknown(self):
        with tempfile.TemporaryDirectory() as t:
            w,ds=self.setup_window(t);w.children[0]['process'].returncode=None
            with mock.patch.object(m.reader,'_read_private_pair',side_effect=AssertionError('must not read live inventory')):
                self.assertEqual(m.retain_after_stop(w,ds,True)['status'],'NOT_SUPPLIED')
            w.children[0]['process'].returncode=0
            ds[1]['path']=str(Path(ds[1]['path']).with_name('other'))
            Path(ds[2]['path']+'.receipt.json').unlink()
            out=m.retain_after_stop(w,ds,True)
            self.assertEqual(out['status'],'NOT_SUPPLIED');self.assertEqual(len(out['errors']),2)
            self.assertEqual([x['node'] for x in out['nodes']],[0,3])
    def test_invalid_original_bytes_are_not_replaced_with_empty_success(self):
        with tempfile.TemporaryDirectory() as t:
            w,ds=self.setup_window(t);Path(ds[2]['path']).write_bytes(b'bad\n')
            out=m.retain_after_stop(w,ds,True)
            self.assertEqual(out['status'],'NOT_SUPPLIED');self.assertEqual(out['errors'][0]['node'],2)
            self.assertEqual(len(out['nodes']),3)
    def test_real_reaped_original_process_busy_lifecycle_is_immediately_unknown(self):
        with tempfile.TemporaryDirectory() as t:
            w,ds=self.setup_window(t)
            proc=subprocess.Popen([sys.executable,'-c','pass']);driver.lab.bind_process_lifecycle(proc);proc.wait(timeout=5)
            w.children[0]['process']=proc;held=threading.Event();release=threading.Event()
            def own_lock():
                with proc._ynx_lifecycle_lock:held.set();release.wait(5)
            thread=threading.Thread(target=own_lock);thread.start()
            try:
                self.assertTrue(held.wait(2));start=time.monotonic()
                with mock.patch.object(m.reader,'_read_private_pair',side_effect=AssertionError('must not read busy identity')):
                    out=m.retain_after_stop(w,ds,True)
                self.assertEqual(out['status'],'NOT_SUPPLIED');self.assertLess(time.monotonic()-start,.5)
            finally:release.set();thread.join(2)
            self.assertFalse(thread.is_alive())
    def test_default_original_clock_gate_rejects_before_window(self):
        self.assertIsNone(driver.commit_clock.COMMIT_CLOCK_SOURCE)
        args=SimpleNamespace(first_trial_profile=driver.HELD_TRIAL_PROFILE,commit_observation=True,
            commit_clock_observation=True,header_stream_data=True,commit=driver.SYNTHETIC_HEADER_ABI_SOURCE)
        with self.assertRaisesRegex(RuntimeError,'clock source/CI NOT_SUPPLIED'):driver.validate_options(args)
        args.commit_clock_observation=False
        with self.assertRaisesRegex(RuntimeError,'header DATA and original clock'):driver.validate_options(args)
    def test_real_activation_flag_is_opt_in_and_binds_four_distinct_paths(self):
        for enabled in (False,True):
            with self.subTest(enabled=enabled),tempfile.TemporaryDirectory() as t:
                root=Path(t).resolve();(root/'.private').mkdir();nodes=[];policies=[]
                for node in range(4):
                    p=root/('policy-%d'%node);p.write_bytes(('synthetic-%d'%node).encode());policies.append(p);nodes.append(dict(index=node,args=['original-%d'%node]))
                owner=driver.LoadCeremony.__new__(driver.LoadCeremony);owner.w=SimpleNamespace(work=root);owner.root=root
                owner.operations=4;owner.proof_timeout=30;owner.pin='1'*64;owner.activation_pin='2'*64
                owner.measurements=SimpleNamespace(record=lambda *args:None);owner.live=[]
                owner.commit_observation_enabled=True;owner.commit_validation_observation_enabled=False
                owner.commit_clock_observation_enabled=True;owner.commit_clock_descriptors=[]
                owner.header_stream_data_enabled=enabled;owner.header_stream_descriptors=[]
                owner.finalize_observation_enabled=False;owner.commit_observation_descriptors=[]
                def setup(name,args):
                    node=int(name.rsplit('-',1)[1]);p=policies[node];digest=hashlib.sha256(p.read_bytes()).hexdigest()
                    return dict(version='YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1',syntheticOnly=True,nodeStarted=False,authorityGranted=False,
                        policy=dict(path=str(p),sha256=digest),nodeArguments=[*nodes[node]['args'],'--proof-host-live-policy',str(p),'--proof-host-live-policy-sha256',digest])
                owner.call=setup;result=owner.activation_startup(dict(nodes=copy.deepcopy(nodes)))
                for node in result['nodes']:self.assertEqual(node['args'].count('--commit-header-stream-output'),int(enabled))
                self.assertEqual(len(owner.header_stream_descriptors),4 if enabled else 0)
                if enabled:self.assertEqual(len({d['path'] for d in owner.header_stream_descriptors}),4)
    def test_actual_driver_finisher_preserves_first_cause_and_false_authority(self):
        for original in (None,'original prior failure'):
            with self.subTest(original=original),tempfile.TemporaryDirectory() as t:
                w,ds=self.setup_window(t);ceremony=SimpleNamespace(header_stream_descriptors=ds)
                result=dict(firstCause=original,cleanupComplete=False);driver.finish_synthetic_header_data(result,w,ceremony)
                self.assertEqual(result['syntheticHeaderStreamData']['status'],'NOT_SUPPLIED')
                self.assertEqual(result['firstCause'],original or 'original synthetic header DATA incomplete; preserve UNKNOWN')
                self.assertIs(result['syntheticHeaderStreamData']['runtimeAuthorized'],False)
                result=dict(firstCause=original,cleanupComplete=True)
                with mock.patch.object(driver.header_data,'retain_after_stop',return_value=dict(status='NOT_SUPPLIED',readbackCleanupDebt=True)):
                    driver.finish_synthetic_header_data(result,w,ceremony)
                self.assertIs(result['cleanupComplete'],False)
                self.assertEqual(result['firstCause'],original or 'original synthetic header DATA incomplete; preserve UNKNOWN')
                result=dict(firstCause=original,cleanupComplete=True)
                debt=driver.header_data.reader.OriginalReadbackCloseUnknown(ValueError('CONTROL first read'),OSError('CONTROL close'))
                with mock.patch.object(driver.header_data.reader,'_read_private_pair',side_effect=debt) as read:
                    driver.finish_synthetic_header_data(result,w,ceremony)
                self.assertEqual(read.call_count,1);self.assertIs(result['cleanupComplete'],False)
                self.assertTrue(result['syntheticHeaderStreamData']['readbackCleanupDebt'])
                self.assertEqual(result['syntheticHeaderStreamData']['errors'][0]['errorType'],'ValueError')
                driver.header_data.reader._READBACK_CLOSE_CUSTODY.remove(debt) # Synthetic error has no real FD.

if __name__=='__main__':unittest.main()
