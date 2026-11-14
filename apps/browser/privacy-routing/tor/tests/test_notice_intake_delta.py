"""Only the new five-package/seven-file intake; no fetch, stage, sign or vendor run."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

TOR = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


gate = module('fixed_notice_gate', TOR / 'license_supply.py')
intake = module('fixed_notice_intake', TOR / 'notice_intake.py')
sys.path.insert(0, str(TOR.parents[1] / 'scripts'))
from privacy_backend_supply import read_supply


class SupplementedNoticeDelta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = read_supply('tor', SUPPLY)
        cls.report = json.loads((CANDIDATE / 'NOTICE-INTAKE.json').read_bytes())
        cls.new = dict(cls.old)
        for relative in [gate.COVERAGE_PATH] + [item['destinationRelative'] for item in cls.report['appendRecipe']]:
            data = (CANDIDATE / relative).read_bytes()
            cls.new[relative] = (data, 0o644, hashlib.sha256(data).hexdigest())

    def test_new_exact_materials_cover_only_five_selected_packages(self):
        result = gate.inspect_supply_license_materials(self.new)
        self.assertEqual(result['coverageSHA256'], gate.SUPPLEMENTED_COVERAGE_SHA256)
        self.assertEqual(result['dependenciesWithNoticeBytes'], 379)
        self.assertEqual(len(result['unknownDependencies']), 52)
        self.assertEqual(self.report['newOriginalFiles'], 7)
        self.assertEqual(len(self.report['proofs']), 7)
        ledger = json.loads(self.new[gate.COVERAGE_PATH][0])
        covered = [p for p in ledger['arti']['closure']['packages'] if (p['name'], p['version']) in intake.REVIEWED]
        self.assertEqual(len(covered), 5)
        for package in covered:
            self.assertEqual(package['status'], 'BYTES_PRESENT')
            self.assertTrue(package['noticeFiles'])

    def test_new_exact_revision_remains_strictly_unreleased(self):
        with self.assertRaises(gate.LicenseCoverageUnavailable) as failure:
            gate.require_release_license_coverage(self.new)
        report = failure.exception.report
        self.assertEqual(report['rootArtiLicense'], 'UNKNOWN')
        self.assertEqual(len(report['unknownDependencies']), 52)
        self.assertFalse(report['productionIsolationAdmitted'])
        self.assertFalse(report['noticeCoverageComplete'])

    def test_old_supply_cannot_inherit_new_coverage_or_materials(self):
        report = gate.inspect_supply_license_materials(self.old)
        self.assertEqual(report['coverageSHA256'], gate.COVERAGE_SHA256)
        self.assertEqual(len(report['unknownDependencies']), 57)
        with self.assertRaises(gate.LicenseCoverageUnavailable):
            gate.require_release_license_coverage(self.old)
        mixed = dict(self.old)
        mixed[gate.COVERAGE_PATH] = self.new[gate.COVERAGE_PATH]
        with self.assertRaises(ValueError):
            gate.inspect_supply_license_materials(mixed)

    def test_modified_supplement_cannot_be_self_hash_admitted(self):
        files = dict(self.new)
        key = self.report['appendRecipe'][0]['destinationRelative']
        raw, mode, _ = files[key]
        raw += b'\nnot the original notice\n'
        files[key] = (raw, mode, hashlib.sha256(raw).hexdigest())
        with self.assertRaises(ValueError):
            gate.inspect_supply_license_materials(files)

    def test_incomplete_new_notice_set_is_rejected(self):
        files = dict(self.new)
        del files[self.report['appendRecipe'][-1]['destinationRelative']]
        with self.assertRaises(ValueError):
            gate.inspect_supply_license_materials(files)

    def test_wrong_primary_commit_receipt_is_not_notice_evidence(self):
        receipts = []
        for name in ['FETCH.json', 'FETCH-ADDITIONAL.json']:
            receipts += json.loads((CANDIDATE.parent / name).read_bytes())
        for item in receipts:
            if item.get('status') == 200:
                item['url'] = item['url'].replace('/872842c3d151296b18314dfa5bf86548c2ce4f29/', '/main/')
        with self.assertRaises(ValueError):
            intake.prepare(self.old[gate.COVERAGE_PATH][0], CACHE, CANDIDATE.parent / 'fetched', receipts)

    def test_original_cached_spdx_named_files_not_missed(self):
        package = next(p for p in json.loads(self.new[gate.COVERAGE_PATH][0])['arti']['closure']['packages'] if p['name'] == 'priority-queue')
        self.assertTrue(any('LGPL-3.0-or-later.txt' in ref for ref in package['noticeFiles']))
        self.assertTrue(any('MPL-2.0.txt' in ref for ref in package['noticeFiles']))
        for proof in self.report['proofs']:
            if proof['package'] == 'priority-queue':
                self.assertEqual(proof['origin']['type'], 'original-file-in-lock-checksum-verified-crate')


if __name__ == '__main__':
    if len(sys.argv) < 4:
        raise SystemExit('usage: test_notice_intake_delta.py ORIGINAL_TOR_SUPPLY NEW_CANDIDATE LOCKED_CRATE_CACHE')
    SUPPLY, CANDIDATE, CACHE = map(Path, sys.argv[1:4])
    del sys.argv[1:4]
    unittest.main()
