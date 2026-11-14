#!/usr/bin/python3
"""Local packaging controls: inert binary, no launch, network, or route admission."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-interactive-route-qa.py'
spec = importlib.util.spec_from_file_location('interactive_qa_packager', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InteractivePackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get('NYM_PHASED_TEST_ROOT'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.tor = self.root / 'tor'
        self.nym = self.root / 'nym'
        self.tor.mkdir(mode=0o700)
        self.nym.mkdir(mode=0o700)
        tor_files = {'arti': b'tor-qa', 'lyrebird': b'bridge-qa',
                     'public-bridges.json': b'{}', 'manifest.json': b'{}'}
        for name, data in tor_files.items():
            path = self.tor / name
            path.write_bytes(data)
            path.chmod(0o700 if name in ('arti', 'lyrebird') else 0o600)
        for name, data in [('directory/nym-socks5-client', b'directory-qa'),
                           ('runtime/nym-socks5-client', b'runtime-qa'),
                           ('manifest.json', b'{}')]:
            path = self.nym / name
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o700 if path.name == 'nym-socks5-client' else 0o600)
        self.tor_pins = {name: hashlib.sha256(data).hexdigest() for name, data in tor_files.items()}
        self.directory_pin = hashlib.sha256(b'directory-qa').hexdigest()
        self.runtime_pin = hashlib.sha256(b'runtime-qa').hexdigest()
        self.manifest_pin = hashlib.sha256(b'{}').hexdigest()

    def package(self, output):
        inert = Path('/usr/bin/true')
        argv = ['package', '--binary', str(inert), '--binary-sha256', module.sha(inert.read_bytes()),
                '--tor-supply', str(self.tor), '--nym-supply', str(self.nym),
                '--nym-directory-sha256', self.directory_pin, '--nym-runtime-sha256', self.runtime_pin,
                '--output', str(output)]
        with mock.patch.object(module, 'TOR_PINS', self.tor_pins), \
             mock.patch.object(module, 'NYM_DIRECTORY_SHA256', self.directory_pin), \
             mock.patch.object(module, 'NYM_RUNTIME_SHA256', self.runtime_pin), \
             mock.patch.object(module, 'NYM_MANIFEST_SHA256', self.manifest_pin), \
             mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
            module.main()

    @unittest.skipUnless(sys.platform == 'darwin', 'Requires real macOS codesign')
    def test_three_distinct_roles_are_sealed_without_launch_or_admission(self):
        app = self.root / 'QA.app'
        self.package(app)
        for role, path in [('launcher', app), ('tor', app / 'Contents/Helpers/Tor Interactive QA.app'),
                           ('nym', app / 'Contents/Helpers/Nym Interactive QA.app')]:
            info = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
            self.assertEqual(info['CFBundleIdentifier'], module.ROLES[role][0])
            self.assertIs(info['YNXInteractiveRouteExperiment'], True)
            subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(path)], check=True,
                           capture_output=True, timeout=20)
        receipt = json.loads(app.with_suffix('.package.json').read_text())
        self.assertFalse(receipt['launched'])
        self.assertFalse(receipt['installed'])
        self.assertFalse(receipt['productionApproved'])
        self.assertEqual(receipt['wholeWindowLeakSafety'], 'NOT_TESTED')

    @unittest.skipUnless(sys.platform == 'darwin', 'Requires real macOS codesign')
    def test_modified_supply_is_rejected_before_signing(self):
        (self.nym / 'runtime/nym-socks5-client').write_bytes(b'modified')
        with self.assertRaises(ValueError):
            self.package(self.root / 'Changed.app')
        self.assertFalse((self.root / 'Changed.package.json').exists())

    def test_fifo_and_symlink_are_rejected(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(ValueError):
            module.read_file(fifo)
        link = self.root / 'link'
        link.symlink_to(self.tor / 'arti')
        with self.assertRaises(ValueError):
            module.read_file(link)


if __name__ == '__main__':
    unittest.main(verbosity=2)
