#!/usr/bin/env python3
"""Prepare baseline DATA; only --install installs the fixed Caddy JSON source.

Installation changes future systemd startup configuration, never the running
Caddy process or routes. It does not qualify restart, rollback or Chain
activation. Original owner authorization remains external to this DATA CLI.
All failures retain the reserved bundle, installed partials and first cause.
"""
import argparse
import hashlib
import os
from pathlib import Path
import selectors
import stat
import subprocess
import sys
import time


CONFIG = '/etc/caddy/ynx-chain.json'
DROPIN = '/etc/systemd/system/caddy.service.d/ynx-chain-json.conf'
UNIT = '/usr/lib/systemd/system/caddy.service'
PROPERTIES = ('ActiveState', 'SubState', 'MainPID', 'FragmentPath', 'DropInPaths',
              'User', 'Group', 'ExecStart', 'ExecReload')
SHOW = ['/usr/bin/systemctl', 'show', 'caddy.service', '--no-pager', '--property=' + ','.join(PROPERTIES)]
GET = ['/usr/bin/curl', '--disable', '--request', 'GET', '--noproxy', '*', '--max-redirs', '0',
       '--connect-timeout', '5', '--max-time', '10', '--max-filesize', '16777216',
       '--fail', '--silent', '--show-error', '--url', 'http://127.0.0.1:2019/config/']
VALIDATE = ['/usr/bin/caddy', 'validate', '--config', CONFIG]
DAEMON_RELOAD = ['/usr/bin/systemctl', 'daemon-reload']


class Refusal(ValueError):
    pass


def require(ok, code):
    if not ok:
        raise Refusal(code)


def file_identity(info):
    # Reading a retained original or a fresh capture may update relatime.
    # Access time is not content identity; every mutation-sensitive field is.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def fixed_targets():
    return Path(CONFIG), Path(DROPIN)


def root_ids():
    return 0, 0


def require_root():
    require(os.geteuid() == 0, 'EXPLICIT_INSTALL_REQUIRES_ORIGINAL_ROOT_OWNER')


def original_override_paths():
    roots = ('/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system',
             '/usr/local/lib/systemd/system', '/etc/systemd/system.attached', '/run/systemd/system.attached',
             '/run/systemd/generator', '/run/systemd/generator.early', '/run/systemd/generator.late',
             '/etc/systemd/system.control', '/run/systemd/system.control', '/run/systemd/transient')
    return [(Path(root) / name, name.endswith('.d')) for root in roots
            for name in ('caddy.service', 'caddy.service.d', 'service.d')
            if str(Path(root) / name) != UNIT]


def load_producer(expected):
    path = Path(__file__).resolve().parent / 'prepare-public-bft-caddy-json-source.py'
    require(type(expected) is str and len(expected) == 64 and expected != '0' * 64
            and all(c in '0123456789abcdef' for c in expected), 'INDEPENDENT_PRODUCER_SHA256_REQUIRED')
    require(str(path.resolve(strict=True)) == str(path), 'PRODUCER_PATH_CHANGED')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and not before.st_mode & 0o022
            and 0 < before.st_size <= 256 << 10, 'BOUNDED_SAME_SOURCE_PRODUCER_REQUIRED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        require(file_identity(os.fstat(source.fileno())) == file_identity(before), 'PRODUCER_CHANGED_BEFORE_READ')
        raw = source.read((256 << 10) + 1)
        require(len(raw) == before.st_size and file_identity(os.fstat(source.fileno())) == file_identity(before)
                and file_identity(path.lstat()) == file_identity(before) and hashlib.sha256(raw).hexdigest() == expected,
                'PRODUCER_PIN_OR_IDENTITY_MISMATCH')
    module = {'__name__': 'ynx_caddy_baseline_original_producer', '__file__': str(path)}
    exec(compile(raw, str(path), 'exec'), module)
    return module, path, before


def read_capture(path, maximum):
    require(str(path.resolve(strict=True)) == str(path), 'PRIVATE_CAPTURE_PATH_CHANGED')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_uid == os.geteuid() and info.st_nlink == 1 and 0 <= info.st_size <= maximum,
            'PRIVATE_CAPTURE_FILE_REQUIRED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        require(file_identity(os.fstat(source.fileno())) == file_identity(info), 'PRIVATE_CAPTURE_CHANGED')
        raw = source.read(maximum + 1)
        require(len(raw) == info.st_size and file_identity(os.fstat(source.fileno())) == file_identity(info)
                and file_identity(path.lstat()) == file_identity(info), 'PRIVATE_CAPTURE_CHANGED')
    return raw


