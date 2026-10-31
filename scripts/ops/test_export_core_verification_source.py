#!/usr/bin/env python3
"""Controls for the frozen-source exporter; no cryptography or private keys."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name('export-core-verification-source.py')
SPEC = importlib.util.spec_from_file_location('core_verification_export', SCRIPT)
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


def modules():
    return {path: dict(Path=path, Version=version, Sum='h1:' + 'A' * 43 + '=',
                       GoModSum='h1:' + 'B' * 43 + '=', GoVersion='1.26.0', Dir='/unused/' + path)
            for path, version in exporter.EXPECTED_MODULES.items()}


def graph():
    rows = [dict(ImportPath=exporter.MODULE + '/' + package, Module=dict(Path=exporter.MODULE),
                 Imports=['github.com/cloudflare/circl/sign/mldsa/mldsa87', 'golang.org/x/net/idna'])
            for package in exporter.BOOTSTRAP]
    rows += [dict(ImportPath=path + '/test-only-control', Module=row) for path, row in modules().items()]
    rows.append(dict(ImportPath='bytes', Standard=True))
    return rows


class FrozenVerificationSourceControls(unittest.TestCase):
    def test_fixed_source_identity_and_minimum_toolchain(self):
        self.assertEqual(exporter.REF, 'fdc08527514587d5756264e43ab63588791e189a')
        self.assertEqual(exporter.MIN_GO, '1.26.10')
        self.assertEqual(exporter.MODULE, 'github.com/JiahaoAlbus/YNX-Chain')
        self.assertEqual(exporter.EXPECTED_MODULES['github.com/cloudflare/circl'], 'v1.6.5')

    def test_canonical_source_paths_reject_escape_and_controls(self):
        self.assertEqual(exporter.safe_path('internal/ynxbatch/verify.go'), 'internal/ynxbatch/verify.go')
        for value in ('', '/root', '../root', 'a/../root', './a', 'a//b', 'a/', 'a\\b', 'a\n.go', 'a\x7f.go', None):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                exporter.safe_path(value)

    def test_exclusive_source_write_preserves_existing_bytes_and_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = exporter.write_new(root, 'source/verify.go', b'original')
            before = path.stat()
            with self.assertRaises(FileExistsError):
                exporter.write_new(root, 'source/verify.go', b'replacement')
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual((path.stat().st_ino, path.stat().st_mtime_ns), (before.st_ino, before.st_mtime_ns))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            link = root / 'link.go'
            link.symlink_to(path)
            with self.assertRaises(FileExistsError):
                exporter.write_new(root, 'link.go', b'cannot replace target')
            self.assertEqual(path.read_bytes(), b'original')

    def test_git_tree_requires_unique_canonical_actual_blob_identity(self):
        raw = b'100644 blob ' + b'a' * 40 + b'\tinternal/ynxbatch/verify.go\0'
        self.assertEqual(exporter.parse_tree(raw)['internal/ynxbatch/verify.go']['gitBlob'], 'a' * 40)
        for bad in (raw + raw, raw.replace(b'internal/ynxbatch/verify.go', b'../outside'), raw.replace(b'a' * 40, b'not-a-blob')):
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                exporter.parse_tree(bad)

    def test_snapshot_reads_only_exact_frozen_git_object_and_checks_blob(self):
        raw = b'package ynxbatch\n'
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        snapshot = object.__new__(exporter.Snapshot)
        snapshot.repository = Path('/unused-repository')
        snapshot.entries = {'internal/ynxbatch/verify.go': dict(mode='100644', kind='blob', gitBlob=blob)}
        with mock.patch.object(exporter, 'command', return_value=raw) as called:
            self.assertEqual(snapshot.read('internal/ynxbatch/verify.go'), raw)
            called.assert_called_once_with(['git', 'show', exporter.REF + ':internal/ynxbatch/verify.go'], snapshot.repository)
        with mock.patch.object(exporter, 'command', return_value=raw + b'changed'):
            with self.assertRaisesRegex(RuntimeError, 'blob bytes mismatch'):
                snapshot.read('internal/ynxbatch/verify.go')
        snapshot.entries['internal/ynxbatch/verify.go']['mode'] = '120000'
        with mock.patch.object(exporter, 'command') as called:
            with self.assertRaisesRegex(RuntimeError, 'regular frozen Git blob'):
                snapshot.read('internal/ynxbatch/verify.go')
            called.assert_not_called()

    def test_full_package_production_selection_keeps_assembly_and_headers(self):
        snapshot = object.__new__(exporter.Snapshot)
        snapshot.entries = dict.fromkeys(['internal/ynxbatch/verify.go', 'internal/ynxbatch/platform_arm64.s',
                                         'internal/ynxbatch/export.h', 'internal/ynxbatch/verify_test.go',
                                         'internal/ynxbatch/_ignored.go', 'internal/ynxbatch/.hidden.go',
                                         'internal/ynxbatch/nested/wrong.go', 'internal/accountaddress/address.go'])
        self.assertEqual(snapshot.production('internal/ynxbatch'), ['internal/ynxbatch/export.h',
                         'internal/ynxbatch/platform_arm64.s', 'internal/ynxbatch/verify.go'])

    def test_actual_module_closure_requires_full_local_and_external_graph(self):
        selected, packages, direct = exporter.selected_modules(graph())
        self.assertEqual(set(selected), set(exporter.EXPECTED_MODULES))
        self.assertEqual(set(packages), set(exporter.BOOTSTRAP))
        self.assertEqual(direct, {'github.com/cloudflare/circl', 'golang.org/x/net'})
        for index in (0, 2):
            rows = graph()
            rows.pop(index)
            with self.assertRaises(RuntimeError):
                exporter.selected_modules(rows)

    def test_changed_version_relative_replace_and_resolution_errors_rejected(self):
        for mutate in (lambda row: row['Module'].update(Version='v0.0.0'),
                       lambda row: row['Module'].update(Replace=dict(Dir='../fork')),
                       lambda row: row.update(Error=dict(Err='missing dependency')),
                       lambda row: row.update(DepsErrors=[dict(Err='incomplete')])):
            rows = graph()
            mutate(rows[2])
            with self.assertRaises(RuntimeError):
                exporter.selected_modules(rows)

    def test_minimum_require_fragment_is_not_whole_root_or_replacement(self):
        fragment = exporter.require_fragment(modules(), {'github.com/cloudflare/circl', 'golang.org/x/net'}).decode()
        self.assertTrue(fragment.startswith('go 1.26.10\n'))
        self.assertEqual(fragment.count('// indirect'), 3)
        self.assertIn('github.com/cloudflare/circl v1.6.5\n', fragment)
        self.assertIn('golang.org/x/net v0.60.0\n', fragment)
        self.assertNotIn('replace', fragment)
        self.assertNotIn('cometbft', fragment)
        self.assertNotIn('module ', fragment)

    def test_exact_sum_fragment_preserves_original_frozen_ten_lines(self):
        selected = modules()
        rows = []
        for path, row in selected.items():
            rows.extend([path + ' ' + row['Version'] + ' ' + row['Sum'], path + ' ' + row['Version'] + '/go.mod ' + row['GoModSum']])
        raw = ('\n'.join(rows) + '\n').encode()
        result = exporter.sum_fragment(raw, selected)
        self.assertEqual(len(result.splitlines()), 10)
        self.assertEqual(set(result.splitlines()), set(raw.splitlines()))
        for bad in (b'\n'.join(raw.splitlines()[1:]) + b'\n', raw + rows[0].encode() + b'\n', raw.replace(b'h1:' + b'A' * 43, b'h1:' + b'C' * 43, 1)):
            with self.assertRaises(RuntimeError):
                exporter.sum_fragment(bad, selected)

    def test_actual_api_smoke_references_generation_without_invoking_it(self):
        sources = {'file.go': b'func KeyGen() {}\nfunc NewVerifier() {}\nfunc (v *Verifier) VerifyOne() {}\nfunc hidden() {}\n'}
        functions = exporter.exported_functions(sources)
        methods = exporter.exported_methods(sources)
        self.assertEqual(functions, ['KeyGen', 'NewVerifier'])
        self.assertEqual(methods, [('Verifier', 'VerifyOne')])
        smoke = exporter.api_smoke(functions, methods).decode()
        self.assertIn('var _ = batch.KeyGen\n', smoke)
        self.assertIn('var _ = (*batch.Verifier).VerifyOne', smoke)
        self.assertNotIn('batch.KeyGen(', smoke)
        self.assertIn('v.VerifyOne([]byte{0},0)', smoke)

    def test_module_proxy_case_encoding_and_go_environment_remain_normal(self):
        self.assertEqual(exporter.module_escape(exporter.MODULE), 'github.com/!jiahao!albus/!y!n!x-!chain')
        with mock.patch.dict(exporter.os.environ, {'GOOS': 'hostile', 'GOARCH': 'hostile', 'GOPRIVATE': '*'}, clear=False):
            native = exporter.go_environment()
            target = exporter.go_environment(('linux', 'amd64'))
        self.assertNotIn('GOOS', native)
        self.assertNotIn('GOARCH', native)
        self.assertEqual(native['GOWORK'], 'off')
        self.assertEqual(native['GOPRIVATE'], '')
        self.assertEqual(native['GOSUMDB'], 'sum.golang.org')
        self.assertEqual((target['GOOS'], target['GOARCH']), ('linux', 'amd64'))

    def test_default_cli_never_exports_without_explicit_paths(self):
        with mock.patch('sys.argv', [str(SCRIPT)]), mock.patch.object(exporter, 'export') as call:
            with self.assertRaises(SystemExit) as failure:
                exporter.main()
            self.assertEqual(failure.exception.code, 2)
            call.assert_not_called()

    def test_securelink_profile_is_fixed_latest_media_source(self):
        self.assertEqual(exporter.SECURELINK_REF, '07101a583caddef5e07b0ddfc0569cc015ae6345')
        self.assertEqual(exporter.SECURELINK_PACKAGES, ('internal/securelink', 'internal/securelink/native'))
        self.assertEqual(exporter.SECURELINK_MODULES, {'golang.org/x/sys': 'v0.48.0'})
        with mock.patch.object(exporter, 'command') as call:
            with self.assertRaisesRegex(RuntimeError, 'fixed original source profile'):
                exporter.Snapshot(Path('/unused'), '0' * 40)
            call.assert_not_called()

    def test_securelink_full_native_and_platform_dependency_closure(self):
        local = [dict(ImportPath=exporter.MODULE + '/' + name, Module=dict(Path=exporter.MODULE),
                      Imports=['golang.org/x/sys/unix']) for name in exporter.SECURELINK_PACKAGES]
        external = dict(ImportPath='golang.org/x/sys/unix', Module=modules()['golang.org/x/sys'])
        selected, direct = exporter.securelink_selection(local + [external])
        self.assertEqual(set(selected), {'golang.org/x/sys'})
        self.assertEqual(direct, {'golang.org/x/sys'})
        selected, direct = exporter.securelink_selection(local)
        self.assertEqual((selected, direct), ({}, set()))  # Unsupported IPC target needs no x/sys.
        with self.assertRaisesRegex(RuntimeError, 'full securelink/native'):
            exporter.securelink_selection(local[:1] + [external])

    def test_securelink_rejects_other_crypto_graph_replace_and_changed_version(self):
        local = [dict(ImportPath=exporter.MODULE + '/' + name, Module=dict(Path=exporter.MODULE)) for name in exporter.SECURELINK_PACKAGES]
        for path, mutate in (('golang.org/x/sys', lambda row: row.update(Version='v0.47.0')),
                             ('golang.org/x/sys', lambda row: row.update(Replace={'Dir': '/other/root'})),
                             ('github.com/cloudflare/circl', lambda row: None)):
            module = modules()[path]
            mutate(module)
            with self.assertRaises(RuntimeError):
                exporter.securelink_selection(local + [dict(ImportPath=path + '/control', Module=module)])

    def test_securelink_minimum_graph_preserves_only_two_original_sum_lines(self):
        selected = {'golang.org/x/sys': modules()['golang.org/x/sys']}
        row = selected['golang.org/x/sys']
        original = ('golang.org/x/sys ' + row['Version'] + ' ' + row['Sum'] + '\n' +
                    'golang.org/x/sys ' + row['Version'] + '/go.mod ' + row['GoModSum'] + '\n').encode()
        self.assertEqual(exporter.sum_fragment(original, selected), original)
        required = exporter.require_fragment(selected, {'golang.org/x/sys'}).decode()
        self.assertIn('golang.org/x/sys v0.48.0\n', required)
        self.assertNotIn('indirect', required)
        self.assertNotIn('circl', required)

    def test_securelink_api_uses_both_original_packages_and_fails_closed(self):
        files = {'internal/securelink/protected_client.go': b'func NewFixedPeerClient() {}\nfunc (c *FixedPeerClient) Exchange() {}\n',
                 'internal/securelink/native/openssl.go': b'func NewContext() {}\nfunc (c *Conn) Snapshot() {}\n'}
        smoke, catalog = exporter.securelink_smoke(files)
        self.assertEqual(set(smoke), {'api_test.go', 'unavailable_test.go', 'native_test.go'})
        self.assertEqual(set(catalog), set(exporter.SECURELINK_PACKAGES))
        self.assertIn(b'var _ = (*link.FixedPeerClient).Exchange', smoke['api_test.go'])
        self.assertIn(b'var _ = (*native.Conn).Snapshot', smoke['api_test.go'])
        self.assertIn(b'//go:build !securelink_openssl || !cgo', smoke['unavailable_test.go'])
        self.assertIn(b'errors.Is(err,native.ErrUnavailable)', smoke['unavailable_test.go'])
        self.assertIn(b'//go:build securelink_openssl && cgo', smoke['native_test.go'])
        self.assertIn(b'wrong-operation', smoke['api_test.go'])
        self.assertIn(b'oversize', smoke['api_test.go'])
        self.assertNotIn(b'.Exchange(', b'\n'.join(smoke.values()))

    def test_securelink_native_absence_never_builds_or_fakes_tls(self):
        with mock.patch.object(exporter.os, 'uname', return_value=mock.Mock(sysname='Linux', machine='x86_64')), \
             mock.patch.object(exporter, 'command') as call:
            env, result = exporter.securelink_native_environment()
        self.assertIsNone(env)
        self.assertFalse(result['available'])
        self.assertFalse(result['actualNativeAPICompile'])
        self.assertFalse(result['actualTLSRerun'])
        call.assert_not_called()

    def test_cli_securelink_dispatch_cannot_override_commit_or_native_provider(self):
        arguments = [str(SCRIPT), '--profile', 'securelink', '--repository', '/repo', '--output', '/fresh']
        with mock.patch('sys.argv', arguments), mock.patch.object(exporter, 'export_securelink') as secure, \
             mock.patch.object(exporter, 'export') as batch:
            exporter.main()
        secure.assert_called_once_with(Path('/repo'), Path('/fresh'))
        batch.assert_not_called()
        for extra in (['--ref', '0' * 40], ['--provider', '/arbitrary'], ['--profile', 'native-test-only']):
            with mock.patch('sys.argv', arguments + extra), mock.patch.object(exporter, 'export_securelink') as secure:
                with self.assertRaises(SystemExit):
                    exporter.main()
                secure.assert_not_called()


if __name__ == '__main__':
    unittest.main()
