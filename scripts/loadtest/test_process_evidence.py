"""Regression for actual 4096 observations/16 identities; no chain workload."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location("evidence_cohort",Path(__file__).with_name("consensus-linux-cohort.py"))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
KEYS=("pid","startTicks","reason","rssError","statError")


class ProcessEvidenceControls(unittest.TestCase):
    def test_actual_failed_trace_stays_sixteen_rows_with_exact_counts_and_edges(self):
        source=json.loads((Path(__file__).with_name('fixtures')/'rss-retirement-41226547284.json').read_bytes())
        rows=[];sink=lab.ProcessEvidence(rows,KEYS);clock=0
        for group in source['groups']:
            for _ in range(group['count']):clock+=1;sink.retain(group['event'],clock)
        self.assertEqual(len(rows),16);self.assertEqual(sum(int(r['observations']) for r in rows),4096)
        for row,group in zip(rows,source['groups']):
            self.assertEqual(int(row['observations']),group['count']);self.assertEqual(row['firstEvent'],group['event']);self.assertEqual(row['lastEvent'],group['event'])
        # The next SAME event was the old fatal append; it must be counted.
        sink.retain(source['groups'][0]['event'],clock+1)
        self.assertEqual(len(rows),16);self.assertEqual(sum(int(r['observations']) for r in rows),4097)

    def test_distinct_identity_reason_and_kernel_errors_are_never_merged(self):
        rows=[];sink=lab.ProcessEvidence(rows,KEYS)
        original=dict(pid=42,startTicks=100,reason='same-identity-zombie',rssError=3)
        events=[original,{**original,'pid':43},{**original,'startTicks':101},{**original,'reason':'second-stat-proved-gone'},{**original,'rssError':2},{**original,'statError':2}]
        for i,event in enumerate(events):sink.retain(event,i)
        self.assertEqual(len(rows),len(events));self.assertTrue(all(r['observations']=='1' for r in rows))

    def test_exact_distinct_bound_and_counter_overflow_remain_fatal(self):
        rows=[];sink=lab.ProcessEvidence(rows,KEYS)
        for i in range(4096):sink.retain(dict(pid=i+1,startTicks=100,reason='gone'),i)
        with self.assertRaisesRegex(RuntimeError,'distinct process sample evidence bound'):sink.retain(dict(pid=5000,startTicks=100,reason='gone'),5000)
        self.assertEqual(len(rows),4096)
        row=rows[0];row['observations']=str((1<<64)-1)
        with self.assertRaisesRegex(RuntimeError,'count overflow'):sink.retain(dict(pid=1,startTicks=100,reason='gone'),5001)
        self.assertEqual(row['observations'],str((1<<64)-1))

    def test_repeated_fallback_keeps_first_last_and_min_max_without_replacing_rss(self):
        rows=[];sink=lab.ProcessEvidence(rows,('pid','startTicks','tid','threadStartTicks','sampleKind','reason','originalRSSKernelError','retired'))
        original=dict(pid=42,startTicks=100,tid=43,threadStartTicks=200,sampleKind='same-thread-group-VmSize-upper-bound',reason='same-thread-group-VmSize-upper-bound',originalRSSKernelError=3,retired=False,sampledBytes=100)
        sink.retain(original,1);sink.retain({**original,'sampledBytes':900},2);sink.retain({**original,'sampledBytes':50},3)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['observations'],'3')
        self.assertEqual((rows[0]['minSampledBytes'],rows[0]['maxSampledBytes']),(50,900))
        self.assertEqual(rows[0]['firstEvent']['sampledBytes'],100);self.assertEqual(rows[0]['lastEvent']['sampledBytes'],50)
        with self.assertRaisesRegex(RuntimeError,'clock regressed'):sink.retain(original,2)

    def test_each_repeat_still_calls_real_sampling_and_identity_failure_is_not_cached(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.private').mkdir();(root/'public').mkdir()
            with mock.patch.object(lab.os,'sched_getaffinity',return_value={0,1},create=True),mock.patch.object(lab.os,'sched_setaffinity',create=True):w=lab.Window(root,root)
            calls=[]
            def verified(pid,before,retired,fallback):
                calls.append(pid)
                if len(calls)==3:raise RuntimeError('original identity changed')
                retired(dict(pid=pid,startTicks=100,reason='same-identity-zombie',rssError=3));return 0
            with mock.patch.object(lab.guard,'proc_inventory',return_value=({42:dict(startTicks=100,state='Z',threads=1)},[])),mock.patch.object(lab.guard,'owned_set',return_value={42}),mock.patch.object(lab,'owned_rss',side_effect=verified):
                w.sample();w.sample()
                with self.assertRaisesRegex(RuntimeError,'identity changed'):w.sample()
            self.assertEqual(len(calls),3);self.assertEqual(len(w.retired_samples),1);self.assertEqual(w.retired_samples[0]['observations'],'2')

    @unittest.skipUnless(sys.platform=='linux','actual Linux zombie/task proof requires sole CORE evidence group')
    def test_actual_owned_zombie_reobserved_until_real_wait_and_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.private').mkdir();(root/'public').mkdir();w=lab.Window(Path(__file__).resolve().parents[2],root)
            p=w.launch('real-evidence-exit',[sys.executable,'-I','-c','raise SystemExit(0)'])
            try:
                until=lab.time.monotonic()+3
                while lab.time.monotonic()<until:
                    row=lab.guard.parse_stat(lab.guard.bounded(Path('/proc')/str(p.pid)/'stat'),p.pid)
                    if row['state']=='Z':break
                    lab.time.sleep(.01)
                self.assertEqual(row['state'],'Z')
                for _ in range(3):w.sample()
                records=[r for r in w.retired_samples if r['pid']==p.pid]
                self.assertEqual(len(records),1);self.assertEqual(records[0]['observations'],'3')
                self.assertEqual(p.wait(timeout=2),0)
                w.sample();self.assertEqual(records[0]['observations'],'3')
            finally:self.assertTrue(w.stop())


if __name__=='__main__':unittest.main()
