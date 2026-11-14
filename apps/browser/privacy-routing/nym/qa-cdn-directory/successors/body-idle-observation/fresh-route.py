"""Consume one live, verified directory capture in the original Nym 1.1.88 QA lifecycle."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import threading
import time
import types
import uuid


def run(runner, g, r2, case, home, parsed, capture_wall, capture_monotonic, started, baseline, require_live):
    pins = {
        'mac_cdn_fresh_executor': '8a9e3955d5481efbf3a25b6b70b75ad0edb8a109b73007e83b1cd077f639c8f8',
        'qa_directory_capture': '57e5a9e0542654b81faf20fa32f94840ff81186ac28e1b847c86bcd18a8659fc',
        'diagnose_registered_capability_r9_ddg_once': '5ffe9b290c1db1392e1a93f225b38d832aa4f9b88ffb21510d7d8e91b76ac6f4',
        'nym_runtime_stage_observer': '2aa91b26648b5465d11b52184a9e43c9fcbc12d9289049eef4c917b1e999fd7b',
        'nym_ddg_stage_observer': 'e3ba4c31e60046258568213a3ebd626d5d3a27ed42fa18ef2acbf4bd86ecc760',
        'nym_reply_surb_observer': '09013886d67bc8269f164fd31e3af0da8a37c3f9ae8434775859994285a7a7f2',
        'nym_https_ddg_probe': 'cfbec78252dcad4ad27eff00c3a4e2ec9e127563b768ee961268c3e0730ca57a',
        'nym_ddg_content': '2e19e242cbd7ea13576f0880fb6b8bb8fe278823c625909e147e61a03681c486',
        'nym_https_stage_probe': 'a14cf0f3a1e1c5ffda4a0a18053890f93f1cec23535124b2109517bddca0aedc',
    }
    refs = {name: runner.GLUE / (name + '.py') for name in pins}

    def load(name):
        path = refs[name]
        runner.SHA_PINS[path] = pins[name]
        return runner.module(path)

    # Imports of pinned siblings are satisfied from the exact same source bytes.
    for name, digest in pins.items():
        runner.check_pin(refs[name], digest)
    load('qa_directory_capture')
    glue = load('mac_cdn_fresh_executor')
    r9 = load('diagnose_registered_capability_r9_ddg_once')
    observe = load('nym_runtime_stage_observer')
    search_observe = load('nym_ddg_stage_observer')
    surbs = load('nym_reply_surb_observer')
    runtime = glue.BUILD.parent / 'artifacts/qa-feature-on/nym-socks5-client'
    runner.check_pin(glue.BUILD, glue.BUILD_SHA)
    producer = json.loads(glue.BUILD.read_text())
    if (producer['firstFailure'] or producer['remainingOwned'] or producer['cleanupFailure']
            or not producer['sourceUnchanged'] or producer['preservedInputsChanged']
            or producer['originalMetadataChanged']):
        raise RuntimeError('original-runtime-provenance')
    runner.check_pin(runtime, glue.RUNTIME_SHA)
    r9.modern_component_metadata(verify_hashes=True)
    require_live()
    observer = search_observe.make_observer(surbs.ReplySurbObserver, uuid.uuid4().hex, 63801)
    make = glue.configure(r2, g, types.SimpleNamespace(facts=lambda: runner.capacity(g)), runtime)
    observe.install_observed_child(r2, observer)
    exp = make(argparse.Namespace(out=case / 'route', port=63781,
                                  budget_seconds=int(started + 360 - time.monotonic())))
    exp.end = min(exp.end, started + 315)
    exp.home = home
    exp.environment.update(NYM_HOME_DIR=str(home), PYTHONDONTWRITEBYTECODE='1')
    exp.profile = home / '.nym/socks5-clients' / exp.profileID
    monitor = None
    lock = None
    metadata = None
    cleanup_failures = []
    search_result = None
    before = baseline
    original_sample = exp.sample_resources
    old_check = exp.check

    def sample():
        original_sample()
        if r2.network_fingerprint()['fingerprintSHA256'] != before['fingerprintSHA256']:
            raise r2.Failed('security-network-fingerprint-changed')
        if metadata is not None and r2.profile_metadata(exp.profile) != metadata:
            raise r2.Failed('fresh-profile-metadata-changed')

    def check():
        old_check()
        if hasattr(exp, 'requester_failure'):
            failure = exp.requester_failure
            raise r2.Failed(failure['fixedReason'] + ':' + failure['classification'])

    def request_stop(*_):
        exp.stopRequested = True

    exp.sample_resources = sample
    exp.check = check
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    try:
        require_live()
        exp.check()
        exp.stage = 'verified-directory-selection'
        exp.parsed[id(parsed.value)] = parsed
        exp.capture_deadlines[id(parsed.value)] = (capture_wall, capture_monotonic)
        digests = [hashlib.sha256(json.dumps(parsed.value[key], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
                   for key in ('basic', 'described', 'epoch')]
        exp.selection = selection = exp.select(parsed.value, digests)
        for port in (63781, 63801):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
                reservation.bind(('127.0.0.1', port))
        if exp.end - time.monotonic() < 150:
            raise r2.Failed('insufficient-remaining-init-and-route-budget')
        if any(home.iterdir()):
            raise r2.Failed('fresh-profile-root-no-longer-empty')
        sample()
        monitor = threading.Thread(target=exp.monitor, daemon=True)
        monitor.start()
        exp.stage = 'official-init-once'
        exp.profile.mkdir(mode=0o700, parents=True, exist_ok=False)
        lock = os.open(exp.profile / '.ynx-run.lock', os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        r2.write_new(exp.out / 'init-intent-UNKNOWN.json',
                     dict(state='UNKNOWN', replayForbidden=True, profileID=exp.profileID, operationID=str(uuid.uuid4()), **r2.stamp()))
        command = exp.policy('init', selection) + [
            'init', '--id', exp.profileID, '--provider', selection['requester'],
            '--gateway', selection['entryIdentity'], '--host', '127.0.0.1', '--port', '63781',
            '--force-tls-gateway', '--use-reply-surbs', 'true', '--enabled-credentials-mode', 'false', '--output', 'json']
        init = json.loads(exp.run('official-init', command, seconds=110))
        if (init.get('id') != exp.profileID or init.get('gateway_id') != selection['entryIdentity']
                or init.get('fallback_listener', 'missing') is not None):
            raise r2.Failed('fresh-official-init-result-binding')
        candidate = r2.profile_metadata(exp.profile)
        if not all(record['exists'] for record in candidate.values()):
            raise r2.Failed('fresh-init-key-config-missing')
        r2.verify_config_scope(exp.profile, exp.profileID)
        address = init.get('client_address')
        if not isinstance(address, str) or not r2.RECIPIENT.fullmatch(address):
            raise r2.Failed('fresh-init-public-address-missing')
        exp.publicAddressSHA256 = hashlib.sha256(address.encode()).hexdigest()
        metadata = candidate
        r2.write_new(exp.out / 'init-complete.json', dict(
            actualChildExit=0, originalChildReaped=True, bothEOF=True, privateKeyContentsReadOrHashed=False,
            publicFingerprintHashed=True, publicClientAddressSHA256=exp.publicAddressSHA256,
            profileID=exp.profileID, version=init.get('version'), metadata=metadata, **r2.stamp()))

        exp.stage = 'gateway-readback'
        rows = json.loads(exp.run('list-gateways', exp.policy('gateway', selection) + [
            'list-gateways', '--id', exp.profileID, '--output', 'json'], limit=1048576, seconds=30))
        active = [row for row in rows if row.get('active') is True]
        endpoint = selection['endpoints'][-1]
        if (len(active) != 1 or active[0].get('fallback_endpoint', 'missing') is not None
                or bytes(active[0].get('identity', [])) != r2.identity_bytes(selection['entryIdentity'])
                or str(active[0].get('endpoint', '')).rstrip('/') != 'wss://' + endpoint['host'] + ':' + str(endpoint['port'])):
            raise r2.Failed('fresh-gateway-official-readback')
        exp.event('gateway-confirmed', {'active': 1, 'fallback': False})
        exp.environment['RUST_LOG'] = surbs.RUST_LOG
        backend = exp.bootstrap('run-fresh')
        if (observer.provider_sha256 != hashlib.sha256(selection['requester'].encode()).hexdigest()
                or observer.counts.get('listener_protocols', 0) != 1):
            raise r2.Failed('runtime-observer-provider-or-protocol-binding-unobserved')

        exp.stage = 'DDG-one-fixed-HTTPS'
        if min(exp.end - time.monotonic(), exp.runtime_expiry - time.time()) < 70:
            raise r2.Failed('insufficient-DDG-probe-and-cleanup-budget')
        r9.modern_component_metadata(verify_hashes=True)
        for name in ('nym_https_ddg_probe', 'nym_https_stage_probe', 'nym_ddg_content'):
            runner.check_pin(refs[name], pins[name])
        output = exp.out / 'DDG-probe'
        try:
            exp.run('DDG-once', [r9.MODERN_PROBE, str(refs['nym_https_ddg_probe']), '--port', '63781',
                                '--local-port', '63801', '--expires-at', str(exp.runtime_expiry),
                                '--output', str(output)], limit=65536, seconds=85)
        finally:
            path = output / 'result.json'
            if path.is_file() and not path.is_symlink() and path.stat().st_size <= 65536:
                try:
                    report = json.loads(path.read_text())
                    if report['schema'] == 'YNX_NYM_PUBLIC_DDG_RESULT_V1':
                        search_result = report
                except (TypeError, KeyError, ValueError):
                    pass
        if (not search_result or search_result['firstFailure'] is not None
                or search_result['result']['tlsHandshakeVerified'] is not True
                or search_result['result']['followedRedirect'] is not False):
            raise r2.Failed('DDG-result-not-verified')
        exp.stage = 'owned-runtime-stop'
        if exp.stop_child(backend) != 0 or backend.forced:
            raise r2.Failed('fresh-stop-not-graceful')
        sample()
    except BaseException as error:
        exp.first = exp.resourceFailure or dict(stage=exp.stage, type=type(error).__name__,
                                                message=r2.redact(str(error)), **r2.stamp())
    finally:
        for child in reversed(exp.children):
            if child.stopped is None:
                try:
                    exp.stop_child(child)
                except BaseException as error:
                    cleanup_failures.append({'originalPID': child.pid, 'type': type(error).__name__})
        exp.monitorDone.set()
        if monitor is not None:
            monitor.join(timeout=5)
        if lock is not None:
            fcntl.flock(lock, fcntl.LOCK_UN)
            os.close(lock)
        try:
            after = r2.network_fingerprint()
        except Exception:
            after = None
        network_stable = after is not None and after['fingerprintSHA256'] == before['fingerprintSHA256']
        if exp.first is None and (not network_stable or cleanup_failures or (monitor is not None and monitor.is_alive())):
            exp.first = {'stage': 'final-cleanup', 'message': 'network-or-owned-cleanup-unconfirmed'}
        result = dict(schema='P05_NYM_QA_FRESH_FULL_ROUTE_V1', firstFailure=exp.first, cleanupFailures=cleanup_failures,
                      directoryFetches=1, actualChildren=[child.receipt() for child in exp.children],
                      remainingOwned=[child.pid for child in exp.children if child.process.poll() is None],
                      runtimeSHA256=glue.RUNTIME_SHA, directoryPayloadSHA256=parsed.payload_sha256,
                      completedInit=(exp.out / 'init-complete.json').exists(), privateKeyContentsReadOrHashed=False,
                      priorProfileReadOrCopied=False, DDG=search_result, networkStable=network_stable,
                      normalOrReleaseAuthority=False, durationSeconds=time.monotonic() - started)
        r2.write_new(exp.out / 'result.json', result)
        exp.log.close()
        print(json.dumps({'result': str(exp.out / 'result.json'), 'firstFailure': exp.first,
                          'DDG': search_result, 'remainingOwned': result['remainingOwned']}), flush=True)
    return int(bool(exp.first or cleanup_failures or result['remainingOwned']))
