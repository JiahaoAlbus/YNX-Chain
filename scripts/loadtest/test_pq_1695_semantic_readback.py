"""Negative transport/process controls; these never qualify a fabricated run."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('own1695_semantic_ci_reader', Path(__file__).with_name('pq-1695-semantic-readback.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def stages():
    commands = [dict(name=n, argv=[n]) for n in m.COMMANDS]
    processes = [dict(name=n, command=[n], pid=i+1, startTicks=123, rawReturnCode=0,
                      exitCode=0, signal=None, exited=True, observedLaunchToExitNs=123456789)
                 for i, n in enumerate(m.COMMANDS)]
    return dict(actualCommands=commands, processes=processes)


class SemanticOriginalControls(unittest.TestCase):
    def test_missing_after_stage_cannot_be_pair(self):
        r = stages(); r['processes'].pop()
        with self.assertRaises(RuntimeError): m.stage_times(r)

    def test_nonzero_signal_unfinished_missing_duration_refused(self):
        for delta in [dict(rawReturnCode=1, exitCode=1), dict(signal=9), dict(exited=False),
                      dict(observedLaunchToExitNs=None), dict(exitCode=False)]:
            r = stages(); r['processes'][-1].update(delta)
            with self.subTest(delta=delta), self.assertRaises(RuntimeError): m.stage_times(r)

    def test_pid_reuse_needs_distinct_start_identity(self):
        r = stages(); r['processes'][1].update(pid=1)
        with self.assertRaises(RuntimeError): m.stage_times(r)
        r['processes'][1]['startTicks'] = 124
        self.assertEqual(m.stage_times(r)['after-replay'], .123456789)

    def test_reported_command_cannot_replace_actual_child_command(self):
        r = stages(); r['actualCommands'][-1]['argv'] = ['different']
        with self.assertRaises(RuntimeError): m.stage_times(r)

    def test_selected_zip_pin_refuses_partial_before_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp).resolve() / 'partial.zip'; p.write_bytes(b'PK partial')
            with self.assertRaisesRegex(RuntimeError, 'artifact size/SHA'): m.read_zip(p)

    def test_inventory_duplicate_scope_and_hash_tamper_refused(self):
        row = dict(path='cmd/x.go', bytes=1, sha256='a'*64)
        for rows in [[row, copy.deepcopy(row)], [dict(row, path='../x')],
                     [dict(row, path='third_party/unselected/x')], [dict(row, sha256='bad')]]:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError): m.inventory(rows)


if __name__ == '__main__':
    unittest.main()
