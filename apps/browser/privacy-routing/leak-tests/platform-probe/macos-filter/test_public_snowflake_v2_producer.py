#!/usr/bin/env python3
"""Exercise the real V2 staging function against private, inert staging fixtures."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import sys
import time
import uuid


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def load_source(path, pin, module_name):
    if digest(path.read_bytes()) != pin:
        raise ValueError('test source pin mismatch: ' + path.name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_fixture(root, producer, scope, artifact, reviewed):
    root.mkdir(mode=0o700)
    scratch = root / 'ynx-public-search-Data0001'
    profile = scratch / 'YNX Browser Route State/Tor'
    profile.mkdir(mode=0o700, parents=True)
    scratch.chmod(0o700)
    run_id = str(uuid.uuid4())
    now = time.time_ns()
    fronts, stun = scope.reviewed_hosts(reviewed)
    scope.prepare(profile, reviewed, {name: ['8.8.8.8'] for name in fronts + stun},
                  run_id, now + 180_000_000_000, now + 180_000_000_000, now_ns=now)
    info = scratch.stat()
    resources = str(root / 'fixed-test-supply')
    baseline = dict(
        schema='P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1', runID=run_id, createdAt=now / 1e9,
        scratch=str(scratch), scratchDevice=info.st_dev, scratchInode=info.st_ino,
        profile=str(profile), resources=resources, port=63782, bridgeCount=1,
        artiSHA256=producer.ARTI, lyrebirdSHA256=producer.HELPER,
        publicBridgesSHA256=producer.REVIEWED, chosenLineSHA256=producer.LINE,
        fixedHTTPS='https://www.iana.org/domains/reserved',
        fixedTargets=['https://www.iana.org/domains/reserved', producer.TARGET], fixedMethod='GET',
        argvRedacted=[str(Path(resources) / 'arti'), 'proxy', '--config', str(profile / 'arti.toml'),
                      '--log-level', 'info', '-o', 'bridges.bridges=<exact-reviewed-first-snowflake>',
                      '-o', 'bridges.transports=<fixed-snowflake-managed-contract>'],
        bootstrapDeadlineSeconds=600, httpsDeadlineSeconds=20, experimentDifference='fixture baseline DATA',
        privacyAdmission='UNCHANGED_BLOCKED')
    derived = copy.deepcopy(baseline)
    derived.update(schema='P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V2', artiSHA256=producer.DERIVED_ARTI,
                   artiVariant=producer.DERIVED_VARIANT, artiSourceInputsSHA256=producer.DERIVED_SOURCE,
                   experimentDifference='derived QA Arti non-direct10->30 only; SF10/packetguards/TLS/caps unchanged; CLI-vs-managed require this same actual Arti SHA; path callbacks observation-only on independent CLI, fence on managed Browser')
    derived['argvRedacted'][0] = str(artifact / 'ArtiPublicChannelTimeout30')
    preparation = dict(status='PROFILE_PREPARED_SCOPE_REQUIRED', sourceDrift=[],
                       sourceAndSupplyPins={str(root / 'CLI-PLAN.json'): digest(encode(baseline))})
    transition = dict(schema='P05_PUBLIC_DERIVED_ARTI_PLAN_TRANSITION_V1', status='DERIVED_DATA_NOT_RUN',
                      derivedArtiSHA256=producer.DERIVED_ARTI, sourceInputsSHA256=producer.DERIVED_SOURCE)
    return baseline, derived, preparation, transition, profile, now


def write_plan(root, baseline, derived, preparation, transition):
    original = encode(baseline)
    current = encode(derived)
    transition.update(originalPlanSHA256=digest(original), derivedPlanSHA256=digest(current))
    (root / 'CLI-PLAN-BASELINE.json').write_bytes(original)
    (root / 'CLI-PLAN.json').write_bytes(current)
    (root / 'PLAN-DERIVATION.json').write_bytes(encode(transition))
    if preparation is not None:
        (root / 'PREPARATION.json').write_bytes(encode(preparation))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('producer', 'scope-producer', 'reviewed', 'helper', 'publisher-arti',
                 'publisher-lyrebird', 'derived-directory', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--producer-sha256', required=True)
    parser.add_argument('--scope-producer-sha256', required=True)
    args = parser.parse_args()
    out = args.output
    if not out.is_absolute() or out.exists():
        parser.error('Fresh absolute output required')
    sys.dont_write_bytecode = True
    scope_path = args.scope_producer.resolve(strict=True)
    scope = load_source(scope_path, args.scope_producer_sha256, 'prepare_public_entry_scope')
    sys.modules['prepare_public_entry_scope'] = scope
    producer_path = args.producer.resolve(strict=True)
    producer = load_source(producer_path, args.producer_sha256, 'v2_staging_producer_under_test')
    artifact = args.derived_directory.resolve(strict=True)
    reviewed = args.reviewed.resolve(strict=True)
    helper = args.helper.resolve(strict=True)
    out.mkdir(mode=0o700)
    staging = out / 'Inert PUBLIC Fixture.app'
    macos = staging / 'Contents/MacOS'
    tor = staging / 'Contents/Resources/PrivacyBackends/Tor'
    macos.mkdir(mode=0o700, parents=True)
    tor.mkdir(mode=0o700, parents=True)
    shutil.copy2(args.publisher_arti, tor / 'arti')
    shutil.copy2(args.publisher_lyrebird, tor / 'lyrebird')
    inert = b'P05 staging fixture, no executable instructions\n'
    (macos / 'Inert').write_bytes(inert)
    info_path = staging / 'Contents/Info.plist'
    result = dict(schema='P05_ACTUAL_V2_PRODUCER_CONTROLS_V1', status='RUNNING',
                  producerSHA256=args.producer_sha256, scopeProducerSHA256=args.scope_producer_sha256,
                  syntheticPlanAndPreparationData=True, actualPinnedSupplyBytes=True,
                  executableStarted=False, GUI=False, normalPrivacyAdmission=False, cases=[])
    cases = [
        ('rewritten-run-and-repinned-transition', 'derived-plan-exact-delta'),
        ('missing-original-preparation', 'FileNotFoundError'),
        ('changed-baseline-and-repinned-transition', 'original-preparation-plan-binding'),
        ('wrong-transition-schema', 'derived-plan-transition-binding'),
        ('changed-argv-tail-and-repinned-transition', 'derived-plan-exact-delta'),
        ('v2-missing-derived-artifact-option', 'prepared-plan-binding'),
        ('changed-derived-manifest', 'derived-artifact-pin'),
        ('inherited-url-handler', 'wrong-staging-role'),
        ('nym-public-marker-false', 'wrong-staging-role'),
        ('proof-marker-false', 'wrong-staging-role'),
        ('nonboolean-snowflake-marker', 'wrong-staging-role'),
        ('valid-v2', None),
    ]
    try:
        for name, expected in cases:
            root = out / name
            baseline, derived, preparation, transition, profile, now = make_fixture(
                root, producer, scope, artifact, reviewed)
            info = {'CFBundleIdentifier': 'com.ynxweb4.browser.qa.inert.fixture', 'CFBundleExecutable': 'Inert'}
            selected_artifact = artifact
            if name == 'rewritten-run-and-repinned-transition':
                derived['runID'] = str(uuid.uuid4())
                scope_file = profile / scope.SCOPE_NAME
                scope_data = json.loads(scope_file.read_bytes())
                scope_data['runID'] = derived['runID']
                scope_file.write_bytes(encode(scope_data))
            elif name == 'missing-original-preparation':
                preparation = None
            elif name == 'changed-baseline-and-repinned-transition':
                baseline['bootstrapDeadlineSeconds'] = 601
            elif name == 'wrong-transition-schema':
                transition['schema'] = 'P05_TEST_UNRECOGNIZED_TRANSITION'
            elif name == 'changed-argv-tail-and-repinned-transition':
                derived['argvRedacted'][-1] = 'bridges.transports=<changed>'
            elif name == 'v2-missing-derived-artifact-option':
                selected_artifact = None
            elif name == 'changed-derived-manifest':
                selected_artifact = root / 'wrong-artifact'
                selected_artifact.mkdir(mode=0o700)
                shutil.copy2(artifact / 'ArtiPublicChannelTimeout30', selected_artifact)
                manifest = json.loads((artifact / 'manifest.json').read_bytes())
                manifest['nonDirectSeconds'] = 31
                (selected_artifact / 'manifest.json').write_bytes(encode(manifest))
            elif name == 'inherited-url-handler':
                info['CFBundleURLTypes'] = [{'CFBundleURLSchemes': ['p05-inert-fixture']}]
            elif name == 'nym-public-marker-false':
                info['YNXPublicNymSearchDiagnostic'] = False
            elif name == 'proof-marker-false':
                info['YNXNymProofHelper'] = False
            elif name == 'nonboolean-snowflake-marker':
                info.update(CFBundleIdentifier=producer.ROLE, YNXPublicSearchDiagnostic=True,
                            YNXPublicSnowflakeSearchDiagnostic=1)
            write_plan(root, baseline, derived, preparation, transition)
            info_bytes = plistlib.dumps(info)
            info_path.write_bytes(info_bytes)
            before = set(str(path.relative_to(staging)) for path in staging.rglob('*'))
            actual = None
            receipt = None
            try:
                receipt = producer.prepare(staging, root, helper, reviewed, digest(inert),
                                           now_ns=now, derived_directory=selected_artifact)
            except FileNotFoundError:
                actual = 'FileNotFoundError'
            except ValueError as error:
                actual = str(error)
            after = set(str(path.relative_to(staging)) for path in staging.rglob('*'))
            unchanged = before == after and info_bytes == info_path.read_bytes()
            result['cases'].append(dict(name=name, expected=expected, actual=actual,
                                        stagingUnchanged=unchanged, accepted=receipt is not None))
            if actual != expected or (expected is not None and (receipt is not None or not unchanged)):
                raise RuntimeError('producer contract failed: ' + name)
            if expected is None:
                launch_dir = staging / 'Contents/Resources/PublicSnowflakeQA'
                launch_raw = (launch_dir / 'launch.json').read_bytes()
                launch = json.loads(launch_raw)
                sealed_info = plistlib.loads(info_path.read_bytes())
                if (receipt is None or len(launch) != 18 or launch['runID'] != baseline['runID']
                        or launch['schema'] != 'P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V2'
                        or launch['fixedTarget'] != producer.TARGET or launch['artiSHA256'] != producer.DERIVED_ARTI
                        or sealed_info['YNXPublicArtiChannelTimeoutExperiment'] is not True
                        or sealed_info['YNXPublicSnowflakeLaunchSHA256'] != digest(launch_raw)
                        or digest((launch_dir / 'ChannelTimeoutQA/arti').read_bytes()) != producer.DERIVED_ARTI
                        or digest((tor / 'arti').read_bytes()) != producer.ARTI
                        or digest((tor / 'lyrebird').read_bytes()) != producer.PUBLISHER):
                    raise RuntimeError('positive V2 staging readback failed')
                result['positiveReadback'] = receipt
        result['status'] = 'PASS'
    except BaseException as error:
        result['status'] = 'FAIL_STOP_NO_RETRY'
        result['firstFailure'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status=result['status'], cases=len(result['cases']), receipt=str(out / 'RESULT.json'))))


if __name__ == '__main__':
    main()
