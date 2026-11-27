import importlib.util
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('cross_source_control',Path(__file__).with_name('pq-synthetic-header-cross-source-ci.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def event(action, name=None, output=None, package=m.PACKAGE):
    e=dict(Time='2026-01-01T00:00:00Z',Action=action,Package=package)
    if name is not None:e['Test']=name
    if output is not None:e['Output']=output
    return json.dumps(e,separators=(',',':')).encode()+b'\n'

def valid():
    return b''.join((event('start'),event('run',m.TEST),event('output',m.TEST,'=== RUN   '+m.TEST+'\n'),
        event('output',m.TEST,'--- PASS: '+m.TEST+' (0.00s)\n'),event('pass',m.TEST),
        event('output',output='PASS\n'),event('output',output='ok  '+m.PACKAGE+'\t0.010s\n'),event('pass')))

class OriginalGoEvidenceControls(unittest.TestCase):
    def test_source_only_composer_control_projects_no_private_bytes(self):
        spec=importlib.util.spec_from_file_location('header_original_compose_control',Path(__file__).with_name('pq-synthetic-header-compose-control.py'))
        control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control)
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source=root/'source';source.mkdir();destination=root/'composition';destination.mkdir()
            (destination/'SOURCE-SELECTION.json').write_bytes(b'{"control":"PRIVATE_SENTINEL"}\n')
            (destination/'SOURCE-NATIVE-DEPENDENCIES.json').write_bytes(b'{"control":"PRIVATE_SENTINEL"}\n')
            commit=next(iter(m.PRODUCERS));tree,fork=m.PRODUCERS[commit];supplier,supplier_tree=m.SUPPLIERS[commit]
            result=dict(source=dict(commit=commit,tree=tree,forkTree=fork),sourceCompositionOnly=True,
                runtimeAuthorized=False,sourceCIQualified=False,pressureAuthorized=False,carrierEnabled=False,
                actualNetworkWindow=False,optionalForkCommit=supplier,optionalForkTree=supplier_tree)
            with mock.patch.object(sys,'argv',['control',str(source),str(destination),commit]), \
                 mock.patch.object(control,'source_identity',return_value=(commit,tree,fork)), \
                 mock.patch.object(control.reader,'prepare_matching_source',return_value=result) as compose:
                control.main()
            compose.assert_called_once_with(source,destination,held_source_only=True)
            raw=(root/'composition-control.json').read_bytes();self.assertNotIn(b'PRIVATE_SENTINEL',raw)
            value=json.loads(raw);self.assertEqual((value['source'],value['sourceTree'],value['forkTree']),(commit,tree,fork))
            self.assertFalse(value['runtimeAuthorized'] or value['sourceCIQualified'] or value['pressureAuthorized'])

    def test_source_only_composer_control_refuses_false_scope_before_output(self):
        spec=importlib.util.spec_from_file_location('header_original_compose_control_bad',Path(__file__).with_name('pq-synthetic-header-compose-control.py'))
        control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control)
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source=root/'source';source.mkdir();destination=root/'composition';destination.mkdir();commit=next(iter(m.PRODUCERS))
            result=dict(source=dict(commit=commit),sourceCompositionOnly=True,runtimeAuthorized=True,sourceCIQualified=False,
                pressureAuthorized=False,carrierEnabled=False,actualNetworkWindow=False)
            with mock.patch.object(sys,'argv',['control',str(source),str(destination),commit]), \
                 mock.patch.object(control,'source_identity',return_value=(commit,*m.PRODUCERS[commit])), \
                 mock.patch.object(control.reader,'prepare_matching_source',return_value=result),self.assertRaises(RuntimeError):control.main()
            self.assertFalse((root/'composition-control.json').exists())

    def test_actual_git_wrong_original_source_refuses_before_output(self):
        spec=importlib.util.spec_from_file_location('header_original_compose_control_wrong',Path(__file__).with_name('pq-synthetic-header-compose-control.py'))
        control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control);self.assertEqual(control.SOURCES,m.PRODUCERS)
        with tempfile.TemporaryDirectory() as t:
            source=Path(__file__).resolve().parents[2];destination=Path(t)/'composition';commit=next(iter(m.PRODUCERS))
            with mock.patch.object(sys,'argv',['control',str(source),str(destination),commit]), \
                 mock.patch.object(control.reader,'prepare_matching_source') as compose,self.assertRaisesRegex(RuntimeError,'before output'):
                control.main()
            compose.assert_not_called();self.assertFalse(destination.exists());self.assertFalse((Path(t)/'composition-control.json').exists())

    def test_two_exact_producer_identities_never_admit_near_or_missing_source(self):
        expected={
            'edf5b12deb65f94e6e731708f336ca1af23bcfe1':('a2348dc67ee627fcfc3021c513315acd7b9abc7b','aadf0831c6b65559065ca82228bab30811d36c67'),
            'bbe860e8744a479e1838db9b7ae26b8d9a8bb34e':('7f70fd791e1706ad151b2e3d6e68a16c586650aa','5a128880d14bfc73de4334cba23218859ad3473c')}
        self.assertEqual(m.PRODUCERS,expected)
        self.assertEqual(m.PRODUCERS,m.driver.SYNTHETIC_HEADER_STREAM_ONLY_ABI_SOURCES)
        self.assertEqual(m.SUPPLIERS,{
            'edf5b12deb65f94e6e731708f336ca1af23bcfe1':('28a769cc934ea5bffe971214cabe7285b30d80d2','d1614fd27dedde42da4142648ae7201aeb988036'),
            'bbe860e8744a479e1838db9b7ae26b8d9a8bb34e':('5a49f5c91452604dffb910df736702b3b9df2562','08747364c24c065bf2b13527c210625d7ec95fba')})
        for source,pins in expected.items():self.assertEqual(m.producer_identity(source),(source,*pins))
        for bad in (None,'',next(iter(expected))[:-1]+'0','0'*40):
            with self.subTest(bad=bad),self.assertRaises(RuntimeError):m.producer_identity(bad)
    def test_original_events_preserved_with_downloads_private(self):
        raw=valid();out,n=m.original_go_events(b'go: downloading example.invalid/module v1.0.0\n'+raw)
        self.assertEqual(out,raw);self.assertEqual(n,1)
    def test_fail_skip_extra_package_and_duplicate_refused(self):
        raw=valid()
        for bad in (raw+event('skip',m.TEST),raw+event('run',m.TEST),raw+event('start',package='different/package'),raw.replace(b'"Action":"pass"',b'"Action":"fail"',1),
                    raw+event('run'),raw+event('start',m.TEST),raw+event('output',output='PASS\n')):
            with self.subTest():
                with self.assertRaises(RuntimeError):m.original_go_events(bad)
    def test_private_output_and_truncation_refused(self):
        for bad in (valid()+event('output',m.TEST,'secret-path\n'),valid()[:-1]):
            with self.assertRaises(RuntimeError):m.original_go_events(bad)
    def test_original_primary_survives_monitor_close_and_window_stop(self):
        first=ValueError('CONTROL original first');thread=SimpleNamespace(start=mock.Mock(),ident=1,is_alive=mock.Mock(return_value=False))
        monitor=SimpleNamespace(thread=thread,close=mock.Mock(side_effect=OSError('CONTROL join failure')),failure_snapshot=mock.Mock(return_value=None))
        window=SimpleNamespace(stop=mock.Mock(return_value=True));output=io.StringIO()
        with contextlib.redirect_stdout(output):
            with self.assertRaises(ValueError) as raised:m.run_owned(window,monitor,lambda:(_ for _ in ()).throw(first))
        self.assertIs(raised.exception,first);window.stop.assert_called_once();self.assertIn('monitorClose',output.getvalue())
    def test_monitor_start_failure_still_retires_window(self):
        first=OSError('CONTROL start failure');thread=SimpleNamespace(start=mock.Mock(side_effect=first),ident=None,is_alive=mock.Mock(return_value=False))
        monitor=SimpleNamespace(thread=thread,close=mock.Mock(),failure_snapshot=mock.Mock(return_value=None));window=SimpleNamespace(stop=mock.Mock(return_value=True))
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(OSError) as raised:m.run_owned(window,monitor,lambda:None)
        self.assertIs(raised.exception,first);monitor.close.assert_called_once();window.stop.assert_called_once()
    def test_real_monitor_latch_before_later_error_keeps_both_and_order_unknown(self):
        reached=threading.Event()
        class Window:
            def _sample(self):reached.set();raise OSError('CONTROL original resource')
            def sample(self):return self._sample()
            def stop(self):return True
        window=Window();monitor=m.driver.Monitor(window,threading.Event());first=ValueError('CONTROL later command failure')
        def operation():
            self.assertTrue(reached.wait(2));monitor.thread.join(2);self.assertFalse(monitor.thread.is_alive());raise first
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            with self.assertRaises(ValueError) as raised:m.run_owned(window,monitor,operation)
        self.assertIs(raised.exception,first);self.assertIn('"resourceFailureType":"OSError"',output.getvalue())
        self.assertIn('"firstCauseOrder":"UNKNOWN"',output.getvalue())
    def test_owned_go_wait_aborts_on_original_resource_failure(self):
        proc=SimpleNamespace(poll=mock.Mock(return_value=None));monitor=SimpleNamespace(check=mock.Mock(side_effect=RuntimeError('CONTROL resource')))
        window=SimpleNamespace(sample=mock.Mock(),wait=mock.Mock());stop=threading.Event()
        with self.assertRaisesRegex(RuntimeError,'CONTROL resource'):m.wait_original(window,proc,monitor,stop)
        window.sample.assert_not_called();window.wait.assert_not_called()

if __name__=='__main__':unittest.main()
