"""Parent RPC boundary controls; no transport, nodes or business evidence."""
import importlib.util
from pathlib import Path
import threading
import unittest
from unittest import mock
s=importlib.util.spec_from_file_location('rpc_elapsed_controls',Path(__file__).with_name('pq-rpc-measurements.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class RPCControls(unittest.TestCase):
 def test_original_return_and_zero_observed_elapsed_are_not_business(self):
  recorder=m.RPCMeasurements();original={'error':'original JSON RPC error'}
  with mock.patch.object(m.time,'monotonic_ns',side_effect=[12,12]):self.assertIs(recorder.call(0,'tx',lambda:original),original)
  report=recorder.report();row=report['groups'][0];self.assertEqual((row['attempted'],row['returned'],row['raised'],row['elapsedNs']),(1,1,0,0));self.assertFalse(report['businessSuccessInferred']);self.assertEqual(row['minNs'],0)
 def test_original_exception_counted_once_and_not_replaced(self):
  recorder=m.RPCMeasurements();original=KeyboardInterrupt('original interrupted RPC');operation=mock.Mock(side_effect=original)
  with self.assertRaises(KeyboardInterrupt) as caught:recorder.call(2,'status',operation)
  self.assertIs(caught.exception,original);operation.assert_called_once();row=recorder.report()['groups'][0];self.assertEqual((row['completed'],row['returned'],row['raised'],row['inFlight']),(1,0,1,0))
 def test_inflight_is_unknown_and_same_node_method_can_overlap(self):
  recorder=m.RPCMeasurements();entered=threading.Barrier(3);release=threading.Event()
  def operation():entered.wait(timeout=2);release.wait(timeout=2)
  threads=[threading.Thread(target=lambda:recorder.call(1,'abci_info',operation)) for _ in range(2)]
  for thread in threads:thread.start()
  try:
   entered.wait(timeout=2);row=recorder.report()['groups'][0];self.assertEqual((row['attempted'],row['completed'],row['inFlight']),(2,0,2));self.assertIsNone(row['minNs']);self.assertEqual(row['elapsedNs'],0)
  finally:
   release.set()
   for thread in threads:thread.join(timeout=2)
  self.assertTrue(all(not t.is_alive() for t in threads));self.assertEqual(recorder.report()['groups'][0]['completed'],2)
 def test_bounded_twelve_groups_and_detached_reports(self):
  recorder=m.RPCMeasurements()
  for node in range(4):
   for method in ('tx','status','abci_info'):recorder.call(node,method,lambda:None)
  report=recorder.report();self.assertEqual(len(report['groups']),12);report['groups'][0]['attempted']=-1;self.assertEqual(recorder.report()['groups'][0]['attempted'],1)
 def test_invalid_identity_never_calls_original_operation(self):
  for node,method in [(True,'tx'),(-1,'status'),(4,'tx'),(0,'broadcast_tx_sync')]:
   recorder=m.RPCMeasurements();operation=mock.Mock()
   with self.assertRaises(RuntimeError):recorder.call(node,method,operation)
   operation.assert_not_called();self.assertEqual(recorder.report()['groups'],[])

if __name__=='__main__':unittest.main()
