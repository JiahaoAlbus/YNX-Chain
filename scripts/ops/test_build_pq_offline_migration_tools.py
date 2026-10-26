#!/usr/bin/env python3
"""Hosted Linux/Go1.26.10 real-compiler regressions; no YNX runtime is executed."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


HELPER = Path(__file__).resolve().with_name('build-pq-offline-migration-tools.sh')


class OfflineMigrationToolsProducer(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ynx-offline-producer-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.repository = self.root / 'original repository'
        self.repository.mkdir(mode=0o700)
        self.environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        self.environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0',
                                CGO_ENABLED='0', GOOS='linux', GOARCH='amd64', GOAMD64='v1', GOENV='off',
                                GOFLAGS='', GOWORK='off', GOTOOLCHAIN='local', GOPROXY='off', GOSUMDB='off',
                                GITHUB_SHA='c' * 40, GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='2')
        self.git('init', '--quiet', '--template=')
        self.git('config', 'user.name', 'Synthetic public producer fixture')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        (self.repository / 'go.mod').write_text('module example.invalid/pq-offline-tools-fixture\n\ngo 1.26.10\n', encoding='ascii')
        for name in ('ynx-chaind', 'ynx-consensus-package'):
            directory = self.repository / 'cmd' / name
            directory.mkdir(parents=True)
            (directory / 'main.go').write_text('package main\nimport "fmt"\n'
                'var buildCommit = "unset"\nvar buildRelease = "unset"\n'
                'func main() { fmt.Printf("source-committed/' + name + ':%s:%s\\n", buildCommit, buildRelease) }\n', encoding='ascii')
        self.git('add', '--all')
        self.git('commit', '--quiet', '-m', 'Synthetic exact source object')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()

    def run_command(self, arguments, cwd=None, timeout=90, environment=None):
        return subprocess.run(arguments, cwd=cwd or self.repository, env=environment or self.environment, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)

    def git(self, *arguments, cwd=None):
        result = self.run_command(['git', *arguments], cwd)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf8', errors='replace'))
        return result.stdout.decode('utf8')

    def invoke(self, replacements=None, work=None, output=None, environment=None):
        values = {'--repository': str(self.repository), '--source-commit': self.commit, '--source-tree': self.tree,
                  '--work-directory': str(work or self.root / 'independent source'),
                  '--output-directory': str(output or self.root / 'public output')}
        values.update(replacements or {})
        return self.run_command(['bash', str(HELPER), *[part for item in values.items() for part in item]], timeout=150, environment=environment)

    def snapshot(self, directory):
        result = {}
        for path in sorted([directory, *directory.rglob('*')]):
            info = path.lstat()
            identity = (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
                        info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            # Reading may update atime. Every ownership/identity/write timestamp
            # and original byte, including the nested checkout, remains fenced.
            content = path.read_bytes() if stat.S_ISREG(info.st_mode) else None
            result[str(path.relative_to(directory))] = (identity, content)
        return result

    def read_go_info(self, path):
        result = self.run_command(['go', 'version', '-m', str(path)])
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf8', errors='replace'))
        raw = result.stdout.decode('utf8')
        settings = {}
        for line in raw.splitlines()[1:]:
            if line.startswith('\tbuild\t'):
                key, _, value = line[len('\tbuild\t'):].partition('=')
                settings[key] = json.loads(value) if value.startswith('"') else value
        return raw, settings

    def test_real_nested_checkout_dirty_before_clean_exact_source_after(self):
        # This is the actual old producer failure shape: the extra QA checkout
        # is inside the caller source, not ignored and not a replacement binary.
        nested = self.repository / 'qa-owned-performance-client'
        nested.mkdir(mode=0o700)
        self.git('init', '--quiet', '--template=', cwd=nested)
        self.git('config', 'user.name', 'Synthetic nested QA fixture', cwd=nested)
        self.git('config', 'user.email', 'qa@example.invalid', cwd=nested)
        (nested / 'public-source.txt').write_bytes(b'original nested public DATA\n')
        self.git('add', '--all', cwd=nested)
        self.git('commit', '--quiet', '-m', 'Original nested QA source', cwd=nested)
        baseline = self.root / 'old-dirty-baseline'
        built = self.run_command(['go', 'build', '-p', '1', '-trimpath', '-buildvcs=true', '-o', str(baseline), './cmd/ynx-chaind'])
        self.assertEqual(built.returncode, 0, built.stderr.decode('utf8', errors='replace'))
        _, old_settings = self.read_go_info(baseline)
        self.assertEqual(old_settings.get('vcs.revision'), self.commit)
        self.assertEqual(old_settings.get('vcs.modified'), 'true')

        # Also retain a dirty tracked program. The new producer must build the
        # selected Git object, never these current, superficially valid bytes.
        native = self.repository / 'cmd/ynx-chaind/main.go'
        native.write_bytes(native.read_bytes().replace(b'source-committed', b'dirty-tracked-must-survive'))
        (self.repository / 'untracked.UNKNOWN').write_bytes(b'original UNKNOWN public DATA\x00\xff')
        (nested / 'untracked.DATA').write_bytes(b'original nested dirty DATA')
        status_before = self.git('status', '--porcelain=v1', '--untracked-files=all')
        original = self.snapshot(self.repository)
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf8', errors='replace'))
        self.assertEqual(self.snapshot(self.repository), original)
        self.assertEqual(self.git('status', '--porcelain=v1', '--untracked-files=all'), status_before)
        output = self.root / 'public output'
        self.assertEqual(sorted(p.name for p in output.iterdir()), ['SOURCE.json', 'ynx-chaind', 'ynx-consensus-package'])
        source = (output / 'SOURCE.json').read_bytes()
        record = json.loads(source)
        self.assertEqual(record['version'], 'YNX-PQ-OFFLINE-MIGRATION-TOOLS/v2')
        self.assertEqual((record['commit'], record['tree']), (self.commit, self.tree))
        self.assertEqual(record['controllerCI'], {'commit': 'c' * 40, 'runId': '123', 'runAttempt': '2'})
        self.assertEqual(record['sourceBefore'], {'head': self.commit, 'tree': self.tree, 'status': ''})
        self.assertEqual(record['sourceAfter'], record['sourceBefore'])
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((output / 'SOURCE.json').stat().st_mode), 0o600)
        self.assertFalse(record['runtimeStarted'])
        self.assertFalse(record['deploymentReady'])
        self.assertFalse(record['authorityGranted'])
        self.assertFalse(record['executionReady'])
        for name in ('ynx-chaind', 'ynx-consensus-package'):
            path = output / name
            actual_raw, settings = self.read_go_info(path)
            self.assertEqual(record['binaries'][name]['goInfo']['raw'], actual_raw)
            self.assertEqual(record['binaries'][name]['goInfo']['settings'], settings)
            self.assertEqual(record['binaries'][name]['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(record['binaries'][name]['bytes'], path.stat().st_size)
            self.assertEqual(settings.get('vcs.revision'), self.commit)
            self.assertEqual(settings.get('vcs.modified'), 'false')
            self.assertEqual((settings.get('CGO_ENABLED'), settings.get('GOOS'), settings.get('GOARCH'), settings.get('-trimpath')), ('0', 'linux', 'amd64', 'true'))
            self.assertNotIn('-ldflags', settings)  # The fixed compiler's actual trimpath contract.
            # Only these tiny synthetic public fixture programs run in CI; no
            # YNX program, key, daemon, service, ledger or listener is executed.
            executed = self.run_command([str(path)])
            self.assertEqual(executed.returncode, 0, executed.stderr.decode('utf8', errors='replace'))
            expected = ('source-committed/' + name + ':' + self.commit + ':pq-offline-validation\n') if name == 'ynx-chaind' else 'source-committed/' + name + ':unset:unset\n'
            self.assertEqual(executed.stdout.decode('ascii'), expected)
        self.assertEqual(result.stdout, b'YNX_PQ_OFFLINE_MIGRATION_SOURCE ' + source +
                         ('YNX_PQ_OFFLINE_MIGRATION_SOURCE_PIN bytes=' + str(len(source)) + ' sha256=' + hashlib.sha256(source).hexdigest() + '\n').encode('ascii'))
        self.assertEqual(self.git('status', '--porcelain=v1', '--untracked-files=all', cwd=self.root / 'independent source'), '')
        print('PQ_OFFLINE_MIGRATION_CLEAN_SOURCE_REAL_GO_FIXTURE_PASS')

    def test_bad_commit_wrong_tree_and_existing_unknown_refuse_before_build(self):
        for name, replacement in [('short', {'--source-commit': self.commit[:12]}),
                                  ('uppercase', {'--source-commit': 'A' + self.commit[1:]}),
                                  ('wrong-tree', {'--source-tree': 'f' * 40})]:
            with self.subTest(name=name):
                original = self.snapshot(self.repository)
                result = self.invoke(replacement)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / 'independent source').exists())
                self.assertFalse((self.root / 'public output').exists())
                self.assertEqual(self.snapshot(self.repository), original)
        output = self.root / 'public output'
        output.mkdir(mode=0o700)
        (output / 'UNKNOWN').write_bytes(b'original partial evidence')
        original = self.snapshot(output)
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'refusing reuse', result.stderr)
        self.assertFalse((self.root / 'independent source').exists())
        self.assertEqual(self.snapshot(output), original)

    def test_real_later_compile_failure_retains_partial_and_refuses_reentry(self):
        broken = self.repository / 'cmd/ynx-consensus-package/main.go'
        broken.write_text('package main\nfunc main() { syntax error }\n', encoding='ascii')
        self.git('add', '--all')
        self.git('commit', '--quiet', '-m', 'Synthetic real later compile failure')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'syntax error', result.stderr)
        self.assertIn(b'producer command failed: go', result.stderr)
        output = self.root / 'public output'
        self.assertTrue((output / 'ynx-chaind').is_file())
        self.assertFalse((output / 'SOURCE.json').exists())
        retained = self.snapshot(output)
        second = self.invoke()
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual(self.snapshot(output), retained)
        self.assertIn(b'refusing reuse', second.stderr)

    def test_metadata_injection_negative_only_rejects_real_compiler_readback_changes(self):
        # This is rejection-only fault injection. The wrapper runs the actual
        # compiler and obtains its real -m output, then changes one public field.
        # No injected output supplies the successful clean-source evidence above.
        real_go = str(Path(shutil.which('go')).resolve(strict=True))
        for name, old, new, first_cause in (
            ('modified', b'\tbuild\tvcs.modified=false\n', b'\tbuild\tvcs.modified=true\n', b'actual ELF build setting mismatch: ynx-chaind:vcs.modified'),
            ('revision', ('\tbuild\tvcs.revision=' + self.commit + '\n').encode('ascii'), b'', b'actual ELF build setting mismatch: ynx-chaind:vcs.revision'),
            ('ldflags', b'\tbuild\t-trimpath=true\n', b'\tbuild\t-trimpath=true\n\tbuild\t-ldflags=forged\n', b'unexpected ldflags metadata under fixed trimpath toolchain'),
        ):
            with self.subTest(injected_field=name):
                wrapper = self.root / ('metadata-injection-only-' + name)
                wrapper.mkdir(mode=0o700)
                program = wrapper / 'go'
                program.write_text('#!' + sys.executable + '\n'
                    'import subprocess, sys\n'
                    'result = subprocess.run([' + repr(real_go) + ', *sys.argv[1:]], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)\n'
                    'raw = result.stdout\n'
                    'if result.returncode == 0 and sys.argv[1:3] == ["version", "-m"]:\n'
                    '    old, new = ' + repr(old) + ', ' + repr(new) + '\n'
                    '    if raw.count(old) != 1: sys.exit(93)\n'
                    '    raw = raw.replace(old, new, 1)\n'
                    'sys.stdout.buffer.write(raw)\n'
                    'sys.stderr.buffer.write(result.stderr)\n'
                    'sys.exit(result.returncode)\n', encoding='utf8')
                program.chmod(0o700)
                environment = dict(self.environment, PATH=str(wrapper) + os.pathsep + self.environment['PATH'])
                output, work = self.root / ('rejected-output-' + name), self.root / ('rejected-source-' + name)
                original = self.snapshot(self.repository)
                result = self.invoke(work=work, output=output, environment=environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(first_cause, result.stderr)
                self.assertFalse((output / 'SOURCE.json').exists())
                self.assertEqual(self.snapshot(self.repository), original)
                # Independently inspect the produced ELF via the unwrapped
                # real tool. Only the injected observation was inconsistent.
                _, actual = self.read_go_info(output / 'ynx-chaind')
                self.assertEqual(actual.get('vcs.modified'), 'false')
                self.assertEqual(actual.get('vcs.revision'), self.commit)
                self.assertNotIn('-ldflags', actual)
                print('PQ_OFFLINE_MIGRATION_METADATA_INJECTION_REJECTED field=' + name)


if __name__ == '__main__':
    unittest.main()
