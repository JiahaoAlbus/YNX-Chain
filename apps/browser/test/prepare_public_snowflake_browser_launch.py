#!/usr/bin/env python3
"""Seal fresh fixed-PUBLIC QA inputs into an already compiled staging app.

This performs no DNS, process launch, signing, installation or network operation.
The resulting DATA grants no production privacy or release qualification.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import time
import uuid

from prepare_public_entry_scope import canonical_public_ip, json_object, reviewed_hosts


ROLE = 'com.ynxweb4.browser.qa.tor.public-search.snowflake'
HELPER = '8d072f55417245ac63abad63d04a4c89590dc99d62f53b7e1373418539645922'
SOURCE = '8b593f018eee2aef253523dc5da8cd5d6670f0c5f08616ca7e22ede8423468d4'
REVIEWED = '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407'
LINE = '9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f'
ARTI = 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a'
DERIVED_ARTI = 'e76e9049e5a7becf2be31683879d42851a386d985e2bd86ef73e1459ea8e68f6'
DERIVED_SOURCE = 'a72764db4438ec7b4132307bc98932225183e9bdeb1b677731c08ad307d27270'
DERIVED_MANIFEST = '332f71bcacb3be32e343448495dde8b3d14a93b36971605342bb86a975a61310'
DERIVED_VARIANT = 'non-direct-channel-30s'
PUBLISHER = '7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d'
TARGET = 'https://html.duckduckgo.com/html/?q=YNX%20browser'
SCOPE_KEYS = {'schema', 'runID', 'reviewedSourceSHA256', 'selectedBridgeLineSHA256',
              'profileDevice', 'profileInode', 'planDeadlineUnixNano',
              'mappingExpiresUnixNano', 'addresses'}


def require(value, label):
    if not value:
        raise ValueError(label)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'canonical-path-required')
    return path


def owned_file(path, maximum, mode=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                and before.st_nlink == 1 and not before.st_mode & 0o022, 'unsafe-file')
        if mode is not None:
            require(stat.S_IMODE(before.st_mode) == mode, 'wrong-file-mode')
        require(0 <= before.st_size <= maximum, 'file-size-limit')
        chunks, length = [], 0
        while True:
            data = os.read(fd, min(65536, maximum + 1 - length))
            if not data:
                break
            chunks.append(data)
            length += len(data)
            require(length <= maximum, 'file-growth-limit')
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'file-changed')
        return b''.join(chunks)
    finally:
        os.close(fd)


def directory(path):
    path = canonical(path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'unsafe-profile-directory')
    return info


def prepare(staging, prepared, helper, reviewed, executable_sha, now_ns=None, derived_directory=None):
    now = time.time_ns() if now_ns is None else now_ns
    staging, prepared, helper, reviewed = map(canonical, (staging, prepared, helper, reviewed))
    require(re.fullmatch(r'[0-9a-f]{64}', executable_sha) is not None, 'executable-pin-shape')
    require(digest(owned_file(reviewed, 65536)) == REVIEWED, 'reviewed-source-pin')
    require(digest(owned_file(helper, 64 * 1024 ** 2)) == HELPER, 'helper-pin')
    derived = None
    if derived_directory is not None:
        derived = canonical(derived_directory)
        artifact = owned_file(derived / 'ArtiPublicChannelTimeout30', 64 * 1024 ** 2)
        manifest = owned_file(derived / 'manifest.json', 16384)
        require(digest(artifact) == DERIVED_ARTI and digest(manifest) == DERIVED_MANIFEST,
                'derived-artifact-pin')
        require(json_object(manifest) == dict(
            schema='P05_DERIVED_ARTI_PUBLIC_CHANNEL_TIMEOUT_ARTIFACT_V1',
            artiSHA256=DERIVED_ARTI, sourceInputsSHA256=DERIVED_SOURCE,
            baseArtiSHA256=ARTI,
            baseSourceArchiveSHA256='a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813',
            nonDirectSeconds=30, directSeconds=5), 'derived-artifact-manifest')
    require(not any(os.path.lexists(prepared / name) for name in
                    ('RUN-ONCE', 'CLI-RESULT.json', 'NETWORK-SUPERVISOR.json', 'SCOPE-SEALED.json')),
            'prepared-case-already-used')
    plan_raw = owned_file(prepared / 'CLI-PLAN.json', 65536)
    plan = json_object(plan_raw)
    require(plan.get('schema') == ('P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V2' if derived else 'P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1')
            and plan.get('lyrebirdSHA256') == HELPER and plan.get('artiSHA256') == (DERIVED_ARTI if derived else ARTI)
            and plan.get('chosenLineSHA256') == LINE and plan.get('publicBridgesSHA256') == REVIEWED,
            'prepared-plan-binding')
    if derived:
        require(plan.get('artiVariant') == DERIVED_VARIANT
                and plan.get('artiSourceInputsSHA256') == DERIVED_SOURCE
                and type(plan.get('argvRedacted')) is list
                and plan['argvRedacted'][:1] == [str(derived / 'ArtiPublicChannelTimeout30')],
                'derived-plan-binding')
        transition = json_object(owned_file(prepared / 'PLAN-DERIVATION.json', 16384))
        baseline = owned_file(prepared / 'CLI-PLAN-BASELINE.json', 65536)
        require(transition.get('schema') == 'P05_PUBLIC_DERIVED_ARTI_PLAN_TRANSITION_V1'
                and transition.get('status') == 'DERIVED_DATA_NOT_RUN'
                and transition.get('originalPlanSHA256') == digest(baseline)
                and transition.get('derivedPlanSHA256') == digest(plan_raw)
                and transition.get('derivedArtiSHA256') == DERIVED_ARTI
                and transition.get('sourceInputsSHA256') == DERIVED_SOURCE,
                'derived-plan-transition-binding')
        original = json_object(baseline)
        preparation = json_object(owned_file(prepared / 'PREPARATION.json', 1024 ** 2))
        preparation_pins = preparation.get('sourceAndSupplyPins')
        require(preparation.get('status') == 'PROFILE_PREPARED_SCOPE_REQUIRED'
                and preparation.get('sourceDrift') == [] and type(preparation_pins) is dict
                and preparation_pins.get(str(prepared / 'CLI-PLAN.json')) == digest(baseline),
                'original-preparation-plan-binding')
        require(original.get('schema') == 'P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1'
                and original.get('artiSHA256') == ARTI and type(original.get('argvRedacted')) is list
                and type(original.get('resources')) is str and type(original.get('profile')) is str,
                'original-baseline-plan-binding')
        argv = [str(Path(original['resources']) / 'arti'), 'proxy', '--config',
                str(Path(original['profile']) / 'arti.toml'), '--log-level', 'info', '-o',
                'bridges.bridges=<exact-reviewed-first-snowflake>', '-o',
                'bridges.transports=<fixed-snowflake-managed-contract>']
        require(original['argvRedacted'] == argv, 'original-baseline-argv-binding')
        argv[0] = str(derived / 'ArtiPublicChannelTimeout30')
        expected = dict(original, schema='P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V2',
                        artiSHA256=DERIVED_ARTI, artiVariant=DERIVED_VARIANT,
                        artiSourceInputsSHA256=DERIVED_SOURCE, argvRedacted=argv,
                        experimentDifference='derived QA Arti non-direct10->30 only; SF10/packetguards/TLS/caps unchanged; CLI-vs-managed require this same actual Arti SHA; path callbacks observation-only on independent CLI, fence on managed Browser')
        require(json.dumps(plan, sort_keys=True) == json.dumps(expected, sort_keys=True),
                'derived-plan-exact-delta')
    run = plan.get('runID')
    require(type(run) is str and str(uuid.UUID(run)) == run, 'run-id-binding')
    profile, scratch = canonical(plan['profile']), canonical(plan['scratch'])
    require(profile == scratch / 'YNX Browser Route State' / 'Tor'
            and re.fullmatch(r'ynx-public-search-[A-Za-z0-9]{8}', scratch.name) is not None,
            'profile-shape')
    pinfo, sinfo = directory(profile), directory(scratch)
    require(plan.get('scratchDevice') == sinfo.st_dev and plan.get('scratchInode') == sinfo.st_ino,
            'scratch-plan-binding')
    require(not (scratch / 'public-runtime.jsonl').exists(), 'profile-already-ran')
    scope_raw = owned_file(profile / '.ynx-public-entry-qa-scope.json', 65536, 0o600)
    scope = json_object(scope_raw)
    require(set(scope) == SCOPE_KEYS and scope['schema'] == 'P05_PUBLIC_ENTRY_QA_SCOPE_V1'
            and scope['runID'] == run and scope['reviewedSourceSHA256'] == REVIEWED
            and scope['selectedBridgeLineSHA256'] == LINE, 'go-scope-binding')
    for field, expected in (('profileDevice', pinfo.st_dev), ('profileInode', pinfo.st_ino)):
        require(type(scope[field]) is int and scope[field] == expected, 'profile-identity-binding')
    for field in ('planDeadlineUnixNano', 'mappingExpiresUnixNano'):
        require(type(scope[field]) is int and 0 < scope[field] < 2 ** 63, 'deadline-type')
    deadline = min(scope['planDeadlineUnixNano'], scope['mappingExpiresUnixNano'])
    require(now + 100_000_000_000 < deadline <= now + 650_000_000_000
            and scope['mappingExpiresUnixNano'] <= now + 900_000_000_000, 'fresh-window-required')
    fronts, stun = reviewed_hosts(reviewed)
    require(type(scope['addresses']) is dict and set(scope['addresses']) == set(fronts + stun), 'closed-map-hosts')
    for values in scope['addresses'].values():
        require(type(values) is list and 1 <= len(values) <= 16, 'closed-map-size')
        checked = [str(canonical_public_ip(value)) for value in values]
        require(len(set(checked)) == len(checked), 'closed-map-duplicate')
    info_path = staging / 'Contents' / 'Info.plist'
    for component in ('Contents', 'Contents/Resources', 'Contents/MacOS',
                      'Contents/Resources/PrivacyBackends', 'Contents/Resources/PrivacyBackends/Tor'):
        path = canonical(staging / component)
        item = path.lstat()
        require(stat.S_ISDIR(item.st_mode) and item.st_uid == os.getuid()
                and not item.st_mode & 0o022, 'unsafe-staging-directory')
    info = plistlib.loads(owned_file(info_path, 1024 * 1024))
    require('YNXPublicSnowflakeLaunchSHA256' not in info, 'staging-already-sealed')
    require(not {'YNXPrivacyRouteMode', 'YNXNymProofHelper', 'CFBundleURLTypes',
                 'YNXPublicNymSearchDiagnostic'}.intersection(info), 'wrong-staging-role')
    if 'YNXPublicSearchDiagnostic' in info or 'YNXPublicSnowflakeSearchDiagnostic' in info:
        require(info.get('CFBundleIdentifier') == ROLE and info.get('YNXPublicSearchDiagnostic') is True
                and info.get('YNXPublicSnowflakeSearchDiagnostic') is True, 'wrong-staging-role')
    require('YNXPublicArtiChannelTimeoutExperiment' not in info, 'staging-variant-already-set')
    name = info.get('CFBundleExecutable')
    require(type(name) is str and name not in ('', '.', '..') and '/' not in name, 'bad-executable-name')
    require(digest(owned_file(staging / 'Contents' / 'MacOS' / name, 128 * 1024 ** 2)) == executable_sha,
            'compiled-executable-pin')
    tor = staging / 'Contents' / 'Resources' / 'PrivacyBackends' / 'Tor'
    require(digest(owned_file(tor / 'arti', 128 * 1024 ** 2)) == ARTI, 'arti-supply-pin')
    require(digest(owned_file(tor / 'lyrebird', 128 * 1024 ** 2)) == PUBLISHER, 'original-publisher-pin')
    launch = dict(schema='P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1', runID=run,
                  profile=str(profile), scratch=str(scratch), profileDevice=pinfo.st_dev,
                  profileInode=pinfo.st_ino, scratchDevice=sinfo.st_dev, scratchInode=sinfo.st_ino,
                  scopeSHA256=digest(scope_raw), helperSHA256=HELPER, sourceInputsSHA256=SOURCE,
                  reviewedSourceSHA256=REVIEWED, selectedBridgeLineSHA256=LINE,
                  deadlineUnixNano=deadline, fixedTarget=TARGET)
    if derived:
        launch.update(schema='P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V2',
                      artiVariant=DERIVED_VARIANT, artiSHA256=DERIVED_ARTI,
                      artiSourceInputsSHA256=DERIVED_SOURCE)
    encoded = json.dumps(launch, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    # All checks precede the first staging mutation. Never repair or renew an old case.
    output = staging / 'Contents' / 'Resources' / 'PublicSnowflakeQA'
    output.mkdir(mode=0o700, exist_ok=False)
    shutil.copy2(helper, output / 'lyrebird', follow_symlinks=False)
    require(digest(owned_file(output / 'lyrebird', 64 * 1024 ** 2)) == HELPER, 'copied-helper-drift')
    if derived:
        extra = output / 'ChannelTimeoutQA'
        extra.mkdir(mode=0o700, exist_ok=False)
        shutil.copy2(derived / 'ArtiPublicChannelTimeout30', extra / 'arti', follow_symlinks=False)
        shutil.copy2(derived / 'manifest.json', extra / 'manifest.json', follow_symlinks=False)
        require(digest(owned_file(extra / 'arti', 64 * 1024 ** 2)) == DERIVED_ARTI
                and digest(owned_file(extra / 'manifest.json', 16384)) == DERIVED_MANIFEST,
                'copied-derived-artifact-drift')
    fd = os.open(output / 'launch.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    info.update(CFBundleIdentifier=ROLE, YNXPublicSearchDiagnostic=True,
                YNXPublicSnowflakeSearchDiagnostic=True, YNXPublicSnowflakeLaunchSHA256=digest(encoded))
    if derived:
        info['YNXPublicArtiChannelTimeoutExperiment'] = True
    temporary = info_path.with_name('Info.plist.p05-snowflake-new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(plistlib.dumps(info))
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(info_path)
    return dict(status='STAGED_DATA_ONLY_REQUIRES_ADHOC_SEAL', runID=run,
                launchSHA256=digest(encoded), scopeSHA256=digest(scope_raw),
                deadlineUnixNano=deadline, network='NOT_RUN', normalPrivacyAdmission=False,
                ReleaseApproved=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staging-app', type=Path, required=True)
    parser.add_argument('--cli-prepared', type=Path, required=True)
    parser.add_argument('--successor-helper', type=Path, required=True)
    parser.add_argument('--reviewed-source', type=Path, required=True)
    parser.add_argument('--compiled-executable-sha256', required=True)
    parser.add_argument('--derived-arti-directory', type=Path)
    args = parser.parse_args()
    try:
        result = prepare(args.staging_app, args.cli_prepared, args.successor_helper,
                         args.reviewed_source, args.compiled_executable_sha256,
                         derived_directory=args.derived_arti_directory)
    except Exception as error:
        print(json.dumps(dict(status='FAILED_NO_NETWORK', error=type(error).__name__,
                              normalPrivacyAdmission=False)))
        raise SystemExit(1)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
