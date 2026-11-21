"""Synthetic original job event controls; no source/pressure grant."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('before59',Path(__file__).with_name('pq-before59-equivalence-readback.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
SOURCE='a'*40

def fixture():
    binding=dict(source=SOURCE,run=100,focusedJob=101)
    step=dict(name=b.STEP,status='completed',conclusion='success',started_at='2026-11-21T01:03:00Z',completed_at='2026-11-21T01:03:03Z')
    focused=dict(id=101,run_id=100,head_sha=SOURCE,steps=[step])
    lines=[]
    def put(second,value):lines.append(f'2026-11-21T01:03:{second:02}.1234567Z '+value+'\n')
    put(0,'\x1b[36;1m'+b.COMMAND+'\x1b[0m')
    put(1,json.dumps(dict(Time='2026-11-21T01:03:00.500Z',Action='start',Package=b.PACKAGE)))
    for name in b.NAMES:
        put(1,json.dumps(dict(Time='2026-11-21T01:03:00.500Z',Action='run',Package=b.PACKAGE,Test=name)))
        put(2,json.dumps(dict(Time='2026-11-21T01:03:01.500Z',Action='pass',Package=b.PACKAGE,Test=name)))
    put(2,json.dumps(dict(Time='2026-11-21T01:03:01.500Z',Action='pass',Package=b.PACKAGE)))
    put(2,'YNX_BEFORE59_OBSERVER_EQUIVALENCE_DATA_ONLY tests=2 skipped=0 source='+SOURCE+' nodeStarted=false runtimeAuthorized=false')
    return binding,focused,''.join(lines).encode()

class Before59EquivalenceControls(unittest.TestCase):
    def test_complete_original_step_is_data_only(self):
        x=b.inspect_before59(*fixture())
        self.assertEqual((x['tests'],x['skipped']),(2,0));self.assertFalse(x['runtimePermissionGranted'] or x['independentFinality'])
        binding,job,raw=fixture()
        # Original earlier full CLI suite can run the same named tests; only
        # the exact selected step supplies this bounded equivalence evidence.
        earlier=('2026-11-21T01:02:00.100Z '+json.dumps(dict(Action='run',Package=b.PACKAGE,Test=b.NAMES[0]))+'\n').encode()
        self.assertEqual(b.inspect_before59(binding,job,earlier+raw)['tests'],2)
    def test_cross_source_run_and_job_refused(self):
        binding,job,raw=fixture()
        for key,value in (('source','b'*40),('run',999),('focusedJob',999)):
            bad=dict(binding,**{key:value})
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'identity differs'):b.inspect_before59(bad,job,raw)
    def test_missing_duplicate_or_skipped_step_refused(self):
        binding,job,raw=fixture()
        for mode in ('missing','duplicate','skipped'):
            changed=copy.deepcopy(job)
            if mode=='missing':changed['steps']=[]
            if mode=='duplicate':changed['steps'].append(copy.deepcopy(changed['steps'][0]))
            if mode=='skipped':changed['steps'][0]['conclusion']='skipped'
            with self.subTest(mode=mode),self.assertRaises(ValueError):b.inspect_before59(binding,changed,raw)
    def test_wrong_step_time_and_outside_events_refused(self):
        binding,job,raw=fixture()
        job['steps'][0]['started_at']='2026-11-21T01:03:02Z'
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw)
        job['steps'][0]['started_at']='bad'
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw)
    def test_repeated_or_skipped_test_refused(self):
        binding,job,raw=fixture();lines=raw.splitlines(keepends=True)
        repeated=raw+b''.join(x for x in lines if b'"Action": "run"' in x and b'TestBefore59' in x)
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,repeated)
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw.replace(b'"Action": "pass", "Package":',b'"Action": "skip", "Package":',1))
    def test_child_or_foreign_package_cannot_replace_top(self):
        binding,job,raw=fixture();top=b.NAMES[0].encode()
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw.replace(top,top+b'/child'))
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw.replace(b.PACKAGE.encode(),b'foreign/package',1))
    def test_summary_is_unique_and_exact_source(self):
        binding,job,raw=fixture()
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw.replace(SOURCE.encode(),b'b'*40))
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw+raw.splitlines(keepends=True)[-1])
    def test_incomplete_package_and_bad_json_refused(self):
        binding,job,raw=fixture()
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw.replace(b'"Action": "start"',b'"Action": "output"',1))
        with self.assertRaisesRegex(ValueError,'time'):
            b.inspect_before59(binding,job,raw.replace(b'2026-11-21T01:03:00.500Z',b'2026-11-21T01:02:00.500Z',1))
        # Same metadata second but before the uniquely echoed original go
        # command is still an earlier run, never current-step evidence.
        with self.assertRaisesRegex(ValueError,'time'):
            b.inspect_before59(binding,job,raw.replace(b'2026-11-21T01:03:00.500Z',b'2026-11-21T01:03:00.050Z',1))
        with self.assertRaisesRegex(ValueError,'time'):
            b.inspect_before59(binding,job,raw.replace(b'2026-11-21T01:03:00.500Z',b'2026-11-21T01:03:00.1234566Z',1))
        with self.assertRaisesRegex(ValueError,'command'):
            b.inspect_before59(binding,job,raw.replace(b.COMMAND.encode(),b'not the original command',1))
        with self.assertRaisesRegex(ValueError,'time'):
            b.inspect_before59(binding,job,raw.replace(b'"Time": "2026-11-21T01:03:00.500Z", ',b'',1))
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw.replace(b'"Action": "run"',b'"Action": "run", "Action": "run"',1))
        lines=raw.splitlines(keepends=True)
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,lines[-1]+b''.join(lines[:-1]))
        extra=('2026-11-21T01:03:02.2Z '+json.dumps(dict(Time='2026-11-21T01:03:01.500Z',Action='run',Package=b.PACKAGE,Test='TestUnexpected'))+'\n').encode()
        with self.assertRaises(ValueError):b.inspect_before59(binding,job,raw+extra)
        child=('2026-11-21T01:03:02.2Z '+json.dumps(dict(Time='2026-11-21T01:03:01.500Z',Action='run',Package=b.PACKAGE,Test=b.NAMES[0]+'/unexpected'))+'\n').encode()
        with self.assertRaisesRegex(ValueError,'unexpected'):b.inspect_before59(binding,job,raw+child)

if __name__=='__main__':unittest.main()
