"""Offline delta checks against actual fixed notice supply; never execute a backend."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
from privacy_backend_supply import read_supply, read_tor_release_supply, stage_supply
spec = importlib.util.spec_from_file_location('tor_license_supply', Path(__file__).resolve().parents[1] / 'license_supply.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class FixedNoticeDelta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = read_supply('tor', SUPPLY)

    def test_actual_target_closure_is_truthfully_unknown(self):
        result = gate.inspect_supply_license_materials(self.files)
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertEqual(result['targetPackagesIncludingArti'], 432)
        self.assertEqual(result['dependenciesWithNoticeBytes'], 374)
        self.assertEqual(len(result['unknownDependencies']), 57)
        self.assertEqual(result['rootArtiLicense'], 'UNKNOWN')
        self.assertEqual(result['lyrebirdObservedModules'], 63)
        self.assertFalse(result['productionIsolationAdmitted'])

    def test_actual_unknown_blocks_release_instead_of_pretending_complete(self):
        with self.assertRaises(gate.LicenseCoverageUnavailable) as failure:
            gate.require_release_license_coverage(self.files)
        self.assertEqual(failure.exception.report['status'], 'UNKNOWN')

    def test_existing_packager_formal_release_entry_refuses_unknown(self):
        with self.assertRaises(ValueError) as failure:
            read_tor_release_supply(SUPPLY)
        self.assertEqual(failure.exception.report['rootArtiLicense'], 'UNKNOWN')
        self.assertEqual(len(failure.exception.report['unknownDependencies']), 57)

    def test_candidate_stage_records_unknown_and_copies_exact_original_notices(self):
        with tempfile.TemporaryDirectory(prefix='notice-stage-', dir=SUPPLY.parent) as directory:
            app = Path(directory) / 'SyntheticResourceContainer.app'
            receipt = stage_supply('tor', self.files, app)
            self.assertEqual(receipt['licenseCoverage']['status'], 'UNKNOWN')
            self.assertFalse(receipt['licenseCoverage']['noticeCoverageComplete'])
            self.assertFalse(receipt['productionIsolationAdmitted'])
            root = app / 'Contents/Resources' / receipt['resourcePath']
            for name, expected in receipt['filesSHA256'].items():
                self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), expected)

    def test_missing_full_publisher_notice_is_rejected(self):
        files = dict(self.files)
        del files['LICENSES/Lyrebird-0.9.0-complete-publisher-notices.txt']
        with self.assertRaises(ValueError): gate.inspect_supply_license_materials(files)

    def test_mutated_notice_with_updated_intake_hash_still_rejected(self):
        files = dict(self.files)
        key = 'LICENSES/Go-1.22.12-LICENSE.txt'
        data, mode, _digest = files[key]
        data += b'\nchanged\n'
        files[key] = (data, mode, hashlib.sha256(data).hexdigest())
        with self.assertRaises(ValueError): gate.inspect_supply_license_materials(files)

    def test_self_consistent_replacement_ledger_cannot_claim_complete(self):
        files = dict(self.files)
        raw, mode, _digest = files[gate.COVERAGE_PATH]
        raw = raw.replace(b'"noticeCoverageComplete": false', b'"noticeCoverageComplete": true')
        files[gate.COVERAGE_PATH] = (raw, mode, hashlib.sha256(raw).hexdigest())
        with self.assertRaises(ValueError): gate.inspect_supply_license_materials(files)

    def test_unreviewed_added_notice_is_rejected(self):
        files = dict(self.files)
        data = b'new bytes do not establish reviewed provenance'
        files['LICENSES/unreviewed.txt'] = (data, 0o644, hashlib.sha256(data).hexdigest())
        with self.assertRaises(ValueError): gate.inspect_supply_license_materials(files)

    def test_ledger_cannot_be_reused_for_different_vendor(self):
        files = dict(self.files)
        data, mode, _digest = files['lyrebird']
        data = data[:-1] + bytes([data[-1] ^ 1])
        files['lyrebird'] = (data, mode, hashlib.sha256(data).hexdigest())
        with self.assertRaises(ValueError): gate.inspect_supply_license_materials(files)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: test_license_supply.py EXACT_OFFLINE_TOR_SUPPLY_DIRECTORY')
    SUPPLY = Path(sys.argv.pop(1))
    unittest.main()
