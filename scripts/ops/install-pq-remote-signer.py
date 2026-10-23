#!/usr/bin/env python3
"""Validate public remote-signer installation DATA; install only with --install.

The independent pins and explicit invocation come from the existing operator,
not a custody review packet. This neither creates/recover keys nor starts,
enables or reloads any service. Normal startup still performs every original
key, credential, checkpoint, registry, engine and HRS authorization check.
"""
import argparse
import base64
import grp
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys


DAEMON = 'ynx-consensus-pq-remote-signer'
SERVICE = DAEMON + '.service'
TARGETS = {'binary': '/usr/local/libexec/' + DAEMON,
           'launcher': '/usr/local/libexec/' + DAEMON + '-launch',
           'config': '/etc/ynx/consensus-pq-remote-signer.conf',
           'unit': '/etc/systemd/system/' + SERVICE}
CREDENTIAL = '/etc/credstore.encrypted/ynx-pq-recovery'
TEMPLATES = (DAEMON + '.service.in', DAEMON + '-launch.sh', DAEMON + '.conf.in')


def need(ok, code):
    if not ok:
        raise ValueError(code)


def unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, 'DUPLICATE_JSON_FIELD')
        value[key] = item
    return value


def decode(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: need(False, 'INVALID_JSON_CONSTANT'))


def pin(value):
    need(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64,
         'INDEPENDENT_NONZERO_SHA256_REQUIRED')
    return value


def path(value):
    need(type(value) is str and value != '/' and re.fullmatch('/[A-Za-z0-9_./-]+', value)
         and str(Path(value)) == value and '..' not in Path(value).parts, 'CANONICAL_ORIGINAL_PATH_REQUIRED')
    return Path(value)


def ident(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def regular(filename, maximum, private_uid=None, minimum=1):
    filename = Path(filename)
    need(str(filename.resolve(strict=True)) == str(filename), 'ORIGINAL_SYMLINK_OR_PATH_REPLACED')
    info = filename.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o022
         and minimum <= info.st_size <= maximum, 'ORIGINAL_REGULAR_FILE_METADATA_REQUIRED')
    if private_uid is not None:
        need(info.st_uid == private_uid and stat.S_IMODE(info.st_mode) == 0o600,
             'ORIGINAL_SERVICE_OWNED_0600_FILE_REQUIRED')
    return info


def read(filename, maximum, retain=True):
    info = regular(filename, maximum)
    digest, chunks, size = hashlib.sha256(), [], 0
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        need(ident(info) == ident(os.fstat(source.fileno())), 'ORIGINAL_CHANGED_BEFORE_READ')
        while True:
            chunk = source.read(65536)
            if not chunk:
                break
            size += len(chunk)
            need(size <= maximum, 'ORIGINAL_EXCEEDS_BOUND')
            digest.update(chunk)
            if retain:
                chunks.append(chunk)
        need(size == info.st_size and ident(info) == ident(os.fstat(source.fileno()))
             and ident(info) == ident(Path(filename).lstat()), 'ORIGINAL_CHANGED_DURING_READ')
    return digest.hexdigest(), b''.join(chunks), ident(info)


def pinned(filename, expected, maximum):
    actual, raw, identity = read(filename, maximum)
    need(actual == pin(expected), 'INDEPENDENT_INPUT_PIN_MISMATCH')
    return decode(raw), raw, identity


