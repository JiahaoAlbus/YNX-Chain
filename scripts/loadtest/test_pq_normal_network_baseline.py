"""Explicit baseline qualification controls; all traffic and TCP data are fake."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name, file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

normal=module('baseline_normal_controls','pq-normal-process-lab.py')
hook=module('baseline_hook_controls','pq-network-window.py')
controls=module('baseline_raw_controls','test_pq_normal_live_reader.py')


class BaselineQualificationControls(unittest.TestCase):
    def fixture(self, failure=False):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name).resolve();(root/'public').mkdir()
        c=object.__new__(normal.Ceremony);c.pin='a'*64;c.mode='online';c.next_workload=4;c.pending_owners=set();c.workload_pin='b'*64
        state=root/'state.json';state.write_text('{}')
        c.plan=dict(nodes=[dict(index=i,nodeId=format(i+1,'040x'),p2pAddress='tcp://127.0.0.1:%d'%(31656+i),statePath=str(state)) for i in range(4)])
        c.nodes=[SimpleNamespace(pid=200+i,poll=lambda:None,send_signal=mock.Mock()) for i in range(4)]
        c.w=SimpleNamespace(work=root,children=[dict(name='pq-node-%d'%i,startTicks=1000+i,process=p,persistent=True) for i,p in enumerate(c.nodes)],wait=mock.Mock())
        evidence=[];slots={};calls={};directory=root/'public/network-live-originals';directory.mkdir()
        def read(node):
            name=node['name'];phase=('before','after')[calls.get(name,0)];calls[name]=calls.get(name,0)+1
            event=dict(node=name,pid=node['pid'],startTicks=node['startTicks'],phase=phase,status='UNKNOWN' if failure else 'OBSERVED',originalFiles=[])
            evidence.append(event);slots[name]=dict(next=calls[name],observed=not failure,retired=failure)
            if failure:raise RuntimeError('CONTROL_ONLY_ORIGINAL_READER_FAILURE')
            value=controls.raw_sample(node['pid']);raw=json.dumps(value).encode()
            for file in ('producer.json',phase+'.request',phase+'.raw.json',phase+'.result.json'):
                # Synthetic contract files only; not original producer evidence.
                target=directory/(name+'-'+phase+'-'+file);target.write_bytes(raw)
                event['originalFiles'].append(dict(path=str(target.relative_to(root/'public')),sha256=hashlib.sha256(raw).hexdigest()))
            return raw
        reader=SimpleNamespace(evidence=evidence,slots=slots)
        c.live_reader=reader
        with mock.patch.dict(os.environ,GITHUB_RUN_ID='CONTROL_ONLY'):
            network=hook.NetworkWindow(c,normal.lab,'a'*40,'b'*40,c.workload_pin,4,live_reader=read)
        def no_tcp(**kw):
            at=time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            return dict(schema='YNX-OWNED-TCP/1',startMonotonicNs=str(at),endMonotonicNs=str(at),nodes=kw['nodes'],complete=False,reasons=['CONTROL_ONLY_NO_TCP'])
        network.tcp.sample_owned_tcp=no_tcp
        return c,network,reader

    def measure(self,failure=False):
        c,network,reader=self.fixture(failure)
        network.capture('start');accounting=network.finish(None)
        return c,network,reader,accounting

    def test_disabled_lossless_unknown_proto_allow_complete_wire_and_endpoint_tcp(self):
        c,network,reader,accounting=self.measure()
        self.assertTrue(all(row['attempted']['reason']=='live_lossless_disabled' for row in accounting['nodes']))
        self.assertTrue(all(row['serializedProto']['status']=='UNKNOWN' for row in accounting['nodes']))
        # This test supplies a TCP qualification INPUT, not a socket sample.
        accounting['tcp']=dict(status='OBSERVED_ENDPOINT_DELTA',complete=True)
        result=normal.network_baseline_result(network,accounting,reader,c.w.work/'public')
        self.assertEqual(result['status'],'OBSERVED');self.assertEqual(result['wire']['status'],'OBSERVED')
        self.assertEqual(result['originalReadClosure']['actualReads'],8)
        self.assertIsNone(result['qualifiedCount']);self.assertFalse(result['physicalBytesMeasured'])

    def test_tcp_missing_keeps_wire_observed_but_profile_unknown(self):
        c,network,reader,accounting=self.measure()
        result=normal.network_baseline_result(network,accounting,reader,c.w.work/'public')
        self.assertEqual(result['wire']['status'],'OBSERVED')
        self.assertEqual(result['tcp']['status'],'UNKNOWN');self.assertEqual(result['status'],'UNKNOWN')

    def test_reader_failure_with_four_successful_functional_proofs_cannot_complete_profile(self):
        c,network,reader=self.fixture(failure=True)
        c.prepare_network=lambda:{}
        def begin():network.capture('start');return network
        c.begin_network_baseline=begin
        c.traffic=lambda name,owner:dict(owner=owner)
        c.verify_stopped=lambda row:dict(row,qualifiedFinal=True)
        result=c.execute()
        self.assertFalse(result['phaseComplete'])
        self.assertTrue(result['functionalPhaseComplete']);self.assertEqual(result['qualifiedFinalCount'],4)
        self.assertEqual(result['networkBaseline']['status'],'UNKNOWN')
        self.assertEqual(result['networkBaseline']['wire']['status'],'UNKNOWN')
        self.assertEqual(result['networkBaseline']['originalReadClosure']['status'],'UNKNOWN')
        self.assertEqual(len(reader.evidence),8)
        self.assertTrue(all(node.send_signal.called for node in c.nodes))

    def test_retention_hash_loss_or_duplicate_read_prevents_qualification(self):
        for kind in ('changed-file','missing-file','duplicate-read'):
            with self.subTest(kind=kind):
                c,network,reader,accounting=self.measure()
                accounting['tcp']=dict(status='OBSERVED_ENDPOINT_DELTA',complete=True)
                if kind=='changed-file':(c.w.work/'public'/reader.evidence[0]['originalFiles'][0]['path']).write_bytes(b'changed')
                if kind=='missing-file':reader.evidence[0]['originalFiles'].pop()
                if kind=='duplicate-read':reader.evidence[-1]=reader.evidence[0]
                result=normal.network_baseline_result(network,accounting,reader,c.w.work/'public')
                self.assertEqual(result['status'],'UNKNOWN')
                self.assertEqual(result['originalReadClosure']['status'],'UNKNOWN')

    def test_live_lifetime_change_and_missing_start_are_not_logical_success(self):
        for kind in ('lifetime','start'):
            with self.subTest(kind=kind):
                c,network,reader,accounting=self.measure()
                accounting['tcp']=dict(status='OBSERVED_ENDPOINT_DELTA',complete=True)
                if kind=='lifetime':accounting['nodes'][0]['liveWindow']=dict(status='UNKNOWN',reason='live_lifetime_or_generation_changed')
                else:network.start['nodes'].pop()
                result=normal.network_baseline_result(network,accounting,reader,c.w.work/'public')
                self.assertEqual(result['status'],'UNKNOWN');self.assertEqual(result['wire']['status'],'UNKNOWN')


if __name__=='__main__':unittest.main()
