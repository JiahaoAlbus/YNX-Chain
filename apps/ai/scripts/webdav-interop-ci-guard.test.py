#!/usr/bin/env python3
"""CI path/help/resume delta only. No upstream, pip, network or old probe runs."""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent
SCRIPTS = ['webdav-interop-provision.py', 'webdav-interop-wsgidav.py']


def load_guard(path):
    tree = ast.parse(path.read_text())
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'isolated_root')
    scope = {'Path': Path, 'os': os}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), scope)
    return scope['isolated_root']


class CIDelta(unittest.TestCase):
    def test_guard_boundaries_both_scripts(self):
        with tempfile.TemporaryDirectory(prefix='p08-ci-guard-') as tmp:
            runner = Path(tmp) / 'runner'; runner.mkdir()
            outside = Path(tmp) / 'outside'; outside.mkdir()
            (runner / 'escape').symlink_to(outside, target_is_directory=True)
            cases = [
                ('local-volume', {}, '/Volumes/P08-synthetic/isolated', True),
                ('ci-child', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, str(runner / 'p08'), True),
                ('ci-nested-child', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, str(runner / 'p08/wsgidav'), True),
                ('no-ci', {'RUNNER_TEMP': str(runner)}, str(runner / 'p08'), False),
                ('ci-false', {'CI': 'false', 'RUNNER_TEMP': str(runner)}, str(runner / 'p08'), False),
                ('ci-uppercase', {'CI': 'TRUE', 'RUNNER_TEMP': str(runner)}, str(runner / 'p08'), False),
                ('missing-runner', {'CI': 'true'}, str(outside / 'p08'), False),
                ('empty-runner', {'CI': 'true', 'RUNNER_TEMP': ''}, str(outside / 'p08'), False),
                ('relative-runner', {'CI': 'true', 'RUNNER_TEMP': '.'}, str(runner / 'p08'), False),
                ('root-runner', {'CI': 'true', 'RUNNER_TEMP': '/'}, str(outside / 'p08'), False),
                ('missing-runner-directory', {'CI': 'true', 'RUNNER_TEMP': str(runner / 'missing')}, str(runner / 'missing/p08'), False),
                ('runner-itself', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, str(runner), False),
                ('sibling-prefix', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, str(runner) + '-other/p08', False),
                ('parent-traversal', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, str(runner / '../outside/p08'), False),
                ('symlink-escape', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, str(runner / 'escape/p08'), False),
                ('arbitrary-tenant', {'CI': 'true', 'RUNNER_TEMP': str(runner)}, '/srv/customer/tenant', False),
            ]
            for script in SCRIPTS:
                guard = load_guard(BASE / script)
                for label, env, target, expected in cases:
                    with self.subTest(script=script, case=label), patch.dict(os.environ, env, clear=True):
                        self.assertEqual(guard(target), expected)

    def test_help_and_rejected_cli_have_no_side_effects(self):
        for script in SCRIPTS:
            for flag in ('--help', '-h'):
                result = subprocess.run([sys.executable, str(BASE / script), flag], capture_output=True, text=True, env={'PATH': os.environ.get('PATH', '')})
                self.assertEqual(result.returncode, 0); self.assertIn('RUNNER_TEMP', result.stdout)
            with tempfile.TemporaryDirectory(prefix='p08-ci-cli-') as tmp:
                target = Path(tmp) / 'must-not-create'
                result = subprocess.run([sys.executable, str(BASE / script), str(target)], capture_output=True, text=True, env={'CI': 'true', 'RUNNER_TEMP': '', 'PATH': os.environ.get('PATH', '')})
                self.assertNotEqual(result.returncode, 0); self.assertFalse(target.exists())

    def test_resume_retains_port_credentials_and_fixed_site_with_mock_process(self):
        with tempfile.TemporaryDirectory(prefix='p08-ci-resume-') as tmp:
            runner = Path(tmp).resolve(); root = runner / 'p08/wsgidav'; root.mkdir(parents=True)
            config = {'host': '127.0.0.1', 'port': 54321, 'provider_mapping': {'/': str(root / 'data')}}
            config_path = root / 'config.private.json'; config_path.write_text(json.dumps(config)); config_path.chmod(0o600)
            old = {'url': 'http://127.0.0.1:54321/', 'username': 'p08-synthetic', 'password': 'synthetic-resume-marker'}
            (root / 'connection.private.json').write_text(json.dumps(old))
            config_bytes = config_path.read_bytes()
            class Child:
                pid = 12345
                def poll(self): return None
                def wait(self): return 0
                def terminate(self): pass
                def send_signal(self, sig): pass
            class Response:
                status = 200
                def __enter__(self): return self
                def __exit__(self, *args): return False
            output = io.StringIO()
            with patch.dict(os.environ, {'CI': 'true', 'RUNNER_TEMP': str(runner)}, clear=True), patch.object(sys, 'argv', [str(BASE / SCRIPTS[1]), str(root), '--resume']), patch('subprocess.Popen', return_value=Child()) as launch, patch('urllib.request.urlopen', return_value=Response()), patch('signal.signal'), contextlib.redirect_stdout(output):
                with self.assertRaises(SystemExit) as exit:
                    runpy.run_path(str(BASE / SCRIPTS[1]), run_name='__main__')
                self.assertEqual(exit.exception.code, 0)
            current = json.loads((root / 'connection.private.json').read_text())
            for key in ('url', 'username', 'password'): self.assertEqual(current[key], old[key])
            self.assertEqual(config_path.read_bytes(), config_bytes)
            self.assertNotIn(old['password'], output.getvalue())
            self.assertEqual(launch.call_count, 1)
            cmd = launch.call_args.args[0]; env = launch.call_args.kwargs['env']
            site = root.parent / 'upstream/wsgidav-site'
            self.assertEqual(cmd[1], str(site / 'bin/wsgidav'))
            self.assertEqual(env['PYTHONPATH'], str(site))
            self.assertEqual(env['PYTHONDONTWRITEBYTECODE'], '1')

    def test_provision_pins_exactly_nine_and_never_installs(self):
        tree = ast.parse((BASE / SCRIPTS[0]).read_text())
        pins = ast.literal_eval(next(node.value for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'pins' for t in node.targets)))
        self.assertEqual(pins, {'wsgidav': '4.3.3', 'cheroot': '10.0.1', 'defusedxml': '0.7.1', 'jinja2': '3.1.6', 'json5': '0.9.28', 'pyyaml': '6.0.2', 'markupsafe': '2.1.5', 'jaraco-functools': '4.1.0', 'more-itertools': '10.5.0'})
        self.assertNotIn('install', [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
