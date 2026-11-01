"""Metadata-only temporary files; no chain, database payload or pressure."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

s=importlib.util.spec_from_file_location('owned_store',Path(__file__).with_name('pq-owned-storage-window.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class OwnedStoreMetadataControls(unittest.TestCase):
    def test_counts_actual_file_allocation_without_opening_payloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();p=root/'data';p.mkdir();f=p/'00001.ldb';f.write_bytes(b'x'*8192);info=f.stat()
            with mock.patch('builtins.open',side_effect=AssertionError('payload forbidden')):v=m.sample_path(root,p)
            self.assertEqual(v['logicalBytes'],8192);self.assertEqual(v['allocatedBytes'],info.st_blocks*512);self.assertEqual(v['regularFiles'],1)
    def test_missing_store_is_unknown_not_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            v=m.sample_path(Path(tmp).resolve(),Path(tmp).resolve()/'absent');self.assertEqual(v['status'],'UNKNOWN');self.assertIsNone(v['allocatedBytes'])
    def test_symlink_or_hardlink_store_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();p=root/'original';p.write_bytes(b'x');link=root/'link';link.symlink_to(p)
            self.assertEqual(m.sample_path(root,link)['status'],'UNKNOWN');link.unlink();link.hardlink_to(p);self.assertEqual(m.sample_path(root,p)['status'],'UNKNOWN')
    def test_escape_and_entry_bound_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();p=root/'store';p.mkdir();(p/'one').write_bytes(b'x')
            with mock.patch.object(m,'MAX_FILES',1):self.assertEqual(m.sample_path(root,p)['status'],'UNKNOWN')
            self.assertEqual(m.sample_path(p,root)['status'],'UNKNOWN')
    def test_delta_keeps_node_lifetime_commit_count_separate_from_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();home=root/'node0';data=home/'data';data.mkdir(parents=True)
            for name in ('blockstore.db','state.db'):(data/name).mkdir()
            state=home/'application.json';state.write_bytes(b'one')
            c=SimpleNamespace(root=root,pin='a'*64,plan=dict(nodes=[dict(index=0,home=str(home),statePath=str(state))]));w=m.OwnedStorageWindow(c);w.capture('before');state.write_bytes(b'longer')
            raw=dict(successNotifications=12,samples=[{'height':10}]);v=w.finish(dict(originalSnapshots=[dict(node=0,usable=True,rawOriginalObservation=raw)]));n=v['nodes'][0]
            self.assertEqual(n['stores']['applicationState']['logicalBytesDelta'],3);self.assertEqual(n['nodeLifetimeObservedSuccessNotifications'],12);self.assertEqual(n['retainedDurableCommitSamples'],1);self.assertIsNone(n['actualLoadWindowCommitCount']);self.assertIsNone(v['perTransactionBytes']);self.assertFalse(v['physicalStorageDevicesMeasured'])
    def test_missing_before_does_not_invent_delta_or_commit_denominator(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();home=root/'node';home.mkdir();c=SimpleNamespace(root=root,pin='b'*64,plan=dict(nodes=[dict(index=0,home=str(home),statePath=str(home/'absent'))]));v=m.OwnedStorageWindow(c).finish();self.assertIsNone(v['nodes'][0]['stores']['blockstore']['allocatedBytesDelta']);self.assertIsNone(v['nodes'][0]['nodeLifetimeObservedSuccessNotifications'])

if __name__=='__main__':unittest.main()