class LocalHost:
    """Only bounded, fixed read-only system observations; no service mutation."""
    def command(self, argv, accepted=(0,)):
        completed = subprocess.run(argv, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False)
        need(completed.returncode in accepted and len(completed.stdout) <= 65536, 'HOST_OBSERVATION_FAILED_OR_EXCEEDS_BOUND')
        return completed.stdout.decode('utf-8').strip()

    def account(self):
        user, group = pwd.getpwnam('ynx-pq-signer'), grp.getgrnam('ynx-pq-signer')
        need(user.pw_uid > 0 and group.gr_gid > 0 and user.pw_gid == group.gr_gid,
             'EXISTING_DEDICATED_SIGNER_ACCOUNT_REQUIRED')
        return user.pw_uid, group.gr_gid

    def observe(self, provider):
        version = self.command(['/usr/bin/systemctl', 'show', '--property=Version', '--value'])
        need(re.fullmatch(r'[0-9]+[^\n]*', version) and int(re.match('[0-9]+', version)[0]) >= 250,
             'EXISTING_SYSTEMD_250_REQUIRED')
        provider_state = self.command(['/usr/bin/systemctl', 'show', provider, '--property=LoadState', '--property=ActiveState'])
        need(unique(line.split('=', 1) for line in provider_state.splitlines()) == {'LoadState': 'loaded', 'ActiveState': 'active'},
             'EXISTING_REAL_CHECKPOINT_PROVIDER_REQUIRED')
        active = self.command(['/usr/bin/systemctl', 'show', SERVICE, '--property=LoadState', '--property=ActiveState', '--property=DropInPaths'], (0, 4))
        need(unique(line.split('=', 1) for line in active.splitlines()) == {'LoadState': 'not-found', 'ActiveState': 'inactive', 'DropInPaths': ''},
             'EXISTING_SIGNER_UNIT_OR_PROCESS_MUST_BE_RETAINED')

    def destination(self, filename):
        return Path(filename)

    def root(self):
        return os.geteuid() == 0 and sys.platform.startswith('linux')

    def chown(self, filename, uid, gid):
        os.chown(filename, uid, gid, follow_symlinks=False)

    def private_stat(self, filename, maximum, uid, minimum=1):
        return regular(filename, maximum, uid, minimum)

    def installed_metadata(self, filename, uid, gid, mode):
        info = Path(filename).lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
             and info.st_gid == gid and stat.S_IMODE(info.st_mode) == mode, 'INSTALLED_OWNER_OR_MODE_MISMATCH')

    def trusted(self, directory, uid):
        directory = Path(directory)
        while True:
            info = directory.lstat()
            need(directory.resolve(strict=True) == directory and stat.S_ISDIR(info.st_mode)
                 and info.st_uid in (0, uid) and not info.st_mode & 0o022, 'ORIGINAL_TRUSTED_PARENT_REQUIRED')
            if directory == directory.parent:
                break
            directory = directory.parent


def runtime_inputs(args):
    root = path(args.runtime_bundle)
    need(re.fullmatch('[0-9a-f]{40}', args.runtime_commit or '') and args.runtime_commit != '0' * 40,
         'INDEPENDENT_RUNTIME_COMMIT_REQUIRED')
    pin(args.runtime_source_sha256)
    # Reuse the unchanged normal deployer's v2 parser, not another manifest
    # allowlist. Sourcing only defines functions; it cannot start deployment.
    parser = Path(__file__).resolve().parents[1] / 'deploy/deploy-consensus-candidate.sh'
    regular(parser, 1 << 20)
    result = subprocess.run(['/bin/bash', '-c', 'set -Eeuo pipefail; source "$1"; validate_runtime_bundle "$2" "$3" "$4"',
        'ynx-signer-runtime-data', str(parser), str(root), args.runtime_commit, args.runtime_source_sha256],
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=120, check=False)
    need(result.returncode == 0, 'ORIGINAL_RUNTIME_V2_PARSER_REFUSED')
    source, _, _ = pinned(root / 'SOURCE.json', args.runtime_source_sha256, 128 << 10)
    actual, binary, _ = read(root / DAEMON, 128 << 20)
    need(actual == source['binaries'][DAEMON]['sha256'], 'RUNTIME_BINARY_CHANGED')
    templates = {}
    for name in TEMPLATES:
        actual, raw, _ = read(root / 'operator' / name, 1 << 20)
        need(actual == source['operator'][name]['sha256'], 'ORIGINAL_TEMPLATE_CHANGED')
        templates[name] = raw
    return source, binary, templates