def execute_child(argv, stdout, stderr, maximum):
    """Bounded capture of our child only; never signal the existing Caddy PID."""
    require(argv in (SHOW, GET, VALIDATE, DAEMON_RELOAD), 'FIXED_BASELINE_COMMAND_REQUIRED')
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, close_fds=True)
    selector = selectors.DefaultSelector()
    counts = {'stdout': 0, 'stderr': 0}
    deadline = time.monotonic() + 30
    try:
        for pipe, name, target in ((child.stdout, 'stdout', stdout), (child.stderr, 'stderr', stderr)):
            selector.register(pipe, selectors.EVENT_READ, (name, target))
        while selector.get_map():
            remaining = deadline - time.monotonic()
            require(remaining > 0, 'BASELINE_CHILD_TIMEOUT')
            for key, _ in selector.select(min(remaining, 1)):
                raw = os.read(key.fileobj.fileno(), 65536)
                if not raw:
                    selector.unregister(key.fileobj)
                    continue
                name, target = key.data
                counts[name] += len(raw)
                require(counts[name] <= (maximum if name == 'stdout' else 65536), 'BASELINE_CHILD_OUTPUT_BOUND')
                target.write(raw)
        return child.wait(timeout=max(0.01, deadline - time.monotonic()))
    finally:
        selector.close()
        if child.poll() is None:
            child.kill()
        child.wait()
        child.stdout.close(); child.stderr.close()


def capture(module, shared, directory, label, argv, maximum=65536):
    require(label.replace('-', '').isalnum(), 'FIXED_CAPTURE_LABEL_REQUIRED')
    files, handles = [], []
    try:
        for name in ('stdout', 'stderr'):
            path = directory / (label + '.' + name)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            files.append(path)
            handles.append(os.fdopen(fd, 'wb'))
        code = execute_child(argv, handles[0], handles[1], maximum)
    finally:
        for handle in handles:
            handle.flush(); os.fsync(handle.fileno()); handle.close()
        module['sync_directory'](directory)
    bodies, records = [], []
    for path, bound in zip(files, (maximum, 65536)):
        raw = read_capture(path, bound)
        bodies.append(raw)
        records.append(dict(file=path.name, bytes=str(len(raw)), sha256=hashlib.sha256(raw).hexdigest()))
    module['durable'](directory / (label + '.json'), shared['canonical_config'](
        dict(returnCode=code, stdout=records[0], stderr=records[1])), 65536)
    require(code == 0, 'FIXED_BASELINE_COMMAND_FAILED')
    return bodies[0]


def show_state(raw):
    values = {}
    for line in raw.decode('utf-8').splitlines():
        require('=' in line, 'CADDY_UNIT_OBSERVATION_INVALID')
        key, value = line.split('=', 1)
        require(key in PROPERTIES and key not in values, 'CLOSED_CADDY_UNIT_OBSERVATION_REQUIRED')
        values[key] = value
    require(set(values) == set(PROPERTIES), 'COMPLETE_CADDY_UNIT_OBSERVATION_REQUIRED')
    return values


def assert_unit_state(value, baseline, installed, shared):
    require(value['ActiveState'] == 'active' and value['SubState'] == 'running'
            and value['MainPID'] == baseline['originalProcess']['pid'] and value['FragmentPath'] == UNIT
            and value['User'] == value['Group'] == 'caddy'
            and value['DropInPaths'] == (DROPIN if installed else ''), 'CADDY_ORIGINAL_UNIT_IDENTITY_MISMATCH')
    config = CONFIG if installed else '/etc/caddy/Caddyfile'
    for name, args in (('ExecStart', ['run', '--environ', '--config', config]),
                       ('ExecReload', ['reload', '--config', config, '--force'])):
        shared['validate_exec_observation'](value[name], ['/usr/bin/caddy'] + args)


def safe_parent(path, owner):
    require(str(path.resolve(strict=True)) == str(path), 'FIXED_TARGET_PARENT_SYMLINK')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & 0o022,
            'FIXED_TARGET_PARENT_OWNER_OR_PERMISSIONS')
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid


def assert_no_unknown_sources(config, dropin, installed=False):
    if not installed:
        require(not os.path.lexists(config) and not os.path.lexists(dropin), 'EXISTING_BASELINE_TARGET_OR_UNKNOWN')
    for path, directory in original_override_paths():
        if not os.path.lexists(path):
            continue
        if path == dropin.parent:
            allowed = {dropin.name} if installed else set()
        else:
            allowed = set()
        require(directory and str(path.resolve(strict=True)) == str(path) and path.is_dir()
                and set(os.listdir(path)) == allowed, 'UNKNOWN_CADDY_UNIT_SOURCE_OR_DROPIN')
        safe_parent(path, root_ids()[0])


