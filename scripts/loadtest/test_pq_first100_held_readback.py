"""Readback controls with synthetic archive metadata only."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('held_readback', Path(__file__).with_name('pq-first100-held-readback.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class HeldReadbackTests(unittest.TestCase):
    controller = 'e' * 40

    def fixture(self, with_receipt=True, accounts=500, prefix='fixture/public/'):
        source = dict(commit='a' * 40, tree='b' * 40)
        tools = dict(commit='c' * 40, tree='d' * 40)
        config = dict(profile='first100-held-public-owner', nodeCount=4, pressureLevel=1,
                      source=source['commit'], sourceTree=source['tree'],
                      tools=tools['commit'], toolsTree=tools['tree'])
        pin = sha(encode(config))
        plan = dict(configuration=config, configurationSHA256=pin, runtimePlanSHA256=None)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('pq-first100-held-plan.json', encode(plan))
            if with_receipt:
                archive.writestr(prefix + 'FIRST100-HELD-CI.json', encode(dict(plan, controllerCommit=self.controller)))
                archive.writestr(prefix + 'receipt.json', encode(dict(source=source, toolIdentity=tools,
                    loadExecuted=False, firstCause='stopped before release')))
                archive.writestr(prefix + 'requested-load.json', encode(dict(source=source, mode='online',
                    rate=100, seconds=5, accounts=accounts, tailSeconds=30, perAccountCapacity=1, configuredDemand=500)))
        return output.getvalue(), pin

    def test_stopped_before_release_preserves_missing_data(self):
        for has_receipt, status in [(False, 'NO_RUNTIME_RECEIPT'), (True, 'LOAD_RESULT_MISSING')]:
            raw, pin = self.fixture(with_receipt=has_receipt)
            report = reader.inspect(raw, sha(raw), self.controller, pin)
            self.assertEqual(report['status'], status)
            self.assertIsNone(report['fullCohort'])
            if has_receipt:
                self.assertEqual(report['firstCause'], 'stopped before release')

    def test_original_configuration_and_full_demand_are_required(self):
        raw, pin = self.fixture(prefix='public/')
        self.assertEqual(reader.inspect(raw, sha(raw), self.controller, pin)['status'], 'LOAD_RESULT_MISSING')
        raw, pin = self.fixture(accounts=499)
        with self.assertRaisesRegex(RuntimeError, 'original demand differs'):
            reader.inspect(raw, sha(raw), self.controller, pin)
        with self.assertRaisesRegex(RuntimeError, 'configuration digest differs'):
            reader.inspect(raw, sha(raw), self.controller, '0' * 64)


if __name__ == '__main__':
    unittest.main()
