"""Offline header/filter vectors and actual unsupported-host gate; no traffic."""
import importlib.util
import ipaddress
from pathlib import Path
import socket
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
p=module('owned_header_vectors','pq-owned-header-capture.py')
v=module('owned_header_scope_vectors','test_pq_hop_byte_accounting.py')

def header(src='127.0.0.1',sport=30101,dst='127.0.0.2',dport=40001,total=100,flags=0x18):
 raw=bytearray(40);raw[0]=0x45;struct.pack_into('!H',raw,2,total);raw[9]=6;raw[12:16]=ipaddress.IPv4Address(src).packed;raw[16:20]=ipaddress.IPv4Address(dst).packed;struct.pack_into('!HH',raw,20,sport,dport);raw[32]=0x50;raw[33]=flags;return bytes(raw)

def run_filter(code,raw):
 # Test-only interpreter for the emitted cBPF subset, never a capture backend.
 a=0;pc=0
 for _ in range(1000):
  op,jt,jf,k=code[pc]
  if op in (0x20,0x28,0x30):
   n={0x20:4,0x28:2,0x30:1}[op]
   if k+n>len(raw):return 0
   a=int.from_bytes(raw[k:k+n],'big')
  elif op==0x54:a&=k
  elif op in (0x15,0x35,0x45):pc+=(jt if (a==k if op==0x15 else a>=k if op==0x35 else bool(a&k)) else jf)
  elif op==0x06:return k
  else:raise AssertionError('unexpected emitted filter instruction')
  pc+=1
 raise AssertionError('unbounded test filter')

