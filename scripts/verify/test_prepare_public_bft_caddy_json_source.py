#!/usr/bin/env python3
"""Private synthetic DATA fixtures; no Caddy, network, key or service is used.

The production source reader, renderer and consumer run unchanged. Only fixed
read-only /proc observations and the original /usr/lib fragment file location
are isolated to the fixture. No test flag weakens the production CLI.
"""
import argparse
from contextlib import redirect_stderr, redirect_stdout
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


REPO = Path(__file__).resolve().parents[2]
PRODUCER = REPO / 'scripts/ops/prepare-public-bft-caddy-json-source.py'
HELPER = REPO / 'scripts/ops/remote/public-bft-caddy-json.py'
spec = importlib.util.spec_from_file_location('caddy_json_source_preparation', PRODUCER)
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)
REAL_OBSERVE_PROCESS = producer.observe_process
spec = importlib.util.spec_from_file_location('caddy_json_source_consumer', HELPER)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
CANARY = 'PRIVATE_CADDY_VALUE_MUST_NEVER_APPEAR_ON_STDOUT_OR_STDERR'
TESTNET_POINTER = '/apps/http/servers/srv0/routes/16/handle/0/routes/0/handle/0/upstreams/0/dial'
RPC_POINTER = '/apps/http/servers/srv0/routes/38/handle/0/routes/2/handle/0/routes/0/handle/0/upstreams/0/dial'
BRIDGE_POINTER = '/apps/http/servers/srv0/routes/38/handle/0/routes/0/handle/0/routes/1/handle/0/upstreams/0/dial'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def put(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(raw)


def proxy(port):
    return {'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:' + str(port)}]}


def route(host, handler):
    return {'match': [{'host': [host]}], 'handle': [handler]}


def pointer(value, path):
    current = value
    for part in path[1:].split('/'):
        current = current[int(part)] if type(current) is list else current[part]
    return current


def config_fixture():
    # These exact two 6420 pointers and the separate 6433 bridge branch follow
    # the approved metadata-only structure, never a copy of private JSON.
    routes = [route('unrelated-%d.invalid' % n, proxy(6420)) for n in range(39)]
    routes[16] = route('rpc-testnet.ynxweb4.com', {'handler': 'subroute', 'routes': [{'handle': [proxy(6420)]}]})
    routes[38] = route('rpc.ynxweb4.com', {'handler': 'subroute', 'routes': [
        {'handle': [{'handler': 'subroute', 'routes': [
            {'handle': [{'handler': 'static_response', 'body': CANARY}]},
            {'match': [{'path': ['/bridge/health']}], 'handle': [proxy(6433)]}]}]},
        {'handle': [{'handler': 'static_response', 'body': 'preserved'}]},
        {'handle': [{'handler': 'subroute', 'routes': [{'handle': [proxy(6420)]}]}]}]})
    return {'admin': {'listen': '127.0.0.1:2019'}, 'apps': {'http': {'servers': {
        'srv0': {'listen': [':443'], 'routes': routes}}}},
        'logging': {'logs': {'private': {'writer': {'output': 'file', 'filename': CANARY}}}}}


