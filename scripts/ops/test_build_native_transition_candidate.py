#!/usr/bin/env python3
"""Hosted real-compiler producer controls. Only tiny public fixture ELFs run."""
import hashlib
import json
from pathlib import Path
import unittest

import test_build_pq_offline_migration_tools as original


HELPER = Path(__file__).resolve().with_name('build-native-transition-candidate.sh')


class NativeTransitionCandidate(unittest.TestCase):
    def setUp(self):
        self.fixture = original.OfflineMigrationToolsProducer()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.program = self.fixture.repository / 'cmd/ynx-chaind/main.go'
        self.program.write_text('''package main
import("encoding/json";"os")
var buildCommit="unset"
var buildRelease="unset"
var buildTime="unset"
func main(){if len(os.Args)<2||os.Args[1]!="--build-info"{os.Exit(93)};json.NewEncoder(os.Stdout).Encode(map[string]string{"commit":buildCommit,"release":buildRelease,"buildTime":buildTime})}
''', encoding='ascii')
        self.commit_source('Synthetic public native informational exit')

    def commit_source(self, message):
        f = self.fixture
        f.git('add', '--all')
        f.git('commit', '--quiet', '-m', message)
        self.commit = f.git('rev-parse', 'HEAD').strip()
        self.tree = f.git('rev-parse', 'HEAD^{tree}').strip()
        f.environment['GITHUB_SHA'] = self.commit

    def invoke(self):
        f = self.fixture
        return f.run_command(['bash', str(HELPER), '--source-directory', str(f.repository),
                              '--source-commit', self.commit, '--source-tree', self.tree,
                              '--output-directory', str(f.root / 'native output')], timeout=150)

    def test_real_same_source_build_identity_and_distinct_purpose(self):
        f = self.fixture
        original_source = f.snapshot(f.repository)
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf8', errors='replace'))
        self.assertEqual(f.snapshot(f.repository), original_source)
        output = f.root / 'native output'
        self.assertEqual(sorted(p.name for p in output.iterdir()), ['SOURCE.json', 'ynx-chaind'])
        raw = (output / 'SOURCE.json').read_bytes()
        record = json.loads(raw)
        self.assertEqual(record['version'], 'YNX-NATIVE-TRANSITION-CANDIDATE/v1')
        self.assertEqual((record['commit'], record['tree']), (self.commit, self.tree))
        self.assertEqual(record['sourceBefore'], {'head': self.commit, 'tree': self.tree, 'status': ''})
        self.assertEqual(record['sourceBefore'], record['sourceAfter'])
        self.assertEqual(record['buildIdentity']['release'], 'ynx-native-transition-' + self.commit[:12])
        self.assertEqual(json.loads(record['buildIdentityReadback']['raw']), record['buildIdentity'])
        self.assertTrue(record['informationalExitExecuted'])
        for field in ('runtimeStarted', 'publicDeployment', 'pqActivation', 'authorityGranted', 'deploymentReady'):
            self.assertFalse(record[field])
        binary = output / 'ynx-chaind'
        info, settings = f.read_go_info(binary)
        self.assertEqual(record['binaries']['ynx-chaind']['goInfo']['raw'], info)
        self.assertEqual(record['binaries']['ynx-chaind']['sha256'], hashlib.sha256(binary.read_bytes()).hexdigest())
        self.assertEqual(settings['vcs.modified'], 'false')
        self.assertEqual(settings['vcs.revision'], self.commit)
        retained = f.snapshot(output)
        repeat = self.invoke()
        self.assertNotEqual(repeat.returncode, 0)
        self.assertIn(b'refusing reuse', repeat.stderr)
        self.assertEqual(f.snapshot(output), retained)

    def test_dirty_source_refuses_without_any_output(self):
        f = self.fixture
        self.program.write_bytes(self.program.read_bytes() + b'\n// original dirty must survive\n')
        retained = f.snapshot(f.repository)
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'native source must remain exact and clean', result.stderr)
        self.assertEqual(f.snapshot(f.repository), retained)
        self.assertFalse((f.root / 'native output').exists())

    def test_wrong_actual_elf_identity_retains_binary_without_source_record(self):
        f = self.fixture
        self.program.write_bytes(self.program.read_bytes().replace(b'"release":buildRelease', b'"release":"foreign-release"'))
        self.commit_source('Synthetic exact binary reports wrong actual native identity')
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'actual normal native informational exit differs', result.stderr)
        output = f.root / 'native output'
        self.assertTrue((output / 'ynx-chaind').is_file())
        self.assertFalse((output / 'SOURCE.json').exists())
        retained = f.snapshot(output)
        repeat = self.invoke()
        self.assertNotEqual(repeat.returncode, 0)
        self.assertEqual(f.snapshot(output), retained)


if __name__ == '__main__':
    unittest.main()
