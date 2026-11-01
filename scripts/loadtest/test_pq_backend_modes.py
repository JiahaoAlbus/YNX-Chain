"""Actual normal backend construction using producer-shaped public metadata."""
import importlib.util
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('backend_modes',Path(__file__).with_name('pq-independent-load.py'))
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)

class BackendModeControls(unittest.TestCase):
    def ceremony(self,mode,transactions):
        return SimpleNamespace(w=object(),live=[{'node':i} for i in range(4)],mode=mode,workload={'transactions':transactions})
    def test_online_original_null_corpus_opens_eight_original_sessions_without_indexing(self):
        c=self.ceremony('online',None);owners=[{'ownerIndex':i} for i in range(4,12)]
        with mock.patch.object(driver,'SenderSession',side_effect=lambda ceremony,owner:SimpleNamespace(owner=owner)) as sender:
            b=driver.NormalBackend(c,owners,threading.Event())
        self.assertEqual([call.args[1] for call in sender.call_args_list],list(range(4,12)))
        self.assertEqual(b.corpus,{});self.assertEqual(len(b.sessions),8)
        self.assertEqual(b.helper_limit,3);self.assertEqual(b.queue.qsize(),4)
    def test_pre_signed_mode_keeps_exact_original_nonce_indices_and_duplicate_refusal(self):
        rows=[{'ownerIndex':4,'firstNonce':'2'},{'ownerIndex':5,'firstNonce':'2'},{'ownerIndex':4,'firstNonce':'3'}]
        with mock.patch.object(driver,'SenderSession') as sender:
            b=driver.NormalBackend(self.ceremony('pre-signed',rows),[],threading.Event())
            self.assertEqual(b.corpus,{(4,2):0,(5,2):1,(4,3):2});sender.assert_not_called()
            with self.assertRaisesRegex(RuntimeError,'duplicate account nonce'):
                driver.NormalBackend(self.ceremony('pre-signed',rows+[rows[0]]),[],threading.Event())
    def test_wrong_mode_corpus_fails_before_opening_any_original_sender(self):
        for mode,transactions in [('pre-signed',None),('online',[{'ownerIndex':4,'firstNonce':'2'}])]:
            with self.subTest(mode=mode),mock.patch.object(driver,'SenderSession') as sender:
                with self.assertRaises(RuntimeError):driver.NormalBackend(self.ceremony(mode,transactions),[{'ownerIndex':4}],threading.Event())
                sender.assert_not_called()

if __name__=='__main__':unittest.main()
