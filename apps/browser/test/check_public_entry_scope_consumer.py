#!/usr/bin/env python3
"""Round-trip the real producer into a hash-pinned QA helper's FS-only loader."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import string
import subprocess
import time
import uuid

HERE = Path(__file__).resolve().parent
PRODUCER_SHA = 'c1014a081ad8207bb9a97f64bb5171c10cacf439988405fbb0b8582588c3a675'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--binary-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    binary = args.binary.resolve()
    if hashlib.sha256(binary.read_bytes()).hexdigest() != args.binary_sha256:
        raise ValueError('QA helper identity mismatch; nothing executed')
    producer = HERE / 'prepare_public_entry_scope.py'
    if hashlib.sha256(producer.read_bytes()).hexdigest() != PRODUCER_SHA:
        raise ValueError('producer identity mismatch; nothing executed')
    spec = importlib.util.spec_from_file_location('actual_scope_producer', producer)
    scope = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scope)
    source = HERE / 'fixtures/public-entry-reviewed-bridges.json'
    fronts, stun = scope.reviewed_hosts(source)
    maps = {name: ['2606:4700:4700::1111', '8.8.8.8'] for name in fronts + stun}
    records = []
    failure = None
    for case in ['valid', 'missing', 'duplicate-key', 'profile-identity', 'unknown-field', 'private-address']:
        case_dir = out / case
        case_dir.mkdir(mode=0o700)
        suffix = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8))
        profile = case_dir / ('ynx-public-search-' + suffix) / 'YNX Browser Route State/Tor'
        profile.mkdir(parents=True, mode=0o700)
        profile = profile.resolve()
        state = profile / 'pt-state'
        state.mkdir(mode=0o700)
        if case != 'missing':
            now = time.time_ns()
            produced = scope.prepare(profile, source, maps, str(uuid.uuid4()),
                                     now + 100_000_000_000, now + 100_000_000_000)
            path = profile / scope.SCOPE_NAME
            raw = path.read_bytes()
            if case != 'valid':
                saved = case_dir / 'prepared-before-negative-mutation.json'
                saved.write_bytes(raw)
                saved.chmod(0o600)
                plan = json.loads(raw)
                if case == 'duplicate-key':
                    raw = b'{"schema":"P05_PUBLIC_ENTRY_QA_SCOPE_V1",' + raw[1:]
                else:
                    if case == 'profile-identity':
                        plan['profileInode'] += 1
                    elif case == 'unknown-field':
                        plan['unexpected'] = True
                    elif case == 'private-address':
                        plan['addresses'][fronts[0]] = ['127.0.0.1']
                    raw = (json.dumps(plan, sort_keys=True) + '\n').encode()
                path.write_bytes(raw)
            input_hash = hashlib.sha256(raw).hexdigest()
        else:
            input_hash = None
        # Only this isolated child receives its fresh profile. The caller's environment,
        # user profile and ordinary browser configuration are never changed.
        child_environment = dict(os.environ)
        child_environment.update(YNX_PUBLIC_ENTRY_QA_PROFILE_HOME=str(profile), YNX_PUBLIC_ENTRY_QA_ROLE='tor-fixed-public-backend',
                                 TOR_PT_STATE_LOCATION=str(state), TOR_PT_CLIENT_TRANSPORTS='snowflake',
                                 TOR_PT_SERVER_TRANSPORTS='', TOR_PT_PROXY='', TOR_PT_EXIT_ON_STDIN_CLOSE='1')
        command = [str(binary), '-checkScopeOnly']
        started = time.monotonic()
        child = subprocess.Popen(command, env=child_environment, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        timed_out = False
        try:
            stdout, stderr = child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                stdout, stderr = child.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                stdout, stderr = child.communicate()
        (case_dir / 'stdout').write_bytes(stdout)
        (case_dir / 'stderr').write_bytes(stderr)
        row = dict(case=case, pid=child.pid, exit=child.returncode, reaped=True,
                   timedOut=timed_out, seconds=time.monotonic() - started,
                   inputSHA256=input_hash, expectedExit=0 if case == 'valid' else 2)
        if case == 'valid' and child.returncode == 0:
            try:
                response = json.loads(stdout)
                row['actualLoaderResponse'] = response
                row['responseValid'] = (response.get('schema') == 'P05_PUBLIC_ENTRY_QA_SCOPE_CHECK_V1'
                    and response.get('scopeValidated') is True and response.get('network') == 'NOT_RUN'
                    and response.get('privacyAdmission') == 'UNCHANGED_BLOCKED')
            except (ValueError, TypeError):
                row['responseValid'] = False
        records.append(row)
        if timed_out or child.returncode != row['expectedExit'] or row.get('responseValid') is False:
            failure = case
        result = dict(status='FAIL' if failure else 'RUNNING', firstCause=failure,
                      binarySHA256=args.binary_sha256, producerSHA256=PRODUCER_SHA,
                      records=records, DNS='NOT_RUN', ArtiOrPTListener='NOT_RUN',
                      normalPrivacyAdmission='UNCHANGED_BLOCKED')
        (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
        if failure:
            break
    if not failure:
        result['status'] = 'PASS'
        (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    raise SystemExit(1 if failure else 0)


if __name__ == '__main__':
    main()