class OwnedHeaderCaptureControls(unittest.TestCase):
 def scope(self):
  binding,start,end=v.fixture();return p.original_flow_scope(v.tcp,start['tcp'])[0],start,end
 def test_exact_kernel_filter_allows_only_original_tuples(self):
  flows,_,_=self.scope();code=p.bpf_program(flows)
  self.assertGreater(run_filter(code,header()),0);self.assertGreater(run_filter(code,header(src='127.0.0.2',sport=40001,dst='127.0.0.1',dport=30101)),0)
  for raw in (header(sport=30102),header(src='192.0.2.1'),header(dport=22),header(src='127.0.0.9')):self.assertEqual(run_filter(code,raw),0)
  for byte,value in ((0,0x46),(9,17),(32,0x40)):
   raw=bytearray(header());raw[byte]=value;self.assertEqual(run_filter(code,raw),0)
  raw=bytearray(header());raw[6]=0x20;self.assertEqual(run_filter(code,raw),0)
 def test_first40_bytes_are_headers_and_original_ip_size_is_separate(self):
  raw=header(total=115,flags=2);row=p.parse_prefix(raw,115);self.assertEqual(len(raw),40);self.assertEqual(row['kernelIpBytes'],115);self.assertEqual(row['tcpPayloadBytes'],75);self.assertEqual(row['flags'],2)
  for total in (39,116):
   with self.assertRaises(ValueError):p.parse_prefix(raw,total)
 def test_optional_tcp_options_length_never_causes_payload_read(self):
  raw=bytearray(header(total=100));raw[32]=0x80;row=p.parse_prefix(bytes(raw),100);self.assertEqual(row['tcpHeaderBytes'],32);self.assertEqual(row['tcpPayloadBytes'],48);self.assertEqual(len(raw),40)
 def test_scope_requires_existing_reverse_owned_registered_socket(self):
  flows,start,end=self.scope();self.assertEqual(len(flows),2)
  start['tcp']['nodes'][0]['sockets'][0]['scope']=v.tcp.PAIRED;start['tcp']['sampleSHA256']=v.tcp.sample_sha256(start['tcp'])
  with self.assertRaises(ValueError):p.original_flow_scope(v.tcp,start['tcp'])
 def test_flow_bound_and_nonexisting_scope_do_not_widen_filter(self):
  with self.assertRaises(ValueError):p.bpf_program({})
  flows={(str(ipaddress.IPv4Address('127.0.0.1')),i+1000,'127.0.0.2',2000):{} for i in range(33)}
  with self.assertRaises(ValueError):p.bpf_program(flows)
 def test_filter_installed_and_locked_before_any_reception_is_bound(self):
  calls=[]
  class NoBindSocket:
   def setsockopt(self,*args):calls.append(args[:2])
  p.attach_filter(NoBindSocket(),p.bpf_program(self.scope()[0]));self.assertEqual(calls,[(socket.SOL_SOCKET,26),(socket.SOL_SOCKET,44)])
 def test_unsupported_platform_never_opens_socket_file_or_thread(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(p.sys,'platform','darwin'),mock.patch.object(p.socket,'socket',side_effect=AssertionError('no capture socket')):
   out=Path(tmp).resolve();capture=p.OwnedHeaderCapture({},out,45);state=capture.start();report=capture.stop();self.assertEqual(report['status'],'NOT_SUPPLIED');self.assertEqual(report['reason'],'LINUX_AF_PACKET_NOT_AVAILABLE');self.assertFalse(report['packetCaptureExecuted']);self.assertIsNone(report['kernelIpBytes']);self.assertIsNone(report['actualPerTransactionBytes']);self.assertEqual(list(out.iterdir()),[])
 def test_unknown_namespace_fails_before_socket_creation(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(p.sys,'platform','linux'),mock.patch.object(p.socket,'AF_PACKET',17,create=True),mock.patch.object(p,'frozen_tcp',return_value=v.tcp),mock.patch.object(p,'owned_namespace_identity',return_value={'classification':'UNIT-OWNED-IDENTITY'}),mock.patch.object(p,'exclusive_current_namespace',side_effect=ValueError('DEDICATED_CONTROLLED_TEST_NAMESPACE_NOT_SUPPLIED')),mock.patch.object(p.socket,'socket',side_effect=AssertionError('must not bind shared namespace')):
   _,start,_=v.fixture();capture=p.OwnedHeaderCapture(start['tcp'],Path(tmp).resolve(),45);report=capture.start();self.assertEqual(report['reason'],'DEDICATED_CONTROLLED_TEST_NAMESPACE_NOT_SUPPLIED');self.assertFalse(report['packetCaptureExecuted'])

class HeaderLifecycleControls(unittest.TestCase):
 def test_flush_failure_retires_resources_and_preserves_first_cause(self):
  with tempfile.TemporaryDirectory() as tmp:
   c=p.OwnedHeaderCapture({},Path(tmp).resolve(),45)
   c.sock=mock.Mock();sock=c.sock;c.stream=mock.Mock();stream=c.stream
   stream.flush.side_effect=OSError('original write failed');c.fail('original capture failure')
   c._close();sock.close.assert_called_once();stream.close.assert_called_once()
   self.assertIsNone(c.sock);self.assertIsNone(c.stream);self.assertEqual(c.result['firstCause'],'original capture failure')
 def test_failed_end_checkpoint_stops_capture_and_writes_original_failure(self):
  hook=module('header_hook_failure','pq-network-window.py')
  with tempfile.TemporaryDirectory() as tmp:
   out=Path(tmp).resolve();(out/'public').mkdir();window=object.__new__(hook.NetworkWindow)
   window.start={};window.end=None;window.c=SimpleNamespace(w=SimpleNamespace(work=out))
   saved={};window.lab=SimpleNamespace(require=p.require,write_new=lambda path,value:saved.update({path.name:value}))
   window.header_capture=p.OwnedHeaderCapture({},out/'public',45)
   with mock.patch.object(p.sys,'platform','darwin'):window.header_capture.start()
   window.capture=mock.Mock(side_effect=ValueError('original end checkpoint failed'))
   with self.assertRaisesRegex(ValueError,'original end checkpoint failed'):window.finish(0)
   self.assertTrue(window.header_capture.closed);self.assertEqual(saved['network-header-capture.json']['firstCause'],'LINUX_AF_PACKET_NOT_AVAILABLE')
 def test_normal_hook_persists_unsupported_capture_without_inventing_bytes(self):
  hook=module('header_hook_unsupported','pq-network-window.py');driver=module('header_hook_driver','pq-independent-load.py')
  with tempfile.TemporaryDirectory() as tmp:
   out=Path(tmp).resolve();(out/'public').mkdir();b,a,z=v.fixture();window=object.__new__(hook.NetworkWindow)
   window.c=SimpleNamespace(w=SimpleNamespace(work=out));window.lab=driver.lab;window.layers=v.layers;window.tcp=v.tcp;window.binding=b;window.pin=v.layers.digest(b);window.start=a;window.end=None
   for name,value in [('start',a),('end',z)]:driver.lab.write_new(out/'public'/('network-'+name+'.json'),value)
   window.header_capture=p.OwnedHeaderCapture({},out/'public',45)
   with mock.patch.object(p.sys,'platform','darwin'):window.header_capture.start()
   window.capture=lambda side:setattr(window,'end',z)
   result=window.finish(2,load_result=v.counts());saved=__import__('json').loads((out/'public/network-header-capture.json').read_bytes())
   self.assertEqual(saved,result['ownedHeaderCapture']);self.assertIsNone(saved['kernelIpBytes']);self.assertFalse(saved['physicalBytesMeasured']);self.assertTrue(window.header_capture.closed)
 def test_unsupported_stop_is_idempotent_and_first_cause_is_preserved(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(p.sys,'platform','darwin'):
   c=p.OwnedHeaderCapture({},Path(tmp).resolve(),45);c.start();first=c.stop();self.assertIs(c.stop(),first);self.assertEqual(first['firstCause'],'LINUX_AF_PACKET_NOT_AVAILABLE');self.assertTrue(first['readerJoined']);self.assertFalse(first['matchedFlowCaptureComplete'])

class OwnedNamespaceIdentityControls(unittest.TestCase):
 def setup_scope(self,foreign=False,wrong=False,reused=False):
  _,start,_=v.fixture();sample=start['tcp'];owned={100,101,102};rows={n['pid']:{'startTicks':int(n['startTicks'])} for n in [sample['launcher'],*sample['nodes']]}
  if foreign:rows[1]={'startTicks':1}
  if reused:rows[101]['startTicks']+=1
  expected={n['pid']:{k:n[k] for k in ('uid','processUIDs','netns','userns')} for n in [sample['launcher'],*sample['nodes']]}
  if wrong:expected[101]=dict(expected[101],netns='net:[999]')
  guard=SimpleNamespace(owned_set=lambda *a:owned)
  def identity(pid):
   self.assertIn(pid,owned);return expected[pid]
  return sample,rows,guard,identity
 def test_foreign_init_is_not_namespace_source_and_scope_stays_unproven(self):
  sample,rows,guard,identity=self.setup_scope(foreign=True)
  with mock.patch.object(p.os,'getpid',return_value=100),mock.patch.object(v.tcp,'_guard',return_value=guard),mock.patch.object(v.tcp,'_inventory',return_value=(rows,{})),mock.patch.object(v.tcp,'_process_identity',side_effect=identity) as reads:
   proof=p.owned_namespace_identity(v.tcp,sample);self.assertEqual(proof['netns'],'net:[10]');self.assertEqual(proof['foreignVisibleProcessCount'],1);self.assertFalse(proof['foreignNamespacesRead'])
   with self.assertRaisesRegex(ValueError,'scope unproven'):p.exclusive_current_namespace(v.tcp,sample)
   self.assertNotIn(mock.call(1),reads.call_args_list)
 def test_actual_owned_namespace_mismatch_or_pid_reuse_is_rejected(self):
  for wrong,reused in ((True,False),(False,True)):
   sample,rows,guard,identity=self.setup_scope(wrong=wrong,reused=reused)
   with mock.patch.object(p.os,'getpid',return_value=100),mock.patch.object(v.tcp,'_guard',return_value=guard),mock.patch.object(v.tcp,'_inventory',return_value=(rows,{})),mock.patch.object(v.tcp,'_process_identity',side_effect=identity):
    with self.assertRaises((ValueError,v.tcp.Unknown)):p.owned_namespace_identity(v.tcp,sample)
 def test_visible_scope_proof_checks_only_actual_registered_processes(self):
  sample,rows,guard,identity=self.setup_scope()
  with mock.patch.object(p.os,'getpid',return_value=100),mock.patch.object(v.tcp,'_guard',return_value=guard),mock.patch.object(v.tcp,'_inventory',return_value=(rows,{})),mock.patch.object(v.tcp,'_process_identity',side_effect=identity) as reads:
   proof=p.exclusive_current_namespace(v.tcp,sample);self.assertTrue(proof['exclusiveToOriginalSupervisor']);self.assertEqual([c.args[0] for c in reads.call_args_list],[100,101,102])

if __name__=='__main__':unittest.main()
