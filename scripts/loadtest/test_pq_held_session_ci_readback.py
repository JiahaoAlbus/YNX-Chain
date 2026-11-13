"""Reject missing, skipped or detached held-session component test evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    'held_session_readback', Path(__file__).with_name('pq-held-session-ci-readback.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class HeldSessionReadback(unittest.TestCase):
    def test_exact_component_cases_require_complete_package_and_test_frames(self):
        for kind, (suffix, required) in reader.REQUIRED.items():
            package = 'github.com/JiahaoAlbus/YNX-Chain/' + suffix

            def row(action, **fields):
                return dict(Action=action, Package=package, **fields)

            rows = [row('start')]
            for name in required:
                rows.extend([row('run', Test=name), row('pass', Test=name)])
            rows.append(row('pass'))

            def read(events):
                raw = b''.join(json.dumps(event).encode() + b'\n' for event in events)
                return reader.readback(kind, raw, hashlib.sha256(raw).hexdigest())

            report = read(rows)
            self.assertEqual(report['requiredPassed'], sorted(required))
            self.assertFalse(report['fourNodePerformanceMeasured'])
            for invalid in (rows[:-1], rows[:1] + rows[2:],
                            rows[:2] + [dict(rows[2], Action='skip')] + rows[3:]):
                with self.assertRaises(RuntimeError):
                    read(invalid)


if __name__ == '__main__':
    unittest.main()
