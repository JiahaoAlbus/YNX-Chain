#!/usr/bin/env python3
"""Synthetic full-config DATA fixtures; never run Caddy or a real service."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HELPER = Path(__file__).resolve().parents[1] / 'ops/remote/public-bft-caddy-json.py'
spec = importlib.util.spec_from_file_location('caddy_json_source', HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

TESTNET_POINTER = '/apps/http/servers/srv0/routes/16/handle/0/routes/0/handle/0/upstreams/0/dial'
MAIN_POINTER = '/apps/http/servers/srv0/routes/38/handle/0/routes/2/handle/0/routes/0/handle/0/upstreams/0/dial'
EVM_POINTER = '/apps/http/servers/srv0/routes/39/handle/0/routes/0/handle/0/routes/1/handle/0/upstreams/0/dial'
BRIDGE_POINTER = '/apps/http/servers/srv0/routes/38/handle/0/routes/0/handle/0/routes/1/handle/0/upstreams/0/dial'


def fixture_config():
    def proxy(port):
        return {'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:' + str(port)}]}
    routes = [{'match': [{'host': ['unrelated%d.invalid' % i]}], 'handle': [proxy(6430)]} for i in range(40)]
    routes[16] = {'match': [{'host': ['rpc-testnet.ynxweb4.com']}], 'handle': [
        {'handler': 'subroute', 'routes': [{'handle': [proxy(6420)]}]}]}
    routes[38] = {'match': [{'host': ['rpc.ynxweb4.com']}], 'handle': [
        {'handler': 'subroute', 'routes': [
            {'handle': [{'handler': 'subroute', 'routes': [
                {'match': [{'path': ['/retained/*']}], 'handle': [proxy(6432)]},
                {'match': [{'path': ['/bridge/*']}], 'handle': [proxy(6433)]}]}]},
            {'handle': [{'handler': 'static_response', 'body': 'retained'}]},
            {'handle': [{'handler': 'subroute', 'routes': [{'handle': [proxy(6420)]}]}]}]}]}
    routes[39] = {'match': [{'host': ['evm.ynxweb4.com']}], 'handle': [
        {'handler': 'subroute', 'routes': [
            {'handle': [{'handler': 'subroute', 'routes': [
                {'handle': [{'handler': 'static_response', 'body': 'retained EVM route'}]},
                {'handle': [proxy(6420)]}]}]}]}]}
    return {'apps': {'http': {'servers': {'srv0': {'listen': [':443'], 'routes': routes}}},
                     'tls': {'certificates': {'load_pem': [{'certificate': 'SYNTHETIC-PRIVATE-CANARY', 'key': 'NOT-A-REAL-KEY'}]}}},
            'admin': {'listen': '127.0.0.1:2019'}}


def rpc_records():
    return [dict(pointer=TESTNET_POINTER, host='rpc-testnet.ynxweb4.com', **{'from': '127.0.0.1:6420', 'to': '127.0.0.1:27620'}),
            dict(pointer=MAIN_POINTER, host='rpc.ynxweb4.com', **{'from': '127.0.0.1:6420', 'to': '127.0.0.1:27620'}),
            dict(pointer=EVM_POINTER, host='evm.ynxweb4.com', **{'from': '127.0.0.1:6420', 'to': '127.0.0.1:27620'})]


class ExecObservationContract(unittest.TestCase):
    def setUp(self):
        self.argv = ['/usr/bin/caddy', 'run', '--environ', '--config', module.CONFIG_PATH]
        self.prefix = '{ path=/usr/bin/caddy ; argv[]=' + ' '.join(self.argv) + ' ; ignore_errors=no ; '

    def test_real_systemctl_metadata_and_existing_fixture_forms(self):
        for tail in ['}', 'pid=0 ; }',
                     'start_time=[Sat 2026-10-24 07:06:05 UTC] ; stop_time=[n/a] ; pid=1432803 ; code=(null) ; status=0/0 }',
                     'start_time=[Sat 2026-10-24 07:06:05 UTC] ; stop_time=[n/a] ; pid=1432803 ; code=(null) ; status=0/0 ; }',
                     'start_time=[Sat 2026-10-24 15:06:05.123456 CST] ; stop_time=[Sat 2026-10-24 15:06:06 +08] ; pid=1432803 ; code=exited ; status=0/SUCCESS ; }',
                     'status=9/KILL ; code=killed ; pid=42 ; stop_time=[n/a] ; start_time=[n/a] ; }']:
            with self.subTest(tail=tail):
                self.assertIsNone(module.validate_exec_observation(self.prefix + tail, self.argv))
        reload_argv = ['/usr/bin/caddy', 'reload', '--config', module.CONFIG_PATH, '--force']
        reload_observed = '{ path=/usr/bin/caddy ; argv[]=' + ' '.join(reload_argv) + ' ; ignore_errors=no ; pid=0 ; }'
        self.assertIsNone(module.validate_exec_observation(reload_observed, reload_argv))

    def test_single_command_tail_injection_duplicate_and_unknown_fields_reject(self):
        for tail in ['} foreign', '} ', '}\n', '}\r', '}\0', '} { path=/bin/foreign ; }',
                     'pid=0 ; } ; argv[]=/bin/foreign', 'pid=0 ; } }',
                     'pid=0 ; pid=1 ; }', 'start_time=[n/a] ; start_time=[n/a] ; }',
                     'stop_time=[n/a] ; stop_time=[n/a] ; }', 'code=exited ; code=killed ; }',
                     'status=0/0 ; status=1/FAILURE ; }', 'unknown=value ; }',
                     'argv[]=/bin/foreign ; }', 'path=/bin/foreign ; }', 'ignore_errors=yes ; }',
                     'pid=00 ; }', 'pid=4294967296 ; }', 'pid=-1 ; }', 'pid=0; }',
                     'pid=0 ;', 'pid=0}', 'pid=0 ; \n}',
                     'start_time=[n/a] foreign ; }', 'start_time=[n/a ; pid=1] ; }',
                     'status=0/0 foreign ; }', 'code=arbitrary ; }']:
            with self.subTest(tail=tail), self.assertRaises(ValueError):
                module.validate_exec_observation(self.prefix + tail, self.argv)

    def test_extra_argv_wrong_path_or_noncanonical_prefix_reject(self):
        actual = self.prefix + 'pid=0 ; }'
        for value in [actual.replace('path=/usr/bin/caddy', 'path=/bin/foreign'),
                      actual.replace(' run --environ', ' run --resume --environ'),
                      actual.replace('--config ' + module.CONFIG_PATH, '--config /etc/caddy/Caddyfile'),
                      actual.replace('ignore_errors=no', 'ignore_errors=yes'),
                      actual.replace('argv[]=', 'argv[]=/bin/foreign '),
                      actual.replace(' ; ', '; ', 1)]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.validate_exec_observation(value, self.argv)
        for argv in [[], ['/usr/bin/caddy', 'run --resume'], ['/usr/bin/caddy', 'run;foreign']]:
            with self.subTest(argv=argv), self.assertRaises(ValueError):
                module.validate_exec_observation(actual, argv)


class FullJSONProjection(unittest.TestCase):
    def test_real_retained_shape_changes_only_three_exact_dials(self):
        value = fixture_config()
        original = copy.deepcopy(value)
        projected = module.project_rpc_config(value, rpc_records())
        expected = copy.deepcopy(value)
        expected['apps']['http']['servers']['srv0']['routes'][16]['handle'][0]['routes'][0]['handle'][0]['upstreams'][0]['dial'] = '127.0.0.1:27620'
        expected['apps']['http']['servers']['srv0']['routes'][38]['handle'][0]['routes'][2]['handle'][0]['routes'][0]['handle'][0]['upstreams'][0]['dial'] = '127.0.0.1:27620'
        expected['apps']['http']['servers']['srv0']['routes'][39]['handle'][0]['routes'][0]['handle'][0]['routes'][1]['handle'][0]['upstreams'][0]['dial'] = '127.0.0.1:27620'
        self.assertEqual(projected, expected)
        self.assertEqual(value, original)
        self.assertEqual(projected['apps']['http']['servers']['srv0']['routes'][38]['handle'][0]['routes'][0]['handle'][0]['routes'][1]['handle'][0]['upstreams'][0]['dial'], '127.0.0.1:6433')

    def test_missing_evm_two_selector_manifest_is_not_supported(self):
        records = rpc_records()
        with self.assertRaises(ValueError):
            module.project_rpc_config(fixture_config(), records[:2])
        records[2]['host'] = 'unapproved-evm.invalid'
        with self.assertRaises(ValueError):
            module.project_rpc_config(fixture_config(), records)

    def test_strict_config_and_semantic_hash(self):
        value = fixture_config()
        raw = json.dumps(value, indent=2).encode()
        self.assertEqual(module.parse_config(raw), value)
        self.assertEqual(module.semantic_hash(value), module.semantic_hash(module.parse_config(module.canonical_config(value))))
        for bad in [b'{}', b'{"apps":{},"apps":{}}', b'{"apps":NaN}', b'{}\0', b'[]', b' ' * (module.MAX_CONFIG_BYTES + 1), raw + b'{}']:
            with self.subTest(raw=bad[:30]), self.assertRaises((ValueError, UnicodeError)):
                module.parse_config(bad)

    def test_scope_pointer_and_partial_switch_counterexamples(self):
        cases = []
        for change in ['missing-host', 'mixed-host', 'mixed-or', 'wrong-host', 'dynamic', 'extra-native', 'extra-candidate', 'already-candidate']:
            value = fixture_config()
            route = value['apps']['http']['servers']['srv0']['routes'][16]
            if change == 'missing-host': del route['match']
            if change == 'mixed-host': route['match'][0]['host'].append('unapproved.invalid')
            if change == 'mixed-or': route['match'].append({})
            if change == 'wrong-host': route['match'][0]['host'] = ['rpc.ynxweb4.com']
            if change == 'dynamic': route['handle'][0]['routes'][0]['handle'][0]['dynamic_upstreams'] = {'source': 'a'}
            if change == 'extra-native': route['handle'].append({'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:6420'}]})
            if change == 'extra-candidate': route['handle'].append({'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:27620'}]})
            if change == 'already-candidate': route['handle'][0]['routes'][0]['handle'][0]['upstreams'][0]['dial'] = '127.0.0.1:27620'
            cases.append((change, value, rpc_records()))
        for change in ['duplicate', 'bridge', 'leading-zero', 'escape', 'unknown', 'wrong-port']:
            records = rpc_records()
            if change == 'duplicate': records[1] = copy.deepcopy(records[0])
            if change == 'bridge': records[1]['pointer'] = BRIDGE_POINTER
            if change == 'leading-zero': records[0]['pointer'] = TESTNET_POINTER.replace('/16/', '/016/')
            if change == 'escape': records[0]['pointer'] = TESTNET_POINTER.replace('srv0', 'srv~00')
            if change == 'unknown': records[0]['extra'] = 'field'
            if change == 'wrong-port': records[0]['to'] = '127.0.0.1:6433'
            cases.append((change, fixture_config(), records))
        for name, value, records in cases:
            with self.subTest(case=name), self.assertRaises(ValueError):
                module.project_rpc_config(value, records)


class PersistentJSONGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source_dir = self.root / 'retained'
        self.source_dir.mkdir(mode=0o700)
        self.original = json.dumps(fixture_config(), indent=2).encode() + b'\n'
        self.sources = []
        for name in ['read1.json', 'read2.json']:
            path = self.source_dir / name
            self.write(path, self.original, 0o600)
            self.sources.append(dict(path=str(path), bytes=str(len(self.original)), sha256=hashlib.sha256(self.original).hexdigest(), witness=module.file_witness(path.stat())))
        self.unit = self.root / module.UNIT_PATH.lstrip('/')
        self.write(self.unit, b'[Service]\nUser=caddy\nGroup=caddy\nExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile\n', 0o644)
        self.value = dict(version=module.VERSION, transactionId='synthetic-json-ingress', commit='0123456789ab',
                          operatorPlanSHA256='a' * 64, runtimeCommit='0123456789abcdef0123456789abcdef01234567',
                          runtimeSOURCEsha256='b' * 64, gatewaySHA256='c' * 64,
                          source=self.sources[0], secondRead=self.sources[1],
                          originalProcess=dict(pid='6000', startTicks='123456', argv=module.OLD_ARGV),
                          originalUnit=dict(path=module.UNIT_PATH, sha256=hashlib.sha256(self.unit.read_bytes()).hexdigest()),
                          baseline=dict(configPath=module.CONFIG_PATH, configSHA256=hashlib.sha256(self.original).hexdigest(),
                                        semanticSHA256=module.semantic_hash(fixture_config()), candidateSemanticSHA256=module.semantic_hash(module.project_rpc_config(fixture_config(), rpc_records())), dropInPath=module.DROP_IN_PATH,
                                        dropInSHA256=hashlib.sha256(module.render_dropin()).hexdigest()), rpcUpstreams=rpc_records())
        self.candidate = module.canonical_config(module.project_rpc_config(fixture_config(), rpc_records()))
        self.config = self.root / module.CONFIG_PATH.lstrip('/')
        self.dropin = self.root / module.DROP_IN_PATH.lstrip('/')
        self.write(self.config, self.original, 0o600)
        self.write(self.dropin, module.render_dropin(), 0o644)
        self.program = self.root / 'usr/bin/caddy'
        self.write(self.program, b'synthetic never-executed Caddy executable', 0o755)
        self.proc = self.root / 'proc/6000'
        self.proc.mkdir(parents=True)
        (self.proc / 'exe').symlink_to(self.program)
        self.proc_stat('123456')
        self.argv(module.OLD_ARGV)
        self.observed = dict(fragment=str(self.unit), dropins=str(self.dropin), user='caddy', group='caddy', pid='6000',
                             start='{ path=%s ; argv[]=%s run --environ --config %s ; ignore_errors=no ; }' % (self.program, self.program, self.config),
                             reload='{ path=%s ; argv[]=%s reload --config %s --force ; ignore_errors=no ; }' % (self.program, self.program, self.config))
        self.manifest = self.root / 'manifest.json'
        self.write(self.manifest, module.canonical_config(self.value), 0o600)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, raw, mode):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        path.chmod(mode)

    def proc_stat(self, ticks):
        self.write(self.proc / 'stat', ('6000 (caddy) S ' + ' '.join(['0'] * 18 + [ticks, '0']) + '\n').encode(), 0o600)

    def argv(self, argv):
        mapped = [str(self.root) + item if item.startswith('/') else item for item in argv]
        self.write(self.proc / 'cmdline', b'\0'.join(item.encode() for item in mapped) + b'\0', 0o600)

    def guard(self, phase='original', loaded=None):
        module.guard(self.value, self.original, self.candidate, phase, str(self.root), self.observed,
                     loaded if loaded is not None else (self.original if phase == 'original' else self.candidate))

    def test_normal_retained_process_and_new_json_process(self):
        value, original, candidate = module.validate_manifest(self.manifest.read_bytes())
        self.assertEqual((value, original, candidate), (self.value, self.original, self.candidate))
        self.guard()
        self.config.write_bytes(self.candidate)
        self.guard('candidate')
        self.argv(['/usr/bin/caddy', 'run', '--environ', '--config', module.CONFIG_PATH])
        self.proc_stat('123457')
        self.guard('candidate')
        self.config.write_bytes(self.original)
        self.guard()  # rollback retains JSON startup source, not old stub.
        self.assertEqual(self.dropin.read_bytes(), module.render_dropin())

    def test_manifest_pins_identity_witness_closed_fields(self):
        for field in ['transactionId', 'operatorPlanSHA256', 'runtimeCommit', 'runtimeSOURCEsha256', 'gatewaySHA256']:
            expected = {field: 'different'}
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.validate_manifest(self.manifest.read_bytes(), expected)
        for change in ['extra', 'wrong-witness', 'same-read', 'wrong-baseline', 'wrong-unit', 'wrong-process', 'wrong-dropin']:
            value = copy.deepcopy(self.value)
            if change == 'extra': value['unknown'] = True
            if change == 'wrong-witness': value['source']['witness']['inode'] = '1'
            if change == 'same-read': value['secondRead'] = value['source']
            if change == 'wrong-baseline': value['baseline']['configSHA256'] = 'd' * 64
            if change == 'wrong-unit': value['originalUnit']['path'] = '/etc/systemd/system/foreign.service'
            if change == 'wrong-process': value['originalProcess']['argv'] = ['/usr/bin/caddy', 'run', '--resume']
            if change == 'wrong-dropin': value['baseline']['dropInSHA256'] = 'd' * 64
            with self.subTest(case=change), self.assertRaises(ValueError):
                module.validate_manifest(module.canonical_config(value))

    def test_missing_baseline_foreign_dropin_loaded_mismatch_and_process_races(self):
        self.guard()
        for field in ['fragment', 'dropins', 'user', 'group', 'start', 'reload', 'pid']:
            original = self.observed[field]
            self.observed[field] = original + ' foreign'
            with self.subTest(field=field), self.assertRaises((ValueError, OSError)):
                self.guard()
            self.observed[field] = original
        with self.assertRaises(ValueError): self.guard(loaded=self.candidate)
        self.proc_stat('123457')
        with self.assertRaises(ValueError): self.guard()
        self.proc_stat('123456')
        self.argv(['/usr/bin/caddy', 'run', '--resume'])
        with self.assertRaises(ValueError): self.guard()
        self.argv(module.OLD_ARGV)
        self.config.unlink()
        with self.assertRaises(OSError): self.guard()
        self.write(self.config, self.original, 0o644)
        with self.assertRaises(ValueError): self.guard()

    def test_original_file_symlink_hardlink_and_metadata_change_reject(self):
        original = self.sources[0]
        path = Path(original['path'])
        saved = path.with_name('saved.json')
        path.rename(saved)
        path.symlink_to(saved)
        with self.assertRaises(ValueError): module.validate_manifest(self.manifest.read_bytes())
        path.unlink(); saved.rename(path)
        os.link(path, saved)
        with self.assertRaises(ValueError): module.validate_manifest(self.manifest.read_bytes())
        saved.unlink()
        path.chmod(0o640)
        with self.assertRaises(ValueError): module.validate_manifest(self.manifest.read_bytes())

    def test_read_allows_atime_only_but_refuses_mtime_ctime_and_replacement(self):
        # Metadata fault injection on an actual temporary file. This does not
        # claim to exercise Caddy, a deployment or a remote filesystem.
        path = Path(self.sources[0]['path'])
        original_fstat = os.fstat
        fields = ['st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink',
                  'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_atime_ns']
        def observed(fd, changed):
            real = original_fstat(fd)
            value = {key: getattr(real, key) for key in fields}
            value[changed] += 1
            return SimpleNamespace(**value)
        with mock.patch.object(module.os, 'fstat', side_effect=lambda fd: observed(fd, 'st_atime_ns')):
            self.assertEqual(module.read_regular(str(path), mode=0o600)[0], self.original)
        for changed in ['st_mtime_ns', 'st_ctime_ns']:
            with self.subTest(changed=changed), mock.patch.object(module.os, 'fstat', side_effect=lambda fd: observed(fd, changed)), self.assertRaises(ValueError):
                module.read_regular(str(path), mode=0o600)
        original_read = os.read
        replaced = False
        def replace_during_read(fd, bound):
            nonlocal replaced
            body = original_read(fd, bound)
            if not replaced:
                replacement = path.with_name('replacement.json')
                self.write(replacement, self.original, 0o600)
                os.replace(replacement, path)
                replaced = True
            return body
        with mock.patch.object(module.os, 'read', side_effect=replace_during_read), self.assertRaises(ValueError):
            module.read_regular(str(path), mode=0o600)

    def command(self, action, *extra):
        return [sys.executable, str(HELPER), action, '--manifest', str(self.manifest), '--manifest-sha256', hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
                '--transaction-id', self.value['transactionId'], '--commit', self.value['commit'], '--operator-plan-sha256', self.value['operatorPlanSHA256'],
                '--runtime-commit', self.value['runtimeCommit'], '--runtime-source-sha256', self.value['runtimeSOURCEsha256'], '--gateway-sha256', self.value['gatewaySHA256'], *extra]

    def test_real_cli_exclusive_projection_and_wrongpin_no_body_disclosure(self):
        output = self.root / 'projected.json'
        first = subprocess.run(self.command('project', '--output', str(output)), capture_output=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(output.read_bytes(), self.candidate)
        before = output.stat()
        repeated = subprocess.run(self.command('project', '--output', str(output)), capture_output=True)
        self.assertNotEqual(repeated.returncode, 0)
        self.assertEqual(output.read_bytes(), self.candidate)
        self.assertEqual(output.stat(), before)
        command = self.command('project', '--output', str(self.root / 'missing.json'))
        command[command.index('--manifest-sha256') + 1] = 'd' * 64
        failure = subprocess.run(command, capture_output=True)
        self.assertNotEqual(failure.returncode, 0)
        self.assertFalse((self.root / 'missing.json').exists())
        for result in [first, repeated, failure]:
            self.assertNotIn(b'SYNTHETIC-PRIVATE-CANARY', result.stdout + result.stderr)
            self.assertNotIn(b'NOT-A-REAL-KEY', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
