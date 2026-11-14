"""Actual stream failures remain failures; these controls run no Go or nodes."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

path = Path(__file__).with_name('pq-first100-7c25-native-build-ci.py')
spec = importlib.util.spec_from_file_location('normal_native_build_carrier', path)
carrier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(carrier)


class OriginalBuildStreams(unittest.TestCase):
    def test_build_keeps_frozen_source_tools_and_pins_successor_guard(self):
        workflow = (path.parents[2] / '.github/workflows/pq-normal-process.yml').read_text()
        build = workflow.split('  first100-7c25-native-build:\n', 1)[1]
        build = build.split('  first100-held-controller-controls:\n', 1)[0]
        for ref, checkout in ((carrier.SOURCE, 'source'), (carrier.F2, 'tools'),
                              (carrier.BUILD_GUARD_TOOLS, 'guard-tools')):
            self.assertIn(f'ref: {ref}\n          path: {checkout}\n', build)
        self.assertIn('--guard-tools "$GITHUB_WORKSPACE/guard-tools"', build)

    def test_non_ci_capture_refuses_before_creating_or_launching_anything(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch.object(carrier.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'hosted CGO'):
                carrier.capture(Path(temp), 'forbidden', ['go', 'build'])
            run.assert_not_called()
            self.assertEqual(list(Path(temp).iterdir()), [])

    def test_real_failed_process_keeps_both_original_streams_and_exit_code(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(carrier, 'capture_context'):
            work = Path(temp)
            (work / 'public').mkdir()
            command = [sys.executable, '-I', '-c',
                       'import sys;print("original stdout");print("original stderr",file=sys.stderr);sys.exit(7)']
            self.assertEqual(carrier.capture(work, 'controlled-failure', command), 7)
            result = json.loads((work / 'public/controlled-failure.result.json').read_bytes())
            self.assertEqual(result['returnCode'], 7)
            self.assertEqual(result['argv'], command)
            self.assertEqual((work / 'public/controlled-failure.stdout').read_bytes(), b'original stdout\n')
            self.assertEqual((work / 'public/controlled-failure.stderr').read_bytes(), b'original stderr\n')
            self.assertGreater(result['elapsedNs'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
