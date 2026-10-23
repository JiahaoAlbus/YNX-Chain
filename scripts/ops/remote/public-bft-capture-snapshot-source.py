#!/usr/bin/env python3
"""Capture the existing v1 source record after explicit native preparation.

This only measures DATA. The protected preparation/primary-evidence/tool pins
come independently from the original owner. This receipt cannot authorize an
export, initialize a node, replace the final approval or qualify a native Root.
No caller-selected program, service environment, exporter or endpoint is run.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time


class Refusal(ValueError):
    pass


def require(ok, code):
    if not ok:
        raise Refusal(code)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_FIELD')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'INVALID_JSON_CONSTANT'))


def pin(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value)
            and value != '0' * 64, 'INDEPENDENT_SHA256_REQUIRED')
    return value


def absolute(value):
    require(type(value) is str and re.fullmatch('/[A-Za-z0-9._/-]+', value)
            and str(Path(value)) == value and '..' not in Path(value).parts,
            'CANONICAL_ABSOLUTE_PATH_REQUIRED')
    return Path(value)


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read(path, maximum, material=False, private=False):
    require(str(path.resolve(strict=True)) == str(path), 'ORIGINAL_PATH_REPLACED')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
            and not before.st_mode & 0o022 and 0 < before.st_size <= maximum,
            'ORIGINAL_BOUNDED_REGULAR_FILE_REQUIRED')
    if private:
        require(not before.st_mode & 0o077 and before.st_uid == os.geteuid(),
                'PROTECTED_ORIGINAL_FILE_REQUIRED')
    digest, chunks, size = hashlib.sha256(), [], 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as stream:
        require(identity(before) == identity(os.fstat(stream.fileno())), 'ORIGINAL_CHANGED_BEFORE_READ')
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            size += len(chunk)
            require(size <= maximum, 'ORIGINAL_GREW_BEYOND_BOUND')
            digest.update(chunk)
            if material:
                chunks.append(chunk)
        require(size == before.st_size and identity(before) == identity(os.fstat(stream.fileno()))
                and identity(before) == identity(path.lstat()), 'ORIGINAL_CHANGED_DURING_READ')
    return dict(bytes=size, sha256=digest.hexdigest()), b''.join(chunks), identity(before)


def pinned(path, expected, maximum=65536):
    measured, raw, ident = read(path, maximum, True, True)
    require(measured['sha256'] == pin(expected), 'PROTECTED_ORIGINAL_PIN_MISMATCH')
    return decode(raw), (measured, ident)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable(path, value):
    raw = (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    sync_dir(path.parent)
    actual, returned, _ = read(path, 16384, True, True)
    require(returned == raw, 'EXCLUSIVE_OUTPUT_READBACK_MISMATCH')
    return actual


def native_tool(expected):
    # Fixed sibling from the independently pinned, same-source ops supply.
    # Compile precisely the measured bytes; do not reopen a swappable import
    # path, search PYTHONPATH, or accept a helper location through the caller.
    path = Path(__file__).resolve().parent / 'public-bft-native-identity.py'
    actual, raw, _ = read(path, 65536, True)
    require(actual['sha256'] == pin(expected), 'NATIVE_IDENTITY_TOOL_PIN_MISMATCH')
    namespace = {'__name__': 'ynx_snapshot_source_native_identity', '__file__': str(path)}
    exec(compile(raw, str(path), 'exec'), namespace)
    return namespace


def preparation(value, tx):
    # Consume the original normalized prepare-native record, not a new grant
    # schema. Future checkpoint/final-plan fields are expressly disallowed.
    names = set(('custodyProfile schemaVersion action approved approvalId approver custodyReviewer '
        'custodyEvidence owner ownerHandoverReviewer ownerHandoverInventoryDigest '
        'ownerHandoverInventoryEvidence ownerHandoverReceiptEvidence commit release '
        'authoritativeCommit authoritativeRelease authoritativeBinarySha256 authoritativeSource '
        'preparationOnly publicCutoverAuthorized automaticRollbackRequired validatorKeyRecoveryVerified '
        'ownerHandoverVerified rotationProcedureVerified validatorManifestSha256 '
        'operatorPreparationPlanSha256 runtimeManifestSha256 exporterManifestSha256 expiresAt').split())
    require(type(value) is dict and names <= set(value)
            and set(value) <= names | {'authoritativeRoles', 'validated'}, 'CLOSED_PREPARATION_RECORD_REQUIRED')
    require(value['custodyProfile'] == 'single-app-gateway/v1' and type(value['schemaVersion']) is int
            and value['schemaVersion'] == 1 and value['action'] == 'ynx-public-bft-cutover'
            and all(value[k] is True for k in ('approved', 'preparationOnly', 'publicCutoverAuthorized',
                'automaticRollbackRequired', 'validatorKeyRecoveryVerified', 'ownerHandoverVerified',
                'rotationProcedureVerified')) and value.get('validated', True) is True,
            'EXPLICIT_NATIVE_PREPARATION_REQUIRED')
    require(re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', tx)
            and type(value['commit']) is str and re.fullmatch('[0-9a-f]{12}', value['commit'])
            and value['release'] == 'ynx-bft-gateway-' + value['commit'], 'PREPARATION_TRANSACTION_IDENTITY_MISMATCH')
    require(type(value['approvalId']) is str
            and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', value['approvalId']), 'INVALID_PREPARATION_ATTRIBUTION')
    principals = [value[k].strip().lower() if type(value[k]) is str else ''
                  for k in ('approver', 'custodyReviewer', 'owner', 'ownerHandoverReviewer')]
    require(all(len(x) >= 3 for x in principals) and len(set(principals)) == 4,
            'PREPARATION_ROLE_SEPARATION_REQUIRED')
    for key in ('custodyEvidence', 'ownerHandoverInventoryDigest', 'ownerHandoverInventoryEvidence',
                'ownerHandoverReceiptEvidence'):
        require(type(value[key]) is str and re.fullmatch('sha256:[0-9a-f]{64}', value[key]),
                'INVALID_PREPARATION_EVIDENCE_REFERENCE')
    for key in ('validatorManifestSha256', 'operatorPreparationPlanSha256', 'runtimeManifestSha256',
                'exporterManifestSha256', 'authoritativeBinarySha256'):
        pin(value[key])
    require(type(value['expiresAt']) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value['expiresAt']),
            'INVALID_PREPARATION_EXPIRY')
    expiry = datetime.strptime(value['expiresAt'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
    require(0 < expiry - time.time() <= 24 * 60 * 60, 'PREPARATION_EXPIRED_OR_TOO_DISTANT')


def same_transaction(value, approval, tx):
    require(type(value) is dict and value.get('transactionId') == tx
            and value.get('commit') == approval['commit'] and value.get('bftRelease') == approval['release']
            and value.get('authoritativeCommit') == approval['authoritativeCommit']
            and value.get('authoritativeRelease') == approval['authoritativeRelease'],
            'ORIGINAL_MARKER_OR_EVIDENCE_TRANSACTION_MISMATCH')


class StableProcess:
    def __init__(self, process, approval):
        self.process, self.approval, self.checkpoint = process, approval, None

    def __getattr__(self, name):
        return getattr(self.process, name)

    def status(self):
        value = self.process.status()
        a = self.approval
        require(type(value) is dict and type(value.get('height')) is int and 0 < value['height'] < 1 << 64
                and type(value.get('latestBlockHash')) is str
                and re.fullmatch('(0x)?[0-9a-f]{64}', value['latestBlockHash'])
                and value['latestBlockHash'].removeprefix('0x') != '0' * 64, 'INVALID_PAUSED_NATIVE_CHECKPOINT')
        require(type(value.get('chainId')) is int and value['chainId'] == 6423
                and value.get('nativeCurrencySymbol') == 'YNXT'
                and value.get('build', {}).get('commit') == a['authoritativeCommit'][:12]
                and value.get('build', {}).get('release') == a['authoritativeRelease']
                and value.get('nodeIdentity', {}).get('replicationMode') == 'authoritative_producer'
                and value.get('nodeIdentity', {}).get('validatorAddress') == 'ynx_validator_primary'
                and value.get('nodeIdentity', {}).get('blockProductionEnabled') is True,
                'PAUSED_NATIVE_BUILD_CHAIN_OR_PRIMARY_MISMATCH')
        checkpoint = (value['height'], value['latestBlockHash'])
        require(self.checkpoint is None or checkpoint == self.checkpoint, 'PAUSED_NATIVE_CHECKPOINT_CHANGED')
        self.checkpoint = checkpoint
        return value


def capture(args, process=None, sleeper=None):
    if sleeper is None:
        sleeper = time.sleep
    tx = args.transaction_id
    approval_path = absolute(args.preparation_approval)
    approval, approved_observation = pinned(approval_path, args.preparation_approval_sha256)
    preparation(approval, tx)
    tool = native_tool(args.native_identity_sha256)
    full, release, binary = (approval[k] for k in ('authoritativeCommit', 'authoritativeRelease', 'authoritativeBinarySha256'))
    source = tool['source_identity'](approval['authoritativeSource'], full, release, binary, tx, approval['commit'])
    if 'authoritativeRoles' in approval:
        roles = approval['authoritativeRoles']
        require(type(roles) is dict and set(roles) == {'primary', 'singapore', 'silicon-valley', 'seoul'},
                'CLOSED_ORIGINAL_NATIVE_ROLES_REQUIRED')
        primary = {k: approval[k] for k in ('authoritativeCommit', 'authoritativeRelease',
                   'authoritativeBinarySha256', 'authoritativeSource')}
        require(roles['primary'] == primary, 'PRIMARY_PREPARATION_IDENTITY_MISMATCH')
        for role in roles.values():
            require(type(role) is dict and set(role) == set(primary), 'CLOSED_ORIGINAL_NATIVE_ROLE_REQUIRED')
            tool['source_identity'](role['authoritativeSource'], role['authoritativeCommit'], role['authoritativeRelease'],
                                    role['authoritativeBinarySha256'], tx, approval['commit'])
    evidence, destination = absolute(args.primary_evidence_dir), absolute(args.output_dir)
    require(str(evidence.resolve(strict=True)) == str(evidence) and evidence.is_dir(), 'ORIGINAL_PRIMARY_EVIDENCE_REQUIRED')
    parent = destination.parent
    info = parent.lstat()
    require(str(parent.resolve(strict=True)) == str(parent) and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid() and not info.st_mode & 0o077, 'PRIVATE_EXISTING_OUTPUT_PARENT_REQUIRED')
    require(not any(os.path.lexists(p) for p in (destination, Path(str(destination) + '.partial'),
                Path(str(destination) + '.UNKNOWN'))), 'EXISTING_OUTPUT_OR_UNKNOWN_MUST_BE_RETAINED')
    require(type(args.observation_seconds) is int and 1 <= args.observation_seconds <= 15, 'INVALID_OBSERVATION_WINDOW')
    pin(args.primary_pause_sha256); pin(args.primary_freeze_sha256)
    os.mkdir(destination, 0o700)
    sync_dir(parent)
    durable(destination / 'intent.json', dict(version='YNX-PUBLIC-BFT-SNAPSHOT-SOURCE-CAPTURE/v1',
        transactionId=tx, commit=approval['commit'], status='unknown', automaticRetry=False,
        preparationApprovalSHA256=args.preparation_approval_sha256, nativeIdentityToolSHA256=args.native_identity_sha256))
    # There is deliberately no cleanup/restore/retry trap after exclusive
    # reservation. Incomplete observations and outputs remain original UNKNOWN.
    pause_path, freeze_path = evidence / 'primary-pause-authoritative.json', evidence / 'primary-freeze.json'
    for original in (pause_path, freeze_path, Path(source['pauseMarkerPath']), Path(source['mutationMarkerPath'])):
        require(not any(os.path.lexists(p) for p in (Path(str(original) + '.partial'),
                    Path(str(original) + '.partial-' + tx), Path(str(original) + '.UNKNOWN'))),
                'ORIGINAL_PAUSE_OR_FREEZE_UNKNOWN_MUST_BE_RETAINED')
    pause, pause_observation = pinned(pause_path, args.primary_pause_sha256)
    freeze, freeze_observation = pinned(freeze_path, args.primary_freeze_sha256)
    for value in (pause, freeze):
        same_transaction(value, approval, tx)
    require(pause.get('operation') == 'pause' and pause.get('productionStateVerified') is True
            and pause.get('readsOnline') is True and pause.get('pauseMarker') == source['pauseMarkerPath']
            and type(pause.get('heightBefore')) is int and pause['heightBefore'] > 0
            and type(pause.get('heightAfter')) is int and pause['heightBefore'] == pause['heightAfter'],
            'VERIFIED_ORIGINAL_PRIMARY_PAUSE_REQUIRED')
    require(freeze.get('role') == 'primary' and freeze.get('operation') == 'freeze'
            and freeze.get('mutationStateVerified') is True and type(freeze.get('readStatus')) is int
            and freeze['readStatus'] == 200 and type(freeze.get('readEvm')) is int and freeze['readEvm'] == 200
            and freeze.get('markerPath') == source['mutationMarkerPath'], 'VERIFIED_ORIGINAL_PRIMARY_FREEZE_REQUIRED')
    stable = StableProcess(process if process is not None else tool['OriginalProcess'](), approval)
    before_process = tool['inspect'](source, full, release, binary, 'primary', stable)

    def observe_files():
        measured = {}
        for kind in ('state', 'integrityMarker', 'pauseMarker', 'mutationMarker'):
            maximum = (1 << 40) if kind == 'state' else (8 if kind == 'integrityMarker' else 65536)
            actual, raw, ident = read(Path(source[kind + 'Path']), maximum, kind != 'state')
            if kind == 'integrityMarker':
                require(raw in (b'2\n', b'3\n'), 'ORIGINAL_INTEGRITY_VERSION_UNSUPPORTED')
            if kind in ('pauseMarker', 'mutationMarker'):
                marker = decode(raw)
                same_transaction(marker, approval, tx)
                if kind == 'mutationMarker':
                    require(marker.get('role') == 'primary', 'ORIGINAL_MUTATION_MARKER_ROLE_MISMATCH')
                expected = pause if kind == 'pauseMarker' else freeze
                require(actual['sha256'] == pin(expected.get('markerSha256')), 'VERIFIED_ORIGINAL_MARKER_PIN_MISMATCH')
            measured[kind] = (actual, ident)
        return measured

    before = observe_files()
    stable.status()
    require(stable.checkpoint[0] == pause['heightAfter'], 'PAUSE_EVIDENCE_CHECKPOINT_MISMATCH')
    sleeper(args.observation_seconds)
    stable.status()
    require(observe_files() == before, 'ORIGINAL_SOURCE_OR_MARKERS_CHANGED')
    require(tool['inspect'](source, full, release, binary, 'primary', stable) == before_process,
            'ORIGINAL_NATIVE_PROCESS_CHANGED')
    for filename, expected, observed in ((approval_path, args.preparation_approval_sha256, approved_observation),
            (pause_path, args.primary_pause_sha256, pause_observation), (freeze_path, args.primary_freeze_sha256, freeze_observation)):
        _, current = pinned(filename, expected)
        require(current == observed, 'PROTECTED_ORIGINAL_RECORD_CHANGED')
    preparation(approval, tx)
    height, block_hash = stable.checkpoint
    value = dict(version='YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1', transactionId=tx, commit=approval['commit'],
        authoritativeRelease=release, bftRelease=approval['release'],
        statePath=source['statePath'], stateBytes=str(before['state'][0]['bytes']), stateSHA256=before['state'][0]['sha256'],
        integrityMarkerPath=source['integrityMarkerPath'], integrityMarkerBytes=str(before['integrityMarker'][0]['bytes']),
        integrityMarkerSHA256=before['integrityMarker'][0]['sha256'], pauseMarkerPath=source['pauseMarkerPath'],
        pauseMarkerSHA256=before['pauseMarker'][0]['sha256'], mutationMarkerPath=source['mutationMarkerPath'],
        mutationMarkerSHA256=before['mutationMarker'][0]['sha256'], height=str(height), blockHash=block_hash,
        authoritativeCommit=full, authoritativeBinarySha256=binary)
    output = destination / 'snapshot-source.json'
    measured = durable(output, value)
    receipt = dict(version='YNX-PUBLIC-BFT-SNAPSHOT-SOURCE-CAPTURE/v1', transactionId=tx, commit=approval['commit'],
        snapshotSourcePath=str(output), snapshotSourceSHA256=measured['sha256'], snapshotSourceBytes=measured['bytes'],
        preparationApprovalSHA256=args.preparation_approval_sha256, primaryPauseEvidenceSHA256=args.primary_pause_sha256,
        primaryFreezeEvidenceSHA256=args.primary_freeze_sha256, nativeIdentityToolSHA256=args.native_identity_sha256,
        readOnly=True, exported=False, finalApproval=False, nativeRootAuthorized=False)
    durable(destination / 'receipt.json', receipt)
    return receipt


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('transaction-id', 'preparation-approval', 'preparation-approval-sha256', 'primary-evidence-dir',
                 'primary-pause-sha256', 'primary-freeze-sha256', 'native-identity-sha256', 'output-dir'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--observation-seconds', type=int, default=4)
    result = capture(parser.parse_args(argv))
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        # File contents, process environment and failed subprocess bodies are
        # never returned. Retain every original/partial/UNKNOWN on refusal.
        reason = str(error) if isinstance(error, Refusal) else type(error).__name__
        print('SNAPSHOT_SOURCE_CAPTURE_REFUSED:' + reason, file=sys.stderr)
        sys.exit(1)
