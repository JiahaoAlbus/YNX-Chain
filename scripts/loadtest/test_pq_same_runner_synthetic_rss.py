"""Controls for the Linux synthetic RSS harness, never an online load test."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('rss_harness',HERE/'pq-same-runner-synthetic-rss.py')
rss=importlib.util.module_from_spec(spec);spec.loader.exec_module(rss)
REPO=HERE.parents[1]


class SyntheticRSSControls(unittest.TestCase):
    def test_distribution_and_tampering(self):
        values=rss.sizes()
        self.assertEqual((len(values),sum(values),max(values)),(302,117004940,70298628))
        data=json.loads(rss.HISTOGRAM.read_bytes());data['histogram'][0]['count']+=1
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'wrong.json';path.write_text(json.dumps(data))
            with self.assertRaises(RuntimeError):rss.sizes(path)

    def test_default_and_platform_refusal(self):
        if sys.platform!='linux':
            with self.assertRaisesRegex(RuntimeError,'actual Linux'):
                rss.worker('/does-not-exist','/does-not-exist',[])

    def test_sampler_counts_launcher_and_child_and_refuses_identity_change(self):
        rows={10:dict(startTicks=11),20:dict(startTicks=22)}
        guard=types.SimpleNamespace(proc_inventory=lambda:(rows,[]),
            owned_set=lambda inventory,launcher,known: [launcher,20])
        lab=types.SimpleNamespace(guard=guard,owned_rss=lambda pid,row,**kw:pid*100)
        sampler=rss.Sampler(lab,10,11);sampler.sample('control')
        self.assertEqual(sampler.records[0]['rssBytes'],3000)
        rows[10]['startTicks']=12
        with self.assertRaisesRegex(RuntimeError,'launcher identity'):sampler.sample('bad')

    def test_sampler_refuses_upper_bound_as_measured_rss(self):
        guard=types.SimpleNamespace(proc_inventory=lambda:({10:dict(startTicks=11)},[]),
            owned_set=lambda inventory,launcher,known:[launcher])
        def rss_bound(pid,row,*,fallback):
            fallback(dict(sampleKind='same-thread-group-VmSize-upper-bound'));return 1
        sampler=rss.Sampler(types.SimpleNamespace(guard=guard,owned_rss=rss_bound),10,11)
        with self.assertRaisesRegex(RuntimeError,'upper bound'):sampler.sample('bad')

    def test_exact_original_producers_with_small_synthetic_payloads(self):
        # Exercise both real pair producers, with original-format synthetic
        # fixtures and an actual >8 MiB declared blob. No node or sender runs.
        with tempfile.TemporaryDirectory() as temp:
            for label,commit in (('before',rss.BEFORE),('after',rss.AFTER)):
                root=Path(temp)/label;root.mkdir()
                source=rss.source(REPO,root,commit)
                spec=importlib.util.spec_from_file_location('original_case_'+label,source/'test_pq_same_runner_pair_producer.py')
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                work=root/'work';work.mkdir();case=module.Case(work)
                for arm in ('before','after'):
                    adapter=case.adapters[arm];execute=adapter.execute
                    def wrap(register,*,adapter=adapter,execute=execute):
                        execute(register);rss.populate(adapter.work,[8*1024*1024+2,64,0])
                    adapter.execute=wrap
                result=case.run()
                self.assertEqual(result['status'],'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS',result)
                self.assertIsNone(result['firstCause'])


if __name__=='__main__':unittest.main()
