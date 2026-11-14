"""Offline package-input refusals, not deployed proof or route acceptance."""
import hashlib
import importlib.util
import os
import plistlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('nym_proof_package', SCRIPTS / 'package-macos-native.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
PIN = hashlib.sha256(b'YNX controlled package-input test bytes\n').hexdigest()


class NormalProviderPinIntakeTests(unittest.TestCase):
    """Negative artifact intake only: no reviewed Team, provider authority or route is created."""
    def test_missing_provider_does_not_invent_a_pin(self):
        self.assertIsNone(packager.validate_route_filter_provider(None, None, None))

    def test_both_inputs_and_exact_pin_are_required(self):
        for provider, pin in [(None, PIN), (Path('/not-read'), None),
                              (Path('/not-read'), PIN.upper()), (Path('/not-read'), PIN + '\n')]:
            with self.subTest(provider=provider, pin=pin), self.assertRaises(ValueError):
                packager.validate_route_filter_provider(provider, pin, None)

    def test_missing_reviewed_team_refuses_before_filesystem_or_signer(self):
        with mock.patch.object(Path, 'resolve', side_effect=AssertionError('Filesystem reached')):
            for team in [None, '', 'NOT_CONFIGURED', 'x' * 10, 'FAKE000001\n']:
                with self.subTest(team=team), self.assertRaisesRegex(ValueError, 'source template reviewed Team'):
                    packager.validate_route_filter_provider(Path('/not-read'), PIN, team)

    def test_symlink_provider_is_refused(self):
        with tempfile.TemporaryDirectory() as name:
            actual = Path(name).resolve() / 'actual.systemextension'
            actual.mkdir()
            alias = actual.with_name('alias.systemextension')
            alias.symlink_to(actual, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlink ancestors'):
                packager.validate_route_filter_provider(alias, PIN, 'FAKE000001')

    def test_actual_codesign_rejects_generated_unsigned_provider(self):
        if sys.platform != 'darwin':
            self.skipTest('Actual macOS codesign refusal requires macOS')
        with tempfile.TemporaryDirectory() as name:
            provider = Path(name).resolve() / 'generated.systemextension'
            executable = provider / 'Contents/MacOS/YNXPrivacyFilter'
            executable.parent.mkdir(parents=True)
            body = b'Generated inert unsigned artifact; never executed.\n'
            executable.write_bytes(body)
            executable.chmod(0o700)
            info = dict(CFBundleIdentifier='com.ynxweb4.browser.routefilter.provider',
                        CFBundleExecutable='YNXPrivacyFilter', CFBundlePackageType='SYSX',
                        YNXReviewedTeamIdentifier='FAKE000001')
            (provider / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            with self.assertRaises(subprocess.CalledProcessError) as refused:
                packager.validate_route_filter_provider(provider, hashlib.sha256(body).hexdigest(), 'FAKE000001')
            self.assertNotEqual(refused.exception.returncode, 0)

    def test_provider_cli_refuses_before_any_build(self):
        inputs = [
            ['--route-filter-provider'],
            ['--route-filter-provider', '/not-read.systemextension'],
            ['--route-filter-provider-sha256', PIN],
            ['--route-filter-provider', '/not-read.systemextension', '--route-filter-provider-sha256', PIN],
            ['--route-filter-provider', '/one', '--route-filter-provider', '/two'],
            ['--route-filter-provider-sha256', PIN, '--route-filter-provider-sha256', PIN],
        ]
        for arguments in inputs:
            with self.subTest(arguments=arguments):
                result = NymProofBuildEntrypointTests().run_preflight(arguments)
                self.assertEqual(result.returncode, 64, result.stderr)

    def test_absent_provider_preserves_existing_source_gate_entry(self):
        result = NymProofBuildEntrypointTests().run_preflight([])
        self.assertEqual(result.returncode, 91, result.stderr)


class NymProofPackageConfigurationTests(unittest.TestCase):
    def test_absent_configuration_remains_absent(self):
        self.assertIsNone(packager.validate_nym_proof_configuration(None, None))

    def test_pair_and_exact_pin_are_required(self):
        for origin, pin in [('https://proof.example.org', None), (None, PIN),
                            ('https://proof.example.org', PIN.upper()),
                            ('https://proof.example.org', 'f' * 63),
                            ('https://proof.example.org', PIN + '\n')]:
            with self.subTest(origin=origin, pin=pin):
                with self.assertRaises(ValueError):
                    packager.validate_nym_proof_configuration(origin, pin)

    def test_only_public_https_origin_shape_is_accepted(self):
        rejected = ['http://proof.example.org', 'file:///tmp/proof',
                    'https://user:password@proof.example.org', 'https://@proof.example.org',
                    'https://proof.example.org/path', 'https://proof.example.org/?',
                    'https://proof.example.org/#', 'https://proof.example.org:8443', 'https://proof.example.org:not-a-port',
                    'https://127.0.0.1', 'https://[::1]', 'https://localhost',
                    'https://proof.local', 'https://proof.test', 'https://proof.invalid',
                    'https://proof.example.org./', 'https://proof..example.org',
                    'https://proof.example.org\n', 'https://proof.example.org\\path']
        for origin in rejected:
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    packager.validate_nym_proof_configuration(origin, PIN)
        # Public-DNS syntax only. This reserved example has no deployment/approval claim.
        result = packager.validate_nym_proof_configuration('https://Proof.Example.org:443/', PIN)
        self.assertEqual(result, {'origin': 'https://proof.example.org', 'responseSHA256': PIN})

    def test_no_runtime_supply_refuses_before_any_bundle_is_created(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            output = root / 'NeverCreated.app'
            with self.assertRaisesRegex(ValueError, 'reviewed Nym runtime supply'):
                packager.package(root / 'no-binary', output,
                                 nym_proof_origin='https://proof.example.org',
                                 nym_proof_response_sha256=PIN)
            self.assertFalse(output.exists())


class NymProofBuildEntrypointTests(unittest.TestCase):
    def run_preflight(self, arguments):
        # A sentinel stops the first existing source check. No compiler, package
        # writer, signing command or network request is reached by this test.
        with tempfile.TemporaryDirectory() as name:
            node = Path(name) / 'node'
            node.write_text('#!/bin/sh\nexit 91\n')
            node.chmod(0o700)
            environment = dict(os.environ, PATH=name + os.pathsep + os.environ['PATH'])
            return subprocess.run(['bash', str(SCRIPTS / 'build-macos-app.sh'), *arguments],
                                  env=environment, capture_output=True, text=True, timeout=10)

    def test_invalid_proof_is_rejected_before_any_build_action(self):
        invalid = [
            ['--nym-proof-origin', 'https://proof.example.org'],
            ['--nym-proof-response-sha256', PIN],
            ['--nym-proof-origin'],
            ['--nym-proof-origin', '--nym-proof-response-sha256', PIN],
            ['--nym-proof-origin', '', '--nym-proof-response-sha256', PIN],
            ['--nym-proof-origin', 'https://proof.example.org', '--nym-proof-response-sha256', PIN],
            ['--nym-supply', '/not-read-by-preflight', '--nym-proof-origin', 'http://proof.example.org',
             '--nym-proof-response-sha256', PIN],
            ['--nym-supply', '/not-read-by-preflight', '--nym-proof-origin', 'https://proof.example.org',
             '--nym-proof-response-sha256', PIN.upper()],
            ['--nym-proof-origin', 'https://proof.example.org', '--nym-proof-origin', 'https://other.example.org'],
            ['--nym-proof-response-sha256', PIN, '--nym-proof-response-sha256', PIN],
        ]
        for arguments in invalid:
            with self.subTest(arguments=arguments):
                result = self.run_preflight(arguments)
                self.assertEqual(result.returncode, 64, result.stderr)

    def test_unconfigured_and_explicit_paired_inputs_reach_existing_source_gate(self):
        for arguments in [[], ['--nym-supply', '/not-read-by-preflight',
                               '--nym-proof-origin', 'https://Proof.Example.org:443/',
                               '--nym-proof-response-sha256', PIN]]:
            with self.subTest(arguments=arguments):
                result = self.run_preflight(arguments)
                self.assertEqual(result.returncode, 91, result.stderr)


if __name__ == '__main__':
    unittest.main()
