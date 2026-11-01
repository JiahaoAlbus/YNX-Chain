"""Actual current75 inventory-failure cleanup regression, not a load rerun."""
import importlib.util
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('failure_cleanup_lab',Path(__file__).with_name('consensus-linux-cohort.py'))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


class FailedInventoryCleanupControls(unittest.TestCase):
    def test_inventory_failure_still_stops_exact_direct_children_and_is_not_success(self):
        w=object.__new__(lab.Window);process=mock.Mock(pid=123,returncode=None)
        process.poll.return_value=None
        def wait(timeout):process.returncode=-signal.SIGTERM;return process.returncode
        process.wait.side_effect=wait
        log=mock.Mock(closed=False);w.logs=[('owned',log)];w.children=[dict(name='owned',process=process,startTicks=42)]
        with mock.patch.object(w,'_stop',side_effect=RuntimeError('owned PID bound; inventory not truncated')),mock.patch.object(lab.os,'killpg') as signal_group:
            with self.assertRaisesRegex(RuntimeError,'owned PID bound'):w.stop()
        signal_group.assert_called_once_with(123,signal.SIGTERM)
        self.assertEqual(w.direct_cleanup_after_failure,[dict(name='owned',pid=123,startTicks=42,rawReturnCode=-signal.SIGTERM,exited=True)])
        log.close.assert_called_once();process.kill.assert_not_called()

    @unittest.skipUnless(sys.platform=='linux','actual owned process group requires CORE original Linux job')
    def test_real_direct_child_is_stopped_after_exact_owned_inventory_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.private').mkdir();(root/'public').mkdir();w=lab.Window(Path(__file__).resolve().parents[2],root)
            # Separate test-owned process is deliberately NOT registered with
            # this Window. Cleanup must never select it from PID inventory.
            foreign=lab.subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(20)'],start_new_session=True)
            proc=w.launch('original-direct-child',[sys.executable,'-I','-c','import time;time.sleep(20)'])
            try:
                with mock.patch.object(lab.guard,'owned_set',side_effect=RuntimeError('owned PID bound; inventory not truncated')):
                    with self.assertRaisesRegex(RuntimeError,'owned PID bound'):w.stop()
                self.assertIsNotNone(proc.poll());self.assertEqual(proc.returncode,-signal.SIGTERM)
                self.assertTrue(w.direct_cleanup_after_failure[0]['exited'])
                self.assertIsNone(foreign.poll())
            finally:
                if proc.poll() is None:proc.kill();proc.wait(timeout=2)
                foreign.terminate();foreign.wait(timeout=2)


if __name__=='__main__':unittest.main()
