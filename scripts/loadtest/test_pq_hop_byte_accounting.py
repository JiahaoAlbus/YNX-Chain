"""UNIT counter vectors only. No traffic, runtime measurement or proof fixtures."""
import copy
import importlib.util
import json
import tempfile
from types import SimpleNamespace
from pathlib import Path
import socket
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('hop_counter_controls',Path(__file__).with_name('pq-hop-byte-accounting.py'));h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
tcp=h.original('owned-tcp-accounting.py');layers=h.original('network-layer-accounting.py')

def fixture():
    raw=[]
    for name,pid,inode,local,port,remote,rport,listen in [('n0',101,'123','127.0.0.1',30101,'127.0.0.2',40001,30101),('n1',102,'456','127.0.0.2',40001,'127.0.0.1',30101,30102)]:
        row=dict(inode=inode,family=socket.AF_INET,localAddress=local,localPort=port,remoteAddress=remote,remotePort=rport,state=1,uid=501)
        raw.append(dict(name=name,pid=pid,startTicks=str(pid*10),uid=501,processUIDs=[501]*4,netns='net:[10]',userns='user:[11]',p2pLocalEndpoints=[dict(address=local,port=listen)],_rows={inode:row}))
    selected=tcp.select_owned_pairs(raw)
    def snapshot(offset,lo,hi):
        nodes=copy.deepcopy(raw)
        for n in nodes:
            n.pop('_rows');n.update(complete=True,reasons=[],sockets=[],excludedTCPCount=0)
            for row in selected[n['name']]:n['sockets'].append(dict(row,complete=True,reasons=[],cookie=str(int(row['inode'])*10),interface=0,observedMonotonicNs=str(lo+1),raw={k:str(100+offset) for k in tcp.COUNTERS}))
        s=dict(schema=tcp.SCHEMA,startMonotonicNs=str(lo),endMonotonicNs=str(hi),kernelRelease='6.8.0-UNIT-NOT-LIVE',bootID='12345678-1234-1234-1234-123456789abc',launcher=dict(pid=100,startTicks='900',uid=501,netns='net:[10]',userns='user:[11]',processUIDs=[501]*4),nodes=nodes,complete=True,atomic=False,reasons=[],firstCause=None,status='OBSERVED',coverage='MATCHED_ENDPOINT_SOCKETS_ONLY',totalTrafficComplete=False,ownershipContinuity='ENDPOINT_CHECKS_ONLY',totalTrafficBytes=None,physicalBytes=None,physicalStatus='UNMEASURED');s['sampleSHA256']=tcp.sample_sha256(s);return s
    binding=dict(schema=layers.BINDING_SCHEMA,runID='UNIT-NOT-RUNTIME',mode='online',window='unit-endpoint-bracket',source='a'*40,tools='b'*40,inputSHA256='c'*64,configuredDemand='500',qualifiedCount=None,nodes=[dict(name=n['name'],pid=n['pid'],startTicks=n['startTicks'],peerID=format(n['pid'],'040x'),p2pLocalEndpoints=n['p2pLocalEndpoints']) for n in raw])
    def checkpoint(s,lo,hi):return dict(bindingSHA256=layers.digest(binding),startMonotonicNs=str(lo),endMonotonicNs=str(hi),nodes=[dict(name=n['name'],pid=n['pid'],startTicks=n['startTicks']) for n in raw],tcp=s)
    return binding,checkpoint(snapshot(0,10,20),0,30),checkpoint(snapshot(50,40_000_000_110,40_000_000_120),40_000_000_100,40_000_000_130)

def counts(qualified=2):return dict(configuredDemand=500,logicalReleased=500,submitted=10 if qualified<500 else 500,qualified=qualified,notQualified=500-qualified,notSubmitted=490 if qualified<500 else 0,lateSubmitted=0,windowCompleted=True,firstCause=None,windowNs=5_000_000_000,observationCutoffNs=35_000_000_000,originMonotonicNs=1000,offeredWindowEndMonotonicNs=5_000_001_000)

