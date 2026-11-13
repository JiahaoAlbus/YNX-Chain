"""Resource guard equality and discovery controls, no node or chain load."""
import errno,importlib.util,os,stat,tempfile,threading,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
spec=importlib.util.spec_from_file_location('guard_controls',Path(__file__).with_name('consensus-linux-cohort.py'))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)

def original_bytes(root):
    total=count=0
    for directory,names,files in os.walk(root,followlinks=False):
        lab.require(len(Path(directory).relative_to(root).parts)<=40,'artifact depth bound')
        for name in names+files:
            count+=1;lab.require(count<=200000,'artifact inventory bound')
            try:info=(Path(directory)/name).lstat()
            except FileNotFoundError:continue
            lab.require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode),'nonregular private artifact')
            if stat.S_ISREG(info.st_mode):total+=max(info.st_size,info.st_blocks*512)
    return total

class ResourceGuardSamplingControls(unittest.TestCase):
    def window(self,root):
        (root/'.private').mkdir();(root/'public').mkdir()
        with mock.patch.object(lab.os,'sched_getaffinity',return_value={0},create=True),mock.patch.object(lab.os,'sched_setaffinity',create=True):return lab.Window(root,root)
    def rows(self,child=False):
        rows={os.getpid():dict(pid=os.getpid(),parent=1,startTicks=10)}
        if child:rows[987654]=dict(pid=987654,parent=os.getpid(),startTicks=20)
        return rows
    def test_full_physical_byte_inventory_matches_old_sparse_hardlinks_and_growth(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'dir').mkdir();(root/'dir/data').write_bytes(b'x'*4097)
            os.link(root/'dir/data',root/'hardlink')
            with open(root/'sparse','wb') as f:f.truncate(2<<20)
            before=lab.private_bytes(root);self.assertEqual(before,original_bytes(root))
            (root/'dir/data').write_bytes(b'x'*(3<<20));self.assertEqual(lab.private_bytes(root),original_bytes(root));self.assertGreater(lab.private_bytes(root),before)
    def test_symlink_and_nonregular_artifact_still_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'link').symlink_to('/tmp',target_is_directory=True)
            for fn in (original_bytes,lab.private_bytes):
                with self.assertRaisesRegex(RuntimeError,'nonregular'):fn(root)
            (root/'link').unlink();os.mkfifo(root/'fifo')
            with self.assertRaisesRegex(RuntimeError,'nonregular'):lab.private_bytes(root)
    def test_original_depth_bound_is_not_relaxed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=root
            for i in range(41):directory=directory/'d';directory.mkdir()
            for fn in (original_bytes,lab.private_bytes):
                with self.assertRaisesRegex(RuntimeError,'depth bound'):fn(root)
    def test_unreadable_directory_is_not_ignored(self):
        error=PermissionError(errno.EACCES,'actual refusal')
        with mock.patch.object(lab.os,'scandir',side_effect=error):
            with self.assertRaises(PermissionError) as caught:lab.private_bytes('/owned')
        self.assertIs(caught.exception,error)
    def test_every_call_discovers_new_descendants_without_pid_or_rss_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=self.window(Path(tmp));self.assertEqual(w.sample_stage_report()['status'],'NOT_OBSERVED')
            with mock.patch.object(lab.guard,'proc_inventory',side_effect=[(self.rows(),[]),(self.rows(True),[])] ) as inventory,mock.patch.object(lab,'owned_rss',return_value=100) as rss:
                w.sample();w.sample()
            self.assertEqual(inventory.call_count,2);self.assertEqual([c.args[0] for c in rss.call_args_list],[os.getpid(),os.getpid(),987654]);self.assertEqual(w.peak_rss,200);self.assertEqual(w.known[987654],20)
            report=w.sample_stage_report();self.assertEqual(report['stages']['procInventory']['calls'],2);self.assertEqual(report['stages']['ownedRSS']['calls'],2);self.assertFalse(report['cadenceChanged']);self.assertFalse(report['pidOrRSSCached'])
    def test_peak_rss_sample_preserves_processes_even_when_cap_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=self.window(Path(tmp))
            w.children=[dict(process=SimpleNamespace(pid=987654), startTicks=20,
                             name='load-live-session-0', persistent=False)]
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(self.rows(True),[])), \
                 mock.patch.object(lab,'owned_rss',side_effect=[1,lab.CAPS['rssBytes']]) as rss:
                with self.assertRaisesRegex(RuntimeError,'owned RSS exceeded'):
                    w.sample()
            self.assertEqual(rss.call_count,2)
            peak=w.peak_rss_sample
            self.assertEqual(peak['rssBytes'],w.peak_rss)
            self.assertEqual(sum(p['rssBytes'] for p in peak['processes']),peak['rssBytes'])
            self.assertEqual(peak['processes'][-1]['name'],'load-live-session-0')

    def test_original_rss_failure_is_same_firstcause_and_measured(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=self.window(Path(tmp));error=RuntimeError('active owned RSS unreadable')
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(self.rows(),[])),mock.patch.object(lab,'owned_rss',side_effect=error):
                with self.assertRaises(RuntimeError) as caught:w.sample()
            self.assertIs(caught.exception,error);self.assertEqual(w.sample_stage_report()['stages']['ownedRSS']['failedCalls'],1)
    def test_clock_error_never_disables_original_guard_or_invents_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=self.window(Path(tmp));error=RuntimeError('original RSS firstcause')
            with mock.patch.object(lab.time,'monotonic_ns',side_effect=OSError('clock')),mock.patch.object(lab.guard,'proc_inventory',return_value=(self.rows(),[])),mock.patch.object(lab,'owned_rss',side_effect=error) as rss:
                with self.assertRaises(RuntimeError) as caught:w.sample()
            self.assertIs(caught.exception,error);rss.assert_called_once();r=w.sample_stage_report();self.assertEqual(r['status'],'UNKNOWN');self.assertIsNone(r['stages']['ownedRSS']['totalNs'])
    def test_original_pid_cap_checks_full_descendant_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=self.window(Path(tmp));rows=self.rows()
            for i in range(20):rows[900000+i]=dict(pid=900000+i,parent=os.getpid(),startTicks=1)
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,[])),mock.patch.object(lab,'owned_rss') as rss:
                with self.assertRaisesRegex(RuntimeError,'owned PID bound'):w.sample()
                rss.assert_not_called()
    def test_initial_storage_scan_is_immediate_and_one_second_cadence_remains(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=self.window(Path(tmp));w.started=0
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(self.rows(),[])),mock.patch.object(lab,'owned_rss',return_value=10),mock.patch.object(lab,'private_bytes',return_value=100) as storage:
                for clock,expected in [(0.2,1),(0.7,1),(1.3,2)]:
                    with mock.patch.object(lab.time,'monotonic',return_value=clock):w.sample()
                    self.assertEqual(storage.call_count,expected)
            self.assertEqual(w.sample_stage_report()['stages']['storageInventory']['calls'],2)
if __name__=='__main__':unittest.main()
