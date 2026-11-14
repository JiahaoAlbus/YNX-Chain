#!/usr/bin/env python3
"""Resolve only the fixed reviewed QA bootstrap names; never launch a backend."""
import argparse
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_input', HERE / 'prepare_public_entry_scope.py')
SCOPE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(SCOPE)


def checked_answer(values):
    if not isinstance(values, list) or not values or len(values) > 64:
        raise ValueError('DNS answer count outside bounds')
    result = []
    for value in values:
        if not isinstance(value, str) or '%' in value:
            raise ValueError('DNS answer outside public policy')
        canonical = str(ipaddress.ip_address(value))
        SCOPE.canonical_public_ip(canonical)
        result.append(canonical)
    result = sorted(set(result))
    if not 1 <= len(result) <= 16:
        raise ValueError('unique DNS answer count outside bounds')
    return result


def worker(source, name):
    fronts, stun = SCOPE.reviewed_hosts(source)
    if name not in fronts + stun:
        raise ValueError('unreviewed DNS name')
    port = 443 if name in fronts else 3478
    kind = socket.SOCK_STREAM if name in fronts else socket.SOCK_DGRAM
    responses = socket.getaddrinfo(name, port, socket.AF_UNSPEC, kind)
    values = []
    for family, _, _, _, address in responses:
        if family not in (socket.AF_INET, socket.AF_INET6):
            raise ValueError('unsupported DNS address family')
        if family == socket.AF_INET6 and address[3] != 0:
            raise ValueError('scoped DNS answer rejected')
        values.append(address[0])
    return checked_answer(values)


def collect(source, lookup):
    fronts, stun = SCOPE.reviewed_hosts(source)
    result = {}
    for name in fronts + stun:
        result[name] = checked_answer(lookup(name))
    # Reject excess tuples rather than choosing a partial STUN answer set.
    nat = {ip for name in stun for ip in result[name] if ipaddress.ip_address(ip).version == 4}
    if len(nat) > 64:
        raise ValueError('STUN tuple count outside bounds')
    return result


def supervised_worker(argv, records, name, timeout=8):
    """Reap the exact lookup worker before accepting any result or failing."""
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = child.communicate(timeout=timeout)
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
    row = dict(name=name, pid=child.pid, exit=child.returncode, reaped=True, timedOut=timed_out)
    # Retain diagnostic codes, never arbitrary resolver output or addresses.
    try:
        diagnostic = json.loads(stderr) if len(stderr) <= 1024 else None
        if (type(diagnostic) is dict and diagnostic.get('schema') == 'P05_BOOTSTRAP_DNS_WORKER_ERROR_V1'
                and diagnostic.get('errorType') in ('gaierror', 'ValueError', 'OSError')
                and (diagnostic.get('errno') is None or type(diagnostic.get('errno')) is int)):
            row['workerError'] = {k: diagnostic[k] for k in ('errorType', 'errno')}
    except (ValueError, KeyError):
        pass
    records.append(row)
    if child.returncode or timed_out or len(stdout) > 8192:
        raise ValueError('bounded DNS worker failed')
    return checked_answer(json.loads(stdout))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviewed-source', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--resolve-approved', action='store_true', help='Perform real bootstrap DNS only when the QA trial is authorized')
    mode.add_argument('--worker-name', help=argparse.SUPPRESS)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.worker_name:
        try:
            print(json.dumps(worker(args.reviewed_source, args.worker_name)))
        except Exception as error:
            kind = type(error).__name__
            number = getattr(error, 'errno', None)
            print(json.dumps(dict(schema='P05_BOOTSTRAP_DNS_WORKER_ERROR_V1',
                                  errorType=kind if kind in ('gaierror', 'ValueError', 'OSError') else 'OSError',
                                  errno=number if type(number) is int else None)), file=sys.stderr)
            raise SystemExit(2)
        return
    if args.output is None:
        parser.error('--output is required for DNS collection')
    out = args.output.resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    records = []
    started = time.monotonic()
    failed = False
    result = dict(status='RUNNING', records=records, backend='NOT_RUN', productionQualification=False)
    def lookup(name):
        if time.monotonic() - started >= 90:
            raise TimeoutError('bootstrap DNS deadline')
        argv = [sys.executable, str(Path(__file__).resolve()), '--reviewed-source', str(args.reviewed_source.resolve()), '--worker-name', name]
        return supervised_worker(argv, records, name)
    try:
        maps = collect(args.reviewed_source, lookup)
        raw = (json.dumps(maps, sort_keys=True, separators=(',', ':')) + '\n').encode()
        fd = os.open(out / 'addresses.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        result.update(status='COLLECTED_BOOTSTRAP_DNS_ONLY', mappingSHA256=hashlib.sha256(raw).hexdigest(),
                      hosts=len(maps), addresses=sum(map(len, maps.values())))
    except Exception as error:
        result.update(status='FAILED_NO_SCOPE_CREATED', firstCause=type(error).__name__)
        failed = True
    finally:
        result['seconds'] = time.monotonic() - started
        (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
        # Actual numeric mappings are private inputs, not console/log fields.
        print(json.dumps(result, sort_keys=True))
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
