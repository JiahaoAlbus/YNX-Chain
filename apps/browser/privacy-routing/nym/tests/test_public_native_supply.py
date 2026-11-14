"""CLI regressions for the offline PUBLIC Native supply producer."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PRODUCER = Path(__file__).resolve().parents[1] / 'prepare_public_native_supply.py'

class PublicNativeSupplyControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('YNX_NYM_TEST_OUTPUT'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.input = self.root / 'directory-input'
        self.output = self.root / 'NymPublicRuntime'
        self.receipt = self.root / 'receipt.json'

    def reject(self, reason, cohort=None):
        command = [sys.executable, str(PRODUCER), '--directory', str(self.input)]
        if cohort is not None:
            command += ['--cohort', cohort]
        for flag in ('runtime', 'directory-source', 'runtime-source', 'directory-receipt',
                     'runtime-receipt', 'license-directory'):
            command += ['--'+flag, str(self.root/'unused')]
        command += ['--output', str(self.output), '--receipt', str(self.receipt)]
        result = subprocess.run(command, capture_output=True, timeout=3, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(reason.encode(), result.stderr)
        self.assertFalse(self.receipt.exists())

    def test_wrong_executor_bytes_cannot_create_supply(self):
        self.input.write_bytes(b'fixture bytes')
        self.input.chmod(0o755)
        self.reject('input-byte-pin')
        self.assertFalse(self.output.exists())

    def test_no_writer_fifo_is_rejected_without_waiting(self):
        os.mkfifo(self.input, 0o700)
        self.reject('input-file-boundary')
        self.assertFalse(self.output.exists())

    def test_existing_destination_is_preserved(self):
        self.output.mkdir()
        sentinel = self.output/'sentinel'
        sentinel.write_bytes(b'previous staging output')
        self.reject('output-already-exists')
        self.assertEqual(sentinel.read_bytes(), b'previous staging output')

    def test_interactive_role_still_requires_the_exact_directory_executor(self):
        self.input.write_bytes(b'interactive role must not authorize arbitrary bytes')
        self.input.chmod(0o755)
        self.reject('input-byte-pin', cohort='interactive')
        self.assertFalse(self.output.exists())

    def test_normal_is_not_a_public_supply_cohort(self):
        self.reject('invalid choice', cohort='normal')
        self.assertFalse(self.output.exists())

if __name__ == '__main__':
    unittest.main()
