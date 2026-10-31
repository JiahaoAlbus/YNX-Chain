#!/usr/bin/env python3
"""New diagnostic controls only; no source benchmark, signatures or downloads."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock

path = Path(__file__).with_name('root-source-admission.py')
spec = importlib.util.spec_from_file_location('root_admission_controls', path)
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class AdmissionEvidenceControls(unittest.TestCase):
    def lab(self, *, state='R', second_ticks=11, missing=False):
        row = dict(pid=17001, startTicks=11, state=state, parent=7, group=7, threads=1)
        guard = SimpleNamespace(proc_inventory=mock.Mock(return_value=({17001: row}, [])),
                                owned_set=mock.Mock(return_value=set()),
                                bounded=mock.Mock(side_effect=FileNotFoundError() if missing else None),
                                parse_stat=mock.Mock(return_value=dict(row, startTicks=second_ticks)))
        return SimpleNamespace(guard=guard, heavy_processes=mock.Mock(return_value=[dict(pid=17001, comm='go')]))

    def test_real_heavy_state_is_retained_without_argv_environment_or_filter(self):
        lab = self.lab()
        result = entry.snapshot(lab)
        row = result['originalHeavySelection'][0]
        self.assertEqual(row['identity'], 'SAME')
        self.assertEqual(row['originalInventory']['state'], 'R')
        self.assertEqual(row['comm'], 'go')
        self.assertNotIn('argv', row)
        self.assertNotIn('environment', row)
        lab.heavy_processes.assert_called_once()

    def test_zombie_is_retained_as_original_gate_selected_it(self):
        row = entry.snapshot(self.lab(state='Z'))['originalHeavySelection'][0]
        self.assertEqual(row['originalInventory']['state'], 'Z')
        self.assertEqual(row['identity'], 'SAME')

    def test_pid_reuse_is_explicitly_unknown_and_cannot_be_owned(self):
        row = entry.snapshot(self.lab(second_ticks=12))['originalHeavySelection'][0]
        self.assertEqual(row['identity'], 'PID_REUSED_OR_UNKNOWN')
        self.assertFalse(row['ownedByObserver'])

    def test_disappearance_is_preserved_instead_of_relabeling_idle(self):
        row = entry.snapshot(self.lab(missing=True))['originalHeavySelection'][0]
        self.assertEqual(row['identity'], 'DISAPPEARED_AFTER_ORIGINAL_SELECTION')

    def test_pinned_original_controller_loads_but_tampered_copy_rejects(self):
        original = entry.load_original(path.with_name(entry.BASE_NAME))
        self.assertEqual(original.B8_INPUT, 'c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401')
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / entry.BASE_NAME
            p.write_text('raise Exception("must not execute")\n')
            with self.assertRaisesRegex(RuntimeError, 'unchanged f27'):
                entry.load_original(p)

    def test_nonexecuting_entry_reuses_original_parser_without_new_admission(self):
        argv = ['--scope', 'b8', '--tools', '/readonly-tools', '--owner', '/readonly-owner',
                '--controller', '/controller', '--operation', '/new-operation']
        base = SimpleNamespace(main=mock.Mock(return_value=0))
        with mock.patch.object(entry, 'load_original', return_value=base), mock.patch.object(entry, 'observe') as watch:
            self.assertEqual(entry.main(argv), 0)
        base.main.assert_called_once_with(argv)
        watch.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
