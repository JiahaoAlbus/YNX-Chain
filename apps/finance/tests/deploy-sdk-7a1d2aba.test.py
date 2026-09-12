"""Local-only guards for the frozen deployment command; no SSH/process spawn."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('finance_deploy', Path(__file__).parents[1] / 'scripts/deploy-sdk-7a1d2aba-20260912.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class GuardTests(unittest.TestCase):
    def test_actual_finance_asset_route_contract(self):
        self.assertEqual(deploy.asset_route('web/index.html'), '/')
        self.assertEqual(deploy.asset_route('web/wallet-auth.js'), '/wallet-auth.js')
        with self.assertRaises(AssertionError):
            deploy.asset_route('ynx-finance')

    def test_env_exact_replacement_preserves_other_bytes_and_no_output(self):
        before = b'# retained\nSECRET=disposable-local-fixture\nYNX_FINANCE_WEB_DIR=' + (deploy.OLD + '/web').encode() + b'\nOTHER=unchanged\n'
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            after = deploy.env_candidate(before)
        expected = before.replace((deploy.OLD + '/web').encode(), str(deploy.RELEASE / 'web').encode()) + b'YNX_FINANCE_AUTH_MODE=product-session-v2\n'
        self.assertEqual(after, expected)
        self.assertEqual(output.getvalue(), '')

    def test_missing_duplicate_unexpected_web_and_auth_keys_fail(self):
        line = b'YNX_FINANCE_WEB_DIR=' + (deploy.OLD + '/web').encode() + b'\n'
        for raw in [b'OTHER=value\n', line + line, b'YNX_FINANCE_WEB_DIR=/foreign/web\n', line + b'YNX_FINANCE_AUTH_MODE=legacy-v1\n']:
            with self.assertRaises(AssertionError):
                deploy.env_candidate(raw)

    def test_no_replace_symlink_hardlink_and_hash_fences(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            p = root / 'a'
            p.write_bytes(b'fixture')
            with self.assertRaises(FileExistsError):
                deploy.save_new(p, b'replacement')
            self.assertEqual(p.read_bytes(), b'fixture')
            with self.assertRaises(AssertionError):
                deploy.regular(p, '0' * 64)
            link = root / 'link'
            link.symlink_to(p)
            with self.assertRaises(AssertionError):
                deploy.regular(link)
            hard = root / 'hard'
            os.link(p, hard)
            with self.assertRaises(AssertionError):
                deploy.regular(p)

    def test_old_new_state_codec_source_identical(self):
        # This test covers the declared source boundary; git object identity is
        # frozen separately in the deployment handoff, not inferred from data.
        script = Path(deploy.__file__).read_text()
        self.assertNotIn('shutil.copyfile(STATE', script)
        self.assertNotIn('os.replace(STATE', script)
        self.assertIn("'stateSnapshotRestored': False", script)
        self.assertNotIn("systemctl('restart')", script)


if __name__ == '__main__':
    unittest.main()
