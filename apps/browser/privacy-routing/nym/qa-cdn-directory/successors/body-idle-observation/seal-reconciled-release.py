#!/usr/bin/env python3
"""Verify and copy the existing completed QA build after same-byte reconciliation."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time

WORK = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113/exact-qa-release')
COMPILED = WORK / 'target/release/nym-socks5-client'
RAW = WORK / 'build-resumed/receipt.json'
REVIEW = WORK / 'POSTBUILD_SOURCE_READBACK.json'
RAW_SHA = 'a0069a449f4f7a88e52a52045f250d4101baaa13cda9189fbc788af6f00eb7d5'
BINARY_SHA = '855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798'
SOURCE_SHA = '65838e1371153c3ac7a497bf628082115c5b1a7fbe87426effe0a9d9c0951055'


def check(path, expected):
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError('receipt-or-executable-pin:' + str(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reconciliation-sha256', required=True)
    args = parser.parse_args()
    check(REVIEW, args.reconciliation_sha256)
    check(RAW, RAW_SHA)
    check(COMPILED, BINARY_SHA)
    check(WORK / 'source-manifest.json', SOURCE_SHA)
    review = json.loads(REVIEW.read_text())
    raw = json.loads(RAW.read_text())
    steps = raw['steps']
    delta = review['mtimeOnlyDelta']
    if (review['schema'] != 'P05_NYM_EXACT_POSTBUILD_SOURCE_READBACK_V1'
            or review['verifiedFiles'] != 6615 or review['byteDrift'] is not False
            or review['preparedSourceManifestSHA256'] != SOURCE_SHA
            or review['sourceDeltaFromOriginal'] != ['common/http-api-client/src/qa_directory.rs']
            or len(delta) != 1 or delta[0]['path'] != 'envs/mainnet.env'
            or delta[0]['before']['sha256'] != delta[0]['after']['sha256']
            or delta[0]['modeEqual'] is not True or delta[0]['inodeDistinct'] is not True):
        raise RuntimeError('source-reconciliation-not-confirmed')
    if (raw['firstFailure']['cause'] != 'Prepared cache changed since hashing: envs/mainnet.env'
            or raw['cleanupFailure'] or raw['childOutcomeRecordingFailure'] or raw['remainingOwned']
            or len(steps) != 1 or steps[0]['pid'] != 30324 or steps[0]['exit'] != 0 or steps[0]['reaped'] is not True
            or raw['sourceManifest']['SHA256'] != SOURCE_SHA):
        raise RuntimeError('original-Cargo-build-not-confirmed')
    out = WORK / 'build-reconciled'
    out.mkdir(mode=0o700)
    dest = out / 'artifacts/qa-feature-on/nym-socks5-client'
    dest.parent.mkdir(mode=0o700, parents=True)
    shutil.copyfile(COMPILED, dest)
    dest.chmod(0o500)
    check(dest, BINARY_SHA)
    env = {'PATH': '/usr/bin:/bin'}
    cases = [
        ('qa-release-code-signature', ['/usr/bin/codesign', '--verify', '--strict', '--all-architectures', str(dest)]),
        ('qa-release-version', [str(dest), '--no-banner', '--version']),
    ]
    failure = None
    remaining = []
    for name, argv in cases:
        started = time.monotonic()
        with (out / (name + '.stdout')).open('xb') as stdout, (out / (name + '.stderr')).open('xb') as stderr:
            process = subprocess.Popen(argv, env=env, cwd=out, stdin=subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, start_new_session=True)
            print(json.dumps({'name': name, 'pid': process.pid, 'pgid': process.pid}), flush=True)
            try:
                exit_code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                exit_code = process.wait(timeout=5)
                failure = {'name': name, 'cause': 'deadline'}
            steps.append({'name': name, 'argv': argv, 'pid': process.pid, 'pgid': process.pid, 'exit': exit_code,
                          'reaped': True, 'elapsedSeconds': time.monotonic() - started})
        observed = subprocess.run(['/bin/ps', '-axo', 'pid=,pgid='], check=True, capture_output=True, text=True, timeout=3)
        remaining = [int(fields[0]) for line in observed.stdout.splitlines()
                     if len(fields := line.split()) == 2 and int(fields[1]) == process.pid]
        if remaining:
            failure = {'name': name, 'cause': 'original-probe-group-not-clear'}
            break
        if exit_code != 0:
            failure = failure or {'name': name, 'exit': exit_code}
            break
        if name == 'qa-release-version' and b'1.1.88' not in (out / (name + '.stdout')).read_bytes():
            failure = {'name': name, 'cause': 'version-did-not-match-1.1.88'}
            break
    check(dest, BINARY_SHA)
    result = {'schema': 'P05_NYM_QA_BODY_DIAGNOSTIC_RELEASE_V1', 'sourceManifest': raw['sourceManifest'],
              'CargoLockSHA256': raw['CargoLockSHA256'], 'originalBuildReceiptSHA256': RAW_SHA,
              'readOnlySourceReconciliationSHA256': args.reconciliation_sha256,
              'sourceStable': True, 'firstFailure': failure, 'cleanupFailure': None,
              'childOutcomeRecordingFailure': None, 'remainingOwned': remaining, 'productionRelease': False,
              'steps': steps, 'artifact': None if failure else {'path': str(dest), 'SHA256': BINARY_SHA,
                    'bytes': dest.stat().st_size, 'sourceManifestSHA256': SOURCE_SHA}}
    receipt = out / 'receipt.json'
    with receipt.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'receipt': str(receipt), 'SHA256': hashlib.sha256(receipt.read_bytes()).hexdigest(),
                      'artifact': result['artifact'], 'firstFailure': failure}), flush=True)
    return 1 if failure else 0


if __name__ == '__main__':
    raise SystemExit(main())