class DirectionalHopCounterControls(unittest.TestCase):
    def test_sender_only_hops_never_double_add_receiver_or_retransmission(self):
        b,a,z=fixture();r=h.directional_hops(b,a,z,counts())
        self.assertEqual(r['status'],'OBSERVED_MATCHED_ENDPOINT_HOPS');self.assertEqual(len(r['directedHops']),2)
        self.assertEqual(r['sourceSocketEndpointBytesSentSum'],'100');self.assertEqual(r['sourceSocketEndpointRetransmittedBytesSum'],'100')
        self.assertTrue(all(x['senderBytesSent']=='50' and x['receiverCrossCheckBytesOnly']=='50' for x in r['directedHops']))
        self.assertFalse(r['receiverBytesAddedToSenderBytes'] or r['physicalBytesMeasured'] or r['completeTrafficCoverage']);self.assertIsNone(r['actualPerTransactionHopBytes'])
    def test_full500_denominator_and_partial_success_do_not_become_two_tx_average(self):
        b,a,z=fixture();r=h.directional_hops(b,a,z,counts());self.assertEqual(r['denominators']['configuredDemand'],500);self.assertEqual(r['denominators']['qualified'],2);self.assertIsNone(r['matchedEndpointQualifiedCohortMean'])
        r=h.directional_hops(b,a,z,counts(500));self.assertEqual(r['matchedEndpointQualifiedCohortMean']['denominatorQualified'],500);self.assertEqual(r['matchedEndpointQualifiedCohortMean']['numeratorSourceBytesSent'],'100');self.assertIsNone(r['actualPerTransactionHopBytes']);self.assertFalse(r['gainsQualified'])
    def test_connection_reset_or_pid_reuse_erases_apparent_hops_not_zero_fills(self):
        for mode in ('counter','cookie','pid'):
            b,a,z=fixture()
            if mode=='counter':z['tcp']['nodes'][0]['sockets'][0]['raw']['bytesSent']='1'
            elif mode=='cookie':z['tcp']['nodes'][0]['sockets'][0]['cookie']='999'
            else:z['tcp']['nodes'][0]['startTicks']='999'
            z['tcp']['sampleSHA256']=tcp.sample_sha256(z['tcp']);r=h.directional_hops(b,a,z,counts())
            self.assertEqual(r['status'],'UNKNOWN');self.assertEqual(r['directedHops'],[]);self.assertIsNone(r['sourceSocketEndpointBytesSentSum'])
    def test_source_hash_or_namespace_splice_is_rejected(self):
        for mode in ('hash','namespace'):
            b,a,z=fixture()
            if mode=='hash':z['tcp']['nodes'][0]['sockets'][0]['raw']['bytesSent']='999'
            else:z['tcp']['nodes'][0]['netns']='net:[999]';z['tcp']['sampleSHA256']=tcp.sample_sha256(z['tcp'])
            r=h.directional_hops(b,a,z);self.assertEqual(r['status'],'UNKNOWN');self.assertIsNone(r['actualPerTransactionHopBytes'])
    def test_nonloopback_or_missing_registered_endpoint_never_enters_capture(self):
        for mode in ('public','missing'):
            b,a,z=fixture()
            if mode=='public':b['nodes'][0]['p2pLocalEndpoints'][0]['address']='192.0.2.1'
            else:b['nodes'][0].pop('p2pLocalEndpoints')
            a['bindingSHA256']=z['bindingSHA256']=layers.digest(b)
            with mock.patch('socket.socket',side_effect=AssertionError('no socket/capture permitted')):r=h.directional_hops(b,a,z)
            self.assertEqual(r['status'],'UNKNOWN')
    def test_counter_integer_precision_is_not_float_or_wire_size_estimate(self):
        b,a,z=fixture();delta=(1<<53)+3
        for n in z['tcp']['nodes']:n['sockets'][0]['raw']['bytesSent']=str(100+delta)
        z['tcp']['sampleSHA256']=tcp.sample_sha256(z['tcp']);r=h.directional_hops(b,a,z)
        self.assertEqual(r['sourceSocketEndpointBytesSentSum'],str(2*delta));self.assertFalse(r['physicalBytesMeasured']);self.assertEqual(r['headersAndLinkFraming'],'UNMEASURED')
    def test_pure_accounting_uses_no_new_socket_or_live_sampler(self):
        b,a,z=fixture()
        with mock.patch('socket.socket',side_effect=AssertionError('offline only')):r=h.directional_hops(b,a,z)
        self.assertEqual(r['status'],'OBSERVED_MATCHED_ENDPOINT_HOPS');self.assertFalse(r['counterGroupsAdditive']);self.assertEqual(r['physicalFaultDomains'],1)
    def test_unbracketed_phase_or_wire_object_cannot_become_physical_bytes(self):
        b,a,z=fixture();wrong=counts(500);wrong['originMonotonicNs']=50_000_000_000;wrong['offeredWindowEndMonotonicNs']=55_000_000_000;wrong['logicalWireObjectBytes']=57839
        result=h.directional_hops(b,a,z,wrong);self.assertEqual(result['loadClockBinding']['status'],'UNKNOWN');self.assertIsNone(result['matchedEndpointQualifiedCohortMean']);self.assertIsNone(result['physicalBytes']);self.assertIsNone(result['actualPerTransactionHopBytes'])

    def test_owner_counts_conflict_never_adapts_denominator(self):
        b,a,z=fixture();wrong=counts();wrong['configuredDemand']=2;r=h.directional_hops(b,a,z,wrong);self.assertEqual(r['status'],'UNKNOWN');self.assertIsNone(r['matchedEndpointQualifiedCohortMean'])

class OriginalNetworkHookHopControls(unittest.TestCase):
    def test_existing_hook_preserves_original_checkpoints_and_new_hop_artifact(self):
        hook_spec=importlib.util.spec_from_file_location('hop_original_hook',Path(__file__).with_name('pq-network-window.py'));hook=importlib.util.module_from_spec(hook_spec);hook_spec.loader.exec_module(hook)
        driver_spec=importlib.util.spec_from_file_location('hop_original_driver',Path(__file__).with_name('pq-independent-load.py'));driver=importlib.util.module_from_spec(driver_spec);driver_spec.loader.exec_module(driver)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();b,a,z=fixture();window=object.__new__(hook.NetworkWindow)
            window.c=SimpleNamespace(w=SimpleNamespace(work=root));window.lab=driver.lab;window.layers=layers;window.tcp=tcp;window.binding=b;window.pin=layers.digest(b);window.start=a;window.end=None
            for name,value in [('start',a),('end',z)]:driver.lab.write_new(root/'public'/('network-'+name+'.json'),value)
            window.capture=lambda side:setattr(window,'end',z)
            result=window.finish(2,load_result=counts());saved=json.loads((root/'public/network-hop-accounting.json').read_bytes())
            self.assertEqual(saved,result['perHopTCPAccounting']);self.assertEqual(saved['sourceSocketEndpointBytesSentSum'],'100');self.assertIsNone(saved['actualPerTransactionHopBytes'])
            self.assertEqual(len(result['originalCheckpoints']),2);self.assertFalse(result['physicalBytesMeasured'])

if __name__=='__main__':unittest.main()
