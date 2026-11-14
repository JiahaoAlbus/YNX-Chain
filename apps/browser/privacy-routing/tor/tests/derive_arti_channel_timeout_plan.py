#!/usr/bin/env python3
"""Derive an honest fresh PUBLIC comparison plan; never launch a process.

The original CLI prepare receipt/plan is backed up byte-for-byte. This V2 plan
is not runnable by the baseline CLI; its seal remains DATA, not authorization.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import stat
import time
import uuid
import re

ACTUAL_DERIVED_ARTI_SHA256 = 'e76e9049e5a7becf2be31683879d42851a386d985e2bd86ef73e1459ea8e68f6'
SOURCE = 'a72764db4438ec7b4132307bc98932225183e9bdeb1b677731c08ad307d27270'
FBB = 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a'
HELPER = '8d072f55417245ac63abad63d04a4c89590dc99d62f53b7e1373418539645922'
TARGETS = ['https://www.iana.org/domains/reserved', 'https://html.duckduckgo.com/html/?q=YNX%20browser']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(path, maximum, directory=None):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1 or before.st_mode & 0o022 or not 0 <= before.st_size <= maximum:
            raise ValueError('unsafe input file')
        data = bytearray()
        while len(data) <= maximum:
            block = os.read(fd, min(65536, maximum + 1 - len(data)))
            if not block: break
            data.extend(block)
        after = os.fstat(fd)
        if len(data) != before.st_size or len(data) > maximum or (before.st_dev, before.st_ino, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_mtime_ns):
            raise ValueError('input changed or oversized')
        return bytes(data), before
    finally: os.close(fd)


def pairs(values):
    result = {}
    for key, value in values:
        if key in result: raise ValueError('duplicate JSON field')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))


def owned_directory(path):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('absolute canonical owned directory required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for component in path.parts[1:]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd); fd = next_fd
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_mode & 0o7777 != 0o700:
            raise ValueError('private task directory required')
        return fd, info
    except BaseException:
        os.close(fd); raise


def absent(directory, names):
    for name in names:
        try: os.stat(name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError: continue
        raise ValueError('already scoped, used or derived')


def verified_artifact(directory):
    """Bounded exact pinned bytes for both the CLI packer and plan derivation."""
    fd, _ = owned_directory(directory)
    try:
        manifest_raw, _ = read_regular('manifest.json', 16384, fd)
        manifest = decode(manifest_raw)
        expected = dict(schema='P05_DERIVED_ARTI_PUBLIC_CHANNEL_TIMEOUT_ARTIFACT_V1',
                        artiSHA256=ACTUAL_DERIVED_ARTI_SHA256, sourceInputsSHA256=SOURCE,
                        baseArtiSHA256=FBB,
                        baseSourceArchiveSHA256='a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813',
                        nonDirectSeconds=30, directSeconds=5)
        if manifest != expected or json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode() != manifest_raw:
            raise ValueError('reviewed derived artifact manifest rejected')
        binary, _ = read_regular('ArtiPublicChannelTimeout30', 64 * 1024 * 1024, fd)
        if sha(binary) != ACTUAL_DERIVED_ARTI_SHA256:
            raise ValueError('derived binary mismatch')
        return binary, manifest_raw
    finally: os.close(fd)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--prepared', type=Path, required=True)
    p.add_argument('--artifact-directory', type=Path, required=True)
    args = p.parse_args()
    if ACTUAL_DERIVED_ARTI_SHA256 is None:
        raise ValueError('derived artifact not supplied; no plan/profile access')
    with contextlib.ExitStack() as custody:
        def adopt(path):
            fd, info = owned_directory(path)
            custody.callback(os.close, fd)
            return fd, info
        prepared = args.prepared.absolute()
        prepared_fd, directory = adopt(prepared)
        absent(prepared_fd, ['SCOPE-SEALED.json', 'RUN-ONCE', 'PLAN-DERIVATION.json', 'CLI-PLAN-BASELINE.json', 'CLI-PLAN-DERIVED.pending'])
        derive(args, prepared, prepared_fd, directory, adopt)


def derive(args, prepared, prepared_fd, directory, adopt):
    original, pin = read_regular('CLI-PLAN.json', 65536, prepared_fd)
    plan = decode(original)
    receipt, _ = read_regular('PREPARATION.json', 1024 * 1024, prepared_fd)
    previous = decode(receipt)
    if previous.get('status') != 'PROFILE_PREPARED_SCOPE_REQUIRED' or previous.get('sourceDrift') != [] or previous.get('sourceAndSupplyPins', {}).get(str(prepared / 'CLI-PLAN.json')) != sha(original):
        raise ValueError('original actual preparation/plan pin mismatch')
    if plan.get('schema') != 'P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1' or plan.get('artiSHA256') != FBB or plan.get('lyrebirdSHA256') != HELPER or plan.get('fixedTargets') != TARGETS or plan.get('fixedMethod') != 'GET':
        raise ValueError('not the reviewed fresh baseline plan')
    if type(plan.get('port')) is not int or plan['port'] != 63782 or type(plan.get('bridgeCount')) is not int or plan['bridgeCount'] != 1 or plan.get('publicBridgesSHA256') != '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407' or plan.get('chosenLineSHA256') != '9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f':
        raise ValueError('entry metadata differs from reviewed first line')
    if type(plan.get('createdAt')) not in (int, float) or not 0 <= time.time() - plan['createdAt'] <= 1800 or str(uuid.UUID(plan['runID'])) != plan['runID']:
        raise ValueError('stale or invalid run identity')
    scratch = Path(plan['scratch'])
    if re.fullmatch(r'ynx-public-search-[A-Za-z0-9]{8}', scratch.name) is None or plan['profile'] != str(scratch / 'YNX Browser Route State/Tor'):
        raise ValueError('not a task-specific fresh profile')
    scratch_fd, scratch_info = adopt(scratch)
    if type(plan.get('scratchDevice')) is not int or type(plan.get('scratchInode')) is not int or (plan['scratchDevice'], plan['scratchInode']) != (scratch_info.st_dev, scratch_info.st_ino):
        raise ValueError('scratch incarnation changed')
    profile = Path(plan['profile'])
    profile_fd, profile_info = adopt(profile)
    absent(profile_fd, ['.ynx-public-entry-qa-scope.json', '.ynx-public-browser-attempt', '.ynx-native-route.lock', 'RUN-ONCE'])
    artifact = args.artifact_directory.absolute()
    verified_artifact(artifact)
    updated = dict(plan, schema='P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V2',
                   artiSHA256=ACTUAL_DERIVED_ARTI_SHA256, artiSourceInputsSHA256=SOURCE,
                   artiVariant='non-direct-channel-30s')
    expected_argv = [str(Path(plan['resources']) / 'arti'), 'proxy', '--config', str(profile / 'arti.toml'), '--log-level', 'info', '-o', 'bridges.bridges=<exact-reviewed-first-snowflake>', '-o', 'bridges.transports=<fixed-snowflake-managed-contract>']
    if plan.get('argvRedacted') != expected_argv:
        raise ValueError('unexpected baseline argv contract')
    argv = list(expected_argv)
    argv[0] = str(artifact / 'ArtiPublicChannelTimeout30')
    updated['argvRedacted'] = argv
    updated['experimentDifference'] = 'derived QA Arti non-direct10->30 only; SF10/packetguards/TLS/caps unchanged; CLI-vs-managed require this same actual Arti SHA; path callbacks observation-only on independent CLI, fence on managed Browser'
    raw = json.dumps(updated, sort_keys=True, separators=(',', ':')).encode()
    for name, content in [('CLI-PLAN-BASELINE.json', original), ('CLI-PLAN-DERIVED.pending', raw)]:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=prepared_fd)
        with os.fdopen(fd, 'wb') as handle: handle.write(content)
    current, after = read_regular('CLI-PLAN.json', 65536, prepared_fd)
    if current != original or (pin.st_dev, pin.st_ino) != (after.st_dev, after.st_ino):
        raise ValueError('baseline plan changed during derivation; no replacement')
    check_fd, check_info = adopt(prepared)
    if (check_info.st_dev, check_info.st_ino) != (directory.st_dev, directory.st_ino):
        raise ValueError('preparation directory replaced')
    for path, expected_info in [(scratch, scratch_info), (profile, profile_info)]:
        _, current_info = adopt(path)
        if (current_info.st_dev, current_info.st_ino) != (expected_info.st_dev, expected_info.st_ino):
            raise ValueError('fresh profile directory replaced')
    os.replace('CLI-PLAN-DERIVED.pending', 'CLI-PLAN.json', src_dir_fd=prepared_fd, dst_dir_fd=prepared_fd)
    result = dict(schema='P05_PUBLIC_DERIVED_ARTI_PLAN_TRANSITION_V1', status='DERIVED_DATA_NOT_RUN',
                  originalPlanSHA256=sha(original), derivedPlanSHA256=sha(raw),
                  derivedArtiSHA256=ACTUAL_DERIVED_ARTI_SHA256, sourceInputsSHA256=SOURCE,
                  changedFields=['schema', 'artiSHA256', 'argvRedacted[0]', 'artiVariant', 'artiSourceInputsSHA256', 'experimentDifference'],
                  originalPreparationPreserved=True, originalRunAndDeadlinesUnchanged=True,
                  comparisonTarget='fixed DDG only; IANA declaration retained for original DATA seal compatibility, not a new request',
                  baselineCLIRunMustReject=True, rawDerivedRuntime='TYPED_SOURCE_IMPLEMENTED_SDK_AND_SEPARATE_NETWORK_SCOPE_STILL_REQUIRED',
                  profileFileBodiesRead=False, network='NOT_RUN', notAuthority=True)
    fd = os.open('PLAN-DERIVATION.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=prepared_fd)
    with os.fdopen(fd, 'w') as handle:
        json.dump(result, handle, indent=2); handle.write('\n')
    print(json.dumps(result))


if __name__ == '__main__': main()
