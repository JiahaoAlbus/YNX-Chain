#!/usr/bin/env python3
"""Run exactly one pinned QA directory diagnostic with a new empty NYM_HOME_DIR."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
BASE = Path('/REDACTED_VOLUME/YNX-large-work')
PR = BASE / 'coordination-v5-20261031/owners/P05/privacy-routing'
WORK = PR / 'nym-directory-body-idle-20261113/exact-qa-release'
GUARD = PR / 'nym-qa-cdn-fullfeature-20261108/run_fullfeature_v4.py'
R2 = PR.parent / 'r2-20261107/nym/r2_executor.py'
BUILD = WORK / 'build-reconciled/receipt.json'
ARTIFACT = BUILD.parent / 'artifacts/qa-feature-on/nym-socks5-client'
LIMITS = {'stdout': 16_777_217, 'stderr': 524288}
GLUE = HERE.parents[2] / 'qa-glue'
SHA_PINS = {
    GUARD: 'b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05',
    R2: '330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67',
    GLUE / 'qa_capability_directory_capture.py': '9ba062808f0d45a3c9da3573035a071850959d2e2e997dfbb7fb8fcbeea48e0e',
    GLUE / 'qa_directory_body_failure.py': '58d44ccff2e21a106a0d81bc7a69509e87f95dbd0a2960591015f68ecb0038e1',
    HERE / 'fresh-route.py': '8bba50c6babb10114a9fc1d144d6b6d455468f149c03d2a197f0808b50293a69',
}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()


def check_pin(path, digest):
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest) or path.is_symlink() or sha(path) != digest:
        raise RuntimeError('input-pin: ' + str(path))


def module(path):
    check_pin(path, SHA_PINS[path])
    name = path.stem
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


def save(path, value):
    with path.open('x') as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(value, output, indent=2, sort_keys=True)
        output.write('\n')


def verified_build(receipt_sha, binary_sha):
    check_pin(BUILD, receipt_sha)
    result = json.loads(BUILD.read_text())
    if (result['schema'] != 'P05_NYM_QA_BODY_DIAGNOSTIC_RELEASE_V1'
            or any(result[key] for key in ('firstFailure', 'cleanupFailure', 'remainingOwned', 'childOutcomeRecordingFailure'))
            or result['sourceStable'] is not True or result['productionRelease'] is not False):
        raise RuntimeError('no-confirmed-qa-release')
    source, artifact = result['sourceManifest'], result['artifact']
    check_pin(Path(source['path']), source['SHA256'])
    if (artifact['path'] != str(ARTIFACT) or artifact['SHA256'] != binary_sha
            or artifact['sourceManifestSHA256'] != source['SHA256']):
        raise RuntimeError('qa-artifact-provenance')
    check_pin(ARTIFACT, binary_sha)
    expected = ('qa-release-build', 'qa-release-code-signature', 'qa-release-version')
    steps = result['steps']
    if (tuple(step['name'] for step in steps) != expected
            or not all(step['exit'] == 0 and step['reaped'] is True for step in steps)
            or steps[1]['argv'] != ['/usr/bin/codesign', '--verify', '--strict', '--all-architectures', str(ARTIFACT)]):
        raise RuntimeError('qa-artifact-not-built-and-signature-checked')
    return source['SHA256']


def capacity(g):
    return {'utc': g.utc(), 'memoryFreePercent': g.memory(),
            'homeFreeBytes': g.free(g.HOME_VOLUME_PATH), 'WDFreeBytes': g.free(WORK)}


def fetch(g, decoder, observer, r2, receipt_sha, binary_sha, source_sha, scope_path, scope_sha):
    baseline = capacity(g)
    if baseline['memoryFreePercent'] < 35 or baseline['homeFreeBytes'] < int(2.25 * g.GIB) or baseline['WDFreeBytes'] < 16 * g.GIB:
        raise RuntimeError('fresh-resource-floor')
    check_pin(scope_path, scope_sha)
    scope = json.loads(scope_path.read_text())
    required = {'schema', 'runnerSHA256', 'buildReceiptSHA256', 'binarySHA256',
                'notBefore', 'latestStart', 'purpose'}
    if (set(scope) != required or scope['schema'] != 'P05_NYM_BODY_DIAGNOSTIC_SCOPE_V1'
            or scope['runnerSHA256'] != sha(Path(__file__)) or scope['buildReceiptSHA256'] != receipt_sha
            or scope['binarySHA256'] != binary_sha or scope['purpose'] not in
            ('fresh-empty-profile-directory-body-only', 'fresh-directory-then-one-fixed-ddg')
            or type(scope['notBefore']) is not int or type(scope['latestStart']) is not int
            or not 0 < scope['latestStart'] - scope['notBefore'] <= 900
            or not scope['notBefore'] <= time.time() < scope['latestStart']):
        raise RuntimeError('scope-pins-or-start-window')
    network_before = r2.network_fingerprint()
    if not all(item['exit'] == 0 for item in network_before['components'].values()):
        raise RuntimeError('original-network-fingerprint-unavailable')
    # Each build can consume exactly one real directory attempt. A failed capture is
    # retained under that same directory. No caller-supplied output changes this CAS.
    case = WORK / 'once-fresh-directory'
    case.mkdir(mode=0o700)
    home = case / 'nym-home'
    home.mkdir(mode=0o700)
    tmp = case / 'tmp'
    tmp.mkdir(mode=0o700)
    started = time.monotonic()
    run = 'qa-dir-' + uuid.uuid4().hex
    issued = int(time.time())
    expires = issued + 120
    deadline = time.monotonic() + max(0, expires - time.time())
    plan = case / 'plan.json'
    save(plan, {'schema': 'YNX_NYM_QA_CDN_DIRECTORY_V1', 'purpose': 'fresh-complete-directory-only',
                'runID': run, 'issuedAt': issued, 'expiresAt': expires,
                'networkDefaultsSHA256': '596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b',
                'origin': 'https://cdn1.media-platform.net', 'addresses': ['172.104.178.252']})
    plan_sha = sha(plan)
    argv = [str(ARTIFACT), '--no-banner', 'ynx-qa-cdn-directory', '--plan', str(plan),
            '--plan-sha256', plan_sha, '--run-id', run]
    env = {key: os.environ[key] for key in ('HOME', 'USER', 'LOGNAME', 'LANG', 'TZ') if key in os.environ}
    env.update(PATH='/usr/bin:/bin', NYM_HOME_DIR=str(home), TMPDIR=str(tmp) + '/',
               NO_COLOR='1', RUST_LOG='ynx_qa_directory=info')
    owner = g.Build({'requestedLimitsNotYetGranted': {'aggregateSeconds': 1800, 'cleanupReserveSeconds': 15}}, case, started)
    child = None
    data = {key: bytearray() for key in LIMITS}
    eof = set()
    samples, remaining, signals = [], [], []
    failure = cleanup_failure = summary = diagnostic = None
    code = None
    capture_completed = False
    cancelled = False

    def cancel(signum, _frame):
        nonlocal cancelled
        signals.append({'utc': g.utc(), 'signal': signum})
        cancelled = True

    def require_live():
        if cancelled:
            raise g.CallerCancelled('caller-cancelled')

    signal.signal(signal.SIGINT, cancel)
    signal.signal(signal.SIGTERM, cancel)
    save(case / 'start.json', {'utc': g.utc(), 'pid': os.getpid(), 'capacity': baseline,
                              'scopeSHA256': scope_sha, 'planSHA256': plan_sha, 'runID': run, 'expiresAt': expires,
                              'sourceManifestSHA256': source_sha, 'binarySHA256': binary_sha,
                              'buildReceiptSHA256': receipt_sha, 'profileStartedEmpty': True,
                              'networkBefore': network_before, 'argv': argv})
    sel = selectors.DefaultSelector()
    try:
        require_live()
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env=env, cwd=case, start_new_session=True)
        owner.children.append(child)
        owner.groups.add(child.pid)
        record = {'name': 'fresh-directory-once', 'pid': child.pid, 'pgid': child.pid,
                  'utc': g.utc(), 'monotonicStarted': time.monotonic(), 'argv': argv}
        owner.steps.append(record)
        owner.child_records[child] = record
        save(case / 'process-start.json', record)
        print(json.dumps({'actualChild': record, 'expiresAt': expires, 'case': str(case)}), flush=True)
        for name, pipe in (('stdout', child.stdout), ('stderr', child.stderr)):
            os.set_blocking(pipe.fileno(), False)
            sel.register(pipe, selectors.EVENT_READ, name)
        next_sample = started
        next_network_sample = started + 5
        while child.poll() is None or len(eof) != 2:
            require_live()
            now = time.monotonic()
            if now >= min(deadline + 2, started + 135):
                raise RuntimeError('directory-observation-deadline')
            if now >= next_sample:
                rss = sum(row['rss'] for row in owner.owned())
                sample = capacity(g)
                sample.update(rssBytes=rss, elapsed=now - started)
                samples.append(sample)
                if (rss > g.GIB or sample['memoryFreePercent'] < 20
                        or sample['homeFreeBytes'] < 2 * g.GIB or sample['WDFreeBytes'] < 16 * g.GIB
                        or baseline['WDFreeBytes'] - sample['WDFreeBytes'] > 64 * 1024**2):
                    raise RuntimeError('directory-resource-limit')
                next_sample = now + 1
            if now >= next_network_sample:
                if r2.network_fingerprint()['fingerprintSHA256'] != network_before['fingerprintSHA256']:
                    raise RuntimeError('original-network-fingerprint-changed')
                next_network_sample = now + 5
            for key, _ in sel.select(.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                name = key.data
                if not chunk:
                    sel.unregister(key.fileobj)
                    key.fileobj.close()
                    eof.add(name)
                elif len(data[name]) + len(chunk) <= LIMITS[name]:
                    data[name].extend(chunk)
                else:
                    raise RuntimeError('directory-output-limit:' + name)
        code = child.wait()
        capture_completed = child.stdout.closed and child.stderr.closed and not owner.owned()
        if not capture_completed:
            raise RuntimeError('directory-child-or-fd-ownership-incomplete')
        check_pin(ARTIFACT, binary_sha)
        check_pin(plan, plan_sha)
        if code:
            raise RuntimeError('directory-original-exit:' + str(code))
        require_live()
        decoder.require_terminal_capture(code, True, True, False, False, expires, int(deadline * 1e9), time.time(), time.monotonic_ns())
        parsed = decoder.parse_directory_output(bytes(data['stdout']), bytes(data['stderr']), run)
        epoch = parsed.value['epoch']['total_elapsed_epochs']
        if epoch != parsed.value['basic']['metadata']['absolute_epoch_id']:
            raise RuntimeError('directory-output-epoch-mismatch')
        summary = {'epoch': epoch, 'basicRows': len(parsed.value['basic']['nodes']['data']),
                   'describedRows': len(parsed.value['described']['data']),
                   'entryCandidates': len(parsed.entry_node_ids), 'exitCandidates': len(parsed.exit_node_ids),
                   'exactPayloadSHA256WithoutFinalLF': parsed.payload_sha256}
    except BaseException as error:
        failure = {'utc': g.utc(), 'type': type(error).__name__, 'cause': str(error)}
    finally:
        try:
            remaining = owner.cleanup()
        except BaseException as error:
            cleanup_failure = {'type': type(error).__name__, 'cause': str(error)}
            remaining = [{'state': 'UNKNOWN', 'pid': process.pid} for process in owner.children] or [{'state': 'UNKNOWN'}]
        sel.close()
        if child is not None:
            child.stdout.close()
            child.stderr.close()
        labels = set(re.findall(rb'qa-directory-[a-z-]{1,64}', bytes(data['stderr'])))
        if failure is not None and len(data['stdout']) <= 8192:
            labels.update(re.findall(rb'qa-directory-[a-z-]{1,64}', bytes(data['stdout'])))
        fixed = sorted(label.decode('ascii') for label in labels)[:16]
        if code is not None and code != 0 and capture_completed and not remaining and cleanup_failure is None:
            diagnostic = observer.public_body_failure(bytes(data['stderr']), run, fixed,
                                                       terminal_capture_complete=True)
        profile_empty = not any(home.iterdir())
        network_after = None
        try:
            network_after = r2.network_fingerprint()
            if network_after['fingerprintSHA256'] != network_before['fingerprintSHA256'] and failure is None:
                failure = {'utc': g.utc(), 'type': 'RuntimeError', 'cause': 'original-network-fingerprint-changed'}
        except Exception:
            if failure is None:
                failure = {'utc': g.utc(), 'type': 'RuntimeError', 'cause': 'final-network-fingerprint-unavailable'}
        if not profile_empty and failure is None:
            failure = {'utc': g.utc(), 'type': 'RuntimeError', 'cause': 'directory-only-profile-was-written'}
        result = {'schema': 'P05_NYM_BODY_DIAGNOSTIC_ONCE_RESULT_V1', 'firstFailure': failure,
                  'cleanupFailure': cleanup_failure, 'childOutcomeRecordingFailure': owner.child_outcome_recording_failure,
                  'processes': owner.steps, 'remainingOwned': remaining, 'outputBytes': {key: len(value) for key, value in data.items()},
                  'capturedEOF': sorted(eof), 'FDClosed': child is not None and child.stdout.closed and child.stderr.closed,
                  'fixedErrorLabels': fixed, 'bodyFailure': diagnostic, 'completedDirectory': summary,
                  'issuedAt': issued, 'expiresAt': expires, 'actualElapsed': time.monotonic() - started,
                  'buildReceiptSHA256': receipt_sha, 'sourceManifestSHA256': source_sha, 'binarySHA256': binary_sha,
                  'scopeSHA256': scope_sha, 'planSHA256': plan_sha, 'freshQAProfileRemainsEmpty': profile_empty,
                  'HOMEInheritedUnchanged': env.get('HOME') == os.environ.get('HOME'),
                  'networkBefore': network_before, 'networkAfter': network_after,
                  'profileInitGatewayRuntimeOrTargetHTTPSRunDuringDirectory': False, 'productionQualification': False}
        save(case / 'samples.json', samples)
        output = case / 'receipt.json'
        save(output, result)
        print(json.dumps({'result': str(output), 'SHA256': sha(output), 'summary': result}), flush=True)
        if remaining:
            owner.custody(output, signals)
    if failure or cleanup_failure or remaining or owner.child_outcome_recording_failure:
        return 1
    if scope['purpose'] == 'fresh-directory-then-one-fixed-ddg':
        require_live()
        follow = module(HERE / 'fresh-route.py')
        return follow.run(sys.modules[__name__], g, r2, case, home, parsed, expires,
                          int(deadline * 1e9), started, network_before, require_live)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true', required=True)
    parser.add_argument('--build-receipt-sha256', required=True)
    parser.add_argument('--binary-sha256', required=True)
    parser.add_argument('--scope-sha256', required=True)
    args = parser.parse_args()
    g = module(GUARD)
    decoder = module(GLUE / 'qa_capability_directory_capture.py')
    observer = module(GLUE / 'qa_directory_body_failure.py')
    r2 = module(R2)
    source_sha = verified_build(args.build_receipt_sha256, args.binary_sha256)
    return fetch(g, decoder, observer, r2, args.build_receipt_sha256, args.binary_sha256, source_sha,
                 WORK / 'DIRECTORY_SCOPE.json', args.scope_sha256)


if __name__ == '__main__':
    raise SystemExit(main())
