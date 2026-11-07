#!/usr/bin/env python3
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collect_pq_light_source_tests.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LightSourceCollectorTests(unittest.TestCase):
    def events(self):
        out = []
        for pkg, tests in module.REQUIRED.items():
            out += [{'Action': 'build-output', 'ImportPath': pkg + '.test', 'Output': 'compiler diagnostic\n'}, {'Action': 'start', 'Package': pkg}]
            for test in sorted(tests):
                for name in (test, test + '/control'):
                    out += [{'Action': 'run', 'Package': pkg, 'Test': name}, {'Action': 'pass', 'Package': pkg, 'Test': name}]
            out.append({'Action': 'pass', 'Package': pkg})
        return out

    def parse(self, events):
        return module.collect('\n'.join(map(json.dumps, events)))

    def test_exact_three_packages_four_tops(self):
        self.assertEqual(self.parse(self.events())['requiredTopCount'], 4)

    def test_missing_duplicate_and_child_failure(self):
        base = self.events()
        mutations = [base[:1] + base[2:], base[:-1], base + [base[-1]], [x for x in base if x.get('Test') not in next(iter(module.REQUIRED.values()))]]
        for action in ('fail', 'skip', 'build-fail'):
            bad = copy.deepcopy(base)
            bad[3]['Action'] = action
            mutations.append(bad)
        for bad in mutations:
            with self.subTest(case=mutations.index(bad)), self.assertRaises((ValueError, KeyError)):
                self.parse(bad)

    def test_build_diagnostics_closed_prefix(self):
        base = self.events()
        for patch in ({'Package': next(iter(module.REQUIRED))}, {'ImportPath': 'foreign.test'}, {'ImportPath': next(iter(module.REQUIRED))}, {'Output': ''}, {'Output': 1}, {'extra': True}, {'Action': 'build-fail'}):
            bad = copy.deepcopy(base)
            bad[0].update(patch)
            with self.subTest(patch=patch), self.assertRaises((ValueError, KeyError)):
                self.parse(bad)
        bad = base[1:3] + [base[0]] + base[3:]
        with self.assertRaises(ValueError):
            self.parse(bad)

    def test_no_foreign_test_or_package(self):
        for key, value in (('Package', 'foreign'), ('Test', 'TestForeign/control')):
            bad = self.events()
            bad[2][key] = value
            with self.assertRaises(ValueError):
                self.parse(bad)


if __name__ == '__main__':
    unittest.main()
