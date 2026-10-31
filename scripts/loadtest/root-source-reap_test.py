#!/usr/bin/env python3
"""Ownership/reaping regression from actual hosted adopted-Go-zombie failure."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('root_scope_controls', Path(__file__).with_name('root-source-scope.py'))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class AdoptedChildControls(unittest.TestCase):
    def inputs(self, *, state='Z', parent=None, second_start=19, known_start=19, direct=False):
        row = dict(pid=37001, parent=os.getpid() if parent is None else parent,
                   startTicks=19, state=state, group=37001, threads=1)
        guard = SimpleNamespace(proc_inventory=mock.Mock(return_value=({37001: row}, [])),
                                owned_set=mock.Mock(return_value={os.getpid(), 37001}),
                                bounded=mock.Mock(return_value=b'CONTROL STAT'),
                                parse_stat=mock.Mock(return_value=dict(row, startTicks=second_start)))
        def require(condition, reason):
            if not condition:
                raise RuntimeError(reason)
        lab = SimpleNamespace(require=require, guard=guard,
                              heavy_processes=mock.Mock(return_value=[dict(pid=37001, comm='go')]))
        process = SimpleNamespace(pid=37001 if direct else 37000, poll=lambda: 0)
        window = SimpleNamespace(children=[dict(process=process)], known={37001: known_start})
        return lab, window

    def test_only_verified_owned_adopted_zombie_is_actually_waited(self):
        lab, window = self.inputs()
        with mock.patch.object(scope.os, 'waitpid', return_value=(37001, 0)) as wait:
            record = scope.reap_adopted_heavy_zombies(lab, window)
        wait.assert_called_once_with(37001, os.WNOHANG)
        self.assertEqual(record['waited'][0]['exitCode'], 0)
        self.assertEqual(record['waited'][0]['secondStat']['startTicks'], 19)
        self.assertEqual(record['retained'], [])

    def test_active_heavy_is_retained_for_unchanged_original_admission(self):
        lab, window = self.inputs(state='R')
        with mock.patch.object(scope.os, 'waitpid') as wait:
            record = scope.reap_adopted_heavy_zombies(lab, window)
        wait.assert_not_called()
        self.assertEqual(record['retained'][0]['pid'], 37001)

    def test_managed_popen_child_is_not_reaped_by_adopted_child_cleanup(self):
        lab, window = self.inputs(direct=True)
        with mock.patch.object(scope.os, 'waitpid') as wait:
            record = scope.reap_adopted_heavy_zombies(lab, window)
        wait.assert_not_called()
        self.assertEqual(len(record['retained']), 1)

    def test_foreign_parent_zombie_is_retained(self):
        lab, window = self.inputs(parent=7)
        with mock.patch.object(scope.os, 'waitpid') as wait:
            record = scope.reap_adopted_heavy_zombies(lab, window)
        wait.assert_not_called()
        self.assertEqual(len(record['retained']), 1)

    def test_pid_reuse_and_missing_original_observation_both_reject(self):
        for kwargs in [dict(second_start=20), dict(known_start=20)]:
            with self.subTest(kwargs=kwargs):
                lab, window = self.inputs(**kwargs)
                with mock.patch.object(scope.os, 'waitpid') as wait, self.assertRaises(RuntimeError):
                    scope.reap_adopted_heavy_zombies(lab, window)
                wait.assert_not_called()

    def test_nonzero_adopted_exit_is_not_hidden_and_partial_receipt_survives(self):
        lab, window = self.inputs()
        record = {}
        with mock.patch.object(scope.os, 'waitpid', return_value=(37001, 2 << 8)), self.assertRaisesRegex(RuntimeError, 'nonzero'):
            scope.reap_adopted_heavy_zombies(lab, window, record)
        self.assertEqual(record['waited'][0]['exitCode'], 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
