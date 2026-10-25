#!/usr/bin/env python3
"""Normal installer controls on synthetic files; actual service commands: zero.

Reuse the original producer fixture. Only root filesystem/UID namespace and
fixed read-only process/subprocess observations are mapped to this private
fixture. The CLI has no alternate-root, environment bypass or mock-host flag.
"""
from contextlib import redirect_stderr, redirect_stdout
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


REPO = Path(__file__).resolve().parents[2]
INSTALLER = REPO / 'scripts/ops/install-public-bft-caddy-json-baseline.py'
PRODUCER = REPO / 'scripts/ops/prepare-public-bft-caddy-json-source.py'
HELPER = REPO / 'scripts/ops/remote/public-bft-caddy-json.py'
spec = importlib.util.spec_from_file_location('original_caddy_source_fixtures',
    REPO / 'scripts/verify/test_prepare_public_bft_caddy_json_source.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
spec = importlib.util.spec_from_file_location('caddy_baseline_installer_controls', INSTALLER)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallCaddyJSONBaselineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ynx-caddy-baseline-install-')
        self.addCleanup(self.temp.cleanup)
        self.f = fixtures.Fixture(Path(self.temp.name))
        self.f.binding = {k: v for k, v in self.f.binding.items() if k in fixtures.producer.BASELINE_FIELDS}
        self.f.binding['version'] = fixtures.producer.BASELINE_VERSION
        self.f.save_binding()
        self.config = Path(self.temp.name) / 'etc/caddy/ynx-chain.json'
        self.dropin = Path(self.temp.name) / 'etc/systemd/system/caddy.service.d/ynx-chain-json.conf'
        self.config.parent.mkdir(parents=True, mode=0o755)
        self.dropin.parent.parent.mkdir(parents=True, mode=0o755)
        self.unknown_dropins = Path(self.temp.name) / 'run/systemd/system/caddy.service.d'
        self.commands, self.loaded, self.daemon_reloaded = [], self.f.raw, False
        self.validation_code, self.daemon_code = 0, 0
        self.changed_after_daemon, self.wrong_new_exec, self.process_restart = False, False, False
        self.after_prepare, self.replace_binding_after_daemon = None, False
        self.exec_fault, self.hide_exec_api = None, False
        self.exec_fault_after_daemon = False
        self.module = None
        real_load = installer.load_producer
        def load(expected):
            module, path, info = real_load(expected)
            read = module['read_file']
            module['read_file'] = lambda filename, *a, **kw: self.f.read_file(read, filename, *a, **kw)
            module['observe_process'] = self.f.observe
            original_helper = module['load_helper']
            def helper(expected_pin):
                shared, helper_path, helper_identity = original_helper(expected_pin)
                if self.hide_exec_api:
                    shared.pop('validate_exec_observation', None)
                return shared, helper_path, helper_identity
            module['load_helper'] = helper
            original_prepare = module['prepare']
            def prepare(args):
                result = original_prepare(args)
                if self.after_prepare is not None:
                    self.after_prepare()
                return result
            module['prepare'] = prepare
            self.module = module
            return module, path, info
        for name, value in (('load_producer', load), ('fixed_targets', lambda: (self.config, self.dropin)),
                ('root_ids', lambda: (os.geteuid(), os.getegid())), ('require_root', lambda: None),
                ('original_override_paths', lambda: [(self.dropin.parent, True), (self.unknown_dropins, True)]),
                ('execute_child', self.execute)):
            patcher = mock.patch.object(installer, name, new=value)
            patcher.start(); self.addCleanup(patcher.stop)

    def execute(self, argv, stdout, stderr, maximum):
        # These are exact production command arrays. No command is launched.
        self.commands.append(tuple(argv))
        if argv == installer.SHOW:
            config = installer.CONFIG if self.daemon_reloaded else '/etc/caddy/Caddyfile'
            if self.wrong_new_exec and self.daemon_reloaded:
                config = '/etc/caddy/foreign.json'
            values = dict(ActiveState='active', SubState='running', MainPID=self.f.process['pid'],
                FragmentPath=installer.UNIT, DropInPaths=installer.DROPIN if self.daemon_reloaded else '',
                User='caddy', Group='caddy',
                ExecStart='{ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --environ --config ' + config + ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }',
                ExecReload='{ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy reload --config ' + config + ' --force ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }')
            if self.exec_fault is not None and (not self.exec_fault_after_daemon or self.daemon_reloaded):
                field, variant = self.exec_fault
                original = values[field]
                if variant == 'foreign_tail':
                    values[field] = original + ' foreign'
                elif variant == 'second_command':
                    values[field] = original + ' ; ' + original
                elif variant == 'extra_argv':
                    values[field] = original.replace(' ; ignore_errors=no', ' --resume ; ignore_errors=no')
                elif variant == 'duplicate_metadata':
                    values[field] = original.replace('pid=0 ;', 'pid=0 ; pid=1 ;')
                else:
                    raise AssertionError('unknown Exec observation fault')
            stdout.write(('\n'.join(k + '=' + values[k] for k in installer.PROPERTIES) + '\n').encode())
            return 0
        if argv == installer.GET:
            stdout.write(self.loaded)
            return 0
        if argv == installer.VALIDATE:
            self.assertEqual(self.config.read_bytes(), self.f.raw)
            # Caddy diagnostics could contain arbitrary config values. They
            # must remain private even on success or a nonzero child result.
            stderr.write(fixtures.CANARY.encode())
            return self.validation_code
        if argv == installer.DAEMON_RELOAD:
            self.daemon_reloaded = True
            if self.changed_after_daemon:
                changed = copy.deepcopy(self.f.config)
                changed['logging']['logs']['private']['writer']['filename'] += '-changed'
                self.loaded = fixtures.shared.canonical_config(changed)
            if self.process_restart:
                self.f.process['startTicks'] = '905926895'
            if self.replace_binding_after_daemon:
                self.replace_binding()
            return self.daemon_code
        raise AssertionError('unexpected command or service mutation')

    def replace_binding(self):
        raw, before = self.f.binding_path.read_bytes(), self.f.binding_path.lstat()
        replacement = Path(self.temp.name) / 'same-bytes-new-binding.json'
        fixtures.put(replacement, raw)
        self.assertNotEqual(replacement.lstat().st_ino, before.st_ino)
        os.replace(replacement, self.f.binding_path)
        self.assertEqual(self.f.binding_path.read_bytes(), raw)

    def call(self, install=True, **changes):
        args = self.f.args()
        values = dict(binding=args.binding, binding_sha256=args.binding_sha256,
            producer_sha256=fixtures.sha(PRODUCER.read_bytes()),
            json_helper_sha256=args.json_helper_sha256, output_dir=args.output_dir)
        values.update(changes)
        argv = []
        for key, value in values.items():
            argv += ['--' + key.replace('_', '-'), value]
        if install:
            argv += ['--install']
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = installer.main(argv)
        self.assertNotIn(fixtures.CANARY, out.getvalue() + err.getvalue())
        return code, out.getvalue(), err.getvalue()

    def failure(self):
        self.assertFalse((self.f.output / 'baseline-install-receipt.json').exists())
        value = json.loads((self.f.output / 'baseline-install-failure.json').read_bytes())
        self.assertEqual(value['status'], 'unknown')
        self.assertIs(value['automaticRetry'], False)
        self.assertIs(value['persistentStartupSource'], False)
        return value

    def test_default_real_producer_prepares_data_without_any_service_command(self):
        code, out, err = self.call(install=False)
        self.assertEqual((code, err), (0, ''))
        receipt = json.loads(out)
        self.assertIs(receipt['persistentStartupSource'], False)
        self.assertIs(receipt['chainActivation'], False)
        self.assertFalse(self.config.exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.commands, [])
        self.assertTrue((self.f.output / 'BASELINE_DATA.json').exists())
        self.assertFalse((self.f.output / 'baseline-install-intent.json').exists())

    def test_normal_install_keeps_live_config_pid_and_original_files(self):
        before = [(p.read_bytes(), fixtures.producer.identity(p.lstat()))
                  for p in (self.f.first, self.f.second, self.f.unit)]
        code, out, err = self.call()
        self.assertEqual((code, err), (0, ''))
        receipt = json.loads(out)
        self.assertIs(receipt['persistentStartupSource'], True)
        self.assertIs(receipt['liveConfigUnchanged'], True)
        for field in ('restartRecovery', 'rollbackVerified', 'chainActivation', 'rootGrant',
                      'publicDeployment', 'caddyReloaded', 'caddyRestarted', 'routesChanged'):
            self.assertIs(receipt[field], False)
        self.assertEqual(receipt['originalPID'], '1432803')
        self.assertEqual(receipt['originalStartTicks'], '905926894')
        self.assertEqual(self.config.read_bytes(), self.f.raw)
        self.assertEqual(fixtures.pointer(fixtures.shared.parse_config(self.config.read_bytes()),
            fixtures.EVM_POINTER), '127.0.0.1:6420')
        candidate = fixtures.shared.parse_config((self.f.output / 'candidate.json').read_bytes())
        self.assertEqual(fixtures.pointer(candidate, fixtures.EVM_POINTER), '127.0.0.1:27620')
        self.assertEqual(self.dropin.read_bytes(), fixtures.shared.render_dropin())
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.dropin.stat().st_mode & 0o777, 0o644)
        self.assertEqual(before, [(p.read_bytes(), fixtures.producer.identity(p.lstat()))
                    for p in (self.f.first, self.f.second, self.f.unit)])
        self.assertEqual(self.loaded, self.f.raw)
        self.assertEqual(self.commands, list(map(tuple, [installer.SHOW, installer.GET, installer.VALIDATE,
            installer.SHOW, installer.GET, installer.DAEMON_RELOAD, installer.SHOW, installer.GET])))
        logs = self.f.output / 'commands'
        self.assertEqual((logs / 'validate.stderr').read_bytes(), fixtures.CANARY.encode())
        for path in logs.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(logs.stat().st_mode & 0o777, 0o700)

    def test_independent_source_pins_are_required_before_preparation(self):
        for field in ('producer_sha256', 'json_helper_sha256', 'binding_sha256'):
            with self.subTest(field=field):
                self.assertEqual(self.call(**{field: 'd' * 64})[0], 1)
                self.assertFalse(self.f.output.exists())
                self.assertEqual(self.commands, [])

    def test_old_shared_helper_without_exact_exec_api_is_refused(self):
        self.hide_exec_api = True
        code, out, err = self.call()
        self.assertEqual((code, out), (1, ''))
        self.assertIn('CADDY_EXEC_OBSERVATION_API_REQUIRED', err)
        self.assertFalse(self.f.output.exists())
        self.assertEqual(self.commands, [])

    def test_exec_foreign_tail_second_command_and_extra_argv_are_rejected(self):
        index = 0
        for field in ('ExecStart', 'ExecReload'):
            for variant in ('foreign_tail', 'second_command', 'extra_argv', 'duplicate_metadata'):
                with self.subTest(field=field, variant=variant):
                    index += 1
                    self.f.output = self.f.output_parent / ('exec-rejection-%d' % index)
                    self.exec_fault = field, variant
                    count = len(self.commands)
                    self.assertEqual(self.call()[0], 1)
                    self.assertEqual(self.failure()['firstCause'], 'original-loaded-source')
                    self.assertFalse(self.config.exists())
                    self.assertFalse(self.dropin.exists())
                    self.assertEqual(self.commands[count:], [tuple(installer.SHOW)])

    def test_new_loaded_execstart_foreign_tail_keeps_unknown(self):
        self.exec_fault, self.exec_fault_after_daemon = ('ExecStart', 'foreign_tail'), True
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.failure()['firstCause'], 'persistent-source-readback')
        self.assertEqual(self.config.read_bytes(), self.f.raw)
        self.assertEqual(self.commands.count(tuple(installer.DAEMON_RELOAD)), 1)

    def test_new_loaded_execreload_second_command_keeps_unknown(self):
        self.exec_fault, self.exec_fault_after_daemon = ('ExecReload', 'second_command'), True
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.failure()['firstCause'], 'persistent-source-readback')
        self.assertEqual(self.dropin.read_bytes(), fixtures.shared.render_dropin())
        self.assertEqual(self.commands.count(tuple(installer.DAEMON_RELOAD)), 1)

    def test_fresh_capture_read_allows_actual_atime_only_change(self):
        path = Path(self.temp.name) / 'fresh-private-command.stdout'
        fixtures.put(path, b'original bounded private capture\n')
        original = path.lstat()
        os.utime(path, ns=(1, original.st_mtime_ns))
        before = path.lstat()
        self.assertEqual(installer.read_capture(path, 65536), b'original bounded private capture\n')
        after = path.lstat()
        self.assertGreater(after.st_atime_ns, before.st_atime_ns)
        self.assertEqual(installer.file_identity(before), installer.file_identity(after))

    def test_capture_read_rejects_actual_mtime_mutation(self):
        path = Path(self.temp.name) / 'changed-private-command.stdout'
        fixtures.put(path, b'private original capture\n')
        original_fstat, calls = os.fstat, []
        def race(fd):
            info = original_fstat(fd)
            calls.append(fd)
            if len(calls) == 1:
                os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1000))
            return info
        with mock.patch.object(os, 'fstat', side_effect=race):
            with self.assertRaisesRegex(installer.Refusal, 'PRIVATE_CAPTURE_CHANGED'):
                installer.read_capture(path, 65536)
        self.assertEqual(path.read_bytes(), b'private original capture\n')

    def test_protocol_full_binding_cannot_select_baseline_installer(self):
        self.f.binding['version'] = fixtures.producer.VERSION
        self.f.save_binding()
        self.assertEqual(self.call()[0], 1)
        self.assertFalse(self.f.output.exists())
        self.assertEqual(self.commands, [])

    def test_old_two_rpc_baseline_is_refused_before_installer_commands(self):
        self.f.binding['rpcUpstreams'] = self.f.binding['rpcUpstreams'][:2]
        self.f.save_binding()
        self.assertEqual(self.call()[0], 1)
        self.assertFalse(self.f.output.exists())
        self.assertEqual(self.commands, [])
        self.assertFalse(self.config.exists())
        self.assertFalse(self.dropin.exists())

    def test_same_bytes_binding_inode_replacement_after_prepare_keeps_unknown(self):
        self.after_prepare = self.replace_binding
        self.assertEqual(self.call()[0], 1)
        self.assertTrue((self.f.output / 'BASELINE_DATA.json').exists())
        self.assertEqual(self.failure()['firstCause'], 'post-preparation-binding')
        self.assertFalse(self.config.exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.commands, [])
        self.assertEqual(json.loads((self.f.output / 'intent.json').read_bytes())['status'], 'unknown')

    def test_same_bytes_binding_inode_replacement_during_install_keeps_partials(self):
        self.replace_binding_after_daemon = True
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.failure()['errorCode'], 'INDEPENDENT_BINDING_IDENTITY_CHANGED')
        self.assertEqual(self.config.read_bytes(), self.f.raw)
        self.assertEqual(self.dropin.read_bytes(), fixtures.shared.render_dropin())
        self.assertEqual(self.commands.count(tuple(installer.DAEMON_RELOAD)), 1)
        count = len(self.commands)
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(len(self.commands), count)

    def test_existing_target_is_never_overwritten_or_removed(self):
        fixtures.put(self.config, b'ORIGINAL_OTHER_OWNER_OR_UNKNOWN\n')
        before = self.config.read_bytes(), fixtures.producer.identity(self.config.lstat())
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(before, (self.config.read_bytes(), fixtures.producer.identity(self.config.lstat())))
        self.assertFalse(self.dropin.exists())
        self.assertNotIn(tuple(installer.VALIDATE), self.commands)
        self.assertNotIn(tuple(installer.DAEMON_RELOAD), self.commands)
        self.failure()

    def test_unknown_pending_dropin_blocks_before_any_install(self):
        self.unknown_dropins.mkdir(parents=True, mode=0o755)
        foreign = self.unknown_dropins / 'not-loaded-yet.conf'
        fixtures.put(foreign, b'[Service]\nEnvironment=UNKNOWN=retained\n')
        self.assertEqual(self.call()[0], 1)
        self.assertFalse(self.config.exists())
        self.assertEqual(foreign.read_bytes(), b'[Service]\nEnvironment=UNKNOWN=retained\n')
        self.assertNotIn(tuple(installer.DAEMON_RELOAD), self.commands)
        self.failure()

    def test_whole_loaded_mismatch_cannot_be_hidden_by_matching_rpc_routes(self):
        changed = copy.deepcopy(self.f.config)
        changed['logging']['logs']['private']['writer']['filename'] += '-foreign'
        self.loaded = fixtures.shared.canonical_config(changed)
        self.assertEqual(self.call()[0], 1)
        self.assertFalse(self.config.exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.failure()['firstCause'], 'original-loaded-source')

    def test_validate_failure_retains_both_targets_and_private_first_cause(self):
        self.validation_code = 1
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.config.read_bytes(), self.f.raw)
        self.assertEqual(self.dropin.read_bytes(), fixtures.shared.render_dropin())
        self.assertNotIn(tuple(installer.DAEMON_RELOAD), self.commands)
        self.assertEqual(self.failure()['firstCause'], 'validate-fixed-json')
        count = len(self.commands)
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(len(self.commands), count)
        self.assertEqual(self.config.read_bytes(), self.f.raw)

    def test_mid_install_failure_keeps_partial_config_without_daemon_reload(self):
        real = installer.install_file
        def fail_dropin(module, path, *args):
            if path == self.dropin:
                raise installer.Refusal('INJECTED_DROPIN_INSTALL_FAILURE')
            return real(module, path, *args)
        with mock.patch.object(installer, 'install_file', side_effect=fail_dropin):
            self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.config.read_bytes(), self.f.raw)
        self.assertFalse(self.dropin.exists())
        self.assertNotIn(tuple(installer.VALIDATE), self.commands)
        self.assertNotIn(tuple(installer.DAEMON_RELOAD), self.commands)
        self.assertEqual(self.failure()['firstCause'], 'exclusive-dropin-install')

    def test_daemon_reload_failure_retains_everything_without_rollback(self):
        self.daemon_code = 1
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.config.read_bytes(), self.f.raw)
        self.assertEqual(self.dropin.read_bytes(), fixtures.shared.render_dropin())
        self.assertEqual(self.failure()['firstCause'], 'daemon-reload-only')
        self.assertEqual(self.commands.count(tuple(installer.DAEMON_RELOAD)), 1)

    def test_post_daemon_wrong_unit_does_not_claim_persistent_source(self):
        self.wrong_new_exec = True
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.failure()['firstCause'], 'persistent-source-readback')
        self.assertEqual(self.config.read_bytes(), self.f.raw)

    def test_post_daemon_loaded_change_does_not_claim_unchanged_routes(self):
        self.changed_after_daemon = True
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.failure()['firstCause'], 'persistent-source-readback')
        self.assertEqual(self.config.read_bytes(), self.f.raw)

    def test_process_restart_is_rejected_even_with_same_loaded_config(self):
        self.process_restart = True
        self.assertEqual(self.call()[0], 1)
        self.assertEqual(self.failure()['firstCause'], 'persistent-source-readback')
        self.assertEqual(self.loaded, self.f.raw)


if __name__ == '__main__':
    unittest.main()