def install_file(module, path, raw, mode, uid, gid):
    parent = safe_parent(path.parent, root_ids()[0])
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        # Ownership changes apply only to this newly reserved file descriptor.
        # Neither retained source inode nor its private parent is ever changed.
        os.fchown(output.fileno(), uid, gid)
        os.fchmod(output.fileno(), mode)
        output.write(raw); output.flush(); os.fsync(output.fileno())
    module['sync_directory'](path.parent)
    require(safe_parent(path.parent, root_ids()[0]) == parent, 'TARGET_PARENT_CHANGED')
    actual, _, _, info = module['read_file'](path, module['MAX_CONFIG'])
    require(actual == raw and stat.S_IMODE(info.st_mode) == mode and info.st_uid == uid and info.st_gid == gid,
            'EXCLUSIVE_INSTALLED_FILE_READBACK_MISMATCH')


def run(args):
    module, producer_path, producer_identity = load_producer(args.producer_sha256)
    shared, helper_path, helper_identity = module['load_helper'](args.json_helper_sha256)
    require(callable(shared.get('validate_exec_observation')), 'CADDY_EXEC_OBSERVATION_API_REQUIRED')
    binding_raw, digest, binding_identity, _ = module['read_file'](module['absolute'](args.binding), 65536, True)
    require(digest == module['pin'](args.binding_sha256), 'INDEPENDENT_BINDING_PIN_MISMATCH')
    value = shared['parse_json'](binding_raw, 65536)
    require(not module['validate_binding'](value), 'BASELINE_ONLY_INPUT_REQUIRED')
    prepared = module['prepare'](args)
    bundle = module['absolute'](args.output_dir)
    stage = 'post-preparation-binding'
    try:
        raw, digest, identity, _ = module['read_file'](module['absolute'](args.binding), 65536, True)
        require(raw == binding_raw and digest == args.binding_sha256 and identity == binding_identity,
                'INDEPENDENT_BINDING_IDENTITY_CHANGED_AFTER_PREPARATION')
        if not args.install:
            return dict(prepared, persistentStartupSource=False, chainActivation=False,
                        installerProducerSHA256=args.producer_sha256)
        stage = 'installation-owner'
        require_root()
        stage = 'installation-intent'
        intent = dict(version='YNX-CADDY-JSON-BASELINE-INSTALL/v1', status='unknown', automaticRetry=False,
            bindingSHA256=args.binding_sha256, producerSHA256=args.producer_sha256,
            jsonHelperSHA256=args.json_helper_sha256, baselineDataSHA256=prepared['baselineDataSHA256'])
        module['durable'](bundle / 'baseline-install-intent.json', shared['canonical_config'](intent), 65536)
        logs = bundle / 'commands'
        os.mkdir(logs, 0o700); module['sync_directory'](bundle)
        baseline_raw, baseline_sha, _, _ = module['read_file'](bundle / 'BASELINE_DATA.json', 65536, True)
        require(baseline_sha == prepared['baselineDataSHA256'], 'PREPARED_BASELINE_PIN_CHANGED')
        baseline = shared['parse_json'](baseline_raw, 65536)
        require(baseline == dict(value, baseline=baseline.get('baseline')), 'PREPARED_BASELINE_BINDING_CHANGED')
        original, original_sha, _, _ = module['read_file'](bundle / 'original.json', module['MAX_CONFIG'], True)
        require(original_sha == value['source']['sha256'] == baseline['baseline']['configSHA256'],
                'PREPARED_ORIGINAL_CONFIG_CHANGED')
        expected_semantic = shared['semantic_hash'](shared['parse_config'](original))
        require(expected_semantic == baseline['baseline']['semanticSHA256'], 'PREPARED_ORIGINAL_SEMANTIC_CHANGED')
        config, dropin = fixed_targets()
        uid, gid = (int(value['source']['witness'][k]) for k in ('uid', 'gid'))
        vendor_identity = module['read_original_unit'](value['originalUnit'])
        stage = 'original-loaded-source'
        def assert_installed():
            for path, raw, mode, owner, group in ((config, original, 0o600, uid, gid),
                    (dropin, shared['render_dropin'](), 0o644, *root_ids())):
                safe_parent(path.parent, root_ids()[0])
                actual, _, _, info = module['read_file'](path, module['MAX_CONFIG'])
                require(actual == raw and stat.S_IMODE(info.st_mode) == mode
                        and (info.st_uid, info.st_gid) == (owner, group), 'INSTALLED_BASELINE_CHANGED')
        def observe(label, installed):
            module['observe_process'](value['originalProcess'], uid, gid)
            assert_unit_state(value=show_state(capture(module, shared, logs, label + '-unit', SHOW)),
                              baseline=value, installed=installed, shared=shared)
            loaded = capture(module, shared, logs, label + '-loaded', GET, module['MAX_CONFIG'])
            require(shared['semantic_hash'](shared['parse_config'](loaded)) == expected_semantic,
                    'ORIGINAL_WHOLE_LOADED_JSON_CHANGED')
            require(module['read_original_unit'](value['originalUnit']) == vendor_identity,
                    'ORIGINAL_VENDOR_UNIT_CHANGED')
            for name in ('source', 'secondRead'):
                require(module['read_original_source'](value[name])[0] == original, 'RETAINED_SOURCE_CHANGED')
            module['observe_process'](value['originalProcess'], uid, gid)
        observe('before', False)
        assert_no_unknown_sources(config, dropin)
        safe_parent(config.parent, root_ids()[0]); safe_parent(dropin.parent.parent, root_ids()[0])
        if not os.path.lexists(dropin.parent):
            os.mkdir(dropin.parent, 0o755); module['sync_directory'](dropin.parent.parent)
        safe_parent(dropin.parent, root_ids()[0])
        assert_no_unknown_sources(config, dropin)
        stage = 'exclusive-config-install'
        install_file(module, config, original, 0o600, uid, gid)
        stage = 'exclusive-dropin-install'
        install_file(module, dropin, shared['render_dropin'](), 0o644, *root_ids())
        stage = 'validate-fixed-json'
        capture(module, shared, logs, 'validate', VALIDATE)
        stage = 'before-daemon-reload'
        observe('pre-daemon', False)
        assert_installed()
        assert_no_unknown_sources(config, dropin, True)
        stage = 'daemon-reload-only'
        capture(module, shared, logs, 'daemon-reload', DAEMON_RELOAD)
        stage = 'persistent-source-readback'
        observe('after', True)
        assert_no_unknown_sources(config, dropin, True)
        assert_installed()
        raw, digest, identity, _ = module['read_file'](module['absolute'](args.binding), 65536, True)
        require(raw == binding_raw and digest == args.binding_sha256 and identity == binding_identity,
                'INDEPENDENT_BINDING_IDENTITY_CHANGED')
        _, digest, identity, _ = module['read_file'](producer_path, 256 << 10)
        require(digest == args.producer_sha256 and identity == file_identity(producer_identity),
                'PRODUCER_CHANGED_AFTER_INSTALL')
        _, digest, identity, _ = module['read_file'](helper_path, 256 << 10)
        require(digest == args.json_helper_sha256 and identity == helper_identity, 'HELPER_CHANGED_AFTER_INSTALL')
        receipt = dict(intent, status='persistent-startup-source-installed', persistentStartupSource=True,
            configPath=CONFIG, dropInPath=DROPIN, originalSHA256=original_sha,
            originalSemanticSHA256=expected_semantic, originalPID=value['originalProcess']['pid'],
            originalStartTicks=value['originalProcess']['startTicks'], liveConfigUnchanged=True,
            daemonReloadOnly=True, caddyReloaded=False, caddyRestarted=False, routesChanged=False,
            restartRecovery=False, rollbackVerified=False, chainActivation=False, rootGrant=False,
            publicDeployment=False)
        module['durable'](bundle / 'baseline-install-receipt.json', shared['canonical_config'](receipt), 65536)
        return receipt
    except Exception as error:
        # No cleanup or automatic rollback to the original unsafe disk stub.
        failure = dict(version='YNX-CADDY-JSON-BASELINE-INSTALL/v1', status='unknown', automaticRetry=False,
            firstCause=stage, errorCode=str(error) if isinstance(error, (Refusal, module['Refusal'])) else type(error).__name__,
            persistentStartupSource=False, restartRecovery=False, rollbackVerified=False, chainActivation=False)
        try:
            module['durable'](bundle / 'baseline-install-failure.json', shared['canonical_config'](failure), 65536)
        except Exception:
            pass
        raise


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('binding', 'binding-sha256', 'producer-sha256', 'json-helper-sha256', 'output-dir'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args(argv)
    try:
        require(all(sum(x.split('=', 1)[0] == '--' + name for x in argv) == 1
                    for name in ('binding', 'binding-sha256', 'producer-sha256', 'json-helper-sha256', 'output-dir'))
                and argv.count('--install') <= 1, 'DUPLICATE_INSTALLER_OPTION_REFUSED')
        result = run(args)
        import json
        print(json.dumps(result, sort_keys=True, separators=(',', ':')))
        return 0
    except Exception as error:
        print(str(error) if isinstance(error, Refusal) else 'CADDY_JSON_BASELINE_INSTALL_REFUSED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