class Fixture:
    def __init__(self, parent):
        self.root = parent
        self.sources = parent / 'originals'
        self.sources.mkdir(mode=0o700)
        self.output_parent = parent / 'prepared'
        self.output_parent.mkdir(mode=0o700)
        self.output = self.output_parent / 'new-bundle'
        self.first, self.second = self.sources / 'read1.json', self.sources / 'read2.json'
        self.config = config_fixture()
        self.raw = (json.dumps(self.config, indent=2, ensure_ascii=True) + '\n').encode()
        put(self.first, self.raw); put(self.second, self.raw)
        self.unit = parent / 'original-caddy.service'
        put(self.unit, b'[Unit]\nDescription=Original Caddy fixture\n[Service]\nUser=caddy\nGroup=caddy\n'
            b'ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile\n'
            b'ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force\n')
        self.process = dict(pid='1432803', startTicks='905926894', argv=list(producer.ARGV))
        def source(path):
            return dict(path=str(path), bytes=str(len(self.raw)), sha256=sha(self.raw),
                        witness=producer.witness(path.lstat()))
        self.binding = dict(version=producer.VERSION, transactionId='original-rpc-source-fixture',
            commit='0123456789ab', operatorPlanSHA256='a' * 64,
            runtimeCommit='0123456789abcdef0123456789abcdef01234567',
            runtimeSOURCEsha256='b' * 64, gatewaySHA256='c' * 64,
            source=source(self.first), secondRead=source(self.second),
            originalProcess=copy.deepcopy(self.process),
            originalUnit=dict(path=producer.UNIT, sha256=sha(self.unit.read_bytes())),
            rpcUpstreams=[dict(pointer=TESTNET_POINTER, host='rpc-testnet.ynxweb4.com',
                **{'from': '127.0.0.1:6420', 'to': '127.0.0.1:27620'}),
                dict(pointer=RPC_POINTER, host='rpc.ynxweb4.com',
                **{'from': '127.0.0.1:6420', 'to': '127.0.0.1:27620'})])
        self.binding_path = parent / 'independent-binding.json'
        self.process_reads = 0
        self.save_binding()

    def save_binding(self, raw=None):
        if self.binding_path.exists():
            self.binding_path.unlink()
        put(self.binding_path, shared.canonical_config(self.binding) if raw is None else raw)

    def args(self):
        return argparse.Namespace(binding=str(self.binding_path), binding_sha256=sha(self.binding_path.read_bytes()),
            json_helper_sha256=sha(HELPER.read_bytes()), output_dir=str(self.output))

    def observe(self, expected, uid, gid):
        self.process_reads += 1
        producer.require(expected == self.process and uid == os.geteuid() and gid == os.getegid(),
                         'FIXTURE_OBSERVED_PROCESS_IDENTITY_DIFFERS')

    def read_file(self, real_read, path, *args, **kwargs):
        return real_read(self.unit if str(path) == producer.UNIT else path, *args, **kwargs)


class PrepareCaddyJSONSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ynx-caddy-prepare-')
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(Path(self.temp.name))
        original_read = producer.read_file
        patcher = mock.patch.object(producer, 'read_file',
            side_effect=lambda path, *a, **kw: self.f.read_file(original_read, path, *a, **kw))
        patcher.start(); self.addCleanup(patcher.stop)
        patcher = mock.patch.object(producer, 'observe_process', side_effect=self.f.observe)
        patcher.start(); self.addCleanup(patcher.stop)

    def call_main(self, args=None):
        args = self.f.args() if args is None else args
        argv = ['--binding', args.binding, '--binding-sha256', args.binding_sha256,
                '--json-helper-sha256', args.json_helper_sha256, '--output-dir', args.output_dir]
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = producer.main(argv)
        self.assertNotIn(CANARY, out.getvalue() + err.getvalue())
        return code, out.getvalue(), err.getvalue()

    def test_full_normal_cli_and_actual_consumer_preserve_original_routes(self):
        before = [(p.read_bytes(), producer.identity(p.lstat())) for p in (self.f.first, self.f.second, self.f.unit)]
        code, out, err = self.call_main()
        self.assertEqual((code, err), (0, ''))
        receipt = json.loads(out)
        self.assertTrue(receipt['fullCutoverManifestProduced'])
        self.assertIsNone(receipt['baselineDataSHA256'])
        for key in ('publicDeployment', 'rootGrant', 'restartRecovery', 'rollbackVerified',
                    'installed', 'serviceCommandsPerformed', 'automaticRetry'):
            self.assertIs(receipt[key], False)
        manifest_raw = (self.f.output / 'manifest.json').read_bytes()
        value, original, candidate = shared.validate_manifest(manifest_raw,
            expected={k: self.f.binding[k] for k in ('transactionId', 'commit', 'operatorPlanSHA256',
                'runtimeCommit', 'runtimeSOURCEsha256', 'gatewaySHA256')})
        self.assertEqual(set(value), producer.BINDING_FIELDS | {'baseline'})
        self.assertEqual(receipt['manifestSHA256'], sha(manifest_raw))
        self.assertEqual(original, self.f.raw)
        self.assertEqual((self.f.output / 'original.json').read_bytes(), self.f.raw)
        self.assertEqual((self.f.output / 'candidate.json').read_bytes(), candidate)
        projected = shared.parse_config(candidate)
        self.assertEqual(value['baseline']['candidateSemanticSHA256'], shared.semantic_hash(projected))
        self.assertEqual(pointer(projected, BRIDGE_POINTER), '127.0.0.1:6433')
        for entry in self.f.binding['rpcUpstreams']:
            self.assertEqual(pointer(projected, entry['pointer']), entry['to'])
        restored = copy.deepcopy(projected)
        for entry in self.f.binding['rpcUpstreams']:
            parts = entry['pointer'].rsplit('/', 1)
            pointer(restored, parts[0])['dial'] = entry['from']
        self.assertEqual(restored, self.f.config)
        self.assertEqual((self.f.output / 'ynx-chain-json.conf').read_bytes(), shared.render_dropin())
        self.assertFalse((self.f.output / 'BASELINE_DATA.json').exists())
        self.assertEqual(before, [(p.read_bytes(), producer.identity(p.lstat())) for p in (self.f.first, self.f.second, self.f.unit)])
        self.assertEqual(self.f.process_reads, 2)
        self.assertEqual(self.f.output.stat().st_mode & 0o777, 0o700)
        for path in self.f.output.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_baseline_only_has_no_protocol_identity_or_cutover_manifest(self):
        self.f.binding = {k: v for k, v in self.f.binding.items() if k in producer.BASELINE_FIELDS}
        self.f.binding['version'] = producer.BASELINE_VERSION
        self.f.save_binding()
        code, out, err = self.call_main()
        self.assertEqual((code, err), (0, ''))
        receipt = json.loads(out)
        self.assertIs(receipt['fullCutoverManifestProduced'], False)
        self.assertIsNone(receipt['manifestSHA256'])
        self.assertNotIn('transactionId', receipt)
        self.assertNotIn('commit', receipt)
        baseline = (self.f.output / 'BASELINE_DATA.json').read_bytes()
        value = shared.parse_json(baseline, 65536)
        self.assertEqual(set(value), producer.BASELINE_FIELDS | {'baseline'})
        self.assertEqual(receipt['baselineDataSHA256'], sha(baseline))
        self.assertFalse((self.f.output / 'manifest.json').exists())
        with self.assertRaises(ValueError):
            shared.validate_manifest(baseline)
        self.assertEqual((self.f.output / 'original.json').read_bytes(), self.f.raw)

    def test_full_binding_missing_protocol_pin_cannot_produce_cutover_manifest(self):
        del self.f.binding['operatorPlanSHA256']
        self.f.save_binding()
        code, out, _ = self.call_main()
        self.assertEqual((code, out), (1, ''))
        self.assertFalse(self.f.output.exists())

    def test_baseline_version_rejects_smuggled_protocol_authority(self):
        self.f.binding['version'] = producer.BASELINE_VERSION
        self.f.save_binding()
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())

    def test_binding_pin_helper_pin_and_duplicate_json_are_rejected_without_output(self):
        good = self.f.args()
        for field in ('binding_sha256', 'json_helper_sha256'):
            with self.subTest(field=field):
                bad = copy.copy(good)
                setattr(bad, field, 'd' * 64)
                self.assertEqual(self.call_main(bad)[0], 1)
                self.assertFalse(self.f.output.exists())
        self.f.save_binding(b'{"version":"' + producer.VERSION.encode() + b'","version":"' + CANARY.encode() + b'"}')
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())

    def test_source_witness_identity_and_permissions_cannot_be_self_reported(self):
        original = copy.deepcopy(self.f.binding)
        for field, replacement in (('inode', '123456789'), ('mtimeNs', '1'), ('ctimeNs', '1'),
                                   ('uid', str(os.geteuid() + 1)), ('mode', '640')):
            with self.subTest(field=field):
                self.f.binding = copy.deepcopy(original)
                self.f.binding['source']['witness'][field] = replacement
                self.f.save_binding()
                self.assertEqual(self.call_main()[0], 1)
                self.assertFalse(self.f.output.exists())
        self.f.binding = original
        self.f.save_binding()
        self.f.first.chmod(0o640)
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())

    def test_source_symlink_and_shared_inode_are_rejected(self):
        self.f.first.unlink()
        self.f.first.symlink_to(self.f.second)
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())
        self.f.first.unlink()
        os.link(self.f.second, self.f.first)
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())

    def test_wrong_source_body_and_invalid_json_cannot_leak_parser_input(self):
        self.f.first.write_bytes(b'{"private":"' + CANARY.encode() + b'",BROKEN}')
        self.f.second.write_bytes(self.f.first.read_bytes())
        for name, path in (('source', self.f.first), ('secondRead', self.f.second)):
            self.f.binding[name] = dict(path=str(path), bytes=str(path.stat().st_size),
                sha256=sha(path.read_bytes()), witness=producer.witness(path.lstat()))
        self.f.save_binding()
        code, out, err = self.call_main()
        self.assertEqual((code, out), (1, ''))
        self.assertEqual(err.strip(), 'CADDY_JSON_SOURCE_PREPARATION_REFUSED')
        self.assertFalse(self.f.output.exists())

    def test_projection_rejects_bridge_wrong_host_and_ambiguous_path(self):
        original = copy.deepcopy(self.f.binding)
        for change in ('bridge', 'foreign_host', 'noncanonical_pointer', 'already_candidate'):
            with self.subTest(change=change):
                self.f.binding = copy.deepcopy(original)
                item = self.f.binding['rpcUpstreams'][1]
                if change == 'bridge':
                    item['pointer'] = BRIDGE_POINTER
                elif change == 'foreign_host':
                    item['host'] = 'paused-product.invalid'
                elif change == 'noncanonical_pointer':
                    item['pointer'] = RPC_POINTER.replace('/38/', '/038/')
                else:
                    item['from'] = '127.0.0.1:27620'
                self.f.save_binding()
                self.assertEqual(self.call_main()[0], 1)
                self.assertFalse(self.f.output.exists())

    def test_original_process_or_unit_pin_mismatch_is_not_a_prepared_result(self):
        self.f.binding['originalProcess']['startTicks'] = '905926895'
        self.f.save_binding()
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())
        self.f.binding['originalProcess'] = copy.deepcopy(self.f.process)
        self.f.binding['originalUnit']['sha256'] = 'd' * 64
        self.f.save_binding()
        self.assertEqual(self.call_main()[0], 1)
        self.assertFalse(self.f.output.exists())

    def test_actual_proc_reader_rejects_start_or_argv_change(self):
        # Isolate only the fixed kernel namespace paths. Both the production
        # observer and its bounded stat/cmdline reader execute normally.
        process_dir = Path(self.temp.name) / 'proc-original'
        process_dir.mkdir(mode=0o700)
        raw_stat = b'1432803 (caddy) S ' + b'0 ' * 18 + b'905926894 0\n'
        put(process_dir / 'stat', raw_stat)
        put(process_dir / 'status', ('Name:\tcaddy\nUid:\t' + '\t'.join([str(os.geteuid())] * 4)
            + '\nGid:\t' + '\t'.join([str(os.getegid())] * 4) + '\n').encode())
        put(process_dir / 'cmdline', b'\0'.join(x.encode() for x in producer.ARGV) + b'\0')
        owner, executable = process_dir.lstat(), self.f.unit.stat()
        real_lstat, real_stat, real_proc_read = Path.lstat, Path.stat, producer.proc_bytes
        base = '/proc/' + self.f.process['pid']
        def lstat(path, *args, **kwargs):
            return owner if str(path) == base else real_lstat(path, *args, **kwargs)
        def file_stat(path, *args, **kwargs):
            return executable if str(path) in (base + '/exe', '/usr/bin/caddy') else real_stat(path, *args, **kwargs)
        def proc_read(path, maximum):
            self.assertEqual(str(path.parent), base)
            return real_proc_read(process_dir / path.name, maximum)
        with mock.patch.object(Path, 'lstat', new=lstat), mock.patch.object(Path, 'stat', new=file_stat), \
                mock.patch.object(producer, 'proc_bytes', side_effect=proc_read), \
                mock.patch.object(os, 'readlink', return_value='/usr/bin/caddy'):
            REAL_OBSERVE_PROCESS(self.f.process, os.geteuid(), os.getegid())
            with self.assertRaisesRegex(producer.Refusal, 'OWNER_MISMATCH'):
                REAL_OBSERVE_PROCESS(self.f.process, os.geteuid() + 1, os.getegid())
            (process_dir / 'stat').write_bytes(raw_stat.replace(b'905926894', b'905926895'))
            with self.assertRaisesRegex(producer.Refusal, 'START_CHANGED'):
                REAL_OBSERVE_PROCESS(self.f.process, os.geteuid(), os.getegid())
            (process_dir / 'stat').write_bytes(raw_stat)
            (process_dir / 'cmdline').write_bytes(b'/usr/bin/caddy\0run\0--resume\0')
            with self.assertRaisesRegex(producer.Refusal, 'ARGV_CHANGED'):
                REAL_OBSERVE_PROCESS(self.f.process, os.geteuid(), os.getegid())

    def test_existing_unknown_sidecar_refuses_before_source_observation(self):
        sidecar = Path(str(self.f.output) + '.UNKNOWN')
        put(sidecar, b'original unknown result\n')
        with mock.patch.object(producer, 'read_original_source', side_effect=AssertionError('must not re-read/retry')):
            self.assertEqual(self.call_main()[0], 1)
        self.assertEqual(sidecar.read_bytes(), b'original unknown result\n')
        self.assertEqual(self.f.process_reads, 0)

    def test_mid_preparation_data_write_failure_retains_partial_and_never_retries(self):
        original = producer.durable
        def fail_candidate(path, raw, maximum):
            if path.name == 'candidate.json':
                raise producer.Refusal('INJECTED_EXCLUSIVE_WRITE_FAILURE')
            return original(path, raw, maximum)
        with mock.patch.object(producer, 'durable', side_effect=fail_candidate):
            self.assertEqual(self.call_main()[0], 1)
        self.assertEqual((self.f.output / 'original.json').read_bytes(), self.f.raw)
        self.assertEqual(json.loads((self.f.output / 'intent.json').read_bytes())['status'], 'unknown')
        self.assertFalse((self.f.output / 'receipt.json').exists())
        with mock.patch.object(producer, 'read_original_source', side_effect=AssertionError('UNKNOWN must not retry')):
            self.assertEqual(self.call_main()[0], 1)
        self.assertEqual((self.f.output / 'original.json').read_bytes(), self.f.raw)

    def test_source_race_after_reservation_retains_every_partial_without_receipt(self):
        original = producer.durable
        def race(path, raw, maximum):
            result = original(path, raw, maximum)
            if path.name == 'manifest.json':
                self.f.second.write_bytes(self.f.raw + b' ')
            return result
        with mock.patch.object(producer, 'durable', side_effect=race):
            self.assertEqual(self.call_main()[0], 1)
        for name in ('intent.json', 'original.json', 'candidate.json', 'ynx-chain-json.conf', 'manifest.json'):
            self.assertTrue((self.f.output / name).exists())
        self.assertFalse((self.f.output / 'receipt.json').exists())
        self.assertEqual((self.f.output / 'original.json').read_bytes(), self.f.raw)

    def test_late_process_change_keeps_unknown_not_restart_or_rollback_success(self):
        def changing(expected, uid, gid):
            self.f.observe(expected, uid, gid)
            producer.require(self.f.process_reads == 1, 'INJECTED_PROCESS_RESTART')
        with mock.patch.object(producer, 'observe_process', side_effect=changing):
            self.assertEqual(self.call_main()[0], 1)
        self.assertTrue((self.f.output / 'manifest.json').exists())
        self.assertFalse((self.f.output / 'receipt.json').exists())


if __name__ == '__main__':
    unittest.main()
