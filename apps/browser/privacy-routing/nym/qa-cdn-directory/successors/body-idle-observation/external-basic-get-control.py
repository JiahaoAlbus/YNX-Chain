#!/usr/bin/env python3
"""One fixed public Basic GET, with verified stage timings and a bounded body sample."""

import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import socket
import ssl
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113/header-phase-get-external-only')
WRAPPER_SHA256 = '3fb533e225805606512bb5eb5b54846e3df77b82801428f2531e686303221300'
HEAD_SHA256 = '2dd8be848988d989d78a3088a30567aae49db267534fa385839b59c06b5a441b'
BODY_CAP = 4096


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wrapper():
    path = HERE / 'external-header-phase-control.py'
    if sha(path) != WRAPPER_SHA256:
        raise RuntimeError('external-only-wrapper-pin')
    spec = importlib.util.spec_from_file_location('audited_head', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HeaderSocket:
    """Use an unbuffered stream so header parsing does not prefetch body bytes."""

    def __init__(self, tls, helper):
        self.raw = tls.makefile('rb', buffering=0)
        self.reader = helper.HeaderReader(self.raw)

    def makefile(self, *_args, **_kwargs):
        return self.reader

    def close(self):
        self.raw.close()


def observe(peer, context, transport, helper, *, connect_seconds=8, total_seconds=20):
    if not context.check_hostname or context.verify_mode != ssl.CERT_REQUIRED:
        raise ValueError('strict-TLS-required')
    if not transport.REQUEST.startswith(b'HEAD '):
        raise ValueError('exact-HEAD-request-format')
    request = b'GET ' + transport.REQUEST[len(b'HEAD '):]
    started = time.monotonic()
    overall = started + total_seconds
    connect_until = min(overall, started + connect_seconds)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    guard = helper.SocketDeadlines(sock, overall)
    phase = 'tcp_connect'
    tls = response = headers = None
    result = {'phasesMilliseconds': {}, 'firstFailure': None, 'bodySampleBytes': 0}

    def timeout(deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or guard.expired:
            raise helper.PhaseFailure('DEADLINE')
        (tls if tls is not None else sock).settimeout(remaining)

    def mark(name):
        result['phasesMilliseconds'][name] = round(1000 * (time.monotonic() - started))

    try:
        guard.begin_stage(connect_until - time.monotonic())
        timeout(connect_until)
        sock.connect(peer)
        mark('tcpConnected')
        phase = 'tls_handshake'
        tls = context.wrap_socket(sock, server_hostname=transport.HOST, do_handshake_on_connect=False)
        guard.set_socket(tls)
        timeout(connect_until)
        tls.do_handshake()
        mark('tlsVerified')
        result['tlsProtocol'] = tls.version()
        phase = 'http_request_write'
        guard.begin_stage(overall - time.monotonic())
        timeout(overall)
        tls.sendall(request)
        mark('requestWritten')
        phase = 'http_response_headers'
        headers = HeaderSocket(tls, helper)
        response = http.client.HTTPResponse(headers, method='GET')
        response.begin()
        if not 200 <= response.status <= 599:
            raise helper.PhaseFailure('HTTP_FINAL_STATUS_REQUIRED')
        mark('responseHeaders')
        result.update(httpStatus=response.status, headerBytes=headers.reader.header_bytes)
        headers.reader.header_done = True
        if response.status == 200:
            phase = 'http_body_sample'
            timeout(overall)
            # Read the first available plaintext framing/data bytes directly.
            # Unlike HTTPResponse.read(4096), recv returns with the first data
            # and cannot wait for the rest of a page. Never record the bytes.
            sample = tls.recv(BODY_CAP)
            result['bodySampleBytes'] = len(sample)
            if sample:
                mark('bodySample')
    except (OSError, helper.PhaseFailure, http.client.HTTPException) as error:
        deadline = connect_until if phase in ('tcp_connect', 'tls_handshake') else overall
        if guard.expired or isinstance(error, (socket.timeout, TimeoutError)) or time.monotonic() >= deadline:
            reason = 'DEADLINE'
        elif isinstance(error, ssl.SSLCertVerificationError):
            reason = 'TLS_CERTIFICATE_REJECTED'
        elif isinstance(error, ssl.SSLError):
            reason = 'TLS_NEGOTIATION_FAILED'
        elif isinstance(error, http.client.HTTPException):
            reason = 'HTTP_RESPONSE_INVALID_OR_EOF'
        elif isinstance(error, helper.PhaseFailure):
            reason = 'DEADLINE' if str(error) == 'DEADLINE' else 'HTTP_HEADER_BOUND_OR_STATUS'
        else:
            reason = 'SOCKET_IO_FAILED'
        result['firstFailure'] = {'phase': phase, 'reason': reason}
    finally:
        result['deadlineOwnerJoined'] = guard.finish()
        if response is not None:
            response.close()
        if headers is not None:
            headers.close()
        if tls is not None:
            tls.close()
        sock.close()
        result.update(socketsClosed=sock.fileno() == -1 and (tls is None or tls.fileno() == -1),
                      totalMilliseconds=round(1000 * (time.monotonic() - started)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope-sha256', required=True)
    args = parser.parse_args()
    root = ROOT.resolve(strict=True)
    st = root.lstat()
    if (root != ROOT or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700
            or st.st_dev == Path('/Users/huangjiahao').stat().st_dev or Path.cwd().resolve() != root
            or os.environ.get('TMPDIR') != str(root) or not sys.dont_write_bytecode):
        raise RuntimeError('external-GET-case-not-isolated')
    scope_path = root / 'SCOPE.json'
    scope_stat = scope_path.lstat()
    if (not stat.S_ISREG(scope_stat.st_mode) or scope_stat.st_uid != os.getuid() or scope_stat.st_nlink != 1
            or stat.S_IMODE(scope_stat.st_mode) != 0o600 or scope_stat.st_size > 4096
            or not re.fullmatch('[0-9a-f]{64}', args.scope_sha256) or sha(scope_path) != args.scope_sha256):
        raise RuntimeError('external-GET-scope-file-pin')
    scope = json.loads(scope_path.read_text())
    names = {'schema', 'runnerSHA256', 'headReceiptSHA256', 'purpose', 'notBefore', 'latestStart'}
    if (set(scope) != names or scope['schema'] != 'P05_NYM_EXTERNAL_ONLY_GET_SCOPE_V1'
            or scope['runnerSHA256'] != sha(Path(__file__)) or scope['headReceiptSHA256'] != HEAD_SHA256
            or scope['purpose'] != 'one-basic-page-zero-GET-headers-and-first-4096'
            or type(scope['notBefore']) is not int or type(scope['latestStart']) is not int
            or not 0 < scope['latestStart'] - scope['notBefore'] <= 900
            or not scope['notBefore'] <= time.time() < scope['latestStart']):
        raise RuntimeError('external-GET-scope-time-or-shape')
    previous = root.parent / 'header-phase-external-only/one-basic-head/result.json'
    if previous.is_symlink() or sha(previous) != HEAD_SHA256:
        raise RuntimeError('observed-HEAD-comparison-pin')
    fs = os.statvfs(root)
    raw = subprocess.run(['/usr/bin/memory_pressure', '-Q'], capture_output=True, text=True, timeout=3, check=True)
    pressure = int(re.search(r'free percentage: (\d+)%', raw.stdout).group(1))
    if fs.f_bavail * fs.f_frsize < 16 * 1024**3 or pressure < 35:
        raise RuntimeError('external-GET-WD-or-memory-floor')
    audit = wrapper()
    transport = audit.verified_transport()
    helper = transport.load_helper()
    ctx = helper.verified_context()
    if ctx.cert_store_stats().get('x509_ca', 0) < 1:
        raise RuntimeError('external-GET-no-trusted-CA')
    resource.setrlimit(resource.RLIMIT_FSIZE, (audit.MAX_WRITE, audit.MAX_WRITE))
    case = root / 'one-basic-get'
    case.mkdir(mode=0o700)
    audit.cap_process_writes(case, transport.PEER)
    print(json.dumps({'pid': os.getpid(), 'pgid': os.getpgrp(), 'monotonicStart': time.monotonic(),
                      'scopeSHA256': args.scope_sha256, 'origin': transport.HOST}), flush=True)
    result = observe(transport.PEER, ctx, transport, helper)
    result.update(schema='P05_NYM_EXTERNAL_ONLY_GET_RESULT_V1', scopeSHA256=args.scope_sha256, method='GET',
                  headReceiptSHA256=HEAD_SHA256, runnerSHA256=scope['runnerSHA256'], bodySampleCap=BODY_CAP,
                  bodySampleKind='tls-application-framing-bytes-before-http-decoding',
                  tlsContextVerifyRequired=True, tlsContextCheckHostname=True,
                  rawResponsePersisted=False, acceptedDirectory=False, productionAuthority=False,
                  ownedProcessPeakRSSBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    encoded = (json.dumps(result, indent=2) + '\n').encode()
    if len(encoded) > 4096:
        raise RuntimeError('external-GET-receipt-bound')
    out = case / 'result.json'
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if os.write(fd, encoded) != len(encoded):
            raise OSError('short-receipt-write')
    finally:
        os.close(fd)
    print(json.dumps({'receipt': str(out), 'SHA256': sha(out), 'phaseResult': result}), flush=True)
    return int(bool(result['firstFailure'] or not result['deadlineOwnerJoined'] or not result['socketsClosed']))


if __name__ == '__main__':
    raise SystemExit(main())