def rendered(args, source, templates):
    config, config_raw, _ = pinned(path(args.config), args.config_sha256, 16384)
    template = decode(templates[DAEMON + '.conf.in'])
    need(type(config) is dict and set(config) == set(template) and config.get('schema') == template.get('schema')
         and config['schema'] == 'ynx-pq-remote-service-v1', 'ORIGINAL_CLOSED_CONFIG_REQUIRED')
    need(all(type(v) is str and '@' not in v for k, v in config.items() if k != 'timeoutSeconds')
         and type(config['timeoutSeconds']) is int and 1 <= config['timeoutSeconds'] <= 60,
         'ORIGINAL_CONFIG_FIELD_TYPES_REQUIRED')
    for key in ('binarySHA256', 'bindingSHA256', 'cometGenesisSHA256', 'enginePeerPublicKey', 'legacyKeySHA256',
                'memoryBudgetEvidenceSHA256', 'migrationStateHash', 'originalGenesisHash', 'scheduleHash',
                'transportKeySHA256', 'vaultSHA256'):
        pin(config[key])
    need(config['binary'] == TARGETS['binary'] and config['binarySHA256'] == source['binaries'][DAEMON]['sha256'],
         'CONFIG_DOES_NOT_BIND_NORMAL_RUNTIME_BINARY')
    need(config['checkpointFormat'] in ('atomic-committed-json-v1', 'snapshot-journal-v1', 'block-journal-v2'),
         'EXPLICIT_ORIGINAL_CHECKPOINT_FORMAT_REQUIRED')
    provider = config['checkpointProviderUnit']
    need(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.(service|mount)', provider) and provider != SERVICE,
         'EXPLICIT_ORIGINAL_PROVIDER_REQUIRED')
    for key in ('memoryMaxBytes', 'goMemoryLimitBytes'):
        need(re.fullmatch('[1-9][0-9]{0,17}', config[key]), 'EXPLICIT_TARGET_MEMORY_BUDGET_REQUIRED')
    need(int(config['goMemoryLimitBytes']) < int(config['memoryMaxBytes']), 'TARGET_MEMORY_HEADROOM_REQUIRED')
    need((config['runtimePlan'] == '') == (config['runtimePlanHash'] == ''), 'COMPLETE_RUNTIME_PLAN_PAIR_REQUIRED')
    if config['runtimePlan']:
        path(config['runtimePlan']); pin(config['runtimePlanHash'])
    endpoint = re.fullmatch(r'tcp://(\[[0-9a-f:]+\]|[0-9.]+):([1-9][0-9]{0,4})', config['listen'])
    need(endpoint is not None and int(endpoint[2]) <= 65535, 'CANONICAL_PRIVATE_ENDPOINT_REQUIRED')
    address = ipaddress.ip_address(endpoint[1].strip('[]'))
    private = address.is_loopback or any(address in ipaddress.ip_network(network) for network in
        (('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16') if address.version == 4 else ('fc00::/7',)))
    need(private and str(address) == endpoint[1].strip('[]'), 'PRIVATE_SIGNER_ENDPOINT_REQUIRED')
    for key in ('abciState', 'binding', 'checkpointDirectory', 'enginePeerPin', 'genesis', 'legacyKey', 'legacyState',
                'memoryBudgetEvidence', 'migration', 'pqState', 'schedule', 'transportKey', 'vault'):
        path(config[key])
    public_dir = path(args.operator_inputs_directory)
    replacements = {'CHECKPOINT_PROVIDER_UNIT': provider, 'CHECKPOINT_DIRECTORY': config['checkpointDirectory'],
        'OPERATOR_INPUTS_DIRECTORY': str(public_dir), 'ORIGINAL_VAULT': config['vault'], 'ORIGINAL_LEGACY_KEY': config['legacyKey'],
        'ORIGINAL_TRANSPORT_KEY': config['transportKey'], 'ORIGINAL_PQ_HRS_DIRECTORY': str(Path(config['pqState']).parent),
        'ORIGINAL_LEGACY_HRS_DIRECTORY': str(Path(config['legacyState']).parent), 'MEASURED_TARGET_MEMORY_MAX_BYTES': config['memoryMaxBytes']}
    unit = templates[DAEMON + '.service.in'].decode('utf-8')
    tokens = set(re.findall('@([A-Z0-9_]+)@', unit))
    need(tokens == set(replacements), 'ORIGINAL_UNIT_TEMPLATE_TOKEN_SET_CHANGED')
    unit = re.sub('@([A-Z0-9_]+)@', lambda m: replacements[m[1]], unit).encode()
    need(hashlib.sha256(unit).hexdigest() == pin(args.unit_sha256), 'INDEPENDENT_RENDERED_UNIT_PIN_MISMATCH')
    canonical = (json.dumps(config, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
    return config, config_raw, canonical, unit


def original_inputs(args, config, host, uid):
    plan, _, _ = pinned(path(args.operator_plan), args.operator_plan_sha256, 96 << 20)
    required = {'version', 'chainId', 'validatorManifestSHA256', 'consensusGenesis', 'consensusGenesisSHA256',
        'originalGenesisHash', 'migrationStateHash', 'stateLayout', 'runtimePlan', 'runtimePlanHash',
        'pqSchedule', 'pqScheduleHash', 'roles'}
    need(type(plan) is dict and required <= set(plan) and set(plan) <= required | {'heightHaltSessionId'}
         and plan['version'] == 'YNX-PRODUCTION-OPERATOR/v1', 'ORIGINAL_PINNED_OPERATOR_PLAN_REQUIRED')
    need(type(plan['roles']) is list and {r['role'] for r in plan['roles']} == {'primary', 'singapore', 'silicon-valley', 'seoul'}
         and len(plan['roles']) == 4, 'ORIGINAL_FOUR_OPERATOR_ROLES_REQUIRED')
    roles = [r for r in plan['roles'] if r['role'] == args.role]
    need(len(roles) == 1, 'EXPLICIT_ORIGINAL_OPERATOR_ROLE_REQUIRED')
    role = roles[0]
    need(role['remoteSigner'] == config['listen'] and role['legacyKeyPath'] == config['legacyKey']
         and role['legacyStatePath'] == config['legacyState'], 'ORIGINAL_PLAN_ENDPOINT_OR_HISTORY_MISMATCH')
    pin(role['signerPeerPublicKey'])  # Signer public key; NEVER the reverse engine peer.
    need(config['cometGenesisSHA256'] == plan['consensusGenesisSHA256']
         and config['originalGenesisHash'] == plan['originalGenesisHash'] and config['migrationStateHash'] == plan['migrationStateHash']
         and config['scheduleHash'] == plan['pqScheduleHash'] and config['runtimePlanHash'] == plan['runtimePlanHash'],
         'ORIGINAL_PLAN_GENESIS_MIGRATION_OR_SCHEDULE_MISMATCH')
    identities = {}
    def public(filename, maximum):
        measured, raw, ident_value = read(Path(filename), maximum)
        identities[filename] = ident_value
        return measured, raw
    digest, raw = public(config['genesis'], 64 << 20)
    need(digest == config['cometGenesisSHA256'] and raw == base64.b64decode(plan['consensusGenesis'], validate=True),
         'ORIGINAL_GENESIS_RAW_BYTES_MISMATCH')
    digest, raw = public(config['binding'], 64 << 10)
    binding = decode(raw)
    need(digest == config['bindingSHA256'] and binding == role['hostBinding']
         and binding['SignerStatePath'] == config['pqState'] and binding['Policy']['ChainID'] == plan['chainId'],
         'ORIGINAL_HOST_BINDING_OR_PQ_HISTORY_MISMATCH')
    _, raw = public(config['schedule'], 32 << 10)
    need(raw == base64.b64decode(plan['pqSchedule'], validate=True), 'ORIGINAL_SCHEDULE_BYTES_MISMATCH')
    if config['runtimePlan']:
        _, raw = public(config['runtimePlan'], 1 << 20)
        need(raw == base64.b64decode(plan['runtimePlan'], validate=True), 'ORIGINAL_RUNTIME_PLAN_BYTES_MISMATCH')
    _, raw = public(config['enginePeerPin'], 65)
    need(raw in (config['enginePeerPublicKey'].encode(), (config['enginePeerPublicKey'] + '\n').encode()),
         'INDEPENDENT_REVERSE_ENGINE_PEER_MISMATCH')
    digest, _ = public(config['memoryBudgetEvidence'], 1 << 20)
    need(digest == config['memoryBudgetEvidenceSHA256'], 'TARGET_MEMORY_MEASUREMENT_PIN_MISMATCH')
    # No open/read/hash of private keys, vault, history or checkpoint bodies.
    for key in ('legacyKey', 'transportKey', 'vault', 'legacyState', 'pqState', 'abciState'):
        filename = config[key]
        info = host.private_stat(filename, (1 << 40) if key == 'abciState' else (128 << 20), uid)
        if key != 'abciState':
            identities[filename] = ident(info)
    for filename in (config['legacyState'] + '.writer.lock', config['pqState'] + '.lock'):
        if os.path.lexists(filename):
            identities[filename] = ident(host.private_stat(filename, 65536, uid, 0))
    checkpoint = Path(config['checkpointDirectory'])
    need(str(checkpoint.resolve(strict=True)) == str(checkpoint) and checkpoint.is_dir()
         and Path(config['abciState']).parent == checkpoint, 'ORIGINAL_LIVE_CHECKPOINT_DIRECTORY_REQUIRED')
    if config['checkpointFormat'] != 'atomic-committed-json-v1':
        filename = config['abciState'] + '.read.lock'
        info = host.private_stat(filename, 65536, uid, 0)
        identities[filename] = ident(info)
    histories = [Path(config[k]).parent for k in ('legacyState', 'pqState')]
    for directory in histories:
        info = directory.lstat()
        need(str(directory.resolve(strict=True)) == str(directory) and stat.S_ISDIR(info.st_mode)
             and info.st_uid == uid and stat.S_IMODE(info.st_mode) == 0o700, 'ORIGINAL_PRIVATE_HISTORY_DIRECTORY_REQUIRED')
    protected = [Path(config[k]) for k in ('genesis', 'migration', 'binding', 'schedule', 'enginePeerPin',
        'memoryBudgetEvidence', 'vault', 'legacyKey', 'transportKey', 'abciState')]
    if config['runtimePlan']:
        protected.append(Path(config['runtimePlan']))
    need(len(set(config[k] for k in ('legacyKey', 'transportKey', 'vault', 'legacyState', 'pqState', 'abciState'))) == 6,
         'ORIGINAL_CUSTODY_PATHS_CONFLICT')
    for filename in protected:
        need(not any(filename == d or d in filename.parents for d in histories), 'SOURCE_INSIDE_WRITABLE_HISTORY_DIRECTORY')
    identities[config['migration']] = ident(regular(config['migration'], 1 << 30))
    directory = path(args.operator_inputs_directory)
    need(directory.resolve(strict=True) == directory and directory.is_dir(), 'ORIGINAL_PUBLIC_INPUT_DIRECTORY_REQUIRED')
    need(not any(directory == d or d in directory.parents for d in histories), 'PUBLIC_INPUT_DIRECTORY_INSIDE_WRITABLE_HISTORY')
    actual = host.destination(CREDENTIAL)
    info = host.private_stat(actual, 1 << 20, 0)
    need(stat.S_IMODE(info.st_mode) == 0o600, 'ORIGINAL_ENCRYPTED_CREDENTIAL_MODE_REQUIRED')
    digest, _, credential_identity = read(actual, 1 << 20, False)
    need(digest == pin(args.credential_sha256) and credential_identity == ident(info), 'BOUND_ENCRYPTED_CREDENTIAL_PIN_MISMATCH')
    identities[str(actual)] = credential_identity
    for filename in protected + [Path(config['legacyState']), Path(config['pqState']), actual]:
        host.trusted(filename.parent, uid if filename != actual else 0)
    # Installation runs in the HOST namespace. A real writer may own an RW
    # source there; the pinned unit binds it read-only inside the future service
    # namespace. Do not substitute a host mount flag for actual sandbox startup.
    return identities


def sync_dir(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def check_live_source(config, host, uid):
    directory = Path(config['checkpointDirectory'])
    need(directory.resolve(strict=True) == directory and directory.is_dir()
         and Path(config['abciState']).parent == directory, 'ORIGINAL_LIVE_CHECKPOINT_DIRECTORY_REQUIRED')
    host.trusted(directory, uid)
    host.private_stat(config['abciState'], 1 << 40, uid)


def exclusive(filename, raw, mode, host, uid, gid):
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(raw)
        output.flush()
        host.chown(filename, uid, gid)
        os.fchmod(output.fileno(), mode)
        os.fsync(output.fileno())
    sync_dir(filename.parent)
    actual, readback, _ = read(filename, 128 << 20)
    need(readback == raw, 'EXCLUSIVE_INSTALL_READBACK_MISMATCH')
    host.installed_metadata(filename, uid, gid, mode)
    return {'path': str(filename), 'bytes': len(raw), 'sha256': actual}


def run(args, host=None):
    host = LocalHost() if host is None else host
    need(args.role in ('primary', 'singapore', 'silicon-valley', 'seoul'), 'EXPLICIT_ORIGINAL_ROLE_REQUIRED')
    source, binary, templates = runtime_inputs(args)
    config, config_raw, canonical, unit = rendered(args, source, templates)
    uid, gid = host.account()
    host.observe(config['checkpointProviderUnit'])
    originals = original_inputs(args, config, host, uid)
    outputs = {name: host.destination(filename) for name, filename in TARGETS.items()}
    for filename in outputs.values():
        parent = filename.parent
        info = parent.lstat()
        need(parent.resolve(strict=True) == parent and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022,
             'EXISTING_TRUSTED_INSTALL_PARENT_REQUIRED')
        host.trusted(parent, 0)
        need(not any(os.path.lexists(p) for p in (filename, Path(str(filename) + '.partial'), Path(str(filename) + '.UNKNOWN'))),
             'EXISTING_INSTALL_OR_UNKNOWN_MUST_BE_RETAINED')
    result = dict(version='YNX-PQ-REMOTE-SIGNER-INSTALL-DATA/v1', role=args.role,
        runtimeCommit=args.runtime_commit, runtimeSOURCEsha256=args.runtime_source_sha256,
        operatorPlanSHA256=args.operator_plan_sha256, originalConfigSHA256=args.config_sha256,
        renderedConfigSHA256=hashlib.sha256(canonical).hexdigest(), unitSHA256=args.unit_sha256,
        encryptedCredentialSHA256=args.credential_sha256, installed=False, runtimeStarted=False,
        publicDeployment=False, pqActivation=False, nativeRootAuthorized=False, privateKeyCheckPerformed=False,
        sandboxReadonlyValidated=False, freshnessVerified=False, credentialInstalled=False, custodyProvisioned=False)
    if not args.install:
        return result
    need(host.root(), 'EXPLICIT_INSTALL_REQUIRES_LINUX_ROOT')
    evidence = path(args.output_dir)
    parent = evidence.parent
    info = parent.lstat()
    need(parent.resolve(strict=True) == parent and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077,
         'EXISTING_PRIVATE_EVIDENCE_PARENT_REQUIRED')
    host.trusted(parent, 0)
    need(not any(os.path.lexists(p) for p in (evidence, Path(str(evidence) + '.partial'), Path(str(evidence) + '.UNKNOWN'))),
         'EXISTING_INSTALL_ATTEMPT_MUST_BE_RETAINED')
    os.mkdir(evidence, 0o700)
    sync_dir(parent)
    exclusive(evidence / 'intent.json', (json.dumps(dict(result, status='unknown', automaticRetry=False)) + '\n').encode(), 0o600, host, 0, 0)
    # Reobserve immediately before the first install. No service/daemon-reload
    # command exists in this path. Partial writes stay original on every error.
    host.observe(config['checkpointProviderUnit'])
    for filename, before in originals.items():
        need(ident(Path(filename).lstat()) == before, 'ORIGINAL_CUSTODY_OR_SOURCE_CHANGED_BEFORE_INSTALL')
    check_live_source(config, host, uid)
    _, current_raw, _ = pinned(path(args.config), args.config_sha256, 16384)
    need(current_raw == config_raw, 'ORIGINAL_CONFIG_CHANGED_BEFORE_INSTALL')
    pinned(path(args.operator_plan), args.operator_plan_sha256, 96 << 20)
    installed = []
    for name, raw, mode, owner, group in (
        ('binary', binary, 0o755, 0, 0), ('launcher', templates[DAEMON + '-launch.sh'], 0o755, 0, 0),
        ('config', canonical, 0o640, 0, gid), ('unit', unit, 0o644, 0, 0)):
        installed.append(exclusive(outputs[name], raw, mode, host, owner, group))
    for filename, before in originals.items():
        need(ident(Path(filename).lstat()) == before, 'ORIGINAL_CUSTODY_OR_SOURCE_CHANGED_DURING_INSTALL')
    # A live provider may legitimately atomically replace the committed file.
    # Preserve its configured path and admissible metadata, never pin its inode
    # or mistake this DATA installation for a freshness/engine-state proof.
    check_live_source(config, host, uid)
    result.update(installed=True, installedFiles=installed)
    exclusive(evidence / 'receipt.json', (json.dumps(result, separators=(',', ':')) + '\n').encode(), 0o600, host, 0, 0)
    return result


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    required = ('runtime-bundle', 'runtime-commit', 'runtime-source-sha256', 'operator-plan', 'operator-plan-sha256',
                'role', 'config', 'config-sha256', 'unit-sha256', 'operator-inputs-directory', 'credential-sha256')
    for name in required:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--output-dir')
    for name in (*required, 'install', 'output-dir'):
        need(sum(item.split('=', 1)[0] == '--' + name for item in argv) <= 1,
             'DUPLICATE_INSTALLER_OPTION_REFUSED')
    result = run(parser.parse_args(argv))
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        reason = str(error) if type(error) is ValueError and re.fullmatch('[A-Z0-9_]+', str(error)) else type(error).__name__
        print('REMOTE_SIGNER_INSTALL_REFUSED:' + reason + '; retain original/partial/UNKNOWN', file=sys.stderr)
        sys.exit(1)
